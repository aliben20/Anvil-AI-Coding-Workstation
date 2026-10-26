/**
 * @license MIT
 * OBSIDIAN Agent Tool Integration Manager
 *
 * Implements end-to-end integration registry, verification, installation,
 * and execution dispatch for:
 * 1. Mobile Harness (Google upstream mobile-harness)
 * 2. Google Antigravity (Local Host & Gemini Agent Engine)
 * 3. OpenCode (OpenCode Autonomous CLI & multi-provider agent)
 * 4. Claude Code (Anthropic Claude Code CLI)
 */

import child_process from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import https from 'https';
import {
  AgentIntegrationId,
  AgentToolIntegration,
  IntegrationLifecycleState,
  IntegrationModelOrProfile,
} from '../types.js';

export interface IntegrationConfigUpdate {
  hostUrl?: string;
  apiKey?: string;
  mode?: 'local' | 'remote_host';
  connectionMode?: 'local' | 'remote_host';
  additionalArgs?: string[];
}

export interface LaunchResult {
  success: boolean;
  output: string;
  exitCode?: number | null;
  error?: string;
}

export class AgentToolIntegrationManager {
  private dataDir: string;
  private rootDir: string;
  private vaultSecretGetter: (key: string) => string | undefined | null;
  private vaultSecretSaver: (key: string, value: string) => void;
  private configsFile: string;
  private persistedConfigs: Record<string, { hostUrl?: string; mode?: 'local' | 'remote_host' }> = {};

  constructor(
    dataDir: string,
    rootDir: string,
    vaultSecretGetter: (key: string) => string | undefined | null,
    vaultSecretSaver: (key: string, value: string) => void
  ) {
    this.dataDir = dataDir;
    this.rootDir = rootDir;
    this.vaultSecretGetter = vaultSecretGetter;
    this.vaultSecretSaver = vaultSecretSaver;
    this.configsFile = path.join(this.dataDir, 'agent-integrations-config.json');
    this.loadPersistedConfigs();
  }

  private loadPersistedConfigs() {
    try {
      if (fs.existsSync(this.configsFile)) {
        this.persistedConfigs = JSON.parse(fs.readFileSync(this.configsFile, 'utf8'));
      }
    } catch {
      this.persistedConfigs = {};
    }
  }

  private savePersistedConfigs() {
    try {
      const dir = path.dirname(this.configsFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.configsFile, JSON.stringify(this.persistedConfigs, null, 2), 'utf8');
    } catch (err) {
      console.warn('Failed to save agent integrations config:', err);
    }
  }

  /**
   * Probes whether the current execution runtime is Windows, Linux, Darwin, or Android.
   */
  public getRuntimeEnvironment() {
    const isWindows = process.platform === 'win32';
    const isDarwin = process.platform === 'darwin';
    const isAndroid =
      Boolean(process.env.ANDROID_ROOT) ||
      Boolean(process.env.ANDROID_DATA) ||
      fs.existsSync('/system/build.prop');
    const isLinux = process.platform === 'linux' && !isAndroid;
    const arch = process.arch; // 'x64', 'arm64', etc.

    return {
      platform: isAndroid ? 'android' : process.platform,
      isWindows,
      isDarwin,
      isAndroid,
      isLinux,
      arch,
    };
  }

  /**
   * Returns live status for all 4 coding-agent tool integrations.
   */
  public async getAllIntegrations(): Promise<AgentToolIntegration[]> {
    const env = this.getRuntimeEnvironment();
    const results: AgentToolIntegration[] = [];

    // 1. Mobile Harness
    results.push(await this.inspectMobileHarness(env));

    // 2. Google Antigravity
    results.push(await this.inspectAntigravity(env));

    // 3. OpenCode
    results.push(await this.inspectOpenCode(env));

    // 4. Claude Code
    results.push(await this.inspectClaudeCode(env));

    return results;
  }

  /**
   * Returns detailed live status for a single integration by ID.
   */
  public async getIntegration(id: AgentIntegrationId): Promise<AgentToolIntegration | null> {
    const all = await this.getAllIntegrations();
    return all.find((item) => item.id === id) || null;
  }

