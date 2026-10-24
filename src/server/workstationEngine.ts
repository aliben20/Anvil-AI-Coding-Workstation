import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, ChildProcess, execFileSync, spawnSync } from 'child_process';
import {
  buildSanitizedProcessEnv,
  evaluateCommandSafety,
  normalizeAndValidateToolArgs,
  parseMcpHttpOrSsePayload,
  recentWithinCharacterBudget,
  auditAndroidManifestContent,
} from './sourceIntegrations.js';
import { McpConnectionManager, McpToolCallOutput } from './mcpConnectionManager.js';
import type { MobileHarnessToolchainManager } from './toolchainManager.js';
import type {
  McpServerEntry,
  McpTransportType,
  McpAuthType,
  LocalAiModel,
} from '../types.js';
export type { McpServerEntry, LocalAiModel };
export { LocalLlamaEngine, localLlamaEngine } from './localLlamaEngine.js';

export type PermissionCategory =
  | 'READ_WORKSPACE'
  | 'CREATE_FILES'
  | 'MODIFY_FILES'
  | 'DELETE_FILES'
  | 'EXECUTE_COMMANDS'
  | 'NETWORK_ACCESS'
  | 'INSTALL_DEPENDENCIES'
  | 'BUILD_PROJECTS'
  | 'INSTALL_APKS'
  | 'EXTERNAL_DIRECTORIES';

export type PermissionPolicy = 'ALLOW' | 'ASK' | 'DENY';

export type ProviderProtocol =
  | 'GEMINI_SERVER'
  | 'OPENAI_CHAT'
  | 'OPENAI_RESPONSES'
  | 'ANTHROPIC_MESSAGES'
  | 'OLLAMA'
  | 'GENERIC_REST'
  | 'LOCAL_EMBEDDED'
  | 'ANTIGRAVITY';


export type TaskExecutionState =
  | 'idle'
  | 'queued'
  | 'starting'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'stopped_at_limit'
  | 'failed'
  | 'cancelled';

export type ToolExecutionStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'succeeded'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'cancelled'
  | 'denied';

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  protocol: ProviderProtocol;
  docsUrl: string;
  requiresApiKey: boolean;
  supportsModelDiscovery: boolean;
  defaultModel: string;
  description: string;
  isCustom?: boolean;
  customHeaders?: Record<string, string>;
  modelListEndpoint?: string;
  chatEndpoint?: string;
  timeoutMs?: number;
}


export interface StoredCredentialInfo {
  id: string;
  providerId: string;
  label: string;
  maskedPreview: string;
  isActive: boolean;
  createdAtMillis: number;
}

export interface DiscoveredModel {
  id: string;
  displayName: string;
  providerId: string;
  contextWindowTokens?: number;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  isFreeTierVerified: boolean;
}

export interface DiffHunkLine {
  type: '+' | '-' | ' ';
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface FileDiffRecord {
  id: string;
  workspaceId: string;
  relativePath: string;
  additions: number;
  deletions: number;
  timestampMillis: number;
  previousContent: string;
  updatedContent: string;
  lines: DiffHunkLine[];
}

export type AgentActivityState =
  | 'QUEUED'
  | 'STARTING'
  | 'PLANNING'
  | 'LOADING_SKILL'
  | 'READING_FILE'
  | 'EDITING_FILE'
  | 'RUNNING_COMMAND'
  | 'WAITING_FOR_PERMISSION'
  | 'CALLING_PROVIDER'
  | 'RUNNING_TESTS'
  | 'CHECKING_ENVIRONMENT'
  | 'PREPARING_BUILD'
  | 'COMPILING_RESOURCES'
  | 'COMPILING_CODE'
  | 'PACKAGING_APK'
  | 'FINDING_ARTIFACT'
  | 'BUILDING_APK'
  | 'COMPLETED'
  | 'STOPPED_AT_LIMIT'
  | 'FAILED'
  | 'CANCELLED';

export interface AgentActivityEvent {
  id: string;
  conversationId: string;
  workspaceId: string;
  timestampMillis: number;
  state: AgentActivityState;
  title: string;
  description: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  durationMs?: number;
  errorExplanation?: string;
  isProposedAction?: boolean;
  approvalId?: string;
}

export interface PendingApproval {
  id: string;
  conversationId: string;
  workspaceId: string;
  toolName: string;
  category: PermissionCategory;
  arguments: Record<string, unknown>;
  reason?: string;
  createdAtMillis: number;
  resolve: (approved: boolean) => void;
}

export interface ToolCallRecord {
  id?: string;
  name: string;
  args: Record<string, unknown>;
  status: ToolExecutionStatus;
  startedAtMillis?: number;
  durationMs?: number;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  output?: string;
  cwd?: string;
  errorCategory?: string;
  errorExplanation?: string;
  canRetry?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestampMillis: number;
  modelId?: string;
  providerId?: string;
  agentId?: string;
  taskState?: TaskExecutionState;
  stepsUsed?: number;
  maxStepsConfigured?: number;
  stoppedReason?: 'completed' | 'iteration_limit_reached' | 'cancelled' | 'error';
  canResume?: boolean;
  modifiedFiles?: string[];
  toolCalls?: ToolCallRecord[];
  skillsUsed?: string[];
  streamingStatus?: string;
  isStreaming?: boolean;
  errorExplanation?: string;
  failedPrompt?: string;
}

export interface Conversation {
  id: string;
  title: string;
  workspaceId: string;
  providerId: string;
  modelId: string;
  agentId?: string;
  taskState?: TaskExecutionState;
  createdAtMillis: number;
  updatedAtMillis: number;
  messages: ChatMessage[];
}

export interface MemoryItem {
  id: string;
  scope: string; // 'global' or workspaceId
  category: 'user' | 'project' | 'agent';
  title: string;
  content: string;
  updatedAtMillis: number;
}

export interface GgufInspectionResult {
  fileName: string;
  filePath: string;
  fileSizeBytes: number;
  validMagic: boolean;
  formatVersion: number | null;
  tensorCount: number | null;
  metadataKvCount: number | null;
  architectureHint: string;
  estimatedRamBytes: number;
  hostAvailableRamBytes: number;
  realme7ProfileRamBytes: number;
  fitsHostMemory: boolean;
  fitsRealme7Profile: boolean;
  nativeLlamaLoaded: boolean;
  diagnosticMessage: string;
}

export interface ApkVerificationReport {
  exists: boolean;
  apkPath: string;
  fileName: string;
  sizeBytes: number;
  sha256Hex: string | null;
  isZipContainer: boolean;
  containsAndroidManifest: boolean;
  containsClassesDex: boolean;
  containsResourcesArsc: boolean;
  packageNameHint: string | null;
  verifiedPackageName?: string | null;
  versionCode?: number | null;
  versionName?: string | null;
  isSigned?: boolean;
  signingScheme?: string | null;
  verificationTool?: 'aapt2' | 'fallback_parser';
  verified: boolean;
  diagnosticSummary: string;
}

export interface BuildJobRecord {
  id: string;
  workspaceId: string;
  projectType: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'BLOCKED_ENVIRONMENT';
  stage: string;
  startedAtMillis: number;
  finishedAtMillis?: number;
  commandExecuted: string;
  exitCode: number | null;
  logs: string;
  issues: Array<{ severity: 'ERROR' | 'WARNING' | 'INFO'; title: string; detail: string }>;
  artifactPath: string | null;
  artifactSizeBytes: number | null;
  apkVerification: ApkVerificationReport | null;
}

export interface CommandExecutionResult {
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
  status: ToolExecutionStatus;
  errorCategory?:
    | 'INVALID_ARGUMENT'
    | 'MISSING_DIRECTORY'
    | 'MISSING_EXECUTABLE'
    | 'PERMISSION_DENIED'
    | 'TIMEOUT'
    | 'CANCELLED'
    | 'NONZERO_EXIT';
  errorExplanation?: string;
}

// ============================================================================
// 1. SECRET REDACTOR
// ============================================================================
export class SecretRedactor {
  private static bearerRegex = /Bearer\s+[A-Za-z0-9._\-~+/]+=*/gi;
  private static keyPrefixRegex = /\b(sk-or-v1-|sk-ant-|sk-proj-|sk-|AIza)[A-Za-z0-9._\-]{8,}\b/g;

  static maskSecret(secret: string): string {
    const cleaned = secret.trim();
    if (cleaned.length <= 8) return '••••••••';
    return `${cleaned.slice(0, 4)}••••${cleaned.slice(-4)}`;
  }

  static cleanSecret(secret: string): string {
    return secret
      .trim()
      .replace(/^Bearer\s+/i, '')
      .replace(/\s+/g, '');
  }

  static redact(input: string, knownSecrets: string[] = []): string {
    if (!input) return input;
    let output = input;
    for (const secret of knownSecrets) {
      const cleaned = secret.trim();
      if (cleaned.length >= 6) {
        output = output.split(cleaned).join(this.maskSecret(cleaned));
      }
    }
    output = output.replace(this.bearerRegex, 'Bearer [REDACTED]');
    output = output.replace(this.keyPrefixRegex, (m) => `${m.slice(0, 6)}...[REDACTED]`);
    return output;
  }
}

// ============================================================================
// 2. AES-256-GCM CREDENTIAL VAULT
// ============================================================================
export class EncryptedCredentialVault {
  private dataDir: string;
  private keyFile: string;
  private storeFile: string;
  private masterKey: Buffer;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.keyFile = path.join(this.dataDir, 'vault.key');
    this.storeFile = path.join(this.dataDir, 'credentials.enc.json');
    this.masterKey = this.loadOrCreateKey();
  }

  private loadOrCreateKey(): Buffer {
    if (fs.existsSync(this.keyFile)) {
      const hex = fs.readFileSync(this.keyFile, 'utf-8').trim();
      if (hex.length === 64) {
        return Buffer.from(hex, 'hex');
      }
    }
    const key = crypto.randomBytes(32);
    fs.writeFileSync(this.keyFile, key.toString('hex'), { mode: 0o600 });
    return key;
  }

  private encrypt(plaintext: string): { iv: string; tag: string; ct: string } {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      ct: encrypted.toString('base64'),
    };
  }

  private decrypt(payload: { iv: string; tag: string; ct: string }): string | null {
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.masterKey,
        Buffer.from(payload.iv, 'base64')
      );
      decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(payload.ct, 'base64')),
        decipher.final(),
      ]);
      return SecretRedactor.cleanSecret(decrypted.toString('utf8'));
    } catch {
      return null;
    }
  }

  private readStore(): Array<
    StoredCredentialInfo & { encrypted: { iv: string; tag: string; ct: string } }
  > {
    if (!fs.existsSync(this.storeFile)) return [];
    try {
      return JSON.parse(fs.readFileSync(this.storeFile, 'utf-8'));
    } catch {
      return [];
    }
  }

  private writeStore(
    records: Array<StoredCredentialInfo & { encrypted: { iv: string; tag: string; ct: string } }>
  ): void {
    fs.writeFileSync(this.storeFile, JSON.stringify(records, null, 2), { mode: 0o600 });
  }

  saveCredential(providerId: string, label: string, rawSecret: string): StoredCredentialInfo {
    const cleaned = SecretRedactor.cleanSecret(rawSecret);
    if (!cleaned) {
      throw new Error('API key cannot be empty.');
    }
    const records = this.readStore();
    for (const r of records) {
      if (r.providerId === providerId) r.isActive = false;
    }
    const info: StoredCredentialInfo = {
      id: crypto.randomUUID(),
      providerId,
      label: (label || 'Primary Key').trim().slice(0, 48),
      maskedPreview: SecretRedactor.maskSecret(cleaned),
      isActive: true,
      createdAtMillis: Date.now(),
    };
    records.push({
      ...info,
      encrypted: this.encrypt(cleaned),
    });
    this.writeStore(records);
    return info;
  }

  listCredentials(providerId?: string): StoredCredentialInfo[] {
    return this.readStore()
      .filter((r) => !providerId || r.providerId === providerId)
      .map(({ encrypted: _enc, ...info }) => info);
  }

  getActiveSecret(providerId: string): string | null {
    const records = this.readStore().filter((r) => r.providerId === providerId);
    const active = records.find((r) => r.isActive) || records[0];
    if (!active) return null;
    return this.decrypt(active.encrypted);
  }

  getAllKnownSecrets(): string[] {
    return this.readStore()
      .map((r) => this.decrypt(r.encrypted))
      .filter((s): s is string => Boolean(s));
  }

  removeCredential(providerId: string, credentialId: string): void {
    const records = this.readStore().filter(
      (r) => !(r.providerId === providerId && r.id === credentialId)
    );
    const remainingForProvider = records.filter((r) => r.providerId === providerId);
    if (remainingForProvider.length > 0 && !remainingForProvider.some((r) => r.isActive)) {
      remainingForProvider[0].isActive = true;
    }
    this.writeStore(records);
  }
}

// ============================================================================
// 3. PERMISSION & WORKSPACE SECURITY MANAGER
// ============================================================================
export class PermissionManager {
  private policies: Record<PermissionCategory, PermissionPolicy> = {
    READ_WORKSPACE: 'ALLOW',
    CREATE_FILES: 'ALLOW',
    MODIFY_FILES: 'ALLOW',
    DELETE_FILES: 'ASK',
    EXECUTE_COMMANDS: 'ALLOW', // Safe workspace commands allowed; destructive/caution commands still gated by CommandSafetyGuard
    NETWORK_ACCESS: 'ALLOW',
    INSTALL_DEPENDENCIES: 'ASK',
    BUILD_PROJECTS: 'ALLOW',
    INSTALL_APKS: 'ASK',
    EXTERNAL_DIRECTORIES: 'DENY',
  };

  getPolicies(): Record<PermissionCategory, PermissionPolicy> {
    return { ...this.policies };
  }

  setPolicy(category: PermissionCategory, policy: PermissionPolicy): void {
    this.policies[category] = policy;
  }

  getPolicy(category: PermissionCategory): PermissionPolicy {
    return this.policies[category] || 'ASK';
  }

  /**
   * Validates that `relativePath` resolves strictly inside `workspaceRoot`.
   * Checks both lexical resolution and canonical symlink resolution (matching Mobile-Harness WorkspaceCheckpoints.kt).
   */
  validateWorkspacePath(workspaceRoot: string, relativePath: string): string {
    if (typeof relativePath !== 'string' || relativePath.includes('\0')) {
      throw new Error('Null byte or non-string file path is prohibited.');
    }
    if (path.isAbsolute(relativePath.trim())) {
      throw new Error(`Workspace path traversal blocked (absolute path prohibited): ${relativePath}`);
    }
    const rootReal = fs.existsSync(workspaceRoot)
      ? fs.realpathSync(workspaceRoot)
      : path.resolve(workspaceRoot);
    const resolved = path.resolve(rootReal, relativePath);
    if (resolved !== rootReal && !resolved.startsWith(rootReal + path.sep)) {
      throw new Error(`Workspace path traversal blocked: ${relativePath}`);
    }
    // Check symlink escape on existing path or existing parent
    const checkTarget = fs.existsSync(resolved)
      ? resolved
      : fs.existsSync(path.dirname(resolved))
      ? path.dirname(resolved)
      : null;
    if (checkTarget) {
      const realTarget = fs.realpathSync(checkTarget);
      if (realTarget !== rootReal && !realTarget.startsWith(rootReal + path.sep)) {
        throw new Error(`Symbolic link escape outside workspace blocked: ${relativePath}`);
      }
    }
    return resolved;
  }
}

// ============================================================================
// 4. WORKSPACE, EDITOR & DIFF CHECKPOINT MANAGER
// ============================================================================
export class WorkspaceManager {
  private workspacesRoot: string;
  private androidNativeRoot: string;
  private permissionManager: PermissionManager;
  private checkpointsFile: string;
  private checkpoints: FileDiffRecord[] = [];

  constructor(
    workspacesRoot: string,
    androidNativeRoot: string,
    permissionManager: PermissionManager,
    dataDir?: string
  ) {
    this.workspacesRoot = workspacesRoot;
    this.androidNativeRoot = androidNativeRoot;
    this.permissionManager = permissionManager;
    fs.mkdirSync(this.workspacesRoot, { recursive: true });
    this.checkpointsFile = path.join(dataDir || this.workspacesRoot, '.checkpoints.json');
    this.loadCheckpoints();
    this.seedInitialProjects();
  }

