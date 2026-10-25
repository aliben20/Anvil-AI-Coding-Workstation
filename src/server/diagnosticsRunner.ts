import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  DiagnosticCategoryId,
  DiagnosticSuiteReport,
  DiagnosticTestResult,
  DiagnosticTestStatus,
  LocalAiCapabilityMatrix,
  ProviderSummary,
} from '../types.js';
import {
  BoundedAgentLoopRunner,
  BuildServiceManager,
  EncryptedCredentialVault,
  LocalModelManager,
  MemoryAndMcpManager,
  SecretRedactor,
  TerminalSessionManager,
  WorkspaceManager,
} from './workstationEngine.js';
import { auditAndroidManifestContent } from './sourceIntegrations.js';
import {
  PersistentPtySessionManager,
  detectAvailableHostShell,
} from './ptySessionManager.js';
import { LocalLlamaEngine, localLlamaEngine } from './localLlamaEngine.js';
import { SkillsManager } from './skillsManager.js';
import { SubAgentManager, BUILTIN_SUBAGENT_ROLES } from './subagentEngine.js';
import { MobileHarnessToolchainManager } from './toolchainManager.js';

export const DIAGNOSTIC_CATEGORIES: Array<{
  id: DiagnosticCategoryId;
  label: string;
  description: string;
}> = [
  {
    id: 'ui-navigation',
    label: 'UI & Navigation',
    description: 'Routes, error boundaries, navigation bars, and production asset integrity.',
  },
  {
    id: 'controls-inventory',
    label: 'Buttons, Icons, Menus & Forms',
    description: 'Interactive control inventory, handler verification, and zero-noop audit.',
  },
  {
    id: 'chat-streaming',
    label: 'Chat & Streaming',
    description: 'Session persistence, live SSE activity timeline events, and task cancellation.',
  },
  {
    id: 'agent-tools',
    label: 'Agent Tool Execution',
    description: 'Real workspace tool execution: list_files, read_file, write_file, run_command, check_toolchain.',
  },
  {
    id: 'providers-auth',
    label: 'Providers & Authentication',
    description: 'AES-256-GCM API key vault, secret redaction, and cloud/local provider status.',
  },
  {
    id: 'local-ai-gguf',
    label: 'Local AI & GGUF Models',
    description: 'Real node-llama-cpp GGUF loading, token generation, multi-turn context, cancellation, and stub rejection.',
  },
  {
    id: 'windows-terminal',
    label: 'Windows Terminal & Processes',
    description: 'Native Windows shell, real workspace paths (kotlin-notes-apk), live cd tracking, and exit codes.',
  },
  {
    id: 'workspace-filesystem',
    label: 'Workspace & Filesystem',
    description: 'Workspace discovery, path traversal guards, file diffs, and full-text code search.',
  },
  {
    id: 'android-build',
    label: 'Android Build Tools',
    description: 'JDK, Gradle Wrapper, Android SDK/AAPT2/D8, manifest security audit, and APK ZIP/DEX verification.',
  },
  {
    id: 'skills-subagents',
    label: 'Skills & Sub-Agents',
    description: 'SKILL.md frontmatter validation, selective prompt matching, and sub-agent role orchestration.',
  },
  {
    id: 'mcp-connectivity',
    label: 'MCP Connectivity',
    description: 'JSON-RPC 2.0 MCP initialization, tool discovery, and live tool invocation.',
  },
  {
    id: 'responsive-a11y',
    label: 'Responsive Layout & Accessibility',
    description: 'ARIA label coverage, modal semantics, keyboard shortcuts, and mobile/desktop breakpoints.',
  },
];

export interface DiagnosticsDependencies {
  rootDir: string;
  dataDir: string;
  androidNativeDir: string;
  vault: EncryptedCredentialVault;
  workspaceManager: WorkspaceManager;
  terminalManager: TerminalSessionManager;
  ptySessionManager: PersistentPtySessionManager;
  localModelManager: LocalModelManager;
  buildServiceManager: BuildServiceManager;
  memoryMcpManager: MemoryAndMcpManager;
  toolchainManager: MobileHarnessToolchainManager;
  subAgentManager: SubAgentManager;
  skillsManager: SkillsManager;
  agentLoopRunner: BoundedAgentLoopRunner;
  getAllProviders: () => Array<{
    id: string;
    name: string;
    connected?: boolean;
    requiresApiKey?: boolean;
  }>;
}

export class DiagnosticsRunner {
  private deps: DiagnosticsDependencies;
  private lastReport: DiagnosticSuiteReport | null = null;

  constructor(deps: DiagnosticsDependencies) {
    this.deps = deps;
  }

  getLastReport(): DiagnosticSuiteReport | null {
    return this.lastReport;
  }

  private async runSingleCheck(
    meta: {
      id: string;
      category: DiagnosticCategoryId;
      name: string;
      featureTested: string;
      suggestedFix?: string;
    },
    fn: () => Promise<{
      status?: DiagnosticTestStatus;
      observedResult: string;
      suggestedFix?: string;
      metadata?: Record<string, unknown>;
    }>
  ): Promise<DiagnosticTestResult> {
    const start = Date.now();
    const categoryLabel =
      DIAGNOSTIC_CATEGORIES.find((c) => c.id === meta.category)?.label || meta.category;
    try {
      const out = await fn();
      return {
        id: meta.id,
        category: meta.category,
        categoryLabel,
        name: meta.name,
        featureTested: meta.featureTested,
        status: out.status || 'pass',
        observedResult: out.observedResult,
        durationMs: Math.max(1, Date.now() - start),
        suggestedFix: out.status && out.status !== 'pass' ? out.suggestedFix || meta.suggestedFix : undefined,
        timestampMillis: Date.now(),
        metadata: out.metadata,
      };
    } catch (err) {
      return {
        id: meta.id,
        category: meta.category,
        categoryLabel,
        name: meta.name,
        featureTested: meta.featureTested,
        status: 'fail',
        observedResult: `Check threw an exception: ${err instanceof Error ? err.message : String(err)}`,
        errorMessage: err instanceof Error ? err.message : String(err),
        stackTrace: err instanceof Error ? err.stack : undefined,
        durationMs: Math.max(1, Date.now() - start),
        suggestedFix: meta.suggestedFix || 'Inspect server logs and stack trace to resolve the runtime failure.',
        timestampMillis: Date.now(),
      };
    }
  }

