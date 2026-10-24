/**
 * Obsidian Duet Agent - Companion Repository
 */

import { DatabaseSync } from 'node:sqlite';
import {
  ConversationRecord,
  ChatMessage,
  TaskRecord,
  CheckpointRecord,
  ApprovalRequest,
  TaskStatus,
  SpecialistRole,
} from '../../../../packages/contracts/src/types.js';

export class CompanionRepository {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  // --- Auth / Pairing ---
  public savePairingToken(id: string, tokenHash: string, clientName: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO pairing_secrets (id, token_hash, client_name, created_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(id, tokenHash, clientName, Date.now());
  }

  public isValidToken(tokenHash: string): boolean {
    const stmt = this.db.prepare(`
      SELECT id FROM pairing_secrets
      WHERE token_hash = ? AND revoked_at IS NULL
    `);
    const row = stmt.get(tokenHash);
    return Boolean(row);
  }

  public revokeToken(tokenHash: string): void {
    const stmt = this.db.prepare(`
      UPDATE pairing_secrets SET revoked_at = ?
      WHERE token_hash = ?
    `);
    stmt.run(Date.now(), tokenHash);
  }

  // --- Conversations & Messages ---
  public saveConversation(conv: ConversationRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO conversations (id, title, provider_id, model_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        provider_id = excluded.provider_id,
        model_id = excluded.model_id,
        updated_at = excluded.updated_at
    `);
    stmt.run(conv.id, conv.title, conv.providerId, conv.modelId, conv.createdAtMillis, conv.updatedAtMillis);
  }

  public getConversation(id: string): ConversationRecord | null {
    const convRow = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as any;
    if (!convRow) return null;

    const msgRows = this.db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC').all(id) as any[];
    const messages: ChatMessage[] = msgRows.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      agentRole: m.agent_role || undefined,
      toolCalls: m.tool_calls_json ? JSON.parse(m.tool_calls_json) : undefined,
      timestampMillis: Number(m.timestamp),
    }));

    return {
      id: convRow.id,
      title: convRow.title,
      providerId: convRow.provider_id,
      modelId: convRow.model_id,
      messages,
      createdAtMillis: Number(convRow.created_at),
      updatedAtMillis: Number(convRow.updated_at),
    };
  }

  public appendMessage(convId: string, msg: ChatMessage): void {
    const stmt = this.db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, agent_role, tool_calls_json, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      msg.id,
      convId,
      msg.role,
      msg.content,
      msg.agentRole || null,
      msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
      msg.timestampMillis
    );

    this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(Date.now(), convId);
  }

  public listConversations(): Array<{ id: string; title: string; updatedAtMillis: number; messageCount: number }> {
    const rows = this.db.prepare(`
      SELECT c.id, c.title, c.updated_at, COUNT(m.id) as msg_count
      FROM conversations c
      LEFT JOIN messages m ON c.id = m.conversation_id
      GROUP BY c.id
      ORDER BY c.updated_at DESC
    `).all() as any[];

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      updatedAtMillis: Number(r.updated_at),
      messageCount: Number(r.msg_count),
    }));
  }

  public deleteConversation(id: string): void {
    this.db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id);
    this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
  }

  // --- Tasks ---
  public createTask(task: TaskRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, conversation_id, parent_task_id, agent_role, title, status, input_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      task.id,
      task.conversationId,
      task.parentTaskId || null,
      task.agentRole,
      task.title,
      task.status,
      JSON.stringify(task.inputPayload),
      task.createdAtMillis,
      task.updatedAtMillis
    );
  }

  public updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    output?: Record<string, unknown>,
    error?: string
  ): void {
    const completedAt = status === 'completed' || status === 'failed' || status === 'cancelled' ? Date.now() : null;
    const stmt = this.db.prepare(`
      UPDATE tasks SET
        status = ?,
        output_json = ?,
        error = ?,
        updated_at = ?,
        completed_at = ?
      WHERE id = ?
    `);
    stmt.run(
      status,
      output ? JSON.stringify(output) : null,
      error || null,
      Date.now(),
      completedAt,
      taskId
    );
  }

  public getTask(taskId: string): TaskRecord | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
    if (!row) return null;
    return {
      id: row.id,
      conversationId: row.conversation_id,
      parentTaskId: row.parent_task_id || undefined,
      agentRole: row.agent_role as SpecialistRole,
      title: row.title,
      status: row.status as TaskStatus,
      inputPayload: JSON.parse(row.input_json),
      outputResult: row.output_json ? JSON.parse(row.output_json) : undefined,
      error: row.error || undefined,
      createdAtMillis: Number(row.created_at),
      updatedAtMillis: Number(row.updated_at),
      completedAtMillis: row.completed_at ? Number(row.completed_at) : undefined,
    };
  }

  public listTasks(conversationId: string): TaskRecord[] {
    const rows = this.db.prepare('SELECT * FROM tasks WHERE conversation_id = ? ORDER BY created_at ASC').all(conversationId) as any[];
    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      parentTaskId: row.parent_task_id || undefined,
      agentRole: row.agent_role as SpecialistRole,
      title: row.title,
      status: row.status as TaskStatus,
      inputPayload: JSON.parse(row.input_json),
      outputResult: row.output_json ? JSON.parse(row.output_json) : undefined,
      error: row.error || undefined,
      createdAtMillis: Number(row.created_at),
      updatedAtMillis: Number(row.updated_at),
      completedAtMillis: row.completed_at ? Number(row.completed_at) : undefined,
    }));
  }

  // --- Checkpoints ---
  public saveCheckpoint(cp: CheckpointRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO checkpoints (id, task_id, conversation_id, step_number, state_snapshot_json, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(cp.id, cp.taskId, cp.conversationId, cp.stepNumber, JSON.stringify(cp.stateSnapshot), cp.timestampMillis);
  }

  public listCheckpoints(taskId: string): CheckpointRecord[] {
    const rows = this.db.prepare('SELECT * FROM checkpoints WHERE task_id = ? ORDER BY step_number ASC').all(taskId) as any[];
    return rows.map((r) => ({
      id: r.id,
      taskId: r.task_id,
      conversationId: r.conversation_id,
      stepNumber: Number(r.step_number),
      stateSnapshot: JSON.parse(r.state_snapshot_json),
      timestampMillis: Number(r.timestamp),
    }));
  }

  // --- Approvals ---
  public createApproval(req: ApprovalRequest): void {
    const stmt = this.db.prepare(`
      INSERT INTO approvals (id, conversation_id, task_id, agent_role, type, title, description, details_json, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const details = {
      diffProposal: req.diffProposal,
      commandDetails: req.commandDetails,
      browserDetails: req.browserDetails,
    };
    stmt.run(
      req.id,
      req.conversationId,
      req.taskId || null,
      req.agentRole,
      req.type,
      req.title,
      req.description,
      JSON.stringify(details),
      req.status,
      req.createdAtMillis
    );
  }

  public resolveApproval(id: string, status: 'approved' | 'rejected'): void {
    const stmt = this.db.prepare(`
      UPDATE approvals SET status = ?, resolved_at = ? WHERE id = ?
    `);
    stmt.run(status, Date.now(), id);
  }

  public getApproval(id: string): ApprovalRequest | null {
    const row = this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as any;
    if (!row) return null;
    const details = row.details_json ? JSON.parse(row.details_json) : {};
    return {
      id: row.id,
      conversationId: row.conversation_id,
      taskId: row.task_id || undefined,
      agentRole: row.agent_role as SpecialistRole,
      type: row.type as any,
      title: row.title,
      description: row.description,
      diffProposal: details.diffProposal,
      commandDetails: details.commandDetails,
      browserDetails: details.browserDetails,
      status: row.status as any,
      createdAtMillis: Number(row.created_at),
      resolvedAtMillis: row.resolved_at ? Number(row.resolved_at) : undefined,
    };
  }

  // --- Audit Events ---
  public recordAuditEvent(event: { id: string; topic: string; conversationId: string; taskId?: string; payload: Record<string, unknown>; timestampMillis: number }): void {
    const stmt = this.db.prepare(`
      INSERT INTO audit_events (id, topic, conversation_id, task_id, payload_json, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      event.id,
      event.topic,
      event.conversationId,
      event.taskId || null,
      JSON.stringify(event.payload),
      event.timestampMillis
    );
  }

  // --- Crash / Restart Recovery ---
  public recoverInterruptedTasks(): number {
    const stmt = this.db.prepare(`
      UPDATE tasks
      SET status = 'paused', error = 'Companion restarted while task was in progress', updated_at = ?
      WHERE status IN ('running', 'waiting_for_approval')
    `);
    const result = stmt.run(Date.now());
    return Number((result as any).changes || 0);
  }
}
