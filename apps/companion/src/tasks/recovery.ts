/**
 * Obsidian Duet Agent - Task Crash & Restart Recovery
 */

import { CompanionRepository } from '../storage/repository.js';

export class TaskRecoveryService {
  private repo: CompanionRepository;

  constructor(repo: CompanionRepository) {
    this.repo = repo;
  }

  public runRecovery(): { recoveredCount: number } {
    const count = this.repo.recoverInterruptedTasks();
    if (count > 0) {
      console.log(`[TaskRecovery] Recovered ${count} interrupted task(s) to 'paused' status.`);
    }
    return { recoveredCount: count };
  }
}
