/**
 * Obsidian Duet Agent - Project Filesystem Tools
 * Implements serialized write locking, atomic file writing, and boundary enforcement.
 */

import fs from 'fs';
import path from 'path';
import { PermissionPolicyEnforcer } from './policies.js';

export class ProjectFilesystemTools {
  private enforcer: PermissionPolicyEnforcer;
  private writeLocks: Map<string, Promise<void>> = new Map();

  constructor(enforcer: PermissionPolicyEnforcer) {
    this.enforcer = enforcer;
  }

  /**
   * Serializes file writes to prevent concurrent file corruption across multiple agents.
   */
  private async acquireWriteLock<T>(canonicalPath: string, fn: () => Promise<T>): Promise<T> {
    const key = canonicalPath.toLowerCase();
    const existingLock = this.writeLocks.get(key) || Promise.resolve();

    let releaseLock: () => void;
    const newLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    this.writeLocks.set(key, newLock);

    try {
      await existingLock;
      return await fn();
    } finally {
      releaseLock!();
      if (this.writeLocks.get(key) === newLock) {
        this.writeLocks.delete(key);
      }
    }
  }

  public async listFiles(subpath = ''): Promise<string[]> {
    const target = this.enforcer.validateProjectPath(subpath || this.enforcer.getApprovedRoots()[0] || '.');
    const results: string[] = [];

    const walk = (dir: string, depth = 0) => {
      if (depth > 6) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, depth + 1);
        } else if (entry.isFile()) {
          results.push(path.relative(target, full));
        }
      }
    };

    walk(target);
    return results.slice(0, 200);
  }

  public async readFile(filePath: string): Promise<{ path: string; content: string; sizeBytes: number }> {
    const canonical = this.enforcer.validateProjectPath(filePath);
    if (!fs.existsSync(canonical)) {
      throw new Error(`File not found: '${filePath}'`);
    }

    const stat = fs.statSync(canonical);
    if (!stat.isFile()) {
      throw new Error(`Path is a directory, not a file: '${filePath}'`);
    }

    if (stat.size > 2 * 1024 * 1024) {
      throw new Error(`File '${filePath}' exceeds maximum size limit (2MB).`);
    }

    const content = fs.readFileSync(canonical, 'utf-8');
    return {
      path: canonical,
      content,
      sizeBytes: stat.size,
    };
  }

  public async writeFile(filePath: string, content: string): Promise<{ success: boolean; bytesWritten: number }> {
    const canonical = this.enforcer.validateProjectPath(filePath);

    return this.acquireWriteLock(canonical, async () => {
      fs.mkdirSync(path.dirname(canonical), { recursive: true });
      const tempPath = `${canonical}.duet-tmp-${Date.now()}`;
      fs.writeFileSync(tempPath, content, 'utf-8');
      fs.renameSync(tempPath, canonical);
      return {
        success: true,
        bytesWritten: Buffer.byteLength(content, 'utf-8'),
      };
    });
  }

  public async searchFiles(query: string, searchRoot = ''): Promise<Array<{ file: string; line: number; text: string }>> {
    const target = this.enforcer.validateProjectPath(searchRoot || this.enforcer.getApprovedRoots()[0] || '.');
    const matches: Array<{ file: string; line: number; text: string }> = [];
    const lowerQuery = query.toLowerCase();

    const walk = (dir: string, depth = 0) => {
      if (depth > 6 || matches.length >= 25) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, depth + 1);
        } else if (entry.isFile()) {
          try {
            const content = fs.readFileSync(full, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(lowerQuery)) {
                matches.push({
                  file: path.relative(target, full),
                  line: i + 1,
                  text: lines[i].trim().slice(0, 160),
                });
                if (matches.length >= 25) break;
              }
            }
          } catch {}
        }
      }
    };

    walk(target);
    return matches;
  }
}
