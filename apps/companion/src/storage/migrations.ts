/**
 * Obsidian Duet Agent - SQLite Migrations
 */

import { DatabaseSync } from 'node:sqlite';

export class DatabaseMigrator {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  public runMigrations(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);

    const currentVersion = this.getCurrentVersion();

    if (currentVersion < 1) {
      this.db.exec(`
        -- Pairing Secrets
        CREATE TABLE IF NOT EXISTS pairing_secrets (
          id TEXT PRIMARY KEY,
          token_hash TEXT NOT NULL UNIQUE,
          client_name TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          revoked_at INTEGER
        );

        -- Conversations
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          model_id TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        -- Messages
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          agent_role TEXT,
          tool_calls_json TEXT,
          timestamp INTEGER NOT NULL,
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        -- Tasks
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          parent_task_id TEXT,
          agent_role TEXT NOT NULL,
          title TEXT NOT NULL,
          status TEXT NOT NULL,
          input_json TEXT NOT NULL,
          output_json TEXT,
          error TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          completed_at INTEGER
        );

        -- Checkpoints
        CREATE TABLE IF NOT EXISTS checkpoints (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          step_number INTEGER NOT NULL,
          state_snapshot_json TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        -- Approvals
        CREATE TABLE IF NOT EXISTS approvals (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          task_id TEXT,
          agent_role TEXT NOT NULL,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          details_json TEXT,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          resolved_at INTEGER
        );

        -- Audit Events
        CREATE TABLE IF NOT EXISTS audit_events (
          id TEXT PRIMARY KEY,
          topic TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          task_id TEXT,
          payload_json TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_conv ON tasks(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_checkpoints_task ON checkpoints(task_id);
        CREATE INDEX IF NOT EXISTS idx_approvals_conv ON approvals(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_audit_conv ON audit_events(conversation_id);

        INSERT INTO schema_migrations (version, applied_at) VALUES (1, datetime('now'));
      `);
    }
  }

  private getCurrentVersion(): number {
    const row = this.db.prepare('SELECT MAX(version) as max_v FROM schema_migrations').get() as { max_v: number | null };
    return row && row.max_v !== null ? row.max_v : 0;
  }
}