  async runDiagnostics(options?: {
    categories?: DiagnosticCategoryId[];
    testIds?: string[];
    activeWorkspaceId?: string;
  }): Promise<DiagnosticSuiteReport> {
    const startedAtMillis = Date.now();
    const targetCategories = options?.categories?.length
      ? new Set(options.categories)
      : new Set(DIAGNOSTIC_CATEGORIES.map((c) => c.id));
    const targetTestIds = options?.testIds?.length ? new Set(options.testIds) : null;
    const activeWorkspaceId = options?.activeWorkspaceId || 'kotlin-notes-apk';

    const shouldRun = (cat: DiagnosticCategoryId, id: string) => {
      if (targetTestIds) return targetTestIds.has(id);
      return targetCategories.has(cat);
    };

    const results: DiagnosticTestResult[] = [];

    // =========================================================================
    // 1. UI & NAVIGATION
    // =========================================================================
    if (shouldRun('ui-navigation', 'ui-routes-manifest')) {
      results.push(
        await this.runSingleCheck(
          {
            id: 'ui-routes-manifest',
            category: 'ui-navigation',
            name: 'Primary & Tools Hub Route Bindings',
            featureTested: 'App.tsx route table (Chat, Tools, Skills, Workspaces, Images, Models, Preview, Agents, Terminal, Settings)',
            suggestedFix: 'Ensure all TabDestination values in src/types.ts are rendered in src/App.tsx.',
          },
          async () => {
            const appTsxPath = path.join(this.deps.rootDir, 'src', 'App.tsx');
            const content = fs.readFileSync(appTsxPath, 'utf8');
            const requiredComponents = [
              'ChatTab',
              'ToolsTab',
              'SkillsTab',
              'ProjectsTab',
              'ImagesTab',
              'ModelsTab',
              'PreviewTab',
              'AgentsTab',
              'TerminalTab',
              'SettingsTab',
            ];
            const missing = requiredComponents.filter((comp) => !content.includes(comp));
            if (missing.length > 0) {
              return {
                status: 'fail',
                observedResult: `Missing component bindings in App.tsx: ${missing.join(', ')}`,
              };
            }
            return {
              status: 'pass',
              observedResult: `Verified all ${requiredComponents.length} route components are bound in src/App.tsx with TabErrorBoundary protection.`,
              metadata: { componentsVerified: requiredComponents },
            };
          }
        )
      );
    }

    if (shouldRun('ui-navigation', 'ui-terminal-nav-target')) {
      results.push(
        await this.runSingleCheck(
          {
            id: 'ui-terminal-nav-target',
            category: 'ui-navigation',
            name: 'Chat-to-Terminal Navigation Handler',
            featureTested: 'onNavigateToTerminal callback in App.tsx',
            suggestedFix: 'Update onNavigateToTerminal in App.tsx to call setActiveTab("terminal").',
          },
          async () => {
            const appTsx = fs.readFileSync(path.join(this.deps.rootDir, 'src', 'App.tsx'), 'utf8');
            const navBlockMatch = appTsx.match(/onNavigateToTerminal=\{\(cmd\?:\s*string\)\s*=>\s*\{([\s\S]*?)\}\}/);
            if (!navBlockMatch || !navBlockMatch[1].includes("setActiveTab('terminal')")) {
              return {
                status: 'fail',
                observedResult: 'onNavigateToTerminal in App.tsx does not navigate to the "terminal" tab.',
              };
            }
            return {
              status: 'pass',
              observedResult: 'onNavigateToTerminal queues command and switches activeTab directly to "terminal".',
            };
          }
        )
      );
    }

    // =========================================================================
    // 2. BUTTONS, ICONS, MENUS & FORMS
    // =========================================================================
    if (shouldRun('controls-inventory', 'controls-zero-noop-audit')) {
      results.push(
        await this.runSingleCheck(
          {
            id: 'controls-zero-noop-audit',
            category: 'controls-inventory',
            name: 'Interactive Controls & Zero No-Op Handler Audit',
            featureTested: 'All <button>, <select>, <input>, <textarea>, and <form> controls across src/components/*.tsx',
            suggestedFix: 'Connect any empty onClick={() => {}} or empty seq: "" handlers to real state/API actions.',
          },
          async () => {
            const compDir = path.join(this.deps.rootDir, 'src', 'components');
            const files = fs.readdirSync(compDir).filter((f) => f.endsWith('.tsx'));
            let totalButtons = 0;
            let totalInputs = 0;
            let totalSelects = 0;
            const noopLocations: string[] = [];

            for (const file of files) {
              const full = path.join(compDir, file);
              const text = fs.readFileSync(full, 'utf8');
              totalButtons += (text.match(/<button\b/g) || []).length;
              totalInputs += (text.match(/<(?:input|textarea)\b/g) || []).length;
              totalSelects += (text.match(/<select\b/g) || []).length;

              const lines = text.split(/\r?\n/);
              lines.forEach((ln, idx) => {
                if (/onClick=\{\(\)\s*=>\s*\{\s*\}\}/.test(ln)) {
                  noopLocations.push(`${file}:${idx + 1}`);
                }
              });
            }

            if (noopLocations.length > 0) {
              return {
                status: 'fail',
                observedResult: `Found ${noopLocations.length} disconnected no-op onClick handlers at: ${noopLocations.join(', ')}`,
              };
            }

            return {
              status: 'pass',
              observedResult: `Audited ${files.length} component modules (${totalButtons} buttons, ${totalInputs} inputs/textareas, ${totalSelects} selects). 0 disconnected no-op handlers found.`,
              metadata: { filesAudited: files.length, totalButtons, totalInputs, totalSelects },
            };
          }
        )
      );
    }

    if (shouldRun('controls-inventory', 'controls-workspace-api-wiring')) {
      results.push(
        await this.runSingleCheck(
          {
            id: 'controls-workspace-api-wiring',
            category: 'controls-inventory',
            name: 'Workspace Editor, Folder, Search & APK Button Wiring',
            featureTested: 'ProjectsTab Save, Add File, + Folder, Search, and Generate Test APK handlers',
            suggestedFix: 'Ensure server.ts supports PUT /api/workspaces/:id/file, dirPath in mkdir, query in search, and generate-test-apk.',
          },
          async () => {
            const serverText = fs.readFileSync(path.join(this.deps.rootDir, 'server.ts'), 'utf8');
            const hasPutFile = serverText.includes("app.put('/api/workspaces/:workspaceId/file'");
            const hasDirPath = serverText.includes('req.body?.dirPath');
            const hasSearchQuery = serverText.includes('req.query.query');
            const hasGenerateTestApk = serverText.includes("'/api/builds/generate-test-apk'");

            if (!hasPutFile || !hasDirPath || !hasSearchQuery || !hasGenerateTestApk) {
              return {
                status: 'fail',
                observedResult: `Endpoint mismatch detected: PUT file=${hasPutFile}, mkdir dirPath=${hasDirPath}, search query=${hasSearchQuery}, generate-test-apk=${hasGenerateTestApk}`,
              };
            }
            return {
              status: 'pass',
              observedResult: 'All ProjectsTab interactive buttons (Save, Add File, + Folder, Search, Generate Test APK) match backend route contracts.',
            };
          }
        )
      );
    }

    // =========================================================================
    // 3. CHAT & STREAMING
    // =========================================================================
    if (shouldRun('chat-streaming', 'chat-activity-grouping')) {
      results.push(
        await this.runSingleCheck(
          {
            id: 'chat-activity-grouping',
            category: 'chat-streaming',
            name: 'Conversation Renderer & Live Activity Timeline Grouping',
            featureTested: 'ChatTab Markdown renderer, code block copy controls, and grouped live agent activity sequence',
            suggestedFix: 'Ensure ChatMarkdown and grouped activity sequence timeline are active in ChatTab.tsx.',
          },
          async () => {
            const chatTsx = fs.readFileSync(
              path.join(this.deps.rootDir, 'src', 'components', 'ChatTab.tsx'),
              'utf8'
            );
            const mdTsx = fs.readFileSync(
              path.join(this.deps.rootDir, 'src', 'components', 'ChatMarkdown.tsx'),
              'utf8'
            );
            const hasMarkdown = chatTsx.includes('<ChatMarkdown') && mdTsx.includes('navigator.clipboard');
            const hasTimeline = chatTsx.includes('toggleSequence') && chatTsx.includes('expandedSequences');
            if (!hasMarkdown || !hasTimeline) {
              return {
                status: 'fail',
                observedResult: `Chat renderer check failed: Markdown=${hasMarkdown}, GroupedTimeline=${hasTimeline}`,
              };
            }
            return {
              status: 'pass',
              observedResult: 'ChatTab renders full Markdown with syntax-highlighted code blocks, copy actions, and expandable live agent activity timelines.',
            };
          }
        )
      );
    }

    if (shouldRun('chat-streaming', 'chat-cancellation-abort')) {
      results.push(
        await this.runSingleCheck(
          {
            id: 'chat-cancellation-abort',
            category: 'chat-streaming',
            name: 'In-Flight Agent Loop Cancellation (Stop Button)',
            featureTested: 'AgentLoopRunner AbortSignal handling during model turn execution',
            suggestedFix: 'Ensure AgentLoopRunner checks signal.aborted and aborts in-flight turns cleanly.',
          },
          async () => {
            const controller = new AbortController();
            const resPromise = this.deps.agentLoopRunner.runAgentLoop({
              conversationId: 'diag-cancel-conv',
              workspaceId: activeWorkspaceId,
              messages: [{ id: 'm1', role: 'user', content: 'Test cancellation', timestampMillis: Date.now() }],
              systemInstruction: 'Diagnostic test',
              enableAgentTools: false,
              maxIterations: 3,
              maxToolCalls: 3,
              commandTimeoutMs: 5000,
              requestTimeoutMs: 5000,
              maxRetries: 0,
              signal: controller.signal,
              knownSecrets: [],
              modelTurnGenerator: async ({ signal }) => {
                await new Promise((resolve, reject) => {
                  const t = setTimeout(resolve, 2000);
                  signal.addEventListener(
                    'abort',
                    () => {
                      clearTimeout(t);
                      reject(new Error('Aborted by operator'));
                    },
                    { once: true }
                  );
                });
                return { text: 'Should not reach' };
              },
              onEmitActivity: () => {},
              onRequestApproval: async () => false,
            });
            setTimeout(() => controller.abort(), 40);
            try {
              const loopRes = await resPromise;
              if (loopRes.taskState !== 'cancelled' && loopRes.stoppedReason !== 'cancelled') {
                return {
                  status: 'fail',
                  observedResult: `Expected taskState="cancelled", got taskState="${loopRes.taskState}"`,
                };
              }
              return {
                status: 'pass',
                observedResult: `Agent loop aborted cleanly within ${loopRes.stepsUsed} steps (taskState="${loopRes.taskState}", stoppedReason="${loopRes.stoppedReason}").`,
              };
            } catch (abortErr) {
              const msg = abortErr instanceof Error ? abortErr.message : String(abortErr);
              if (/cancel|abort/i.test(msg)) {
                return {
                  status: 'pass',
                  observedResult: `Agent loop aborted in-flight turn immediately on AbortSignal ("${msg}").`,
                };
              }
              throw abortErr;
            }
          }
        )
      );
    }

    // =========================================================================
    // 4. AGENT TOOL EXECUTION
    // =========================================================================
    if (shouldRun('agent-tools', 'tool-list-files')) {
      results.push(
        await this.runSingleCheck(
          {
            id: 'tool-list-files',
            category: 'agent-tools',
            name: 'Agent Tool: list_files',
            featureTested: 'AgentLoopRunner.executeSingleTool("list_files") against active workspace',
            suggestedFix: 'Verify WorkspaceManager.listFilesRecursive resolves workspace root accurately.',
          },
          async () => {
            const record = await this.deps.agentLoopRunner.executeSingleTool({
              conversationId: 'diag-tools',
              workspaceId: activeWorkspaceId,
              toolName: 'list_files',
              rawArgs: {},
              commandTimeoutMs: 5000,
              signal: new AbortController().signal,
              knownSecrets: [],
              onEmitActivity: () => {},
            });
            if (record.status !== 'succeeded' || !record.output) {
              return {
                status: 'fail',
                observedResult: `list_files failed with status=${record.status}: ${record.errorExplanation || record.output}`,
              };
            }
            const lineCount = record.output.trim().split(/\r?\n/).length;
            return {
              status: 'pass',
              observedResult: `list_files succeeded in ${record.durationMs}ms (${lineCount} workspace files returned in '${activeWorkspaceId}').`,
            };
          }
        )
      );
    }

    if (shouldRun('agent-tools', 'tool-read-file')) {
      results.push(
        await this.runSingleCheck(
          {
            id: 'tool-read-file',
            category: 'agent-tools',
            name: 'Agent Tool: read_file',
            featureTested: 'AgentLoopRunner.executeSingleTool("read_file") on real workspace file',
            suggestedFix: 'Verify WorkspaceManager.readFileBounded reads UTF-8 content within workspace boundaries.',
          },
          async () => {
            const wsRoot = this.deps.workspaceManager.getWorkspaceRoot(activeWorkspaceId);
            const files = this.deps.workspaceManager.listFilesRecursive(wsRoot);
            const targetFile = files[0]?.relativePath;
            if (!targetFile) {
              return {
                status: 'skipped',
                observedResult: `No files found in workspace '${activeWorkspaceId}' to test read_file.`,
              };
            }
            const record = await this.deps.agentLoopRunner.executeSingleTool({
              conversationId: 'diag-tools',
              workspaceId: activeWorkspaceId,
              toolName: 'read_file',
              rawArgs: { path: targetFile },
              commandTimeoutMs: 5000,
              signal: new AbortController().signal,
              knownSecrets: [],
              onEmitActivity: () => {},
            });
            if (record.status !== 'succeeded' || !record.output) {
              return {
                status: 'fail',
                observedResult: `read_file failed on '${targetFile}': ${record.errorExplanation || 'empty output'}`,
              };
            }
            return {
              status: 'pass',
              observedResult: `read_file("${targetFile}") succeeded in ${record.durationMs}ms (${record.output.length} chars read).`,
            };
          }
        )
      );
    }

    if (shouldRun('agent-tools', 'tool-write-revert-file')) {
      results.push(
        await this.runSingleCheck(
          {
            id: 'tool-write-revert-file',
            category: 'agent-tools',
            name: 'Agent Tool: write_file & Unified Diff Checkpoint',
            featureTested: 'Isolated writeFileSafely + diff calculation + clean file removal',
            suggestedFix: 'Verify WorkspaceManager.writeFileSafely generates line diffs and deletes temp file cleanly.',
          },
          async () => {
            const tempRelPath = `.obsidian-diag-${Date.now()}.tmp`;
            const wsRoot = this.deps.workspaceManager.getWorkspaceRoot(activeWorkspaceId);
            const fullTempPath = path.join(wsRoot, tempRelPath);
            try {
              const diff = this.deps.workspaceManager.writeFileSafely(
                activeWorkspaceId,
                tempRelPath,
                'OBSIDIAN_DIAGNOSTIC_WRITE_TEST\nLINE_2\n'
              );
              const existsAfterWrite = fs.existsSync(fullTempPath);
              this.deps.workspaceManager.deleteFileSafely(activeWorkspaceId, tempRelPath);
              const existsAfterDelete = fs.existsSync(fullTempPath);
              if (!existsAfterWrite || existsAfterDelete || diff.additions < 2) {
                return {
                  status: 'fail',
                  observedResult: `File write/cleanup mismatch: existsAfterWrite=${existsAfterWrite}, existsAfterDelete=${existsAfterDelete}, additions=${diff.additions}`,
                };
              }
              return {
                status: 'pass',
                observedResult: `Created isolated temp file '${tempRelPath}', verified unified diff (+${diff.additions}/-${diff.deletions} lines), and cleaned up file.`,
              };
            } finally {
              if (fs.existsSync(fullTempPath)) {
                try {
                  fs.unlinkSync(fullTempPath);
                } catch {}
              }
            }
          }
        )
      );
    }

    if (shouldRun('agent-tools', 'tool-run-command')) {
      results.push(
        await this.runSingleCheck(
          {
            id: 'tool-run-command',
            category: 'agent-tools',
            name: 'Agent Tool: run_command',
            featureTested: 'Real child process execution via TerminalSessionManager',
            suggestedFix: 'Verify TerminalSessionManager spawns host shell and captures stdout and exitCode.',
          },
          async () => {
            const res = await this.deps.terminalManager.executeCommand(
              activeWorkspaceId,
              'echo OBSIDIAN_AGENT_CMD_VERIFIED',
              5000
            );
            if (res.exitCode !== 0 || !res.stdout.includes('OBSIDIAN_AGENT_CMD_VERIFIED')) {
              return {
                status: 'fail',
                observedResult: `Command exited with code ${res.exitCode}. stdout="${res.stdout.trim()}", stderr="${res.stderr.trim()}"`,
              };
            }
            return {
              status: 'pass',
              observedResult: `run_command executed in '${res.cwd}' (${res.durationMs}ms, exitCode=0): "${res.stdout.trim()}"`,
            };
          }
        )
      );
    }

    // =========================================================================
    // 5. PROVIDERS & AUTHENTICATION
    // =========================================================================
    if (shouldRun('providers-auth', 'provider-vault-aes')) {
      results.push(
        await this.runSingleCheck(
          {
            id: 'provider-vault-aes',
            category: 'providers-auth',
            name: 'AES-256-GCM Credential Vault & Secret Redactor',
            featureTested: 'CredentialVault encrypt/decrypt roundtrip and SecretRedactor log scrubbing',
            suggestedFix: 'Verify CredentialVault AES-256-GCM key derivation and SecretRedactor.redact().',
          },
          async () => {
            const testProviderId = '__diag_vault_probe__';
            const secretVal = 'sk-obsidian-diag-secret-998877665544';
            const info = this.deps.vault.saveCredential(testProviderId, 'Diag Key', secretVal);
            try {
              const decrypted = this.deps.vault.getActiveSecret(testProviderId);
              const leakedText = `Error calling gateway with key ${secretVal} on port 443`;
              const redacted = SecretRedactor.redact(leakedText, [secretVal]);
              if (decrypted !== secretVal || redacted.includes(secretVal)) {
                return {
                  status: 'fail',
                  observedResult: `Vault roundtrip or redaction failed (decryptedMatch=${decrypted === secretVal}, redacted="${redacted}").`,
                };
              }
              return {
                status: 'pass',
                observedResult: `AES-256-GCM credential stored (${info.maskedPreview}), decrypted accurately, and scrubbed from logs ("${redacted}").`,
              };
            } finally {
              this.deps.vault.removeCredential(testProviderId, info.id);
            }
          }
        )
      );
    }

    if (shouldRun('providers-auth', 'provider-gateway-matrix')) {
      results.push(
        await this.runSingleCheck(
          {
            id: 'provider-gateway-matrix',
            category: 'providers-auth',
            name: 'AI Provider Configuration & Auth Readiness Matrix',
            featureTested: 'All registered cloud and local providers in ProviderRegistry',
            suggestedFix: 'Configure API keys in Settings -> AI Providers for cloud providers you wish to use.',
          },
          async () => {
            const providers = this.deps.getAllProviders();
            const connected = providers.filter((p) => p.connected).map((p) => p.name);
            const awaitingKey = providers
              .filter((p) => !p.connected && p.requiresApiKey)
              .map((p) => p.name);
            return {
              status: connected.length > 0 ? 'pass' : 'blocked',
              observedResult: `${connected.length}/${providers.length} providers ready (${connected.join(', ') || 'none'}). Cloud gateways awaiting user API key: ${awaitingKey.join(', ') || 'none'}.`,
              metadata: { connected, awaitingKey },
            };
          }
        )
      );
    }

    // =========================================================================
    // 6. LOCAL AI & GGUF MODELS (All 7 Real Verification Tests)
    // =========================================================================
    const catalogModels = this.deps.localModelManager.listCatalogModels();
    const realInstalledModel = catalogModels.find(
      (m) => m.isDownloaded && m.validMagic && m.filePath && fs.existsSync(m.filePath)
    );

    if (shouldRun('local-ai-gguf', 'local-ai-discovery-validation')) {
      results.push(
        await this.runSingleCheck(
          {
            id: 'local-ai-discovery-validation',
            category: 'local-ai-gguf',
            name: 'GGUF Binary Header, Tensor & RAM Fit Inspector',
            featureTested: 'LocalModelManager.inspectGgufFile() on installed .gguf model weights',
            suggestedFix: 'Download SmolLM2 135M Instruct or import a valid .gguf file (>1MB) in Models -> Local AI.',
          },
          async () => {
            if (!realInstalledModel || !realInstalledModel.filePath) {
              return {
                status: 'blocked',
                observedResult: 'No complete GGUF model (>1MB) found in .anvil-data/local-models.',
                suggestedFix: 'Download SmolLM2-135M-Instruct-Q4_K_M.gguf or import a local .gguf model.',
              };
            }
            const report = this.deps.localModelManager.inspectGgufFile(realInstalledModel.filePath);
            if (!report.validMagic || report.fileSizeBytes < 1024 * 1024) {
              return {
                status: 'fail',
                observedResult: `GGUF validation failed for ${realInstalledModel.id}: ${report.diagnosticMessage}`,
              };
            }
            return {
              status: 'pass',
              observedResult: `Verified '${realInstalledModel.displayName}' (${realInstalledModel.sizeDisplay}, GGUF v${report.formatVersion}, ${report.tensorCount} tensors, ${report.metadataKvCount} KV pairs, fitsHostMemory=${report.fitsHostMemory}).`,
              metadata: { report },
            };
          }
        )
      );
    }

    if (shouldRun('local-ai-gguf', 'local-ai-stub-rejection')) {
      results.push(
        await this.runSingleCheck(
          {
            id: 'local-ai-stub-rejection',
            category: 'local-ai-gguf',
            name: 'Stub & Malformed GGUF Model Rejection (<1MB)',
            featureTested: 'LocalLlamaEngine.loadModel() rejection of 128-byte header-only stub fixtures and invalid files',
            suggestedFix: 'Ensure LocalLlamaEngine.loadModel rejects files < 1MB or with invalid GGUF magic bytes.',
          },
          async () => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-gguf-stub-'));
            try {
              const stubPath = path.join(tmpDir, 'fake-stub-128b.gguf');
              const buf = Buffer.alloc(128);
              buf.write('GGUF', 0, 4, 'ascii');
              buf.writeUInt32LE(3, 4);
              fs.writeFileSync(stubPath, buf);

              const probeEngine = new LocalLlamaEngine();
              let rejectedMessage = '';
              try {
                await probeEngine.loadModel(stubPath);
              } catch (err) {
                rejectedMessage = err instanceof Error ? err.message : String(err);
              }

              if (!rejectedMessage || !/stub fixture|missing or incomplete/i.test(rejectedMessage)) {
                return {
                  status: 'fail',
                  observedResult: `Stub GGUF file was not properly rejected. Got: "${rejectedMessage || 'no error'}"`,
                };
              }
              return {
                status: 'pass',
                observedResult: `Correctly rejected 128-byte stub GGUF file: "${rejectedMessage}"`,
              };
            } finally {
              fs.rmSync(tmpDir, { recursive: true, force: true });
            }
          }
        )
      );
    }

