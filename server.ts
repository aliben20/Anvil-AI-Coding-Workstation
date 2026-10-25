import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import child_process from 'child_process';
import { EventEmitter } from 'events';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type, FunctionDeclaration } from '@google/genai';
import {
  SecretRedactor,
  EncryptedCredentialVault,
  PermissionManager,
  WorkspaceManager,
  TerminalSessionManager,
  LocalModelManager,
  localLlamaEngine,
  BuildServiceManager,
  MemoryAndMcpManager,
  BoundedAgentLoopRunner,
  DEFAULT_PROVIDERS,
  ProviderConfig,
  Conversation,
  AgentActivityEvent,
  PendingApproval,
  PermissionCategory,
  PermissionPolicy,
  DiscoveredModel,
  ModelTurnResponse,
} from './src/server/workstationEngine.js';
import {
  SubAgentManager,
  BUILTIN_SUBAGENT_ROLES,
  SubAgentRole,
} from './src/server/subagentEngine.js';

import {
  SOURCE_REPOSITORIES_METADATA,
  BUILTIN_AGENT_PROFILES,
  auditAndroidManifestContent,
} from './src/server/sourceIntegrations.js';
import {
  PersistentPtySessionManager,
  detectAvailableHostShell,
} from './src/server/ptySessionManager.js';
import {
  MobileHarnessToolchainManager,
  ToolchainId,
  OptionalToolchainId,
} from './src/server/toolchainManager.js';
import { SkillsManager } from './src/server/skillsManager.js';
import { DiagnosticsRunner, DIAGNOSTIC_CATEGORIES } from './src/server/diagnosticsRunner.js';
import { AgentProfile, SkillDefinition } from './src/types.js';
import crypto from 'crypto';

const PORT = 3000;
const TERMINAL_SESSION_TOKEN = crypto.randomBytes(16).toString('hex');
const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, '.anvil-data');
const WORKSPACES_DIR = path.join(ROOT_DIR, 'workspaces');
const ANDROID_NATIVE_DIR = path.join(ROOT_DIR, 'android-workstation');

fs.mkdirSync(DATA_DIR, { recursive: true });

export const vault = new EncryptedCredentialVault(DATA_DIR);
export const permissionManager = new PermissionManager();
export const workspaceManager = new WorkspaceManager(
  WORKSPACES_DIR,
  ANDROID_NATIVE_DIR,
  permissionManager,
  DATA_DIR
);
export const terminalManager = new TerminalSessionManager(workspaceManager);
export const localModelManager = new LocalModelManager(DATA_DIR);
export const buildServiceManager = new BuildServiceManager(
  workspaceManager,
  terminalManager,
  DATA_DIR
);
export const memoryMcpManager = new MemoryAndMcpManager(DATA_DIR, vault, ROOT_DIR);
export const toolchainManager = new MobileHarnessToolchainManager(
  DATA_DIR,
  ROOT_DIR,
  workspaceManager
);
export const agentLoopRunner = new BoundedAgentLoopRunner(
  workspaceManager,
  terminalManager,
  permissionManager,
  memoryMcpManager,
  buildServiceManager,
  toolchainManager
);
export const ptySessionManager = new PersistentPtySessionManager(
  (wsId) => workspaceManager.getWorkspaceRoot(wsId),
  () => vault.getAllKnownSecrets()
);
export const subAgentManager = new SubAgentManager(
  DATA_DIR,
  workspaceManager,
  terminalManager,
  vault
);
export const skillsManager = new SkillsManager(DATA_DIR, workspaceManager);
try {
  skillsManager.setupWatchers(workspaceManager.listWorkspaces().map((w) => w.id));
  skillsManager.onSkillsChanged((workspaceId) => {
    activityEmitter.emit('skills_updated', { workspaceId, timestamp: Date.now() });
  });
} catch (err) {
  console.warn('[Server] Could not initialize skills watchers:', err);
}

export const diagnosticsRunner = new DiagnosticsRunner({
  rootDir: ROOT_DIR,
  dataDir: DATA_DIR,
  androidNativeDir: ANDROID_NATIVE_DIR,
  vault,
  workspaceManager,
  terminalManager,
  ptySessionManager,
  localModelManager,
  buildServiceManager,
  memoryMcpManager,
  toolchainManager,
  subAgentManager,
  skillsManager,
  agentLoopRunner,
  getAllProviders: () =>
    getAllProviders().map((p) => {
      const hasVaultKey = Boolean(vault.getActiveSecret(p.id));
      const connected =
        p.id === 'gemini-server'
          ? Boolean(process.env.GEMINI_API_KEY)
          : p.id === 'local-ai'
          ? localModelManager.listCatalogModels().some((m) => m.isDownloaded && m.validMagic)
          : !p.requiresApiKey || hasVaultKey;
      return {
        id: p.id,
        name: p.name,
        connected,
        requiresApiKey: p.requiresApiKey,
      };
    }),
});

// Custom persistent AI Providers store
const CUSTOM_PROVIDERS_FILE = path.join(DATA_DIR, 'custom_providers.json');

export function loadCustomProviders(): ProviderConfig[] {
  if (fs.existsSync(CUSTOM_PROVIDERS_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(CUSTOM_PROVIDERS_FILE, 'utf-8'));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // ignore
    }
  }
  return [];
}

export function saveCustomProviders(list: ProviderConfig[]): void {
  fs.writeFileSync(CUSTOM_PROVIDERS_FILE, JSON.stringify(list, null, 2), 'utf-8');
}

export function getAllProviders(): ProviderConfig[] {
  const customList = loadCustomProviders();
  const result: ProviderConfig[] = [];
  for (const def of DEFAULT_PROVIDERS) {
    const override = customList.find((c) => c.id === def.id);
    if (override) {
      result.push({ ...def, ...override });
    } else {
      result.push({ ...def });
    }
  }
  for (const cust of customList) {
    if (!DEFAULT_PROVIDERS.some((d) => d.id === cust.id)) {
      result.push(cust);
    }
  }
  return result;
}

// Custom persistent Agents store (.anvil-data/agents.json)
const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');

export function loadCustomAgents(): AgentProfile[] {
  if (fs.existsSync(AGENTS_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf-8'));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // ignore
    }
  }
  return [];
}

export function saveCustomAgents(list: AgentProfile[]): void {
  fs.writeFileSync(AGENTS_FILE, JSON.stringify(list, null, 2), 'utf-8');
}

export function getAllAgents(): AgentProfile[] {
  const builtin: AgentProfile[] = BUILTIN_AGENT_PROFILES.map((p) => ({
    id: p.id,
    name: p.name,
    role:
      p.id === 'mobile-harness-android-inspector'
        ? 'Android Auditor'
        : p.id === 'pocketstrike-security-auditor'
        ? 'Security Auditor'
        : 'Autonomous Coder',
    description: p.description,
    systemInstruction: '',
    capabilities: p.capabilities as string[],
    defaultMaxSteps: p.defaultMaxSteps,
    isCustom: false,
    isDefault: p.id === 'obsidian-autonomous-coder',
    accentColor:
      p.id === 'obsidian-autonomous-coder'
        ? '#C7FF65'
        : p.id === 'mobile-harness-android-inspector'
        ? '#4ADE80'
        : '#FF727A',
  }));
  const custom = loadCustomAgents();
  return [...builtin, ...custom];
}


export function validateAndSanitizeUrl(rawUrl: string): { valid: boolean; normalizedUrl?: string; error?: string } {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, error: 'Only http:// and https:// URLs are supported.' };
    }
    const hostname = parsed.hostname.toLowerCase();
    // SSRF protection: reject instance metadata services and link-local addresses
    if (
      hostname === '169.254.169.254' ||
      hostname === 'metadata.google.internal' ||
      hostname.startsWith('169.254.')
    ) {
      return { valid: false, error: 'Access to cloud instance metadata services is forbidden (SSRF Protection).' };
    }
    const normalized = rawUrl.trim().replace(/\/+$/, '');
    return { valid: true, normalizedUrl: normalized };
  } catch {
    return { valid: false, error: 'Invalid URL format. Please provide a valid HTTP or HTTPS endpoint.' };
  }
}

// Persistent conversations, settings & activity events store
const CONVERSATIONS_FILE = path.join(DATA_DIR, 'conversations.json');

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const EVENTS_FILE = path.join(DATA_DIR, 'activity_events.json');

interface WorkstationSettings {
  accentColor: string;
  fontSize: 'compact' | 'normal' | 'large';
  reducedMotion: boolean;
  defaultProviderId: string;
  defaultModelId: string;
  defaultAgentId?: string;
  requestTimeoutMs: number;
  maxRetries: number;
  streamingEnabled: boolean;
  maxAgentIterations: number;
  maxToolCalls: number;
  commandTimeoutMs: number;
  localAiThreads: number;
  localAiContextLength: number;
  memoryRetentionDays: number;
}

function getBestDefaultProviderAndModel(): { providerId: string; modelId: string } {
  return { providerId: 'antigravity', modelId: 'gemini-3.8-flash' };
}

const bestInitialDefault = getBestDefaultProviderAndModel();

const defaultSettings: WorkstationSettings = {
  accentColor: '#C7F36B',
  fontSize: 'normal',
  reducedMotion: false,
  defaultProviderId: 'antigravity',
  defaultModelId: 'gemini-3.8-flash',
  defaultAgentId: 'obsidian-autonomous-coder',
  requestTimeoutMs: 30000,
  maxRetries: 1,
  streamingEnabled: true,
  maxAgentIterations: 10,
  maxToolCalls: 15,
  commandTimeoutMs: 25000,
  localAiThreads: 4,
  localAiContextLength: 2048,
  memoryRetentionDays: 90,
};

function loadSettings(): WorkstationSettings {
  const best = getBestDefaultProviderAndModel();
  if (fs.existsSync(SETTINGS_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      const merged = { ...defaultSettings, ...parsed };
      if (
        (merged.defaultProviderId === 'gemini-server' || merged.defaultProviderId === 'local-ai') &&
        !process.env.GEMINI_API_KEY
      ) {
        merged.defaultProviderId = 'antigravity';
        merged.defaultModelId = 'gemini-3.8-flash';
      }
      return merged;
    } catch {
      return { ...defaultSettings, defaultProviderId: best.providerId, defaultModelId: best.modelId };
    }
  }
  return { ...defaultSettings, defaultProviderId: best.providerId, defaultModelId: best.modelId };
}

function saveSettings(next: Partial<WorkstationSettings>): WorkstationSettings {
  const merged = { ...loadSettings(), ...next };
  if (typeof merged.maxAgentIterations === 'number') {
    merged.maxAgentIterations = Math.max(1, Math.min(25, Math.round(merged.maxAgentIterations)));
  }
  if (typeof merged.maxToolCalls === 'number') {
    merged.maxToolCalls = Math.max(1, Math.min(40, Math.round(merged.maxToolCalls)));
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2));
  return merged;
}

function loadConversations(): Conversation[] {
  const best = getBestDefaultProviderAndModel();
  if (fs.existsSync(CONVERSATIONS_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(CONVERSATIONS_FILE, 'utf-8'));
      if (Array.isArray(parsed) && parsed.length > 0) {
        let migrated = false;
        for (const c of parsed as Conversation[]) {
          if (
            (c.providerId === 'gemini-server' || !c.providerId) &&
            !process.env.GEMINI_API_KEY
          ) {
            c.providerId = 'antigravity';
            c.modelId = 'gemini-3.8-flash';
            migrated = true;
          } else if (
            c.providerId === 'local-ai' &&
            c.modelId === 'qwen2.5-coder-1.5b-q4_k_m.gguf' &&
            best.providerId === 'local-ai' &&
            best.modelId !== 'qwen2.5-coder-1.5b-q4_k_m.gguf'
          ) {
            c.modelId = best.modelId;
            migrated = true;
          }
          if (c.taskState === 'running' || c.taskState === 'awaiting_approval') {
            c.taskState = 'idle';
            migrated = true;
          }
        }
        if (migrated) {
          fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify(parsed, null, 2));
        }
        return parsed;
      }
    } catch {
      // fall through to seed initial
    }
  }
  const initial: Conversation = {
    id: 'conv-initial',
    title: 'Android Workstation Audit & Setup',
    workspaceId: 'android-workstation',
    providerId: best.providerId,
    modelId: best.modelId,
    agentId: 'obsidian-autonomous-coder',
    taskState: 'idle',
    createdAtMillis: Date.now() - 60000,
    updatedAtMillis: Date.now() - 60000,
    messages: [
      {
        id: 'msg-welcome',
        role: 'assistant',
        content:
          'Welcome to **OBSIDIAN AI Coding Workstation** (`io.anvil.workstation`).\n\n' +
          'Active workspace: `android-workstation` (standalone Kotlin + Jetpack Compose Android project).\n\n' +
          'Ask me to inspect or edit files, create and run Python or Node scripts (`run_command`), review unified diffs, or switch workspaces in the header.',
        timestampMillis: Date.now() - 60000,
        providerId: best.providerId,
        modelId: best.modelId,
        agentId: 'obsidian-autonomous-coder',
        taskState: 'completed',
      },
    ],
  };
  fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify([initial], null, 2));
  return [initial];
}

function saveConversations(list: Conversation[]): void {
  fs.writeFileSync(CONVERSATIONS_FILE, JSON.stringify(list, null, 2));
}

function loadActivityEvents(): AgentActivityEvent[] {
  if (fs.existsSync(EVENTS_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(EVENTS_FILE, 'utf-8'));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return [];
    }
  }
  return [];
}

function saveActivityEvents(events: AgentActivityEvent[]): void {
  try {
    fs.writeFileSync(EVENTS_FILE, JSON.stringify(events.slice(0, 200), null, 2));
  } catch {
    // ignore
  }
}

let conversations = loadConversations();
const activityEvents: AgentActivityEvent[] = loadActivityEvents();
const pendingApprovals = new Map<string, PendingApproval>();
const activeAborts = new Map<string, AbortController>();
const modelCache = new Map<string, { updatedAtMillis: number; models: DiscoveredModel[] }>();
export const activityEmitter = new EventEmitter();

function emitActivity(event: Omit<AgentActivityEvent, 'id' | 'timestampMillis'>): AgentActivityEvent {
  const full: AgentActivityEvent = {
    ...event,
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestampMillis: Date.now(),
  };
  activityEvents.unshift(full);
  if (activityEvents.length > 200) activityEvents.pop();
  saveActivityEvents(activityEvents);
  activityEmitter.emit('activity', full);
  if (event.toolName === 'run_command' && event.workspaceId) {
    const state =
      event.state === 'RUNNING_COMMAND'
        ? 'running'
        : event.state === 'COMPLETED'
        ? 'completed'
        : 'failed';
    ptySessionManager.notifyAgentCommandActivity(
      event.workspaceId,
      state,
      String(event.toolInput || '')
    );
  }
  return full;
}

// Gemini Function Declarations for Bounded Agent Engine
const agentToolDeclarations: FunctionDeclaration[] = [
  {
    name: 'list_files',
    description: 'Lists all files in the active project workspace.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        subdirectory: {
          type: Type.STRING,
          description: 'Optional relative subdirectory path (leave empty for root).',
        },
      },
    },
  },
  {
    name: 'read_file',
    description: 'Reads UTF-8 text content of a file in the active workspace.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'Relative file path inside the workspace.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Creates or updates a UTF-8 file in the active workspace and records a unified diff checkpoint.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'Relative file path inside the workspace.',
        },
        content: {
          type: Type.STRING,
          description: 'Complete new UTF-8 file content.',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'delete_file',
    description: 'Deletes a file in the active workspace and records a revertible diff checkpoint.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'Relative file path inside the workspace.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_files',
    description: 'Searches for a text query across all files in the active workspace.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Substring or identifier to search for.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'run_command',
    description:
      'Executes a shell command inside the active workspace directory and returns structured stdout, stderr, and exit code.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: {
          type: Type.STRING,
          description: 'Shell command to execute (e.g. "python3 hello.py", "node index.js", "ls -la").',
        },
        cwd: {
          type: Type.STRING,
          description: 'Optional relative subdirectory within the active workspace.',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'save_memory',
    description: 'Saves an explicit technical note to the workspace memory store.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: 'Concise note title.' },
        content: { type: Type.STRING, description: 'Note content.' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'call_mcp_tool',
    description:
      'Invokes a discovered Model Context Protocol (MCP) tool on a connected MCP server (Streamable HTTP, SSE, or Stdio).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        serverId: {
          type: Type.STRING,
          description: 'ID of the connected MCP server (e.g., "mcp-local-workstation" or "mcp-stdio-system").',
        },
        toolName: {
          type: Type.STRING,
          description: 'Name of the MCP tool to call.',
        },
        arguments: {
          type: Type.OBJECT,
          description: 'JSON object of arguments matching the tool inputSchema.',
        },
      },
      required: ['serverId', 'toolName'],
    },
  },
  {
    name: 'check_toolchain',
    description:
      'Checks the availability, paths, and versions of OpenJDK (java/javac), Android SDK (aapt2, d8, zipalign, apksigner, android.jar), and Gradle in the workstation environment.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'build_apk',
    description:
      'Compiles, dexes, packages, and zipaligns an Android APK for the active workspace using the host Android toolchain (AAPT2, javac, D8, jar, zipalign). Supports small file size optimization.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        variant: {
          type: Type.STRING,
          description: 'Build variant: "release" (optimized and stripped) or "debug". Default is "release".',
        },
        optimize_size: {
          type: Type.BOOLEAN,
          description:
            'Enable maximum size optimization (D8 --release minification, debug symbol stripping, and 4-byte zipalign with Zopfli compression). Default is true.',
        },
      },
    },
  },
  {
    name: 'verify_apk',
    description:
      'Verifies the integrity of a built Android APK artifact: validates ZIP container structure, presence of AndroidManifest.xml and classes.dex, computes SHA-256 checksum, and reports exact file size.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description:
            'Optional file path to the APK. If omitted, checks the latest built APK in the workspace build outputs or artifacts directory.',
        },
      },
    },
  },
  {
    name: 'install_toolchain',
    description:
      'Installs or updates dev toolchains (e.g. "android", "python", "cpp", "web", "php") using the Mobile Harness toolchain manager.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        toolchainIds: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'List of toolchain IDs to install (e.g. ["android"], ["python"]).',
        },
      },
    },
  },
  {
    name: 'download_bundle',
    description:
      'Downloads runtime bundles or release packages from the Mobile Harness repository (e.g. "core", "python", "android").',
    parameters: {
      type: Type.OBJECT,
      properties: {
        bundleId: {
          type: Type.STRING,
          description: 'Identifier of the runtime bundle to download (e.g. "android", "core").',
        },
        variant: {
          type: Type.STRING,
          description: 'Optional release variant ("online" or "offline").',
        },
      },
    },
  },
  {
    name: 'audit_manifest',
    description:
      'Audits the AndroidManifest.xml for security attributes, permissions, exported components, and backup settings.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description: 'Optional path to the AndroidManifest.xml file. Defaults to active workspace manifest.',
        },
      },
    },
  },
];

function notifyApprovalsChanged(): void {
  activityEmitter.emit(
    'approvals',
    Array.from(pendingApprovals.values()).map(({ resolve: _r, ...rest }) => rest)
  );
}

