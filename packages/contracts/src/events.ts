/**
 * Obsidian Duet Agent - Real-Time Activity Event Protocol
 */

import { SpecialistRole, TaskStatus, ToolCallRecord, FileDiffProposal, ApprovalRequest, TaskRecord } from './types.js';

export type EventTopic =
  | 'turn.started'
  | 'model.requested'
  | 'message.delta'
  | 'task.created'
  | 'task.started'
  | 'task.progress'
  | 'agent.started'
  | 'tool.started'
  | 'tool.completed'
  | 'approval.required'
  | 'file.diff.proposed'
  | 'file.changed'
  | 'task.completed'
  | 'task.failed'
  | 'turn.interrupted'
  | 'turn.completed';

export interface BaseAgentEvent<T extends EventTopic, P = Record<string, unknown>> {
  id: string;
  topic: T;
  conversationId: string;
  taskId?: string;
  agentRole?: SpecialistRole;
  timestampMillis: number;
  payload: P;
}

export type TurnStartedEvent = BaseAgentEvent<
  'turn.started',
  { userMessageId: string; prompt: string }
>;

export type ModelRequestedEvent = BaseAgentEvent<
  'model.requested',
  { providerId: string; modelId: string; messageCount: number }
>;

export type MessageDeltaEvent = BaseAgentEvent<
  'message.delta',
  { delta: string; accumulatedText: string; assistantMessageId: string }
>;

export type TaskCreatedEvent = BaseAgentEvent<
  'task.created',
  { task: TaskRecord }
>;

export type TaskStartedEvent = BaseAgentEvent<
  'task.started',
  { taskId: string; agentRole: SpecialistRole; title: string }
>;

export type TaskProgressEvent = BaseAgentEvent<
  'task.progress',
  { taskId: string; progressPercent?: number; statusText: string }
>;

export type AgentStartedEvent = BaseAgentEvent<
  'agent.started',
  { agentRole: SpecialistRole; instructionSummary: string }
>;

export type ToolStartedEvent = BaseAgentEvent<
  'tool.started',
  { toolCall: ToolCallRecord }
>;

export type ToolCompletedEvent = BaseAgentEvent<
  'tool.completed',
  { toolCall: ToolCallRecord; success: boolean; resultSummary?: string }
>;

export type ApprovalRequiredEvent = BaseAgentEvent<
  'approval.required',
  { request: ApprovalRequest }
>;

export type FileDiffProposedEvent = BaseAgentEvent<
  'file.diff.proposed',
  { proposal: FileDiffProposal }
>;

export type FileChangedEvent = BaseAgentEvent<
  'file.changed',
  { filePath: string; isVaultFile: boolean; changeType: 'created' | 'modified' | 'deleted' }
>;

export type TaskCompletedEvent = BaseAgentEvent<
  'task.completed',
  { taskId: string; result: Record<string, unknown> }
>;

export type TaskFailedEvent = BaseAgentEvent<
  'task.failed',
  { taskId: string; error: string }
>;

export type TurnInterruptedEvent = BaseAgentEvent<
  'turn.interrupted',
  { reason: 'cancelled_by_user' | 'timeout' | 'system_restart'; partialText?: string }
>;

export type TurnCompletedEvent = BaseAgentEvent<
  'turn.completed',
  { assistantMessageId: string; totalTokens?: number; durationMs: number }
>;

export type AgentEvent =
  | TurnStartedEvent
  | ModelRequestedEvent
  | MessageDeltaEvent
  | TaskCreatedEvent
  | TaskStartedEvent
  | TaskProgressEvent
  | AgentStartedEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | ApprovalRequiredEvent
  | FileDiffProposedEvent
  | FileChangedEvent
  | TaskCompletedEvent
  | TaskFailedEvent
  | TurnInterruptedEvent
  | TurnCompletedEvent;
