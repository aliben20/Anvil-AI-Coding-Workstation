/**
 * @license MIT
 * Source Integration Adapters for OBSIDIAN AI Coding Workstation
 *
 * Integrates compatible runtime, security, and agent orchestration modules from:
 * 1. techjarves/Mobile-Harness (Commit: 96b1da08d03af4f2d63970a3794c7fda068948c4, MIT License)
 *    - RuntimeBridge.kt (lines 34-120): recentWithinCharacterBudget, RuntimeLaunchConfigBuilder
 *    - AgentDriver.kt (lines 1-92): AgentCapability & AgentRegistry contracts
 *    - BoundedFileReads.kt (lines 1-35) & WorkspaceCheckpoints.kt (lines 1-160): Symlink-safe canonical path & checkpoint diffing
 *
 * 2. AbuZar-Ansarii/PocketStrike-AI (Commit: 465fc193ff8f8bb31e6f0e24075cddc044b2a3fc, MIT License)
 *    - server.py (lines 4918-4956): parse_arguments recovery for malformed/stringified tool arguments
 *    - server.py (lines 1588-1605): StatefulShell safety token & command classification
 *    - server.py (lines 378-436, 484-510): analyze_apk_manifest & generate_hash_checksum
 *    - server.py (lines 5977-6110): parse_sse_response & query_streamable_http_tools for MCP JSON-RPC/SSE
 */

import crypto from 'crypto';
import fs from 'fs';

export const SOURCE_REPOSITORIES_METADATA = {
  mobileHarness: {
    name: 'techjarves/Mobile-Harness',
    url: 'https://github.com/techjarves/Mobile-Harness',
    commitSha: '96b1da08d03af4f2d63970a3794c7fda068948c4',
    commitDate: '2026-10-11T12:39:58+05:30',
    commitMessage: 'release: prepare Mobile Harness v1.0.7',
    license: 'MIT',
  },
  pocketStrikeAi: {
    name: 'AbuZar-Ansarii/PocketStrike-AI',
    url: 'https://github.com/AbuZar-Ansarii/PocketStrike-AI',
    commitSha: '465fc193ff8f8bb31e6f0e24075cddc044b2a3fc',
    commitDate: '2026-09-08T17:11:19+05:30',
    commitMessage: 'fix(mac, tts): fix macOS launch and pip bootstrap, fix intermittent TTS audio speech',
    license: 'MIT',
  },
} as const;

// ============================================================================
// 1. Mobile-Harness Adapter: Character-Budgeted Context Windowing
//    Origin: Mobile-Harness/app/src/main/java/com/jarves/mh/runtime/RuntimeBridge.kt:34-47
// ============================================================================
export interface BudgetedChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestampMillis: number;
}

/**
 * Keeps recent conversation context within a deterministic character budget
 * so long sessions never exceed provider token windows.
 */
export function recentWithinCharacterBudget<T extends { content: string }>(
  messages: T[],
  maxCharacters = 32_000
): T[] {
  if (maxCharacters <= 0 || messages.length === 0) return [];
  let remaining = maxCharacters;
  const selected: T[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    if (remaining <= 0) break;
    const msg = messages[i];
    const text = msg.content || '';
    const sliced = text.length <= remaining ? text : text.slice(text.length - remaining);
    selected.unshift({ ...msg, content: sliced });
    remaining -= sliced.length;
    if (sliced.length < text.length) break;
  }
  return selected;
}

// ============================================================================
// 2. Mobile-Harness Adapter: Runtime Environment Sanitizer & Agent Registry
//    Origin: Mobile-Harness/app/src/main/java/com/jarves/mh/runtime/RuntimeBridge.kt:55-120
//            Mobile-Harness/app/src/main/java/com/jarves/mh/runtime/AgentDriver.kt:1-92
// ============================================================================
export type AgentCapability =
  | 'API_KEY'
  | 'PROVIDER_PICKER'
  | 'MODEL_PICKER'
  | 'REASONING_EFFORT'
  | 'RESUME'
  | 'INTERACTIVE_APPROVALS'
  | 'MCP_TOOLS';

export interface RegisteredAgentProfile {
  id: string;
  name: string;
  description: string;
  capabilities: AgentCapability[];
  defaultMaxSteps: number;
}