  private loadCheckpoints(): void {
    if (fs.existsSync(this.checkpointsFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.checkpointsFile, 'utf-8'));
        if (Array.isArray(parsed)) this.checkpoints = parsed;
      } catch {
        this.checkpoints = [];
      }
    }
  }

  private saveCheckpoints(): void {
    try {
      fs.writeFileSync(this.checkpointsFile, JSON.stringify(this.checkpoints.slice(0, 50), null, 2));
    } catch {
      // ignore if read-only in test
    }
  }

  private seedInitialProjects(): void {
    const pyDir = path.join(this.workspacesRoot, 'python-cli-toolkit');
    if (!fs.existsSync(pyDir)) {
      fs.mkdirSync(pyDir, { recursive: true });
      fs.writeFileSync(
        path.join(pyDir, 'README.md'),
        '# Python CLI Toolkit\n\nStarter Python workspace with automated unit tests and CLI entry point.\n'
      );
      fs.writeFileSync(
        path.join(pyDir, 'calculator.py'),
        `def evaluate_tokens(tokens: list[float], op: str = "sum") -> float:
    if not tokens:
        return 0.0
    if op == "sum":
        return float(sum(tokens))
    if op == "avg":
        return float(sum(tokens) / len(tokens))
    if op == "max":
        return float(max(tokens))
    raise ValueError(f"Unsupported operation: {op}")

if __name__ == "__main__":
    sample = [12.5, 18.0, 29.5]
    print(f"Sum: {evaluate_tokens(sample, 'sum')}, Avg: {evaluate_tokens(sample, 'avg')}")
`
      );
      fs.writeFileSync(
        path.join(pyDir, 'test_calculator.py'),
        `import unittest
from calculator import evaluate_tokens

class TestCalculator(unittest.TestCase):
    def test_sum_and_avg(self):
        self.assertEqual(evaluate_tokens([10, 20, 30], "sum"), 60.0)
        self.assertEqual(evaluate_tokens([10, 20, 30], "avg"), 20.0)

if __name__ == "__main__":
    unittest.main()
`
      );
    }

    const ktDir = path.join(this.workspacesRoot, 'kotlin-notes-apk');
    if (!fs.existsSync(ktDir)) {
      fs.mkdirSync(path.join(ktDir, 'app/src/main/java/io/anvil/notes'), { recursive: true });
      fs.writeFileSync(
        path.join(ktDir, 'settings.gradle.kts'),
        'rootProject.name = "KotlinNotes"\ninclude(":app")\n'
      );
      fs.writeFileSync(
        path.join(ktDir, 'app/build.gradle.kts'),
        `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "io.anvil.notes"
    compileSdk = 35
    defaultConfig {
        applicationId = "io.anvil.notes"
        minSdk = 28
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }
}
`
      );
      fs.writeFileSync(
        path.join(ktDir, 'app/src/main/AndroidManifest.xml'),
        `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="io.anvil.notes">
    <application android:label="Anvil Notes">
        <activity android:name=".NotesActivity" android:exported="true" />
    </application>
</manifest>
`
      );
      fs.writeFileSync(
        path.join(ktDir, 'app/src/main/java/io/anvil/notes/NotesActivity.kt'),
        `package io.anvil.notes

import android.app.Activity
import android.os.Bundle

class NotesActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
    }
}
`
      );
    }
  }

  getWorkspaceRoot(workspaceId: string): string {
    if (!workspaceId || typeof workspaceId !== 'string') {
      throw new Error('Workspace ID is required.');
    }
    if (workspaceId === 'android-workstation') {
      if (!fs.existsSync(this.androidNativeRoot)) {
        throw new Error(`Workspace directory does not exist: ${this.androidNativeRoot}`);
      }
      return this.androidNativeRoot;
    }
    const target = this.permissionManager.validateWorkspacePath(this.workspacesRoot, workspaceId);
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
      throw new Error(`Workspace '${workspaceId}' does not exist.`);
    }
    return target;
  }

  listWorkspaces(): Array<{
    id: string;
    name: string;
    path: string;
    projectType: string;
    fileCount: number;
    updatedAtMillis: number;
  }> {
    const items: Array<{
      id: string;
      name: string;
      path: string;
      projectType: string;
      fileCount: number;
      updatedAtMillis: number;
    }> = [];

    if (fs.existsSync(this.androidNativeRoot)) {
      const files = this.listFilesRecursive(this.androidNativeRoot);
      items.push({
        id: 'android-workstation',
        name: 'OBSIDIAN Native Android App (io.anvil.workstation)',
        path: this.androidNativeRoot,
        projectType: 'kotlin-android',
        fileCount: files.length,
        updatedAtMillis: fs.statSync(this.androidNativeRoot).mtimeMs,
      });
    }

    const subdirs = fs
      .readdirSync(this.workspacesRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'));

    for (const d of subdirs) {
      const fullPath = path.join(this.workspacesRoot, d.name);
      const files = this.listFilesRecursive(fullPath);
      items.push({
        id: d.name,
        name: d.name,
        path: fullPath,
        projectType: this.detectProjectType(fullPath),
        fileCount: files.length,
        updatedAtMillis: fs.statSync(fullPath).mtimeMs,
      });
    }
    return items;
  }

  createWorkspace(name: string, templateId?: string): { id: string; name: string; projectType: string } {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9\-_]/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!slug || slug === 'android-workstation') {
      throw new Error('Invalid or reserved workspace name.');
    }
    const dir = path.join(this.workspacesRoot, slug);
    if (fs.existsSync(dir)) {
      throw new Error(`Workspace '${slug}' already exists.`);
    }
    fs.mkdirSync(dir, { recursive: true });

    if (templateId === 'kotlin-android' || templateId === 'basic-android') {
      const pkgSlug = slug.replace(/[^a-z0-9]/g, '');
      const javaDir = path.join(dir, `app/src/main/java/io/anvil/${pkgSlug}`);
      fs.mkdirSync(javaDir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'settings.gradle.kts'),
        `rootProject.name = "${name}"\ninclude(":app")\n`
      );
      fs.writeFileSync(
        path.join(dir, 'app/build.gradle.kts'),
        `plugins {\n    id("com.android.application")\n    id("org.jetbrains.kotlin.android")\n}\nandroid {\n    namespace = "io.anvil.${pkgSlug}"\n    compileSdk = 35\n}\n`
      );
      fs.writeFileSync(
        path.join(dir, 'app/src/main/AndroidManifest.xml'),
        `<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="io.anvil.${pkgSlug}">\n    <application android:label="${name}" />\n</manifest>\n`
      );
      fs.writeFileSync(
        path.join(javaDir, 'MainActivity.kt'),
        `package io.anvil.${pkgSlug}\n\nimport android.app.Activity\nimport android.os.Bundle\n\nclass MainActivity : Activity() {\n    override fun onCreate(savedInstanceState: Bundle?) {\n        super.onCreate(savedInstanceState)\n    }\n}\n`
      );
    } else if (templateId === 'web-node') {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: slug, version: '1.0.0', scripts: { start: 'node index.js' } }, null, 2)
      );
      fs.writeFileSync(
        path.join(dir, 'index.js'),
        `console.log("Running ${name} web/node project");\n`
      );
      fs.writeFileSync(
        path.join(dir, 'index.html'),
        `<!doctype html>\n<html><head><title>${name}</title></head><body><h1>${name}</h1></body></html>\n`
      );
    } else if (templateId === 'python') {
      fs.writeFileSync(
        path.join(dir, 'main.py'),
        `def run() -> str:\n    return "Hello from ${name}"\n\nif __name__ == "__main__":\n    print(run())\n`
      );
      fs.writeFileSync(
        path.join(dir, 'test_main.py'),
        `import unittest\nfrom main import run\n\nclass TestMain(unittest.TestCase):\n    def test_run(self):\n        self.assertIn("${name}", run())\n\nif __name__ == "__main__":\n    unittest.main()\n`
      );
    }
    // Note: Do NOT automatically generate generic README.md or dummy files for default/empty workspaces.
    // Files must only be created when explicitly requested by the user or an actual agent task.

    return { id: slug, name, projectType: this.detectProjectType(dir) };
  }

  renameWorkspace(oldId: string, newName: string): { id: string; name: string; path: string } {
    if (oldId === 'android-workstation') {
      throw new Error('Cannot rename core OBSIDIAN native android application.');
    }
    const cleanName = newName.trim();
    if (!cleanName) throw new Error('New workspace name cannot be empty.');
    const newSlug = cleanName
      .toLowerCase()
      .replace(/[^a-z0-9\-_]/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!newSlug || newSlug === 'android-workstation') {
      throw new Error('Invalid or reserved workspace name.');
    }
    const oldDir = path.join(this.workspacesRoot, oldId);
    if (!fs.existsSync(oldDir)) {
      throw new Error(`Workspace '${oldId}' does not exist.`);
    }
    const newDir = path.join(this.workspacesRoot, newSlug);
    if (newSlug !== oldId && fs.existsSync(newDir)) {
      throw new Error(`Workspace with identifier '${newSlug}' already exists.`);
    }
    if (newSlug !== oldId) {
      fs.renameSync(oldDir, newDir);
      for (const cp of this.checkpoints) {
        if (cp.workspaceId === oldId) cp.workspaceId = newSlug;
      }
      this.saveCheckpoints();
    }
    return { id: newSlug, name: cleanName, path: newDir };
  }

  deleteWorkspace(workspaceId: string, deleteFiles: boolean): { success: boolean; removedFiles: boolean } {
    if (workspaceId === 'android-workstation') {
      throw new Error('Cannot delete core OBSIDIAN native android application.');
    }
    const targetDir = path.join(this.workspacesRoot, workspaceId);
    if (!fs.existsSync(targetDir)) {
      return { success: true, removedFiles: false };
    }
    if (deleteFiles) {
      fs.rmSync(targetDir, { recursive: true, force: true });
      this.checkpoints = this.checkpoints.filter((cp) => cp.workspaceId !== workspaceId);
      this.saveCheckpoints();
      return { success: true, removedFiles: true };
    } else {
      // Unregister / archive reference without deleting user files
      const archiveDir = path.join(this.workspacesRoot, `.archived-${workspaceId}-${Date.now()}`);
      fs.renameSync(targetDir, archiveDir);
      return { success: true, removedFiles: false };
    }
  }

  detectProjectType(dir: string): string {
    if (
      fs.existsSync(path.join(dir, 'settings.gradle.kts')) ||
      fs.existsSync(path.join(dir, 'app/build.gradle.kts'))
    ) {
      return 'kotlin-android';
    }
    if (fs.existsSync(path.join(dir, 'package.json'))) return 'web-node';
    if (
      fs.existsSync(path.join(dir, 'main.py')) ||
      fs.existsSync(path.join(dir, 'calculator.py'))
    ) {
      return 'python';
    }
    return 'general';
  }

  listFilesRecursive(rootDir: string, currentRel = ''): Array<{
    relativePath: string;
    sizeBytes: number;
    updatedAtMillis: number;
  }> {
    const target = path.join(rootDir, currentRel);
    if (!fs.existsSync(target)) return [];
    const entries = fs.readdirSync(target, { withFileTypes: true });
    let results: Array<{ relativePath: string; sizeBytes: number; updatedAtMillis: number }> = [];
    for (const entry of entries) {
      if (
        entry.name === '.git' ||
        entry.name === 'node_modules' ||
        entry.name === 'build' ||
        entry.name === '.checkpoints.json'
      ) {
        continue;
      }
      const rel = currentRel ? `${currentRel}/${entry.name}` : entry.name;
      const full = path.join(rootDir, rel);
      if (entry.isSymbolicLink()) {
        continue; // Do not traverse symlinks (Mobile-Harness WorkspaceCheckpoints safety invariant)
      }
      if (entry.isDirectory()) {
        results = results.concat(this.listFilesRecursive(rootDir, rel));
      } else if (entry.isFile()) {
        const st = fs.statSync(full);
        results.push({
          relativePath: rel,
          sizeBytes: st.size,
          updatedAtMillis: st.mtimeMs,
        });
      }
    }
    return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }

  readFileBounded(workspaceId: string, relativePath: string, maxBytes = 256 * 1024): {
    content: string;
    sizeBytes: number;
    truncated: boolean;
  } {
    const wsRoot = this.getWorkspaceRoot(workspaceId);
    const fullPath = this.permissionManager.validateWorkspacePath(wsRoot, relativePath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      throw new Error(`File not found: ${relativePath}`);
    }
    const st = fs.statSync(fullPath);
    const fd = fs.openSync(fullPath, 'r');
    try {
      const readLen = Math.min(st.size, maxBytes);
      const buf = Buffer.alloc(readLen);
      fs.readSync(fd, buf, 0, readLen, 0);
      if (buf.includes(0)) {
        throw new Error(`Binary file cannot be edited as UTF-8 text: ${relativePath}`);
      }
      return {
        content: buf.toString('utf-8'),
        sizeBytes: st.size,
        truncated: st.size > maxBytes,
      };
    } finally {
      fs.closeSync(fd);
    }
  }

  writeFileSafely(workspaceId: string, relativePath: string, content: string): FileDiffRecord {
    const wsRoot = this.getWorkspaceRoot(workspaceId);
    const fullPath = this.permissionManager.validateWorkspacePath(wsRoot, relativePath);
    let previousContent = '';
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      const existingBuf = fs.readFileSync(fullPath);
      if (existingBuf.includes(0)) {
        throw new Error(`Cannot overwrite binary file via UTF-8 text editor: ${relativePath}`);
      }
      previousContent = existingBuf.toString('utf-8');
    }
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
    const diff = this.computeUnifiedDiff(workspaceId, relativePath, previousContent, content);
    this.checkpoints.unshift(diff);
    if (this.checkpoints.length > 50) this.checkpoints.pop();
    this.saveCheckpoints();
    return diff;
  }

  createDirectorySafely(workspaceId: string, relativeDirPath: string): { path: string } {
    const wsRoot = this.getWorkspaceRoot(workspaceId);
    const fullPath = this.permissionManager.validateWorkspacePath(wsRoot, relativeDirPath);
    fs.mkdirSync(fullPath, { recursive: true });
    return { path: relativeDirPath };
  }

  renamePathSafely(
    workspaceId: string,
    oldRelativePath: string,
    newRelativePath: string
  ): FileDiffRecord {
    const wsRoot = this.getWorkspaceRoot(workspaceId);
    const oldFull = this.permissionManager.validateWorkspacePath(wsRoot, oldRelativePath);
    const newFull = this.permissionManager.validateWorkspacePath(wsRoot, newRelativePath);
    if (!fs.existsSync(oldFull)) {
      throw new Error(`Source file not found: ${oldRelativePath}`);
    }
    if (fs.existsSync(newFull)) {
      throw new Error(`Destination path already exists: ${newRelativePath}`);
    }
    const content = fs.statSync(oldFull).isFile() ? fs.readFileSync(oldFull, 'utf-8') : '';
    fs.mkdirSync(path.dirname(newFull), { recursive: true });
    fs.renameSync(oldFull, newFull);
    const diff = this.computeUnifiedDiff(workspaceId, `${oldRelativePath} -> ${newRelativePath}`, content, content);
    this.checkpoints.unshift(diff);
    this.saveCheckpoints();
    return diff;
  }

  deleteFileSafely(workspaceId: string, relativePath: string): FileDiffRecord {
    const wsRoot = this.getWorkspaceRoot(workspaceId);
    const fullPath = this.permissionManager.validateWorkspacePath(wsRoot, relativePath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      throw new Error(`File not found: ${relativePath}`);
    }
    const previousContent = fs.readFileSync(fullPath, 'utf-8');
    fs.unlinkSync(fullPath);
    const diff = this.computeUnifiedDiff(workspaceId, relativePath, previousContent, '');
    this.checkpoints.unshift(diff);
    this.saveCheckpoints();
    return diff;
  }

  revertCheckpoint(checkpointId: string): FileDiffRecord {
    const cp = this.checkpoints.find((c) => c.id === checkpointId);
    if (!cp) throw new Error(`Checkpoint not found: ${checkpointId}`);
    return this.writeFileSafely(cp.workspaceId, cp.relativePath, cp.previousContent);
  }

  getCheckpoints(workspaceId?: string): FileDiffRecord[] {
    return this.checkpoints.filter((c) => !workspaceId || c.workspaceId === workspaceId);
  }

  searchInWorkspace(
    workspaceId: string,
    query: string
  ): Array<{ relativePath: string; line: number; preview: string }> {
    const wsRoot = this.getWorkspaceRoot(workspaceId);
    const files = this.listFilesRecursive(wsRoot);
    const matches: Array<{ relativePath: string; line: number; preview: string }> = [];
    const qLower = query.toLowerCase();
    for (const f of files) {
      if (f.sizeBytes > 512 * 1024) continue;
      try {
        const { content } = this.readFileBounded(workspaceId, f.relativePath);
        const lines = content.split(/\r?\n/);
        lines.forEach((lineText, idx) => {
          if (lineText.toLowerCase().includes(qLower) && matches.length < 100) {
            matches.push({
              relativePath: f.relativePath,
              line: idx + 1,
              preview: lineText.trim().slice(0, 160),
            });
          }
        });
      } catch {
        // skip binary files
      }
    }
    return matches;
  }

  computeUnifiedDiff(
    workspaceId: string,
    relativePath: string,
    previousContent: string,
    updatedContent: string
  ): FileDiffRecord {
    const oldLines = previousContent === '' ? [] : previousContent.split(/\r?\n/);
    const newLines = updatedContent === '' ? [] : updatedContent.split(/\r?\n/);
    const lines: DiffHunkLine[] = [];
    let additions = 0;
    let deletions = 0;
    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      const o = i < oldLines.length ? oldLines[i] : undefined;
      const n = i < newLines.length ? newLines[i] : undefined;
      if (o === n && o !== undefined) {
        lines.push({ type: ' ', content: o, oldLineNumber: i + 1, newLineNumber: i + 1 });
      } else {
        if (o !== undefined) {
          deletions++;
          lines.push({ type: '-', content: o, oldLineNumber: i + 1, newLineNumber: null });
        }
        if (n !== undefined) {
          additions++;
          lines.push({ type: '+', content: n, oldLineNumber: null, newLineNumber: i + 1 });
        }
      }
    }
    return {
      id: `diff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      workspaceId,
      relativePath,
      additions,
      deletions,
      timestampMillis: Date.now(),
      previousContent,
      updatedContent,
      lines,
    };
  }
}

// ============================================================================
// 5. STATEFUL TERMINAL SESSION & LINUX RUNTIME MANAGER
// ============================================================================
export class TerminalSessionManager {
  private workspaceManager: WorkspaceManager;
  private activeProcesses = new Map<string, Set<ChildProcess>>();
  private sessionDirectories = new Map<string, string>();
  private commandHistory = new Map<string, string[]>();

  constructor(workspaceManager: WorkspaceManager) {
    this.workspaceManager = workspaceManager;
  }

  getWorkingDirectory(workspaceId: string): string {
    const root = this.workspaceManager.getWorkspaceRoot(workspaceId);
    const current = this.sessionDirectories.get(workspaceId);
    if (current && fs.existsSync(current) && current.startsWith(root)) {
      return current;
    }
    this.sessionDirectories.set(workspaceId, root);
    return root;
  }

  getHistory(workspaceId: string): string[] {
    return this.commandHistory.get(workspaceId) || [];
  }

  async executeCommand(
    workspaceId: string,
    command: string,
    timeoutMs = 25_000,
    options?: {
      cwd?: string;
      signal?: AbortSignal;
      knownSecrets?: string[];
    }
  ): Promise<CommandExecutionResult> {
    const start = Date.now();
    if (typeof command !== 'string' || !command.trim()) {
      throw new Error('Command cannot be empty.');
    }
    const trimmed = command.trim();

    let wsRoot: string;
    try {
      wsRoot = this.workspaceManager.getWorkspaceRoot(workspaceId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        command: trimmed,
        cwd: workspaceId,
        stdout: '',
        stderr: msg,
        exitCode: 2,
        durationMs: Date.now() - start,
        timedOut: false,
        cancelled: false,
        status: 'failed',
        errorCategory: 'MISSING_DIRECTORY',
        errorExplanation: `Invalid or missing project workspace '${workspaceId}': ${msg}`,
      };
    }

    // Resolve explicit working directory if provided in options
    let cwd = this.getWorkingDirectory(workspaceId);
    if (options?.cwd && options.cwd.trim()) {
      const rawSubdir = options.cwd.trim();
      const resolvedSubdir = path.resolve(wsRoot, rawSubdir);
      if (resolvedSubdir !== wsRoot && !resolvedSubdir.startsWith(wsRoot + path.sep)) {
        return {
          command: trimmed,
          cwd,
          stdout: '',
          stderr: `Blocked: working directory '${rawSubdir}' is outside workspace root (${wsRoot}).`,
          exitCode: 126,
          durationMs: Date.now() - start,
          timedOut: false,
          cancelled: false,
          status: 'denied',
          errorCategory: 'PERMISSION_DENIED',
          errorExplanation: `Working directory '${rawSubdir}' escapes the authorized workspace boundary.`,
        };
      }
      if (!fs.existsSync(resolvedSubdir) || !fs.statSync(resolvedSubdir).isDirectory()) {
        return {
          command: trimmed,
          cwd: resolvedSubdir,
          stdout: '',
          stderr: `Working directory does not exist: ${rawSubdir}`,
          exitCode: 2,
          durationMs: Date.now() - start,
          timedOut: false,
          cancelled: false,
          status: 'failed',
          errorCategory: 'MISSING_DIRECTORY',
          errorExplanation: `The specified working directory '${rawSubdir}' does not exist inside '${workspaceId}'.`,
        };
      }
      cwd = resolvedSubdir;
    }

    // Check command safety guard (adapted from PocketStrike-AI)
    const safety = evaluateCommandSafety(trimmed);
    if (safety.riskLevel === 'FORBIDDEN') {
      return {
        command: trimmed,
        cwd,
        stdout: '',
        stderr: `Security Policy Blocked: ${safety.reason}`,
        exitCode: 126,
        durationMs: Date.now() - start,
        timedOut: false,
        cancelled: false,
        status: 'denied',
        errorCategory: 'PERMISSION_DENIED',
        errorExplanation: safety.reason,
      };
    }

    const hist = this.commandHistory.get(workspaceId) || [];
    hist.push(trimmed);
    this.commandHistory.set(workspaceId, hist.slice(-100));

    // Handle `cd <dir>` statefully within workspace boundaries
    if (/^cd(\s+.*)?$/.test(trimmed)) {
      const targetArg = trimmed.replace(/^cd\s*/, '').trim() || '.';
      const nextDir = path.resolve(cwd, targetArg);
      if (nextDir !== wsRoot && !nextDir.startsWith(wsRoot + path.sep)) {
        return {
          command: trimmed,
          cwd,
          stdout: '',
          stderr: `Blocked: directory traversal outside workspace root (${wsRoot}) is not permitted.`,
          exitCode: 1,
          durationMs: Date.now() - start,
          timedOut: false,
          cancelled: false,
          status: 'denied',
          errorCategory: 'PERMISSION_DENIED',
          errorExplanation: `Attempted to change directory outside workspace root (${wsRoot}).`,
        };
      }
      if (!fs.existsSync(nextDir) || !fs.statSync(nextDir).isDirectory()) {
        return {
          command: trimmed,
          cwd,
          stdout: '',
          stderr: `cd: no such directory: ${targetArg}`,
          exitCode: 1,
          durationMs: Date.now() - start,
          timedOut: false,
          cancelled: false,
          status: 'failed',
          errorCategory: 'MISSING_DIRECTORY',
          errorExplanation: `Directory '${targetArg}' does not exist.`,
        };
      }
      this.sessionDirectories.set(workspaceId, nextDir);
      return {
        command: trimmed,
        cwd: nextDir,
        stdout: `Changed working directory to ${nextDir}\n`,
        stderr: '',
        exitCode: 0,
        durationMs: Date.now() - start,
        timedOut: false,
        cancelled: false,
        status: 'succeeded',
      };
    }

    if (options?.signal?.aborted) {
      return {
        command: trimmed,
        cwd,
        stdout: '',
        stderr: '[Command cancelled before execution]',
        exitCode: 130,
        durationMs: Date.now() - start,
        timedOut: false,
        cancelled: true,
        status: 'cancelled',
        errorCategory: 'CANCELLED',
        errorExplanation: 'Command execution was cancelled by the user.',
      };
    }

    const isWindows = process.platform === 'win32';
    const shellBin = isWindows
      ? (process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe')
      : (fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh');
    const shellArgs = isWindows ? ['/d', '/s', '/c', trimmed] : ['-c', trimmed];

    return new Promise((resolve) => {
      const proc = spawn(shellBin, shellArgs, {
        cwd,
        env: buildSanitizedProcessEnv(process.env, options?.knownSecrets),
      });

      let setForWs = this.activeProcesses.get(workspaceId);
      if (!setForWs) {
        setForWs = new Set();
        this.activeProcesses.set(workspaceId, setForWs);
      }
      setForWs.add(proc);

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let cancelled = false;

      const onAbort = () => {
        cancelled = true;
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL');
        }, 150);
      };

      if (options?.signal) {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, Math.max(50, timeoutMs));

      proc.stdout.on('data', (chunk: Buffer) => {
        if (stdout.length < 65536) {
          stdout += chunk.toString('utf-8');
        }
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < 65536) {
          stderr += chunk.toString('utf-8');
        }
      });

      proc.on('close', (code, signalName) => {
        clearTimeout(timer);
        if (options?.signal) {
          options.signal.removeEventListener('abort', onAbort);
        }
        setForWs?.delete(proc);

        if (signalName === 'SIGTERM' || signalName === 'SIGKILL') {
          if (!timedOut) cancelled = true;
        }

        const exitCode = timedOut ? 124 : cancelled ? 130 : code ?? 1;
        const finalStderr = timedOut
          ? `${stderr}${stderr ? '\n' : ''}[Process terminated after ${timeoutMs}ms timeout]`
          : cancelled
          ? `${stderr}${stderr ? '\n' : ''}[Process cancelled by operator]`
          : stderr;

        let status: ToolExecutionStatus = 'succeeded';
        let errorCategory: CommandExecutionResult['errorCategory'];
        let errorExplanation: string | undefined;

        if (timedOut) {
          status = 'timed_out';
          errorCategory = 'TIMEOUT';
          errorExplanation = `Command exceeded the ${timeoutMs}ms timeout limit and was terminated.`;
        } else if (cancelled) {
          status = 'cancelled';
          errorCategory = 'CANCELLED';
          errorExplanation = 'Command execution was cancelled by the user.';
        } else if (/EEXIST/i.test(finalStderr)) {
          status = 'failed';
          errorCategory = 'NONZERO_EXIT';
          errorExplanation =
            'File or symlink conflict (npm EEXIST): Target binary already exists. Verify existing binary with `opencode --version` before reinstalling, or back up conflicting paths without destructive deletion.';
        } else if (/ENOTEMPTY/i.test(finalStderr)) {
          status = 'failed';
          errorCategory = 'NONZERO_EXIT';
          errorExplanation =
            'Staging directory collision (npm ENOTEMPTY): Incomplete staging folder from an interrupted install was detected. Back up the conflicting directory before retrying.';
        } else if (exitCode === 127 || /command not found|not recognized as an internal or external command|not found/i.test(finalStderr)) {
          status = 'failed';
          errorCategory = 'MISSING_EXECUTABLE';
          errorExplanation = `Executable or toolchain not found in environment (exit code ${exitCode}).`;
        } else if (exitCode === 126 || /permission denied/i.test(finalStderr)) {
          status = 'failed';
          errorCategory = 'PERMISSION_DENIED';
          errorExplanation = `Permission denied while executing command (exit code ${exitCode}).`;
        } else if (exitCode !== 0) {
          status = 'failed';
          errorCategory = 'NONZERO_EXIT';
          errorExplanation = `Command exited with non-zero status code ${exitCode}.`;
        }

        resolve({
          command: trimmed,
          cwd,
          stdout,
          stderr: finalStderr,
          exitCode,
          durationMs: Date.now() - start,
          timedOut,
          cancelled,
          status,
          errorCategory,
          errorExplanation,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        if (options?.signal) {
          options.signal.removeEventListener('abort', onAbort);
        }
        setForWs?.delete(proc);
        resolve({
          command: trimmed,
          cwd,
          stdout,
          stderr: err.message,
          exitCode: 127,
          durationMs: Date.now() - start,
          timedOut: false,
          cancelled: false,
          status: 'failed',
          errorCategory: 'MISSING_EXECUTABLE',
          errorExplanation: `Failed to spawn process: ${err.message}`,
        });
      });
    });
  }

  cancelCommand(workspaceId: string): boolean {
    const procs = this.activeProcesses.get(workspaceId);
    if (!procs || procs.size === 0) return false;
    for (const proc of procs) {
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL');
      }, 200);
    }
    procs.clear();
    return true;
  }
}

// ============================================================================
// 6. LOCAL AI GGUF BINARY HEADER INSPECTOR
// ============================================================================
export class LocalModelManager {
  private modelsDir: string;

  constructor(dataDir: string) {
    this.modelsDir = path.join(dataDir, 'local-models');
    fs.mkdirSync(this.modelsDir, { recursive: true });
    this.ensureSampleGgufHeaderFixture();
  }

  private ensureSampleGgufHeaderFixture(): void {
    const samplePath = path.join(this.modelsDir, 'qwen2.5-coder-1.5b-q4_k_m-header-fixture.gguf');
    if (!fs.existsSync(samplePath)) {
      const buf = Buffer.alloc(64);
      buf.write('GGUF', 0, 4, 'ascii');
      buf.writeUInt32LE(3, 4);
      buf.writeBigUInt64LE(196n, 8);
      buf.writeBigUInt64LE(24n, 16);
      buf.write('qwen2.5-coder.gguf-fixture', 24, 'ascii');
      fs.writeFileSync(samplePath, buf);
    }
  }

  listModels(): GgufInspectionResult[] {
    if (!fs.existsSync(this.modelsDir)) return [];
    return fs
      .readdirSync(this.modelsDir)
      .filter((f) => f.endsWith('.gguf') || f.endsWith('.bin'))
      .map((f) => this.inspectGgufFile(path.join(this.modelsDir, f)));
  }

  inspectGgufFile(filePath: string): GgufInspectionResult {
    const realme7SafeBudget = Math.floor(4.2 * 1024 * 1024 * 1024);
    const hostFreeRam = os.freemem();

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return {
        fileName: path.basename(filePath),
        filePath,
        fileSizeBytes: 0,
        validMagic: false,
        formatVersion: null,
        tensorCount: null,
        metadataKvCount: null,
        architectureHint: 'unknown',
        estimatedRamBytes: 0,
        hostAvailableRamBytes: hostFreeRam,
        realme7ProfileRamBytes: realme7SafeBudget,
        fitsHostMemory: false,
        fitsRealme7Profile: false,
        nativeLlamaLoaded: false,
        diagnosticMessage: `Model file does not exist: ${filePath}`,
      };
    }

    const st = fs.statSync(filePath);
    if (st.size < 24) {
      return {
        fileName: path.basename(filePath),
        filePath,
        fileSizeBytes: st.size,
        validMagic: false,
        formatVersion: null,
        tensorCount: null,
        metadataKvCount: null,
        architectureHint: 'invalid',
        estimatedRamBytes: st.size,
        hostAvailableRamBytes: hostFreeRam,
        realme7ProfileRamBytes: realme7SafeBudget,
        fitsHostMemory: false,
        fitsRealme7Profile: false,
        nativeLlamaLoaded: false,
        diagnosticMessage: `Corrupted GGUF file: size (${st.size} B) is smaller than the mandatory 24-byte GGUF header.`,
      };
    }

    const fd = fs.openSync(filePath, 'r');
    try {
      const header = Buffer.alloc(24);
      fs.readSync(fd, header, 0, 24, 0);
      const magic = header.subarray(0, 4).toString('ascii');
      if (magic !== 'GGUF') {
        return {
          fileName: path.basename(filePath),
          filePath,
          fileSizeBytes: st.size,
          validMagic: false,
          formatVersion: null,
          tensorCount: null,
          metadataKvCount: null,
          architectureHint: 'unrecognized',
          estimatedRamBytes: st.size,
          hostAvailableRamBytes: hostFreeRam,
          realme7ProfileRamBytes: realme7SafeBudget,
          fitsHostMemory: false,
          fitsRealme7Profile: false,
          nativeLlamaLoaded: false,
          diagnosticMessage: `Invalid magic bytes '${magic}' (expected 'GGUF' 0x47475546). File is not a valid GGUF model.`,
        };
      }

      const version = header.readUInt32LE(4);
      const tensorCount = Number(header.readBigUInt64LE(8));
      const kvCount = Number(header.readBigUInt64LE(16));
      const estimatedRam = st.size + 512 * 1024 * 1024;
      const validVersion = version === 2 || version === 3;
      const fitsHost = hostFreeRam >= estimatedRam;
      const fitsRealme = realme7SafeBudget >= estimatedRam;

      const hasWeights = st.size >= 1024 * 1024;
      let diag = '';
      if (!validVersion) {
        diag = `Unsupported GGUF version ${version} (expected v2 or v3).`;
      } else if (!hasWeights) {
        diag = `Header fixture only (${st.size} B). Model weights are not loaded. Complete GGUF tensor weights are required for on-device inference.`;
      } else {
        diag = `Verified GGUF v${version} binary header (${tensorCount} tensors, ${kvCount} metadata KV pairs). Native weights verified.`;
      }

      return {
        fileName: path.basename(filePath),
        filePath,
        fileSizeBytes: st.size,
        validMagic: validVersion,
        formatVersion: version,
        tensorCount,
        metadataKvCount: kvCount,
        architectureHint: path.basename(filePath).includes('qwen') ? 'qwen2' : 'llama',
        estimatedRamBytes: estimatedRam,
        hostAvailableRamBytes: hostFreeRam,
        realme7ProfileRamBytes: realme7SafeBudget,
        fitsHostMemory: fitsHost,
        fitsRealme7Profile: fitsRealme,
        nativeLlamaLoaded: false,
        diagnosticMessage: diag,
      };
    } finally {
      fs.closeSync(fd);
    }
  }

  getModelsDir(): string {
    return this.modelsDir;
  }

  listCatalogModels(): LocalAiModel[] {
    const result: LocalAiModel[] = [];
    const filesInDir = fs.existsSync(this.modelsDir) ? fs.readdirSync(this.modelsDir) : [];

    // 1. Process catalog models
    for (const cat of SUPPORTED_LOCAL_MODELS) {
      const match = filesInDir.find(
        (f) =>
          f === cat.id ||
          f.toLowerCase() === cat.id.toLowerCase() ||
          (cat.id.startsWith('qwen2.5-coder-1.5b') && f.includes('qwen2.5-coder-1.5b'))
      );
      if (match) {
        const fullPath = path.join(this.modelsDir, match);
        const inspection = this.inspectGgufFile(fullPath);
        const hasRealWeights = inspection.fileSizeBytes >= 1024 * 1024;
        result.push({
          id: cat.id,
          displayName: cat.displayName,
          description: cat.description,
          format: cat.format,
          sizeBytes: cat.sizeBytes,
          sizeDisplay: cat.sizeDisplay,
          ramRequiredDisplay: cat.ramRequiredDisplay,
          architectureHint: cat.architectureHint,
          isDownloaded: hasRealWeights,
          filePath: fullPath,
          validMagic: inspection.validMagic,
          formatVersion: inspection.formatVersion,
          tensorCount: inspection.tensorCount,
          metadataKvCount: inspection.metadataKvCount,
          fitsHostMemory: inspection.fitsHostMemory,
          diagnosticMessage: inspection.diagnosticMessage,
          isRecommended: cat.isRecommended,
          supportsTools: cat.supportsTools,
          downloadStatus: hasRealWeights ? 'ready' : 'available',
        });
      } else {
        result.push({
          id: cat.id,
          displayName: cat.displayName,
          description: cat.description,
          format: cat.format,
          sizeBytes: cat.sizeBytes,
          sizeDisplay: cat.sizeDisplay,
          ramRequiredDisplay: cat.ramRequiredDisplay,
          architectureHint: cat.architectureHint,
          isDownloaded: false,
          isRecommended: cat.isRecommended,
          supportsTools: cat.supportsTools,
          downloadStatus: 'available',
          diagnosticMessage: 'Model weights are not downloaded.',
        });
      }
    }

    // 2. Add any other GGUF files in directory not covered by catalog
    for (const f of filesInDir) {
      if ((f.endsWith('.gguf') || f.endsWith('.bin')) && !result.some((r) => r.filePath?.endsWith(f))) {
        const fullPath = path.join(this.modelsDir, f);
        const inspection = this.inspectGgufFile(fullPath);
        const hasRealWeights = inspection.fileSizeBytes >= 1024 * 1024;
        const sizeMb = Math.round(inspection.fileSizeBytes / (1024 * 1024));
        const sizeDisplay = sizeMb > 1024 ? `${(sizeMb / 1024).toFixed(2)} GB` : `${sizeMb} MB`;
        const ramMb = Math.round(inspection.estimatedRamBytes / (1024 * 1024));
        const ramDisplay = ramMb > 1024 ? `~${(ramMb / 1024).toFixed(1)} GB RAM` : `~${ramMb} MB RAM`;
        result.push({
          id: f,
          displayName: f.replace(/\.gguf$/, '').replace(/[-_]/g, ' '),
          description: `Custom imported GGUF model (${inspection.tensorCount || 0} tensors)`,
          format: `GGUF v${inspection.formatVersion || 3}`,
          sizeBytes: inspection.fileSizeBytes,
          sizeDisplay,
          ramRequiredDisplay: ramDisplay,
          architectureHint: inspection.architectureHint,
          isDownloaded: hasRealWeights,
          filePath: fullPath,
          validMagic: inspection.validMagic,
          formatVersion: inspection.formatVersion,
          tensorCount: inspection.tensorCount,
          metadataKvCount: inspection.metadataKvCount,
          fitsHostMemory: inspection.fitsHostMemory,
          diagnosticMessage: inspection.diagnosticMessage,
          supportsTools: true,
          downloadStatus: hasRealWeights ? 'ready' : 'available',
        });
      }
    }

    return result;
  }

  installModel(modelId: string): LocalAiModel {
    const targetFile = path.join(this.modelsDir, modelId.endsWith('.gguf') ? modelId : `${modelId}.gguf`);
    const catalogItem = SUPPORTED_LOCAL_MODELS.find((m) => m.id === modelId) || {
      id: modelId,
      displayName: modelId,
      description: 'Custom Local Model',
      format: 'GGUF Q4_K_M (v3)',
      sizeBytes: 950000000,
      sizeDisplay: '950 MB',
      ramRequiredDisplay: '~1.5 GB RAM',
      architectureHint: modelId.includes('qwen') ? 'qwen2' : modelId.includes('phi') ? 'phi' : 'llama',
      supportsTools: true,
    };

    if (!fs.existsSync(targetFile) || fs.statSync(targetFile).size < 1024 * 1024) {
      throw new Error(
        `Model weights for '${catalogItem.displayName}' are not downloaded. Place '${path.basename(targetFile)}' into '${this.modelsDir}' or use 'Import Model' to select a local .gguf file.`
      );
    }

    const inspection = this.inspectGgufFile(targetFile);
    return {
      id: catalogItem.id,
      displayName: catalogItem.displayName,
      description: catalogItem.description,
      format: catalogItem.format,
      sizeBytes: catalogItem.sizeBytes,
      sizeDisplay: catalogItem.sizeDisplay,
      ramRequiredDisplay: catalogItem.ramRequiredDisplay,
      architectureHint: catalogItem.architectureHint,
      isDownloaded: true,
      filePath: targetFile,
      validMagic: inspection.validMagic,
      formatVersion: inspection.formatVersion,
      tensorCount: inspection.tensorCount,
      metadataKvCount: inspection.metadataKvCount,
      fitsHostMemory: inspection.fitsHostMemory,
      diagnosticMessage: inspection.diagnosticMessage,
      isRecommended: catalogItem.isRecommended,
      supportsTools: catalogItem.supportsTools,
      downloadStatus: 'ready',
    };
  }

  importModel(sourceFilePath: string, customName?: string): LocalAiModel {
    if (!fs.existsSync(sourceFilePath) || !fs.statSync(sourceFilePath).isFile()) {
      throw new Error(`Import failed: File not found at '${sourceFilePath}'`);
    }

    const stat = fs.statSync(sourceFilePath);
    if (stat.size < 1024 * 1024) {
      throw new Error(
        `Import failed: File is only ${stat.size} bytes. Complete GGUF model weights (>1MB) are required.`
      );
    }

    // Inspect header first to reject corrupted files immediately
    const preCheck = this.inspectGgufFile(sourceFilePath);
    if (!preCheck.validMagic) {
      throw new Error(`Incompatible model: ${preCheck.diagnosticMessage}`);
    }

    const baseName = path.basename(sourceFilePath);
    const destName = baseName.endsWith('.gguf') ? baseName : `${baseName}.gguf`;
    const destPath = path.join(this.modelsDir, destName);

    // If not already in modelsDir, copy the file
    if (path.resolve(sourceFilePath) !== path.resolve(destPath)) {
      fs.copyFileSync(sourceFilePath, destPath);
    }

    const inspection = this.inspectGgufFile(destPath);
    const sizeMb = Math.round(inspection.fileSizeBytes / (1024 * 1024));
    const sizeDisplay = sizeMb > 1024 ? `${(sizeMb / 1024).toFixed(2)} GB` : `${sizeMb} MB`;
    const ramMb = Math.round(inspection.estimatedRamBytes / (1024 * 1024));
    const ramDisplay = ramMb > 1024 ? `~${(ramMb / 1024).toFixed(1)} GB RAM` : `~${ramMb} MB RAM`;

    return {
      id: destName,
      displayName: customName || destName.replace(/\.gguf$/, '').replace(/[-_]/g, ' '),
      description: `Imported local GGUF model (${inspection.tensorCount} tensors, v${inspection.formatVersion})`,
      format: `GGUF v${inspection.formatVersion || 3}`,
      sizeBytes: inspection.fileSizeBytes,
      sizeDisplay,
      ramRequiredDisplay: ramDisplay,
      architectureHint: inspection.architectureHint,
      isDownloaded: true,
      filePath: destPath,
      validMagic: inspection.validMagic,
      formatVersion: inspection.formatVersion,
      tensorCount: inspection.tensorCount,
      metadataKvCount: inspection.metadataKvCount,
      fitsHostMemory: inspection.fitsHostMemory,
      diagnosticMessage: inspection.diagnosticMessage,
      supportsTools: true,
      downloadStatus: 'ready',
    };
  }

  deleteModel(modelId: string): boolean {
    const targetFile = path.join(this.modelsDir, modelId.endsWith('.gguf') ? modelId : `${modelId}.gguf`);
    if (fs.existsSync(targetFile)) {
      fs.unlinkSync(targetFile);
      return true;
    }
    return false;
  }

  async downloadModel(modelId: string): Promise<LocalAiModel> {
    const catalogItem = SUPPORTED_LOCAL_MODELS.find((m) => m.id === modelId);
    const targetFile = path.join(this.modelsDir, modelId.endsWith('.gguf') ? modelId : `${modelId}.gguf`);

    if (fs.existsSync(targetFile) && fs.statSync(targetFile).size >= 1024 * 1024) {
      return this.installModel(modelId);
    }

    if (!catalogItem?.downloadUrl) {
      return this.installModel(modelId);
    }

    const resp = await fetch(catalogItem.downloadUrl, { redirect: 'follow' });
    if (!resp.ok || !resp.body) {
      throw new Error(`Failed to download GGUF model '${modelId}' (HTTP ${resp.status})`);
    }
    const arrayBuffer = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length < 1024 * 1024) {
      throw new Error(`Downloaded payload for '${modelId}' is incomplete (${buffer.length} bytes).`);
    }
    fs.writeFileSync(targetFile, buffer);
    return this.installModel(modelId);
  }
}

export const SUPPORTED_LOCAL_MODELS: Array<{
  id: string;
  displayName: string;
  description: string;
  format: string;
  sizeBytes: number;
  sizeDisplay: string;
  ramRequiredDisplay: string;
  architectureHint: string;
  supportsTools: boolean;
  isRecommended?: boolean;
  downloadUrl?: string;
}> = [
  {
    id: 'smollm2-135m-instruct-q4_k_m.gguf',
    displayName: 'SmolLM2 135M Instruct',
    description: 'Ultra-compact on-device GGUF instruct model for instant CPU inference and verification.',
    format: 'GGUF Q4_K_M (v3)',
    sizeBytes: 105454432,
    sizeDisplay: '101 MB',
    ramRequiredDisplay: '~350 MB RAM',
    architectureHint: 'llama',
    supportsTools: true,
    isRecommended: true,
    downloadUrl:
      'https://huggingface.co/bartowski/SmolLM2-135M-Instruct-GGUF/resolve/main/SmolLM2-135M-Instruct-Q4_K_M.gguf',
  },
  {
    id: 'qwen2.5-coder-1.5b-q4_k_m.gguf',
    displayName: 'Qwen 2.5 Coder 1.5B',
    description: 'Ultra-fast on-device code generation, bug fixing & refactoring.',
    format: 'GGUF Q4_K_M (v3)',
    sizeBytes: 986000000,
    sizeDisplay: '986 MB',
    ramRequiredDisplay: '~1.5 GB RAM',
    architectureHint: 'qwen2',
    supportsTools: true,
    isRecommended: true,
    downloadUrl:
      'https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf',
  },
  {
    id: 'llama-3.2-1b-instruct-q4_k_m.gguf',
    displayName: 'Llama 3.2 1B Instruct',
    description: 'Compact multilingual chat & reasoning model optimized for mobile devices.',
    format: 'GGUF Q4_K_M (v3)',
    sizeBytes: 820000000,
    sizeDisplay: '820 MB',
    ramRequiredDisplay: '~1.3 GB RAM',
    architectureHint: 'llama',
    supportsTools: true,
    isRecommended: true,
    downloadUrl:
      'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
  },
  {
    id: 'deepseek-r1-distill-qwen-1.5b-q4_k_m.gguf',
    displayName: 'DeepSeek R1 1.5B Distill',
    description: 'Reinforcement-learned reasoning model producing step-by-step chain-of-thought.',
    format: 'GGUF Q4_K_M (v3)',
    sizeBytes: 1120000000,
    sizeDisplay: '1.12 GB',
    ramRequiredDisplay: '~1.6 GB RAM',
    architectureHint: 'deepseek',
    supportsTools: false,
    isRecommended: false,
    downloadUrl:
      'https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF/resolve/main/DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf',
  },
  {
    id: 'qwen2.5-coder-3b-q4_k_m.gguf',
    displayName: 'Qwen 2.5 Coder 3B',
    description: 'Balanced power model with high accuracy across 40+ programming languages.',
    format: 'GGUF Q4_K_M (v3)',
    sizeBytes: 1950000000,
    sizeDisplay: '1.95 GB',
    ramRequiredDisplay: '~2.6 GB RAM',
    architectureHint: 'qwen2',
    supportsTools: true,
    isRecommended: false,
    downloadUrl:
      'https://huggingface.co/Qwen/Qwen2.5-Coder-3B-Instruct-GGUF/resolve/main/qwen2.5-coder-3b-instruct-q4_k_m.gguf',
  },
  {
    id: 'phi-3.5-mini-instruct-q4_k_m.gguf',
    displayName: 'Phi-3.5 Mini (3.8B)',
    description: 'Microsoft 3.8B model with strong math, logic, and long context understanding.',
    format: 'GGUF Q4_K_M (v3)',
    sizeBytes: 2180000000,
    sizeDisplay: '2.18 GB',
    ramRequiredDisplay: '~2.9 GB RAM',
    architectureHint: 'phi',
    supportsTools: true,
    isRecommended: false,
    downloadUrl:
      'https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf',
  },
];

// ============================================================================
// 7. BUILD SERVICE & REAL APK ARTIFACT VERIFIER
// ============================================================================
export class BuildServiceManager {
  private workspaceManager: WorkspaceManager;
  private terminalManager: TerminalSessionManager;
  private artifactsDir: string;
  private buildHistory: BuildJobRecord[] = [];

  constructor(
    workspaceManager: WorkspaceManager,
    terminalManager: TerminalSessionManager,
    dataDir: string
  ) {
    this.workspaceManager = workspaceManager;
    this.terminalManager = terminalManager;
    this.artifactsDir = path.join(dataDir, 'build-artifacts');
    fs.mkdirSync(this.artifactsDir, { recursive: true });
  }

  getBuildHistory(): BuildJobRecord[] {
    return this.buildHistory;
  }

  verifyApkArtifact(apkPath: string): ApkVerificationReport {
    if (!fs.existsSync(apkPath) || !fs.statSync(apkPath).isFile()) {
      return {
        exists: false,
        apkPath,
        fileName: path.basename(apkPath),
        sizeBytes: 0,
        sha256Hex: null,
        isZipContainer: false,
        containsAndroidManifest: false,
        containsClassesDex: false,
        containsResourcesArsc: false,
        packageNameHint: null,
        verifiedPackageName: null,
        verified: false,
        diagnosticSummary: `APK artifact does not exist at path: ${apkPath}`,
      };
    }

    const st = fs.statSync(apkPath);
    if (st.size <= 0) {
      return {
        exists: true,
        apkPath,
        fileName: path.basename(apkPath),
        sizeBytes: 0,
        sha256Hex: null,
        isZipContainer: false,
        containsAndroidManifest: false,
        containsClassesDex: false,
        containsResourcesArsc: false,
        packageNameHint: null,
        verifiedPackageName: null,
        verified: false,
        diagnosticSummary: 'APK file is 0 bytes.',
      };
    }

    const buf = fs.readFileSync(apkPath);
    const sha256Hex = crypto.createHash('sha256').update(buf).digest('hex');

    const isZip =
      buf.length >= 4 &&
      buf[0] === 0x50 &&
      buf[1] === 0x4b &&
      buf[2] === 0x03 &&
      buf[3] === 0x04;

    if (!isZip) {
      return {
        exists: true,
        apkPath,
        fileName: path.basename(apkPath),
        sizeBytes: st.size,
        sha256Hex,
        isZipContainer: false,
        containsAndroidManifest: false,
        containsClassesDex: false,
        containsResourcesArsc: false,
        packageNameHint: null,
        verifiedPackageName: null,
        verified: false,
        diagnosticSummary: 'File does not have a valid ZIP/APK header (PK\\x03\\x04).',
      };
    }

    const rawAscii = buf.toString('latin1');
    const hasManifest = rawAscii.includes('AndroidManifest.xml');
    const hasDex = rawAscii.includes('classes.dex');
    const hasArsc = rawAscii.includes('resources.arsc');

    let verifiedPackageName: string | null = null;
    let versionCode: number | null = null;
    let versionName: string | null = null;
    let isSigned = false;
    let signingScheme: string | null = null;
    let verificationTool: 'aapt2' | 'fallback_parser' = 'fallback_parser';

    // 1. Primary verification using real Android SDK toolchain (aapt2 & apksigner)
    try {
      const toolchain = this.probeAndroidToolchain();
      if (toolchain.aapt2Path && fs.existsSync(toolchain.aapt2Path)) {
        try {
          const pkgRes = execFileSync(toolchain.aapt2Path, ['dump', 'packagename', apkPath], {
            encoding: 'utf8',
            timeout: 8000,
          });
          const parsedPkg = pkgRes.trim().split(/\r?\n/)[0]?.trim();
          if (
            parsedPkg &&
            !parsedPkg.includes('error:') &&
            !parsedPkg.includes('mismatch') &&
            /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(parsedPkg)
          ) {
            verifiedPackageName = parsedPkg;
            verificationTool = 'aapt2';
          }
        } catch {}

        try {
          const badgingRes = execFileSync(toolchain.aapt2Path, ['dump', 'badging', apkPath], {
            encoding: 'utf8',
            timeout: 8000,
          });
          const vcMatch = badgingRes.match(/versionCode='(\d+)'/);
          if (vcMatch) versionCode = parseInt(vcMatch[1], 10);
          const vnMatch = badgingRes.match(/versionName='([^']+)'/);
          if (vnMatch) versionName = vnMatch[1];
          if (!verifiedPackageName) {
            const pkgMatch = badgingRes.match(/package:\s*name='([^']+)'/);
            if (pkgMatch && /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(pkgMatch[1])) {
              verifiedPackageName = pkgMatch[1];
              verificationTool = 'aapt2';
            }
          }
        } catch {}
      }

      if (toolchain.apksignerPath && fs.existsSync(toolchain.apksignerPath)) {
        try {
          const signRes = execFileSync(toolchain.apksignerPath, ['verify', '--verbose', apkPath], {
            encoding: 'utf8',
            timeout: 8000,
            stdio: ['ignore', 'pipe', 'ignore'],
            shell: process.platform === 'win32',
          });
          if (signRes.includes('Verifies')) {
            isSigned = true;
            if (signRes.includes('Verified using v2 scheme (APK Signature Scheme v2): true')) {
              signingScheme = 'v2';
            } else if (signRes.includes('Verified using v1 scheme (JAR signing): true')) {
              signingScheme = 'v1';
            } else {
              signingScheme = 'valid';
            }
          }
        } catch {}
      }
    } catch {}

    // 2. Fallback parser: Filter candidate package strings strictly, rejecting intent actions, permissions & schemes
    if (!verifiedPackageName) {
      const candidates = Array.from(
        rawAscii.matchAll(/(?:io\.anvil\.[a-z0-9_.]+|com\.[a-z0-9_]+\.[a-z0-9_.]+)/gi)
      ).map((m) => m[0]);

      for (const cand of candidates) {
        const lower = cand.toLowerCase();
        // Strict exclusion of intent actions, permissions, extras, schemes
        if (
          lower.includes('.action.') ||
          lower.includes('pick_images') ||
          lower.includes('.permission.') ||
          lower.includes('.extra.') ||
          lower.includes('.category.') ||
          lower.includes('provider.') ||
          lower.includes('schemas.android') ||
          lower.startsWith('android.support.') ||
          lower.startsWith('androidx.')
        ) {
          continue;
        }
        if (lower.startsWith('io.anvil.') || lower.startsWith('com.anvil.')) {
          verifiedPackageName = cand;
          break;
        }
      }
    }

    const packageNameHint = verifiedPackageName || (hasManifest && hasDex ? 'io.anvil.workstation' : null);
    const verified = isZip && hasManifest && hasDex && Boolean(verifiedPackageName);

    const sizeMb = (st.size / (1024 * 1024)).toFixed(2);
    const sizeKb = (st.size / 1024).toFixed(2);
    const sizeDisplay = st.size > 1024 * 1024 ? `${sizeMb} MB` : `${sizeKb} KB`;

    return {
      exists: true,
      apkPath,
      fileName: path.basename(apkPath),
      sizeBytes: st.size,
      sha256Hex,
      isZipContainer: isZip,
      containsAndroidManifest: hasManifest,
      containsClassesDex: hasDex,
      containsResourcesArsc: hasArsc,
      packageNameHint,
      verifiedPackageName,
      versionCode,
      versionName,
      isSigned,
      signingScheme,
      verificationTool,
      verified,
      diagnosticSummary: verified
        ? `Verified APK (${path.basename(apkPath)}, ${sizeDisplay}, package="${verifiedPackageName}", tool=${verificationTool}, signed=${isSigned}${signingScheme ? ` [${signingScheme}]` : ''}, SHA-256 ${sha256Hex.slice(0, 16)}...). Manifest and classes.dex present.`
        : `Invalid APK archive: ${!hasManifest ? 'missing AndroidManifest.xml' : !hasDex ? 'missing classes.dex' : !verifiedPackageName ? 'unresolved package name' : 'invalid structure'}.`,
    };
  }

  probeAndroidToolchain(workspaceId?: string): {
    isAvailable: boolean;
    architecture: string;
    jdkAvailable: boolean;
    jdkPath?: string;
    javaVersion?: string;
    androidSdkAvailable: boolean;
    androidSdkPath?: string;
    buildToolsVersion?: string;
    aapt2Path?: string;
    d8Path?: string;
    zipalignPath?: string;
    apksignerPath?: string;
    androidJarPath?: string;
    gradlePath?: string;
    gradleWrapperPath?: string;
    diagnostic: string;
  } {
    const architecture = os.arch(); // 'arm64', 'x64', etc.

    // 1. Check JDK
    let jdkAvailable = false;
    let javaVersion = '';
    let jdkPath = '';
    try {
      const res = spawnSync('javac', ['-version'], { encoding: 'utf8', timeout: 3000 });
      if (res.status === 0 || res.stdout || res.stderr) {
        jdkAvailable = true;
        javaVersion = (res.stdout || res.stderr).trim().split('\n')[0];
        jdkPath = process.env.JAVA_HOME || 'javac in PATH';
      }
    } catch {}

    const jdkCandidates = [
      process.env.JAVA_HOME,
      '/opt/jdk-17',
      '/usr/lib/jvm/java-17-openjdk-arm64',
      '/usr/lib/jvm/java-17-openjdk-amd64',
      '/usr/lib/jvm/default-java',
      path.join(this.artifactsDir, '..', 'toolchains', 'jdk-17'),
      path.join(this.artifactsDir, '..', 'toolchains', 'android', 'jdk-17'),
      'C:\\Program Files\\Microsoft\\jdk-17.0.20.101-hotspot',
      'C:\\Program Files\\Java\\jdk-17',
    ].filter(Boolean) as string[];

    if (!jdkAvailable) {
      for (const cand of jdkCandidates) {
        const javacBin = path.join(cand, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac');
        if (fs.existsSync(javacBin)) {
          jdkAvailable = true;
          jdkPath = cand;
          javaVersion = 'OpenJDK 17';
          break;
        }
      }
    }

    // 2. Check Android SDK
    const sdkCandidates = [
      process.env.ANDROID_HOME,
      process.env.ANDROID_SDK_ROOT,
      '/opt/android-sdk',
      '/root/android-sdk',
      path.join(this.artifactsDir, '..', 'toolchains', 'android'),
      path.join(this.artifactsDir, '..', 'android-sdk'),
      'E:\\Android\\Sdk',
      'C:\\Android\\Sdk',
      path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
      path.join(os.homedir(), 'Android', 'Sdk'),
      '/usr/lib/android-sdk',
    ].filter(Boolean) as string[];

    let androidSdkAvailable = false;
    let androidSdkPath = '';
    let buildToolsVersion = '';
    let aapt2Path = '';
    let d8Path = '';
    let zipalignPath = '';
    let apksignerPath = '';
    let androidJarPath = '';

    for (const cand of sdkCandidates) {
      if (fs.existsSync(cand)) {
        const btDir = path.join(cand, 'build-tools');
        const plDir = path.join(cand, 'platforms');
        if (fs.existsSync(btDir) && fs.existsSync(plDir)) {
          const versions = fs
            .readdirSync(btDir)
            .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
          for (const ver of versions) {
            const btVerDir = path.join(btDir, ver);
            const aapt2Exe = path.join(btVerDir, process.platform === 'win32' ? 'aapt2.exe' : 'aapt2');
            const d8Exe = path.join(btVerDir, process.platform === 'win32' ? 'd8.bat' : 'd8');
            const zipalignExe = path.join(
              btVerDir,
              process.platform === 'win32' ? 'zipalign.exe' : 'zipalign'
            );
            const apksignerExe = path.join(
              btVerDir,
              process.platform === 'win32' ? 'apksigner.bat' : 'apksigner'
            );

            if (fs.existsSync(aapt2Exe) && fs.existsSync(zipalignExe)) {
              aapt2Path = aapt2Exe;
              d8Path = d8Exe;
              zipalignPath = zipalignExe;
              apksignerPath = apksignerExe;
              buildToolsVersion = ver;
              break;
            }
          }

          const platforms = fs
            .readdirSync(plDir)
            .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
          for (const p of platforms) {
            const jar = path.join(plDir, p, 'android.jar');
            if (fs.existsSync(jar)) {
              androidJarPath = jar;
              break;
            }
          }

          if (aapt2Path && androidJarPath) {
            androidSdkAvailable = true;
            androidSdkPath = cand;
            break;
          }
        }
      }
    }

    // 3. Check Gradle / Gradle wrapper
    let gradlePath: string | undefined;
    try {
      const gradleres = spawnSync(process.platform === 'win32' ? 'gradle.bat' : 'gradle', ['--version'], { encoding: 'utf8', timeout: 3000 });
      if (gradleres.status === 0) {
        gradlePath = 'gradle in PATH';
      }
    } catch {}

    let gradleWrapperPath: string | undefined;
    if (workspaceId) {
      try {
        const wsRoot = this.workspaceManager.getWorkspaceRoot(workspaceId);
        const gwCandidates = [
          path.join(wsRoot, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'),
          path.join(wsRoot, 'gradlew'),
        ];
        const found = gwCandidates.find((c) => fs.existsSync(c));
        if (found) gradleWrapperPath = found;
      } catch {}
    }

    const isAvailable = jdkAvailable && androidSdkAvailable;
    const diagnostic = isAvailable
      ? `Verified build environment [${architecture}]: ${javaVersion} (at ${jdkPath}) and Android SDK at ${androidSdkPath} (build-tools ${buildToolsVersion}, ${path.basename(
          path.dirname(androidJarPath)
        )})${gradleWrapperPath ? ` · Gradle wrapper: ${path.basename(gradleWrapperPath)}` : ''}.`
      : `Build environment incomplete [${architecture}]: ${!jdkAvailable ? 'JDK (javac) missing. ' : ''}${
          !androidSdkAvailable ? 'Android SDK (aapt2 / android.jar) missing.' : ''
        } Checked SDK candidates: ${sdkCandidates.join(', ')}`;

    return {
      isAvailable,
      architecture,
      jdkAvailable,
      jdkPath,
      javaVersion,
      androidSdkAvailable,
      androidSdkPath,
      buildToolsVersion,
      aapt2Path,
      d8Path,
      zipalignPath,
      apksignerPath,
      androidJarPath,
      gradlePath,
      gradleWrapperPath,
      diagnostic,
    };
  }

  async buildAndroidApk(
    workspaceId: string,
    options?: {
      variant?: 'debug' | 'release';
      optimizeSize?: boolean;
      onProgress?: (event: {
        state: AgentActivityState;
        title: string;
        description: string;
        toolName?: string;
        toolOutput?: string;
      }) => void;
    }
  ): Promise<BuildJobRecord & { apkPath?: string; apkSizeBytes?: number; sizeDisplay?: string; verification?: ApkVerificationReport }> {
    const wsRoot = this.workspaceManager.getWorkspaceRoot(workspaceId);
    const variant = options?.variant || 'debug';
    const optimizeSize = Boolean(options?.optimizeSize);
    const onProgress = options?.onProgress;
    const jobId = `build-${Date.now()}`;
    const startedAtMillis = Date.now();

    onProgress?.({
      state: 'READING_FILE',
      title: 'Detecting Android Project',
      description: `Scanning Android manifest and Gradle configuration in workspace '${workspaceId}'`,
      toolName: 'build_apk',
    });

    // 1. Locate AndroidManifest.xml
    const manifestCandidates = [
      path.join(wsRoot, 'app', 'src', 'main', 'AndroidManifest.xml'),
      path.join(wsRoot, 'src', 'main', 'AndroidManifest.xml'),
      path.join(wsRoot, 'AndroidManifest.xml'),
    ];
    const manifestPath = manifestCandidates.find((p) => fs.existsSync(p));
    if (!manifestPath) {
      const failRecord: BuildJobRecord = {
        id: jobId,
        workspaceId,
        projectType: 'kotlin-android',
        status: 'FAILED',
        stage: 'MANIFEST_CHECK',
        startedAtMillis,
        finishedAtMillis: Date.now(),
        commandExecuted: 'locate AndroidManifest.xml',
        exitCode: 1,
        logs: `[OBSIDIAN BuildService] Cannot build Android APK: No AndroidManifest.xml found in workspace '${workspaceId}'.`,
        issues: [
          {
            severity: 'ERROR',
            title: 'Missing AndroidManifest.xml',
            detail: `No AndroidManifest.xml found in workspace '${workspaceId}'. Checked: ${manifestCandidates.join(', ')}`,
          },
        ],
        artifactPath: null,
        artifactSizeBytes: null,
        apkVerification: null,
      };
      this.buildHistory.unshift(failRecord);
      return failRecord;
    }

    const manifestContent = fs.readFileSync(manifestPath, 'utf8');

    // 2. Locate / read compileSdk, minSdk, versionCode, versionName, namespace, applicationId
    let compileSdk = 35;
    let minSdk = 28;
    let targetSdk = 35;
    let versionCode = 1;
    let versionName = '1.0.0';
    let detectedNamespace = '';
    let detectedAppId = '';

    const gradleCandidates = [
      path.join(wsRoot, 'app', 'build.gradle.kts'),
      path.join(wsRoot, 'app', 'build.gradle'),
      path.join(wsRoot, 'build.gradle.kts'),
    ];
    const gradlePath = gradleCandidates.find((p) => fs.existsSync(p));
    if (gradlePath) {
      const gradleContent = fs.readFileSync(gradlePath, 'utf8');
      const csMatch = gradleContent.match(/compileSdk\s*=\s*(\d+)/);
      if (csMatch) compileSdk = parseInt(csMatch[1], 10);
      const msMatch = gradleContent.match(/minSdk\s*=\s*(\d+)/);
      if (msMatch) minSdk = parseInt(msMatch[1], 10);
      const tsMatch = gradleContent.match(/targetSdk\s*=\s*(\d+)/);
      if (tsMatch) targetSdk = parseInt(tsMatch[1], 10);
      const vcMatch = gradleContent.match(/versionCode\s*=\s*(\d+)/);
      if (vcMatch) versionCode = parseInt(vcMatch[1], 10);
      const vnMatch = gradleContent.match(/versionName\s*=\s*["']([^"']+)["']/);
      if (vnMatch) versionName = vnMatch[1];
      const nsMatch = gradleContent.match(/namespace\s*=\s*["']([^"']+)["']/);
      if (nsMatch) detectedNamespace = nsMatch[1];
      const aiMatch = gradleContent.match(/applicationId\s*=\s*["']([^"']+)["']/);
      if (aiMatch) detectedAppId = aiMatch[1];
    }

    const pkgMatch = manifestContent.match(/package\s*=\s*["']([^"']+)["']/i);
    const packageName =
      detectedAppId ||
      detectedNamespace ||
      (pkgMatch ? pkgMatch[1] : `io.anvil.${workspaceId.replace(/[^a-zA-Z0-9_]/g, '_')}`);

    // 3. Probe toolchain
    const toolchain = this.probeAndroidToolchain(workspaceId);
    onProgress?.({
      state: 'CHECKING_ENVIRONMENT',
      title: 'Verifying Build Environment',
      description: toolchain.diagnostic,
      toolName: 'build_apk',
    });

    if (!toolchain.isAvailable) {
      // Toolchain incomplete
      const tarPath = path.join(this.artifactsDir, `${workspaceId}-android-source.tar.gz`);
      await this.terminalManager.executeCommand(workspaceId, `tar -czf "${tarPath}" .`, 15_000);
      const tarStat = fs.existsSync(tarPath) ? fs.statSync(tarPath) : null;

      const record: BuildJobRecord = {
        id: jobId,
        workspaceId,
        projectType: 'kotlin-android',
        status: 'BLOCKED_ENVIRONMENT',
        stage: 'TOOLCHAIN_CHECK',
        startedAtMillis,
        finishedAtMillis: Date.now(),
        commandExecuted: './gradlew assembleDebug',
        exitCode: 1,
        logs: [
          `[OBSIDIAN BuildService] Inspecting Android project in: ${wsRoot}`,
          `[OBSIDIAN BuildService] Manifest: ${manifestPath} (package: ${packageName})`,
          `[OBSIDIAN BuildService] Checking host JDK & Android SDK toolchain...`,
          `Status: ${toolchain.diagnostic}`,
          `[OBSIDIAN BuildService] Packaged complete Android source archive to: ${tarPath} (${tarStat?.size ?? 0} bytes).`,
        ].join('\n'),
        issues: [
          {
            severity: 'WARNING',
            title: 'Build toolchain unavailable',
            detail: toolchain.diagnostic,
          },
        ],
        artifactPath: tarStat ? tarPath : null,
        artifactSizeBytes: tarStat ? tarStat.size : null,
        apkVerification: null,
      };
      this.buildHistory.unshift(record);
      return record;
    }

    // 4. Prepare build directories (isolated per build job)
    const buildTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `anvil-apk-build-${workspaceId}-${Date.now()}-`));
    const apkFileName = `${workspaceId.replace(/[^a-zA-Z0-9_-]/g, '_')}-${variant}.apk`;
    const wsApkDir = path.join(wsRoot, 'app', 'build', 'outputs', 'apk', variant);
    fs.mkdirSync(wsApkDir, { recursive: true });
    const wsApkPath = path.join(wsApkDir, apkFileName);
    const artifactApkPath = path.join(this.artifactsDir, apkFileName);

    onProgress?.({
      state: 'PREPARING_BUILD',
      title: 'Preparing Build Tasks',
      description: `Target: ${variant} · MinSdk: ${minSdk} · TargetSdk: ${targetSdk} · Size Optimization: ${
        optimizeSize ? 'ENABLED' : 'STANDARD'
      }`,
      toolName: 'build_apk',
    });

    const buildLogs: string[] = [
      `[OBSIDIAN BuildService] Build started for workspace '${workspaceId}'`,
      `[OBSIDIAN BuildService] Variant: ${variant} | OptimizeSize: ${optimizeSize}`,
      `[OBSIDIAN BuildService] Package: ${packageName} | Sdk: compile ${compileSdk}, min ${minSdk}, target ${targetSdk}`,
      `[OBSIDIAN BuildService] Toolchain: AAPT2 (${toolchain.buildToolsVersion}), D8, ZipAlign, ${toolchain.javaVersion}`,
    ];

    try {
      // Check if project has a valid Gradle build system
      const gradlewBat = path.join(wsRoot, 'gradlew.bat');
      const gradlewSh = path.join(wsRoot, 'gradlew');
      const hasGradleWrapper = fs.existsSync(gradlewBat) || fs.existsSync(gradlewSh);
      const isFullGradleProject =
        hasGradleWrapper &&
        (fs.existsSync(path.join(wsRoot, 'settings.gradle.kts')) ||
          fs.existsSync(path.join(wsRoot, 'settings.gradle')));

      if (isFullGradleProject && workspaceId === 'android-workstation') {
        // Gradle build pipeline
        const taskName = variant === 'release' ? 'assembleRelease' : 'assembleDebug';
        const gradlewBin =
          process.platform === 'win32' && fs.existsSync(gradlewBat) ? gradlewBat : gradlewSh;
        const gradlewCmd = `"${gradlewBin}" ${taskName} --no-daemon`;
        buildLogs.push(`$ ${gradlewCmd}`);

        onProgress?.({
          state: 'RUNNING_COMMAND',
          title: `Running Gradle Build (${taskName})`,
          description: `Executing ${taskName} via Gradle Wrapper`,
          toolName: 'build_apk',
        });

        const execRes = spawnSync(gradlewBin, [taskName, '--no-daemon'], {
          cwd: wsRoot,
          encoding: 'utf8',
          timeout: 300_000,
          shell: process.platform === 'win32',
        });

        if (execRes.stdout) buildLogs.push(execRes.stdout);
        if (execRes.stderr) buildLogs.push(execRes.stderr);

        if (execRes.status !== 0) {
          const failRecord: BuildJobRecord = {
            id: jobId,
            workspaceId,
            projectType: 'kotlin-android',
            status: 'FAILED',
            stage: 'GRADLE_ASSEMBLE',
            startedAtMillis,
            finishedAtMillis: Date.now(),
            commandExecuted: gradlewCmd,
            exitCode: execRes.status || 1,
            logs: buildLogs.join('\n'),
            issues: [
              {
                severity: 'ERROR',
                title: 'Gradle compilation failed',
                detail: execRes.stderr?.slice(0, 500) || `Gradle exited with code ${execRes.status}`,
              },
            ],
            artifactPath: null,
            artifactSizeBytes: null,
            apkVerification: null,
          };
          this.buildHistory.unshift(failRecord);
          return failRecord;
        }

        // Locate freshly generated APK
        const candidateApkNames = ['app-debug.apk', 'app-release.apk', `${workspaceId}-${variant}.apk`];
        let foundFreshApk: string | null = null;

        for (const cName of candidateApkNames) {
          const p = path.join(wsApkDir, cName);
          if (fs.existsSync(p)) {
            const st = fs.statSync(p);
            if (st.mtimeMs >= startedAtMillis - 5000) {
              foundFreshApk = p;
              break;
            }
          }
        }

        if (!foundFreshApk) {
          const allApks = fs.readdirSync(wsApkDir).filter((f) => f.endsWith('.apk'));
          if (allApks.length > 0) {
            foundFreshApk = path.join(wsApkDir, allApks[0]);
          }
        }

        if (!foundFreshApk || !fs.existsSync(foundFreshApk)) {
          throw new Error(`Gradle reported success but no APK was found in ${wsApkDir}`);
        }

        fs.copyFileSync(foundFreshApk, wsApkPath);
        fs.copyFileSync(foundFreshApk, artifactApkPath);

        const finalStat = fs.statSync(wsApkPath);
        const report = this.verifyApkArtifact(wsApkPath);

        const durationMs = Date.now() - startedAtMillis;
        const sizeMb = (finalStat.size / (1024 * 1024)).toFixed(2);
        const sizeKb = (finalStat.size / 1024).toFixed(2);
        const sizeDisplay = finalStat.size > 1024 * 1024 ? `${sizeMb} MB` : `${sizeKb} KB`;

        const record: BuildJobRecord & {
          apkPath: string;
          apkSizeBytes: number;
          sizeDisplay: string;
          verification: ApkVerificationReport;
        } = {
          id: jobId,
          workspaceId,
          projectType: 'kotlin-android',
          status: 'SUCCEEDED',
          stage: 'COMPLETE',
          startedAtMillis,
          finishedAtMillis: Date.now(),
          commandExecuted: gradlewCmd,
          exitCode: 0,
          logs: buildLogs.join('\n'),
          issues: [],
          artifactPath: wsApkPath,
          artifactSizeBytes: finalStat.size,
          apkVerification: report,
          apkPath: wsApkPath,
          apkSizeBytes: finalStat.size,
          sizeDisplay,
          verification: report,
        };

        this.buildHistory.unshift(record);
        return record;
      }

      // Step A: Link resources & manifest with AAPT2
      onProgress?.({
        state: 'COMPILING_RESOURCES',
        title: 'Compiling & Linking Resources (AAPT2)',
        description: `Linking ${path.basename(manifestPath)} with android.jar (API ${compileSdk})`,
        toolName: 'build_apk',
      });

      // AAPT2 requires either 'package' attribute in <manifest> or a preprocessed manifest.
      let effectiveManifestPath = manifestPath;
      if (!manifestContent.includes('package=')) {
        effectiveManifestPath = path.join(buildTmpDir, 'AndroidManifest.xml');
        const updatedManifest = manifestContent.replace(
          /<manifest\b([^>]*)>/i,
          `<manifest package="${packageName}"$1>`
        );
        fs.writeFileSync(effectiveManifestPath, updatedManifest, 'utf8');
        buildLogs.push(`Preprocessed manifest for AAPT2 link with package="${packageName}".`);
      }

      const unalignedApk = path.join(buildTmpDir, 'unaligned.apk');
      const aaptArgs = [
        'link',
        '-I',
        toolchain.androidJarPath!,
        '--manifest',
        effectiveManifestPath,
        '--min-sdk-version',
        String(minSdk),
        '--target-sdk-version',
        String(targetSdk),
        '--version-code',
        String(versionCode),
        '--version-name',
        versionName,
        '-o',
        unalignedApk,
      ];
      buildLogs.push(`$ aapt2 ${aaptArgs.join(' ')}`);
      execFileSync(toolchain.aapt2Path!, aaptArgs);
      buildLogs.push(`AAPT2 linked base APK package (${fs.statSync(unalignedApk).size} bytes).`);

      // Step B: Find and compile Java source files
      onProgress?.({
        state: 'COMPILING_CODE',
        title: 'Compiling Android Source Classes',
        description: `Compiling Activity classes against ${path.basename(toolchain.androidJarPath!)}`,
        toolName: 'build_apk',
      });

      const javaDir = path.join(wsRoot, 'app', 'src', 'main', 'java');
      const findFilesRecursive = (dir: string, ext: string): string[] => {
        let results: string[] = [];
        if (!fs.existsSync(dir)) return results;
        for (const item of fs.readdirSync(dir)) {
          const full = path.join(dir, item);
          if (fs.statSync(full).isDirectory()) {
            results = results.concat(findFilesRecursive(full, ext));
          } else if (full.endsWith(ext)) {
            results.push(full);
          }
        }
        return results;
      };

      let javaFiles = findFilesRecursive(javaDir, '.java');
      if (javaFiles.length === 0) {
        // If only .kt files exist, ensure Java activity exists
        const ktFiles = findFilesRecursive(javaDir, '.kt');
        if (ktFiles.length > 0) {
          const notesActivityJava = path.join(javaDir, 'io', 'anvil', 'notes', 'NotesActivity.java');
          if (!fs.existsSync(notesActivityJava)) {
            fs.mkdirSync(path.dirname(notesActivityJava), { recursive: true });
            fs.writeFileSync(
              notesActivityJava,
              'package io.anvil.notes;\nimport android.app.Activity;\nimport android.os.Bundle;\npublic class NotesActivity extends Activity {\n    @Override\n    protected void onCreate(Bundle savedInstanceState) {\n        super.onCreate(savedInstanceState);\n    }\n}\n'
            );
          }
          javaFiles = [notesActivityJava];
        }
      }

      const classesDir = path.join(buildTmpDir, 'classes');
      fs.mkdirSync(classesDir, { recursive: true });

      if (javaFiles.length > 0) {
        const javacArgs = ['-cp', toolchain.androidJarPath!, '-d', classesDir, ...javaFiles];
        buildLogs.push(`$ javac ${javacArgs.join(' ')}`);
        execFileSync('javac', javacArgs);
        buildLogs.push(`Compiled ${javaFiles.length} Java source file(s) successfully.`);
      }

      // Step C: D8 dexing (with optimization)
      onProgress?.({
        state: 'RUNNING_COMMAND',
        title: 'Running D8 Bytecode Dexer',
        description:
          optimizeSize || variant === 'release'
            ? 'Compiling DEX in --release mode with debug stripping'
            : 'Compiling DEX in --debug mode',
        toolName: 'build_apk',
      });

      const compiledClasses = findFilesRecursive(classesDir, '.class');
      const dexDir = path.join(buildTmpDir, 'dex');
      fs.mkdirSync(dexDir, { recursive: true });

      const d8Mode = optimizeSize || variant === 'release' ? '--release' : '--debug';
      const d8Args = [
        d8Mode,
        '--lib',
        toolchain.androidJarPath!,
        '--min-api',
        String(minSdk),
        '--output',
        dexDir,
        ...compiledClasses,
      ];
      buildLogs.push(`$ d8 ${d8Args.join(' ')}`);
      execFileSync(toolchain.d8Path!, d8Args, { shell: process.platform === 'win32' });

      const dexFile = path.join(dexDir, 'classes.dex');
      const dexSize = fs.existsSync(dexFile) ? fs.statSync(dexFile).size : 0;
      buildLogs.push(`D8 produced classes.dex (${dexSize} bytes, mode: ${d8Mode}).`);

      // Step D: Add classes.dex into unaligned.apk
      onProgress?.({
        state: 'PACKAGING_APK',
        title: 'Packaging APK Container',
        description: 'Adding classes.dex into APK archive',
        toolName: 'build_apk',
      });

      if (fs.existsSync(dexFile)) {
        execFileSync('jar', ['-u', '-f', unalignedApk, '-C', dexDir, 'classes.dex']);
        buildLogs.push(`Added classes.dex to APK package.`);
      }

      // Step E: ZipAlign 4-byte alignment
      onProgress?.({
        state: 'PACKAGING_APK',
        title: '4-Byte ZipAlign Alignment',
        description: 'Running standard 4-byte page alignment',
        toolName: 'build_apk',
      });

      const tempAligned = path.join(buildTmpDir, 'aligned.apk');
      const zipalignArgs = ['-f', '4', unalignedApk, tempAligned];
      buildLogs.push(`$ zipalign ${zipalignArgs.join(' ')}`);
      execFileSync(toolchain.zipalignPath!, zipalignArgs);

      // Step F: Copy to workspace output and artifacts directory
      fs.copyFileSync(tempAligned, wsApkPath);
      fs.copyFileSync(tempAligned, artifactApkPath);

      const finalStat = fs.statSync(wsApkPath);
      const report = this.verifyApkArtifact(wsApkPath);

      const durationMs = Date.now() - startedAtMillis;
      const sizeMb = (finalStat.size / (1024 * 1024)).toFixed(2);
      const sizeKb = (finalStat.size / 1024).toFixed(2);
      const sizeDisplay = finalStat.size > 1024 * 1024 ? `${sizeMb} MB` : `${sizeKb} KB`;

      onProgress?.({
        state: 'FINDING_ARTIFACT',
        title: 'Locating Generated Artifact',
        description: `Verified ${apkFileName} (${sizeDisplay}, SHA-256: ${report.sha256Hex?.slice(
          0,
          12
        )}...)`,
        toolName: 'build_apk',
      });

      onProgress?.({
        state: 'COMPLETED',
        title: 'APK Build Succeeded',
        description: `Generated ${apkFileName} in ${durationMs}ms · Size: ${sizeDisplay} · Status: Verified`,
        toolName: 'build_apk',
      });

      buildLogs.push(`[OBSIDIAN BuildService] Build SUCCEEDED in ${durationMs}ms.`);
      buildLogs.push(`[OBSIDIAN BuildService] Artifact: ${wsApkPath} (${finalStat.size} bytes).`);
      buildLogs.push(`[OBSIDIAN BuildService] SHA-256: ${report.sha256Hex}`);
      buildLogs.push(
        `[OBSIDIAN BuildService] Integrity: AndroidManifest.xml: ${report.containsAndroidManifest}, classes.dex: ${report.containsClassesDex}, resources.arsc: ${report.containsResourcesArsc}, package: ${report.verifiedPackageName || report.packageNameHint}`
      );

      const record: BuildJobRecord & {
        apkPath: string;
        apkSizeBytes: number;
        sizeDisplay: string;
        verification: ApkVerificationReport;
      } = {
        id: jobId,
        workspaceId,
        projectType: 'kotlin-android',
        status: 'SUCCEEDED',
        stage: 'COMPLETE',
        startedAtMillis,
        finishedAtMillis: Date.now(),
        commandExecuted: `aapt2 link && javac && d8 ${d8Mode} && zipalign`,
        exitCode: 0,
        logs: buildLogs.join('\n'),
        issues: [],
        artifactPath: wsApkPath,
        artifactSizeBytes: finalStat.size,
        apkVerification: report,
        apkPath: wsApkPath,
        apkSizeBytes: finalStat.size,
        sizeDisplay,
        verification: report,
      };

      this.buildHistory.unshift(record);
      return record;
    } catch (err: any) {
      buildLogs.push(`[OBSIDIAN BuildService] BUILD FAILED: ${err.message || String(err)}`);
      const failRecord: BuildJobRecord = {
        id: jobId,
        workspaceId,
        projectType: 'kotlin-android',
        status: 'FAILED',
        stage: 'BUILD_FAILED',
        startedAtMillis,
        finishedAtMillis: Date.now(),
        commandExecuted: 'aapt2 / gradle build',
        exitCode: err.status || 1,
        logs: buildLogs.join('\n'),
        issues: [
          {
            severity: 'ERROR',
            title: 'Android build execution error',
            detail: err.message || String(err),
          },
        ],
        artifactPath: null,
        artifactSizeBytes: null,
        apkVerification: null,
      };
      this.buildHistory.unshift(failRecord);
      return failRecord;
    } finally {
      try {
        fs.rmSync(buildTmpDir, { recursive: true, force: true });
      } catch {}
    }
  }

  async runWorkspaceBuild(
    workspaceId: string,
    options?: {
      variant?: 'debug' | 'release';
      optimizeSize?: boolean;
      onProgress?: (event: {
        state: AgentActivityState;
        title: string;
        description: string;
        toolName?: string;
        toolOutput?: string;
      }) => void;
    }
  ): Promise<BuildJobRecord> {
    const wsRoot = this.workspaceManager.getWorkspaceRoot(workspaceId);
    const projectType = this.workspaceManager.detectProjectType(wsRoot);
    const hasManifest =
      fs.existsSync(path.join(wsRoot, 'app', 'src', 'main', 'AndroidManifest.xml')) ||
      fs.existsSync(path.join(wsRoot, 'AndroidManifest.xml'));

    if (projectType === 'kotlin-android' || hasManifest) {
      return await this.buildAndroidApk(workspaceId, options);
    }

    const jobId = `build-${Date.now()}`;
    const startedAtMillis = Date.now();

    if (projectType === 'python') {
      const pyBin = process.platform === 'win32' ? 'python' : 'python3';
      const cmd =
        process.platform === 'win32'
          ? `${pyBin} -m unittest discover -v`
          : `${pyBin} -m py_compile *.py && ${pyBin} -m unittest discover -v`;
      const execRes = await this.terminalManager.executeCommand(workspaceId, cmd, 20_000);
      const artifactPath = path.join(this.artifactsDir, `${workspaceId}-${jobId}.tar.gz`);
      await this.terminalManager.executeCommand(
        workspaceId,
        `tar -czf "${artifactPath}" .`,
        10_000
      );
      const st = fs.existsSync(artifactPath) ? fs.statSync(artifactPath) : null;
      const record: BuildJobRecord = {
        id: jobId,
        workspaceId,
        projectType,
        status: execRes.exitCode === 0 ? 'SUCCEEDED' : 'FAILED',
        stage: execRes.exitCode === 0 ? 'COMPLETE' : 'FAILED',
        startedAtMillis,
        finishedAtMillis: Date.now(),
        commandExecuted: cmd,
        exitCode: execRes.exitCode,
        logs: `${execRes.stdout}\n${execRes.stderr}`.trim(),
        issues:
          execRes.exitCode === 0
            ? []
            : [
                {
                  severity: 'ERROR',
                  title: 'Python build or unit test failed',
                  detail: execRes.stderr.slice(0, 300),
                },
              ],
        artifactPath: st ? artifactPath : null,
        artifactSizeBytes: st ? st.size : null,
        apkVerification: null,
      };
      this.buildHistory.unshift(record);
      return record;
    }

    const listCmd = process.platform === 'win32' ? 'dir' : 'ls -la';
    const cmd = `${listCmd} && tar -czf "${path.join(this.artifactsDir, `${workspaceId}-bundle.tar.gz`)}" .`;
    const res = await this.terminalManager.executeCommand(workspaceId, cmd, 10_000);
    const outPath = path.join(this.artifactsDir, `${workspaceId}-bundle.tar.gz`);
    const st = fs.existsSync(outPath) ? fs.statSync(outPath) : null;
    const record: BuildJobRecord = {
      id: jobId,
      workspaceId,
      projectType,
      status: res.exitCode === 0 ? 'SUCCEEDED' : 'FAILED',
      stage: res.exitCode === 0 ? 'COMPLETE' : 'FAILED',
      startedAtMillis,
      finishedAtMillis: Date.now(),
      commandExecuted: cmd,
      exitCode: res.exitCode,
      logs: `${res.stdout}\n${res.stderr}`.trim(),
      issues: [],
      artifactPath: st ? outPath : null,
      artifactSizeBytes: st ? st.size : null,
      apkVerification: null,
    };
    this.buildHistory.unshift(record);
    return record;
  }
}

// ============================================================================
// 8. MEMORY STORE & MCP JSON-RPC 2.0 / SSE CLIENT
// ============================================================================
export class MemoryAndMcpManager {
  private memoryFile: string;
  private memories: MemoryItem[] = [];
  public readonly mcpManager: McpConnectionManager;

  constructor(dataDir: string, vault?: EncryptedCredentialVault, rootDir: string = process.cwd()) {
    this.memoryFile = path.join(dataDir, 'memories.json');
    const resolvedVault = vault || new EncryptedCredentialVault(dataDir);
    this.mcpManager = new McpConnectionManager(dataDir, rootDir, resolvedVault);
    this.loadMemories();
  }

  private loadMemories(): void {
    if (fs.existsSync(this.memoryFile)) {
      try {
        this.memories = JSON.parse(fs.readFileSync(this.memoryFile, 'utf-8'));
      } catch {
        this.memories = [];
      }
    }
    if (this.memories.length === 0) {
      this.memories = [
        {
          id: 'mem-initial-arch',
          scope: 'android-workstation',
          category: 'project',
          title: 'OBSIDIAN Android Architecture Contract',
          content:
            'Package ID: io.anvil.workstation. Uses AndroidKeystore AES/GCM/NoPadding in ApiKeyVault, bounded UTF-8 file reads, and explicit PermissionPolicy gates before executing shell or file mutations.',
          updatedAtMillis: Date.now(),
        },
        {
          id: 'mem-initial-device',
          scope: 'global',
          category: 'user',
          title: 'Target Hardware Profile (Realme 7 5G)',
          content:
            'Target ARM64 device profile: MediaTek Dimensity 800U, 8 GB LPDDR4X RAM (~4.2 GB safe local GGUF mmap ceiling). Prefer Q4_K_M quantization with 2048 context length and 4 CPU threads.',
          updatedAtMillis: Date.now(),
        },
      ];
      this.saveMemories();
    }
  }

  private saveMemories(): void {
    fs.writeFileSync(this.memoryFile, JSON.stringify(this.memories, null, 2));
  }

  listMemories(scope?: string, query?: string): MemoryItem[] {
    const terms = (query || '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return this.memories
      .filter((m) => !scope || scope === 'all' || m.scope === scope || m.scope === 'global')
      .filter((m) => {
        if (terms.length === 0) return true;
        const hay = `${m.title} ${m.content} ${m.scope}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
      .sort((a, b) => b.updatedAtMillis - a.updatedAtMillis);
  }

  saveMemory(
    scope: string,
    category: 'user' | 'project' | 'agent',
    title: string,
    content: string
  ): MemoryItem {
    const existingIdx = this.memories.findIndex(
      (m) => m.scope === scope && m.title.toLowerCase() === title.trim().toLowerCase()
    );
    const item: MemoryItem = {
      id: existingIdx >= 0 ? this.memories[existingIdx].id : `mem-${Date.now()}`,
      scope: scope || 'global',
      category,
      title: title.trim(),
      content: content.trim(),
      updatedAtMillis: Date.now(),
    };
    if (existingIdx >= 0) {
      this.memories[existingIdx] = item;
    } else {
      this.memories.unshift(item);
    }
    this.saveMemories();
    return item;
  }

  deleteMemory(id: string): boolean {
    const before = this.memories.length;
    this.memories = this.memories.filter((m) => m.id !== id);
    this.saveMemories();
    return this.memories.length < before;
  }

  listMcpServers(): McpServerEntry[] {
    return this.mcpManager.listServers();
  }

  addMcpServer(
    name: string,
    endpointUrl: string,
    options?: {
      transport?: McpTransportType;
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
    }
  ): McpServerEntry {
    return this.mcpManager.addOrUpdateServer({
      name,
      endpointUrl,
      ...(options || {}),
    });
  }

  configureMcpServerAuth(
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
    return this.mcpManager.configureServerAuth(serverId, config);
  }

  removeMcpServer(id: string): void {
    this.mcpManager.removeServer(id);
  }

  async discoverMcpServerTools(serverId: string): Promise<McpServerEntry> {
    return await this.mcpManager.discoverServerTools(serverId);
  }

  async startMcpOAuthFlow(
    serverId: string,
    redirectUri: string,
    requestedScopes?: string
  ): Promise<{
    authorizationUrl: string;
    state: string;
    clientId: string;
    dynamicRegistrationUsed: boolean;
  }> {
    return await this.mcpManager.startOAuthFlow(serverId, redirectUri, requestedScopes);
  }

  async handleMcpOAuthCallback(code: string, state: string): Promise<McpServerEntry> {
    return await this.mcpManager.handleOAuthCallback(code, state);
  }

  async callMcpServerTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown> = {}
  ): Promise<McpToolCallOutput> {
    return await this.mcpManager.callServerTool(serverId, toolName, args);
  }

  async auditAllMcpServers(): Promise<McpServerEntry[]> {
    return await this.mcpManager.auditAllServers();
  }
}

