/**
 * Obsidian Duet Agent - Task Queue & Event Dispatch
 */

import { CompanionRepository } from '../storage/repository.js';
import { TaskRecord, TaskStatus, SpecialistRole } from '../../../../packages/contracts/src/types.js';
import { AgentEvent } from '../../../../packages/contracts/src/events.js';

export class TaskQueue {
  private repo: CompanionRepository;
  private eventListeners: Array<(event: AgentEvent) => void> = [];

  constructor(repo: CompanionRepository) {
    this.repo = repo;
  }

  public subscribe(listener: (event: AgentEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== listener);
    };
  }

  public emitEvent(event: AgentEvent): void {
    // Record audit event in SQLite
    this.repo.recordAuditEvent({
      id: event.id,
      topic: event.topic,
      conversationId: event.conversationId,
      taskId: event.taskId,
      payload: event.payload as Record<string, unknown>,
      timestampMillis: event.timestampMillis,
    });

    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.warn('[TaskQueue] Event listener error:', err);
      }
    }
  }

  public enqueueTask(
    conversationId: string,
    agentRole: SpecialistRole,
    title: string,
    inputPayload: Record<string, unknown>,
    parentTaskId?: string
  ): TaskRecord {
    const task: TaskRecord = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      conversationId,
      parentTaskId,
      agentRole,
      title,
      status: 'queued',
      inputPayload,
      createdAtMillis: Date.now(),
      updatedAtMillis: Date.now(),
    };

    this.repo.createTask(task);

    this.emitEvent({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      topic: 'task.created',
      conversationId,
      taskId: task.id,
      agentRole: task.agentRole,
      timestampMillis: Date.now(),
      payload: { task },
    });

    return task;
  }

  public updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    output?: Record<string, unknown>,
    error?: string
  ): TaskRecord {
    this.repo.updateTaskStatus(taskId, status, output, error);
    const task = this.repo.getTask(taskId);
    if (!task) throw new Error(`Task '${taskId}' not found.`);

    if (status === 'running') {
      this.emitEvent({
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        topic: 'task.started',
        conversationId: task.conversationId,
        taskId: task.id,
        agentRole: task.agentRole,
        timestampMillis: Date.now(),
        payload: { taskId: task.id, agentRole: task.agentRole, title: task.title },
      });
    } else if (status === 'completed') {
      this.emitEvent({
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        topic: 'task.completed',
        conversationId: task.conversationId,
        taskId: task.id,
        agentRole: task.agentRole,
        timestampMillis: Date.now(),
        payload: { taskId: task.id, result: output || {} },
      });
    } else if (status === 'failed') {
      this.emitEvent({
        id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        topic: 'task.failed',
        conversationId: task.conversationId,
        taskId: task.id,
        agentRole: task.agentRole,
        timestampMillis: Date.now(),
        payload: { taskId: task.id, error: error || 'Task execution failed' },
      });
    }

    return task;
  }

  public getTask(taskId: string): TaskRecord | null {
    return this.repo.getTask(taskId);
  }

  public listTasks(conversationId: string): TaskRecord[] {
    return this.repo.listTasks(conversationId);
  }
}