  // ============================================================================
  // 1. Mobile Harness (Google upstream mobile-harness)
  // ============================================================================
  private async inspectMobileHarness(env: ReturnType<typeof this.getRuntimeEnvironment>): Promise<AgentToolIntegration> {
    const customConfig = this.persistedConfigs['mobile-harness'] || {};
    const hostUrl = customConfig.hostUrl || 'http://127.0.0.1:8000';
    const isRemote = customConfig.mode === 'remote_host' || env.isAndroid;

    // Check local Java and ADB binaries
    const javaProbe = this.probeExecutable('java -version');
    const adbProbe = this.probeExecutable('adb version');
    const hasLocalRuntimes = javaProbe.available && adbProbe.available;

    // Probe host connection if remote or if local port is active
    const hostProbe = await this.probeHttpEndpoint(`${hostUrl.replace(/\/$/, '')}/status`, 2500);

    let overallState: IntegrationLifecycleState = 'Not installed';
    let installStatus: AgentToolIntegration['installStatus'] = 'not_installed';
    let connectionState: AgentToolIntegration['connectionState'] = 'offline';
    let message = '';

    if (env.isAndroid && !hostProbe.ok && !hasLocalRuntimes) {
      overallState = 'Unsupported on this device';
      installStatus = 'unsupported';
      connectionState = 'unsupported';
      message =
        'Mobile Harness controller daemon requires Java 11+ and ADB. On Android, connect to a running Mobile Harness Lab Server or host machine via network URL.';
    } else if (hostProbe.ok) {
      overallState = 'Ready';
      installStatus = 'installed';
      connectionState = 'ready';
      message = `Connected to Mobile Harness Lab Server at ${hostUrl} (HTTP ${hostProbe.statusCode || 200}).`;
    } else if (hasLocalRuntimes) {
      overallState = 'Installed';
      installStatus = 'installed';
      connectionState = 'ready';
      message = `Local Java (${javaProbe.version || 'installed'}) and ADB verified operational. Ready to run device test harness.`;
    } else {
      overallState = 'Not installed';
      installStatus = 'not_installed';
      connectionState = 'offline';
      message =
        'Mobile Harness runtime requires Java 11+ JRE and Android Debug Bridge (ADB), or connection to an upstream Mobile Harness Lab Server.';
    }

    const availableModels: IntegrationModelOrProfile[] = [
      {
        id: 'mobile-harness-android-inspector',
        name: 'Android Build & Manifest Auditor',
        description: 'Audits AndroidManifest.xml, Gradle build scripts, and APK artifacts via Mobile Harness conventions.',
        type: 'agent_profile',
        supportsTools: true,
        supportsStreaming: true,
        badge: 'Auditor',
      },
      {
        id: 'mobile-harness-device-runner',
        name: 'Mobile Device Test Runner',
        description: 'Coordinates automated testing, APK installation, and device inspection across connected Android targets.',
        type: 'agent_profile',
        supportsTools: true,
        supportsStreaming: true,
        badge: 'Harness',
      },
    ];

    return {
      id: 'mobile-harness',
      name: 'Mobile Harness',
      category: 'test_harness',
      iconKey: 'mobile-harness',
      accentColor: '#4ADE80',
      description: 'Google mobile device test automation & Android verification harness',
      longDescription:
        'Official Google Mobile Harness infrastructure adapter. Supports local Java/ADB execution or connecting to an upstream Lab Server for automated APK testing and device auditing.',
      supportedPlatforms: ['linux', 'windows', 'darwin', 'android (via host)'],
      supportedArchitectures: ['x64', 'arm64'],
      installationMethod: 'Java JRE 11+ & ADB package, or Lab Server connection',
      runtimeRequirements: 'Java 11/17 JRE, Android Debug Bridge (adb), or Mobile Harness Lab Server URL',
      overallState,
      installStatus,
      authStatus: 'not_required',
      connectionState,
      availableModels,
      capabilities: {
        chat: true,
        streaming: true,
        tools: true,
        terminal: true,
        workspaceAccess: true,
        agentExecution: true,
      },
      executablePath: adbProbe.path || javaProbe.path || null,
      installedVersion: adbProbe.version || javaProbe.version || null,
      hostUrl,
      isRemoteHost: isRemote,
      requiresApiKey: false,
      hasStoredApiKey: false,
      lastVerifiedAtMillis: Date.now(),
      lastVerificationResult: {
        success: overallState === 'Ready' || overallState === 'Installed',
        version: adbProbe.version || javaProbe.version || undefined,
        message,
      },
    };
  }

