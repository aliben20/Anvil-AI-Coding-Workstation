/**
 * Obsidian Duet Agent - Remote Worker Daemon
 */

import { RemoteWorkerSandbox } from './sandbox.js';
import { RemoteJobExecutor } from './executor.js';

async function main() {
  const sandbox = new RemoteWorkerSandbox();
  const executor = new RemoteJobExecutor(sandbox);

  console.log('[RemoteWorker] Remote Worker Daemon initialized.');
  console.log('[RemoteWorker] Ready to receive delegated jobs from companion.');
}

if (process.env.DUET_RUN_WORKER === '1') {
  main().catch(console.error);
}

export { RemoteWorkerSandbox, RemoteJobExecutor };