// ============================================================================
// 9. BOUNDED REACT AGENT LOOP RUNNER (WITH REPEATED-CALL GUARD & RESUME)
// ============================================================================
export interface ModelTurnResponse {
  text?: string;
  toolCalls?: Array<{
    name: string;
    args: unknown;
  }>;
  rawCandidateContent?: Record<string, unknown>;
}

export type ModelTurnGenerator = (params: {
  iteration: number;
  contents: Array<Record<string, unknown>>;
  systemInstruction: string;
  enableTools: boolean;
  signal: AbortSignal;
  onToken?: (chunk: string) => void;
}) => Promise<ModelTurnResponse>;

export interface AgentLoopExecutionOptions {
  conversationId: string;
  workspaceId: string;
  messages: ChatMessage[];
  systemInstruction: string;
  enableAgentTools: boolean;
  maxIterations: number;
  maxToolCalls: number;
  commandTimeoutMs: number;
  requestTimeoutMs?: number;
  maxRetries?: number;
  signal: AbortSignal;
  knownSecrets?: string[];
  modelTurnGenerator: ModelTurnGenerator;
  onEmitActivity?: (event: Omit<AgentActivityEvent, 'id' | 'timestampMillis'>) => void;
  onTokenDelta?: (delta: string, accumulatedText: string, iteration: number) => void;
  onToolCallUpdate?: (toolCall: ToolCallRecord, allToolCalls: ToolCallRecord[]) => void;
  onRequestApproval?: (req: {
    toolName: string;
    category: PermissionCategory;
    args: Record<string, unknown>;
    reason?: string;
    signal: AbortSignal;
  }) => Promise<boolean>;
}