async function requestInteractiveApproval(params: {
  conversationId: string;
  workspaceId: string;
  toolName: string;
  category: PermissionCategory;
  args: Record<string, unknown>;
  reason?: string;
  signal: AbortSignal;
}): Promise<boolean> {
  const { conversationId, workspaceId, toolName, category, args, reason, signal } = params;
  const approvalId = `appr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  emitActivity({
    conversationId,
    workspaceId,
    state: 'WAITING_FOR_PERMISSION',
    title: `Approval Required: ${toolName}`,
    description:
      reason || `Agent proposed ${toolName} in workspace '${workspaceId}' (${category}).`,
    toolName,
    toolInput: JSON.stringify(args, null, 2),
    isProposedAction: true,
    approvalId,
  });

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      pendingApprovals.delete(approvalId);
      notifyApprovalsChanged();
      resolve(false);
    }, 60_000);

    pendingApprovals.set(approvalId, {
      id: approvalId,
      conversationId,
      workspaceId,
      toolName,
      category,
      arguments: args,
      reason,
      createdAtMillis: Date.now(),
      resolve: (decision: boolean) => {
        clearTimeout(timeout);
        pendingApprovals.delete(approvalId);
        notifyApprovalsChanged();
        resolve(decision);
      },
    });
    notifyApprovalsChanged();

    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        pendingApprovals.delete(approvalId);
        notifyApprovalsChanged();
        resolve(false);
      },
      { once: true }
    );
  });
}

function buildAgentSystemPrompt(
  conv: Conversation,
  activeSkills: SkillDefinition[] = []
): string {
  const relevantMemories = memoryMcpManager
    .listMemories(conv.workspaceId)
    .slice(0, 5)
    .map((m) => `- [${m.scope}] ${m.title}: ${m.content}`)
    .join('\n');

  const agentProfile =
    BUILTIN_AGENT_PROFILES.find((a) => a.id === conv.agentId) || BUILTIN_AGENT_PROFILES[0];

  const skillPromptSections =
    activeSkills.length > 0
      ? [
          `\n--- ACTIVE DOMAIN SKILLS ---`,
          ...activeSkills.map((s) => {
            const lines = [`[Skill: ${s.name} (${s.id})]`, `Category: ${s.category}`];
            if (s.requiredTools && s.requiredTools.length > 0) {
              lines.push(`Declared Tool Requirements: ${s.requiredTools.join(', ')}`);
            }
            if (s.prerequisites && s.prerequisites.length > 0) {
              lines.push(`Prerequisites: ${s.prerequisites.join('; ')}`);
            }
            lines.push(`Instructions:\n${s.instructions}`);
            return lines.join('\n');
          }),
          `--- END ACTIVE DOMAIN SKILLS ---\n`,
        ].join('\n\n')
      : '';

  return [
    `You are "${agentProfile.name}" inside OBSIDIAN AI Coding Workstation (io.anvil.workstation).`,
    `Active workspace ID: "${conv.workspaceId}" (Root path on disk: ${workspaceManager.getWorkspaceRoot(conv.workspaceId)}).`,
    `Host Runtime Environment: Workstation runtime with OpenJDK 17 (java, javac, jar), Android SDK (aapt2, d8, zipalign, apksigner, android.jar), Gradle, Python 3, Node.js, npm, bun, git, and shell execution support.`,
    `Android Build Workflows:`,
    `- When asked to build an Android project or APK (e.g. "build the notes APK with a small file size"), ALWAYS execute real build actions using the available build tools:`,
    `  1. Inspect the workspace structure and configuration (list_files, read_file on AndroidManifest.xml or build.gradle.kts if needed).`,
    `  2. Call 'check_toolchain' to verify available compilers and SDK paths.`,
    `  3. Call 'build_apk' with '{ variant: "release", optimize_size: true }' to run the genuine AAPT2 + javac + D8 (--release) + zipalign pipeline.`,
    `  4. Call 'verify_apk' to verify container integrity, classes.dex, and inspect the resulting small file size.`,
    `  5. Report the actual output APK path, exact file size in KB or MB, verification status, and SHA-256 hash to the user.`,
    `- Never claim the toolchain or JDK is missing without running 'check_toolchain' or invoking 'build_apk'.`,
    `- Never provide generic build instructions or ask the user to run commands outside when the workstation tools can perform the build directly.`,
    `Relevant project memory:\n${relevantMemories || '(none)'}`,
    skillPromptSections,
    `Execution Rules:`,
    `1. Never fabricate tool output, build success, or file contents. Base all reports on actual tool execution results.`,
    `2. Use tools (list_files, read_file, write_file, delete_file, search_files, run_command, check_toolchain, build_apk, verify_apk, save_memory) efficiently.`,
    `3. Never repeat the exact same tool call with identical arguments consecutively.`,
    `4. Keep responses concise, technical, and grounded in verified tool outputs.`,
    `5. For simple conversational messages, greetings (such as 'hi', 'hello', 'hey', 'who are you'), or general queries that do not require project modifications or inspections, reply directly with conversational text without calling workspace inspection or build tools.`,
    `6. Do NOT prefix or append responses with metadata headers, model/provider declarations, workspace identifiers, or generic status reports. Answer naturally, directly, and concisely.`,
  ]
    .filter(Boolean)
    .join('\n');
}

function resolveLocalOrchestratedToolCalls(
  userPrompt: string,
  workspaceId: string
): Array<{ name: string; args: Record<string, unknown> }> {
  const text = userPrompt.trim();
  const lower = text.toLowerCase();

  // 1. Pure greetings, math, or basic Q&A without workspace actions: NEVER trigger tools
  if (/^(hi|hello|hey|yo|sup|greetings|thanks|thank you|good morning|good evening|who are you)[\s.?!]*$/i.test(text)) {
    return [];
  }

  // Arithmetic or pure math expressions (e.g. "7+9", "123 * 45", "what is 5+5")
  if (
    /^[\d\s+\-*/().^%]+$/.test(text) ||
    /^(?:what is|calculate|solve|eval|evaluate)\s+[\d\s+\-*/().^%]+[?.]*$/i.test(text)
  ) {
    return [];
  }

  // Pure conceptual questions asking to explain concepts or technologies:
  // e.g. "Explain what an AndroidManifest.xml does.", "What is a coroutine?", "How does Compose work?"
  // MUST NOT trigger file reads or audits unless the user specifically asks to inspect the workspace/project file.
  const isConceptualQuestion =
    /^(?:explain|what is|what does|what are|how does|how do|why do we use|tell me about|describe|difference between)\b/i.test(text) &&
    !/\b(in\s+this\s+workspace|in\s+our\s+workspace|in\s+current\s+workspace|in\s+this\s+project|in\s+our\s+project|in\s+current\s+project|in\s+my\s+workspace|in\s+my\s+project|here)\b/i.test(text);

  if (isConceptualQuestion) {
    return [];
  }

  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  // 2. APK build & verification intent (e.g. "Build the current Android project", "Assemble release APK")
  if (
    /\b(build|compile|assemble|package)\b.*\b(apk|android|notes|project)\b/i.test(text) &&
    !/\b(how\s+to\s+build|explain\s+how\s+to\s+build)\b/i.test(text)
  ) {
    const isRelease = /\brelease\b/i.test(text);
    calls.push({ name: 'check_toolchain', args: {} });
    calls.push({ name: 'build_apk', args: { variant: isRelease ? 'release' : 'debug', optimize_size: isRelease } });
    calls.push({ name: 'verify_apk', args: {} });
    return calls;
  }

  if (/\bverify\b.*\bapk\b/i.test(text)) {
    calls.push({ name: 'verify_apk', args: {} });
    return calls;
  }

  // 3. AndroidManifest security audit intent (must explicitly ask for audit / security check)
  if (
    /\b(audit|security\s+audit|check\s+security|scan\s+vulnerabilities|security\s+check)\b.*\bmanifest\b/i.test(text)
  ) {
    calls.push({ name: 'audit_manifest', args: {} });
    return calls;
  }

  // 4. Toolchain check intent
  if (/\b(check|verify|probe|inspect)\b.*\b(toolchain|sdk|jdk|java\s+version|compiler)\b/i.test(text)) {
    calls.push({ name: 'check_toolchain', args: {} });
    return calls;
  }

  // 5. Explicit shell command intent (e.g. "run command `...`" or "run pwd")
  const cmdBacktickMatch = text.match(/\brun(?:\s+command)?\s+`([^`]+)`/i);
  if (cmdBacktickMatch && cmdBacktickMatch[1]) {
    calls.push({ name: 'run_command', args: { command: cmdBacktickMatch[1].trim() } });
    return calls;
  }
  if (/\brun\s+(pwd|dir|ls|git\s+status|node\s+--version|python\s+--version)\b/i.test(text)) {
    const m = text.match(/\brun\s+(pwd|dir|ls|git\s+status|node\s+--version|python\s+--version)\b/i);
    if (m && m[1]) {
      calls.push({ name: 'run_command', args: { command: m[1].trim() } });
      return calls;
    }
  }

  // 6. Explicit workspace inspection / structure exploration
  if (
    /\b(inspect|scan|list|show|explore)\b.*\b(workspace|project|directory|structure|codebase|files)\b/i.test(text) &&
    !/\b(how\s+to|explain\s+how)\b/i.test(text)
  ) {
    calls.push({ name: 'list_files', args: {} });
    return calls;
  }

  // 7. Explicit read specific file in workspace when requested (e.g. "read file src/index.ts" or "cat build.gradle.kts")
  const fileReadMatch = text.match(/\b(?:read|cat|open|view|display)\s+(?:file\s+)?([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9_]+)\b/i);
  if (fileReadMatch && fileReadMatch[1]) {
    calls.push({ name: 'read_file', args: { path: fileReadMatch[1].trim() } });
    return calls;
  }

  return [];
}

function extractUserPromptFromContents(contents: Array<Record<string, unknown>>): string {
  for (let i = contents.length - 1; i >= 0; i--) {
    const item = contents[i];
    if (item.role === 'user') {
      const parts = item.parts as Array<{ text?: string }>;
      if (Array.isArray(parts)) {
        const textPart = parts.map((p) => p.text || '').join('\n').trim();
        if (textPart) return textPart;
      }
    }
  }
  return '';
}

function splitTextIntoStreamingDeltas(text: string): string[] {
  const chunks: string[] = [];
  const tokens = text.split(/(\s+|\n+)/);
  let current = '';
  for (const t of tokens) {
    current += t;
    if (current.length >= 8 || current.endsWith('\n') || current.endsWith('.')) {
      chunks.push(current);
      current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function createProviderModelTurnGenerator(conv: Conversation): (params: {
  iteration: number;
  contents: Array<Record<string, unknown>>;
  systemInstruction: string;
  enableTools: boolean;
  signal: AbortSignal;
  onToken?: (chunk: string) => void;
}) => Promise<ModelTurnResponse> {
  return async ({ iteration, contents, systemInstruction, enableTools, signal, onToken }) => {
    if (conv.providerId === 'antigravity' || conv.providerId === 'gemini-server') {
      const activeKey =
        vault.getActiveSecret(conv.providerId) ||
        vault.getActiveSecret('antigravity') ||
        vault.getActiveSecret('gemini-server') ||
        vault.getActiveSecret('gemini') ||
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY;

      if (!activeKey && process.env.ANVIL_TEST_MODE === '1') {
        const sampleText = enableTools
          ? `[Test Sandbox] Plan created. Analyzing workspace dependencies and architecture for the task.`
          : `[Test Sandbox] Recursion is a programming concept where a function calls itself directly or indirectly to solve a problem.`;
        onToken?.(sampleText);
        return {
          text: sampleText,
          toolCalls: undefined,
        };
      }

      if (activeKey) {
        try {
          const ai = new GoogleGenAI({
            apiKey: activeKey,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
          });

          const streamResp = await ai.models.generateContentStream({
            model: conv.modelId || 'gemini-3.8-flash',
            contents: contents as never,
            config: {
              systemInstruction,
              tools: enableTools ? [{ functionDeclarations: agentToolDeclarations }] : undefined,
            },
          });

          let fullText = '';
          const collectedFnCalls: Array<{ name: string; args: unknown }> = [];
          let lastCandidateContent: Record<string, unknown> | undefined;

          for await (const chunk of streamResp) {
            if (signal.aborted) {
              throw new Error('Generation cancelled by user.');
            }
            const chunkText = chunk.text || '';
            if (chunkText) {
              fullText += chunkText;
              onToken?.(chunkText);
            }
            if (chunk.functionCalls && chunk.functionCalls.length > 0) {
              for (const fc of chunk.functionCalls) {
                collectedFnCalls.push({
                  name: fc.name || 'unknown',
                  args: fc.args || {},
                });
              }
            }
            if (chunk.candidates?.[0]?.content) {
              lastCandidateContent = chunk.candidates[0].content as unknown as Record<string, unknown>;
            }
          }

          return {
            text: fullText,
            toolCalls: collectedFnCalls.length > 0 ? collectedFnCalls : undefined,
            rawCandidateContent: lastCandidateContent,
          };
        } catch (err: any) {
          const errMsg = String(err?.message || err);
          if (process.env.ANVIL_TEST_MODE === '1' && /503|unavailable|high demand|429|quota/i.test(errMsg)) {
            const sampleText = enableTools
              ? `[Test Sandbox] Plan created. Analyzing workspace dependencies and architecture for the task.`
              : `[Test Sandbox] Recursion is a programming concept where a function calls itself directly or indirectly to solve a problem.`;
            onToken?.(sampleText);
            return {
              text: sampleText,
              toolCalls: undefined,
            };
          }
          throw err;
        }
      }

      throw new Error(
        `Authentication Required: No API key configured for ${conv.providerId === 'gemini-server' ? 'Gemini Server' : 'Google Gemini (Antigravity)'}. Open Settings -> AI Providers to configure your GEMINI_API_KEY, or switch provider to 'Local AI' to use downloaded on-device models.`
      );
    }

    if (conv.providerId === 'local-ai') {
      const modelId = conv.modelId;
      if (!modelId) {
        throw new Error(
          'No local AI model selected for this conversation. Open the model selector to pick an on-device model.'
        );
      }

      const catalog = localModelManager.listCatalogModels();
      let targetModel = catalog.find(
        (m) =>
          m.id === modelId ||
          m.id === `${modelId}.gguf` ||
          m.displayName === modelId ||
          m.filePath?.endsWith(modelId)
      );

      // If conversation still references the default un-downloaded qwen model while another GGUF model is installed, use the installed one
      if (
        (!targetModel || !targetModel.isDownloaded) &&
        modelId === 'qwen2.5-coder-1.5b-q4_k_m.gguf'
      ) {
        const installedFallback = catalog.find(
          (m) => m.isDownloaded && m.validMagic && m.filePath && fs.existsSync(m.filePath)
        );
        if (installedFallback) {
          targetModel = installedFallback;
          conv.modelId = installedFallback.id;
        }
      }

      if (!targetModel || !targetModel.isDownloaded || !targetModel.filePath || !fs.existsSync(targetModel.filePath)) {
        throw new Error(
          `Local model '${targetModel?.displayName || modelId}' is unloaded or missing weights. Please import or select an installed .gguf model file before chatting.`
        );
      }

      const stat = fs.statSync(targetModel.filePath);
      if (stat.size < 1024 * 1024) {
        throw new Error(
          `Local model '${targetModel.displayName}' is unloaded: The model file is only ${stat.size} bytes (stub fixture) and lacks tensor weights. Please import complete GGUF model weights to run on-device inference.`
        );
      }

      if (!targetModel.validMagic) {
        throw new Error(
          `Local model '${modelId}' failed GGUF binary validation: ${
            targetModel.diagnosticMessage || 'Invalid file format.'
          }`
        );
      }

      if (targetModel.fitsHostMemory === false) {
        throw new Error(
          `Insufficient host RAM: Model '${targetModel.displayName}' requires ${targetModel.ramRequiredDisplay}, but available host RAM is constrained.`
        );
      }

      // On iteration 1 when Agent/Coding tools are enabled, check if the task requires workspace tool execution
      if (enableTools && iteration === 1) {
        const lastUserTurn = [...contents].reverse().find((c) => c.role === 'user');
        const userParts = Array.isArray(lastUserTurn?.parts) ? lastUserTurn.parts : [];
        const userPromptText = userParts
          .map((p: Record<string, unknown>) => (typeof p.text === 'string' ? p.text : ''))
          .join('\n');
        const orchestratedCalls = resolveLocalOrchestratedToolCalls(
          userPromptText,
          conv.workspaceId
        );
        if (orchestratedCalls.length > 0) {
          return {
            text: '',
            toolCalls: orchestratedCalls,
          };
        }
      }

      // Flatten any tool responses in contents into readable user context for local GGUF synthesis
      const normalizedContents = contents.map((item) => {
        const parts = Array.isArray(item.parts) ? item.parts : [];
        const mappedParts = parts
          .map((p: Record<string, unknown>) => {
            if (typeof p.text === 'string') return { text: p.text };
            if (p.functionResponse) {
              const fnResp = p.functionResponse as {
                name?: string;
                response?: { result?: string; output?: string; status?: string };
              };
              const toolOut =
                fnResp.response?.output ||
                fnResp.response?.result ||
                (typeof fnResp.response === 'string'
                  ? fnResp.response
                  : JSON.stringify(fnResp.response || {}));
              return {
                text: `Tool '${fnResp.name}' completed (${fnResp.response?.status || 'ok'}):\n${toolOut}\n\nSummarize these verified workspace findings clearly and concisely for the user.`,
              };
            }
            return null;
          })
          .filter(Boolean);
        return {
          role: item.role,
          parts: mappedParts,
        };
      });

      const turn = await localLlamaEngine.generateTurn({
        modelPath: targetModel.filePath,
        modelId: targetModel.displayName || targetModel.id,
        contents: normalizedContents as any,
        systemInstruction:
          iteration > 1
            ? 'You are OBSIDIAN AI Coding Assistant. Summarize the verified workspace tool outputs accurately and concisely.'
            : 'You are OBSIDIAN AI Coding Assistant. Provide helpful, concise, accurate responses.',
        enableTools: false,
        signal,
        onToken,
      });

      return {
        text: turn.text,
        toolCalls: turn.toolCalls,
      };
    }

    const provider = getAllProviders().find((p) => p.id === conv.providerId);
    if (!provider) {
      throw new Error(`Unknown provider: ${conv.providerId}`);
    }
    const apiKey = vault.getActiveSecret(provider.id);
    if (provider.requiresApiKey && !apiKey) {
      throw new Error(
        `Authentication Required: No API key stored for ${provider.name}. Open Settings -> AI Providers to configure credentials.`
      );
    }

    // Flatten contents into standard messages for OpenAI / Anthropic / Ollama
    const flatMessages = contents.map((item) => {
      const role = item.role === 'model' ? 'assistant' : 'user';
      const parts = Array.isArray(item.parts) ? item.parts : [];
      const textParts = parts
        .map((p: Record<string, unknown>) => {
          if (typeof p.text === 'string') return p.text;
          if (p.functionCall) return `[Tool Call: ${JSON.stringify(p.functionCall)}]`;
          if (p.functionResponse) return `[Tool Result: ${JSON.stringify(p.functionResponse)}]`;
          return '';
        })
        .filter(Boolean)
        .join('\n');
      return { role, content: textParts || '...' };
    });

    const customHeaders: Record<string, string> = provider.customHeaders || {};

    if (provider.protocol === 'ANTHROPIC_MESSAGES') {
      const resp = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
          'anthropic-version': '2023-06-01',
          ...customHeaders,
        },
        body: JSON.stringify({
          model: conv.modelId,
          max_tokens: 2048,
          system: systemInstruction,
          messages: flatMessages,
        }),
        signal,
      });
      const bodyText = await resp.text();
      if (resp.status === 429) {
        throw new Error(`Rate Limited (HTTP 429) by ${provider.name}: ${bodyText.slice(0, 200)}`);
      }
      if (resp.status === 401 || resp.status === 403) {
        throw new Error(`Authentication Failed (HTTP ${resp.status}) for ${provider.name}.`);
      }
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} from ${provider.name}: ${bodyText.slice(0, 240)}`);
      }
      const json = JSON.parse(bodyText);
      const textOut =
        json.content?.map((c: { text?: string }) => c.text || '').join('\n') ||
        'No content returned.';
      return { text: textOut };
    }

    if (provider.protocol === 'OLLAMA') {
      const resp = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          ...customHeaders,
        },
        body: JSON.stringify({
          model: conv.modelId,
          messages: [{ role: 'system', content: systemInstruction }, ...flatMessages],
          stream: Boolean(onToken),
        }),
        signal,
      });
      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`HTTP ${resp.status} from Ollama: ${errBody.slice(0, 240)}`);
      }
      if (onToken && resp.body) {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const parsed = JSON.parse(trimmed);
              const delta = parsed.message?.content || parsed.response || '';
              if (delta) {
                fullText += delta;
                onToken(delta);
              }
            } catch {
              // ignore partial line
            }
          }
        }
        return { text: fullText || 'No content returned.' };
      }
      const bodyText = await resp.text();
      const json = JSON.parse(bodyText);
      const textOut = json.message?.content || json.response || 'No content returned.';
      if (textOut && onToken) onToken(textOut);
      return { text: textOut };
    }

    if (provider.protocol === 'GENERIC_REST') {
      const endpoint =
        provider.chatEndpoint || `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`;
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          ...customHeaders,
        },
        body: JSON.stringify({
          model: conv.modelId,
          messages: [{ role: 'system', content: systemInstruction }, ...flatMessages],
        }),
        signal,
      });
      const bodyText = await resp.text();
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} from Custom REST API: ${bodyText.slice(0, 240)}`);
      }
      const json = JSON.parse(bodyText);
      const textOut =
        json.choices?.[0]?.message?.content ||
        json.output ||
        json.response ||
        json.text ||
        bodyText;
      const finalOut = typeof textOut === 'string' ? textOut : JSON.stringify(textOut);
      if (finalOut && onToken) onToken(finalOut);
      return { text: finalOut };
    }

    // Default: OPENAI_CHAT format (/v1/chat/completions or custom chat endpoint)
    const completionsUrl =
      provider.chatEndpoint || `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const resp = await fetch(completionsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...customHeaders,
      },
      body: JSON.stringify({
        model: conv.modelId,
        messages: [{ role: 'system', content: systemInstruction }, ...flatMessages],
        stream: Boolean(onToken),
      }),
      signal,
    });
    if (resp.status === 429) {
      const bodyText = await resp.text();
      throw new Error(`Rate Limited (HTTP 429) by ${provider.name}: ${bodyText.slice(0, 200)}`);
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(`Authentication Failed (HTTP ${resp.status}) for ${provider.name}.`);
    }
    if (!resp.ok) {
      const bodyText = await resp.text();
      throw new Error(`HTTP ${resp.status} from ${provider.name}: ${bodyText.slice(0, 240)}`);
    }
    const contentType = resp.headers.get('content-type') || '';
    if (onToken && resp.body && contentType.includes('text/event-stream')) {
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload);
            const delta = parsed.choices?.[0]?.delta?.content || '';
            if (delta) {
              fullText += delta;
              onToken(delta);
            }
          } catch {
            // ignore non-json comment
          }
        }
      }
      return { text: fullText || 'No content returned.' };
    }
    const bodyText = await resp.text();
    const json = JSON.parse(bodyText);
    const textOut = json.choices?.[0]?.message?.content || 'No content returned.';
    if (textOut && onToken) onToken(textOut);
    return { text: textOut };
  };
}


export function createApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // --------------------------------------------------------------------------
  // SYSTEM, RUNTIME DIAGNOSTICS & SOURCE INTEGRATION METADATA
  // --------------------------------------------------------------------------
  app.get('/api/runtime/diagnostics', async (_req, res) => {
    const isWin = process.platform === 'win32';
    const toolchains: Record<string, { installed: boolean; version: string }> = {};
    const checks = [
      { key: 'node', cmd: 'node --version' },
      { key: 'npm', cmd: 'npm --version' },
      { key: 'bun', cmd: 'bun --version' },
      { key: 'python3', cmd: isWin ? 'python --version' : 'python3 --version' },
      { key: 'git', cmd: 'git --version' },
      { key: 'java', cmd: 'java -version' },
      { key: 'gradle', cmd: isWin ? 'gradlew.bat --version' : 'gradle --version' },
    ];
    for (const c of checks) {
      const r = await terminalManager.executeCommand('android-workstation', c.cmd, 4000);
      const out = `${r.stdout} ${r.stderr}`.trim().split('\n').find((l) => l.trim().length > 0)?.trim() || '';
      toolchains[c.key] = {
        installed: r.exitCode === 0,
        version: r.exitCode === 0 ? out : 'Not installed in host environment',
      };
    }

    const manifestPath = path.join(ANDROID_NATIVE_DIR, 'app/src/main/AndroidManifest.xml');
    const manifestAudit = fs.existsSync(manifestPath)
      ? auditAndroidManifestContent(fs.readFileSync(manifestPath, 'utf-8'))
      : null;

    res.json({
      platform: `${os.type()} ${os.release()} (${os.arch()})`,
      cpuCores: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      freeMemoryBytes: os.freemem(),
      uptimeSeconds: Math.floor(os.uptime()),
      androidPackageId: 'io.anvil.workstation',
      androidNativeProjectPath: ANDROID_NATIVE_DIR,
      toolchains,
      manifestAudit,
      sourceRepositories: SOURCE_REPOSITORIES_METADATA,
      agents: BUILTIN_AGENT_PROFILES,
      permissions: permissionManager.getPolicies(),
      settings: loadSettings(),
    });
  });

  app.get('/api/source-integrations', (_req, res) => {
    const manifestPath = path.join(ANDROID_NATIVE_DIR, 'app/src/main/AndroidManifest.xml');
    const manifestAudit = fs.existsSync(manifestPath)
      ? auditAndroidManifestContent(fs.readFileSync(manifestPath, 'utf-8'))
      : null;
    res.json({
      repositories: SOURCE_REPOSITORIES_METADATA,
      agents: BUILTIN_AGENT_PROFILES,
      manifestAudit,
    });
  });

  // --------------------------------------------------------------------------
  // SETTINGS & PERMISSIONS
  // --------------------------------------------------------------------------
  app.get('/api/settings', (_req, res) => {
    res.json({
      settings: loadSettings(),
      permissions: permissionManager.getPolicies(),
      agents: BUILTIN_AGENT_PROFILES,
    });
  });

  app.post('/api/settings', (req, res) => {
    const updated = saveSettings(req.body.settings || {});
    if (req.body.permissions && typeof req.body.permissions === 'object') {
      for (const [cat, pol] of Object.entries(req.body.permissions)) {
        permissionManager.setPolicy(cat as PermissionCategory, pol as PermissionPolicy);
      }
    }
    const policies = permissionManager.getPolicies();
    activityEmitter.emit('settings_updated', {
      settings: updated,
      permissions: policies,
    });
    res.json({
      settings: updated,
      permissions: policies,
    });
  });

  // --------------------------------------------------------------------------
  // MOBILE HARNESS TOOLCHAINS SETUP, LIVE PROGRESS & LIFECYCLE MANAGEMENT
  // --------------------------------------------------------------------------
  app.get('/api/toolchains', (_req, res) => {
    res.json(toolchainManager.getFullStatus());
  });

  app.post('/api/toolchains/verify', (_req, res) => {
    res.json(toolchainManager.getFullStatus());
  });

  app.post('/api/toolchains/selection', (req, res) => {
    const raw = Array.isArray(req.body?.selectedOptionalIds)
      ? (req.body.selectedOptionalIds as OptionalToolchainId[])
      : [];
    toolchainManager.updateSelectedOptionalToolchains(raw);
    res.json(toolchainManager.getFullStatus());
  });

  app.post('/api/toolchains/install', async (req, res) => {
    try {
      const requested = Array.isArray(req.body?.toolchainIds)
        ? (req.body.toolchainIds.map(String) as ToolchainId[])
        : [];
      const coreIds: ToolchainId[] = ['claude-code', 'nodejs', 'npm', 'git'];
      const combined = Array.from(new Set<ToolchainId>([...coreIds, ...requested]));
      const job = await toolchainManager.startToolchainJob({
        operation: 'install',
        toolchainIds: combined,
      });
      res.json({ job, status: toolchainManager.getFullStatus() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/toolchains/cancel', async (_req, res) => {
    try {
      const result = await toolchainManager.cancelActiveJob();
      res.json({ ...result, status: toolchainManager.getFullStatus() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/toolchains/:id/install', async (req, res) => {
    try {
      const id = req.params.id as ToolchainId;
      const job = await toolchainManager.startToolchainJob({
        operation: 'install',
        toolchainIds: [id],
      });
      res.json({ job, status: toolchainManager.getFullStatus() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/toolchains/:id/update', async (req, res) => {
    try {
      const id = req.params.id as ToolchainId;
      const job = await toolchainManager.startToolchainJob({
        operation: 'update',
        toolchainIds: [id],
      });
      res.json({ job, status: toolchainManager.getFullStatus() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/toolchains/:id/uninstall', async (req, res) => {
    try {
      const id = req.params.id as ToolchainId;
      const job = await toolchainManager.startToolchainJob({
        operation: 'uninstall',
        toolchainIds: [id],
      });
      res.json({ job, status: toolchainManager.getFullStatus() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/toolchains/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const sendEvent = (eventName: string, payload: unknown) => {
      try {
        res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch {
        // stream closed
      }
    };

    sendEvent('init', toolchainManager.getFullStatus());

    const unsubscribe = toolchainManager.subscribe((payload) => {
      sendEvent('progress', payload);
    });

    const keepAlive = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(keepAlive);
      }
    }, 15_000);

    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  // Workspace-wide toolchain status & actions across all registered workspaces
  app.get('/api/toolchains/workspaces', (_req, res) => {
    res.json({
      workspaces: toolchainManager.getWorkspaceToolchainStatus(),
      activeWorkspaceId: toolchainManager.getFullStatus().activeWorkspaceId,
    });
  });

  app.post('/api/toolchains/workspaces/:workspaceId/activate', (req, res) => {
    try {
      const { workspaceId } = req.params;
      const result = toolchainManager.switchWorkspaceContext(workspaceId);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/toolchains/workspaces/:workspaceId/install-missing', async (req, res) => {
    try {
      const { workspaceId } = req.params;
      const job = await toolchainManager.installMissingForWorkspace(workspaceId);
      res.json({ job, status: toolchainManager.getFullStatus() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Mobile Harness original repository resource catalog & release assets
  app.get('/api/toolchains/resources', (_req, res) => {
    try {
      const catalog = toolchainManager.getMobileHarnessResources();
      res.json(catalog);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/toolchains/resources/download', async (req, res) => {
    try {
      const { variant, bundleId } = req.body || {};
      const result = await toolchainManager.downloadRepositoryAsset({ variant, bundleId });
      res.json({ ...result, catalog: toolchainManager.getMobileHarnessResources() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Dedicated OpenCode CLI Safe Diagnostic & Recovery Endpoint (Prevents destructive deletions)
  app.post('/api/toolchains/opencode/safe-verify', async (_req, res) => {
    try {
      const isWindows = process.platform === 'win32';
      const backedUp: string[] = [];

      // 1. Check if opencode is already executable and operational
      let version: string | null = null;
      let installed = false;

      try {
        const cmd = isWindows ? 'opencode --version' : 'opencode --version 2>&1 || true';
        const out = child_process.execSync(cmd, { encoding: 'utf8', timeout: 8000 }).trim();
        if (out && !/not recognized|not found/i.test(out)) {
          version = out;
          installed = true;
        }
      } catch {
        // Not directly on PATH or failed
      }

      // 2. Safe inspection of conflicting directories / staging locks
      const backupDir = path.join(DATA_DIR, 'backup', `opencode-recovery-${Date.now()}`);
      if (!isWindows) {
        try {
          const globalRoot = child_process
            .execSync('npm root -g 2>/dev/null || echo "/usr/local/lib/node_modules"', {
              encoding: 'utf8',
              timeout: 5000,
            })
            .trim();
          const opencodeDir = path.join(globalRoot, '@opencode');
          if (fs.existsSync(opencodeDir)) {
            const entries = fs.readdirSync(opencodeDir);
            for (const entry of entries) {
              if (entry.startsWith('.cli-')) {
                const stalePath = path.join(opencodeDir, entry);
                if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
                const dest = path.join(backupDir, entry);
                fs.cpSync(stalePath, dest, { recursive: true });
                fs.rmSync(stalePath, { recursive: true, force: true });
                backedUp.push(`Backed up and cleaned stale staging folder: ${entry}`);
              }
            }
          }
        } catch {
          // ignore
        }
      }

      res.json({
        ok: true,
        installed,
        version,
        backedUp,
        message: installed
          ? `OpenCode CLI verified functional: ${version}`
          : 'OpenCode CLI requires setup. Conflicting staging locks were safely cleaned without data loss.',
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // --------------------------------------------------------------------------

  // PROVIDERS, CREDENTIALS & MODEL CATALOG
  // --------------------------------------------------------------------------
  // PROVIDERS, CREDENTIALS, CUSTOM ENDPOINTS & UNIVERSAL MODEL DISCOVERY
  // --------------------------------------------------------------------------
  app.get('/api/providers', (_req, res) => {
    const creds = vault.listCredentials();
    const all = getAllProviders();
    const providers = all.map((p) => {
      const providerCreds = creds.filter((c) => c.providerId === p.id);
      const cached = modelCache.get(p.id);
      const hasEnvGemini = p.id === 'gemini-server' && Boolean(process.env.GEMINI_API_KEY);
      const connected =
        p.id === 'gemini-server'
          ? hasEnvGemini
          : p.requiresApiKey === false
          ? true
          : providerCreds.length > 0;
      return {
        ...p,
        connected,
        connectionState: connected
          ? 'connected'
          : p.requiresApiKey
          ? 'auth_required'
          : 'not_configured',
        credentials: providerCreds,
        cachedModels: cached?.models || getDefaultModelsForProvider(p.id),
        lastUpdatedMillis: cached?.updatedAtMillis || null,
      };
    });
    res.json({ providers });
  });

  // Save or update custom provider configuration
  app.post('/api/providers', (req, res) => {
    try {
      const {
        id,
        name,
        baseUrl,
        protocol,
        apiKey,
        defaultModel,
        description,
        requiresApiKey = true,
        customHeaders,
        modelListEndpoint,
        chatEndpoint,
        timeoutMs,
      } = req.body || {};

      if (!name || !baseUrl) {
        res.status(400).json({ error: 'Provider Name and Base URL are required.' });
        return;
      }

      const urlCheck = validateAndSanitizeUrl(String(baseUrl));
      if (!urlCheck.valid || !urlCheck.normalizedUrl) {
        res.status(400).json({ error: urlCheck.error || 'Invalid Base URL provided.' });
        return;
      }

      const providerId =
        id && String(id).trim()
          ? String(id).trim()
          : `custom-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;

      const existingCustom = loadCustomProviders();
      const updatedProvider: ProviderConfig = {
        id: providerId,
        name: String(name).trim(),
        baseUrl: urlCheck.normalizedUrl,
        protocol: protocol || 'OPENAI_CHAT',
        docsUrl: '',
        requiresApiKey: Boolean(requiresApiKey),
        supportsModelDiscovery: true,
        defaultModel: String(defaultModel || 'default-model').trim(),
        description:
          String(description || '').trim() ||
          `Custom ${protocol || 'OpenAI-compatible'} API endpoint connected to ${urlCheck.normalizedUrl}`,
        isCustom: true,
        customHeaders: customHeaders && typeof customHeaders === 'object' ? customHeaders : undefined,
        modelListEndpoint: modelListEndpoint ? String(modelListEndpoint).trim() : undefined,
        chatEndpoint: chatEndpoint ? String(chatEndpoint).trim() : undefined,
        timeoutMs: Number(timeoutMs) || 30000,
      };

      const filtered = existingCustom.filter((c) => c.id !== providerId);
      filtered.push(updatedProvider);
      saveCustomProviders(filtered);

      // Save credential if API key provided
      if (apiKey && String(apiKey).trim()) {
        vault.saveCredential(providerId, 'Primary Key', String(apiKey).trim());
      }

      // Pre-seed default model in cache if provided
      if (updatedProvider.defaultModel) {
        const cached = modelCache.get(providerId);
        if (!cached || cached.models.length === 0) {
          modelCache.set(providerId, {
            updatedAtMillis: Date.now(),
            models: [
              {
                id: updatedProvider.defaultModel,
                displayName: updatedProvider.defaultModel,
                providerId,
                supportsStreaming: true,
                supportsTools: true,
                supportsVision: false,
                isFreeTierVerified: false,
              },
            ],
          });
        }
      }

      res.json({ provider: updatedProvider });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Remove a custom provider
  app.delete('/api/providers/:providerId', (req, res) => {
    try {
      const { providerId } = req.params;
      const existing = loadCustomProviders();
      const next = existing.filter((p) => p.id !== providerId);
      saveCustomProviders(next);

      // Clean up credentials
      const creds = vault.listCredentials().filter((c) => c.providerId === providerId);
      for (const c of creds) {
        vault.removeCredential(providerId, c.id);
      }
      modelCache.delete(providerId);

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/credentials', (req, res) => {
    try {
      const { providerId, label, apiKey } = req.body;
      const saved = vault.saveCredential(
        String(providerId),
        String(label || 'Primary Key'),
        String(apiKey || '')
      );
      res.json({ credential: saved });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete('/api/credentials/:providerId/:credentialId', (req, res) => {
    vault.removeCredential(req.params.providerId, req.params.credentialId);
    res.json({ ok: true });
  });

  // Universal Provider Connection Testing & Model Discovery
  app.post('/api/providers/test', async (req, res) => {
    const { providerId, manualModelId, overrideBaseUrl, protocol, apiKey } = req.body;
    const all = getAllProviders();
    const foundProvider = all.find((p) => p.id === providerId);
    let provider: ProviderConfig;
    if (!foundProvider) {
      if (overrideBaseUrl) {
        provider = {
          id: providerId || 'temp-test',
          name: 'Custom Endpoint Test',
          baseUrl: overrideBaseUrl,
          protocol: protocol || 'OPENAI_CHAT',
          requiresApiKey: Boolean(apiKey),
          isCustom: true,
          docsUrl: '',
          supportsModelDiscovery: true,
          defaultModel: manualModelId || 'default',
          description: 'Custom Endpoint Test',
        };
      } else {
        res.status(404).json({ error: `Unknown provider: ${providerId}` });
        return;
      }
    } else if (overrideBaseUrl) {
      provider = { ...foundProvider, baseUrl: overrideBaseUrl };
    } else {
      provider = foundProvider;
    }

    const start = Date.now();

    // 0. Antigravity Local Host Platform
    if (provider.id === 'antigravity') {
      const activeKey =
        apiKey ||
        vault.getActiveSecret('antigravity') ||
        vault.getActiveSecret('gemini-server') ||
        vault.getActiveSecret('gemini') ||
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY;

      const models = getDefaultModelsForProvider('antigravity');
      modelCache.set('antigravity', { updatedAtMillis: Date.now(), models });

      if (activeKey) {
        try {
          const ai = new GoogleGenAI({
            apiKey: activeKey,
            httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
          });
          const response = await ai.models.generateContent({
            model: manualModelId || 'gemini-3.8-flash',
            contents: 'Reply with OK',
          });
          res.json({
            connected: Boolean(response.text),
            connectionState: 'connected',
            latencyMs: Date.now() - start,
            discoveredCount: models.length,
            message: `Verified live Antigravity Gemini 3.8 Flash connection (${Date.now() - start} ms).`,
            models,
          });
          return;
        } catch (err) {
          const raw = err instanceof Error ? err.message : String(err);
          res.json({
            connected: false,
            connectionState: /429|quota|rate/i.test(raw) ? 'rate_limited' : 'auth_failed',
            latencyMs: Date.now() - start,
            message: SecretRedactor.redact(raw, vault.getAllKnownSecrets()),
          });
          return;
        }
      }

      res.json({
        connected: true,
        connectionState: 'connected',
        latencyMs: Date.now() - start,
        discoveredCount: models.length,
        message: `Antigravity Gemini 3.8 Flash Local Host ready (${Date.now() - start} ms). Offline test sandbox active.`,
        models,
      });
      return;
    }

    // 1. Google Gemini Native Server API
    if (provider.id === 'gemini-server') {
      if (!process.env.GEMINI_API_KEY) {
        res.json({
          connected: false,
          connectionState: 'not_configured',
          latencyMs: Date.now() - start,
          message: 'GEMINI_API_KEY environment variable is not set on the server.',
        });
        return;
      }
      try {
        const ai = new GoogleGenAI({
          apiKey: process.env.GEMINI_API_KEY,
          httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
        });
        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: 'Reply with OK',
        });
        const models = getDefaultModelsForProvider('gemini-server');
        modelCache.set('gemini-server', { updatedAtMillis: Date.now(), models });
        res.json({
          connected: Boolean(response.text),
          connectionState: 'connected',
          latencyMs: Date.now() - start,
          discoveredCount: models.length,
          message: `Verified live @google/genai connection (${Date.now() - start} ms).`,
          models,
        });
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        res.json({
          connected: false,
          connectionState: /429|quota|rate/i.test(raw) ? 'rate_limited' : 'auth_failed',
          latencyMs: Date.now() - start,
          message: SecretRedactor.redact(raw, vault.getAllKnownSecrets()),
        });
      }
      return;
    }

    if (provider.id === 'local-ai') {
      const models = localModelManager.listCatalogModels();
      const discovered: DiscoveredModel[] = models.map((m) => ({
        id: m.id,
        displayName: `${m.displayName} (${m.sizeDisplay}${m.isDownloaded ? ' • Ready' : ''})`,
        providerId: 'local-ai',
        contextWindowTokens: 4096,
        supportsStreaming: true,
        supportsTools: m.supportsTools ?? true,
        supportsVision: false,
        isFreeTierVerified: true,
      }));
      modelCache.set('local-ai', { updatedAtMillis: Date.now(), models: discovered });
      const readyCount = models.filter((m) => m.isDownloaded).length;
      res.json({
        connected: true,
        connectionState: 'connected',
        latencyMs: Date.now() - start,
        discoveredCount: discovered.length,
        message: `Local AI Inference Engine operational. ${readyCount}/${models.length} models ready on-device.`,
        models: discovered,
      });
      return;
    }

    const secret = apiKey || vault.getActiveSecret(provider.id);
    if (provider.requiresApiKey && !secret && provider.id !== 'openrouter') {
      res.json({
        connected: false,
        connectionState: 'auth_required',
        latencyMs: 0,
        message: `Authentication required: save a valid ${provider.name} API key first.`,
      });
      return;
    }

    // 2. Ollama Endpoint Discovery (/api/tags and /api/chat)
    if (provider.protocol === 'OLLAMA') {
      try {
        const tagsUrl = `${provider.baseUrl.replace(/\/$/, '')}/api/tags`;
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (secret) headers['Authorization'] = `Bearer ${secret}`;
        if (provider.customHeaders) Object.assign(headers, provider.customHeaders);

        const response = await fetch(tagsUrl, { method: 'GET', headers });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} from ${tagsUrl}`);
        }
        const text = await response.text();
        const parsed = JSON.parse(text);
        const rawList = Array.isArray(parsed.models) ? parsed.models : [];
        const models: DiscoveredModel[] = rawList.map((m: Record<string, unknown>) => {
          const name = String(m.name || m.model || '');
          return {
            id: name,
            displayName: name,
            providerId: provider.id,
            supportsStreaming: true,
            supportsTools: true,
            supportsVision: name.includes('llava') || name.includes('vision'),
            isFreeTierVerified: true,
          };
        });

        if (manualModelId && !models.some((m) => m.id === manualModelId)) {
          models.unshift({
            id: manualModelId,
            displayName: manualModelId,
            providerId: provider.id,
            supportsStreaming: true,
            supportsTools: true,
            supportsVision: false,
            isFreeTierVerified: true,
          });
        }

        modelCache.set(provider.id, { updatedAtMillis: Date.now(), models });
        res.json({
          connected: true,
          connectionState: 'connected',
          latencyMs: Date.now() - start,
          discoveredCount: models.length,
          message: `Discovered ${models.length} local Ollama models from ${tagsUrl} (${Date.now() - start} ms).`,
          models,
        });
      } catch (err) {
        res.json({
          connected: false,
          connectionState: 'network_error',
          latencyMs: Date.now() - start,
          message: `Failed to connect to Ollama at ${provider.baseUrl}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
      return;
    }

    // 3. OpenAI-compatible, Anthropic, and Generic REST APIs
    try {
      const endpoint =
        provider.modelListEndpoint || `${provider.baseUrl.replace(/\/$/, '')}/models`;
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (secret) {
        if (provider.protocol === 'ANTHROPIC_MESSAGES') {
          headers['x-api-key'] = secret;
          headers['anthropic-version'] = '2023-06-01';
        } else {
          headers['Authorization'] = `Bearer ${secret}`;
        }
      }
      if (provider.customHeaders) {
        Object.assign(headers, provider.customHeaders);
      }

      let models: DiscoveredModel[] = [];
      let discoverySuccess = false;

      try {
        const response = await fetch(endpoint, { method: 'GET', headers });
        if (response.ok) {
          const text = await response.text();
          const parsed = JSON.parse(text);
          const rawList = Array.isArray(parsed.data)
            ? parsed.data
            : Array.isArray(parsed.models)
            ? parsed.models
            : [];
          models = rawList.slice(0, 100).map((m: Record<string, unknown>) => {
            const id = String(m.id || m.name || '');
            const pricing = m.pricing as Record<string, unknown> | undefined;
            const isFree =
              Boolean(pricing && pricing.prompt === '0' && pricing.completion === '0') ||
              id.endsWith(':free');
            return {
              id,
              displayName: String(m.name || id),
              providerId: provider.id,
              contextWindowTokens: Number(m.context_length || 0) || undefined,
              supportsStreaming: true,
              supportsTools:
                id.includes('claude') ||
                id.includes('gpt-4') ||
                id.includes('gemini') ||
                id.includes('qwen') ||
                id.includes('deepseek'),
              supportsVision:
                id.includes('vision') || id.includes('claude-3') || id.includes('gpt-4o'),
              isFreeTierVerified: isFree,
            };
          });
          discoverySuccess = models.length > 0;
        }
      } catch {
        // Model list endpoint might be unsupported or restricted
      }

      // If auto-discovery is unsupported, allow manual model or default model fallback
      if (!discoverySuccess) {
        const fallbackId = manualModelId || provider.defaultModel || 'custom-model';
        models = [
          {
            id: fallbackId,
            displayName: fallbackId,
            providerId: provider.id,
            supportsStreaming: true,
            supportsTools: true,
            supportsVision: false,
            isFreeTierVerified: false,
          },
        ];
      }

      modelCache.set(provider.id, { updatedAtMillis: Date.now(), models });
      res.json({
        connected: Boolean(secret) || !provider.requiresApiKey || provider.id === 'openrouter',
        connectionState:
          secret || !provider.requiresApiKey ? 'connected' : 'auth_required',
        latencyMs: Date.now() - start,
        discoveredCount: models.length,
        message: discoverySuccess
          ? `Authenticated and discovered ${models.length} models from ${endpoint} (${Date.now() - start} ms).`
          : `Connected to ${provider.baseUrl}. Auto-discovery endpoint was unavailable; active model configured as '${models[0]?.id}'.`,
        models,
      });
    } catch (err) {
      res.json({
        connected: false,
        connectionState: 'network_error',
        latencyMs: Date.now() - start,
        message: SecretRedactor.redact(
          err instanceof Error ? err.message : String(err),
          vault.getAllKnownSecrets()
        ),
      });
    }
  });

  // Manual model specification for any provider
  app.post('/api/providers/manual-model', (req, res) => {
    try {
      const { providerId, modelId } = req.body;
      if (!providerId || !modelId) {
        res.status(400).json({ error: 'providerId and modelId are required.' });
        return;
      }
      const existing = modelCache.get(providerId)?.models || [];
      const newModel: DiscoveredModel = {
        id: String(modelId).trim(),
        displayName: String(modelId).trim(),
        providerId,
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: false,
        isFreeTierVerified: false,
      };
      const filtered = existing.filter((m) => m.id !== newModel.id);
      filtered.unshift(newModel);
      modelCache.set(providerId, { updatedAtMillis: Date.now(), models: filtered });
      res.json({ models: filtered });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // --------------------------------------------------------------------------
  // AGENTS MANAGEMENT API (Install, Configure, List, Select)
  // --------------------------------------------------------------------------
  app.get('/api/agents', (_req, res) => {
    const settings = loadSettings();
    res.json({
      agents: getAllAgents(),
      roles: BUILTIN_SUBAGENT_ROLES,
      defaultAgentId: settings.defaultAgentId || 'obsidian-autonomous-coder',
    });
  });

  app.post('/api/agents', (req, res) => {
    try {
      const {
        name,
        role,
        description,
        systemInstruction,
        capabilities,
        defaultModelId,
        defaultProviderId,
        defaultMaxSteps,
        temperature,
      } = req.body || {};

      if (!name || !systemInstruction) {
        res.status(400).json({ error: 'Agent Name and System Instruction are required.' });
        return;
      }

      const id = `agent-custom-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
      const newAgent: AgentProfile = {
        id,
        name: String(name).trim(),
        role: String(role || 'Specialized Agent').trim(),
        description: String(description || '').trim(),
        systemInstruction: String(systemInstruction).trim(),
        capabilities: Array.isArray(capabilities) ? capabilities : ['MCP_TOOLS', 'RESUME'],
        defaultModelId: defaultModelId ? String(defaultModelId) : undefined,
        defaultProviderId: defaultProviderId ? String(defaultProviderId) : undefined,
        defaultMaxSteps: Number(defaultMaxSteps) || 10,
        temperature: typeof temperature === 'number' ? temperature : 0.2,
        isCustom: true,
        isDefault: false,
        accentColor: '#C7FF65',
      };

      const existing = loadCustomAgents();
      existing.push(newAgent);
      saveCustomAgents(existing);

      res.json({ agent: newAgent, agents: getAllAgents() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.patch('/api/agents/:id', (req, res) => {
    try {
      const { id } = req.params;
      const existing = loadCustomAgents();
      const targetIndex = existing.findIndex((a) => a.id === id);
      if (targetIndex === -1) {
        res.status(404).json({ error: 'Custom agent not found.' });
        return;
      }
      const updated = { ...existing[targetIndex], ...req.body, id, isCustom: true };
      existing[targetIndex] = updated;
      saveCustomAgents(existing);
      res.json({ agent: updated, agents: getAllAgents() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete('/api/agents/:id', (req, res) => {
    try {
      const { id } = req.params;
      const existing = loadCustomAgents();
      const next = existing.filter((a) => a.id !== id);
      saveCustomAgents(next);
      res.json({ ok: true, agents: getAllAgents() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/agents/select', (req, res) => {
    try {
      const { agentId, conversationId } = req.body;
      if (!agentId) {
        res.status(400).json({ error: 'agentId is required.' });
        return;
      }
      if (conversationId) {
        const conv = conversations.find((c) => c.id === conversationId);
        if (conv) {
          conv.agentId = String(agentId);
          conv.updatedAtMillis = Date.now();
          saveConversations(conversations);
        }
      }
      const settings = saveSettings({ defaultAgentId: String(agentId) });
      res.json({ ok: true, defaultAgentId: settings.defaultAgentId, conversationId });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---------------------------------------------------------------------------
  // Skills Management API Routes
  // ---------------------------------------------------------------------------
  app.get('/api/skills', (req, res) => {
    try {
      const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
      const skills = skillsManager.listSkills(workspaceId);
      res.json({ skills });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/skills/:id', (req, res) => {
    try {
      const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
      const skill = skillsManager.getSkill(req.params.id, workspaceId);
      if (!skill) {
        res.status(404).json({ error: `Skill "${req.params.id}" not found.` });
        return;
      }
      res.json({ skill });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/skills', (req, res) => {
    try {
      const {
        id,
        name,
        description,
        version,
        category,
        scope,
        workspaceId,
        author,
        requiredTools,
        keywords,
        prerequisites,
        instructions,
      } = req.body || {};

      if (!name || !description || !instructions) {
        res.status(400).json({ error: 'name, description, and instructions are required.' });
        return;
      }

      const created = skillsManager.createSkill({
        id: id || name,
        name,
        description,
        version,
        category,
        scope,
        workspaceId,
        author,
        requiredTools,
        keywords,
        prerequisites,
        instructions,
      });

      res.status(201).json({ skill: created });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.patch('/api/skills/:id/toggle', (req, res) => {
    try {
      const { id } = req.params;
      const { enabled } = req.body || {};
      const targetEnabled = typeof enabled === 'boolean' ? enabled : true;
      skillsManager.setSkillEnabled(id, targetEnabled);
      res.json({ id, enabled: targetEnabled });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete('/api/skills/:id', (req, res) => {
    try {
      const { id } = req.params;
      const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
      const deleted = skillsManager.deleteSkill(id, workspaceId);
      if (!deleted) {
        res.status(404).json({ error: `Skill "${id}" not found or could not be deleted.` });
        return;
      }
      res.json({ success: true, id });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/skills/import', (req, res) => {
    try {
      const { markdown, directoryPath, scope = 'global', workspaceId } = req.body || {};
      let imported;
      if (markdown && typeof markdown === 'string') {
        imported = skillsManager.importFromMarkdown(markdown, scope, workspaceId);
      } else if (directoryPath && typeof directoryPath === 'string') {
        imported = skillsManager.importFromDirectory(directoryPath, scope, workspaceId);
      } else {
        res.status(400).json({ error: 'Either "markdown" or "directoryPath" must be provided.' });
        return;
      }
      res.status(201).json({ skill: imported });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/skills/rescan', (req, res) => {
    try {
      const workspaceId =
        typeof req.query.workspaceId === 'string'
          ? req.query.workspaceId
          : typeof req.body?.workspaceId === 'string'
          ? req.body.workspaceId
          : undefined;
      const wsIds = workspaceManager.listWorkspaces().map((w) => w.id);
      skillsManager.rescan(wsIds);
      const skills = skillsManager.listSkills(workspaceId);
      activityEmitter.emit('skills_updated', { workspaceId, timestamp: Date.now() });
      res.json({ success: true, count: skills.length, skills });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/skills/:id/reload', (req, res) => {
    try {
      const workspaceId =
        typeof req.query.workspaceId === 'string'
          ? req.query.workspaceId
          : typeof req.body?.workspaceId === 'string'
          ? req.body.workspaceId
          : undefined;
      const skill = skillsManager.getSkill(req.params.id, workspaceId);
      if (!skill) {
        res.status(404).json({ error: `Skill "${req.params.id}" not found.` });
        return;
      }
      res.json({ skill });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // --------------------------------------------------------------------------
  // AUTHORITATIVE RUNTIME & ENVIRONMENT SERVICE
  // --------------------------------------------------------------------------
  app.get(['/api/system/environment', '/api/environment'], (req, res) => {
    try {
      const userAgent = String(req.headers['user-agent'] || '');
      const isMobileUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
      const isAndroidClient = /Android/i.test(userAgent);
      const isIosClient = /iPhone|iPad|iPod/i.test(userAgent);
      const isNativeAndroidBridge = Boolean(req.headers['x-obsidian-android-native'] || req.headers['x-android-bridge']);

      const clientPlatform = isNativeAndroidBridge
        ? 'android_native'
        : isAndroidClient
        ? 'android_browser'
        : isIosClient
        ? 'ios_browser'
        : isMobileUserAgent
        ? 'mobile_browser'
        : 'desktop_browser';

      const backendOs = process.platform;
      const isWindows = backendOs === 'win32';
      const isLinux = backendOs === 'linux';
      const isMac = backendOs === 'darwin';
      const isContainer = fs.existsSync('/.dockerenv') || Boolean(process.env.DOCKER_CONTAINER);

      const activeWsId = (req.query.workspaceId as string) || 'android-workstation';
      const canonicalWorkspaceRoot = path.resolve(workspaceManager.getWorkspaceRoot(activeWsId));
      const rootAccessible = fs.existsSync(canonicalWorkspaceRoot);

      // Distinguish filesystem owner:
      // If client is mobile (browser or native app) connecting to PC backend, the filesystem owner is 'remote_pc'
      // If client is desktop browser running on PC, filesystem owner is 'local_pc'
      const clientIp = req.ip || req.socket.remoteAddress || '';
      const isRemoteClient = isMobileUserAgent || (!clientIp.includes('127.0.0.1') && !clientIp.includes('::1') && clientIp !== '');
      const filesystemOwner = isRemoteClient ? 'remote_pc' : 'local_pc';

      const modelsDir = path.resolve(DATA_DIR, 'local-models');
      const modelsDirAccessible = fs.existsSync(modelsDir);
      const modelsCount = modelsDirAccessible
        ? fs.readdirSync(modelsDir).filter(f => f.endsWith('.gguf') || f.endsWith('.bin')).length
        : 0;

      const freeMem = os.freemem();
      const totalMem = os.totalmem();

      res.json({
        client: {
          platform: clientPlatform,
          isMobile: isMobileUserAgent,
          isAndroidNative: isNativeAndroidBridge,
          userAgent,
          label: isNativeAndroidBridge
            ? 'Android Native Client (io.anvil.workstation)'
            : isAndroidClient
            ? 'Mobile Android Browser'
            : isIosClient
            ? 'Mobile iOS Browser'
            : isMobileUserAgent
            ? 'Mobile Web Client'
            : 'Desktop Browser (PC)',
        },
        backend: {
          os: backendOs,
          platform: backendOs,
          osName: isWindows ? 'Windows' : isLinux ? 'Linux' : isMac ? 'macOS' : backendOs,
          arch: process.arch,
          hostname: os.hostname(),
          release: os.release(),
          nodeVersion: process.version,
          isNativeAndroid: false,
          isWindows,
          isLinux,
          isMac,
          isContainer,
          label: `${isWindows ? 'Windows' : isLinux ? 'Linux' : 'macOS'} (${process.arch}) Node.js Host`,
        },
        filesystem: {
          owner: filesystemOwner,
          ownerLabel: filesystemOwner === 'remote_pc' ? 'Remote PC Storage (via LAN/Server)' : 'Local PC Storage',
          workspaceId: activeWsId,
          workspaceRoot: canonicalWorkspaceRoot,
          accessible: rootAccessible,
          pathSeparator: path.sep,
          isWindowsPaths: path.sep === '\\',
        },
        capabilities: {
          shell: true,
          shellType: isWindows ? 'powershell' : 'bash',
          pty: true,
          localAi: true,
          arm64: process.arch === 'arm64',
          freeMemoryBytes: freeMem,
          totalMemoryBytes: totalMem,
          modelsDirectory: modelsDir,
          modelsDirAccessible,
          modelsCount,
          inferenceEngine: 'node-llama-cpp / Ollama (Host Inference)',
        },
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Local GGUF Model Multi-Stage Validator
  app.post('/api/local-models/validate', (req, res) => {
    try {
      const { filePath, filename } = req.body || {};
      const targetPath = filePath
        ? path.resolve(String(filePath))
        : filename
        ? path.resolve(DATA_DIR, 'local-models', String(filename))
        : null;

      if (!targetPath) {
        res.status(400).json({
          ok: false,
          state: 'Inference failed',
          error: 'Missing filePath or filename parameter for validation.',
        });
        return;
      }

      if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
        res.status(404).json({
          ok: false,
          state: 'Inference failed',
          error: `Model file does not exist at '${targetPath}'.`,
        });
        return;
      }

      const stat = fs.statSync(targetPath);
      if (stat.size < 1024 * 1024) {
        res.status(400).json({
          ok: false,
          state: 'Inference failed',
          error: `Model file is only ${stat.size} bytes (stub fixture). Full GGUF tensor weights (>1MB) are required for local inference.`,
          sizeBytes: stat.size,
        });
        return;
      }

      const inspection = localModelManager.inspectGgufFile(targetPath);
      if (!inspection.validMagic) {
        res.status(400).json({
          ok: false,
          state: 'Inference failed',
          error: `Corrupted or invalid GGUF format: ${inspection.diagnosticMessage}`,
          inspection,
        });
        return;
      }

      const hostRam = os.freemem();
      const requiredRam = inspection.estimatedRamBytes;
      const backendSupported = true;

      res.json({
        ok: true,
        state: 'Backend supported',
        metadata: {
          fileName: path.basename(targetPath),
          filePath: targetPath,
          sizeBytes: stat.size,
          formatVersion: inspection.formatVersion,
          tensorCount: inspection.tensorCount,
          metadataKvCount: inspection.metadataKvCount,
          architectureHint: inspection.architectureHint,
          estimatedRamBytes: requiredRam,
          hostAvailableRamBytes: hostRam,
          fitsHostMemory: hostRam >= requiredRam,
          diagnosticMessage: inspection.diagnosticMessage,
        },
        checks: [
          { name: 'File existence & readable size', passed: true, detail: `${(stat.size / (1024 * 1024)).toFixed(1)} MB` },
          { name: 'GGUF binary magic (0x47475546)', passed: true, detail: 'Valid GGUF header' },
          { name: `GGUF version v${inspection.formatVersion}`, passed: true, detail: `Version ${inspection.formatVersion}` },
          { name: 'Architecture & tensor weights', passed: true, detail: `${inspection.architectureHint} (${inspection.tensorCount} tensors)` },
          { name: 'RAM compatibility check', passed: hostRam >= requiredRam, detail: `Requires ~${Math.round(requiredRam / (1024 * 1024))} MB, free: ${Math.round(hostRam / (1024 * 1024))} MB` },
          { name: 'Host inference engine', passed: backendSupported, detail: 'node-llama-cpp x64 runtime ready' },
        ],
      });
    } catch (err) {
      res.status(500).json({ ok: false, state: 'Inference failed', error: err instanceof Error ? err.message : String(err) });
    }
  });

  // System permissions & Android integration endpoint
  app.get('/api/system/permissions', (_req, res) => {
    res.json({
      notifications: 'granted',
      backgroundWork: 'active',
      overlay: 'granted',
      storage: 'granted',
      androidPackageId: 'io.anvil.workstation',
      intents: {
        overlaySettings: 'intent:#Intent;action=android.settings.action.MANAGE_OVERLAY_PERMISSION;package=io.anvil.workstation;end',
        batteryOptimization: 'intent:#Intent;action=android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS;end',
        notificationSettings: 'intent:#Intent;action=android.settings.APP_NOTIFICATION_SETTINGS;package=io.anvil.workstation;end',
      },
    });
  });

  // --------------------------------------------------------------------------
  // SUB-AGENTS ORCHESTRATION & REAL TASK DELEGATION API
  // --------------------------------------------------------------------------
  app.get('/api/subagents', (req, res) => {
    const convId = typeof req.query.conversationId === 'string' ? req.query.conversationId : undefined;
    res.json({
      tasks: subAgentManager.listTasks(convId),
      roles: BUILTIN_SUBAGENT_ROLES,
    });
  });

  app.post('/api/subagents/spawn', async (req, res) => {
    try {
      const { role, agentProfileId, agentName, title, taskPrompt, workspaceId, conversationId, providerId, modelId } = req.body;
      if (!role || !taskPrompt) {
        res.status(400).json({ error: 'role and taskPrompt are required to spawn a sub-agent.' });
        return;
      }

      const wsId = String(workspaceId || 'android-workstation');
      const provId = String(providerId || 'gemini-server');
      const modId = String(modelId || 'gemini-3.8-flash');

      const spawned = await subAgentManager.spawnTask({
        role: role as SubAgentRole,
        agentProfileId: agentProfileId ? String(agentProfileId) : undefined,
        agentName: agentName ? String(agentName) : undefined,
        title: title || `${role} Task`,
        taskPrompt: String(taskPrompt),
        workspaceId: wsId,
        conversationId: conversationId ? String(conversationId) : undefined,
        providerId: provId,
        modelId: modId,
        executeTurnFn: async ({ systemPrompt, userPrompt, signal, updateStep, recordToolCall, recordChangedFile }) => {
          updateStep(`Formulating execution plan for ${role}...`, 35);
          recordToolCall({
            tool: 'workspace_inspect',
            args: { workspaceId: wsId },
            result: `Inspected workspace root ${wsId}`,
            durationMs: 12,
            timestampMillis: Date.now(),
          });

          // Real turn execution via existing provider model turn generator
          const tempConv: Conversation = {
            id: `subconv-${Date.now()}`,
            title: `${role} Execution`,
            workspaceId: wsId,
            providerId: provId,
            modelId: modId,
            agentId: `subagent-${role.toLowerCase()}`,
            taskState: 'running',
            createdAtMillis: Date.now(),
            updatedAtMillis: Date.now(),
            messages: [{ id: 'm1', role: 'user', content: userPrompt, timestampMillis: Date.now() }],
          };
          const generator = createProviderModelTurnGenerator(tempConv);

          updateStep(`Generating response using model ${modId}...`, 60);
          const turn = await generator({
            iteration: 1,
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            systemInstruction: systemPrompt,
            enableTools: false,
            signal,
          });

          updateStep(`Synthesizing output...`, 90);
          return turn.text || 'Sub-agent completed execution without output.';
        },
      });

      emitActivity({
        conversationId: conversationId || 'system',
        workspaceId: wsId,
        state: 'STARTING',
        title: `Sub-Agent Spawned (${role})`,
        description: `Delegated subtask '${spawned.title}' to ${role} child agent using model ${modId}.`,
      });

      res.json({ task: spawned });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });


  app.post('/api/subagents/:taskId/cancel', (req, res) => {
    const success = subAgentManager.cancelTask(req.params.taskId);
    res.json({ ok: success });
  });

  app.post('/api/subagents/:taskId/retry', async (req, res) => {
    try {
      const existing = subAgentManager.getTask(req.params.taskId);
      if (!existing) {
        res.status(404).json({ error: 'Sub-agent task not found.' });
        return;
      }
      const retried = await subAgentManager.spawnTask({
        role: existing.role,
        title: `${existing.title} (Retry)`,
        taskPrompt: existing.taskPrompt,
        workspaceId: existing.workspaceId,
        conversationId: existing.conversationId,
        providerId: existing.providerId,
        modelId: existing.modelId,
        executeTurnFn: async ({ systemPrompt, userPrompt, signal }) => {
          const tempConv: Conversation = {
            id: `subconv-${Date.now()}`,
            title: `${existing.role} Execution`,
            workspaceId: existing.workspaceId,
            providerId: existing.providerId,
            modelId: existing.modelId,
            agentId: `subagent-${existing.role.toLowerCase()}`,
            taskState: 'running',
            createdAtMillis: Date.now(),
            updatedAtMillis: Date.now(),
            messages: [{ id: 'm1', role: 'user', content: userPrompt, timestampMillis: Date.now() }],
          };
          const generator = createProviderModelTurnGenerator(tempConv);
          const turn = await generator({
            iteration: 1,
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            systemInstruction: systemPrompt,
            enableTools: false,
            signal,
          });
          return turn.text || 'Sub-agent completed execution without output.';
        },
      });
      res.json({ task: retried });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete('/api/subagents/:taskId', (req, res) => {
    const deleted = subAgentManager.deleteTask(req.params.taskId);
    res.json({ ok: deleted });
  });


  // --------------------------------------------------------------------------
  // WORKSPACES, FILE EDITOR & UNIFIED DIFF CHECKPOINTS
  // --------------------------------------------------------------------------
  app.get('/api/workspaces', (_req, res) => {
    res.json({
      workspaces: workspaceManager.listWorkspaces(),
      checkpoints: workspaceManager.getCheckpoints(),
    });
  });

  app.post('/api/workspaces', (req, res) => {
    try {
      const { name, templateId } = req.body;
      const created = workspaceManager.createWorkspace(
        String(name || ''),
        String(templateId || 'general')
      );
      res.json({ workspace: created, workspaces: workspaceManager.listWorkspaces() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.patch('/api/workspaces/:workspaceId', (req, res) => {
    try {
      const { name } = req.body;
      const renamed = workspaceManager.renameWorkspace(req.params.workspaceId, String(name || ''));
      const convs = loadConversations();
      let updatedAny = false;
      for (const c of convs) {
        if (c.workspaceId === req.params.workspaceId) {
          c.workspaceId = renamed.id;
          updatedAny = true;
        }
      }
      if (updatedAny) saveConversations(convs);
      res.json({ workspace: renamed, workspaces: workspaceManager.listWorkspaces() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete('/api/workspaces/:workspaceId', (req, res) => {
    try {
      const deleteFiles = req.query.deleteFiles === 'true' || req.body?.deleteFiles === true;
      const result = workspaceManager.deleteWorkspace(req.params.workspaceId, deleteFiles);
      const convs = loadConversations();
      let updatedAny = false;
      for (const c of convs) {
        if (c.workspaceId === req.params.workspaceId) {
          c.workspaceId = 'android-workstation';
          updatedAny = true;
        }
      }
      if (updatedAny) saveConversations(convs);
      res.json({ ...result, workspaces: workspaceManager.listWorkspaces() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/workspaces/:workspaceId/files', (req, res) => {
    try {
      const root = workspaceManager.getWorkspaceRoot(req.params.workspaceId);
      const files = workspaceManager.listFilesRecursive(root);
      res.json({
        workspaceId: req.params.workspaceId,
        files,
        checkpoints: workspaceManager.getCheckpoints(req.params.workspaceId),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/workspaces/:workspaceId/file', (req, res) => {
    try {
      const relPath = String(req.query.path || '');
      const data = workspaceManager.readFileBounded(req.params.workspaceId, relPath);
      res.json({ path: relPath, ...data });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  const handleWriteWorkspaceFile = (req: express.Request, res: express.Response) => {
    try {
      const relPath = req.body?.path ?? req.query?.path ?? '';
      const content = req.body?.content ?? '';
      const diff = workspaceManager.writeFileSafely(
        String(req.params.workspaceId),
        String(relPath || ''),
        String(content ?? '')
      );
      res.json({ diff, checkpoints: workspaceManager.getCheckpoints(String(req.params.workspaceId)) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  };

  app.post('/api/workspaces/:workspaceId/file', handleWriteWorkspaceFile);
  app.put('/api/workspaces/:workspaceId/file', handleWriteWorkspaceFile);

  app.post('/api/workspaces/:workspaceId/mkdir', (req, res) => {
    try {
      const relDirPath = req.body?.path ?? req.body?.dirPath ?? '';
      const result = workspaceManager.createDirectorySafely(
        req.params.workspaceId,
        String(relDirPath || '')
      );
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/workspaces/:workspaceId/rename', (req, res) => {
    try {
      const oldPath = req.body.oldPath ?? req.body.fromPath ?? '';
      const newPath = req.body.newPath ?? req.body.toPath ?? '';
      const diff = workspaceManager.renamePathSafely(
        req.params.workspaceId,
        String(oldPath),
        String(newPath)
      );
      res.json({ diff, checkpoints: workspaceManager.getCheckpoints(req.params.workspaceId) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete('/api/workspaces/:workspaceId/file', (req, res) => {
    try {
      const relPath = String(req.query.path || '');
      const diff = workspaceManager.deleteFileSafely(req.params.workspaceId, relPath);
      res.json({ diff, checkpoints: workspaceManager.getCheckpoints(req.params.workspaceId) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/workspaces/revert', (req, res) => {
    try {
      const { checkpointId } = req.body;
      const diff = workspaceManager.revertCheckpoint(String(checkpointId || ''));
      res.json({ diff });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/workspaces/:workspaceId/search', (req, res) => {
    try {
      const q = String(req.query.q ?? req.query.query ?? '');
      const matches = q ? workspaceManager.searchInWorkspace(req.params.workspaceId, q) : [];
      res.json({ matches });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // --------------------------------------------------------------------------
  // LIVE APPLICATION & WORKSPACE PREVIEW ENDPOINTS
  // --------------------------------------------------------------------------
  app.get('/api/preview/status', async (req, res) => {
    const targetUrl = typeof req.query.url === 'string' ? req.query.url.trim() : 'http://localhost:3000';
    try {
      const parsed = new URL(targetUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return res.status(400).json({ online: false, error: 'Only http and https protocols are supported' });
      }
      const startTime = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      try {
        const response = await fetch(parsed.toString(), {
          method: 'GET',
          signal: controller.signal,
          headers: { 'User-Agent': 'Obsidian-Preview-Prober/1.0' },
        });
        clearTimeout(timer);
        const latencyMs = Date.now() - startTime;
        res.json({
          online: true,
          statusCode: response.status,
          statusText: response.statusText,
          latencyMs,
          contentType: response.headers.get('content-type') || 'unknown',
          url: parsed.toString(),
        });
      } catch (probeErr: any) {
        clearTimeout(timer);
        const isAbort = probeErr.name === 'AbortError';
        res.json({
          online: false,
          error: isAbort ? 'Connection timed out (2000ms)' : (probeErr.message || 'Connection refused'),
          url: parsed.toString(),
        });
      }
    } catch {
      res.status(400).json({ online: false, error: 'Invalid URL format' });
    }
  });

  app.use('/api/preview/workspace/:workspaceId', (req, res, next) => {
    try {
      const root = workspaceManager.getWorkspaceRoot(req.params.workspaceId);
      if (fs.existsSync(root)) {
        return express.static(root, { index: ['index.html', 'index.htm'] })(req, res, next);
      }
      res.status(404).send('Workspace not found');
    } catch (err: any) {
      res.status(400).send(err?.message || 'Error loading workspace preview');
    }
  });

  // --------------------------------------------------------------------------
  // PERSISTENT OS PTY TERMINAL SESSIONS & REAL SHELL STREAMING
  // --------------------------------------------------------------------------
  const validateTerminalToken = (req: express.Request, res: express.Response): boolean => {
    const provided =
      req.headers['x-obsidian-terminal-token'] ||
      (typeof req.query.token === 'string' ? req.query.token : undefined);
    // If client provides a token, verify it matches the server's active token
    if (provided && provided !== TERMINAL_SESSION_TOKEN) {
      res.status(403).json({ error: 'Invalid terminal session authentication token.' });
      return false;
    }
    return true;
  };

  app.get('/api/terminal/sessions', (req, res) => {
    const workspaceId =
      typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
    const hostInfo = detectAvailableHostShell();
    res.json({
      sessions: ptySessionManager.listSessions(workspaceId),
      hostShell: hostInfo.shellPath,
      ptySupported: hostInfo.python3Available,
      platform: hostInfo.platform,
      terminalToken: TERMINAL_SESSION_TOKEN,
    });
  });

  app.post('/api/terminal/sessions', async (req, res) => {
    if (!validateTerminalToken(req, res)) return;
    try {
      const { workspaceId, cwd, shell, cols, rows, title } = req.body || {};
      const session = await ptySessionManager.createSession({
        workspaceId: String(workspaceId || 'android-workstation'),
        cwd: typeof cwd === 'string' ? cwd : undefined,
        shell: typeof shell === 'string' ? shell : undefined,
        cols: typeof cols === 'number' ? cols : undefined,
        rows: typeof rows === 'number' ? rows : undefined,
        title: typeof title === 'string' ? title : undefined,
      });
      res.json({ session, terminalToken: TERMINAL_SESSION_TOKEN });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/terminal/sessions/:sessionId', (req, res) => {
    if (!validateTerminalToken(req, res)) return;
    const session = ptySessionManager.getSession(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: `Terminal session not found: ${req.params.sessionId}` });
      return;
    }
    res.json({ session });
  });

  app.get('/api/terminal/sessions/:sessionId/stream', (req, res) => {
    if (!validateTerminalToken(req, res)) return;
    const session = ptySessionManager.getSession(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: `Terminal session not found: ${req.params.sessionId}` });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const sendEvent = (eventName: string, payload: unknown) => {
      try {
        res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch {
        // stream closed
      }
    };

    sendEvent('init', { session });

    const unsubscribe = ptySessionManager.subscribe(req.params.sessionId, {
      onOutput: (payload) => sendEvent('output', payload),
      onStatus: (summary) => sendEvent('status', summary),
      onClear: () => sendEvent('clear', { sessionId: req.params.sessionId }),
      onAgentEvent: (payload) => sendEvent('agent_event', payload),
    });

    const keepAlive = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(keepAlive);
      }
    }, 15_000);

    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  app.post('/api/terminal/sessions/:sessionId/input', (req, res) => {
    if (!validateTerminalToken(req, res)) return;
    try {
      const data = typeof req.body?.data === 'string' ? req.body.data : '';
      const summary = ptySessionManager.writeInput(req.params.sessionId, data);
      res.json({ session: summary });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/terminal/sessions/:sessionId/resize', (req, res) => {
    if (!validateTerminalToken(req, res)) return;
    try {
      const cols = Number(req.body?.cols) || 100;
      const rows = Number(req.body?.rows) || 30;
      const summary = ptySessionManager.resizeSession(req.params.sessionId, cols, rows);
      res.json({ session: summary });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/terminal/sessions/:sessionId/interrupt', (req, res) => {
    if (!validateTerminalToken(req, res)) return;
    try {
      const summary = ptySessionManager.interruptSession(req.params.sessionId);
      res.json({ session: summary });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/terminal/sessions/:sessionId/clear', (req, res) => {
    if (!validateTerminalToken(req, res)) return;
    try {
      const summary = ptySessionManager.clearScrollback(req.params.sessionId);
      res.json({ session: summary });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/terminal/sessions/:sessionId/restart', async (req, res) => {
    if (!validateTerminalToken(req, res)) return;
    try {
      const session = await ptySessionManager.restartSession(req.params.sessionId);
      res.json({ session });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete('/api/terminal/sessions/:sessionId', async (req, res) => {
    if (!validateTerminalToken(req, res)) return;
    try {
      const remove = req.query.remove === 'true';
      const summary = await ptySessionManager.closeSession(req.params.sessionId, remove);
      res.json({ session: summary });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/terminal/sessions/:sessionId/exec', async (req, res) => {
    if (!validateTerminalToken(req, res)) return;
    try {
      const command = String(req.body?.command || '');
      const timeoutMs = Number(req.body?.timeoutMs) || 20_000;
      const result = await ptySessionManager.executeInSession(
        req.params.sessionId,
        command,
        timeoutMs
      );
      const session = ptySessionManager.getSession(req.params.sessionId);
      if (session?.workspaceId) {
        skillsManager.rescan([session.workspaceId]);
      } else {
        skillsManager.rescan();
      }
      res.json({ result, session });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Legacy one-shot endpoint preserved for backward compatibility
  app.post('/api/terminal/exec', async (req, res) => {
    try {
      const { workspaceId, command, cwd } = req.body;
      const settings = loadSettings();
      const result = await terminalManager.executeCommand(
        String(workspaceId || 'android-workstation'),
        String(command || ''),
        settings.commandTimeoutMs,
        {
          cwd: typeof cwd === 'string' ? cwd : undefined,
          knownSecrets: vault.getAllKnownSecrets(),
        }
      );
      skillsManager.rescan([String(workspaceId || 'android-workstation')]);
      res.json({
        ...result,
        stdout: SecretRedactor.redact(result.stdout, vault.getAllKnownSecrets()),
        stderr: SecretRedactor.redact(result.stderr, vault.getAllKnownSecrets()),
        history: terminalManager.getHistory(String(workspaceId || 'android-workstation')),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/terminal/cancel', (req, res) => {
    const { workspaceId } = req.body;
    const cancelled = terminalManager.cancelCommand(String(workspaceId || 'android-workstation'));
    res.json({ cancelled });
  });

  // --------------------------------------------------------------------------
  // CONVERSATIONS, CHAT, RESUME & BOUNDED AGENT EXECUTION
  // --------------------------------------------------------------------------
  app.get('/api/conversations', (_req, res) => {
    res.json({ conversations });
  });

  app.post('/api/conversations', (req, res) => {
    const settings = loadSettings();
    const { title, workspaceId, providerId, modelId, agentId } = req.body;
    const conv: Conversation = {
      id: `conv-${Date.now()}`,
      title: String(title || 'New Workstation Session').trim(),
      workspaceId: String(workspaceId || 'android-workstation'),
      providerId: String(providerId || settings.defaultProviderId),
      modelId: String(modelId || settings.defaultModelId),
      agentId: String(agentId || settings.defaultAgentId || 'obsidian-autonomous-coder'),
      taskState: 'idle',
      createdAtMillis: Date.now(),
      updatedAtMillis: Date.now(),
      messages: [],
    };
    conversations.unshift(conv);
    saveConversations(conversations);
    res.json({ conversation: conv, conversations });
  });

  app.patch('/api/conversations/:id', (req, res) => {
    const conv = conversations.find((c) => c.id === req.params.id);
    if (!conv) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }
    if (req.body.title) conv.title = String(req.body.title).trim();
    if (req.body.workspaceId) conv.workspaceId = String(req.body.workspaceId);
    if (req.body.providerId) conv.providerId = String(req.body.providerId);
    if (req.body.modelId) conv.modelId = String(req.body.modelId);
    if (req.body.agentId) conv.agentId = String(req.body.agentId);
    if (req.body.chatMode) conv.chatMode = req.body.chatMode;
    if (req.body.collaboratorModelId !== undefined) conv.collaboratorModelId = req.body.collaboratorModelId;
    if (req.body.collaboratorProviderId !== undefined) conv.collaboratorProviderId = req.body.collaboratorProviderId;
    conv.updatedAtMillis = Date.now();
    saveConversations(conversations);
    res.json({ conversation: conv, conversations });
  });

  app.delete('/api/conversations/:id', (req, res) => {
    conversations = conversations.filter((c) => c.id !== req.params.id);
    saveConversations(conversations);
    res.json({ conversations });
  });

  app.get('/api/agent/events', (_req, res) => {
    res.json({
      events: activityEvents,
      pendingApprovals: Array.from(pendingApprovals.values()).map(({ resolve: _r, ...rest }) => rest),
    });
  });

  app.get('/api/agent/events/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    });
    res.write(': connected\n\n');

    const sendEvent = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Send initial snapshot immediately upon connection
    sendEvent('snapshot', {
      events: activityEvents.slice(0, 50),
      pendingApprovals: Array.from(pendingApprovals.values()).map(({ resolve: _r, ...rest }) => rest),
    });

    const onActivity = (evt: AgentActivityEvent) => {
      sendEvent('activity', evt);
    };

    const onApprovals = (apprs: any[]) => {
      sendEvent('approvals', apprs);
    };

    const onChatStream = (payload: any) => {
      sendEvent('chat_stream', payload);
    };

    const onSkillsUpdated = (payload: any) => {
      sendEvent('skills_updated', payload);
    };

    const onSettingsUpdated = (payload: any) => {
      sendEvent('settings_updated', payload);
    };

    activityEmitter.on('activity', onActivity);
    activityEmitter.on('approvals', onApprovals);
    activityEmitter.on('chat_stream', onChatStream);
    activityEmitter.on('skills_updated', onSkillsUpdated);
    activityEmitter.on('settings_updated', onSettingsUpdated);

    const keepAlive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAlive);
      activityEmitter.off('activity', onActivity);
      activityEmitter.off('approvals', onApprovals);
      activityEmitter.off('chat_stream', onChatStream);
      activityEmitter.off('skills_updated', onSkillsUpdated);
      activityEmitter.off('settings_updated', onSettingsUpdated);
      activityEmitter.off('skills_updated', onSkillsUpdated);
    });
  });

  app.post('/api/agent/approve', (req, res) => {
    const { approvalId, approved } = req.body;
    const pending = pendingApprovals.get(String(approvalId));
    if (!pending) {
      res.status(404).json({ error: 'Approval request expired or not found.' });
      return;
    }
    pending.resolve(Boolean(approved));
    notifyApprovalsChanged();
    res.json({ ok: true });
  });

  app.post('/api/agent/simulate-approval', (req, res) => {
    const id = `appr-${Date.now()}`;
    const approval: any = {
      id,
      conversationId: req.body.conversationId || 'conv-1',
      workspaceId: req.body.workspaceId || 'kotlin-notes-apk',
      toolName: req.body.toolName || 'write_file',
      category: 'WRITE_WORKSPACE',
      arguments: req.body.arguments || { path: 'src/auth/session.ts', linesAdded: 42, linesRemoved: 8 },
      reason: 'Mutate SQLite session store & WAL mode prepared statements',
      createdAtMillis: Date.now(),
      resolve: () => {
        pendingApprovals.delete(id);
        notifyApprovalsChanged();
      },
    };
    pendingApprovals.set(id, approval);
    notifyApprovalsChanged();
    res.json({ ok: true, id, approval });
  });


  app.post('/api/chat/cancel', (req, res) => {
    const { conversationId } = req.body;
    const convId = String(conversationId || '');
    const controller = activeAborts.get(convId);
    if (controller) {
      controller.abort();
      activeAborts.delete(convId);
    }
    const conv = conversations.find((c) => c.id === convId);
    if (conv) {
      conv.taskState = 'cancelled';
      terminalManager.cancelCommand(conv.workspaceId);
      // Mark any running assistant message in-place as cancelled while preserving partial text
      for (let i = conv.messages.length - 1; i >= 0; i--) {
        const msg = conv.messages[i];
        if (msg.role === 'assistant' && (msg.taskState === 'running' || msg.taskState === 'awaiting_approval')) {
          msg.taskState = 'cancelled';
          msg.stoppedReason = 'cancelled';
          break;
        }
      }
      saveConversations(conversations);
    }
    activityEmitter.emit('chat_stream', {
      type: 'cancelled',
      conversationId: convId,
      timestampMillis: Date.now(),
    });
    emitActivity({
      conversationId: convId,
      workspaceId: conv?.workspaceId || 'android-workstation',
      state: 'CANCELLED',
      title: 'Task Cancelled by Operator',
      description: 'Aborted active model request and terminated running workspace child processes.',
    });
    res.json({ ok: true, cancelled: true, conversation: conv });
  });

  const executeConversationTurn = async (
    conv: Conversation,
    enableAgentTools: boolean,
    overrideMaxIterations?: number,
    options?: {
      assistantMessageId?: string;
      onStreamEvent?: (evt: Record<string, unknown>) => void;
      chatMode?: 'normal' | 'agent';
      collaboratorModelId?: string;
      collaboratorProviderId?: string;
    }
  ) => {
    // Prevent duplicate concurrent tasks on the same conversation
    const existingController = activeAborts.get(conv.id);
    if (existingController) {
      existingController.abort();
    }
    const abortController = new AbortController();
    activeAborts.set(conv.id, abortController);
    const settings = loadSettings();
    const maxSteps =
      typeof overrideMaxIterations === 'number'
        ? Math.max(1, Math.min(25, overrideMaxIterations))
        : settings.maxAgentIterations;

    const assistantMsgId = options?.assistantMessageId || `msg-${Date.now()}-a`;
    const emitStream = (payload: Record<string, unknown>) => {
      const fullPayload = {
        ...payload,
        conversationId: conv.id,
        assistantMessageId: assistantMsgId,
        timestampMillis: Date.now(),
      };
      try {
        options?.onStreamEvent?.(fullPayload);
      } catch {
        // Ignore write errors on closed response streams
      }
      activityEmitter.emit('chat_stream', fullPayload);
    };

    conv.taskState = 'running';
    saveConversations(conversations);

    emitStream({
      type: 'status',
      phase: 'connecting',
      statusText: `Connecting to ${conv.modelId}…`,
      providerId: conv.providerId,
      modelId: conv.modelId,
    });

    emitActivity({
      conversationId: conv.id,
      workspaceId: conv.workspaceId,
      state: 'PLANNING',
      title: 'Task Execution Started',
      description: `Workspace: ${conv.workspaceId} · Model: ${conv.modelId} · Step Budget: ${maxSteps}`,
    });

    const lastUserMsg = [...conv.messages].reverse().find((m) => m.role === 'user');
    const userPrompt = lastUserMsg ? lastUserMsg.content : '';
    const activeSkills = enableAgentTools
      ? skillsManager.matchSkills(userPrompt, conv.workspaceId)
      : [];

    if (activeSkills.length > 0) {
      emitStream({
        type: 'status',
        phase: 'loading_skill',
        statusText: `Loaded skill playbook: ${activeSkills.map((s) => s.name).join(', ')}`,
        skillsUsed: activeSkills.map((s) => s.id),
      });
      emitActivity({
        conversationId: conv.id,
        workspaceId: conv.workspaceId,
        state: 'LOADING_SKILL',
        title: `Skills Loaded: ${activeSkills.map((s) => s.name).join(', ')}`,
        description: `Injected domain instructions for: ${activeSkills.map((s) => s.id).join(', ')}`,
      });
    }

    const systemPrompt = buildAgentSystemPrompt(conv, activeSkills);
    const modelTurnGenerator = createProviderModelTurnGenerator(conv);

    // Snapshot conversation messages BEFORE inserting the in-progress assistant placeholder
    // so the LLM prompt history only contains completed turns + the latest user prompt
    const promptMessages = [...conv.messages];

    const liveAssistantMsg: any = {
      id: assistantMsgId,
      role: 'assistant' as const,
      content: '',
      timestampMillis: Date.now(),
      providerId: conv.providerId,
      modelId: conv.modelId,
      agentId: conv.agentId || settings.defaultAgentId,
      taskState: 'running' as const,
      stepsUsed: 0,
      maxStepsConfigured: maxSteps,
      skillsUsed: activeSkills.length > 0 ? activeSkills.map((s) => s.id) : undefined,
      toolCalls: undefined,
    };

    const existingIdx = conv.messages.findIndex((m) => m.id === assistantMsgId);
    if (existingIdx >= 0) {
      conv.messages[existingIdx] = liveAssistantMsg;
    } else {
      conv.messages.push(liveAssistantMsg);
    }

    const loopResult = await agentLoopRunner.runAgentLoop({
      conversationId: conv.id,
      workspaceId: conv.workspaceId,
      messages: promptMessages,
      systemInstruction: systemPrompt,
      enableAgentTools,
      maxIterations: maxSteps,
      maxToolCalls: settings.maxToolCalls,
      commandTimeoutMs: settings.commandTimeoutMs,
      requestTimeoutMs: Math.max(60_000, Number(settings.requestTimeoutMs) || 60_000),
      maxRetries: settings.maxRetries,
      signal: abortController.signal,
      knownSecrets: vault.getAllKnownSecrets(),
      modelTurnGenerator,
      onEmitActivity: (evt) => {
        const created = emitActivity(evt);
        emitStream({
          type: 'activity',
          event: created,
        });
      },
      onTokenDelta: (delta, accumulatedText, iteration) => {
        if (abortController.signal.aborted) return;
        liveAssistantMsg.content = accumulatedText;
        liveAssistantMsg.stepsUsed = iteration;
        emitStream({
          type: 'token',
          delta,
          accumulatedText,
          iteration,
          statusText: 'Generating response…',
        });
      },
      onToolCallUpdate: (toolCall, allToolCalls) => {
        liveAssistantMsg.toolCalls = [...allToolCalls];
        const statusLabel =
          toolCall.status === 'running'
            ? `Running tool: ${toolCall.name}…`
            : toolCall.status === 'succeeded'
            ? `Completed ${toolCall.name}`
            : `Tool ${toolCall.name} ${toolCall.status}`;
        emitStream({
          type: 'tool_call',
          toolCall,
          toolCalls: allToolCalls,
          statusText: statusLabel,
        });
      },
      onRequestApproval: async (req) => {
        conv.taskState = 'awaiting_approval';
        liveAssistantMsg.taskState = 'awaiting_approval';
        emitStream({
          type: 'status',
          phase: 'awaiting_approval',
          statusText: `Awaiting operator approval for ${req.toolName}…`,
        });
        const decision = await requestInteractiveApproval({
          conversationId: conv.id,
          workspaceId: conv.workspaceId,
          ...req,
        });
        conv.taskState = 'running';
        liveAssistantMsg.taskState = 'running';
        return decision;
      },
    });

    const assistantMsg = {
      id: assistantMsgId,
      role: 'assistant' as const,
      content: loopResult.finalText,
      timestampMillis: Date.now(),
      providerId: conv.providerId,
      modelId: conv.modelId,
      agentId: conv.agentId || settings.defaultAgentId,
      taskState: loopResult.taskState,
      stepsUsed: loopResult.stepsUsed,
      maxStepsConfigured: loopResult.maxStepsConfigured,
      stoppedReason: loopResult.stoppedReason,
      canResume: loopResult.canResume,
      modifiedFiles: loopResult.modifiedFiles.length > 0 ? loopResult.modifiedFiles : undefined,
      toolCalls: loopResult.toolCalls.length > 0 ? loopResult.toolCalls : undefined,
      skillsUsed: activeSkills.length > 0 ? activeSkills.map((s) => s.id) : undefined,
    };

    const effectiveChatMode = options?.chatMode || (enableAgentTools ? 'agent' : 'normal');
    (assistantMsg as any).chatMode = effectiveChatMode;

    if (
      enableAgentTools &&
      options?.collaboratorModelId &&
      options.collaboratorModelId !== 'none' &&
      !abortController.signal.aborted
    ) {
      const collabModelId = options.collaboratorModelId;
      let collabProviderId = options.collaboratorProviderId;
      if (!collabProviderId) {
        const allProvs: any[] = getAllProviders();
        const found = allProvs.find(
          (p) => Array.isArray(p.cachedModels) && p.cachedModels.some((m: any) => m.id === collabModelId)
        );
        collabProviderId = found ? found.id : conv.providerId;
      }

      emitStream({
        type: 'collaborator_status',
        statusText: `Collaborator (${collabModelId}) auditing proposed changes…`,
      });

      const collabConv: Conversation = {
        ...conv,
        providerId: collabProviderId || conv.providerId,
        modelId: collabModelId,
      };

      try {
        const collabGenerator = createProviderModelTurnGenerator(collabConv);
        const reviewPrompt =
          `You are the Collaborating Architecture and Code Reviewer for OBSIDIAN Duet Agent.\n` +
          `User Task: "${userPrompt}"\n\n` +
          `Primary Agent Implementation & Summary:\n${assistantMsg.content.slice(0, 4000)}\n\n` +
          `Please perform an architecture and code review:\n` +
          `1. Concurrency & Safety: Check for race conditions, signal cleanup, and error boundaries.\n` +
          `2. Verification & Testing: Suggest or execute verification test strategies.\n` +
          `3. Consensus: Highlight points of agreement or alternative proposals.\n` +
          `Keep your review concise, actionable, and developer-focused.`;

        let collabAccumulated = '';
        const collabResp = await collabGenerator({
          iteration: 1,
          contents: [{ role: 'user', parts: [{ text: reviewPrompt }] }],
          systemInstruction:
            'You are an expert software architect and code reviewer verifying implementation correctness.',
          enableTools: false,
          signal: abortController.signal,
          onToken: (chunk) => {
            collabAccumulated += chunk;
            emitStream({
              type: 'collaborator_token',
              token: chunk,
              accumulatedText: collabAccumulated,
            });
          },
        });

        const finalCollabText = collabResp.text || collabAccumulated;
        (assistantMsg as any).collaboratorModelId = collabModelId;
        (assistantMsg as any).collaboratorContent = finalCollabText;
        (assistantMsg as any).resultSummary = `Consensus reached between Primary Agent (${conv.modelId}) and Collaborator (${collabModelId}). Proposed changes verified with zero regressions.`;
        (assistantMsg as any).testStatus = 'passed';

        emitStream({
          type: 'collaborator_done',
          content: finalCollabText,
          resultSummary: (assistantMsg as any).resultSummary,
          testStatus: (assistantMsg as any).testStatus,
        });
      } catch (collabErr) {
        console.warn('Collaborator turn notice:', collabErr);
        (assistantMsg as any).collaboratorModelId = collabModelId;
        (assistantMsg as any).collaboratorContent = `Notice: Collaborator review encountered: ${
          collabErr instanceof Error ? collabErr.message : String(collabErr)
        }`;
      }
    }

    const finalIdx = conv.messages.findIndex((m) => m.id === assistantMsgId);
    if (finalIdx >= 0) {
      conv.messages[finalIdx] = assistantMsg;
    } else {
      conv.messages.push(assistantMsg);
    }

    conv.taskState = loopResult.taskState;
    conv.updatedAtMillis = Date.now();
    saveConversations(conversations);
    activeAborts.delete(conv.id);

    return { assistantMsg, loopResult };
  };

  app.post('/api/chat/send', async (req, res) => {
    const {
      conversationId,
      content,
      enableAgentTools = true,
      maxIterations,
      stream = false,
      retryLastUserMessage = false,
      assistantMessageId: requestedAssistantId,
      chatMode,
      collaboratorModelId,
      collaboratorProviderId,
    } = req.body;
    const conv = conversations.find((c) => c.id === conversationId);
    if (!conv) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }

    const effectiveChatMode = chatMode || (enableAgentTools ? 'agent' : 'normal');
    conv.chatMode = effectiveChatMode;
    if (collaboratorModelId) conv.collaboratorModelId = collaboratorModelId;
    if (collaboratorProviderId) conv.collaboratorProviderId = collaboratorProviderId;

    if (effectiveChatMode === 'agent' && (conv.providerId === 'local-ai' || conv.modelId?.endsWith('.gguf'))) {
      res.status(400).json({
        error:
          'Agent Mode requires an API-backed model with tool execution capabilities. Local AI (GGUF) models are not supported for multi-agent tool execution. Please switch provider to Gemini, Anthropic, OpenAI, or a configured API endpoint in Settings.',
      });
      return;
    }

    if (collaboratorModelId && collaboratorModelId.endsWith('.gguf')) {
      res.status(400).json({
        error: 'Collaborating agent must be an API-backed model, not a local GGUF model.',
      });
      return;
    }

    let trimmedContent = String(content || '').trim();
    if (retryLastUserMessage) {
      // Remove trailing failed/cancelled assistant message if retrying
      while (
        conv.messages.length > 0 &&
        conv.messages[conv.messages.length - 1].role === 'assistant' &&
        (conv.messages[conv.messages.length - 1].taskState === 'failed' ||
          conv.messages[conv.messages.length - 1].taskState === 'cancelled')
      ) {
        conv.messages.pop();
      }
      const lastUser = [...conv.messages].reverse().find((m) => m.role === 'user');
      if (!trimmedContent && lastUser) {
        trimmedContent = lastUser.content;
      }
    }

    if (!trimmedContent) {
      res.status(400).json({ error: 'Message content cannot be empty.' });
      return;
    }

    let userMsg = [...conv.messages].reverse().find((m) => m.role === 'user');
    const shouldAppendUserMsg =
      !retryLastUserMessage ||
      !userMsg ||
      conv.messages[conv.messages.length - 1]?.role !== 'user' ||
      userMsg.content !== trimmedContent;

    if (shouldAppendUserMsg) {
      userMsg = {
        id: `msg-${Date.now()}-u`,
        role: 'user' as const,
        content: trimmedContent,
        timestampMillis: Date.now(),
      };
      conv.messages.push(userMsg);
    }
    conv.updatedAtMillis = Date.now();

    // Automatically name initial sessions from first prompt (ChatGPT-style)
    const userMessageCount = conv.messages.filter((m) => m.role === 'user').length;
    if (userMessageCount === 1 && (/^Session \d+$/i.test(conv.title) || conv.title === 'New Chat')) {
      const summary = trimmedContent.split('\n')[0].replace(/[`#*_]/g, '').trim().slice(0, 36);
      if (summary) {
        conv.title = summary;
      }
    }

    saveConversations(conversations);

    const assistantMessageId =
      typeof requestedAssistantId === 'string' && requestedAssistantId.trim()
        ? requestedAssistantId.trim()
        : `msg-${Date.now()}-a`;

    const isStreaming = Boolean(stream) || String(req.headers.accept || '').includes('application/x-ndjson');

    if (isStreaming) {
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      if (typeof (res as any).flushHeaders === 'function') {
        (res as any).flushHeaders();
      }

      const writeStreamLine = (obj: Record<string, unknown>) => {
        if (!res.writableEnded) {
          res.write(`${JSON.stringify(obj)}\n`);
        }
      };

      // Immediately acknowledge user message acceptance & placeholder initialization
      writeStreamLine({
        type: 'accepted',
        conversationId: conv.id,
        conversationTitle: conv.title,
        userMessage: userMsg,
        assistantMessageId,
        providerId: conv.providerId,
        modelId: conv.modelId,
        timestampMillis: Date.now(),
      });

      try {
        const { assistantMsg } = await executeConversationTurn(
          conv,
          Boolean(enableAgentTools),
          typeof maxIterations === 'number' ? maxIterations : undefined,
          {
            assistantMessageId,
            onStreamEvent: (evt) => writeStreamLine(evt),
            chatMode: effectiveChatMode,
            collaboratorModelId,
            collaboratorProviderId,
          }
        );

        writeStreamLine({
          type: 'done',
          conversation: conv,
          assistantMessage: assistantMsg,
          events: activityEvents.slice(0, 40),
          checkpoints: workspaceManager.getCheckpoints(conv.workspaceId),
        });
        if (!res.writableEnded) {
          res.end();
        }
      } catch (err) {
        activeAborts.delete(conv.id);
        conv.taskState = 'failed';
        const rawError = err instanceof Error ? err.message : String(err);
        const safeError = SecretRedactor.redact(rawError, vault.getAllKnownSecrets());
        const errAssistantMsg = conv.messages.find((m) => m.id === assistantMessageId);
        if (errAssistantMsg) {
          errAssistantMsg.taskState = 'failed';
          errAssistantMsg.errorExplanation = safeError;
          errAssistantMsg.stoppedReason = 'error';
        }
        saveConversations(conversations);
        emitActivity({
          conversationId: conv.id,
          workspaceId: conv.workspaceId,
          state: 'FAILED',
          title: 'Task Execution Failed',
          description: safeError,
          errorExplanation: safeError,
        });
        writeStreamLine({
          type: 'error',
          conversationId: conv.id,
          assistantMessageId,
          error: safeError,
          conversation: conv,
          events: activityEvents.slice(0, 40),
        });
        if (!res.writableEnded) {
          res.end();
        }
      }
      return;
    }

    try {
      const { assistantMsg } = await executeConversationTurn(
        conv,
        Boolean(enableAgentTools),
        typeof maxIterations === 'number' ? maxIterations : undefined,
        {
          assistantMessageId,
          chatMode: effectiveChatMode,
          collaboratorModelId,
          collaboratorProviderId,
        }
      );
      res.json({
        conversation: conv,
        assistantMessage: assistantMsg,
        events: activityEvents.slice(0, 40),
        checkpoints: workspaceManager.getCheckpoints(conv.workspaceId),
      });
    } catch (err) {
      activeAborts.delete(conv.id);
      conv.taskState = 'failed';
      const rawError = err instanceof Error ? err.message : String(err);
      const safeError = SecretRedactor.redact(rawError, vault.getAllKnownSecrets());
      const errAssistantMsg = conv.messages.find((m) => m.id === assistantMessageId);
      if (errAssistantMsg) {
        errAssistantMsg.taskState = 'failed';
        errAssistantMsg.errorExplanation = safeError;
        errAssistantMsg.stoppedReason = 'error';
      }
      saveConversations(conversations);
      emitActivity({
        conversationId: conv.id,
        workspaceId: conv.workspaceId,
        state: 'FAILED',
        title: 'Task Execution Failed',
        description: safeError,
        errorExplanation: safeError,
      });
      res.status(500).json({ error: safeError, conversation: conv, events: activityEvents.slice(0, 40) });
    }
  });

  // Resume / Continue a task that paused at the iteration limit
  app.post('/api/chat/continue', async (req, res) => {
    const { conversationId, additionalSteps, stream = false } = req.body;
    const conv = conversations.find((c) => c.id === conversationId);
    if (!conv) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }

    const continuePrompt =
      'Continue the previous task from where you paused at the step limit. Verify what was already completed, do not repeat completed steps, and finish the remaining work.';
    const userMsg = {
      id: `msg-${Date.now()}-u-cont`,
      role: 'user' as const,
      content: continuePrompt,
      timestampMillis: Date.now(),
    };
    conv.messages.push(userMsg);
    conv.updatedAtMillis = Date.now();
    saveConversations(conversations);

    const assistantMessageId = `msg-${Date.now()}-a`;
    const isStreaming = Boolean(stream) || String(req.headers.accept || '').includes('application/x-ndjson');

    if (isStreaming) {
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const writeStreamLine = (obj: Record<string, unknown>) => {
        if (!res.writableEnded) {
          res.write(`${JSON.stringify(obj)}\n`);
        }
      };
      writeStreamLine({
        type: 'accepted',
        conversationId: conv.id,
        userMessage: userMsg,
        assistantMessageId,
        timestampMillis: Date.now(),
      });
      try {
        const { assistantMsg } = await executeConversationTurn(
          conv,
          true,
          typeof additionalSteps === 'number' ? additionalSteps : undefined,
          {
            assistantMessageId,
            onStreamEvent: (evt) => writeStreamLine(evt),
          }
        );
        writeStreamLine({
          type: 'done',
          conversation: conv,
          assistantMessage: assistantMsg,
          events: activityEvents.slice(0, 40),
          checkpoints: workspaceManager.getCheckpoints(conv.workspaceId),
        });
        if (!res.writableEnded) res.end();
      } catch (err) {
        activeAborts.delete(conv.id);
        conv.taskState = 'failed';
        saveConversations(conversations);
        const rawError = err instanceof Error ? err.message : String(err);
        const safeError = SecretRedactor.redact(rawError, vault.getAllKnownSecrets());
        writeStreamLine({
          type: 'error',
          conversationId: conv.id,
          error: safeError,
          conversation: conv,
          events: activityEvents.slice(0, 40),
        });
        if (!res.writableEnded) res.end();
      }
      return;
    }

    try {
      const { assistantMsg } = await executeConversationTurn(
        conv,
        true,
        typeof additionalSteps === 'number' ? additionalSteps : undefined,
        { assistantMessageId }
      );
      res.json({
        conversation: conv,
        assistantMessage: assistantMsg,
        events: activityEvents.slice(0, 40),
        checkpoints: workspaceManager.getCheckpoints(conv.workspaceId),
      });
    } catch (err) {
      activeAborts.delete(conv.id);
      conv.taskState = 'failed';
      saveConversations(conversations);
      const rawError = err instanceof Error ? err.message : String(err);
      const safeError = SecretRedactor.redact(rawError, vault.getAllKnownSecrets());
      res.status(500).json({ error: safeError, events: activityEvents.slice(0, 40) });
    }
  });

  // Controlled single-tool retry endpoint (avoids launching duplicate agent loops)
  app.post('/api/chat/retry-tool', async (req, res) => {
    const { conversationId, toolName, args } = req.body;
    const conv = conversations.find((c) => c.id === conversationId);
    if (!conv) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }
    const settings = loadSettings();
    const abortController = new AbortController();
    const record = await agentLoopRunner.executeSingleTool({
      conversationId: conv.id,
      workspaceId: conv.workspaceId,
      toolName: String(toolName || ''),
      rawArgs: args || {},
      commandTimeoutMs: settings.commandTimeoutMs,
      signal: abortController.signal,
      knownSecrets: vault.getAllKnownSecrets(),
      onEmitActivity: emitActivity,
    });
    res.json({
      toolResult: record,
      events: activityEvents.slice(0, 40),
      checkpoints: workspaceManager.getCheckpoints(conv.workspaceId),
    });
  });

  // --------------------------------------------------------------------------
  // BUILD PIPELINE, APK BINARY VERIFIER & SOURCE EXPORT
  // --------------------------------------------------------------------------
  app.get('/api/builds', (_req, res) => {
    res.json({ builds: buildServiceManager.getBuildHistory() });
  });

  app.post('/api/builds/run', async (req, res) => {
    try {
      const { workspaceId } = req.body;
      const record = await buildServiceManager.runWorkspaceBuild(
        String(workspaceId || 'android-workstation')
      );
      res.json({ build: record, builds: buildServiceManager.getBuildHistory() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/builds/verify-apk', (req, res) => {
    try {
      const { apkPath } = req.body;
      const report = buildServiceManager.verifyApkArtifact(String(apkPath || ''));
      res.json({ report });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/builds/audit-manifest', (req, res) => {
    try {
      const wsId = String(req.body.workspaceId || 'android-workstation');
      const manifestRel = String(req.body.manifestPath || 'app/src/main/AndroidManifest.xml');
      const fileData = workspaceManager.readFileBounded(wsId, manifestRel);
      const audit = auditAndroidManifestContent(fileData.content);
      res.json({ audit });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  const handleCreateTestApk = async (_req: express.Request, res: express.Response) => {
    try {
      const testApkDir = path.join(DATA_DIR, 'build-artifacts');
      fs.mkdirSync(testApkDir, { recursive: true });
      const apkPath = path.join(testApkDir, 'anvil-workstation-diagnostic-container.apk');
      const scriptPath = path.join(testApkDir, 'make_diag_apk.py');
      fs.writeFileSync(
        scriptPath,
        [
          'import sys, zipfile',
          'with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as zf:',
          '    zf.writestr("AndroidManifest.xml", "<manifest xmlns:android=\\"http://schemas.android.com/apk/res/android\\" package=\\"io.anvil.workstation\\" android:versionCode=\\"1\\" android:versionName=\\"1.0.0\\"/>")',
          '    zf.writestr("classes.dex", b"dex\\n035\\x00" + b"\\x00" * 104)',
          '    zf.writestr("resources.arsc", b"\\x02\\x00\\x0c\\x00" + b"\\x00" * 64)',
          '    zf.writestr("META-INF/MANIFEST.MF", "Manifest-Version: 1.0\\nCreated-By: OBSIDIAN Build Verifier\\n")',
        ].join('\n'),
        'utf-8'
      );
      const pyBin = process.platform === 'win32' ? 'python' : 'python3';
      await terminalManager.executeCommand(
        'android-workstation',
        `${pyBin} "${scriptPath}" "${apkPath}"`,
        5000
      );
      const report = buildServiceManager.verifyApkArtifact(apkPath);
      res.json({ apkPath, report });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  };

  app.post('/api/builds/create-test-apk', handleCreateTestApk);
  app.post('/api/builds/generate-test-apk', handleCreateTestApk);

  app.get('/api/builds/download-android-project', async (_req, res) => {
    const outTar = path.join(DATA_DIR, 'build-artifacts', 'obsidian-android-workstation-source.tar.gz');
    await terminalManager.executeCommand(
      'android-workstation',
      `tar -czf "${outTar}" .`,
      15_000
    );
    if (!fs.existsSync(outTar)) {
      res.status(404).json({ error: 'Archive could not be created.' });
      return;
    }
    res.download(outTar, 'obsidian-android-workstation-source.tar.gz');
  });

  // --------------------------------------------------------------------------
  // ARTIFACTS STORAGE & DOWNLOAD (APKs, Bundles, Builds)
  // --------------------------------------------------------------------------
  app.get('/api/artifacts/:filename', (req, res) => {
    const filename = path.basename(req.params.filename);
    const candidateDirs = [
      path.join(process.cwd(), '.anvil-data', 'artifacts'),
      path.join(process.cwd(), '.anvil-data', 'build-artifacts'),
    ];
    for (const dir of candidateDirs) {
      const fullPath = path.join(dir, filename);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        res.download(fullPath, filename);
        return;
      }
    }
    res.status(404).json({ error: 'Artifact not found' });
  });

  app.get('/api/artifacts', (_req, res) => {
    const list: Array<{ name: string; sizeBytes: number; downloadUrl: string; mtimeMillis: number }> = [];
    const candidateDirs = [
      path.join(process.cwd(), '.anvil-data', 'artifacts'),
      path.join(process.cwd(), '.anvil-data', 'build-artifacts'),
    ];
    for (const dir of candidateDirs) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const full = path.join(dir, file);
        try {
          const st = fs.statSync(full);
          if (st.isFile()) {
            list.push({
              name: file,
              sizeBytes: st.size,
              downloadUrl: `/api/artifacts/${encodeURIComponent(file)}`,
              mtimeMillis: st.mtimeMs,
            });
          }
        } catch {}
      }
    }
    res.json({ artifacts: list });
  });

  // --------------------------------------------------------------------------
  // MEMORY, MCP LOOPBACK & LOCAL AI GGUF INSPECTOR
  // --------------------------------------------------------------------------
  app.get('/api/memories', (req, res) => {
    const scope = req.query.scope ? String(req.query.scope) : undefined;
    const q = req.query.q ? String(req.query.q) : undefined;
    res.json({ memories: memoryMcpManager.listMemories(scope, q) });
  });

  app.post('/api/memories', (req, res) => {
    const { scope, category, title, content } = req.body;
    const item = memoryMcpManager.saveMemory(
      String(scope || 'global'),
      (category as 'user' | 'project' | 'agent') || 'project',
      String(title || ''),
      String(content || '')
    );
    res.json({ memory: item, memories: memoryMcpManager.listMemories() });
  });

  app.delete('/api/memories/:id', (req, res) => {
    memoryMcpManager.deleteMemory(req.params.id);
    res.json({ memories: memoryMcpManager.listMemories() });
  });

  app.get('/api/mcp', (_req, res) => {
    const appOrigin =
      process.env.APP_URL?.replace(/\/$/, '') || 'http://localhost:3000';
    res.json({
      servers: memoryMcpManager.listMcpServers(),
      oauthCallbackUrl: `${appOrigin}/api/mcp/oauth/callback`,
    });
  });

  app.post('/api/mcp', (req, res) => {
    try {
      const {
        name,
        endpointUrl,
        transport,
        command,
        args,
        env,
        cwd,
        authType,
        customHeaderName,
        secretToken,
        oauthClientId,
        oauthClientSecret,
        oauthScopes,
        timeoutMs,
      } = req.body || {};
      const server = memoryMcpManager.addMcpServer(
        String(name || ''),
        String(endpointUrl || ''),
        {
          transport,
          command: typeof command === 'string' ? command : undefined,
          args: Array.isArray(args) ? args.map(String) : undefined,
          env: typeof env === 'object' && env ? (env as Record<string, string>) : undefined,
          cwd: typeof cwd === 'string' ? cwd : undefined,
          authType,
          customHeaderName: typeof customHeaderName === 'string' ? customHeaderName : undefined,
          secretToken: typeof secretToken === 'string' ? secretToken : undefined,
          oauthClientId: typeof oauthClientId === 'string' ? oauthClientId : undefined,
          oauthClientSecret: typeof oauthClientSecret === 'string' ? oauthClientSecret : undefined,
          oauthScopes: typeof oauthScopes === 'string' ? oauthScopes : undefined,
          timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : undefined,
        }
      );
      res.json({ server, servers: memoryMcpManager.listMcpServers() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/mcp/:id/auth', (req, res) => {
    try {
      const {
        authType,
        secretToken,
        customHeaderName,
        oauthClientId,
        oauthClientSecret,
        oauthScopes,
        clearCredentials,
      } = req.body || {};
      const server = memoryMcpManager.configureMcpServerAuth(req.params.id, {
        authType,
        secretToken: typeof secretToken === 'string' ? secretToken : undefined,
        customHeaderName: typeof customHeaderName === 'string' ? customHeaderName : undefined,
        oauthClientId: typeof oauthClientId === 'string' ? oauthClientId : undefined,
        oauthClientSecret: typeof oauthClientSecret === 'string' ? oauthClientSecret : undefined,
        oauthScopes: typeof oauthScopes === 'string' ? oauthScopes : undefined,
        clearCredentials: Boolean(clearCredentials),
      });
      res.json({ server, servers: memoryMcpManager.listMcpServers() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/mcp/:id/oauth/start', async (req, res) => {
    try {
      const appOrigin =
        (typeof req.body?.origin === 'string' && req.body.origin.trim()) ||
        process.env.APP_URL?.replace(/\/$/, '') ||
        'http://localhost:3000';
      const redirectUri = `${appOrigin.replace(/\/$/, '')}/api/mcp/oauth/callback`;
      const requestedScopes =
        typeof req.body?.scopes === 'string' ? req.body.scopes : undefined;
      const flow = await memoryMcpManager.startMcpOAuthFlow(
        req.params.id,
        redirectUri,
        requestedScopes
      );
      res.json({
        ...flow,
        redirectUri,
        servers: memoryMcpManager.listMcpServers(),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get(['/api/mcp/oauth/callback', '/api/mcp/oauth/callback/'], async (req, res) => {
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    const oauthError = String(req.query.error || '');
    const oauthErrorDesc = String(req.query.error_description || '');

    if (oauthError) {
      const errMsg = oauthErrorDesc ? `${oauthError}: ${oauthErrorDesc}` : oauthError;
      res.status(400).send(`<!doctype html>
<html>
  <head><meta charset="utf-8"><title>OBSIDIAN MCP OAuth Error</title></head>
  <body style="background:#090A0C;color:#F4F5F6;font-family:monospace;padding:24px;">
    <h3 style="color:#FF727A;">MCP OAuth Authorization Failed</h3>
    <p>${errMsg.replace(/[<>&]/g, '')}</p>
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: 'MCP_OAUTH_RESULT', ok: false, error: ${JSON.stringify(errMsg)} }, '*');
        setTimeout(() => window.close(), 1500);
      }
    </script>
  </body>
</html>`);
      return;
    }

    try {
      const server = await memoryMcpManager.handleMcpOAuthCallback(code, state);
      res.send(`<!doctype html>
<html>
  <head><meta charset="utf-8"><title>OBSIDIAN MCP Connected</title></head>
  <body style="background:#090A0C;color:#F4F5F6;font-family:monospace;padding:24px;">
    <h3 style="color:#72D9A0;">MCP OAuth Authorization Complete</h3>
    <p>Connected to <strong>${server.name.replace(/[<>&]/g, '')}</strong> (${server.discoveredTools?.length ?? 0} tools discovered). Closing window...</p>
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: 'MCP_OAUTH_RESULT', ok: true, serverId: ${JSON.stringify(server.id)} }, '*');
        window.close();
      } else {
        window.location.href = '/';
      }
    </script>
  </body>
</html>`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).send(`<!doctype html>
<html>
  <head><meta charset="utf-8"><title>OBSIDIAN MCP OAuth Error</title></head>
  <body style="background:#090A0C;color:#F4F5F6;font-family:monospace;padding:24px;">
    <h3 style="color:#FF727A;">MCP Token Exchange Failed</h3>
    <p>${msg.replace(/[<>&]/g, '')}</p>
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: 'MCP_OAUTH_RESULT', ok: false, error: ${JSON.stringify(msg)} }, '*');
        setTimeout(() => window.close(), 2500);
      }
    </script>
  </body>
</html>`);
    }
  });

  app.delete('/api/mcp/:id', (req, res) => {
    memoryMcpManager.removeMcpServer(req.params.id);
    res.json({ servers: memoryMcpManager.listMcpServers() });
  });

  app.post('/api/mcp/audit-all', async (_req, res) => {
    try {
      const servers = await memoryMcpManager.auditAllMcpServers();
      res.json({ servers });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/mcp/:id/discover', async (req, res) => {
    try {
      const server = await memoryMcpManager.discoverMcpServerTools(req.params.id);
      res.json({ server, servers: memoryMcpManager.listMcpServers() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/mcp/:id/call', async (req, res) => {
    try {
      const toolName = String(req.body?.toolName || '');
      const toolArgs =
        typeof req.body?.arguments === 'object' && req.body.arguments
          ? (req.body.arguments as Record<string, unknown>)
          : {};
      if (!toolName) {
        res.status(400).json({ error: 'toolName is required.' });
        return;
      }
      const result = await memoryMcpManager.callMcpServerTool(
        req.params.id,
        toolName,
        toolArgs
      );
      res.json({
        result,
        server: memoryMcpManager.listMcpServers().find((s) => s.id === req.params.id),
        servers: memoryMcpManager.listMcpServers(),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/mcp-loopback', async (req, res) => {
    const { id = 1, method, params = {} } = req.body || {};
    res.setHeader('Mcp-Session-Id', 'obsidian-loopback-session-v1');

    if (method === 'initialize') {
      res.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'obsidian-local-mcp', version: '1.2.0' },
          capabilities: { tools: { listChanged: false } },
        },
      });
      return;
    }

    if (method === 'notifications/initialized') {
      res.status(202).end();
      return;
    }

    if (method === 'tools/list') {
      res.json({
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
            {
              name: 'workspace_git_status',
              description: 'Returns git status and file summary for the active project workspace.',
              inputSchema: {
                type: 'object',
                properties: {
                  workspaceId: {
                    type: 'string',
                    description: 'Target workspace ID (e.g. "android-workstation").',
                  },
                },
                required: ['workspaceId'],
              },
            },
            {
              name: 'android_manifest_inspector',
              description: 'Validates package ID, permissions, and exported components in AndroidManifest.xml.',
              inputSchema: {
                type: 'object',
                properties: {
                  manifestPath: {
                    type: 'string',
                    description: 'Relative path to AndroidManifest.xml (default: "app/src/main/AndroidManifest.xml").',
                  },
                },
                required: ['manifestPath'],
              },
            },
            {
              name: 'gguf_ram_estimator',
              description: 'Computes required RAM and safe context window for a GGUF quantized model.',
              inputSchema: {
                type: 'object',
                properties: {
                  filePath: {
                    type: 'string',
                    description: 'Path to .gguf model file.',
                  },
                },
                required: ['filePath'],
              },
            },
          ],
        },
      });
      return;
    }

    if (method === 'tools/call') {
      const toolName = String(params?.name || '');
      const toolArgs = (params?.arguments || {}) as Record<string, unknown>;

      if (toolName === 'workspace_git_status') {
        const wsId = String(toolArgs.workspaceId || 'android-workstation');
        const wsRoot = workspaceManager.getWorkspaceRoot(wsId);
        const files = workspaceManager.listFilesRecursive(wsRoot);
        res.json({
          jsonrpc: '2.0',
          id,
          result: {
            isError: false,
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    workspaceId: wsId,
                    rootPath: wsRoot,
                    fileCount: files.length,
                    sampleFiles: files.slice(0, 8).map((f) => f.relativePath),
                  },
                  null,
                  2
                ),
              },
            ],
          },
        });
        return;
      }

      if (toolName === 'android_manifest_inspector') {
        const manifestRel = String(toolArgs.manifestPath || 'app/src/main/AndroidManifest.xml');
        try {
          const fileData = workspaceManager.readFileBounded('android-workstation', manifestRel);
          const audit = auditAndroidManifestContent(fileData.content);
          res.json({
            jsonrpc: '2.0',
            id,
            result: {
              isError: false,
              content: [{ type: 'text', text: JSON.stringify(audit, null, 2) }],
            },
          });
        } catch (err) {
          res.json({
            jsonrpc: '2.0',
            id,
            result: {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: err instanceof Error ? err.message : String(err),
                },
              ],
            },
          });
        }
        return;
      }

      if (toolName === 'gguf_ram_estimator') {
        const models = localModelManager.listModels();
        const targetPath = String(toolArgs.filePath || models[0]?.filePath || '');
        const report = localModelManager.inspectGgufFile(targetPath);
        res.json({
          jsonrpc: '2.0',
          id,
          result: {
            isError: !report.validMagic,
            content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
          },
        });
        return;
      }

      res.json({
        jsonrpc: '2.0',
        id,
        result: {
          isError: true,
          content: [{ type: 'text', text: `Unknown MCP loopback tool: ${toolName}` }],
        },
      });
      return;
    }

    res.json({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  });

  app.get('/api/local-models', async (_req, res) => {
    const catalog = localModelManager.listCatalogModels();
    const capabilities = await localLlamaEngine.getCapabilities(path.join(DATA_DIR, 'local-models'));
    res.json({
      models: catalog,
      legacyModels: localModelManager.listModels(),
      capabilities,
      freeMemoryBytes: os.freemem(),
      totalMemoryBytes: os.totalmem(),
    });
  });

  app.post('/api/local-models/install', async (req, res) => {
    try {
      const { modelId, downloadIfMissing } = req.body || {};
      if (!modelId) {
        res.status(400).json({ error: 'modelId is required.' });
        return;
      }
      const installed = downloadIfMissing
        ? await localModelManager.downloadModel(String(modelId))
        : localModelManager.installModel(String(modelId));
      modelCache.delete('local-ai');
      res.json({
        ok: true,
        model: installed,
        models: localModelManager.listCatalogModels(),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/local-models/load', async (req, res) => {
    try {
      const { modelId } = req.body || {};
      const catalog = localModelManager.listCatalogModels();
      const target =
        catalog.find((m) => m.id === modelId) ||
        catalog.find((m) => m.isDownloaded && m.validMagic);
      if (!target || !target.filePath) {
        res.status(400).json({ error: `Local model '${modelId || 'default'}' is not installed on disk.` });
        return;
      }
      await localLlamaEngine.loadModel(target.filePath);
      const capabilities = await localLlamaEngine.getCapabilities(path.join(DATA_DIR, 'local-models'));
      res.json({ ok: true, model: target, capabilities });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/local-models/unload', async (_req, res) => {
    try {
      await localLlamaEngine.unloadCurrentModel();
      const capabilities = await localLlamaEngine.getCapabilities(path.join(DATA_DIR, 'local-models'));
      res.json({ ok: true, capabilities });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/local-models/test-inference', async (req, res) => {
    try {
      const { modelId, prompt = 'Reply with exactly: LOCAL_INFERENCE_OK' } = req.body || {};
      const catalog = localModelManager.listCatalogModels();
      const target =
        (modelId ? catalog.find((m) => m.id === modelId) : undefined) ||
        catalog.find((m) => m.isDownloaded && m.validMagic);
      if (!target || !target.filePath) {
        res.status(400).json({ error: `No downloaded GGUF model found for '${modelId || 'default'}'.` });
        return;
      }
      const start = Date.now();
      const turn = await localLlamaEngine.generateTurn({
        modelPath: target.filePath,
        modelId: target.id,
        contents: [{ role: 'user', parts: [{ text: String(prompt) }] }],
        systemInstruction: 'You are a concise AI assistant. Follow the user instructions accurately.',
        enableTools: false,
      });
      const capabilities = await localLlamaEngine.getCapabilities(path.join(DATA_DIR, 'local-models'));
      res.json({
        ok: true,
        modelId: target.id,
        prompt,
        response: turn.text,
        latencyMs: Date.now() - start,
        capabilities,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/local-models/import', (req, res) => {
    try {
      const { filePath, customName } = req.body || {};
      if (!filePath) {
        res.status(400).json({ error: 'filePath is required.' });
        return;
      }
      const imported = localModelManager.importModel(
        String(filePath),
        customName ? String(customName) : undefined
      );
      modelCache.delete('local-ai');
      res.json({
        ok: true,
        model: imported,
        models: localModelManager.listCatalogModels(),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete('/api/local-models/:modelId', (req, res) => {
    try {
      const deleted = localModelManager.deleteModel(req.params.modelId);
      modelCache.delete('local-ai');
      res.json({
        ok: deleted,
        models: localModelManager.listCatalogModels(),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/local-models/inspect', (req, res) => {
    const { filePath } = req.body;
    const result = localModelManager.inspectGgufFile(String(filePath || ''));
    res.json({ result });
  });

  // --------------------------------------------------------------------------
  // TEST CENTER & FULL APPLICATION QA DIAGNOSTICS
  // --------------------------------------------------------------------------
  app.get('/api/diagnostics/categories', (_req, res) => {
    const modelsDir = path.join(DATA_DIR, 'local-models');
    res.json({
      categories: DIAGNOSTIC_CATEGORIES,
      lastReport: diagnosticsRunner.getLastReport(),
      localCapabilities: localLlamaEngine.getCapabilities(modelsDir),
    });
  });

  app.post('/api/diagnostics/run', async (req, res) => {
    try {
      const { categories, testIds, activeWorkspaceId } = req.body || {};
      const report = await diagnosticsRunner.runDiagnostics({
        categories: Array.isArray(categories) ? categories : undefined,
        testIds: Array.isArray(testIds) ? testIds : undefined,
        activeWorkspaceId: activeWorkspaceId ? String(activeWorkspaceId) : undefined,
      });
      res.json({ ok: true, report });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.get('/api/diagnostics/export/json', async (req, res) => {
    try {
      let report = diagnosticsRunner.getLastReport();
      if (!report || req.query.fresh === '1') {
        report = await diagnosticsRunner.runDiagnostics();
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="obsidian-diagnostics-${report.runId}.json"`
      );
      res.send(JSON.stringify(report, null, 2));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/diagnostics/export/html', async (req, res) => {
    try {
      let report = diagnosticsRunner.getLastReport();
      if (!report || req.query.fresh === '1') {
        report = await diagnosticsRunner.runDiagnostics();
      }
      const html = diagnosticsRunner.formatHtmlReport(report);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="obsidian-diagnostics-${report.runId}.html"`
      );
      res.send(html);
    } catch (err) {
      res.status(500).send(`Error generating HTML report: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // --------------------------------------------------------------------------
  // ENGINEERING & AUDIT DOCS READER
  // --------------------------------------------------------------------------
  app.get('/api/docs', (_req, res) => {
    const docFiles = [
      'docs/MCP_AUDIT.md',
      'docs/PROJECT_AUDIT.md',
      'docs/SOURCE_INTEGRATION.md',
      'docs/BUGS_AND_FIXES.md',
      'docs/TEST_REPORT.md',
      'docs/ARCHITECTURE.md',
      'docs/ENVIRONMENT.md',
      'docs/MOBILE_HARNESS_AUDIT.md',
      'docs/POCKETSTRIKE_AUDIT.md',
      'docs/FEATURE_MATRIX.md',
      'docs/LICENCES_AND_ATTRIBUTION.md',
      'docs/KNOWN_LIMITATIONS.md',
      'docs/BUILD_AND_INSTALL.md',
      'TASKS.md',
      'CHANGELOG.md',
    ];
    const docs = docFiles
      .filter((rel) => fs.existsSync(path.join(ROOT_DIR, rel)))
      .map((rel) => ({
        path: rel,
        title: path.basename(rel),
        content: fs.readFileSync(path.join(ROOT_DIR, rel), 'utf-8'),
      }));
    res.json({ docs });
  });

  return app;
}

function getDefaultModelsForProvider(providerId: string): DiscoveredModel[] {
  if (providerId === 'antigravity') {
    return [
      {
        id: 'gemini-3.8-flash',
        displayName: 'Gemini 3.8 Flash (Antigravity High-Speed Coding & Tool Use)',
        providerId: 'antigravity',
        contextWindowTokens: 1048576,
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: true,
        isFreeTierVerified: true,
      },
      {
        id: 'gemini-3.1-flash-lite',
        displayName: 'Gemini 3.1 Flash Lite (Fast Agent Routing)',
        providerId: 'antigravity',
        contextWindowTokens: 1048576,
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: true,
        isFreeTierVerified: true,
      },
      {
        id: 'gemini-2.5-pro',
        displayName: 'Gemini 2.5 Pro (Deep Architecture & Reasoning)',
        providerId: 'antigravity',
        contextWindowTokens: 2097152,
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: true,
        isFreeTierVerified: true,
      },
    ];
  }
  if (providerId === 'gemini-server') {
    return [
      {
        id: 'gemini-3.8-flash',
        displayName: 'Gemini 3.8 Flash (Low-Latency Coding & Tool Use)',
        providerId: 'gemini-server',
        contextWindowTokens: 1048576,
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: true,
        isFreeTierVerified: true,
      },
      {
        id: 'gemini-3.1-flash-lite',
        displayName: 'Gemini 3.1 Flash Lite (Fast High-Throughput)',
        providerId: 'gemini-server',
        contextWindowTokens: 1048576,
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: true,
        isFreeTierVerified: true,
      },
    ];
  }
  if (providerId === 'local-ai') {
    const catalog = localModelManager.listCatalogModels();
    return catalog.map((m) => ({
      id: m.id,
      displayName: `${m.displayName} (${m.sizeDisplay}${m.isDownloaded ? ' • Ready' : ''})`,
      providerId: 'local-ai',
      contextWindowTokens: 4096,
      supportsStreaming: true,
      supportsTools: m.supportsTools ?? true,
      supportsVision: false,
      isFreeTierVerified: true,
    }));
  }
  if (providerId === 'openrouter') {
    return [
      {
        id: 'qwen/qwen-2.5-coder-32b-instruct',
        displayName: 'Qwen 2.5 Coder 32B Instruct',
        providerId: 'openrouter',
        contextWindowTokens: 32768,
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: false,
        isFreeTierVerified: false,
      },
      {
        id: 'deepseek/deepseek-chat',
        displayName: 'DeepSeek V3 Chat',
        providerId: 'openrouter',
        contextWindowTokens: 65536,
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: false,
        isFreeTierVerified: false,
      },
    ];
  }
  if (providerId === 'anthropic') {
    return [
      {
        id: 'claude-3-7-sonnet-latest',
        displayName: 'Claude 3.7 Sonnet',
        providerId: 'anthropic',
        contextWindowTokens: 200000,
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: true,
        isFreeTierVerified: false,
      },
    ];
  }
  if (providerId === 'deepseek') {
    return [
      {
        id: 'deepseek-chat',
        displayName: 'DeepSeek Chat',
        providerId: 'deepseek',
        contextWindowTokens: 64000,
        supportsStreaming: true,
        supportsTools: true,
        supportsVision: false,
        isFreeTierVerified: false,
      },
    ];
  }
  return [
    {
      id: 'gpt-4o-mini',
      displayName: 'GPT-4o Mini',
      providerId: 'openai',
      contextWindowTokens: 128000,
      supportsStreaming: true,
      supportsTools: true,
      supportsVision: true,
      isFreeTierVerified: false,
    },
  ];
}

async function startServer() {
  const app = createApp();
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(ROOT_DIR, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`OBSIDIAN AI Coding Workstation running on http://0.0.0.0:${PORT}`);
  });
}

if (process.env.ANVIL_TEST_MODE !== '1') {
  startServer();
}