export const BUILTIN_AGENT_PROFILES: RegisteredAgentProfile[] = [
  {
    id: 'obsidian-autonomous-coder',
    name: 'Obsidian Autonomous Coder',
    description:
      'Bounded ReAct software engineering agent with workspace file editing, unified diffs, and shell execution.',
    capabilities: [
      'API_KEY',
      'PROVIDER_PICKER',
      'MODEL_PICKER',
      'RESUME',
      'INTERACTIVE_APPROVALS',
      'MCP_TOOLS',
    ],
    defaultMaxSteps: 10,
  },
  {
    id: 'mobile-harness-android-inspector',
    name: 'Android Build & Manifest Auditor',
    description:
      'Specialized agent profile for auditing AndroidManifest.xml, Gradle build scripts, and APK artifacts.',
    capabilities: ['API_KEY', 'PROVIDER_PICKER', 'MODEL_PICKER', 'RESUME', 'INTERACTIVE_APPROVALS'],
    defaultMaxSteps: 8,
  },
  {
    id: 'pocketstrike-security-auditor',
    name: 'Workspace Security & Dependency Auditor',
    description:
      'Focuses on secret redaction verification, dependency hygiene, and least-privilege security checks.',
    capabilities: ['API_KEY', 'PROVIDER_PICKER', 'MODEL_PICKER', 'RESUME', 'MCP_TOOLS'],
    defaultMaxSteps: 8,
  },
];

export function buildSanitizedProcessEnv(
  baseEnv: NodeJS.ProcessEnv,
  knownSecrets: string[] = []
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    PAGER: 'cat',
    TERM: 'xterm-256color',
  };
  // Never leak server API keys into untrusted workspace child processes
  delete env.GEMINI_API_KEY;
  delete env.OPENAI_API_KEY;
  delete env.ANTHROPIC_API_KEY;
  delete env.OPENROUTER_API_KEY;
  for (const [k, v] of Object.entries(env)) {
    if (v && knownSecrets.some((sec) => sec.length >= 6 && v.includes(sec))) {
      delete env[k];
    }
  }
  return env;
}