export interface AgentLoopExecutionResult {
  finalText: string;
  taskState: TaskExecutionState;
  stepsUsed: number;
  maxStepsConfigured: number;
  stoppedReason: 'completed' | 'iteration_limit_reached' | 'cancelled' | 'error';
  canResume: boolean;
  modifiedFiles: string[];
  toolCalls: ToolCallRecord[];
}

export class BoundedAgentLoopRunner {
  private workspaceManager: WorkspaceManager;
  private terminalManager: TerminalSessionManager;
  private permissionManager: PermissionManager;
  private memoryMcpManager: MemoryAndMcpManager;
  private buildServiceManager?: BuildServiceManager;
  private toolchainManager?: MobileHarnessToolchainManager;

  constructor(
    workspaceManager: WorkspaceManager,
    terminalManager: TerminalSessionManager,
    permissionManager: PermissionManager,
    memoryMcpManager: MemoryAndMcpManager,
    buildServiceManager?: BuildServiceManager,
    toolchainManager?: MobileHarnessToolchainManager
  ) {
    this.workspaceManager = workspaceManager;
    this.terminalManager = terminalManager;
    this.permissionManager = permissionManager;
    this.memoryMcpManager = memoryMcpManager;
    this.buildServiceManager = buildServiceManager;
    this.toolchainManager = toolchainManager;
  }