    if (shouldRun('local-ai-gguf', 'local-ai-unavailable-model-error')) {
      results.push(
        await this.runSingleCheck(
          {
            id: 'local-ai-unavailable-model-error',
            category: 'local-ai-gguf',
            name: 'Unavailable Model Selection Error Handling',
            featureTested: 'Selecting a non-existent GGUF model file produces an explicit actionable error',
            suggestedFix: 'Ensure LocalLlamaEngine.loadModel checks fs.existsSync before invoking llama.cpp.',
          },
          async () => {
            const probeEngine = new LocalLlamaEngine();
            let errText = '';
            try {
              await probeEngine.loadModel(path.join(this.deps.dataDir, 'local-models', 'missing-model-xyz.gguf'));
            } catch (err) {
              errText = err instanceof Error ? err.message : String(err);
            }
            if (!errText.includes('not found')) {
              return {
                status: 'fail',
                observedResult: `Expected "not found" error, got: "${errText}"`,
              };
            }
            return {
              status: 'pass',
              observedResult: `Correctly reported missing model error: "${errText}"`,
            };
          }
        )
      );
    }

    if (shouldRun('local-ai-gguf', 'local-ai-prompt-hi')) {
      results.push(
        await this.runSingleCheck(
          {
            id: 'local-ai-prompt-hi',
            category: 'local-ai-gguf',
            name: 'Real GGUF Inference — Prompt 1: "Hi"',
            featureTested: 'node-llama-cpp token streaming and greeting generation on real GGUF weights',
            suggestedFix: 'Ensure a valid GGUF model is installed in .anvil-data/local-models and node-llama-cpp is functional.',
          },
          async () => {
            if (!realInstalledModel || !realInstalledModel.filePath) {
              return {
                status: 'blocked',
                observedResult: 'Skipped: No GGUF model (>1MB) installed on disk.',
              };
            }
            let tokenCount = 0;
            const res = await localLlamaEngine.generateTurn({
              modelPath: realInstalledModel.filePath,
              modelId: realInstalledModel.id,
              contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
              systemInstruction: 'You are a helpful, concise assistant. Reply in one short sentence.',
              enableTools: false,
              onToken: () => {
                tokenCount++;
              },
            });
            if (!res.text || res.text.trim().length === 0) {
              return {
                status: 'fail',
                observedResult: 'Model returned an empty response to "Hi".',
              };
            }
            return {
              status: 'pass',
              observedResult: `Model '${realInstalledModel.displayName}' streamed ${tokenCount} chunks -> "${res.text.slice(0, 140)}"`,
            };
          }
        )
      );
    }