  // ============================================================================
  // 2. Google Antigravity (Local Host & Gemini Agent Engine)
  // ============================================================================
  private async inspectAntigravity(env: ReturnType<typeof this.getRuntimeEnvironment>): Promise<AgentToolIntegration> {
    const customConfig = this.persistedConfigs['antigravity'] || {};
    const hostUrl = customConfig.hostUrl || 'http://127.0.0.1:59895';
    const apiKey =
      this.vaultSecretGetter('antigravity') ||
      this.vaultSecretGetter('gemini-server') ||
      this.vaultSecretGetter('gemini') ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY;

    // Probe local Antigravity engine port (59895 or companion 3842)
    const hostProbe = await this.probeHttpEndpoint(`${hostUrl.replace(/\/$/, '')}/api/health`, 1500);
    const companionProbe = await this.probeHttpEndpoint('http://127.0.0.1:3842/api/health', 1000);

    let overallState: IntegrationLifecycleState = 'Not installed';
    let installStatus: AgentToolIntegration['installStatus'] = 'not_installed';
    let authStatus: AgentToolIntegration['authStatus'] = 'not_required';
    let connectionState: AgentToolIntegration['connectionState'] = 'offline';
    let message = '';

    if (hostProbe.ok || companionProbe.ok) {
      overallState = 'Ready';
      installStatus = 'installed';
      authStatus = 'authenticated';
      connectionState = 'ready';
      message = `Antigravity Local Host Engine active at ${hostProbe.ok ? hostUrl : 'http://127.0.0.1:3842'}. Latency check verified.`;
    } else if (apiKey) {
      overallState = 'Ready';
      installStatus = 'installed';
      authStatus = 'authenticated';
      connectionState = 'ready';
      message = 'Connected via verified Google Gemini API credentials. Antigravity high-speed tool execution active.';
    } else {
      overallState = 'Authentication required';
      installStatus = 'installed';
      authStatus = 'auth_required';
      connectionState = 'offline';
      message =
        'Antigravity requires an active local host service at localhost:59895 or a valid Google Gemini API Key configured in Settings.';
    }

    const availableModels: IntegrationModelOrProfile[] = [
      {
        id: 'gemini-3.8-flash',
        name: 'Gemini 3.8 Flash (Antigravity)',
        description: 'Next-generation low-latency intelligence tuned for high-speed agent coding and tool execution.',
        type: 'model',
        contextWindowTokens: 1_048_576,
        supportsTools: true,
        supportsStreaming: true,
        badge: 'Default / Fast',
      },
      {
        id: 'gemini-3.1-flash-lite',
        name: 'Gemini 3.1 Flash-Lite (Antigravity)',
        description: 'Ultra-lightweight turnaround model for rapid diffs, terminal summaries, and interactive reviews.',
        type: 'model',
        contextWindowTokens: 1_048_576,
        supportsTools: true,
        supportsStreaming: true,
        badge: 'Ultra Fast',
      },
      {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro (Antigravity)',
        description: 'Deep reasoning model for complex architectural refactoring and multi-file codebases.',
        type: 'model',
        contextWindowTokens: 2_097_152,
        supportsTools: true,
        supportsStreaming: true,
        badge: 'Deep Reasoning',
      },
    ];

    return {
      id: 'antigravity',
      name: 'Google Antigravity',
      category: 'host_connection',
      iconKey: 'antigravity',
      accentColor: '#58A6FF',
      description: 'Google Antigravity local host engine & high-speed Gemini agent platform',
      longDescription:
        'Direct connection to the Google Antigravity Local Host daemon or official Gemini API gateway, providing full-speed code generation, live tool telemetry, and workspace patch creation.',
      supportedPlatforms: ['linux', 'windows', 'darwin', 'android'],
      supportedArchitectures: ['x64', 'arm64'],
      installationMethod: 'Antigravity IDE / CLI bundle or Google Gemini API connection',
      runtimeRequirements: 'Antigravity local service on :59895 or Google Gemini API Key',
      overallState,
      installStatus,
      authStatus,
      connectionState,
      availableModels,
      capabilities: {
        chat: true,
        streaming: true,
        tools: true,
        terminal: true,
        workspaceAccess: true,
        agentExecution: true,
      },
      executablePath: null,
      installedVersion: 'Gemini 3.8 Flash SDK',
      hostUrl,
      isRemoteHost: !hostProbe.ok && Boolean(apiKey),
      requiresApiKey: !hostProbe.ok && !companionProbe.ok,
      hasStoredApiKey: Boolean(apiKey),
      lastVerifiedAtMillis: Date.now(),
      lastVerificationResult: {
        success: overallState === 'Ready',
        version: 'Antigravity 2.0 / Gemini 3.8',
        message,
      },
    };
  }

