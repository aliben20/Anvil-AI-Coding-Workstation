# Model Context Protocol (MCP) Audit & Architecture Report (`MCP_AUDIT.md`)

## A. Complete Inventory of Configured MCP Servers

All configured MCP servers in `.anvil-data/mcp_servers.json` were audited and probed against the repaired `McpConnectionManager`:

| Server ID | Server Name | Endpoint / Command | Transport | Auth Method & RFC 9728 Discovery | Status & Tool Discovery |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `mcp-local-workstation` | **OBSIDIAN Local Workspace MCP Server** | `http://127.0.0.1:3000/api/mcp-loopback` | `streamable-http` (`Mcp-Session-Id`) | `none` (local loopback) | **CONNECTED** · 3 tools (`workspace_git_status`, `android_manifest_inspector`, `gguf_ram_estimator`) |
| `mcp-stdio-system` | **OBSIDIAN Host Diagnostics MCP Server** | `node scripts/obsidian-stdio-mcp.mjs` | `stdio` (`@modelcontextprotocol/sdk`) | `none` / `env` (`OBSIDIAN_STDIO_MODE=production`) | **CONNECTED** · 2 tools (`host_system_metrics`, `workspace_file_digest`) |
| `mcp-1792255429023` | **GitHub Copilot MCP Server** (`gdgdeg`) | `https://api.githubcopilot.com/mcp/` | `streamable-http` | `Bearer` / `OAuth 2.0` (`https://github.com/login/oauth`, RFC 9728 resource: `GitHub MCP Server`, scopes: `repo, read:org, read:user, ...`, no RFC 7591 DCR endpoint) | **AUTH REQUIRED (401)** · Discovered `WWW-Authenticate` + OIDC metadata; ready for GitHub PAT (`ghp_...` / `github_pat_...`) or GitHub OAuth App Client ID + PKCE |
| `mcp-1792256472625` | **Supabase MCP Server** (`99999999`) | `https://mcp.supabase.com/mcp` | `streamable-http` | `OAuth 2.0 PKCE + RFC 7591 DCR` (`https://api.supabase.com`, registration: `https://api.supabase.com/platform/oauth/apps/register`, scopes: `organizations:read, projects:read, database:read, ...`) or `Bearer` PAT (`sbp_...`) | **AUTH REQUIRED (401)** · Discovered `WWW-Authenticate` + RFC 8414 metadata; supports 1-click RFC 7591 Dynamic Client Registration + PKCE popup or Supabase PAT |

---

## B. Root Causes Identified in the Legacy MCP Client

1. **No `initialize` Lifecycle or Session Negotiation**: The previous implementation sent a bare `tools/list` POST request without first performing the mandatory MCP `initialize` $\rightarrow$ `notifications/initialized` handshake or tracking `Mcp-Session-Id`.
2. **Opaque HTTP 401 Failures**: When `https://api.githubcopilot.com/mcp/` or `https://mcp.supabase.com/mcp` returned `HTTP 401`, the legacy client discarded the `WWW-Authenticate` header (`resource_metadata="..."`) and failed with a generic `HTTP 401 from ...` string.
3. **No OAuth 2.0 PKCE, RFC 9728, or RFC 7591 Dynamic Client Registration**: There was no mechanism to discover `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, or `/.well-known/openid-configuration`, nor to register clients dynamically or exchange PKCE authorization codes.
4. **No `stdio` or `sse` Transport Support**: Only single-page HTTP POST was supported, with no `StdioClientTransport`, `SSEClientTransport`, or `nextCursor` pagination.

---

## C. Architecture of the Repaired Shared `McpConnectionManager` (`src/server/mcpConnectionManager.ts`)

1. **Multi-Transport Engine (`@modelcontextprotocol/sdk` v1.32.1)**:
   - **Streamable HTTP**: Negotiates `initialize` (`protocolVersion: "2024-11-05"`), captures and forwards `Mcp-Session-Id`, sends `notifications/initialized`, parses both `application/json` and `text/event-stream` payloads, and automatically falls back to `SSEClientTransport` on HTTP 404/405.
   - **Legacy SSE**: Connects via `SSEClientTransport` with per-server headers.
   - **Local Stdio**: Spawns child MCP servers via `StdioClientTransport` with isolated environment variables and working directory (`scripts/obsidian-stdio-mcp.mjs`).
2. **RFC 9728 & RFC 8414 / OIDC Discovery on HTTP 401**:
   - Parses `WWW-Authenticate` (`resource_metadata`, `scope`, `error`, `error_description`).
   - Resolves Protected Resource Metadata and Authorization Server Metadata (`authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `scopes_supported`).
   - Automatically performs **RFC 7591 Dynamic Client Registration** when supported (verified live with `HTTP 201` against `https://api.supabase.com/platform/oauth/apps/register`).
3. **Strict Per-Server Credential Isolation**:
   - Tokens (`mcp:<serverId>:token`), refresh tokens (`mcp:<serverId>:refresh`), and OAuth client secrets (`mcp:<serverId>:client_secret`) are encrypted via AES-256-GCM in `EncryptedCredentialVault`.
   - `buildRequestHeadersForServer()` enforces strict URL origin matching (`new URL(requestUrl).origin === new URL(server.endpointUrl).origin`), guaranteeing that one server's token is never forwarded to any other server.
4. **Paginated Tool Discovery & Agent Loop Integration**:
   - Follows `nextCursor` pagination across `tools/list` responses.
   - Exposes `POST /api/mcp/:id/call` for interactive UI tool testing and registers `call_mcp_tool` (plus direct discovered MCP tool names) in `BoundedAgentLoopRunner`.