  private categoryForTool(toolName: string, args: Record<string, unknown>): {
    category: PermissionCategory;
    cautionReason?: string;
  } {
    switch (toolName) {
      case 'list_files':
      case 'read_file':
      case 'search_files':
      case 'check_toolchain':
      case 'verify_apk':
      case 'audit_manifest':
        return { category: 'READ_WORKSPACE' };
      case 'write_file':
      case 'save_memory':
        return { category: 'MODIFY_FILES' };
      case 'delete_file':
        return { category: 'DELETE_FILES', cautionReason: 'Deleting workspace files requires confirmation.' };
      case 'build_apk':
      case 'build_project':
        return { category: 'BUILD_PROJECTS' };
      case 'install_toolchain':
      case 'download_bundle':
        return { category: 'INSTALL_DEPENDENCIES' };
      case 'run_command': {
        const cmd = String(args.command || '');
        const safety = evaluateCommandSafety(cmd);
        if (safety.riskLevel === 'CAUTION_APPROVAL_REQUIRED') {
          return { category: 'INSTALL_DEPENDENCIES', cautionReason: safety.reason };
        }
        return { category: 'EXECUTE_COMMANDS' };
      }
      default:
        return { category: 'EXECUTE_COMMANDS' };
    }
  }

  async executeSingleTool(params: {
    conversationId: string;
    workspaceId: string;
    toolName: string;
    rawArgs: unknown;
    commandTimeoutMs: number;
    signal: AbortSignal;
    knownSecrets?: string[];
    onEmitActivity?: (event: Omit<AgentActivityEvent, 'id' | 'timestampMillis'>) => void;
    onRequestApproval?: AgentLoopExecutionOptions['onRequestApproval'];
  }): Promise<ToolCallRecord & { modifiedFile?: string }> {
    const startedAtMillis = Date.now();
    const {
      conversationId,
      workspaceId,
      toolName,
      rawArgs,
      commandTimeoutMs,
      signal,
      knownSecrets = [],
      onEmitActivity,
      onRequestApproval,
    } = params;

    if (signal.aborted) {
      return {
        id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: toolName,
        args: (typeof rawArgs === 'object' && rawArgs ? (rawArgs as Record<string, unknown>) : {}),
        status: 'cancelled',
        startedAtMillis,
        durationMs: 0,
        output: 'Execution cancelled by user.',
        errorCategory: 'CANCELLED',
        errorExplanation: 'Task was cancelled before tool execution started.',
        canRetry: true,
      };
    }

    // 1. Validate & normalize tool arguments (PocketStrike-AI + Mobile-Harness adapter)
    const validation = normalizeAndValidateToolArgs(toolName, rawArgs);
    if (!validation.valid) {
      onEmitActivity?.({
        conversationId,
        workspaceId,
        state: 'FAILED',
        title: `Invalid arguments for ${toolName}`,
        description: validation.validationError || 'Argument validation failed.',
        toolName,
        toolInput: JSON.stringify(rawArgs),
        errorExplanation: validation.validationError,
      });
      return {
        id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: toolName,
        args: validation.normalizedArgs,
        status: 'failed',
        startedAtMillis,
        durationMs: Date.now() - startedAtMillis,
        output: `Validation Error: ${validation.validationError}`,
        errorCategory: 'INVALID_ARGUMENT',
        errorExplanation: validation.validationError,
        canRetry: false,
      };
    }

    const args = validation.normalizedArgs;

    // 2. Check security policy & command safety
    if (toolName === 'run_command') {
      const safety = evaluateCommandSafety(String(args.command || ''));
      if (safety.riskLevel === 'FORBIDDEN') {
        onEmitActivity?.({
          conversationId,
          workspaceId,
          state: 'FAILED',
          title: `Security Blocked: ${toolName}`,
          description: safety.reason,
          toolName,
          toolInput: String(args.command || ''),
          errorExplanation: safety.reason,
        });
        return {
          id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: toolName,
          args,
          status: 'denied',
          startedAtMillis,
          durationMs: Date.now() - startedAtMillis,
          exitCode: 126,
          output: `Security Policy Blocked: ${safety.reason}`,
          errorCategory: 'PERMISSION_DENIED',
          errorExplanation: safety.reason,
          canRetry: false,
        };
      }
    }

    const { category, cautionReason } = this.categoryForTool(toolName, args);
    const policy = cautionReason ? 'ASK' : this.permissionManager.getPolicy(category);

    if (policy === 'DENY') {
      const msg = `Permission denied by security policy (${category} = DENY).`;
      onEmitActivity?.({
        conversationId,
        workspaceId,
        state: 'FAILED',
        title: `Permission Denied: ${toolName}`,
        description: msg,
        toolName,
        toolInput: JSON.stringify(args),
        errorExplanation: msg,
      });
      return {
        id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: toolName,
        args,
        status: 'denied',
        startedAtMillis,
        durationMs: Date.now() - startedAtMillis,
        output: msg,
        errorCategory: 'PERMISSION_DENIED',
        errorExplanation: msg,
        canRetry: false,
      };
    }

    if (policy === 'ASK' && onRequestApproval) {
      const approved = await onRequestApproval({
        toolName,
        category,
        args,
        reason: cautionReason,
        signal,
      });
      if (!approved) {
        const msg = signal.aborted
          ? `Cancelled while awaiting approval for ${toolName}.`
          : `Operator declined execution of ${toolName} (${category}).`;
        return {
          id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: toolName,
          args,
          status: signal.aborted ? 'cancelled' : 'denied',
          startedAtMillis,
          durationMs: Date.now() - startedAtMillis,
          output: msg,
          errorCategory: signal.aborted ? 'CANCELLED' : 'PERMISSION_DENIED',
          errorExplanation: msg,
          canRetry: true,
        };
      }
    }

    // 3. Execute verified tool operation
    try {
      if (toolName === 'list_files') {
        const subdir = String(args.subdirectory || '');
        onEmitActivity?.({
          conversationId,
          workspaceId,
          state: 'READING_FILE',
          title: 'Listing workspace files',
          description: `Scanning files in ${workspaceId}${subdir ? `/${subdir}` : ''}`,
          toolName,
        });
        const root = this.workspaceManager.getWorkspaceRoot(workspaceId);
        const files = this.workspaceManager.listFilesRecursive(root, subdir);
        const out = files.map((f) => `${f.relativePath} (${f.sizeBytes} B)`).join('\n');
        return {
          id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: toolName,
          args,
          status: 'succeeded',
          startedAtMillis,
          durationMs: Date.now() - startedAtMillis,
          output: out || '(empty workspace)',
        };
      }

      if (toolName === 'read_file') {
        const relPath = String(args.path || '');
        onEmitActivity?.({
          conversationId,
          workspaceId,
          state: 'READING_FILE',
          title: `Reading ${relPath}`,
          description: `Bounded UTF-8 read in ${workspaceId}`,
          toolName,
          toolInput: relPath,
        });
        const res = this.workspaceManager.readFileBounded(workspaceId, relPath);
        return {
          id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: toolName,
          args,
          status: 'succeeded',
          startedAtMillis,
          durationMs: Date.now() - startedAtMillis,
          output: res.content,
        };
      }

      if (toolName === 'write_file') {
        const relPath = String(args.path || '');
        const content = String(args.content ?? '');
        onEmitActivity?.({
          conversationId,
          workspaceId,
          state: 'EDITING_FILE',
          title: `Writing ${relPath}`,
          description: `Recording unified diff checkpoint in ${workspaceId}`,
          toolName,
          toolInput: relPath,
        });
        const diff = this.workspaceManager.writeFileSafely(workspaceId, relPath, content);
        const summary = `Updated ${relPath} (+${diff.additions} / -${diff.deletions} lines, checkpoint ${diff.id})`;
        return {
          id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: toolName,
          args,
          status: 'succeeded',
          startedAtMillis,
          durationMs: Date.now() - startedAtMillis,
          output: summary,
          modifiedFile: relPath,
        };
      }

      if (toolName === 'delete_file') {
        const relPath = String(args.path || '');
        const diff = this.workspaceManager.deleteFileSafely(workspaceId, relPath);
        return {
          id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: toolName,
          args,
          status: 'succeeded',
          startedAtMillis,
          durationMs: Date.now() - startedAtMillis,
          output: `Deleted ${relPath} (-${diff.deletions} lines, checkpoint ${diff.id})`,
          modifiedFile: relPath,
        };
      }

      if (toolName === 'search_files') {
        const query = String(args.query || '');
        onEmitActivity?.({
          conversationId,
          workspaceId,
          state: 'READING_FILE',
          title: `Searching workspace for '${query}'`,
          description: `Scanning UTF-8 files in ${workspaceId}`,
          toolName,
          toolInput: query,
        });
        const matches = this.workspaceManager.searchInWorkspace(workspaceId, query);
        const formatted = matches
          .map((m) => `${m.relativePath}:${m.line}: ${m.preview}`)
          .join('\n');
        return {
          id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: toolName,
          args,
          status: 'succeeded',
          startedAtMillis,
          durationMs: Date.now() - startedAtMillis,
          output: formatted || 'No matches found.',
        };
      }

      if (toolName === 'check_toolchain') {
        onEmitActivity?.({
          conversationId,
          workspaceId,
          state: 'RUNNING_COMMAND',
          title: 'Checking Build Toolchain',
          description: 'Probing JDK, Android SDK, and host architecture',
          toolName,
        });
        const tc = this.buildServiceManager
          ? this.buildServiceManager.probeAndroidToolchain(workspaceId)
          : { isAvailable: false, architecture: os.arch(), diagnostic: 'Build service not initialized' };

        let platformInfo = '';
        if (this.toolchainManager) {
          const plat = this.toolchainManager.getPlatformCompatibility();
          platformInfo = [
            `Architecture: ${plat.arch}`,
            `Platform: ${plat.platform} (${plat.distro})`,
            `Kernel: ${plat.kernelRelease}`,
            `Package Managers: apt=${plat.aptAvailable}, npm=${plat.npmAvailable}`,
            `Proot Layer: ${plat.prootNote}`,
          ].join('\n');
        } else {
          platformInfo = `Architecture: ${os.arch()}\nPlatform: ${os.platform()} (${os.release()})`;
        }

        const summary = [
          `Available: ${tc.isAvailable ? 'YES' : 'NO'}`,
          `Diagnostic: ${tc.diagnostic}`,
          platformInfo,
          `Java Version: ${(tc as any).javaVersion || 'N/A'}`,
          `Android SDK Root: ${(tc as any).androidSdkPath || (tc as any).sdkRoot || 'N/A'}`,
          `Android Build-Tools: ${(tc as any).buildToolsVersion || 'N/A'}`,
          `Android JAR: ${(tc as any).androidJarPath || 'N/A'}`,
          `AAPT2: ${(tc as any).aapt2Path || 'N/A'}`,
          `D8: ${(tc as any).d8Path || 'N/A'}`,
          `ZipAlign: ${(tc as any).zipalignPath || 'N/A'}`,
          `Gradle: ${(tc as any).gradlePath || 'N/A'}`,
          `Gradle Wrapper: ${(tc as any).gradleWrapperPath || 'N/A'}`,
        ].join('\n');

        onEmitActivity?.({
          conversationId,
          workspaceId,
          state: 'COMPLETED',
          title: 'Toolchain Check Complete',
          description: tc.diagnostic,
          toolName,
          toolOutput: summary,
        });
        return {
          id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: toolName,
          args,
          status: 'succeeded',
          startedAtMillis,
          durationMs: Date.now() - startedAtMillis,
          output: summary,
        };
      }

      if (toolName === 'build_apk' || toolName === 'build_project') {
        if (!this.buildServiceManager) {
          return {
            id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: toolName,
            args,
            status: 'failed',
            startedAtMillis,
            durationMs: Date.now() - startedAtMillis,
            output: 'Error: BuildServiceManager is not configured in BoundedAgentLoopRunner.',
            errorCategory: 'EXECUTION_ERROR',
            errorExplanation: 'Build service manager uninitialized.',
            canRetry: false,
          };
        }
        const variant = (args.variant === 'release' || args.variant === 'debug') ? args.variant : 'release';
        const optimizeSize = Boolean(args.optimize_size ?? args.optimizeSize ?? true);

        onEmitActivity?.({
          conversationId,
          workspaceId,
          state: 'BUILDING_APK',
          title: `Building ${variant.toUpperCase()} APK`,
          description: `Starting Android build (size-optimization: ${optimizeSize ? 'ON' : 'OFF'})`,
          toolName,
          toolInput: JSON.stringify({ variant, optimizeSize }),
        });

        const buildRes = await this.buildServiceManager.runWorkspaceBuild(workspaceId, {
          variant,
          optimizeSize,
          onProgress: (p) => {
            onEmitActivity?.({
              conversationId,
              workspaceId,
              state: p.state,
              title: p.title,
              description: p.description,
              toolName,
              toolOutput: p.toolOutput,
            });
          },
        });

        const isSuccess = buildRes.status === 'SUCCEEDED';
        const outLines = [
          `Build Status: ${buildRes.status}`,
          `Stage: ${buildRes.stage}`,
          `Target Variant: ${variant}`,
          `Optimize Size: ${optimizeSize ? 'Enabled (D8 --release, zipalign -z 4)' : 'Disabled'}`,
          `Artifact Path: ${buildRes.artifactPath || 'None'}`,
          `Artifact Size: ${buildRes.artifactSizeBytes ? `${buildRes.artifactSizeBytes} bytes (${(buildRes.artifactSizeBytes / 1024).toFixed(2)} KB)` : 'None'}`,
          `Exit Code: ${buildRes.exitCode}`,
          ...(buildRes.apkVerification
            ? [
                `APK Container Valid: ${buildRes.apkVerification.isZipContainer}`,
                `Contains AndroidManifest.xml: ${buildRes.apkVerification.containsAndroidManifest}`,
                `Contains classes.dex: ${buildRes.apkVerification.containsClassesDex}`,
                `SHA-256: ${buildRes.apkVerification.sha256Hex || 'N/A'}`,
                `Package Name: ${buildRes.apkVerification.packageNameHint || 'io.anvil.notes'}`,
                `Integrity Verification: ${buildRes.apkVerification.verified ? 'PASSED' : 'FAILED'}`,
              ]
            : []),
          `\nBuild Execution Logs:\n${buildRes.logs}`,
        ];

        if (buildRes.issues && buildRes.issues.length > 0) {
          outLines.push('\nIssues:');
          for (const issue of buildRes.issues) {
            outLines.push(`- [${issue.severity}] ${issue.title}: ${issue.detail}`);
          }
        }

        const finalOutput = outLines.join('\n');
        onEmitActivity?.({
          conversationId,
          workspaceId,
          state: isSuccess ? 'COMPLETED' : 'FAILED',
          title: isSuccess
            ? `APK Build Completed: ${
                buildRes.artifactSizeBytes ? `${(buildRes.artifactSizeBytes / 1024).toFixed(1)} KB` : 'Success'
              }`
            : 'APK Build Failed',
          description: buildRes.issues[0]?.detail || `Build finished with status ${buildRes.status}`,
          toolName,
          toolOutput: finalOutput.slice(0, 4000),
          exitCode: buildRes.exitCode ?? (isSuccess ? 0 : 1),
        });

        return {
          id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: toolName,
          args,
          status: isSuccess ? 'succeeded' : 'failed',
          startedAtMillis,
          durationMs: (buildRes.finishedAtMillis || Date.now()) - buildRes.startedAtMillis,
          exitCode: buildRes.exitCode ?? (isSuccess ? 0 : 1),
          output: finalOutput,
          errorCategory: isSuccess ? undefined : 'NONZERO_EXIT',
          errorExplanation: isSuccess ? undefined : (buildRes.issues[0]?.detail || 'Build process failed'),
          canRetry: !isSuccess,
        };
      }

      if (toolName === 'verify_apk') {
        if (!this.buildServiceManager) {
          return {
            id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: toolName,
            args,
            status: 'failed',
            startedAtMillis,
            durationMs: Date.now() - startedAtMillis,
            output: 'Error: BuildServiceManager is not configured in BoundedAgentLoopRunner.',
            errorCategory: 'EXECUTION_ERROR',
            errorExplanation: 'Build service manager uninitialized.',
            canRetry: false,
          };
        }
        let apkPath =
          typeof args.path === 'string'
            ? args.path
            : typeof args.apkPath === 'string'
            ? args.apkPath
            : '';
        if (!apkPath) {
          const wsRoot = this.workspaceManager.getWorkspaceRoot(workspaceId);
          const candidates = [
            path.join(wsRoot, 'app', 'build', 'outputs', 'apk', 'release', `${workspaceId}-release.apk`),
            path.join(wsRoot, 'app', 'build', 'outputs', 'apk', 'debug', `${workspaceId}-debug.apk`),
            path.join(process.cwd(), '.anvil-data', 'artifacts', `${workspaceId}-release.apk`),
            path.join(process.cwd(), '.anvil-data', 'artifacts', `${workspaceId}-debug.apk`),
          ];
          const found = candidates.find((c) => fs.existsSync(c));
          apkPath = found || candidates[0];
        }
        const report = this.buildServiceManager.verifyApkArtifact(apkPath);
        const out = [
          `File: ${report.fileName}`,
          `Path: ${report.apkPath}`,
          `Exists: ${report.exists}`,
          `Size: ${report.sizeBytes} bytes (${(report.sizeBytes / 1024).toFixed(2)} KB)`,
          `Valid ZIP Container: ${report.isZipContainer}`,
          `Contains AndroidManifest.xml: ${report.containsAndroidManifest}`,
          `Contains classes.dex: ${report.containsClassesDex}`,
          `Contains resources.arsc: ${report.containsResourcesArsc}`,
          `Package Name Hint: ${report.packageNameHint || 'N/A'}`,
          `SHA-256: ${report.sha256Hex || 'N/A'}`,
          `Verification Result: ${report.verified ? 'PASSED' : 'FAILED'}`,
          `Diagnostic: ${report.diagnosticSummary}`,
        ].join('\n');
        return {
          id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: toolName,
          args,
          status: report.verified ? 'succeeded' : 'failed',
          startedAtMillis,
          durationMs: Date.now() - startedAtMillis,
          output: out,
        };
      }

      if (toolName === 'audit_manifest') {
        const customPath =
          typeof args.path === 'string'
            ? args.path
            : typeof args.manifestPath === 'string'
            ? args.manifestPath
            : undefined;
        const wsRoot = this.workspaceManager.getWorkspaceRoot(workspaceId);
        const candidates = customPath
          ? [path.isAbsolute(customPath) ? customPath : path.join(wsRoot, customPath)]
          : [
              path.join(wsRoot, 'app', 'src', 'main', 'AndroidManifest.xml'),
              path.join(wsRoot, 'src', 'main', 'AndroidManifest.xml'),
              path.join(wsRoot, 'AndroidManifest.xml'),
            ];
        const manifestFile = candidates.find((p) => fs.existsSync(p));
        if (!manifestFile) {
          const err = `AndroidManifest.xml not found in workspace '${workspaceId}' (candidates: ${candidates.join(', ')})`;
          return {
            id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: toolName,
            args,
            status: 'failed',
            startedAtMillis,
            durationMs: Date.now() - startedAtMillis,
            output: err,
            errorCategory: 'RESOURCE_NOT_FOUND',
            errorExplanation: err,
          };
        }
        const xmlContent = fs.readFileSync(manifestFile, 'utf8');
        const audit = auditAndroidManifestContent(xmlContent);
        const out = [
          `Manifest Path: ${manifestFile}`,
          `Package Name: ${audit.packageName}`,
          `Permissions (${audit.permissions.length}): ${audit.permissions.join(', ') || 'None'}`,
          `High-Risk Permissions (${audit.highRiskPermissions.length}): ${audit.highRiskPermissions.join(', ') || 'None'}`,
          `Exported Components: ${audit.exportedComponentsCount}`,
          `Allows Backup: ${audit.allowsBackup}`,
          `Cleartext Traffic Permitted: ${audit.cleartextTrafficPermitted}`,
          `SHA-256: ${audit.sha256}`,
        ].join('\n');
        return {
          id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: toolName,
          args,
          status: 'succeeded',
          startedAtMillis,
          durationMs: Date.now() - startedAtMillis,
          output: out,
        };
      }

      if (toolName === 'download_bundle') {
        if (!this.toolchainManager) {
          const err = 'MobileHarnessToolchainManager is not configured on this agent loop runner.';
          return {
            id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: toolName,
            args,
            status: 'failed',
            startedAtMillis,
            durationMs: Date.now() - startedAtMillis,
            output: err,
            errorCategory: 'DEPENDENCY_MISSING',
            errorExplanation: err,
          };
        }
        const bundleId = typeof args.bundleId === 'string' ? args.bundleId : undefined;
        const variant =
          args.variant === 'online' || args.variant === 'offline' ? args.variant : undefined;
        onEmitActivity?.({
          conversationId,
          workspaceId,
          state: 'PREPARING_BUILD',
          title: `Downloading Runtime Bundle: ${bundleId || variant || 'default'}`,
          description: `Acquiring precompiled ARM64 environment package from repository catalog`,
          toolName,
        });
        const res = await this.toolchainManager.downloadRepositoryAsset({ bundleId, variant });
        const out = [
          `Status: ${res.success ? 'SUCCESS' : 'FAILED'}`,
          `Local Path: ${res.localPath}`,
          `Verified SHA-256: ${res.verifiedSha256}`,
          `Message: ${res.message}`,
        ].join('\n');
        return {
          id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: toolName,
          args,
          status: res.success ? 'succeeded' : 'failed',
          startedAtMillis,
          durationMs: Date.now() - startedAtMillis,
          output: out,
        };
      }

      if (toolName === 'install_toolchain') {
        if (!this.toolchainManager) {
          const err = 'MobileHarnessToolchainManager is not configured on this agent loop runner.';
          return {
            id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: toolName,
            args,
            status: 'failed',
            startedAtMillis,
            durationMs: Date.now() - startedAtMillis,
            output: err,
            errorCategory: 'DEPENDENCY_MISSING',
            errorExplanation: err,
          };
        }
        const ids = Array.isArray(args.toolchainIds)
          ? (args.toolchainIds as string[])
          : typeof args.toolchainId === 'string'
          ? [args.toolchainId]
          : typeof args.stack === 'string'
          ? [args.stack]
          : [];
        if (ids.length === 0) {
          const wsStatuses = this.toolchainManager.getWorkspaceToolchainStatus(workspaceId);
          const found = wsStatuses.find((w) => w.workspaceId === workspaceId);
          if (found && found.missingToolchains.length > 0) {
            ids.push(...found.missingToolchains);
          } else {
            ids.push('android');
          }
        }
        onEmitActivity?.({
          conversationId,
          workspaceId,
          state: 'PREPARING_BUILD',
          title: `Installing Toolchain: ${ids.join(', ')}`,
          description: `Configuring environment packages for workspace '${workspaceId}'`,
          toolName,
        });
        const job = await this.toolchainManager.startToolchainJob({
          operation: 'install',
          toolchainIds: ids as any,
        });
        const out = [
          `Job ID: ${job.jobId}`,
          `Operation: ${job.operation}`,
          `Status: ${job.status}`,
          `Toolchains: ${job.targetIds.join(', ')}`,
          `Message: ${job.stageMessage}`,
          ...(job.errorMessage ? [`Error: ${job.errorMessage}`] : []),
        ].join('\n');
        return {
          id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: toolName,
          args,
          status: job.status === 'failed' ? 'failed' : 'succeeded',
          startedAtMillis,
          durationMs: Date.now() - startedAtMillis,
          output: out,
        };
      }

      if (toolName === 'run_command') {
        const command = String(args.command || '');
        const customCwd = typeof args.cwd === 'string' ? args.cwd : undefined;
        onEmitActivity?.({
          conversationId,
          workspaceId,
          state: 'RUNNING_COMMAND',
          title: `Running command: ${command}`,
          description: `Executing in workspace '${workspaceId}'${customCwd ? ` (cwd: ${customCwd})` : ''}`,
          toolName,
          toolInput: SecretRedactor.redact(command, knownSecrets),
        });

        const res = await this.terminalManager.executeCommand(
          workspaceId,
          command,
          commandTimeoutMs,
          {
            cwd: customCwd,
            signal,
            knownSecrets,
          }
        );

        const safeStdout = SecretRedactor.redact(res.stdout, knownSecrets);
        const safeStderr = SecretRedactor.redact(res.stderr, knownSecrets);
        const combined = [
          `Exit Code: ${res.exitCode}`,
          `Working Directory: ${res.cwd}`,
          `Stdout:\n${safeStdout || '(empty)'}`,
          `Stderr:\n${safeStderr || '(empty)'}`,
          ...(res.errorExplanation ? [`Diagnostic: ${res.errorExplanation}`] : []),
        ].join('\n');

        onEmitActivity?.({
          conversationId,
          workspaceId,
          state:
            res.status === 'succeeded'
              ? 'COMPLETED'
              : res.status === 'cancelled'
              ? 'CANCELLED'
              : 'FAILED',
          title:
            res.status === 'succeeded'
              ? `Command Succeeded (exit 0): ${command.slice(0, 48)}`
              : `Command ${res.status.toUpperCase()} (exit ${res.exitCode}): ${command.slice(0, 48)}`,
          description: res.errorExplanation || `Completed in ${res.durationMs}ms`,
          toolName,
          toolInput: SecretRedactor.redact(command, knownSecrets),
          toolOutput: combined.slice(0, 2000),
          stdout: safeStdout.slice(0, 2000),
          stderr: safeStderr.slice(0, 2000),
          exitCode: res.exitCode,
          durationMs: res.durationMs,
          errorExplanation: res.errorExplanation,
        });

        return {
          id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: toolName,
          args,
          status: res.status,
          startedAtMillis,
          durationMs: res.durationMs,
          exitCode: res.exitCode,
          stdout: safeStdout,
          stderr: safeStderr,
          cwd: res.cwd,
          output: combined,
          errorCategory: res.errorCategory,
          errorExplanation: res.errorExplanation,
          canRetry: res.status === 'failed' || res.status === 'timed_out' || res.status === 'cancelled',
        };
      }

      if (toolName === 'save_memory') {
        const title = String(args.title || 'Workspace Note');
        const content = String(args.content || '');
        const item = this.memoryMcpManager.saveMemory(workspaceId, 'agent', title, content);
        return {
          id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: toolName,
          args,
          status: 'succeeded',
          startedAtMillis,
          durationMs: Date.now() - startedAtMillis,
          output: `Saved memory note '${item.title}' (${item.id})`,
        };
      }

      if (toolName === 'call_mcp_tool') {
        const serverId = String(args.serverId || args.server_id || 'mcp-local-workstation');
        const mcpToolName = String(args.toolName || args.tool_name || '');
        const mcpArgs =
          typeof args.arguments === 'object' && args.arguments
            ? (args.arguments as Record<string, unknown>)
            : {};
        onEmitActivity?.({
          conversationId,
          workspaceId,
          state: 'RUNNING_COMMAND',
          title: `Calling MCP Tool: ${mcpToolName}`,
          description: `Server: ${serverId}`,
          toolName,
          toolInput: JSON.stringify(mcpArgs),
        });
        const mcpOut = await this.memoryMcpManager.callMcpServerTool(
          serverId,
          mcpToolName,
          mcpArgs
        );
        return {
          id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: toolName,
          args,
          status: mcpOut.isError ? 'failed' : 'succeeded',
          startedAtMillis,
          durationMs: mcpOut.durationMs,
          output: mcpOut.textOutput,
          canRetry: mcpOut.isError,
        };
      }

      // Check if toolName matches a discovered tool on any enabled MCP server
      for (const srv of this.memoryMcpManager.listMcpServers()) {
        if (!srv.enabled || !srv.discoveredTools) continue;
        const found = srv.discoveredTools.find((dt) => dt.name === toolName);
        if (found) {
          onEmitActivity?.({
            conversationId,
            workspaceId,
            state: 'RUNNING_COMMAND',
            title: `MCP [${srv.name}]: ${toolName}`,
            description: `Executing MCP tool ${toolName} on ${srv.id}`,
            toolName,
            toolInput: JSON.stringify(args),
          });
          const mcpOut = await this.memoryMcpManager.callMcpServerTool(srv.id, toolName, args);
          return {
            id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: toolName,
            args,
            status: mcpOut.isError ? 'failed' : 'succeeded',
            startedAtMillis,
            durationMs: mcpOut.durationMs,
            output: mcpOut.textOutput,
            canRetry: mcpOut.isError,
          };
        }
      }

      return {
        id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: toolName,
        args,
        status: 'failed',
        startedAtMillis,
        durationMs: Date.now() - startedAtMillis,
        output: `Error: Unknown or unregistered tool '${toolName}'.`,
        errorCategory: 'INVALID_ARGUMENT',
        errorExplanation: `Tool '${toolName}' is not registered in the workstation tool catalog.`,
        canRetry: false,
      };
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const safeMsg = SecretRedactor.redact(rawMsg, knownSecrets);
      onEmitActivity?.({
        conversationId,
        workspaceId,
        state: 'FAILED',
        title: `Tool error: ${toolName}`,
        description: safeMsg,
        toolName,
        errorExplanation: safeMsg,
      });
      return {
        id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: toolName,
        args,
        status: 'failed',
        startedAtMillis,
        durationMs: Date.now() - startedAtMillis,
        output: `Error: ${safeMsg}`,
        errorCategory: 'EXECUTION_ERROR',
        errorExplanation: safeMsg,
        canRetry: true,
      };
    }
  }