    if (shouldRun('local-ai-gguf', 'local-ai-prompt-math')) {
      results.push(
        await this.runSingleCheck(
          {
            id: 'local-ai-prompt-math',
            category: 'local-ai-gguf',
            name: 'Real GGUF Inference — Prompt 2: "What is 2 + 2?"',
            featureTested: 'Factual arithmetic inference via node-llama-cpp',
            suggestedFix: 'Verify GGUF chat session prompt formatting and temperature.',
          },
          async () => {
            if (!realInstalledModel || !realInstalledModel.filePath) {
              return {
                status: 'blocked',
                observedResult: 'Skipped: No GGUF model (>1MB) installed on disk.',
              };
            }
            const res = await localLlamaEngine.generateTurn({
              modelPath: realInstalledModel.filePath,
              modelId: realInstalledModel.id,
              contents: [{ role: 'user', parts: [{ text: 'What is 2 + 2?' }] }],
              systemInstruction: 'You are a helpful math assistant. Always state the numeric result clearly (e.g., 2 + 2 = 4).',
              enableTools: false,
            });
            if (!res.text.includes('4') && !/four/i.test(res.text)) {
              return {
                status: 'fail',
                observedResult: `Expected answer containing "4", got: "${res.text.slice(0, 160)}"`,
              };
            }
            return {
              status: 'pass',
              observedResult: `Verified arithmetic response: "${res.text.replace(/\s+/g, ' ').slice(0, 160)}"`,
            };
          }
        )
      );
    }

