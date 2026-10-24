/**
 * Obsidian Duet Agent - Remote Worker Protocol Specification
 */

export interface RemoteWorkerRegistration {
  workerId: string;
  name: string;
  capabilities: string[];
  maxConcurrentJobs: number;
  authToken: string;
}

export interface RemoteTaskDispatch {
  taskId: string;
  conversationId: string;
  agentRole: string;
  payload: Record<string, unknown>;
  timeoutMs: number;
}