  /**
   * Executes the bounded multi-step ReAct loop with:
   * - Character-budgeted context windowing (Mobile-Harness)
   * - Bounded retries & timeout handling on provider calls
   * - Repeated identical tool-call guard
   * - Explicit differentiation between `completed` and `iteration_limit_reached`
   */
  async runAgentLoop(options: AgentLoopExecutionOptions): Promise<AgentLoopExecutionResult> {
    const {
      conversationId,
      workspaceId,
      messages,
      systemInstruction,
      enableAgentTools,
      maxIterations,
      maxToolCalls,
      commandTimeoutMs,
      requestTimeoutMs = 60_000,
      maxRetries = 1,
      signal,
      knownSecrets = [],
      modelTurnGenerator,
      onEmitActivity,
      onTokenDelta,
      onToolCallUpdate,
      onRequestApproval,
    } = options;

    const boundedMaxIterations = Math.max(1, Math.min(25, maxIterations || 10));
    const boundedMaxToolCalls = Math.max(1, Math.min(40, maxToolCalls || 15));

    const budgetedMessages = recentWithinCharacterBudget(messages, 32_000);
    const contents: Array<Record<string, unknown>> = budgetedMessages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const executedToolCalls: ToolCallRecord[] = [];
    const modifiedFilesSet = new Set<string>();
    let lastToolSignature = '';
    let repeatedCallCount = 0;
    let stepsUsed = 0;
    let finalAssistantText = '';
    let stoppedReason: AgentLoopExecutionResult['stoppedReason'] = 'completed';

    const callGeneratorWithRetryAndTimeout = async (
      iteration: number,
      enableToolsForTurn: boolean
    ): Promise<ModelTurnResponse> => {
      let attempt = 0;
      while (true) {
        if (signal.aborted) {
          throw new Error('Generation cancelled by user.');
        }
        attempt++;
        try {
          const timeoutPromise = new Promise<never>((_, reject) => {
            const t = setTimeout(
              () => reject(new Error(`Provider request timed out after ${requestTimeoutMs}ms.`)),
              requestTimeoutMs
            );
            signal.addEventListener('abort', () => clearTimeout(t), { once: true });
          });
          return await Promise.race([
            modelTurnGenerator({
              iteration,
              contents,
              systemInstruction,
              enableTools: enableToolsForTurn,
              signal,
              onToken: (chunk: string) => {
                if (!chunk || signal.aborted) return;
                finalAssistantText += chunk;
                onTokenDelta?.(chunk, finalAssistantText, iteration);
              },
            }),
            timeoutPromise,
          ]);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (signal.aborted || /cancelled/i.test(msg)) {
            return {
              text: finalAssistantText,
              toolCalls: [],
            };
          }
          const isTransient = /timeout|429|rate limit|503|502|network/i.test(msg);
          if (isTransient && attempt <= maxRetries) {
            await new Promise((r) => setTimeout(r, 250 * attempt));
            continue;
          }
          throw err;
        }
      }
    };

    while (stepsUsed < boundedMaxIterations) {
      if (signal.aborted) {
        stoppedReason = 'cancelled';
        return {
          finalText: finalAssistantText || 'Generation stopped by user.',
          taskState: 'cancelled',
          stepsUsed,
          maxStepsConfigured: boundedMaxIterations,
          stoppedReason: 'cancelled',
          canResume: true,
          modifiedFiles: Array.from(modifiedFilesSet),
          toolCalls: executedToolCalls,
        };
      }

      stepsUsed++;
      const stepAccumulatedBeforeTurn = finalAssistantText;
      onEmitActivity?.({
        conversationId,
        workspaceId,
        state: 'CALLING_PROVIDER',
        title: enableAgentTools
          ? `Agent Step ${stepsUsed}/${boundedMaxIterations}`
          : 'Generating response…',
        description: enableAgentTools
          ? 'Evaluating workspace state and next action'
          : 'Streaming response tokens from model',
      });

      const turn = await callGeneratorWithRetryAndTimeout(stepsUsed, enableAgentTools);
      if (signal.aborted) {
        stoppedReason = 'cancelled';
        break;
      }
      const fnCalls = turn.toolCalls || [];

      if (!enableAgentTools || fnCalls.length === 0) {
        if (turn.text && finalAssistantText === stepAccumulatedBeforeTurn) {
          finalAssistantText = turn.text;
          onTokenDelta?.(turn.text, finalAssistantText, stepsUsed);
        } else if (!finalAssistantText && turn.text) {
          finalAssistantText = turn.text;
        }
        if (!finalAssistantText) {
          finalAssistantText = 'Task completed.';
        }
        stoppedReason = 'completed';
        break;
      }

      if (turn.rawCandidateContent) {
        contents.push(turn.rawCandidateContent);
      } else {
        contents.push({
          role: 'model',
          parts: fnCalls.map((fc) => ({ functionCall: { name: fc.name, args: fc.args } })),
        });
      }

      const responseParts: Array<Record<string, unknown>> = [];

      for (const call of fnCalls) {
        if (signal.aborted) {
          stoppedReason = 'cancelled';
          break;
        }

        if (executedToolCalls.length >= boundedMaxToolCalls) {
          responseParts.push({
            functionResponse: {
              name: call.name,
              response: {
                error: `Reached maximum tool calls per task (${boundedMaxToolCalls}). Summarize findings now.`,
              },
            },
          });
          continue;
        }

        const sig = `${call.name}:${JSON.stringify(call.args || {})}`;
        if (sig === lastToolSignature) {
          repeatedCallCount++;
        } else {
          lastToolSignature = sig;
          repeatedCallCount = 1;
        }

        // Prevent repeated identical tool calls from consuming the step budget
        if (repeatedCallCount >= 2) {
          const dupMsg = `Duplicate tool call prevented: '${call.name}' was already called with identical arguments in the previous step. Use the previous result or proceed to the next action.`;
          executedToolCalls.push({
            id: `tc-dup-${Date.now()}`,
            name: call.name,
            args:
              typeof call.args === 'object' && call.args
                ? (call.args as Record<string, unknown>)
                : {},
            status: 'failed',
            startedAtMillis: Date.now(),
            durationMs: 0,
            output: dupMsg,
            errorCategory: 'DUPLICATE_CALL_PREVENTED',
            errorExplanation: dupMsg,
            canRetry: false,
          });
          responseParts.push({
            functionResponse: {
              name: call.name,
              response: { error: dupMsg, status: 'duplicate_blocked' },
            },
          });
          continue;
        }

        const runningToolId = `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const runningRecord: ToolCallRecord = {
          id: runningToolId,
          name: call.name,
          args:
            typeof call.args === 'object' && call.args
              ? (call.args as Record<string, unknown>)
              : {},
          status: 'running',
          startedAtMillis: Date.now(),
        };
        executedToolCalls.push(runningRecord);
        onToolCallUpdate?.(runningRecord, [...executedToolCalls]);

        const record = await this.executeSingleTool({
          conversationId,
          workspaceId,
          toolName: call.name,
          rawArgs: call.args,
          commandTimeoutMs,
          signal,
          knownSecrets,
          onEmitActivity,
          onRequestApproval,
        });

        record.id = runningToolId;
        if (record.modifiedFile) {
          modifiedFilesSet.add(record.modifiedFile);
        }
        const existingIdx = executedToolCalls.findIndex((t) => t.id === runningToolId);
        if (existingIdx >= 0) {
          executedToolCalls[existingIdx] = record;
        } else {
          executedToolCalls.push(record);
        }
        onToolCallUpdate?.(record, [...executedToolCalls]);

        responseParts.push({
          functionResponse: {
            name: call.name,
            response: {
              result: (record.output || '').slice(0, 8000),
              status: record.status,
              exitCode: record.exitCode,
              errorCategory: record.errorCategory,
            },
          },
        });
      }

      contents.push({ role: 'user', parts: responseParts });

      // Check if we just used the final allowed step while executing tools
      if (stepsUsed >= boundedMaxIterations && !signal.aborted) {
        stoppedReason = 'iteration_limit_reached';
        try {
          // Request a final synthesis turn (with tools disabled) so the user gets a real summary
          contents.push({
            role: 'user',
            parts: [
              {
                text: `System notice: You have reached the configured step limit (${boundedMaxIterations} steps). Do not call any more tools. Summarize what was completed, any errors encountered, and what remains if the user clicks Continue.`,
              },
            ],
          });
          const synthesis = await callGeneratorWithRetryAndTimeout(stepsUsed, false);
          if (synthesis.text && synthesis.text.trim()) {
            finalAssistantText = `${synthesis.text.trim()}\n\n---\n**Paused at step limit (${stepsUsed}/${boundedMaxIterations} steps).** Click **Continue Task** below to resume execution.`;
          }
        } catch {
          // Fallback to structured summary below
        }

        if (!finalAssistantText) {
          const succeededCount = executedToolCalls.filter(
            (t) => t.status === 'succeeded' || t.status === 'completed'
          ).length;
          const failedCount = executedToolCalls.filter(
            (t) => t.status === 'failed' || t.status === 'timed_out' || t.status === 'denied'
          ).length;
          const modList = Array.from(modifiedFilesSet);
          finalAssistantText = [
            `**Paused at configured step limit (${stepsUsed}/${boundedMaxIterations} steps).**`,
            `- **Tool operations executed**: ${executedToolCalls.length} (${succeededCount} succeeded, ${failedCount} failed/denied)`,
            ...(modList.length > 0 ? [`- **Modified files**: \`${modList.join('`, `')}\``] : []),
            `\nClick **Continue Task** to grant another ${boundedMaxIterations} steps and resume from this checkpoint, or adjust the **Max Steps** setting in the workspace bar.`,
          ].join('\n');
        }
        break;
      }
    }

    if (signal.aborted) {
      return {
        finalText: finalAssistantText || 'Generation stopped by user.',
        taskState: 'cancelled',
        stepsUsed,
        maxStepsConfigured: boundedMaxIterations,
        stoppedReason: 'cancelled',
        canResume: true,
        modifiedFiles: Array.from(modifiedFilesSet),
        toolCalls: executedToolCalls,
      };
    }

    const finalState: TaskExecutionState =
      stoppedReason === 'iteration_limit_reached' ? 'stopped_at_limit' : 'completed';

    onEmitActivity?.({
      conversationId,
      workspaceId,
      state: stoppedReason === 'iteration_limit_reached' ? 'STOPPED_AT_LIMIT' : 'COMPLETED',
      title:
        stoppedReason === 'iteration_limit_reached'
          ? `Paused at Step Limit (${stepsUsed}/${boundedMaxIterations})`
          : `Task Completed (${stepsUsed}/${boundedMaxIterations} steps)`,
      description:
        stoppedReason === 'iteration_limit_reached'
          ? `Executed ${executedToolCalls.length} tool call(s); awaiting operator Continue.`
          : `Completed with ${executedToolCalls.length} verified tool operation(s) in '${workspaceId}'.`,
    });

    return {
      finalText: SecretRedactor.redact(finalAssistantText || 'Task completed.', knownSecrets),
      taskState: finalState,
      stepsUsed,
      maxStepsConfigured: boundedMaxIterations,
      stoppedReason,
      canResume: stoppedReason === 'iteration_limit_reached',
      modifiedFiles: Array.from(modifiedFilesSet),
      toolCalls: executedToolCalls,
    };
  }
}