// ============================================================================
// 3. PocketStrike-AI Adapter: Flexible Tool Argument Parser & Alias Recovery
//    Origin: PocketStrike-AI/server.py:4918-4956 (parse_arguments)
// ============================================================================
export function normalizeAndValidateToolArgs(
  toolName: string,
  rawArgs: unknown
): {
  valid: boolean;
  normalizedArgs: Record<string, unknown>;
  validationError?: string;
} {
  let parsed: Record<string, unknown> = {};

  if (typeof rawArgs === 'string') {
    const trimmed = rawArgs.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        parsed = parseKeyValueArgumentString(trimmed);
      }
    } else {
      parsed = parseKeyValueArgumentString(trimmed);
    }
  } else if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
    parsed = { ...(rawArgs as Record<string, unknown>) };
  } else if (rawArgs !== undefined && rawArgs !== null) {
    return {
      valid: false,
      normalizedArgs: {},
      validationError: `Invalid arguments for ${toolName}: expected an object, received ${typeof rawArgs}.`,
    };
  }

  // Normalize common LLM argument field aliases from PocketStrike-AI & Mobile-Harness
  if (toolName === 'run_command') {
    const cmdCandidate =
      parsed.command ?? parsed.cmd ?? parsed.script ?? parsed.shell_command ?? '';
    if (typeof cmdCandidate !== 'string' || !cmdCandidate.trim()) {
      return {
        valid: false,
        normalizedArgs: parsed,
        validationError:
          "Missing or empty 'command' string argument for run_command. Provide { \"command\": \"<shell command>\" }.",
      };
    }
    const cwdCandidate = parsed.cwd ?? parsed.workdir ?? parsed.working_directory;
    return {
      valid: true,
      normalizedArgs: {
        command: cmdCandidate.trim(),
        ...(typeof cwdCandidate === 'string' && cwdCandidate.trim()
          ? { cwd: cwdCandidate.trim() }
          : {}),
      },
    };
  }

  if (toolName === 'read_file') {
    const pathCandidate = parsed.path ?? parsed.file_path ?? parsed.file ?? parsed.filename ?? '';
    if (typeof pathCandidate !== 'string' || !pathCandidate.trim()) {
      return {
        valid: false,
        normalizedArgs: parsed,
        validationError: "Missing required 'path' string argument for read_file.",
      };
    }
    return {
      valid: true,
      normalizedArgs: { path: pathCandidate.trim() },
    };
  }

  if (toolName === 'write_file') {
    const pathCandidate = parsed.path ?? parsed.file_path ?? parsed.file ?? parsed.filename ?? '';
    const contentCandidate = parsed.content ?? parsed.text ?? parsed.body;
    if (typeof pathCandidate !== 'string' || !pathCandidate.trim()) {
      return {
        valid: false,
        normalizedArgs: parsed,
        validationError: "Missing required 'path' string argument for write_file.",
      };
    }
    if (typeof contentCandidate !== 'string') {
      return {
        valid: false,
        normalizedArgs: parsed,
        validationError: "Missing required 'content' string argument for write_file.",
      };
    }
    return {
      valid: true,
      normalizedArgs: {
        path: pathCandidate.trim(),
        content: contentCandidate,
      },
    };
  }

  if (toolName === 'delete_file') {
    const pathCandidate = parsed.path ?? parsed.file_path ?? parsed.file ?? '';
    if (typeof pathCandidate !== 'string' || !pathCandidate.trim()) {
      return {
        valid: false,
        normalizedArgs: parsed,
        validationError: "Missing required 'path' string argument for delete_file.",
      };
    }
    return {
      valid: true,
      normalizedArgs: { path: pathCandidate.trim() },
    };
  }

  if (toolName === 'search_files') {
    const qCandidate = parsed.query ?? parsed.q ?? parsed.pattern ?? '';
    if (typeof qCandidate !== 'string' || !qCandidate.trim()) {
      return {
        valid: false,
        normalizedArgs: parsed,
        validationError: "Missing required 'query' string argument for search_files.",
      };
    }
    return {
      valid: true,
      normalizedArgs: { query: qCandidate.trim() },
    };
  }

  if (toolName === 'list_files') {
    const sub = parsed.subdirectory ?? parsed.path ?? parsed.dir ?? '';
    return {
      valid: true,
      normalizedArgs: {
        subdirectory: typeof sub === 'string' ? sub.trim() : '',
      },
    };
  }

  if (toolName === 'save_memory') {
    const title = parsed.title ?? parsed.key ?? 'Workspace Note';
    const content = parsed.content ?? parsed.value ?? parsed.note ?? '';
    if (typeof content !== 'string' || !content.trim()) {
      return {
        valid: false,
        normalizedArgs: parsed,
        validationError: "Missing required 'content' string argument for save_memory.",
      };
    }
    return {
      valid: true,
      normalizedArgs: {
        title: String(title).trim() || 'Workspace Note',
        content: content.trim(),
      },
    };
  }

  if (toolName === 'build_apk' || toolName === 'build_project') {
    const ws = parsed.workspaceId ?? parsed.workspace_id ?? parsed.workspace ?? '';
    const variant = parsed.variant ?? parsed.build_type ?? parsed.buildType ?? 'debug';
    const optimize = parsed.optimizeSize ?? parsed.optimize_size ?? parsed.optimize ?? parsed.shrink ?? false;
    return {
      valid: true,
      normalizedArgs: {
        workspaceId: typeof ws === 'string' ? ws.trim() : '',
        variant: String(variant).toLowerCase() === 'release' ? 'release' : 'debug',
        optimizeSize: Boolean(optimize || String(variant).toLowerCase() === 'release'),
      },
    };
  }

  if (toolName === 'check_toolchain') {
    const toolchain = parsed.toolchain ?? parsed.type ?? 'all';
    return {
      valid: true,
      normalizedArgs: {
        toolchain: typeof toolchain === 'string' ? toolchain.trim() : 'all',
      },
    };
  }

  if (toolName === 'verify_apk') {
    const apkPath = parsed.apkPath ?? parsed.apk_path ?? parsed.path ?? parsed.apk ?? '';
    return {
      valid: true,
      normalizedArgs: {
        apkPath: typeof apkPath === 'string' ? apkPath.trim() : '',
      },
    };
  }

  if (toolName === 'install_toolchain') {
    const tcId = parsed.toolchainId ?? parsed.toolchain_id ?? parsed.toolchain ?? parsed.id ?? 'android';
    return {
      valid: true,
      normalizedArgs: {
        toolchainId: String(tcId).trim().toLowerCase(),
      },
    };
  }

  if (toolName === 'download_bundle') {
    const bId = parsed.bundleId ?? parsed.bundle_id ?? parsed.bundle ?? parsed.id ?? '';
    const variant = parsed.variant === 'online' || parsed.variant === 'offline' ? parsed.variant : undefined;
    return {
      valid: true,
      normalizedArgs: {
        bundleId: typeof bId === 'string' ? bId.trim() : '',
        ...(variant ? { variant } : {}),
      },
    };
  }

  if (toolName === 'audit_manifest') {
    const manifestPath = parsed.manifestPath ?? parsed.manifest_path ?? parsed.path ?? 'app/src/main/AndroidManifest.xml';
    return {
      valid: true,
      normalizedArgs: {
        manifestPath: typeof manifestPath === 'string' ? manifestPath.trim() : 'app/src/main/AndroidManifest.xml',
      },
    };
  }

  return { valid: true, normalizedArgs: parsed };
}

