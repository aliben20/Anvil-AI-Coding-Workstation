export type TabDestination =
  | 'chat'
  | 'files'
  | 'terminal'
  | 'projects'
  | 'models'
  | 'images'
  | 'preview'
  | 'tools'
  | 'skills'
  | 'agents'
  | 'providers'
  | 'diagnostics'
  | 'settings';

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

export type ProviderConnectionState =
  | 'connected'
  | 'not_configured'
  | 'auth_required'
  | 'testing'
  | 'model_unavailable'
  | 'rate_limited'
  | 'network_error'
  | 'auth_failed';

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

export interface ProviderSummary {
  id: string;
  name: string;
  baseUrl: string;
  protocol: string;
  docsUrl: string;
  requiresApiKey: boolean;
  supportsModelDiscovery: boolean;
  defaultModel: string;
  description: string;
  connected: boolean;
  connectionState?: ProviderConnectionState;
  statusMessage?: string;
  credentials: StoredCredentialInfo[];
  cachedModels: DiscoveredModel[];
  lastUpdatedMillis: number | null;
  isCustom?: boolean;
  customHeaders?: Record<string, string>;
  modelListEndpoint?: string;
  chatEndpoint?: string;
  timeoutMs?: number;
}


export interface WorkspaceSummary {
  id: string;
  name: string;
  path: string;
  projectType: string;
  fileCount: number;
  updatedAtMillis: number;
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

export interface ToolCallRecord {
  id?: string;
  name?: string;
  toolName?: string;
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
  stoppedReason?: 'completed' | 'iteration_limit_reached' | 'cancelled' | 'error' | string;
  canResume?: boolean;
  modifiedFiles?: string[];
  toolCalls?: ToolCallRecord[];
  skillsUsed?: string[];
  streamingStatus?: string;
  isStreaming?: boolean;
  errorExplanation?: string;
  failedPrompt?: string;
  chatMode?: 'normal' | 'agent';
  collaboratorModelId?: string;
  collaboratorContent?: string;
  collaboratorToolCalls?: ToolCallRecord[];
  collaboratorStreamingStatus?: string;
  isCollaboratorStreaming?: boolean;
  resultSummary?: string;
  testStatus?: 'passed' | 'failed' | 'running' | 'skipped';
}

export type SkillScope = 'global' | 'workspace';
export type SkillValidationStatus = 'valid' | 'invalid' | 'missing' | 'failed';
export type SkillCategory =
  | 'build'
  | 'code'
  | 'debug'
  | 'security'
  | 'testing'
  | 'ui'
  | 'general';

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  version?: string;
  author?: string;
  category: SkillCategory;
  scope: SkillScope;
  workspaceId?: string;
  enabled: boolean;
  requiredTools: string[];
  source: 'built-in' | 'custom' | 'imported';
  path: string;
  canonicalPath?: string;
  createdAtMillis: number;
  updatedAtMillis: number;
  keywords?: string[];
  validationStatus?: SkillValidationStatus;
  validationError?: string;
}

export interface SkillDefinition extends SkillSummary {
  instructions: string;
  prerequisites?: string[];
  referenceFiles?: string[];
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
  chatMode?: 'normal' | 'agent';
  collaboratorModelId?: string;
  collaboratorProviderId?: string;
}