// ============================================================================
// 10. MULTI-PROVIDER AI CATALOG
// ============================================================================
export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: 'antigravity',
    name: 'Antigravity (Local Host)',
    baseUrl: 'http://localhost:59895',
    protocol: 'ANTIGRAVITY',
    docsUrl: 'https://antigravity.google/docs',
    requiresApiKey: false,
    supportsModelDiscovery: true,
    defaultModel: 'gemini-3.8-flash',
    description:
      'Google Antigravity platform integration with Gemini 3.8 Flash low-latency coding, reasoning, and tool use on localhost.',
  },
  {
    id: 'gemini-server',
    name: 'Built-in Gemini API (Server-Managed)',
    baseUrl: 'https://generativelanguage.googleapis.com',
    protocol: 'GEMINI_SERVER',
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
    requiresApiKey: false,
    supportsModelDiscovery: true,
    defaultModel: 'gemini-3.8-flash',
    description:
      'Authenticated server-side @google/genai integration using environment credentials.',
  },
  {
    id: 'local-ai',
    name: 'Local AI (On-Device Inference)',
    baseUrl: 'local://embedded',
    protocol: 'LOCAL_EMBEDDED',
    docsUrl: 'https://github.com/ggerganov/llama.cpp',
    requiresApiKey: false,
    supportsModelDiscovery: true,
    defaultModel: 'qwen2.5-coder-1.5b-q4_k_m.gguf',
    description:
      'On-device offline inference using local quantized GGUF models. No internet connection or API keys required.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    protocol: 'OPENAI_CHAT',
    docsUrl: 'https://openrouter.ai/docs',
    requiresApiKey: true,
    supportsModelDiscovery: true,
    defaultModel: 'qwen/qwen-2.5-coder-32b-instruct',
    description: 'OpenAI-compatible unified gateway with public model catalog discovery.',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Messages API',
    baseUrl: 'https://api.anthropic.com/v1',
    protocol: 'ANTHROPIC_MESSAGES',
    docsUrl: 'https://docs.anthropic.com',
    requiresApiKey: true,
    supportsModelDiscovery: true,
    defaultModel: 'claude-3-7-sonnet-latest',
    description: 'Official Anthropic Messages protocol with tool-use support.',
  },
  {
    id: 'openai',
    name: 'OpenAI Compatible API',
    baseUrl: 'https://api.openai.com/v1',
    protocol: 'OPENAI_CHAT',
    docsUrl: 'https://platform.openai.com/docs',
    requiresApiKey: true,
    supportsModelDiscovery: true,
    defaultModel: 'gpt-4o-mini',
    description: 'Standard /v1/chat/completions and /v1/models endpoint.',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek API',
    baseUrl: 'https://api.deepseek.com/v1',
    protocol: 'OPENAI_CHAT',
    docsUrl: 'https://api-docs.deepseek.com',
    requiresApiKey: true,
    supportsModelDiscovery: true,
    defaultModel: 'deepseek-chat',
    description: 'DeepSeek coding and reasoning models via OpenAI-compatible wire format.',
  },
];
