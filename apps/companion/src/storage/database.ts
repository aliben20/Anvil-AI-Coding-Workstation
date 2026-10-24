/**
 * Obsidian Duet Agent - Companion SQLite Database
 * Powered by Node.js native node:sqlite DatabaseSync
 */

import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

export class CompanionDatabase {
  private db: DatabaseSync;
  private dbPath: string;

  constructor(customPath?: string) {
    if (customPath) {
      this.dbPath = customPath;
    } else {
      const homeDir = process.env.USERPROFILE || process.env.HOME || '.';
      const duetDir = path.join(homeDir, '.obsidian-duet');
      fs.mkdirSync(duetDir, { recursive: true });
      this.dbPath = path.join(duetDir, 'companion.db');
    }

    this.db = new DatabaseSync(this.dbPath);
    this.configurePragmas();
  }

  private configurePragmas(): void {
    if (this.dbPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
    }
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
  }

  public getRawDb(): DatabaseSync {
    return this.db;
  }

  public getPath(): string {
    return this.dbPath;
  }

  public close(): void {
    this.db.close();
  }
}