export interface AgentActivityEvent {
  id: string;
  conversationId: string;
  workspaceId: string;
  timestampMillis: number;
  state: string;
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

export interface MemoryItem {
  id: string;
  scope: string;
  category: 'user' | 'project' | 'agent';
  title: string;
  content: string;
  updatedAtMillis: number;
}

export type McpTransportType = 'streamable-http' | 'sse' | 'stdio';

export type McpAuthType = 'none' | 'bearer' | 'api_key' | 'oauth2';

export type McpConnectionStatus =
  | 'not_configured'
  | 'connecting'
  | 'auth_required'
  | 'authorizing'
  | 'connected'
  | 'discovery_failed'
  | 'permission_denied'
  | 'token_expired'
  | 'unsupported_auth'
  | 'error'
  | 'untested';

export interface McpOAuthMetadata {
  resource?: string;
  resourceName?: string;
  resourceMetadataUrl?: string;
  wwwAuthenticateHeader?: string;
  authorizationServerUrl?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  registrationEndpoint?: string;
  deviceAuthorizationEndpoint?: string;
  scopesSupported?: string[];
  codeChallengeMethodsSupported?: string[];
  supportsDynamicRegistration?: boolean;
  hasClientCredentials?: boolean;
  hasAccessToken?: boolean;
  setupRequirement?: string;
}

export interface McpDiagnosticLog {
  timestampMillis: number;
  level: 'info' | 'warn' | 'error';
  stage: 'init' | 'auth_discovery' | 'oauth' | 'transport' | 'tools_list' | 'tool_call';
  message: string;
  httpStatus?: number;
}

export interface McpDiscoveredTool {
  name: string;
  description: string;
  requiredParams: string[];
  inputSchema?: Record<string, unknown>;
}

export interface McpDiscoveredResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpDiscoveredPrompt {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface McpServerEntry {
  id: string;
  name: string;
  transport?: McpTransportType;
  endpointUrl: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  authType?: McpAuthType;
  customHeaderName?: string;
  hasConfiguredSecret?: boolean;
  oauthClientId?: string;
  oauthScopes?: string;
  enabled: boolean;
  timeoutMs: number;
  protocolVersion?: string;
  serverInfo?: { name: string; version: string };
  sessionId?: string;
  lastStatus?: McpConnectionStatus;
  lastError?: string;
  lastConnectedAtMillis?: number;
  rateLimitRetryAfterSec?: number;
  oauthMetadata?: McpOAuthMetadata;
  discoveredTools?: McpDiscoveredTool[];
  discoveredResources?: McpDiscoveredResource[];
  discoveredPrompts?: McpDiscoveredPrompt[];
  diagnostics?: McpDiagnosticLog[];
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

export interface LocalAiModel {
  id: string; // e.g. "qwen2.5-coder-1.5b-q4_k_m.gguf"
  displayName: string;
  description: string;
  format: string; // "GGUF Q4_K_M (v3)"
  sizeBytes: number;
  sizeDisplay: string;
  ramRequiredDisplay: string;
  architectureHint: string;
  isDownloaded: boolean;
  filePath?: string;
  validMagic?: boolean;
  formatVersion?: number | null;
  tensorCount?: number | null;
  metadataKvCount?: number | null;
  fitsHostMemory?: boolean;
  diagnosticMessage?: string;
  isRecommended?: boolean;
  supportsTools?: boolean;
  downloadProgress?: number;
  downloadStatus?: 'ready' | 'downloading' | 'available' | 'error';
}

export interface WorkstationSettings {
  accentColor: string;
  themePalette?: 'dark-graphite' | 'amoled' | 'charcoal';
  codeFont?: string;
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
  toolApprovalAlerts?: boolean;
  buildCompletionAlerts?: boolean;
}

export type ToolchainId =
  | 'claude-code'
  | 'opencode'
  | 'nodejs'
  | 'npm'
  | 'git'
  | 'web'
  | 'python'
  | 'android'
  | 'cpp'
  | 'php';

export type OptionalToolchainId = 'web' | 'python' | 'android' | 'cpp' | 'php' | 'opencode';

export type ToolchainCategory = 'core' | 'optional';

export type ToolchainPlatformClassification =
  | 'android_native'
  | 'proot_linux'
  | 'downloadable_data'
  | 'remote_backend';

export type ToolchainDiagnosticStage =
  | 'RESOLVE_URL'
  | 'NETWORK_CONNECT'
  | 'HTTP_REQUEST'
  | 'DISK_SPACE_CHECK'
  | 'DOWNLOAD_STREAM'
  | 'CHECKSUM_VERIFICATION'
  | 'CONTENT_VALIDATION'
  | 'ARCHIVE_EXTRACTION'
  | 'BINARY_VERIFICATION'
  | 'EXECUTION_PERMISSION'
  | 'ENVIRONMENT_PROBE';

export interface ToolchainDiagnosticReport {
  toolId: string;
  stage: ToolchainDiagnosticStage;
  httpStatus?: number;
  exceptionType: string;
  actionableMessage: string;
  url?: string;
  targetPath?: string;
  requiredBytes?: number;
  availableBytes?: number;
  expectedChecksum?: string;
  actualChecksum?: string;
  timestamp: number;
}

export type ToolchainInstallStatus =
  | 'installed'
  | 'not_installed'
  | 'installing'
  | 'updating'
  | 'uninstalling'
  | 'failed';

export interface ToolchainBinaryCheck {
  binary: string;
  command: string;
  installed: boolean;
  version: string | null;
  executablePath: string | null;
}

export interface ToolchainItemState {
  id: ToolchainId;
  category: ToolchainCategory;
  title: string;
  subtitle: string;
  description: string;
  components: string[];
  estimatedDownloadBytes: number;
  estimatedInstalledBytes: number;
  accentColor: string;
  iconKey: 'terminal' | 'globe' | 'python' | 'android' | 'cpu' | 'server' | 'git' | 'node';
  status: ToolchainInstallStatus;
  installedVersion: string | null;
  verifiedAtMillis: number | null;
  lastError: string | null;
  canUninstall: boolean;
  canUpdate: boolean;
  binaries: ToolchainBinaryCheck[];
  platformClassification?: ToolchainPlatformClassification;
  diagnostic?: ToolchainDiagnosticReport | null;
  usedByWorkspaces?: Array<{
    workspaceId: string;
    workspaceName: string;
    projectType: string;
    isPrimary: boolean;
  }>;
}

export interface DiskSpaceInfo {
  supported: boolean;
  mountPoint: string;
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  usedPercent: number;
}

export interface PlatformCompatibilityReport {
  compatible: boolean;
  platform: string;
  arch: string;
  distro: string;
  kernelRelease: string;
  hasRootPrivileges: boolean;
  aptAvailable: boolean;
  npmAvailable: boolean;
  prootNote: string;
  issues: string[];
}

export interface ToolchainJobProgress {
  jobId: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
  operation: 'install' | 'update' | 'uninstall';
  targetIds: ToolchainId[];
  currentToolchainId: ToolchainId | null;
  currentComponent: string;
  stageMessage: string;
  fraction: number;
  downloadedBytes: number;
  totalBytes: number;
  terminalLines: string[];
  startedAtMillis: number;
  finishedAtMillis?: number;
  errorMessage?: string;
  canRetry: boolean;
  diagnostic?: ToolchainDiagnosticReport | null;
}

export interface WorkspaceToolchainStatus {
  workspaceId: string;
  workspaceName: string;
  workspacePath: string;
  projectType: string;
  requiredToolchains: ToolchainId[];
  satisfied: boolean;
  missingToolchains: ToolchainId[];
  sharedHostTools: Array<{
    toolchainId: ToolchainId;
    title: string;
    installed: boolean;
    version: string | null;
  }>;
  isolatedLocalDependencies: Array<{
    kind: 'node_modules' | 'venv' | 'vendor' | 'gradle';
    path: string;
    sizeBytes: number;
    details: string;
  }>;
  updatedAtMillis: number;
}

export interface MobileHarnessBundleSpec {
  id: string;
  version: string;
  file: string;
  sha256: string;
  compressedBytes: number;
  uncompressedBytes: number;
  base?: string;
  includes: string[];
  excludes?: string[];
  downloadUrl?: string;
  downloaded: boolean;
  localPath?: string | null;
  verifiedChecksum?: boolean;
}

export interface MobileHarnessReleaseArtifact {
  variant: 'online' | 'offline';
  url: string;
  sha256: string;
  sizeBytes: number;
  downloaded: boolean;
  localPath?: string | null;
  verifiedChecksum?: boolean;
}

export interface MobileHarnessRepoResourceCatalog {
  repoUrl: string;
  repoDirectory: string;
  commitHash: string;
  tag: string;
  commitDate: string;
  manifestSchemaVersion: number;
  architecture: string;
  bundles: MobileHarnessBundleSpec[];
  releaseVersionCode: number;
  releaseVersionName: string;
  releaseNotes: string;
  releaseArtifacts: MobileHarnessReleaseArtifact[];
  devStacks: Array<{
    id: string;
    label: string;
    description: string;
    installsSummary: string;
  }>;
  scripts: Array<{
    name: string;
    relativePath: string;
    description: string;
    executable: boolean;
  }>;
  totalDiskUsageBytes: number;
}

export interface ToolchainManagerStatus {
  toolchains: ToolchainItemState[];
  coreToolchains: ToolchainItemState[];
  optionalToolchains: ToolchainItemState[];
  selectedOptionalIds: OptionalToolchainId[];
  setupCompleted: boolean;
  diskSpace: DiskSpaceInfo;
  compatibility: PlatformCompatibilityReport;
  activeJob: ToolchainJobProgress | null;
  workspaces: WorkspaceToolchainStatus[];
  repositoryResources: MobileHarnessRepoResourceCatalog | null;
  activeWorkspaceId?: string;
}

export type SubAgentRole =
  | 'Planner'
  | 'Researcher'
  | 'Coder'
  | 'Reviewer'
  | 'Tester'
  | 'Debugger';

export type SubAgentStatus =
  | 'Queued'
  | 'Running'
  | 'Waiting'
  | 'Completed'
  | 'Failed'
  | 'Cancelled'
  | 'queued'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface SubAgentToolCall {
  tool: string;
  args?: Record<string, unknown>;
  result?: string;
  durationMs?: number;
  timestampMillis: number;
}

export interface SubAgentTask {
  id: string;
  parentId?: string;
  conversationId?: string;
  role: SubAgentRole;
  agentProfileId?: string;
  agentName?: string;
  title: string;
  taskPrompt: string;
  status: SubAgentStatus;
  providerId: string;
  modelId: string;
  workspaceId: string;
  currentStep?: string;
  progress?: number;
  progressPercent?: number;
  toolCalls?: SubAgentToolCall[];
  changedFiles?: string[];
  output?: string;
  summary?: string;
  resultSummary?: string;
  error?: string;
  durationMs?: number;
  createdAtMillis: number;
  updatedAtMillis: number;
  completedAtMillis?: number;
}

export interface AgentProfile {
  id: string;
  name: string;
  role: string;
  description: string;
  systemInstruction: string;
  capabilities: string[];
  defaultModelId?: string;
  defaultProviderId?: string;
  defaultMaxSteps: number;
  temperature?: number;
  isCustom?: boolean;
  isDefault?: boolean;
  icon?: string;
  accentColor?: string;
}

export interface AndroidPermissionStatus {
  notifications: 'granted' | 'denied' | 'default';
  backgroundWork: 'active' | 'optimized' | 'unknown';
  overlay: 'granted' | 'denied' | 'unsupported';
  storage: 'granted' | 'denied';
}

export interface FloatingBubbleConfig {
  enabled: boolean;
  snapEdge: 'left' | 'right';
  posY: number;
  showCurrentTask: boolean;
}

export type DiagnosticTestStatus = 'pass' | 'fail' | 'skipped' | 'blocked';

export type DiagnosticCategoryId =
  | 'ui-navigation'
  | 'controls-inventory'
  | 'chat-streaming'
  | 'agent-tools'
  | 'providers-auth'
  | 'local-ai-gguf'
  | 'windows-terminal'
  | 'workspace-filesystem'
  | 'android-build'
  | 'skills-subagents'
  | 'mcp-connectivity'
  | 'responsive-a11y';

export interface DiagnosticTestResult {
  id: string;
  category: DiagnosticCategoryId;
  categoryLabel: string;
  name: string;
  featureTested: string;
  status: DiagnosticTestStatus;
  observedResult: string;
  errorMessage?: string;
  stackTrace?: string;
  durationMs: number;
  suggestedFix?: string;
  timestampMillis: number;
  metadata?: Record<string, unknown>;
}

export interface LocalAiCapabilityMatrix {
  modelInstalled: boolean;
  modelLoaded: boolean;
  loadedModelId?: string | null;
  loadedModelName?: string | null;
  loadedModelPath: string | null;
  backendReady: boolean;
  inferenceSuccessful: boolean;
  lastInferenceLatencyMs?: number | null;
  toolCallingSupported: boolean;
  workspaceToolsAvailable: boolean;
}

export interface DiagnosticSuiteReport {
  runId: string;
  startedAtMillis: number;
  finishedAtMillis: number;
  totalDurationMs: number;
  platform: string;
  hostShell: string;
  activeWorkspaceId: string;
  activeWorkspacePath: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    blocked: number;
  };
  localAiCapabilities: LocalAiCapabilityMatrix;
  results: DiagnosticTestResult[];
}





