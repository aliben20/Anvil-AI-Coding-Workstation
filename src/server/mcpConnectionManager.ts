/**
 * @license MIT
 * Shared Model Context Protocol (MCP) Connection, Transport & OAuth 2.0 Manager
 *
 * Supports:
 * - Streamable HTTP transport (@modelcontextprotocol/sdk StreamableHTTPClientTransport + Mcp-Session-Id)
 * - Legacy SSE transport (@modelcontextprotocol/sdk SSEClientTransport)
 * - Local Stdio child process transport (@modelcontextprotocol/sdk StdioClientTransport)
 * - RFC 9728 Protected Resource Metadata discovery from WWW-Authenticate headers on HTTP 401
 * - RFC 8414 OAuth 2.0 Authorization Server & OpenID Connect 1.0 Metadata discovery
 * - RFC 7591 OAuth 2.0 Dynamic Client Registration (e.g., Supabase MCP)
 * - OAuth 2.0 Authorization Code + PKCE (S256) flow, token exchange, and token refresh
 * - Strict per-server credential isolation backed by EncryptedCredentialVault
 * - Paginated tools/list discovery and tools/call execution
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  McpServerEntry,
  McpTransportType,
  McpAuthType,
  McpOAuthMetadata,
  McpDiagnosticLog,
  McpDiscoveredTool,
  McpDiscoveredResource,
  McpDiscoveredPrompt,
} from '../types.ts';
import { SecretRedactor, type EncryptedCredentialVault } from './workstationEngine.ts';
import { parseMcpHttpOrSsePayload } from './sourceIntegrations.ts';

export interface PendingMcpOAuthState {
  state: string;
  serverId: string;
  codeVerifier: string;
  redirectUri: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  resource?: string;
  createdAtMillis: number;
}

export interface McpToolCallOutput {
  serverId: string;
  serverName: string;
  toolName: string;
  isError: boolean;
  textOutput: string;
  contentBlocks: Array<{ type: string; text?: string; [key: string]: unknown }>;
  durationMs: number;
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64UrlEncode(crypto.randomBytes(32));
  const hash = crypto.createHash('sha256').update(codeVerifier).digest();
  const codeChallenge = base64UrlEncode(hash);
  return { codeVerifier, codeChallenge };
}

export function parseWwwAuthenticateHeader(headerValue: string): {
  scheme: string;
  resourceMetadataUrl?: string;
  scope?: string;
  error?: string;
  errorDescription?: string;
} {
  const trimmed = headerValue.trim();
  const schemeMatch = trimmed.match(/^([A-Za-z0-9_-]+)/);
  const scheme = schemeMatch ? schemeMatch[1] : 'Bearer';

  const extractParam = (key: string): string | undefined => {
    const regex = new RegExp(`${key}\\s*=\\s*"([^"]*)"`, 'i');
    const match = trimmed.match(regex);
    if (match) return match[1];
    const unquoted = new RegExp(`${key}\\s*=\\s*([^,\\s]+)`, 'i');
    const m2 = trimmed.match(unquoted);
    return m2 ? m2[1] : undefined;
  };

  return {
    scheme,
    resourceMetadataUrl: extractParam('resource_metadata'),
    scope: extractParam('scope'),
    error: extractParam('error'),
    errorDescription: extractParam('error_description'),
  };
}

export function validateEndpointUrl(urlStr: string): { valid: boolean; normalizedUrl?: string; error?: string } {
  try {
    const trimmed = urlStr.trim();
    if (!trimmed) {
      return { valid: false, error: 'Endpoint URL cannot be empty.' };
    }
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        valid: false,
        error: `Invalid protocol '${parsed.protocol}'. Only http: and https: MCP endpoints are permitted.`,
      };
    }
    const hostname = parsed.hostname.toLowerCase();
    // Block cloud instance metadata and link-local SSRF vectors
    if (
      hostname === '169.254.169.254' ||
      hostname === 'metadata.google.internal' ||
      hostname === 'metadata.internal' ||
      hostname === 'instance-data' ||
      hostname === '100.100.100.200' ||
      hostname.endsWith('.internal.net') ||
      hostname.endsWith('.google.internal')
    ) {
      return {
        valid: false,
        error: 'Blocked: Access to cloud instance metadata services is prohibited (SSRF prevention).',
      };
    }
    // Disallow credentials in URL authority
    if (parsed.username || parsed.password) {
      return {
        valid: false,
        error: 'Credentials in URL authority (user:pass@host) are prohibited. Configure authentication in the credential vault instead.',
      };
    }
    return { valid: true, normalizedUrl: parsed.toString() };
  } catch (err) {
    return { valid: false, error: `Invalid URL format: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export class McpConnectionManager {
  private mcpFile: string;
  private rootDir: string;
  private vault: EncryptedCredentialVault;
  private servers: McpServerEntry[] = [];
  private pendingOAuthStates = new Map<string, PendingMcpOAuthState>();
  private activeDiscoveryJobs = new Map<string, Promise<McpServerEntry>>();

  constructor(dataDir: string, rootDir: string, vault: EncryptedCredentialVault) {
    this.mcpFile = path.join(dataDir, 'mcp_servers.json');
    this.rootDir = rootDir;
    this.vault = vault;
    this.loadServers();
  }

  private getVaultProviderKey(serverId: string, kind: 'token' | 'refresh' | 'client_secret'): string {
    return `mcp:${serverId}:${kind}`;
  }

  private getStoredSecret(serverId: string, kind: 'token' | 'refresh' | 'client_secret'): string | null {
    return this.vault.getActiveSecret(this.getVaultProviderKey(serverId, kind));
  }

  private setStoredSecret(
    serverId: string,
    kind: 'token' | 'refresh' | 'client_secret',
    secretValue: string
  ): void {
    const providerKey = this.getVaultProviderKey(serverId, kind);
    const existing = this.vault.listCredentials(providerKey);
    for (const c of existing) {
      this.vault.removeCredential(providerKey, c.id);
    }
    if (secretValue.trim()) {
      this.vault.saveCredential(providerKey, `${serverId}-${kind}`, secretValue.trim());
    }
  }

  private clearStoredSecrets(serverId: string): void {
    for (const kind of ['token', 'refresh', 'client_secret'] as const) {
      const providerKey = this.getVaultProviderKey(serverId, kind);
      for (const c of this.vault.listCredentials(providerKey)) {
        this.vault.removeCredential(providerKey, c.id);
      }
    }
  }

  getKnownSecrets(serverId: string): string[] {
    const list: string[] = [];
    for (const kind of ['token', 'refresh', 'client_secret'] as const) {
      const sec = this.getStoredSecret(serverId, kind);
      if (sec && sec.length >= 6) list.push(sec);
    }
    return list;
  }

  private appendDiagnostic(
    server: McpServerEntry,
    level: 'info' | 'warn' | 'error',
    stage: McpDiagnosticLog['stage'],
    message: string,
    httpStatus?: number
  ): void {
    if (!Array.isArray(server.diagnostics)) {
      server.diagnostics = [];
    }
    const safeMsg = SecretRedactor.redact(message, this.getKnownSecrets(server.id));
    server.diagnostics.unshift({
      timestampMillis: Date.now(),
      level,
      stage,
      message: safeMsg,
      ...(typeof httpStatus === 'number' ? { httpStatus } : {}),
    });
    if (server.diagnostics.length > 50) {
      server.diagnostics = server.diagnostics.slice(0, 50);
    }
  }

  private loadServers(): void {
    if (fs.existsSync(this.mcpFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.mcpFile, 'utf-8'));
        if (Array.isArray(parsed)) {
          this.servers = parsed;
        }
      } catch {
        this.servers = [];
      }
    }

    // Ensure built-in local HTTP loopback MCP server is present
    if (!this.servers.some((s) => s.id === 'mcp-local-workstation')) {
      this.servers.unshift({
        id: 'mcp-local-workstation',
        name: 'OBSIDIAN Local Workspace MCP Server (Streamable HTTP)',
        transport: 'streamable-http',
        endpointUrl: 'http://127.0.0.1:3000/api/mcp-loopback',
        authType: 'none',
        enabled: true,
        timeoutMs: 8000,
        lastStatus: 'untested',
      });
    }

    // Ensure built-in local Stdio MCP server is present so stdio transport works out of the box
    const stdioScript = path.join(this.rootDir, 'scripts', 'obsidian-stdio-mcp.mjs');
    if (fs.existsSync(stdioScript) && !this.servers.some((s) => s.id === 'mcp-stdio-system')) {
      this.servers.splice(1, 0, {
        id: 'mcp-stdio-system',
        name: 'OBSIDIAN Host Diagnostics MCP Server (Stdio)',
        transport: 'stdio',
        endpointUrl: `stdio://node scripts/obsidian-stdio-mcp.mjs`,
        command: process.execPath || 'node',
        args: [stdioScript],
        env: { OBSIDIAN_STDIO_MODE: 'production' },
        cwd: this.rootDir,
        authType: 'none',
        enabled: true,
        timeoutMs: 8000,
        lastStatus: 'untested',
      });
    }

    // Normalize existing server entries (e.g. GitHub Copilot MCP & Supabase MCP)
    for (const s of this.servers) {
      if (!s.transport) {
        s.transport = s.command ? 'stdio' : 'streamable-http';
      }
      if (!s.authType) {
        s.authType = 'none';
      }
      const hasToken = Boolean(this.getStoredSecret(s.id, 'token'));
      s.hasConfiguredSecret = hasToken;
      if (s.oauthMetadata) {
        s.oauthMetadata.hasAccessToken = hasToken;
        s.oauthMetadata.hasClientCredentials = Boolean(
          s.oauthClientId || this.getStoredSecret(s.id, 'client_secret')
        );
      }
    }

    this.saveServers();
  }

  saveServers(): void {
    for (const s of this.servers) {
      const hasToken = Boolean(this.getStoredSecret(s.id, 'token'));
      s.hasConfiguredSecret = hasToken;
      if (s.oauthMetadata) {
        s.oauthMetadata.hasAccessToken = hasToken;
        s.oauthMetadata.hasClientCredentials = Boolean(
          s.oauthClientId || this.getStoredSecret(s.id, 'client_secret')
        );
      }
    }
    fs.writeFileSync(this.mcpFile, JSON.stringify(this.servers, null, 2));
  }

  listServers(): McpServerEntry[] {
    for (const s of this.servers) {
      s.hasConfiguredSecret = Boolean(this.getStoredSecret(s.id, 'token'));
    }
    return this.servers;
  }

  getServer(id: string): McpServerEntry | undefined {
    return this.servers.find((s) => s.id === id);
  }

  addOrUpdateServer(input: {
    id?: string;
    name: string;
    transport?: McpTransportType;
    endpointUrl?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
    authType?: McpAuthType;
    customHeaderName?: string;
    secretToken?: string;
    oauthClientId?: string;
    oauthClientSecret?: string;
    oauthScopes?: string;
    timeoutMs?: number;
    enabled?: boolean;
  }): McpServerEntry {
    const transport: McpTransportType =
      input.transport || (input.command ? 'stdio' : 'streamable-http');
    const existing = input.id ? this.servers.find((s) => s.id === input.id) : undefined;
    const id = existing ? existing.id : `mcp-${Date.now()}`;

    const endpointUrl =
      transport === 'stdio'
        ? input.endpointUrl?.trim() ||
          `stdio://${input.command || 'node'} ${(input.args || []).join(' ')}`.trim()
        : (input.endpointUrl || existing?.endpointUrl || '').trim();

    if (transport !== 'stdio') {
      if (!endpointUrl) {
        throw new Error('HTTP/SSE MCP servers require a valid endpointUrl.');
      }
      const urlValidation = validateEndpointUrl(endpointUrl);
      if (!urlValidation.valid) {
        throw new Error(urlValidation.error || 'Invalid endpoint URL.');
      }
    }
    if (transport === 'stdio' && !input.command && !existing?.command) {
      throw new Error('Stdio MCP servers require an executable command.');
    }

    if (input.customHeaderName && !/^[A-Za-z0-9_-]+$/.test(input.customHeaderName.trim())) {
      throw new Error(
        `Invalid custom header name: '${input.customHeaderName}'. Only alphanumeric characters and hyphens are allowed.`
      );
    }

    const entry: McpServerEntry = existing || {
      id,
      name: input.name.trim() || 'MCP Server',
      transport,
      endpointUrl,
      enabled: input.enabled ?? true,
      timeoutMs: input.timeoutMs || 10_000,
      lastStatus: 'untested',
      diagnostics: [],
    };

    entry.name = input.name.trim() || entry.name;
    entry.transport = transport;
    entry.endpointUrl = endpointUrl;
    if (typeof input.enabled === 'boolean') entry.enabled = input.enabled;
    if (typeof input.timeoutMs === 'number') entry.timeoutMs = Math.max(2000, input.timeoutMs);
    if (input.authType) entry.authType = input.authType;
    if (input.customHeaderName !== undefined) {
      entry.customHeaderName = input.customHeaderName.trim() || undefined;
    }
    if (input.command !== undefined) entry.command = input.command.trim() || undefined;
    if (input.args !== undefined) entry.args = input.args;
    if (input.env !== undefined) entry.env = input.env;
    if (input.cwd !== undefined) entry.cwd = input.cwd.trim() || undefined;
    if (input.oauthClientId !== undefined) {
      entry.oauthClientId = input.oauthClientId.trim() || undefined;
    }
    if (input.oauthScopes !== undefined) {
      entry.oauthScopes = input.oauthScopes.trim() || undefined;
    }

    if (typeof input.secretToken === 'string') {
      if (input.secretToken.trim()) {
        this.setStoredSecret(id, 'token', input.secretToken.trim());
        if (!entry.authType || entry.authType === 'none') {
          entry.authType = entry.customHeaderName ? 'api_key' : 'bearer';
        }
        entry.hasConfiguredSecret = true;
        this.appendDiagnostic(
          entry,
          'info',
          'oauth',
          `Stored encrypted ${entry.authType} credential in vault for server ${entry.name}.`
        );
      } else {
        this.setStoredSecret(id, 'token', '');
        entry.hasConfiguredSecret = false;
      }
    }

    if (typeof input.oauthClientSecret === 'string' && input.oauthClientSecret.trim()) {
      this.setStoredSecret(id, 'client_secret', input.oauthClientSecret.trim());
    }

    if (!existing) {
      this.servers.push(entry);
    }
    this.saveServers();
    return entry;
  }

  configureServerAuth(
    serverId: string,
    config: {
      authType?: McpAuthType;
      secretToken?: string;
      customHeaderName?: string;
      oauthClientId?: string;
      oauthClientSecret?: string;
      oauthScopes?: string;
      clearCredentials?: boolean;
    }
  ): McpServerEntry {
    const server = this.getServer(serverId);
    if (!server) {
      throw new Error(`MCP server not found: ${serverId}`);
    }

    if (config.customHeaderName && !/^[A-Za-z0-9_-]+$/.test(config.customHeaderName.trim())) {
      throw new Error(
        `Invalid custom header name: '${config.customHeaderName}'. Only alphanumeric characters and hyphens are allowed.`
      );
    }

    if (config.clearCredentials) {
      this.clearStoredSecrets(serverId);
      server.hasConfiguredSecret = false;
      server.lastStatus = 'not_configured';
      server.lastError = undefined;
      this.appendDiagnostic(server, 'info', 'oauth', 'Cleared stored credentials for this server.');
    }

    if (config.authType) {
      server.authType = config.authType;
    }
    if (config.customHeaderName !== undefined) {
      server.customHeaderName = config.customHeaderName.trim() || undefined;
    }
    if (config.oauthClientId !== undefined) {
      server.oauthClientId = config.oauthClientId.trim() || undefined;
    }
    if (config.oauthScopes !== undefined) {
      server.oauthScopes = config.oauthScopes.trim() || undefined;
    }
    if (typeof config.oauthClientSecret === 'string' && config.oauthClientSecret.trim()) {
      this.setStoredSecret(serverId, 'client_secret', config.oauthClientSecret.trim());
    }
    if (typeof config.secretToken === 'string' && config.secretToken.trim()) {
      this.setStoredSecret(serverId, 'token', config.secretToken.trim());
      if (!server.authType || server.authType === 'none') {
        server.authType = server.customHeaderName ? 'api_key' : 'bearer';
      }
      server.hasConfiguredSecret = true;
      this.appendDiagnostic(
        server,
        'info',
        'oauth',
        `Updated encrypted ${server.authType} token for ${server.name}.`
      );
    }

    this.saveServers();
    return server;
  }

  removeServer(id: string): void {
    this.clearStoredSecrets(id);
    this.servers = this.servers.filter((s) => s.id !== id);
    this.saveServers();
  }

  /**
   * Reconnects to an MCP server, resetting cached session state and discovering tools anew.
   */
  async reconnectServer(id: string): Promise<McpServerEntry> {
    const server = this.getServer(id);
    if (!server) {
      throw new Error(`MCP server not found: ${id}`);
    }
    server.sessionId = undefined;
    server.lastStatus = 'connecting';
    this.appendDiagnostic(server, 'info', 'init', `Reconnecting to ${server.name}...`);
    return await this.discoverServerTools(id);
  }

  /**
   * Builds per-server HTTP headers.
   * Strictly validates that the request URL shares the exact origin of `server.endpointUrl`
   * so one server's token is NEVER forwarded to another host.
   */
  private buildRequestHeadersForServer(
    server: McpServerEntry,
    targetUrl?: string | URL
  ): Record<string, string> {
    const headers: Record<string, string> = {};
    if (server.transport === 'stdio') return headers;

    try {
      const serverOrigin = new URL(server.endpointUrl).origin;
      const reqOrigin = targetUrl ? new URL(String(targetUrl)).origin : serverOrigin;
      if (reqOrigin !== serverOrigin) {
        // Security invariant: never attach credentials across origins
        return headers;
      }
    } catch {
      return headers;
    }

    const token = this.getStoredSecret(server.id, 'token');
    if (!token) return headers;

    if (server.authType === 'api_key' && server.customHeaderName) {
      headers[server.customHeaderName] = token;
    } else {
      headers['Authorization'] = token.toLowerCase().startsWith('bearer ')
        ? token
        : `Bearer ${token}`;
    }
    return headers;
  }

  /**
   * Probes RFC 9728 Protected Resource Metadata and RFC 8414 / OIDC Authorization Server Metadata
   * when an HTTP MCP server returns 401 or when OAuth discovery is requested.
   */
  async discoverServerOAuthMetadata(
    server: McpServerEntry,
    wwwAuthenticateHeader?: string
  ): Promise<McpOAuthMetadata> {
    const parsedWww = wwwAuthenticateHeader
      ? parseWwwAuthenticateHeader(wwwAuthenticateHeader)
      : undefined;

    const serverUrl = new URL(server.endpointUrl);
    const candidateResourceMetaUrls: string[] = [];
    if (parsedWww?.resourceMetadataUrl) {
      candidateResourceMetaUrls.push(parsedWww.resourceMetadataUrl);
    }
    // Standard RFC 9728 path-specific well-known URL
    const cleanPath = serverUrl.pathname.replace(/^\/+/, '');
    if (cleanPath) {
      candidateResourceMetaUrls.push(
        `${serverUrl.origin}/.well-known/oauth-protected-resource/${cleanPath}`
      );
    }
    candidateResourceMetaUrls.push(`${serverUrl.origin}/.well-known/oauth-protected-resource`);

    let resourceMeta: Record<string, unknown> | null = null;
    let resolvedResourceMetaUrl: string | undefined;

    for (const candidateUrl of candidateResourceMetaUrls) {
      try {
        const res = await fetch(candidateUrl, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const json = (await res.json()) as Record<string, unknown>;
          if (json && typeof json === 'object') {
            resourceMeta = json;
            resolvedResourceMetaUrl = candidateUrl;
            break;
          }
        }
      } catch {
        // Try next candidate
      }
    }

    const authServers = Array.isArray(resourceMeta?.authorization_servers)
      ? (resourceMeta!.authorization_servers as string[])
      : [];
    const primaryAuthServer = (authServers[0] || serverUrl.origin).replace(/\/$/, '');

    // Discover RFC 8414 (.well-known/oauth-authorization-server) or OIDC (.well-known/openid-configuration)
    let authServerMeta: Record<string, unknown> | null = null;
    const authServerUrlObj = new URL(primaryAuthServer);
    const authPath = authServerUrlObj.pathname.replace(/^\/+|\/+$/g, '');
    const authMetaCandidates = [
      `${primaryAuthServer}/.well-known/oauth-authorization-server`,
      ...(authPath
        ? [`${authServerUrlObj.origin}/.well-known/oauth-authorization-server/${authPath}`]
        : []),
      `${primaryAuthServer}/.well-known/openid-configuration`,
      ...(authPath
        ? [`${authServerUrlObj.origin}/.well-known/openid-configuration/${authPath}`]
        : []),
    ];

    for (const candidate of authMetaCandidates) {
      try {
        const res = await fetch(candidate, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const json = (await res.json()) as Record<string, unknown>;
          if (json && (json.authorization_endpoint || json.token_endpoint)) {
            authServerMeta = json;
            break;
          }
        }
      } catch {
        // Try next candidate
      }
    }

    const resourceScopes = Array.isArray(resourceMeta?.scopes_supported)
      ? (resourceMeta!.scopes_supported as string[]).map(String)
      : [];
    const authScopes = Array.isArray(authServerMeta?.scopes_supported)
      ? (authServerMeta!.scopes_supported as string[]).map(String)
      : [];
    const mergedScopes =
      resourceScopes.length > 0
        ? resourceScopes
        : authScopes.length > 0
        ? authScopes
        : parsedWww?.scope
        ? parsedWww.scope.split(/\s+/).filter(Boolean)
        : [];

    const registrationEndpoint =
      typeof authServerMeta?.registration_endpoint === 'string'
        ? authServerMeta.registration_endpoint
        : undefined;
    const authorizationEndpoint =
      typeof authServerMeta?.authorization_endpoint === 'string'
        ? authServerMeta.authorization_endpoint
        : undefined;
    const tokenEndpoint =
      typeof authServerMeta?.token_endpoint === 'string'
        ? authServerMeta.token_endpoint
        : undefined;
    const deviceAuthorizationEndpoint =
      typeof authServerMeta?.device_authorization_endpoint === 'string'
        ? authServerMeta.device_authorization_endpoint
        : undefined;
    const codeChallengeMethods = Array.isArray(authServerMeta?.code_challenge_methods_supported)
      ? (authServerMeta!.code_challenge_methods_supported as string[]).map(String)
      : ['S256'];

    const supportsDynamicRegistration = Boolean(registrationEndpoint);
    const hasAccessToken = Boolean(this.getStoredSecret(server.id, 'token'));
    const hasClientCredentials = Boolean(
      server.oauthClientId || this.getStoredSecret(server.id, 'client_secret')
    );

    let setupRequirement: string | undefined;
    if (!hasAccessToken) {
      if (supportsDynamicRegistration) {
        setupRequirement = `Supports automatic OAuth 2.0 PKCE with RFC 7591 Dynamic Client Registration (${registrationEndpoint}), or direct Bearer Personal Access Token authentication.`;
      } else if (authorizationEndpoint && !server.oauthClientId) {
        setupRequirement = `Authorization server (${primaryAuthServer}) requires authentication and does not expose an RFC 7591 dynamic client registration endpoint. Provide a Bearer Personal Access Token (e.g. GitHub PAT) or configure an OAuth App Client ID to launch the PKCE popup flow.`;
      } else {
        setupRequirement = `Server requires Bearer authentication or OAuth 2.0 authorization.`;
      }
    }

    const metadata: McpOAuthMetadata = {
      resource:
        typeof resourceMeta?.resource === 'string' ? resourceMeta.resource : server.endpointUrl,
      resourceName:
        typeof resourceMeta?.resource_name === 'string' ? resourceMeta.resource_name : server.name,
      resourceMetadataUrl: resolvedResourceMetaUrl || parsedWww?.resourceMetadataUrl,
      wwwAuthenticateHeader,
      authorizationServerUrl: primaryAuthServer,
      authorizationEndpoint,
      tokenEndpoint,
      registrationEndpoint,
      deviceAuthorizationEndpoint,
      scopesSupported: mergedScopes,
      codeChallengeMethodsSupported: codeChallengeMethods,
      supportsDynamicRegistration,
      hasClientCredentials,
      hasAccessToken,
      setupRequirement,
    };

    server.oauthMetadata = metadata;
    this.appendDiagnostic(
      server,
      'info',
      'auth_discovery',
      `Discovered OAuth metadata: resource="${metadata.resourceName}", authServer="${primaryAuthServer}", dynamicRegistration=${supportsDynamicRegistration}, scopes=[${mergedScopes.slice(0, 5).join(', ')}]`
    );
    this.saveServers();
    return metadata;
  }

  /**
   * Starts an OAuth 2.0 Authorization Code + PKCE flow for an HTTP/SSE MCP server.
   * Automatically performs RFC 7591 Dynamic Client Registration if supported and no client_id is set.
   */
  async startOAuthFlow(
    serverId: string,
    redirectUri: string,
    requestedScopes?: string
  ): Promise<{
    authorizationUrl: string;
    state: string;
    clientId: string;
    dynamicRegistrationUsed: boolean;
  }> {
    const server = this.getServer(serverId);
    if (!server) {
      throw new Error(`MCP server not found: ${serverId}`);
    }
    if (server.transport === 'stdio') {
      throw new Error(
        'Stdio MCP servers run locally and use environment variables rather than remote HTTP OAuth.'
      );
    }

    const oauthMeta =
      server.oauthMetadata?.authorizationEndpoint
        ? server.oauthMetadata
        : await this.discoverServerOAuthMetadata(server);

    if (!oauthMeta.authorizationEndpoint || !oauthMeta.tokenEndpoint) {
      throw new Error(
        `Could not discover OAuth 2.0 authorization_endpoint/token_endpoint for ${server.endpointUrl}. Configure a Bearer Token or API Key instead.`
      );
    }

    let clientId = server.oauthClientId;
    let clientSecret = this.getStoredSecret(server.id, 'client_secret') || undefined;
    let dynamicRegistrationUsed = false;

    // Perform RFC 7591 Dynamic Client Registration if needed and supported
    if (!clientId && oauthMeta.registrationEndpoint) {
      this.appendDiagnostic(
        server,
        'info',
        'oauth',
        `Performing RFC 7591 Dynamic Client Registration at ${oauthMeta.registrationEndpoint} with redirect_uri=${redirectUri}`
      );
      const regRes = await fetch(oauthMeta.registrationEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_name: `OBSIDIAN AI Coding Workstation (${server.name})`,
          redirect_uris: [redirectUri],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'client_secret_post',
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!regRes.ok) {
        const errBody = await regRes.text();
        throw new Error(
          `Dynamic Client Registration failed (HTTP ${regRes.status}): ${errBody.slice(0, 240)}`
        );
      }

      const regData = (await regRes.json()) as {
        client_id?: string;
        client_secret?: string;
      };
      if (!regData.client_id) {
        throw new Error('Dynamic Client Registration response did not include a client_id.');
      }
      clientId = regData.client_id;
      server.oauthClientId = clientId;
      if (regData.client_secret) {
        clientSecret = regData.client_secret;
        this.setStoredSecret(server.id, 'client_secret', clientSecret);
      }
      dynamicRegistrationUsed = true;
      this.appendDiagnostic(
        server,
        'info',
        'oauth',
        `Dynamically registered OAuth client_id="${clientId.slice(0, 12)}..."`
      );
      this.saveServers();
    }

    if (!clientId) {
      throw new Error(
        `OAuth provider (${oauthMeta.authorizationServerUrl}) does not support automatic RFC 7591 client registration. Enter an OAuth App Client ID (with callback URL ${redirectUri}) or provide a Personal Access Token (Bearer Token).`
      );
    }

    const { codeVerifier, codeChallenge } = generatePkcePair();
    const state = base64UrlEncode(crypto.randomBytes(24));
    const scopeStr =
      requestedScopes?.trim() ||
      server.oauthScopes?.trim() ||
      (oauthMeta.scopesSupported && oauthMeta.scopesSupported.length > 0
        ? oauthMeta.scopesSupported.join(' ')
        : '');

    const authUrl = new URL(oauthMeta.authorizationEndpoint);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    if (scopeStr) {
      authUrl.searchParams.set('scope', scopeStr);
    }

    this.pendingOAuthStates.set(state, {
      state,
      serverId: server.id,
      codeVerifier,
      redirectUri,
      tokenEndpoint: oauthMeta.tokenEndpoint,
      clientId,
      clientSecret,
      resource: oauthMeta.resource,
      createdAtMillis: Date.now(),
    });

    this.appendDiagnostic(
      server,
      'info',
      'oauth',
      `Generated PKCE S256 authorization URL for ${oauthMeta.authorizationEndpoint}`
    );
    this.saveServers();

    return {
      authorizationUrl: authUrl.toString(),
      state,
      clientId,
      dynamicRegistrationUsed,
    };
  }

  /**
   * Completes the OAuth 2.0 Authorization Code + PKCE exchange from `/api/mcp/oauth/callback`,
   * stores the tokens in EncryptedCredentialVault, and immediately discovers tools.
   */
  async handleOAuthCallback(code: string, state: string): Promise<McpServerEntry> {
    const pending = this.pendingOAuthStates.get(state);
    if (!pending) {
      throw new Error('Invalid or expired OAuth state parameter.');
    }
    this.pendingOAuthStates.delete(state);

    const server = this.getServer(pending.serverId);
    if (!server) {
      throw new Error(`MCP server not found for OAuth state: ${pending.serverId}`);
    }

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: pending.redirectUri,
      client_id: pending.clientId,
      code_verifier: pending.codeVerifier,
    });
    if (pending.clientSecret) {
      params.set('client_secret', pending.clientSecret);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };

    const tokenRes = await fetch(pending.tokenEndpoint, {
      method: 'POST',
      headers,
      body: params.toString(),
      signal: AbortSignal.timeout(10_000),
    });

    const rawText = await tokenRes.text();
    let tokenData: {
      access_token?: string;
      refresh_token?: string;
      error?: string;
      error_description?: string;
    } = {};
    try {
      tokenData = JSON.parse(rawText);
    } catch {
      const sp = new URLSearchParams(rawText);
      tokenData = {
        access_token: sp.get('access_token') || undefined,
        refresh_token: sp.get('refresh_token') || undefined,
        error: sp.get('error') || undefined,
        error_description: sp.get('error_description') || undefined,
      };
    }

    if (!tokenRes.ok || !tokenData.access_token) {
      const errMsg =
        tokenData.error_description ||
        tokenData.error ||
        `Token exchange failed (HTTP ${tokenRes.status}): ${rawText.slice(0, 200)}`;
      this.appendDiagnostic(server, 'error', 'oauth', errMsg, tokenRes.status);
      server.lastStatus = 'error';
      server.lastError = errMsg;
      this.saveServers();
      throw new Error(errMsg);
    }

    this.setStoredSecret(server.id, 'token', tokenData.access_token);
    if (tokenData.refresh_token) {
      this.setStoredSecret(server.id, 'refresh', tokenData.refresh_token);
    }
    server.authType = 'oauth2';
    server.hasConfiguredSecret = true;
    this.appendDiagnostic(
      server,
      'info',
      'oauth',
      'OAuth 2.0 PKCE token exchange succeeded. Running MCP tool discovery...'
    );
    this.saveServers();

    return await this.discoverServerTools(server.id);
  }

  /**
   * Attempts to refresh an OAuth 2.0 access token using a stored refresh_token if a 401 occurs.
   */
  private async tryRefreshOAuthToken(server: McpServerEntry): Promise<boolean> {
    const refreshToken = this.getStoredSecret(server.id, 'refresh');
    const tokenEndpoint = server.oauthMetadata?.tokenEndpoint;
    const clientId = server.oauthClientId;
    if (!refreshToken || !tokenEndpoint || !clientId) {
      return false;
    }

    try {
      const clientSecret = this.getStoredSecret(server.id, 'client_secret');
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      });
      if (clientSecret) {
        params.set('client_secret', clientSecret);
      }

      const res = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: params.toString(),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) return false;
      const data = (await res.json()) as { access_token?: string; refresh_token?: string };
      if (!data.access_token) return false;

      this.setStoredSecret(server.id, 'token', data.access_token);
      if (data.refresh_token) {
        this.setStoredSecret(server.id, 'refresh', data.refresh_token);
      }
      this.appendDiagnostic(
        server,
        'info',
        'oauth',
        'Successfully refreshed expired OAuth 2.0 access_token via refresh_token.'
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Connects to an MCP server via the configured transport (Streamable HTTP, SSE, or Stdio),
   * negotiates protocol capabilities, handles 401 WWW-Authenticate discovery, and lists all tools
   * across paginated cursors.
   */
  /**
   * Connects to an MCP server via the configured transport (Streamable HTTP, SSE, or Stdio),
   * negotiates protocol capabilities, handles 401 WWW-Authenticate discovery, and lists all tools
   * across paginated cursors. Idempotently deduplicates concurrent discovery requests.
   */
  async discoverServerTools(serverId: string): Promise<McpServerEntry> {
    const existingJob = this.activeDiscoveryJobs.get(serverId);
    if (existingJob) {
      return await existingJob;
    }
    const job = this.executeDiscoveryLifecycle(serverId).finally(() => {
      this.activeDiscoveryJobs.delete(serverId);
    });
    this.activeDiscoveryJobs.set(serverId, job);
    return await job;
  }

  private async executeDiscoveryLifecycle(serverId: string): Promise<McpServerEntry> {
    const server = this.getServer(serverId);
    if (!server) {
      throw new Error(`MCP server not found: ${serverId}`);
    }

    const transportType: McpTransportType =
      server.transport || (server.command ? 'stdio' : 'streamable-http');
    server.transport = transportType;
    server.lastStatus = 'connecting';

    this.appendDiagnostic(
      server,
      'info',
      'init',
      `Starting MCP handshake over ${transportType} (${
        transportType === 'stdio' ? `${server.command} ${(server.args || []).join(' ')}` : server.endpointUrl
      })`
    );

    // ------------------------------------------------------------------------
    // 1. STDIO TRANSPORT (@modelcontextprotocol/sdk StdioClientTransport)
    // ------------------------------------------------------------------------
    if (transportType === 'stdio') {
      const cmd = server.command || process.execPath || 'node';
      const args = Array.isArray(server.args) ? server.args : [];
      const mergedEnv: Record<string, string> = {
        ...getDefaultEnvironment(),
        ...(server.env || {}),
      };
      const secretToken = this.getStoredSecret(server.id, 'token');
      if (secretToken) {
        mergedEnv.MCP_AUTH_TOKEN = secretToken;
      }

      const transport = new StdioClientTransport({
        command: cmd,
        args,
        env: mergedEnv,
        cwd: server.cwd || this.rootDir,
        stderr: 'pipe',
      });

      let stderrLog = '';
      if (transport.stderr) {
        transport.stderr.on('data', (chunk: Buffer) => {
          stderrLog += chunk.toString('utf-8').slice(0, 500);
        });
      }

      const client = new Client(
        { name: 'obsidian-workstation-mcp-client', version: '1.2.0' },
        { capabilities: {} }
      );

      try {
        await Promise.race([
          client.connect(transport),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Stdio handshake timed out after ${server.timeoutMs}ms`)), server.timeoutMs)
          ),
        ]);

        const serverVer = client.getServerVersion();
        if (serverVer) {
          server.serverInfo = {
            name: String(serverVer.name || server.name),
            version: String(serverVer.version || '1.0.0'),
          };
        }
        server.protocolVersion = '2024-11-05';

        const allTools: McpDiscoveredTool[] = [];
        let cursor: string | undefined = undefined;
        let pageCount = 0;

        do {
          const page = await client.listTools(cursor ? { cursor } : undefined);
          for (const t of page.tools || []) {
            const schema = (t.inputSchema || { type: 'object' }) as Record<string, unknown>;
            const reqArr = Array.isArray(schema.required) ? schema.required.map(String) : [];
            allTools.push({
              name: String(t.name).replace(/[^a-zA-Z0-9_-]/g, ''),
              description: String(t.description || '').slice(0, 400),
              requiredParams: reqArr,
              inputSchema: schema,
            });
          }
          cursor = page.nextCursor;
          pageCount++;
        } while (cursor && pageCount < 10);

        // Best effort discovery of resources and prompts
        try {
          const resList = await client.listResources();
          if (Array.isArray(resList.resources)) {
            server.discoveredResources = resList.resources.map((r) => ({
              uri: String(r.uri),
              name: String(r.name || r.uri),
              description: r.description ? String(r.description).slice(0, 300) : undefined,
              mimeType: r.mimeType ? String(r.mimeType) : undefined,
            }));
          }
        } catch {
          // Optional capability
        }

        try {
          const pList = await client.listPrompts();
          if (Array.isArray(pList.prompts)) {
            server.discoveredPrompts = pList.prompts.map((p) => ({
              name: String(p.name),
              description: p.description ? String(p.description).slice(0, 300) : undefined,
              arguments: Array.isArray(p.arguments) ? p.arguments : undefined,
            }));
          }
        } catch {
          // Optional capability
        }

        server.discoveredTools = allTools;
        server.lastStatus = 'connected';
        server.lastError = undefined;
        server.lastConnectedAtMillis = Date.now();
        this.appendDiagnostic(
          server,
          'info',
          'tools_list',
          `Connected via stdio (PID ${transport.pid ?? 'exited'}) and discovered ${allTools.length} tools.`
        );
        this.saveServers();
        return server;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const safeMsg = SecretRedactor.redact(msg, this.getKnownSecrets(server.id));
        const fullErr = stderrLog.trim() ? `${safeMsg} (stderr: ${stderrLog.trim()})` : safeMsg;
        server.lastStatus = 'error';
        server.lastError = fullErr;
        this.appendDiagnostic(server, 'error', 'transport', fullErr);
        this.saveServers();
        return server;
      } finally {
        try {
          await client.close();
        } catch {
          // Ignore close errors
        }
      }
    }

    // ------------------------------------------------------------------------
    // 2. HTTP / STREAMABLE-HTTP & SSE TRANSPORTS
    // ------------------------------------------------------------------------
    return await this.discoverHttpOrSseServerTools(server, false, false);
  }

  private async discoverHttpOrSseServerTools(
    server: McpServerEntry,
    isRetryAfterRefresh: boolean,
    isRetryAfterRateLimit: boolean
  ): Promise<McpServerEntry> {
    const authHeaders = this.buildRequestHeadersForServer(server, server.endpointUrl);

    // Step 1: Probe / Initialize via HTTP POST (Streamable HTTP specification) or SDK transport
    try {
      if (server.transport === 'sse') {
        return await this.connectViaSdkSseTransport(server, authHeaders);
      }

      // Send MCP initialize request to inspect status, WWW-Authenticate header, Mcp-Session-Id, or SSE upgrade
      const initController = new AbortController();
      const initTimer = setTimeout(() => initController.abort(), server.timeoutMs);
      let initRes: Response;
      try {
        initRes = await fetch(server.endpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...authHeaders,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: {
                name: 'obsidian-workstation-mcp-client',
                version: '1.2.0',
              },
            },
          }),
          signal: initController.signal,
        });
      } finally {
        clearTimeout(initTimer);
      }

      // Check HTTP 401 Unauthorized
      if (initRes.status === 401) {
        if (!isRetryAfterRefresh && (await this.tryRefreshOAuthToken(server))) {
          return await this.discoverHttpOrSseServerTools(server, true, isRetryAfterRateLimit);
        }

        const wwwAuth = initRes.headers.get('www-authenticate') || undefined;
        const parsedWww = wwwAuth ? parseWwwAuthenticateHeader(wwwAuth) : undefined;
        const oauthMeta = await this.discoverServerOAuthMetadata(server, wwwAuth);

        const hadToken = Boolean(this.getStoredSecret(server.id, 'token'));
        const isUnsupportedScheme =
          parsedWww?.scheme &&
          !['bearer', 'oauth', 'token', 'apikey', 'api-key'].includes(
            parsedWww.scheme.toLowerCase()
          );

        if (isUnsupportedScheme) {
          server.lastStatus = 'unsupported_auth';
          server.lastError = `Unsupported authentication scheme '${parsedWww?.scheme}' requested by ${oauthMeta.resourceName || server.name}. Only Bearer tokens, OAuth 2.0 PKCE, and documented API key headers are supported.`;
        } else if (hadToken) {
          server.lastStatus = 'token_expired';
          server.lastError = `Authentication failed (HTTP 401): the configured token was rejected or expired for ${oauthMeta.resourceName || server.name}.${
            parsedWww?.errorDescription ? ` (${parsedWww.errorDescription})` : ''
          } Re-authenticate or configure new credentials.`;
        } else {
          server.lastStatus = 'auth_required';
          server.lastError = `Authentication required (HTTP 401) for ${oauthMeta.resourceName || server.name}.${
            parsedWww?.errorDescription ? ` (${parsedWww.errorDescription})` : ''
          } ${oauthMeta.setupRequirement || ''}`.trim();
        }

        this.appendDiagnostic(server, 'warn', 'auth_discovery', server.lastError, initRes.status);
        this.saveServers();
        return server;
      }

      // Check HTTP 403 Forbidden
      if (initRes.status === 403) {
        server.lastStatus = 'permission_denied';
        server.lastError = `Permission denied (HTTP 403): The server accepted the connection or credentials, but access to this MCP endpoint is forbidden for ${server.name}. Verify your account role, permissions, or required OAuth scopes.`;
        this.appendDiagnostic(server, 'warn', 'auth_discovery', server.lastError, 403);
        this.saveServers();
        return server;
      }

      // Check HTTP 429 Too Many Requests
      if (initRes.status === 429) {
        const retryAfterHeader = initRes.headers.get('retry-after');
        let retrySeconds = 2;
        if (retryAfterHeader) {
          const parsedSec = parseInt(retryAfterHeader, 10);
          if (!isNaN(parsedSec)) {
            retrySeconds = parsedSec;
          }
        }
        if (!isRetryAfterRateLimit && retrySeconds <= 3) {
          this.appendDiagnostic(
            server,
            'warn',
            'transport',
            `HTTP 429 rate limit received. Retrying after ${retrySeconds}s backoff...`,
            429
          );
          await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000));
          return await this.discoverHttpOrSseServerTools(server, isRetryAfterRefresh, true);
        }
        server.lastStatus = 'error';
        server.rateLimitRetryAfterSec = retrySeconds;
        server.lastError = `Rate limit exceeded (HTTP 429) from ${server.name}. The server requested a retry delay of ${retrySeconds}s. Please wait before retrying.`;
        this.appendDiagnostic(server, 'warn', 'transport', server.lastError, 429);
        this.saveServers();
        return server;
      }

      // If server returns 404 or 405 on POST, try legacy SSE transport fallback
      if (initRes.status === 404 || initRes.status === 405) {
        this.appendDiagnostic(
          server,
          'info',
          'transport',
          `HTTP ${initRes.status} on POST initialize; attempting legacy SSE transport fallback...`,
          initRes.status
        );
        return await this.connectViaSdkSseTransport(server, authHeaders);
      }

      if (!initRes.ok) {
        const errBody = (await initRes.text()).slice(0, 240);
        server.lastStatus = 'discovery_failed';
        server.lastError = `HTTP ${initRes.status} from ${server.endpointUrl}: ${errBody}`;
        this.appendDiagnostic(server, 'error', 'transport', server.lastError, initRes.status);
        this.saveServers();
        return server;
      }

      const sessionId =
        initRes.headers.get('mcp-session-id') || initRes.headers.get('x-mcp-session-id') || undefined;
      if (sessionId) {
        server.sessionId = sessionId;
      }

      const initRaw = await initRes.text();
      if (initRaw.trim()) {
        try {
          const initJson = parseMcpHttpOrSsePayload(initRaw) as {
            result?: {
              protocolVersion?: string;
              serverInfo?: { name?: string; version?: string };
            };
          };
          if (initJson.result?.protocolVersion) {
            server.protocolVersion = initJson.result.protocolVersion;
          }
          if (initJson.result?.serverInfo) {
            server.serverInfo = {
              name: String(initJson.result.serverInfo.name || server.name),
              version: String(initJson.result.serverInfo.version || '1.0.0'),
            };
          }
        } catch {
          // Non-fatal if server skips initialize body
        }
      }

      // Send notifications/initialized (best-effort per MCP lifecycle spec)
      const sessionHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...authHeaders,
        ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
      };

      try {
        await fetch(server.endpointUrl, {
          method: 'POST',
          headers: sessionHeaders,
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'notifications/initialized',
          }),
          signal: AbortSignal.timeout(4000),
        });
      } catch {
        // Stateless JSON-RPC servers may ignore notifications
      }

      // Paginated tools/list loop
      const discoveredTools: McpDiscoveredTool[] = [];
      let cursor: string | undefined = undefined;
      let page = 0;

      do {
        const listRes = await fetch(server.endpointUrl, {
          method: 'POST',
          headers: sessionHeaders,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2 + page,
            method: 'tools/list',
            params: cursor ? { cursor } : {},
          }),
          signal: AbortSignal.timeout(server.timeoutMs),
        });

        if (listRes.status === 401) {
          const wwwAuth = listRes.headers.get('www-authenticate') || undefined;
          await this.discoverServerOAuthMetadata(server, wwwAuth);
          server.lastStatus = 'auth_required';
          server.lastError = `Authentication required (HTTP 401) during tools/list.`;
          this.saveServers();
          return server;
        }

        if (listRes.status === 403) {
          server.lastStatus = 'permission_denied';
          server.lastError = `Permission denied (HTTP 403) during tools/list.`;
          this.saveServers();
          return server;
        }

        if (!listRes.ok) {
          throw new Error(`HTTP ${listRes.status} during tools/list from ${server.endpointUrl}`);
        }

        const rawListText = await listRes.text();
        const data = parseMcpHttpOrSsePayload(rawListText) as {
          result?: {
            tools?: Array<{
              name: string;
              description?: string;
              inputSchema?: Record<string, unknown>;
            }>;
            nextCursor?: string;
          };
          error?: { code?: number; message?: string };
        };

        if (data.error) {
          throw new Error(data.error.message || 'MCP JSON-RPC error during tools/list');
        }

        const rawTools = data.result?.tools || [];
        for (const t of rawTools) {
          const schema = (t.inputSchema || { type: 'object' }) as Record<string, unknown>;
          const requiredParams = Array.isArray(schema.required)
            ? schema.required.map(String)
            : [];
          discoveredTools.push({
            name: String(t.name).replace(/[^a-zA-Z0-9_-]/g, ''),
            description: String(t.description || '').slice(0, 400),
            requiredParams,
            inputSchema: schema,
          });
        }

        cursor = data.result?.nextCursor ? String(data.result.nextCursor) : undefined;
        page++;
      } while (cursor && page < 10);

      // Best effort discovery of resources
      try {
        const resListRes = await fetch(server.endpointUrl, {
          method: 'POST',
          headers: sessionHeaders,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 200,
            method: 'resources/list',
          }),
          signal: AbortSignal.timeout(Math.min(5000, server.timeoutMs)),
        });
        if (resListRes.ok) {
          const rawResText = await resListRes.text();
          const resData = parseMcpHttpOrSsePayload(rawResText) as {
            result?: {
              resources?: Array<{ uri: string; name?: string; description?: string; mimeType?: string }>;
            };
          };
          if (Array.isArray(resData.result?.resources)) {
            server.discoveredResources = resData.result.resources.map((r) => ({
              uri: String(r.uri || ''),
              name: String(r.name || r.uri || ''),
              description: r.description ? String(r.description).slice(0, 300) : undefined,
              mimeType: r.mimeType ? String(r.mimeType) : undefined,
            }));
          }
        }
      } catch {
        // Optional capability
      }

      // Best effort discovery of prompts
      try {
        const promptListRes = await fetch(server.endpointUrl, {
          method: 'POST',
          headers: sessionHeaders,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 201,
            method: 'prompts/list',
          }),
          signal: AbortSignal.timeout(Math.min(5000, server.timeoutMs)),
        });
        if (promptListRes.ok) {
          const rawPromptText = await promptListRes.text();
          const promptData = parseMcpHttpOrSsePayload(rawPromptText) as {
            result?: {
              prompts?: Array<{
                name: string;
                description?: string;
                arguments?: Array<{ name: string; description?: string; required?: boolean }>;
              }>;
            };
          };
          if (Array.isArray(promptData.result?.prompts)) {
            server.discoveredPrompts = promptData.result.prompts.map((p) => ({
              name: String(p.name || ''),
              description: p.description ? String(p.description).slice(0, 300) : undefined,
              arguments: Array.isArray(p.arguments) ? p.arguments : undefined,
            }));
          }
        }
      } catch {
        // Optional capability
      }

      server.discoveredTools = discoveredTools;
      server.lastStatus = 'connected';
      server.lastError = undefined;
      server.lastConnectedAtMillis = Date.now();
      this.appendDiagnostic(
        server,
        'info',
        'tools_list',
        `Connected via Streamable HTTP (protocol ${server.protocolVersion || '2024-11-05'}) and discovered ${discoveredTools.length} tools.`,
        200
      );
      this.saveServers();
      return server;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const safeMsg = SecretRedactor.redact(msg, this.getKnownSecrets(server.id));
      server.lastStatus = 'error';
      server.lastError = safeMsg;
      this.appendDiagnostic(server, 'error', 'transport', safeMsg);
      this.saveServers();
      return server;
    }
  }

  private async connectViaSdkSseTransport(
    server: McpServerEntry,
    authHeaders: Record<string, string>
  ): Promise<McpServerEntry> {
    const client = new Client(
      { name: 'obsidian-workstation-mcp-client', version: '1.2.0' },
      { capabilities: {} }
    );
    const transport = new SSEClientTransport(new URL(server.endpointUrl), {
      requestInit: { headers: authHeaders },
    });

    try {
      await Promise.race([
        client.connect(transport),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`SSE connection timed out after ${server.timeoutMs}ms`)), server.timeoutMs)
        ),
      ]);

      const serverVer = client.getServerVersion();
      if (serverVer) {
        server.serverInfo = {
          name: String(serverVer.name || server.name),
          version: String(serverVer.version || '1.0.0'),
        };
      }
      server.protocolVersion = '2024-11-05';

      const allTools: McpDiscoveredTool[] = [];
      let cursor: string | undefined = undefined;
      let pages = 0;
      do {
        const res = await client.listTools(cursor ? { cursor } : undefined);
        for (const t of res.tools || []) {
          const schema = (t.inputSchema || { type: 'object' }) as Record<string, unknown>;
          const reqs = Array.isArray(schema.required) ? schema.required.map(String) : [];
          allTools.push({
            name: String(t.name).replace(/[^a-zA-Z0-9_-]/g, ''),
            description: String(t.description || '').slice(0, 400),
            requiredParams: reqs,
            inputSchema: schema,
          });
        }
        cursor = res.nextCursor;
        pages++;
      } while (cursor && pages < 10);

      try {
        const resList = await client.listResources();
        if (Array.isArray(resList.resources)) {
          server.discoveredResources = resList.resources.map((r) => ({
            uri: String(r.uri),
            name: String(r.name || r.uri),
            description: r.description ? String(r.description).slice(0, 300) : undefined,
            mimeType: r.mimeType ? String(r.mimeType) : undefined,
          }));
        }
      } catch {
        // Optional
      }

      try {
        const pList = await client.listPrompts();
        if (Array.isArray(pList.prompts)) {
          server.discoveredPrompts = pList.prompts.map((p) => ({
            name: String(p.name),
            description: p.description ? String(p.description).slice(0, 300) : undefined,
            arguments: Array.isArray(p.arguments) ? p.arguments : undefined,
          }));
        }
      } catch {
        // Optional
      }

      server.discoveredTools = allTools;
      server.lastStatus = 'connected';
      server.lastError = undefined;
      server.lastConnectedAtMillis = Date.now();
      this.appendDiagnostic(
        server,
        'info',
        'tools_list',
        `Connected via SSE transport and discovered ${allTools.length} tools.`
      );
      this.saveServers();
      return server;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const safeMsg = SecretRedactor.redact(msg, this.getKnownSecrets(server.id));
      if (safeMsg.includes('401') || safeMsg.toLowerCase().includes('unauthorized')) {
        await this.discoverServerOAuthMetadata(server);
        const hadToken = Boolean(this.getStoredSecret(server.id, 'token'));
        server.lastStatus = hadToken ? 'token_expired' : 'auth_required';
      } else if (safeMsg.includes('403') || safeMsg.toLowerCase().includes('forbidden')) {
        server.lastStatus = 'permission_denied';
      } else {
        server.lastStatus = 'error';
      }
      server.lastError = safeMsg;
      this.appendDiagnostic(server, 'error', 'transport', safeMsg);
      this.saveServers();
      return server;
    } finally {
      try {
        await client.close();
      } catch {
        // Ignore close error
      }
    }
  }

  /**
   * Executes an MCP tool (`tools/call`) on the specified server over its configured transport
   * (`stdio`, `streamable-http`, or `sse`).
   */
  async callServerTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown> = {}
  ): Promise<McpToolCallOutput> {
    const server = this.getServer(serverId);
    if (!server) {
      throw new Error(`MCP server not found: ${serverId}`);
    }

    const startedAt = Date.now();
    const transportType: McpTransportType =
      server.transport || (server.command ? 'stdio' : 'streamable-http');

    // 1. STDIO Tool Call
    if (transportType === 'stdio') {
      const cmd = server.command || process.execPath || 'node';
      const cmdArgs = Array.isArray(server.args) ? server.args : [];
      const mergedEnv: Record<string, string> = {
        ...getDefaultEnvironment(),
        ...(server.env || {}),
      };
      const secretToken = this.getStoredSecret(server.id, 'token');
      if (secretToken) {
        mergedEnv.MCP_AUTH_TOKEN = secretToken;
      }

      const transport = new StdioClientTransport({
        command: cmd,
        args: cmdArgs,
        env: mergedEnv,
        cwd: server.cwd || this.rootDir,
        stderr: 'pipe',
      });
      const client = new Client(
        { name: 'obsidian-workstation-mcp-client', version: '1.2.0' },
        { capabilities: {} }
      );

      try {
        await client.connect(transport);
        const result = await client.callTool({
          name: toolName,
          arguments: args,
        });
        const contentBlocks = Array.isArray(result.content)
          ? (result.content as Array<{ type: string; text?: string }>)
          : [];
        const textOutput = contentBlocks
          .map((c) => (typeof c.text === 'string' ? c.text : JSON.stringify(c)))
          .join('\n');
        const durationMs = Date.now() - startedAt;
        this.appendDiagnostic(
          server,
          result.isError ? 'warn' : 'info',
          'tool_call',
          `Called stdio tool "${toolName}" in ${durationMs}ms (isError=${Boolean(result.isError)})`
        );
        this.saveServers();
        return {
          serverId: server.id,
          serverName: server.name,
          toolName,
          isError: Boolean(result.isError),
          textOutput,
          contentBlocks,
          durationMs,
        };
      } finally {
        try {
          await client.close();
        } catch {
          // Ignore
        }
      }
    }

    // 2. SSE Tool Call
    const authHeaders = this.buildRequestHeadersForServer(server, server.endpointUrl);
    if (transportType === 'sse') {
      const client = new Client(
        { name: 'obsidian-workstation-mcp-client', version: '1.2.0' },
        { capabilities: {} }
      );
      const transport = new SSEClientTransport(new URL(server.endpointUrl), {
        requestInit: { headers: authHeaders },
      });
      try {
        await client.connect(transport);
        const result = await client.callTool({
          name: toolName,
          arguments: args,
        });
        const contentBlocks = Array.isArray(result.content)
          ? (result.content as Array<{ type: string; text?: string }>)
          : [];
        const textOutput = contentBlocks
          .map((c) => (typeof c.text === 'string' ? c.text : JSON.stringify(c)))
          .join('\n');
        const durationMs = Date.now() - startedAt;
        this.appendDiagnostic(
          server,
          result.isError ? 'warn' : 'info',
          'tool_call',
          `Called SSE tool "${toolName}" in ${durationMs}ms`
        );
        this.saveServers();
        return {
          serverId: server.id,
          serverName: server.name,
          toolName,
          isError: Boolean(result.isError),
          textOutput,
          contentBlocks,
          durationMs,
        };
      } finally {
        try {
          await client.close();
        } catch {
          // Ignore
        }
      }
    }

    // 3. Streamable HTTP JSON-RPC 2.0 Tool Call
    const sessionHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...authHeaders,
      ...(server.sessionId ? { 'Mcp-Session-Id': server.sessionId } : {}),
    };

    const callRes = await fetch(server.endpointUrl, {
      method: 'POST',
      headers: sessionHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args,
        },
      }),
      signal: AbortSignal.timeout(server.timeoutMs),
    });

    if (callRes.status === 401 || callRes.status === 403) {
      const wwwAuth = callRes.headers.get('www-authenticate') || undefined;
      await this.discoverServerOAuthMetadata(server, wwwAuth);
      server.lastStatus = 'auth_required';
      server.lastError = `Authentication required (HTTP ${callRes.status}) when calling tool "${toolName}".`;
      this.saveServers();
      throw new Error(server.lastError);
    }

    if (!callRes.ok) {
      const errText = (await callRes.text()).slice(0, 240);
      throw new Error(`HTTP ${callRes.status} calling MCP tool "${toolName}": ${errText}`);
    }

    const rawText = await callRes.text();
    const parsed = parseMcpHttpOrSsePayload(rawText) as {
      result?: {
        isError?: boolean;
        content?: Array<{ type: string; text?: string; [key: string]: unknown }>;
        [key: string]: unknown;
      };
      error?: { code?: number; message?: string };
    };

    if (parsed.error) {
      throw new Error(parsed.error.message || `MCP error calling tool "${toolName}"`);
    }

    const contentBlocks = Array.isArray(parsed.result?.content)
      ? parsed.result!.content
      : [
          {
            type: 'text',
            text: JSON.stringify(parsed.result ?? {}, null, 2),
          },
        ];

    const textOutput = contentBlocks
      .map((c) => (typeof c.text === 'string' ? c.text : JSON.stringify(c)))
      .join('\n');
    const isError = Boolean(parsed.result?.isError);
    const durationMs = Date.now() - startedAt;

    this.appendDiagnostic(
      server,
      isError ? 'warn' : 'info',
      'tool_call',
      `Called HTTP tool "${toolName}" in ${durationMs}ms (isError=${isError})`,
      callRes.status
    );
    this.saveServers();

    return {
      serverId: server.id,
      serverName: server.name,
      toolName,
      isError,
      textOutput,
      contentBlocks,
      durationMs,
    };
  }

  /**
   * Audits all configured MCP servers in parallel and returns the updated inventory.
   */
  async auditAllServers(): Promise<McpServerEntry[]> {
    for (const server of this.servers) {
      if (server.enabled) {
        await this.discoverServerTools(server.id);
      }
    }
    return this.listServers();
  }
}
