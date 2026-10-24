/**
 * Obsidian Duet Agent - Remote Worker Job Dispatcher
 */

import { RemoteWorkerRegistration, RemoteTaskDispatch } from './protocol.js';

export class RemoteWorkerDispatcher {
  private registeredWorkers: Map<string, RemoteWorkerRegistration> = new Map();

  public registerWorker(worker: RemoteWorkerRegistration): void {
    this.registeredWorkers.set(worker.workerId, worker);
  }

  public getAvailableWorkers(): RemoteWorkerRegistration[] {
    return Array.from(this.registeredWorkers.values());
  }

  public async dispatchJob(dispatch: RemoteTaskDispatch): Promise<{ dispatched: boolean; workerId?: string }> {
    const workers = this.getAvailableWorkers();
    if (workers.length === 0) {
      return { dispatched: false };
    }
    const worker = workers[0];
    return {
      dispatched: true,
      workerId: worker.workerId,
    };
  }
}