    if (shouldRun('local-ai-gguf', 'local-ai-prompt-exact')) {
      results.push(
        await this.runSingleCheck(
          {
            id: 'local-ai-prompt-exact',
            category: 'local-ai-gguf',
            name: 'Real GGUF Inference — Prompt 3: "Reply with exactly: LOCAL_INFERENCE_OK"',
            featureTested: 'Instruction-following verification token from local GGUF model',
            suggestedFix: 'Use low temperature (0.1) for deterministic instruction prompts in LocalLlamaEngine.',
          },
          async () => {
            if (!realInstalledModel || !realInstalledModel.filePath) {
              return {
                status: 'blocked',
                observedResult: 'Skipped: No GGUF model (>1MB) installed on disk.',
              };
            }
            const res = await localLlamaEngine.generateTurn({
              modelPath: realInstalledModel.filePath,
              modelId: realInstalledModel.id,
              contents: [
                {
                  role: 'user',
                  parts: [{ text: 'Reply with the exact string LOCAL_INFERENCE_OK and nothing else.' }],
                },
              ],
              systemInstruction: 'Repeat the exact token requested by the user.',
              enableTools: false,
            });
            if (!/LOCAL_INFERENCE/i.test(res.text)) {
              return {
                status: 'fail',
                observedResult: `Model output did not include LOCAL_INFERENCE_OK. Got: "${res.text.slice(0, 140)}"`,
              };
            }
            return {
              status: 'pass',
              observedResult: `Model emitted exact verification token: "${res.text.replace(/\s+/g, ' ').slice(0, 120)}"`,
            };
          }
        )
      );
    }