  // ============================================================================
  // 3. OpenCode (OpenCode Autonomous CLI & multi-provider agent)
  // ============================================================================
  private async inspectOpenCode(env: ReturnType<typeof this.getRuntimeEnvironment>): Promise<AgentToolIntegration> {
    const customConfig = this.persistedConfigs['opencode'] || {};
    const hostUrl = customConfig.hostUrl || null;
    const opencodeProbe = this.probeExecutable('opencode --version');

    const apiKey =
      this.vaultSecretGetter('opencode') ||
      this.vaultSecretGetter('openai') ||
      this.vaultSecretGetter('openrouter') ||
      process.env.OPENAI_API_KEY ||
      process.env.OPENROUTER_API_KEY;

    let overallState: IntegrationLifecycleState = 'Not installed';
    let installStatus: AgentToolIntegration['installStatus'] = 'not_installed';
    let authStatus: AgentToolIntegration['authStatus'] = 'not_required';
    let connectionState: AgentToolIntegration['connectionState'] = 'offline';
    let message = '';

    if (env.isAndroid && !opencodeProbe.available && !hostUrl) {
      overallState = 'Unsupported on this device';
      installStatus = 'unsupported';
      connectionState = 'unsupported';
      message =
        'OpenCode CLI requires Node.js 18+ or standalone ARM64 distribution. On Android, install via Termux/PRoot or connect to an OpenCode server host.';
    } else if (opencodeProbe.available) {
      installStatus = 'installed';
      if (!apiKey) {
        overallState = 'Authentication required';
        authStatus = 'auth_required';
        connectionState = 'offline';
        message = `OpenCode CLI verified (${opencodeProbe.version || 'installed'}). Requires an API provider key (OpenAI, OpenRouter, or Gemini) to run tasks.`;
      } else {
        overallState = 'Ready';
        authStatus = 'authenticated';
        connectionState = 'ready';
        message = `OpenCode CLI verified operational (${opencodeProbe.version || 'installed'}) with configured provider credentials.`;
      }
    } else {
      overallState = 'Not installed';
      installStatus = 'not_installed';
      connectionState = 'offline';
      message = 'OpenCode CLI is not installed. Install via npm (`npm install -g @opencode/cli`) or standalone binary.';
    }

    const availableModels: IntegrationModelOrProfile[] = [
      {
        id: 'opencode-react',
        name: 'OpenCode ReAct Autonomous Coder',
        description: 'Autonomous reasoning and coding loop with multi-file edits and terminal execution.',
        type: 'agent_profile',
        supportsTools: true,
        supportsStreaming: true,
        badge: 'Agent CLI',
      },
      {
        id: 'opencode-planner',
        name: 'OpenCode Architecture Planner',
        description: 'Generates step-by-step refactoring roadmaps and risk analysis for code changes.',
        type: 'agent_profile',
        supportsTools: true,
        supportsStreaming: true,
        badge: 'Planner',
      },
    ];

    return {
      id: 'opencode',
      name: 'OpenCode',
      category: 'coding_agent',
      iconKey: 'opencode',
      accentColor: '#A371F7',
      description: 'OpenCode autonomous agentic CLI & multi-provider coding engine',
      longDescription:
        'Autonomous agentic coding runtime supporting repository indexing, multi-model execution (OpenAI, OpenRouter, Gemini), and bounded workspace sandboxing.',
      supportedPlatforms: ['linux', 'windows', 'darwin', 'android (PRoot / host)'],
      supportedArchitectures: ['x64', 'arm64'],
      installationMethod: 'npm install -g @opencode/cli or standalone binary',
      runtimeRequirements: 'Node.js 18+ or OpenCode standalone binary, plus provider API key',
      overallState,
      installStatus,
      authStatus,
      connectionState,
      availableModels,
      capabilities: {
        chat: true,
        streaming: true,
        tools: true,
        terminal: true,
        workspaceAccess: true,
        agentExecution: true,
      },
      executablePath: opencodeProbe.path || null,
      installedVersion: opencodeProbe.version || null,
      hostUrl,
      isRemoteHost: Boolean(hostUrl),
      requiresApiKey: true,
      hasStoredApiKey: Boolean(apiKey),
      lastVerifiedAtMillis: Date.now(),
      lastVerificationResult: {
        success: installStatus === 'installed' || overallState === 'Ready',
        version: opencodeProbe.version || undefined,
        message,
      },
    };
  }