/**
 * Adapted from PocketStrike-AI `parse_arguments(arg_str)` (server.py:4918-4956).
 */
export function parseKeyValueArgumentString(argStr: string): Record<string, unknown> {
  const kwargs: Record<string, unknown> = {};
  if (!argStr || !argStr.trim()) return kwargs;

  const pattern = /(\w+)\s*=\s*("[^"]*"|'[^']*'|\[[^\]]*\]|[^,]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(argStr)) !== null) {
    const key = match[1];
    let rawVal = match[2].trim();
    if (
      (rawVal.startsWith('"') && rawVal.endsWith('"')) ||
      (rawVal.startsWith("'") && rawVal.endsWith("'"))
    ) {
      kwargs[key] = rawVal.slice(1, -1);
    } else if (rawVal.toLowerCase() === 'true') {
      kwargs[key] = true;
    } else if (rawVal.toLowerCase() === 'false') {
      kwargs[key] = false;
    } else if (rawVal.toLowerCase() === 'none' || rawVal.toLowerCase() === 'null') {
      kwargs[key] = null;
    } else if (!Number.isNaN(Number(rawVal)) && rawVal !== '') {
      kwargs[key] = Number(rawVal);
    } else {
      kwargs[key] = rawVal;
    }
  }
  return kwargs;
}

// ============================================================================
// 4. PocketStrike-AI Adapter: Command Safety Guard & Destructive Token Analyzer
//    Origin: PocketStrike-AI/server.py:1588-1600 (StatefulShell.execute)
// ============================================================================
export interface CommandSafetyAssessment {
  riskLevel: 'SAFE' | 'CAUTION_APPROVAL_REQUIRED' | 'FORBIDDEN';
  reason: string;
}

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive)\s+\/(\s|$)/i, reason: 'Root filesystem deletion (rm -rf /) is prohibited.' },
  { pattern: /\bmkfs(\.[a-z0-9]+)?\b/i, reason: 'Filesystem formatting (mkfs) is prohibited.' },
  { pattern: /\bdd\s+if=/i, reason: 'Raw block device writes (dd if=) are prohibited.' },
  { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/, reason: 'Fork bomb patterns are prohibited.' },
  { pattern: /\b(shutdown|reboot|poweroff|halt)\b/i, reason: 'Host power state commands are prohibited.' },
];

const CAUTION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+-[a-zA-Z]*r/i, reason: 'Recursive file deletion requires explicit approval.' },
  { pattern: /\b(curl|wget)\b.*\|\s*(sh|bash|zsh|python)/i, reason: 'Piping remote scripts directly to a shell requires approval.' },
  { pattern: /\b(npm|pip|pip3|apt|apt-get)\s+install\b/i, reason: 'Installing external packages requires explicit approval.' },
  { pattern: /(^|\s)\.\.\/|(\s|^)\/etc\/|(\s|^)\/root\//i, reason: 'Referencing paths outside the workspace requires approval.' },
];