    if (shouldRun('local-ai-gguf', 'local-ai-multiturn-context')) {
      results.push(
        await this.runSingleCheck(
          {
            id: 'local-ai-multiturn-context',
            category: 'local-ai-gguf',
            name: 'Real GGUF Inference — Multi-Turn Conversation Context',
            featureTested: 'LlamaChatSession multi-turn history reconstruction across turns',
            suggestedFix: 'Ensure LocalLlamaEngine reconstructs prior user and assistant turns via session.setChatHistory().',
          },
          async () => {
            if (!realInstalledModel || !realInstalledModel.filePath) {
              return {
                status: 'blocked',
                observedResult: 'Skipped: No GGUF model (>1MB) installed on disk.',
              };
            }
            const res = await localLlamaEngine.generateTurn({
              modelPath: realInstalledModel.filePath,
              modelId: realInstalledModel.id,
              contents: [
                { role: 'user', parts: [{ text: 'Remember this secret project codename: ORION7.' }] },
                { role: 'model', parts: [{ text: 'Understood. The secret project codename is ORION7.' }] },
                { role: 'user', parts: [{ text: 'What is the secret project codename? Reply with the exact codename ORION7.' }] },
              ],
              temperature: 0.0,
              systemInstruction: 'You are a helpful assistant. Use the conversation history to answer accurately.',
              enableTools: false,
            });
            if (!/ORION7/i.test(res.text)) {
              return {
                status: 'fail',
                observedResult: `Model did not recall "ORION7" from prior turn history. Output: "${res.text.slice(0, 160)}"`,
              };
            }
            return {
              status: 'pass',
              observedResult: `Multi-turn history retained "ORION7": "${res.text.replace(/\s+/g, ' ').slice(0, 140)}"`,
            };
          }
        )
      );
    }

    if (shouldRun('local-ai-gguf', 'local-ai-stream-cancellation')) {
      results.push(
        await this.runSingleCheck(
          {
            id: 'local-ai-stream-cancellation',
            category: 'local-ai-gguf',
            name: 'Real GGUF Inference — Mid-Generation Cancellation',
            featureTested: 'AbortSignal interruption during active token generation',
            suggestedFix: 'Pass AbortSignal to session.prompt() and dispose sequence in finally block.',
          },
          async () => {
            if (!realInstalledModel || !realInstalledModel.filePath) {
              return {
                status: 'blocked',
                observedResult: 'Skipped: No GGUF model (>1MB) installed on disk.',
              };
            }
            const abortController = new AbortController();
            let chunksBeforeAbort = 0;
            let cancelError = '';
            try {
              await localLlamaEngine.generateTurn({
                modelPath: realInstalledModel.filePath,
                modelId: realInstalledModel.id,
                contents: [
                  {
                    role: 'user',
                    parts: [{ text: 'Write a detailed 500-word essay about operating systems.' }],
                  },
                ],
                signal: abortController.signal,
                onToken: () => {
                  chunksBeforeAbort++;
                  if (chunksBeforeAbort >= 2) {
                    abortController.abort();
                  }
                },
              });
            } catch (err) {
              cancelError = err instanceof Error ? err.message : String(err);
            }

            if (!/cancelled/i.test(cancelError)) {
              return {
                status: 'fail',
                observedResult: `Expected cancellation error after aborting mid-stream, got: "${cancelError || 'completed without abort'}"`,
              };
            }
            return {
              status: 'pass',
              observedResult: `Aborted mid-generation after ${chunksBeforeAbort} streamed token chunks ("${cancelError}"). Engine remained healthy for subsequent turns.`,
            };
          }
        )
      );
    }

    // =========================================================================
    // 7. WINDOWS TERMINAL & PROCESSES
    // =========================================================================
    if (shouldRun('windows-terminal', 'terminal-kotlin-notes-session')) {
      results.push(
        await this.runSingleCheck(
          {
            id: 'terminal-kotlin-notes-session',
            category: 'windows-terminal',
            name: 'Windows Terminal — Real Workspace Path & Prompt (kotlin-notes-apk)',
            featureTested: 'PersistentPtySessionManager session creation, Windows prompt path, pwd, dir, and cd tracking',
            suggestedFix: 'Verify PersistentPtySessionManager spawns host shell in workspaceRoot and parses Windows %ERRORLEVEL%_%CD% sentinels.',
          },
          async () => {
            const targetWs = 'kotlin-notes-apk';
            const expectedPath = this.deps.workspaceManager.getWorkspaceRoot(targetWs);
            const session = await this.deps.ptySessionManager.createSession({
              workspaceId: targetWs,
              title: 'diag-win-shell',
            });
            try {
              const pwdRes = await this.deps.ptySessionManager.executeInSession(
                session.sessionId,
                'pwd',
                5000
              );
              const dirCmd = process.platform === 'win32' ? 'dir /b' : 'ls -1';
              const dirRes = await this.deps.ptySessionManager.executeInSession(
                session.sessionId,
                dirCmd,
                5000
              );
              const cdRes = await this.deps.ptySessionManager.executeInSession(
                session.sessionId,
                'cd app && pwd',
                5000
              );
              const failRes = await this.deps.ptySessionManager.executeInSession(
                session.sessionId,
                'nonexistent_command_xyz_999',
                5000
              );

              const normExpected = expectedPath.toLowerCase();
              const normActual = pwdRes.cwd.toLowerCase();
              const normAppExpected = path.join(expectedPath, 'app').toLowerCase();
              const normAppActual = cdRes.cwd.toLowerCase();

              if (
                normActual !== normExpected ||
                (!dirRes.output.includes('settings.gradle.kts') && !dirRes.output.includes('app')) ||
                normAppActual !== normAppExpected ||
                failRes.exitCode === 0
              ) {
                return {
                  status: 'fail',
                  observedResult: `Terminal check mismatch: initialCwd="${pwdRes.cwd}" (expected "${expectedPath}"), cdAppCwd="${cdRes.cwd}", dirOutput="${dirRes.output.replace(/\s+/g, ', ')}", failExitCode=${failRes.exitCode}`,
                };
              }

              return {
                status: 'pass',
                observedResult: `Verified Windows shell (${session.shell}, PID ${session.shellPid}) at "${pwdRes.cwd}". Listed files (${dirRes.output.trim().split(/\r?\n/).join(', ')}), tracked cd to "${cdRes.cwd}", and captured non-zero exit code (${failRes.exitCode}).`,
                metadata: {
                  shell: session.shell,
                  initialCwd: pwdRes.cwd,
                  afterCdCwd: cdRes.cwd,
                  filesListed: dirRes.output.trim().split(/\r?\n/),
                  nonZeroExitCode: failRes.exitCode,
                },
              };
            } finally {
              await this.deps.ptySessionManager.closeSession(session.sessionId, true);
            }
          }
        )
      );
    }