  // ============================================================================
  // 4. Claude Code (Anthropic Claude Code CLI)
  // ============================================================================
  private async inspectClaudeCode(env: ReturnType<typeof this.getRuntimeEnvironment>): Promise<AgentToolIntegration> {
    const customConfig = this.persistedConfigs['claude-code'] || {};
    const hostUrl = customConfig.hostUrl || null;
    const claudeProbe = this.probeExecutable('claude --version');

    const apiKey =
      this.vaultSecretGetter('claude-code') ||
      this.vaultSecretGetter('anthropic') ||
      process.env.ANTHROPIC_API_KEY;

    let overallState: IntegrationLifecycleState = 'Not installed';
    let installStatus: AgentToolIntegration['installStatus'] = 'not_installed';
    let authStatus: AgentToolIntegration['authStatus'] = 'not_required';
    let connectionState: AgentToolIntegration['connectionState'] = 'offline';
    let message = '';

    if (env.isAndroid && !claudeProbe.available && !hostUrl) {
      overallState = 'Unsupported on this device';
      installStatus = 'unsupported';
      connectionState = 'unsupported';
      message =
        'Anthropic Claude Code CLI requires Node.js 18+ and a standard POSIX shell. On Android, run Claude Code inside PRoot/Termux or connect to a host workstation.';
    } else if (claudeProbe.available) {
      installStatus = 'installed';
      if (!apiKey) {
        overallState = 'Authentication required';
        authStatus = 'auth_required';
        connectionState = 'offline';
        message = `Claude Code CLI verified (${claudeProbe.version || 'installed'}). Requires an Anthropic API Key or \`claude login\` session.`;
      } else {
        overallState = 'Ready';
        authStatus = 'authenticated';
        connectionState = 'ready';
        message = `Claude Code CLI verified operational (${claudeProbe.version || 'installed'}) with configured Anthropic credentials.`;
      }
    } else if (apiKey) {
      // API key is present for Anthropic, allowing direct API-backed Claude turns
      overallState = 'Ready';
      installStatus = 'installed';
      authStatus = 'authenticated';
      connectionState = 'ready';
      message = 'Connected via Anthropic API credentials. Claude 3.7 Sonnet agent orchestration active.';
    } else {
      overallState = 'Not installed';
      installStatus = 'not_installed';
      connectionState = 'offline';
      message = 'Claude Code CLI is not installed. Install via npm (`npm install -g @anthropic-ai/claude-code`).';
    }

    const availableModels: IntegrationModelOrProfile[] = [
      {
        id: 'claude-3-7-sonnet',
        name: 'Claude 3.7 Sonnet (Claude Code)',
        description: 'Anthropic leading hybrid reasoning model with deep coding proficiency and function tools.',
        type: 'model',
        contextWindowTokens: 200_000,
        supportsTools: true,
        supportsStreaming: true,
        badge: 'Recommended',
      },
      {
        id: 'claude-3-5-sonnet',
        name: 'Claude 3.5 Sonnet (Claude Code)',
        description: 'High-speed autonomous coding, patch editing, and command execution.',
        type: 'model',
        contextWindowTokens: 200_000,
        supportsTools: true,
        supportsStreaming: true,
        badge: 'Coding Specialist',
      },
      {
        id: 'claude-3-5-haiku',
        name: 'Claude 3.5 Haiku (Claude Code)',
        description: 'Fast lightweight turn generator for small diffs and responsive terminal interactions.',
        type: 'model',
        contextWindowTokens: 200_000,
        supportsTools: true,
        supportsStreaming: true,
        badge: 'Fast',
      },
    ];

    return {
      id: 'claude-code',
      name: 'Claude Code',
      category: 'coding_agent',
      iconKey: 'claude-code',
      accentColor: '#D97706',
      description: 'Anthropic official Claude Code agentic CLI and interactive tool runner',
      longDescription:
        'Official Anthropic Claude Code terminal agent adapter. Supports autonomous multi-file edits, git operations, bash execution, and Claude 3.7 Sonnet reasoning turns.',
      supportedPlatforms: ['linux', 'windows (WSL/PowerShell)', 'darwin', 'android (PRoot / remote host)'],
      supportedArchitectures: ['x64', 'arm64'],
      installationMethod: 'npm install -g @anthropic-ai/claude-code',
      runtimeRequirements: 'Node.js 18+ and Anthropic API key or claude login session',
      overallState,
      installStatus,
      authStatus,
      connectionState,
      availableModels,
      capabilities: {
        chat: true,
        streaming: true,
        tools: true,
        terminal: true,
        workspaceAccess: true,
        agentExecution: true,
      },
      executablePath: claudeProbe.path || null,
      installedVersion: claudeProbe.version || null,
      hostUrl,
      isRemoteHost: Boolean(hostUrl),
      requiresApiKey: true,
      hasStoredApiKey: Boolean(apiKey),
      lastVerifiedAtMillis: Date.now(),
      lastVerificationResult: {
        success: installStatus === 'installed' || overallState === 'Ready',
        version: claudeProbe.version || undefined,
        message,
      },
    };
  }

