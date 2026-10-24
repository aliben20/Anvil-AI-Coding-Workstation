/**
 * Obsidian Duet Agent - Remote Worker Job Executor
 */

import { RemoteWorkerSandbox } from './sandbox.js';
import { TaskRecord } from '../../../packages/contracts/src/types.js';

export class RemoteJobExecutor {
  private sandbox: RemoteWorkerSandbox;

  constructor(sandbox: RemoteWorkerSandbox) {
    this.sandbox = sandbox;
  }

  public async executeJob(task: TaskRecord): Promise<{ success: boolean; result: Record<string, unknown> }> {
    const sandboxDir = this.sandbox.createSandboxForTask(task.id);
    try {
      return {
        success: true,
        result: {
          taskId: task.id,
          status: 'completed',
          sandboxDir,
          executedAt: Date.now(),
        },
      };
    } finally {
      this.sandbox.cleanupSandbox(task.id);
    }
  }
}