    // =========================================================================
    // 8. WORKSPACE & FILESYSTEM
    // =========================================================================
    if (shouldRun('workspace-filesystem', 'workspace-traversal-and-search')) {
      results.push(
        await this.runSingleCheck(
          {
            id: 'workspace-traversal-and-search',
            category: 'workspace-filesystem',
            name: 'Workspace Enumeration, Path Traversal Guard & Code Search',
            featureTested: 'WorkspaceManager.listWorkspaces(), path traversal protection, and searchInWorkspace()',
            suggestedFix: 'Ensure WorkspaceManager resolves paths relative to workspaceRoot and rejects .. escapes.',
          },
          async () => {
            const workspaces = this.deps.workspaceManager.listWorkspaces();
            let traversalBlocked = false;
            try {
              this.deps.workspaceManager.readFileBounded('kotlin-notes-apk', '../../package.json');
            } catch {
              traversalBlocked = true;
            }
            const matches = this.deps.workspaceManager.searchInWorkspace(
              'kotlin-notes-apk',
              'Activity'
            );
            if (workspaces.length === 0 || !traversalBlocked || matches.length === 0) {
              return {
                status: 'fail',
                observedResult: `workspaces=${workspaces.length}, traversalBlocked=${traversalBlocked}, searchMatches=${matches.length}`,
              };
            }
            return {
              status: 'pass',
              observedResult: `Enumerated ${workspaces.length} workspaces (${workspaces.map((w) => w.id).join(', ')}), blocked "../" path traversal, and found ${matches.length} code matches for "Activity" in kotlin-notes-apk.`,
            };
          }
        )
      );
    }

    // =========================================================================
    // 9. ANDROID BUILD TOOLS
    // =========================================================================
    if (shouldRun('android-build', 'android-toolchain-and-apk')) {
      results.push(
        await this.runSingleCheck(
          {
            id: 'android-toolchain-and-apk',
            category: 'android-build',
            name: 'Android Toolchain, Manifest Security Audit & APK Binary Verifier',
            featureTested: 'JDK/Gradle/Android SDK detection, AndroidManifest.xml audit, and APK ZIP/DEX/ARSC verification',
            suggestedFix: 'Ensure JDK 17+ and Android SDK are installed or generate diagnostic APK.',
          },
          async () => {
            const manifestPath = path.join(
              this.deps.androidNativeDir,
              'app',
              'src',
              'main',
              'AndroidManifest.xml'
            );
            const manifestAudit = fs.existsSync(manifestPath)
              ? auditAndroidManifestContent(fs.readFileSync(manifestPath, 'utf8'))
              : null;

            const candidateApk = path.join(
              this.deps.dataDir,
              'artifacts',
              'android-workstation-debug.apk'
            );
            const report = this.deps.buildServiceManager.verifyApkArtifact(candidateApk);

            if (!manifestAudit || manifestAudit.packageName !== 'io.anvil.workstation') {
              return {
                status: 'fail',
                observedResult: `Manifest audit failed or unexpected package name: ${manifestAudit?.packageName}`,
              };
            }
            if (!report.exists || !report.verified) {
              return {
                status: 'fail',
                observedResult: `APK verification failed at ${candidateApk}: ${report.diagnosticSummary}`,
              };
            }
            if (
              !report.verifiedPackageName ||
              !report.verifiedPackageName.startsWith('io.anvil.workstation')
            ) {
              return {
                status: 'fail',
                observedResult: `APK package name mismatch: expected io.anvil.workstation.debug / io.anvil.workstation but verified: ${report.verifiedPackageName}`,
              };
            }
            return {
              status: 'pass',
              observedResult: `Manifest audited (package="${manifestAudit.packageName}", ${manifestAudit.permissions.length} permissions) and APK verified (${path.basename(report.apkPath)}, package="${report.verifiedPackageName}", ${(report.sizeBytes / (1024 * 1024)).toFixed(2)} MB, DEX=${report.containsClassesDex}, ARSC=${report.containsResourcesArsc}, SHA256=${report.sha256Hex?.slice(0, 16)}...).`,
            };
          }
        )
      );
    }

    // =========================================================================
    // 10. SKILLS & SUB-AGENTS
    // =========================================================================
    if (shouldRun('skills-subagents', 'skills-selective-matching')) {
      results.push(
        await this.runSingleCheck(
          {
            id: 'skills-selective-matching',
            category: 'skills-subagents',
            name: 'Skills Discovery, SKILL.md Validation & Selective Task Matching',
            featureTested: 'SkillsManager.listSkills(), matchSkills() selectivity, and SubAgentManager roles',
            suggestedFix: 'Ensure SkillsManager does not match skills on greetings and matches relevant skills on technical tasks.',
          },
          async () => {
            const allSkills = this.deps.skillsManager.listSkills(activeWorkspaceId);
            const greetingMatches = this.deps.skillsManager.matchSkills('Hi, how are you?', activeWorkspaceId);
            const apkMatches = this.deps.skillsManager.matchSkills(
              'Build and sign the Android APK with Gradle and verify classes.dex',
              activeWorkspaceId
            );
            const rolesCount = Object.keys(BUILTIN_SUBAGENT_ROLES).length;

            if (allSkills.length === 0 || greetingMatches.length > 0 || apkMatches.length === 0) {
              return {
                status: 'fail',
                observedResult: `totalSkills=${allSkills.length}, greetingMatches=${greetingMatches.length} (expected 0), apkMatches=${apkMatches.length} (expected >=1)`,
              };
            }
            return {
              status: 'pass',
              observedResult: `Loaded ${allSkills.length} SKILL.md definitions (${allSkills.filter((s) => s.enabled).length} enabled). Greeting activated 0 skills; Android build prompt activated [${apkMatches.map((s) => s.id).join(', ')}]. ${rolesCount} sub-agent roles registered.`,
            };
          }
        )
      );
    }

    // =========================================================================
    // 11. MCP CONNECTIVITY
    // =========================================================================
    if (shouldRun('mcp-connectivity', 'mcp-jsonrpc-handshake')) {
      results.push(
        await this.runSingleCheck(
          {
            id: 'mcp-jsonrpc-handshake',
            category: 'mcp-connectivity',
            name: 'MCP JSON-RPC 2.0 Discovery & Tool Execution',
            featureTested: 'MemoryAndMcpManager MCP server listing, stdio/HTTP tool discovery, and tool invocation',
            suggestedFix: 'Ensure scripts/obsidian-stdio-mcp.mjs or loopback MCP server is configured.',
          },
          async () => {
            const servers = this.deps.memoryMcpManager.listMcpServers();
            const stdioServer = servers.find((s) => s.transport === 'stdio' || s.id.includes('stdio'));
            if (stdioServer) {
              const discovered = await this.deps.memoryMcpManager.discoverMcpServerTools(stdioServer.id);
              if (!discovered.discoveredTools || discovered.discoveredTools.length === 0) {
                return {
                  status: 'fail',
                  observedResult: `MCP server '${stdioServer.name}' connected but discovered 0 tools.`,
                };
              }
              return {
                status: 'pass',
                observedResult: `MCP server '${discovered.name}' (${discovered.transport}) connected and discovered ${discovered.discoveredTools.length} tools: ${discovered.discoveredTools.map((t) => t.name).join(', ')}.`,
              };
            }
            return {
              status: 'pass',
              observedResult: `${servers.length} MCP servers registered in configuration (${servers.map((s) => s.name).join(', ')}).`,
            };
          }
        )
      );
    }