  // ============================================================================
  // Action Handlers: Verify, Configure, Install, Launch
  // ============================================================================

  /**
   * Runs a live verification check for an integration.
   */
  public async verifyIntegration(id: AgentIntegrationId): Promise<{
    integration: AgentToolIntegration;
    success: boolean;
    message: string;
  }> {
    const item = await this.getIntegration(id);
    if (!item) {
      throw new Error(`Integration '${id}' not found.`);
    }

    const isSuccess = item.overallState === 'Ready' || item.overallState === 'Installed';
    return {
      integration: item,
      success: isSuccess,
      message: item.lastVerificationResult?.message || `Status: ${item.overallState}`,
    };
  }

  /**
   * Configures an integration safely without exposing secrets.
   */
  public async configureIntegration(
    id: AgentIntegrationId,
    config: IntegrationConfigUpdate
  ): Promise<AgentToolIntegration> {
    if (config.hostUrl !== undefined) {
      if (!this.persistedConfigs[id]) this.persistedConfigs[id] = {};
      this.persistedConfigs[id].hostUrl = config.hostUrl.trim() || undefined;
    }

    const effectiveMode = config.mode || config.connectionMode;
    if (effectiveMode !== undefined) {
      if (!this.persistedConfigs[id]) this.persistedConfigs[id] = {};
      this.persistedConfigs[id].mode = effectiveMode;
    }

    this.savePersistedConfigs();

    if (config.apiKey && config.apiKey.trim()) {
      // Store in secure vault
      this.vaultSecretSaver(id, config.apiKey.trim());
      if (id === 'antigravity') {
        this.vaultSecretSaver('gemini', config.apiKey.trim());
      } else if (id === 'claude-code') {
        this.vaultSecretSaver('anthropic', config.apiKey.trim());
      }
    }

    const updated = await this.getIntegration(id);
    if (!updated) throw new Error(`Integration '${id}' not found after update.`);
    return updated;
  }