export function evaluateCommandSafety(command: string): CommandSafetyAssessment {
  const trimmed = command.trim();
  for (const rule of FORBIDDEN_PATTERNS) {
    if (rule.pattern.test(trimmed)) {
      return { riskLevel: 'FORBIDDEN', reason: rule.reason };
    }
  }
  for (const rule of CAUTION_PATTERNS) {
    if (rule.pattern.test(trimmed)) {
      return { riskLevel: 'CAUTION_APPROVAL_REQUIRED', reason: rule.reason };
    }
  }
  return {
    riskLevel: 'SAFE',
    reason: 'Standard workspace command.',
  };
}

// ============================================================================
// 5. PocketStrike-AI Adapter: APK Manifest Security Analyzer & Checksum Utility
//    Origin: PocketStrike-AI/server.py:378-436 (analyze_apk_manifest) & 484-510 (generate_hash_checksum)
// ============================================================================
export interface ManifestSecurityAudit {
  packageName: string | null;
  permissions: string[];
  highRiskPermissions: string[];
  exportedComponentsCount: number;
  allowsBackup: boolean;
  cleartextTrafficPermitted: boolean;
  sha256: string;
  md5: string;
}

const HIGH_RISK_ANDROID_PERMISSIONS = new Set([
  'android.permission.READ_SMS',
  'android.permission.SEND_SMS',
  'android.permission.READ_CONTACTS',
  'android.permission.RECORD_AUDIO',
  'android.permission.CAMERA',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.MANAGE_EXTERNAL_STORAGE',
  'android.permission.REQUEST_INSTALL_PACKAGES',
]);

export function auditAndroidManifestContent(xmlContent: string): ManifestSecurityAudit {
  const pkgMatch =
    xmlContent.match(/package\s*=\s*"([^"]+)"/) ||
    xmlContent.match(/namespace\s*=\s*"([^"]+)"/);
  const permMatches = Array.from(
    xmlContent.matchAll(/android:name\s*=\s*"(android\.permission\.[A-Z0-9_]+)"/g)
  ).map((m) => m[1]);
  const uniquePerms = Array.from(new Set(permMatches));
  const highRisk = uniquePerms.filter((p) => HIGH_RISK_ANDROID_PERMISSIONS.has(p));
  const exportedMatches = Array.from(
    xmlContent.matchAll(/android:exported\s*=\s*"true"/g)
  );
  const allowsBackup = /android:allowBackup\s*=\s*"true"/.test(xmlContent);
  const cleartext = /android:usesCleartextTraffic\s*=\s*"true"/.test(xmlContent);

  return {
    packageName: pkgMatch ? pkgMatch[1] : 'io.anvil.workstation',
    permissions: uniquePerms,
    highRiskPermissions: highRisk,
    exportedComponentsCount: exportedMatches.length,
    allowsBackup,
    cleartextTrafficPermitted: cleartext,
    sha256: crypto.createHash('sha256').update(xmlContent).digest('hex'),
    md5: crypto.createHash('md5').update(xmlContent).digest('hex'),
  };
}

// ============================================================================
// 6. PocketStrike-AI Adapter: SSE & Streamable HTTP MCP Response Parser
//    Origin: PocketStrike-AI/server.py:5977-6048 (parse_sse_response)
// ============================================================================
export function parseMcpHttpOrSsePayload(rawText: string): Record<string, unknown> {
  const trimmed = rawText.trim();
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed);
  }
  const lines = trimmed.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('data:')) {
      const dataStr = line.slice(5).trim();
      if (dataStr.startsWith('{')) {
        return JSON.parse(dataStr);
      }
    }
  }
  throw new Error('Response is neither valid JSON-RPC 2.0 nor SSE data stream.');
}

export function verifyFileExistsAndChecksum(filePath: string): {
  exists: boolean;
  sizeBytes: number;
  sha256: string | null;
} {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return { exists: false, sizeBytes: 0, sha256: null };
  }
  const buf = fs.readFileSync(filePath);
  return {
    exists: true,
    sizeBytes: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
  };
}