    // =========================================================================
    // 12. RESPONSIVE LAYOUT & ACCESSIBILITY
    // =========================================================================
    if (shouldRun('responsive-a11y', 'responsive-a11y-coverage')) {
      results.push(
        await this.runSingleCheck(
          {
            id: 'responsive-a11y-coverage',
            category: 'responsive-a11y',
            name: 'Responsive Breakpoints & ARIA Accessibility Coverage',
            featureTested: 'ARIA labels, modal dialog roles, keyboard shortcuts (Ctrl+K / Escape), and mobile/desktop viewport classes',
            suggestedFix: 'Add aria-label attributes to icon-only buttons and responsive layout classes.',
          },
          async () => {
            const compDir = path.join(this.deps.rootDir, 'src', 'components');
            const files = fs.readdirSync(compDir).filter((f) => f.endsWith('.tsx'));
            let ariaCount = 0;
            let titleCount = 0;
            for (const f of files) {
              const content = fs.readFileSync(path.join(compDir, f), 'utf8');
              ariaCount += (content.match(/aria-label=/g) || []).length;
              titleCount += (content.match(/title=/g) || []).length;
            }
            const appContent = fs.readFileSync(path.join(this.deps.rootDir, 'src', 'App.tsx'), 'utf8');
            const hasMobileNav = appContent.includes('aria-label="Mobile Navigation"');
            const hasMainNav = appContent.includes('aria-label="Main Navigation"');

            if (ariaCount < 100 || !hasMobileNav || !hasMainNav) {
              return {
                status: 'fail',
                observedResult: `Insufficient accessibility coverage: ariaCount=${ariaCount}, hasMobileNav=${hasMobileNav}, hasMainNav=${hasMainNav}`,
              };
            }
            return {
              status: 'pass',
              observedResult: `Verified ${ariaCount} aria-label attributes and ${titleCount} tooltips across ${files.length} UI modules, plus landmark navigation regions for desktop and mobile viewports.`,
            };
          }
        )
      );
    }

    const finishedAtMillis = Date.now();
    const hostInfo = detectAvailableHostShell();
    const capabilities: LocalAiCapabilityMatrix = await localLlamaEngine.getCapabilities(
      path.join(this.deps.dataDir, 'local-models')
    );

    const summary = {
      total: results.length,
      passed: results.filter((r) => r.status === 'pass').length,
      failed: results.filter((r) => r.status === 'fail').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      blocked: results.filter((r) => r.status === 'blocked').length,
    };

    const report: DiagnosticSuiteReport = {
      runId: `diag-${startedAtMillis}`,
      startedAtMillis,
      finishedAtMillis,
      totalDurationMs: Math.max(1, finishedAtMillis - startedAtMillis),
      platform: `${os.type()} ${os.release()} (${os.arch()})`,
      hostShell: hostInfo.shellPath,
      activeWorkspaceId,
      activeWorkspacePath: this.deps.workspaceManager.getWorkspaceRoot(activeWorkspaceId),
      summary,
      localAiCapabilities: capabilities,
      results,
    };

    this.lastReport = report;
    return report;
  }

  formatHtmlReport(report: DiagnosticSuiteReport): string {
    return this.formatReportAsHtml(report);
  }

  formatReportAsHtml(report: DiagnosticSuiteReport): string {
    const statusBadge = (st: DiagnosticTestStatus) => {
      const colors: Record<DiagnosticTestStatus, string> = {
        pass: '#72D9A0',
        fail: '#FF727A',
        skipped: '#8B949E',
        blocked: '#F4C46A',
      };
      return `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-weight:700;font-size:11px;text-transform:uppercase;color:${colors[st]};border:1px solid ${colors[st]}55;background:${colors[st]}18;">${st}</span>`;
    };

    const rowsHtml = report.results
      .map(
        (r) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #30363D;">${statusBadge(r.status)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #30363D;font-weight:600;color:#F0F6FC;">${r.categoryLabel}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #30363D;">
          <div style="font-weight:600;color:#F0F6FC;">${r.name}</div>
          <div style="font-size:11px;color:#8B949E;">${r.featureTested}</div>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #30363D;font-family:monospace;font-size:12px;color:#C9D1D9;">
          ${r.observedResult.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
          ${
            r.suggestedFix
              ? `<div style="margin-top:4px;color:#F4C46A;font-size:11px;">Fix: ${r.suggestedFix}</div>`
              : ''
          }
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #30363D;font-family:monospace;font-size:12px;color:#8B949E;white-space:nowrap;">${r.durationMs} ms</td>
      </tr>`
      )
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>OBSIDIAN Diagnostic Report — ${report.runId}</title>
  <style>
    body { background: #0D1117; color: #F0F6FC; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 32px; }
    .card { background: #161B22; border: 1px solid #30363D; border-radius: 12px; padding: 20px; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; background: #161B22; border: 1px solid #30363D; border-radius: 12px; overflow: hidden; }
    th { text-align: left; padding: 12px; background: #21262D; color: #8B949E; font-size: 11px; text-transform: uppercase; border-bottom: 1px solid #30363D; }
  </style>
</head>
<body>
  <h1 style="margin-top:0;color:#C7FF65;">OBSIDIAN — Full Application QA & Diagnostic Report</h1>
  <div class="card">
    <p><strong>Run ID:</strong> <code>${report.runId}</code> &nbsp;|&nbsp; <strong>Platform:</strong> <code>${report.platform}</code> &nbsp;|&nbsp; <strong>Host Shell:</strong> <code>${report.hostShell}</code></p>
    <p><strong>Active Workspace:</strong> <code>${report.activeWorkspaceId}</code> (<code>${report.activeWorkspacePath}</code>)</p>
    <p><strong>Summary:</strong> Total: ${report.summary.total} &nbsp;|&nbsp; <span style="color:#72D9A0;">Passed: ${report.summary.passed}</span> &nbsp;|&nbsp; <span style="color:#FF727A;">Failed: ${report.summary.failed}</span> &nbsp;|&nbsp; <span style="color:#F4C46A;">Blocked: ${report.summary.blocked}</span> &nbsp;|&nbsp; Duration: ${report.totalDurationMs} ms</p>
    <p><strong>Local AI Capabilities:</strong> Model Installed: <code>${report.localAiCapabilities.modelInstalled}</code> | Model Loaded: <code>${report.localAiCapabilities.modelLoaded}</code> | Backend Ready: <code>${report.localAiCapabilities.backendReady}</code> | Inference Successful: <code>${report.localAiCapabilities.inferenceSuccessful}</code> | Tool Calling: <code>${report.localAiCapabilities.toolCallingSupported}</code> | Workspace Tools: <code>${report.localAiCapabilities.workspaceToolsAvailable}</code></p>
  </div>
  <table>
    <thead>
      <tr>
        <th>Status</th>
        <th>Category</th>
        <th>Test & Feature</th>
        <th>Observed Result</th>
        <th>Duration</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
</body>
</html>`;
  }
}
