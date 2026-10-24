/**
 * Obsidian Duet Agent - Task Checkpoints
 */

import { CompanionRepository } from '../storage/repository.js';
import { CheckpointRecord } from '../../../../packages/contracts/src/types.js';

export class TaskCheckpointManager {
  private repo: CompanionRepository;

  constructor(repo: CompanionRepository) {
    this.repo = repo;
  }

  public saveCheckpoint(taskId: string, conversationId: string, stepNumber: number, stateSnapshot: Record<string, unknown>): CheckpointRecord {
    const cp: CheckpointRecord = {
      id: `cp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      taskId,
      conversationId,
      stepNumber,
      stateSnapshot,
      timestampMillis: Date.now(),
    };
    this.repo.saveCheckpoint(cp);
    return cp;
  }

  public getCheckpoints(taskId: string): CheckpointRecord[] {
    return this.repo.listCheckpoints(taskId);
  }
}