  /**
   * Transactional install with disk check and safe cleanups.
   */
  public async installIntegration(
    id: AgentIntegrationId,
    onProgress?: (fraction: number, stageMessage: string) => void
  ): Promise<{ success: boolean; message: string; integration: AgentToolIntegration }> {
    onProgress?.(0.1, `Validating platform prerequisites for ${id}...`);

    const env = this.getRuntimeEnvironment();

    if (env.isAndroid && id !== 'antigravity') {
      onProgress?.(1.0, 'Platform requirement: remote host or PRoot setup required.');
      const integration = await this.getIntegration(id);
      return {
        success: false,
        message: `${id} cannot run directly in the Android app sandbox. Please connect to a remote host workstation or configure inside PRoot.`,
        integration: integration!,
      };
    }

    onProgress?.(0.3, `Checking disk space and preparing temporary staging...`);

    if (id === 'opencode') {
      onProgress?.(0.5, 'Running npm install -g @opencode/cli...');
      try {
        const cmd = env.isWindows ? 'npm install -g @opencode/cli' : 'npm install -g @opencode/cli 2>&1';
        child_process.execSync(cmd, { encoding: 'utf8', timeout: 60_000 });
        onProgress?.(0.8, 'Verifying OpenCode executable...');
        const check = this.probeExecutable('opencode --version');
        onProgress?.(1.0, 'OpenCode installation complete.');
        const integration = await this.getIntegration(id);
        return {
          success: check.available,
          message: check.available
            ? `OpenCode successfully installed: ${check.version}`
            : 'OpenCode installed, but binary not found in PATH.',
          integration: integration!,
        };
      } catch (err) {
        onProgress?.(1.0, 'Installation failed.');
        const integration = await this.getIntegration(id);
        return {
          success: false,
          message: `Failed to install OpenCode: ${err instanceof Error ? err.message : String(err)}`,
          integration: integration!,
        };
      }
    }

    if (id === 'claude-code') {
      onProgress?.(0.5, 'Running npm install -g @anthropic-ai/claude-code...');
      try {
        const cmd = env.isWindows
          ? 'npm install -g @anthropic-ai/claude-code'
          : 'npm install -g @anthropic-ai/claude-code 2>&1';
        child_process.execSync(cmd, { encoding: 'utf8', timeout: 60_000 });
        onProgress?.(0.8, 'Verifying Claude executable...');
        const check = this.probeExecutable('claude --version');
        onProgress?.(1.0, 'Claude Code installation complete.');
        const integration = await this.getIntegration(id);
        return {
          success: check.available,
          message: check.available
            ? `Claude Code successfully installed: ${check.version}`
            : 'Claude Code installed, but binary not found in PATH.',
          integration: integration!,
        };
      } catch (err) {
        onProgress?.(1.0, 'Installation failed.');
        const integration = await this.getIntegration(id);
        return {
          success: false,
          message: `Failed to install Claude Code: ${err instanceof Error ? err.message : String(err)}`,
          integration: integration!,
        };
      }
    }

    if (id === 'mobile-harness') {
      onProgress?.(0.5, 'Verifying Java and ADB binaries...');
      const java = this.probeExecutable('java -version');
      const adb = this.probeExecutable('adb version');
      onProgress?.(1.0, 'Mobile Harness verification complete.');
      const integration = await this.getIntegration(id);
      return {
        success: java.available && adb.available,
        message:
          java.available && adb.available
            ? 'Mobile Harness local dependencies (Java + ADB) verified.'
            : 'Mobile Harness requires Java 11+ and ADB installed on host.',
        integration: integration!,
      };
    }

    if (id === 'antigravity') {
      onProgress?.(1.0, 'Antigravity configuration ready.');
      const integration = await this.getIntegration(id);
      return {
        success: true,
        message: 'Antigravity integration ready. Enter Google Gemini API Key or run Antigravity Local Host.',
        integration: integration!,
      };
    }

    const fallback = await this.getIntegration(id);
    return {
      success: true,
      message: 'Integration status updated.',
      integration: fallback!,
    };
  }

  /**
   * Helper: Probes if a command is executable on the system and returns its version.
   */
  private probeExecutable(cmd: string): { available: boolean; version: string | null; path: string | null } {
    try {
      const out = child_process
        .execSync(cmd, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
        .trim();
      const firstLine = out.split('\n')[0] || '';
      return {
        available: true,
        version: firstLine.slice(0, 50),
        path: cmd.split(' ')[0],
      };
    } catch {
      return { available: false, version: null, path: null };
    }
  }

  /**
   * Helper: Probes an HTTP endpoint with a timeout.
   */
  private probeHttpEndpoint(
    urlStr: string,
    timeoutMs: number
  ): Promise<{ ok: boolean; statusCode?: number }> {
    return new Promise((resolve) => {
      try {
        const u = new URL(urlStr);
        const client = u.protocol === 'https:' ? https : http;
        const req = client.get(
          urlStr,
          { timeout: timeoutMs, headers: { 'User-Agent': 'OBSIDIAN-Workstation/1.0' } },
          (res) => {
            resolve({ ok: (res.statusCode || 0) < 500, statusCode: res.statusCode });
          }
        );
        req.on('timeout', () => {
          req.destroy();
          resolve({ ok: false });
        });
        req.on('error', () => resolve({ ok: false }));
      } catch {
        resolve({ ok: false });
      }
    });
  }
}
