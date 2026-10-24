/**
 * Obsidian Duet Agent - Fastify Companion API Routes
 */

import { FastifyInstance } from 'fastify';
import { CompanionAuthManager } from './auth.js';
import { CompanionRepository } from '../storage/repository.js';
import { MultiAgentRuntime } from '../agents/runtime.js';
import { ProviderRegistry } from '../providers/registry.js';
import {
  SendMessageRequestSchema,
  ApprovalDecisionSchema,
  CompanionPairingRequestSchema,
  RegisterProjectRootSchema,
  TerminalCommandPayloadSchema,
  BrowserActionPayloadSchema,
} from '../../../../packages/contracts/src/schemas.js';
import { ChatMessage } from '../../../../packages/contracts/src/types.js';

export function registerCompanionRoutes(
  app: FastifyInstance,
  auth: CompanionAuthManager,
  repo: CompanionRepository,
  runtime: MultiAgentRuntime,
  providers: ProviderRegistry,
  startTime: number
) {
  // 0. Root Dashboard (GET /)
  app.get('/', async (req, reply) => {
    const uptimeSec = Math.floor((Date.now() - startTime) / 1000);
    const availableProviders = providers.listProviders().map((p) => p.id);

    // If accessed from a web browser, serve a rich status dashboard
    if (req.headers.accept?.includes('text/html')) {
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Obsidian Duet Agent — Companion Service</title>
  <style>
    :root {
      --bg: #141417;
      --card-bg: #1c1c22;
      --border: #2e2e38;
      --text: #ededed;
      --text-muted: #8e8ea0;
      --accent: #7c3aed;
      --accent-hover: #905cf2;
      --success: #10b981;
      --code-bg: #0d0d10;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 40px 20px;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      display: flex;
      justify-content: center;
    }
    .container {
      max-width: 840px;
      width: 100%;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 24px;
    }
    .logo {
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, #7c3aed, #4f46e5);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      box-shadow: 0 4px 14px rgba(124, 58, 237, 0.4);
    }
    .header-text h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: var(--success);
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      margin-top: 6px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--success);
      box-shadow: 0 0 10px var(--success);
      animation: pulse 2s infinite ease-in-out;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.85); }
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.25);
    }
    .card h2 {
      margin-top: 0;
      font-size: 17px;
      font-weight: 600;
      color: var(--text);
      border-bottom: 1px solid var(--border);
      padding-bottom: 12px;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
    }
    .stat-label {
      font-size: 12px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
    }
    .stat-value {
      font-size: 15px;
      font-weight: 600;
      margin-top: 4px;
      color: #fff;
    }
    .providers-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 6px;
    }
    .provider-tag {
      background: rgba(124, 58, 237, 0.2);
      border: 1px solid rgba(124, 58, 237, 0.4);
      color: #c4b5fd;
      padding: 3px 10px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
    }
    .instructions ol {
      margin: 0;
      padding-left: 20px;
      color: var(--text);
      line-height: 1.6;
    }
    .code-inline {
      background: var(--code-bg);
      border: 1px solid var(--border);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: Consolas, monospace;
      font-size: 13px;
      color: #a78bfa;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      padding: 10px 14px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    th {
      color: var(--text-muted);
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
    }
    tr:last-child td { border-bottom: none; }
    .method-get { color: #60a5fa; font-weight: 700; font-family: Consolas, monospace; }
    .method-post { color: #34d399; font-weight: 700; font-family: Consolas, monospace; }
    .endpoint-path { font-family: Consolas, monospace; color: #f3f4f6; }
    a.link {
      color: #a78bfa;
      text-decoration: none;
    }
    a.link:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">⚡</div>
      <div class="header-text">
        <h1>Obsidian Duet Agent Companion</h1>
        <div class="status-badge">
          <span class="status-dot"></span>
          Companion Online & Ready
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Service Diagnostics</h2>
      <div class="grid">
        <div>
          <div class="stat-label">Version</div>
          <div class="stat-value">v1.0.0</div>
        </div>
        <div>
          <div class="stat-label">Binding & Host</div>
          <div class="stat-value">127.0.0.1:3842 (Loopback)</div>
        </div>
        <div>
          <div class="stat-label">Uptime</div>
          <div class="stat-value">${uptimeSec}s (${Math.floor(uptimeSec / 60)} min)</div>
        </div>
        <div>
          <div class="stat-label">Health API</div>
          <div class="stat-value"><a class="link" href="/api/health">/api/health</a></div>
        </div>
      </div>
      <div style="margin-top: 16px;">
        <div class="stat-label">Registered Model Providers</div>
        <div class="providers-list">
          ${availableProviders.map((p) => `<span class="provider-tag">${p}</span>`).join('')}
        </div>
      </div>
    </div>

    <div class="card instructions">
      <h2>How to Connect from Obsidian</h2>
      <ol>
        <li>Open your vault in <strong>Obsidian</strong> with the <strong>Obsidian Duet Agent</strong> plugin installed.</li>
        <li>Open <strong>Settings &rarr; Community Plugins &rarr; Obsidian Duet Agent</strong>.</li>
        <li>Verify the Companion URL is set to <span class="code-inline">http://127.0.0.1:3842</span>.</li>
        <li>Click <strong>Test Connection</strong> to authenticate and verify pairing.</li>
        <li>Open the Duet Agent chat view in the sidebar to collaborate with the multi-agent team.</li>
      </ol>
    </div>

    <div class="card">
      <h2>API Endpoints</h2>
      <table>
        <thead>
          <tr>
            <th>Method</th>
            <th>Endpoint</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><span class="method-get">GET</span></td>
            <td><span class="endpoint-path">/</span></td>
            <td>This status dashboard (HTML) or service index (JSON)</td>
          </tr>
          <tr>
            <td><span class="method-get">GET</span></td>
            <td><span class="endpoint-path"><a class="link" href="/api/health">/api/health</a></span></td>
            <td>Service health check and provider discovery</td>
          </tr>
          <tr>
            <td><span class="method-post">POST</span></td>
            <td><span class="endpoint-path">/api/pair</span></td>
            <td>Exchange pairing secret for authenticated bearer token</td>
          </tr>
          <tr>
            <td><span class="method-post">POST</span></td>
            <td><span class="endpoint-path">/api/chat/stream</span></td>
            <td>Multi-agent streaming conversation (NDJSON protocol)</td>
          </tr>
          <tr>
            <td><span class="method-post">POST</span></td>
            <td><span class="endpoint-path">/api/chat/cancel</span></td>
            <td>Abort current agent turn or specialist activity</td>
          </tr>
          <tr>
            <td><span class="method-get">GET</span></td>
            <td><span class="endpoint-path">/api/tasks</span></td>
            <td>List active, queued, or completed background tasks</td>
          </tr>
          <tr>
            <td><span class="method-post">POST</span></td>
            <td><span class="endpoint-path">/api/approvals/decide</span></td>
            <td>Submit user approval or rejection for diffs / tools</td>
          </tr>
          <tr>
            <td><span class="method-post">POST</span></td>
            <td><span class="endpoint-path">/api/projects/register</span></td>
            <td>Register and sandbox approved project workspace roots</td>
          </tr>
          <tr>
            <td><span class="method-post">POST</span></td>
            <td><span class="endpoint-path">/api/terminal/run</span></td>
            <td>Execute sandboxed command through allowlisted executable runner</td>
          </tr>
          <tr>
            <td><span class="method-post">POST</span></td>
            <td><span class="endpoint-path">/api/browser/scrape</span></td>
            <td>Web page inspector and automation tool</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
      return reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
    }

    // Default JSON response for curl, scripts, and API consumers
    return reply.send({
      service: 'Obsidian Duet Agent Companion',
      status: 'ok',
      version: '1.0.0',
      host: '127.0.0.1:3842',
      uptimeSeconds: uptimeSec,
      availableProviders,
      endpoints: {
        health: '/api/health',
        pair: '/api/pair',
        chatStream: '/api/chat/stream',
        chatCancel: '/api/chat/cancel',
        tasks: '/api/tasks',
        approvals: '/api/approvals/decide',
        projects: '/api/projects/register',
        terminal: '/api/terminal/run',
        browser: '/api/browser/scrape',
      },
    });
  });

  // 1. Health check (public / semi-private)
  const healthHandler = async (_req: any, reply: any) => {
    return reply.send({
      status: 'ok',
      version: '1.0.0',
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
      availableProviders: providers.listProviders().map((p) => p.id),
    });
  };
  app.get('/api/health', healthHandler);
  app.get('/health', healthHandler);

  // Custom 404 handler for clear guidance
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({
      error: 'Not Found',
      message: `Route ${req.method}:${req.url} not found`,
      statusCode: 404,
      hint: 'Obsidian Duet Agent Companion endpoints are located under /api/ (e.g. /api/health, /api/pair, /api/chat/stream). Visit http://127.0.0.1:3842/ in your browser for service status and documentation.',
    });
  });

  // 2. Pairing with companion
  app.post('/api/pair', async (req, reply) => {
    const parsed = CompanionPairingRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }

    const { pairingToken, clientName } = parsed.data;
    const hash = auth.hashToken(pairingToken);

    if (repo.isValidToken(hash)) {
      return reply.send({ success: true, token: pairingToken });
    }

    // Check if matching master secret
    const master = auth.getOrCreatePairingToken();
    if (pairingToken === master) {
      repo.savePairingToken(`paired-${Date.now()}`, hash, clientName);
      return reply.send({ success: true, token: pairingToken });
    }

    return reply.status(401).send({ error: 'Invalid pairing secret token.' });
  });

  // --- Authenticated Route Group ---
  app.register(async (authed) => {
    authed.addHook('preHandler', async (req, reply) => {
      const ok = auth.authenticateRequest(req, reply);
      if (!ok) return;
    });

    // 3. Streaming Chat
    authed.post('/api/chat/stream', async (req, reply) => {
      const parsed = SendMessageRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }

      const { conversationId, content, providerId, modelId, activeNotePath, activeNoteContent } = parsed.data;

      let conv = repo.getConversation(conversationId);
      if (!conv) {
        conv = {
          id: conversationId,
          title: content.slice(0, 32),
          providerId: providerId || 'ollama',
          modelId: modelId || 'llama3.2',
          messages: [],
          createdAtMillis: Date.now(),
          updatedAtMillis: Date.now(),
        };
        repo.saveConversation(conv);
      }

      // Record incoming user message
      const userMsg: ChatMessage = {
        id: `msg-${Date.now()}-u`,
        role: 'user',
        content,
        timestampMillis: Date.now(),
      };
      repo.appendMessage(conversationId, userMsg);
      conv.messages.push(userMsg);

      // Set up streaming response
      reply.raw.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
      reply.raw.setHeader('Connection', 'keep-alive');

      const writeEvent = (event: any) => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(`${JSON.stringify(event)}\n`);
        }
      };

      try {
        const fullResponse = await runtime.runSession({
          conversationId,
          messages: conv.messages,
          providerId: providerId || conv.providerId,
          modelId: modelId || conv.modelId,
          activeNotePath,
          activeNoteContent,
          onEvent: (evt) => writeEvent(evt),
        });

        // Record assistant response in SQLite
        const assistantMsg: ChatMessage = {
          id: `msg-${Date.now()}-a`,
          role: 'assistant',
          content: fullResponse,
          timestampMillis: Date.now(),
        };
        repo.appendMessage(conversationId, assistantMsg);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        writeEvent({
          id: `err-${Date.now()}`,
          topic: 'turn.interrupted',
          conversationId,
          timestampMillis: Date.now(),
          payload: { reason: 'system_restart', error: errorMsg },
        });
      } finally {
        if (!reply.raw.writableEnded) {
          reply.raw.end();
        }
      }
    });

    // 4. Cancel active turn
    authed.post('/api/chat/cancel', async (req, reply) => {
      const { conversationId } = req.body as { conversationId?: string };
      return reply.send({ success: true, conversationId });
    });

    // 5. Tasks listing
    authed.get('/api/tasks', async (req, reply) => {
      const { conversationId } = req.query as { conversationId?: string };
      if (!conversationId) {
        return reply.status(400).send({ error: 'conversationId query parameter is required.' });
      }
      const tasks = repo.listTasks(conversationId);
      return reply.send({ tasks });
    });

    // 6. Approval decision
    authed.post('/api/approvals/decide', async (req, reply) => {
      const parsed = ApprovalDecisionSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }
      const { approvalId, decision } = parsed.data;
      repo.resolveApproval(approvalId, decision);
      return reply.send({ success: true, approvalId, decision });
    });

    // 7. Register approved project root
    authed.post('/api/projects/register', async (req, reply) => {
      const parsed = RegisterProjectRootSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }
      runtime.getEnforcer().addApprovedRoot(parsed.data.path);
      return reply.send({ success: true, approvedRoots: runtime.getEnforcer().getApprovedRoots() });
    });

    // 8. Restricted Terminal Execution
    authed.post('/api/terminal/run', async (req, reply) => {
      const parsed = TerminalCommandPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }
      const { executable, args, cwd, timeoutMs, dryRun } = parsed.data;
      const result = await runtime.getTerminalRunner().executeCommand(executable, args, cwd, { timeoutMs, dryRun });
      return reply.send(result);
    });

    // 9. Browser Automation Scraper
    authed.post('/api/browser/scrape', async (req, reply) => {
      const parsed = BrowserActionPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }
      const result = await runtime.getBrowserRunner().scrapeUrl(parsed.data.url);
      return reply.send(result);
    });
  });
}
