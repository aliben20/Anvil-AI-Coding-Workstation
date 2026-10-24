/**
 * Obsidian Duet Agent - Task Worker Pool
 * Executes specialist tasks with concurrency boundaries and timeout protection.
 */

import { TaskQueue } from './queue.js';
import { TaskRecord } from '../../../../packages/contracts/src/types.js';

export type TaskExecutorFn = (task: TaskRecord, signal: AbortSignal) => Promise<Record<string, unknown>>;

export class TaskWorkerPool {
  private queue: TaskQueue;
  private maxConcurrency: number;
  private activeRunningCount = 0;
  private executors: Map<string, TaskExecutorFn> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();

  constructor(queue: TaskQueue, maxConcurrency = 3) {
    this.queue = queue;
    this.maxConcurrency = maxConcurrency;
  }

  public registerExecutor(agentRole: string, executor: TaskExecutorFn): void {
    this.executors.set(agentRole, executor);
  }

  public async runTask(task: TaskRecord, timeoutMs = 60000): Promise<TaskRecord> {
    const executor = this.executors.get(task.agentRole);
    if (!executor) {
      return this.queue.updateTaskStatus(task.id, 'failed', undefined, `No executor registered for role: '${task.agentRole}'`);
    }

    const abortController = new AbortController();
    this.abortControllers.set(task.id, abortController);

    this.queue.updateTaskStatus(task.id, 'running');
    this.activeRunningCount++;

    const timer = setTimeout(() => {
      abortController.abort();
    }, timeoutMs);

    try {
      const output = await executor(task, abortController.signal);
      clearTimeout(timer);
      return this.queue.updateTaskStatus(task.id, 'completed', output);
    } catch (err) {
      clearTimeout(timer);
      const isAbort = abortController.signal.aborted;
      const status = isAbort ? 'cancelled' : 'failed';
      const msg = isAbort ? 'Task cancelled or timed out' : err instanceof Error ? err.message : String(err);
      return this.queue.updateTaskStatus(task.id, status, undefined, msg);
    } finally {
      this.activeRunningCount--;
      this.abortControllers.delete(task.id);
    }
  }

  public cancelTask(taskId: string): void {
    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
    }
  }

  public getActiveCount(): number {
    return this.activeRunningCount;
  }
}
