/**
 * Obsidian Duet Agent - Remote Worker Isolated Sandbox
 */

import fs from 'fs';
import path from 'path';

export class RemoteWorkerSandbox {
  private sandboxRoot: string;

  constructor(customPath?: string) {
    this.sandboxRoot = customPath || path.resolve('.obsidian-duet/remote-sandboxes');
    fs.mkdirSync(this.sandboxRoot, { recursive: true });
  }

  public createSandboxForTask(taskId: string): string {
    const taskDir = path.join(this.sandboxRoot, taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    return taskDir;
  }

  public cleanupSandbox(taskId: string): void {
    const taskDir = path.join(this.sandboxRoot, taskId);
    if (fs.existsSync(taskDir)) {
      try {
        fs.rmSync(taskDir, { recursive: true, force: true });
      } catch {}
    }
  }
}
