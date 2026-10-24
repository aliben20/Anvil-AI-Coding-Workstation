/**
 * Obsidian Duet Agent - Core Type System & Interfaces
 */

export type ProviderType = 'ollama' | 'openai' | 'anthropic' | 'compatible' | 'local-gguf';

export interface ModelMetadata {
  id: string;
  name: string;
  contextWindow?: number;
  supportsStreaming: boolean;
  supportsTools: boolean;
  isLocal: boolean;
}

export interface ModelProvider {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey?: string;
  defaultModelId: string;
  listModels(): Promise<ModelMetadata[]>;
  generate(request: GenerateRequest): Promise<GenerateResponse>;
  generateStream(
    request: GenerateRequest,
    onToken: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<GenerateResponse>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestampMillis: number;
  agentRole?: SpecialistRole;
  toolCalls?: ToolCallRecord[];
  toolResult?: ToolResultRecord;
}

export interface GenerateRequest {
  modelId: string;
  messages: ChatMessage[];
  systemInstruction?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  signal?: AbortSignal;
}

export interface GenerateResponse {
  text: string;
  toolCalls?: ToolCallInvocation[];
  finishReason?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export type SpecialistRole = 'coordinator' | 'researcher' | 'coder' | 'reviewer' | 'vault-assistant';

export interface AgentProfile {
  id: SpecialistRole;
  name: string;
  description: string;
  systemInstruction: string;
  allowedTools: string[];
  requiresApprovalForWrites: boolean;
}

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_approval'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TaskRecord {
  id: string;
  conversationId: string;
  parentTaskId?: string;
  agentRole: SpecialistRole;
  title: string;
  status: TaskStatus;
  inputPayload: Record<string, unknown>;
  outputResult?: Record<string, unknown>;
  error?: string;
  createdAtMillis: number;
  updatedAtMillis: number;
  completedAtMillis?: number;
}

export interface CheckpointRecord {
  id: string;
  taskId: string;
  conversationId: string;
  stepNumber: number;
  stateSnapshot: Record<string, unknown>;
  timestampMillis: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  category: 'vault' | 'filesystem' | 'terminal' | 'browser' | 'system';
  requiresApproval: boolean;
}

export interface ToolCallInvocation {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolCallRecord {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  status: 'running' | 'succeeded' | 'failed' | 'rejected';
  durationMs?: number;
  error?: string;
}

export interface ToolResultRecord {
  toolCallId: string;
  toolName: string;
  result: unknown;
  status: 'ok' | 'error';
  error?: string;
}

export interface ToolRegistry {
  registerTool(tool: ToolDefinition, handler: ToolHandler): void;
  getTool(name: string): ToolDefinition | undefined;
  listTools(): ToolDefinition[];
  executeTool(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult>;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolExecutionContext
) => Promise<ToolExecutionResult>;

export interface ToolExecutionContext {
  conversationId: string;
  taskId?: string;
  agentRole: SpecialistRole;
  vaultRoot?: string;
  approvedProjectRoots: string[];
  signal?: AbortSignal;
  onEmitActivity?: (event: Record<string, unknown>) => void;
}

export interface ToolExecutionResult {
  success: boolean;
  output?: unknown;
  error?: string;
  modifiedFiles?: string[];
  artifacts?: ArtifactRecord[];
}

export interface ArtifactRecord {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  summary?: string;
}

export interface FileDiffProposal {
  id: string;
  taskId?: string;
  conversationId: string;
  filePath: string;
  isVaultFile: boolean;
  originalContent: string;
  proposedContent: string;
  unifiedDiff: string;
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  timestampMillis: number;
}

export interface ApprovalRequest {
  id: string;
  conversationId: string;
  taskId?: string;
  agentRole: SpecialistRole;
  type: 'file_edit' | 'terminal_command' | 'browser_action' | 'external_call';
  title: string;
  description: string;
  diffProposal?: FileDiffProposal;
  commandDetails?: {
    executable: string;
    args: string[];
    cwd: string;
  };
  browserDetails?: {
    action: string;
    url: string;
  };
  status: 'pending' | 'approved' | 'rejected';
  createdAtMillis: number;
  resolvedAtMillis?: number;
}

export interface PermissionPolicy {
  requireApprovalForVaultEdits: boolean;
  requireApprovalForExternalWrites: boolean;
  requireApprovalForTerminal: boolean;
  requireApprovalForBrowserActions: boolean;
  approvedProjectRoots: string[];
  allowedTerminalExecutables: string[];
  allowedBrowserDomains: string[];
  maxAgentRecursionDepth: number;
  maxConcurrentSpecialists: number;
  taskTimeoutMs: number;
}

export interface CancellationHandle {
  abortController: AbortController;
  isCancelled: boolean;
  cancel(reason?: string): void;
}

export interface ConversationRecord {
  id: string;
  title: string;
  providerId: string;
  modelId: string;
  messages: ChatMessage[];
  createdAtMillis: number;
  updatedAtMillis: number;
  activeTaskId?: string;
}

export interface ConversationStore {
  getConversation(id: string): Promise<ConversationRecord | null>;
  saveConversation(conv: ConversationRecord): Promise<void>;
  listConversations(): Promise<Array<{ id: string; title: string; updatedAtMillis: number; messageCount: number }>>;
  deleteConversation(id: string): Promise<void>;
}

export interface CompanionPairingInfo {
  paired: boolean;
  companionUrl: string;
  token?: string;
  status: 'connected' | 'disconnected' | 'pairing_required' | 'unauthorized';
  companionVersion?: string;
}
