/**
 * Obsidian Duet Agent - Vault Tools Implementation
 * Uses official Obsidian App, Vault, and Workspace APIs.
 */

// @ts-ignore
import { App, TFile, TFolder, MarkdownView, normalizePath } from 'obsidian';
import { FileDiffProposal } from '../../../packages/contracts/src/types.js';

export interface UndoRecord {
  id: string;
  filePath: string;
  previousContent: string;
  appliedContent: string;
  timestampMillis: number;
}

function isVaultFile(f: any): f is TFile {
  if (!f || typeof f !== 'object') return false;
  if (typeof TFile === 'function' && f instanceof TFile) return true;
  return typeof f.path === 'string';
}

export class VaultTools {
  private app: App;
  private undoHistory: UndoRecord[] = [];
  private static readonly MAX_UNDO_ITEMS = 50;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Sanitizes and bounds a vault path, blocking traversal attacks like '..' or absolute OS paths.
   */
  public sanitizeVaultPath(rawPath: string): string {
    if (!rawPath || typeof rawPath !== 'string') {
      throw new Error('Path cannot be empty.');
    }
    if (rawPath.includes('..')) {
      throw new Error(`Path traversal denied: '${rawPath}' attempts to escape vault boundaries.`);
    }
    const normalized = normalizePath(rawPath.replace(/^[/\\]+/, '').trim());
    if (normalized.startsWith('..') || normalized.includes('../') || normalized.includes('..\\')) {
      throw new Error(`Path traversal denied: '${rawPath}' attempts to escape vault boundaries.`);
    }
    return normalized;
  }

  /**
   * Lists Markdown files in the vault or specific subfolder.
   */
  public async listFiles(subfolder = ''): Promise<string[]> {
    const targetFolder = subfolder ? this.sanitizeVaultPath(subfolder) : '';
    const files = this.app.vault.getMarkdownFiles();
    return files
      .map((f: TFile) => f.path)
      .filter((p: string) => {
        if (p.startsWith('.obsidian/') || p.startsWith('.trash/')) return false;
        if (!targetFolder) return true;
        return p.startsWith(targetFolder);
      })
      .slice(0, 100);
  }

  /**
   * Reads a note from the vault with strict path validation.
   */
  public async readNote(path: string): Promise<{ path: string; content: string; stat: { mtime: number; size: number } }> {
    const safePath = this.sanitizeVaultPath(path);
    const abstractFile = this.app.vault.getAbstractFileByPath(safePath);
    if (!abstractFile) {
      throw new Error(`Note not found in vault: '${safePath}'`);
    }
    if (!isVaultFile(abstractFile)) {
      throw new Error(`Target '${safePath}' is a directory, not a note file.`);
    }

    const content = await this.app.vault.read(abstractFile);
    return {
      path: abstractFile.path,
      content,
      stat: {
        mtime: abstractFile.stat.mtime,
        size: abstractFile.stat.size,
      },
    };
  }

  /**
   * Reads the currently active note in the workspace leaf.
   */
  public async readActiveNote(): Promise<{ path: string; content: string; selectedText: string } | null> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) return null;

    const content = await this.app.vault.read(activeFile);
    let selectedText = '';
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView && activeView.editor) {
      selectedText = activeView.editor.getSelection();
    }

    return {
      path: activeFile.path,
      content,
      selectedText,
    };
  }

  /**
   * Returns selected text in the active editor.
   */
  public getSelectedText(): string {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView && activeView.editor) {
      return activeView.editor.getSelection();
    }
    return '';
  }

  /**
   * Searches notes by title or content matching query keywords.
   */
  public async searchNotes(query: string, maxResults = 10): Promise<Array<{ path: string; matchType: 'title' | 'content'; snippet: string }>> {
    const cleanQuery = query.toLowerCase().trim();
    if (!cleanQuery) return [];

    const files = this.app.vault.getMarkdownFiles();
    const results: Array<{ path: string; matchType: 'title' | 'content'; snippet: string }> = [];

    for (const file of files) {
      if (file.path.startsWith('.obsidian/') || file.path.startsWith('.trash/')) continue;

      if (file.basename.toLowerCase().includes(cleanQuery)) {
        results.push({
          path: file.path,
          matchType: 'title',
          snippet: `Matched note title: ${file.basename}`,
        });
        if (results.length >= maxResults) break;
        continue;
      }

      // Check content if needed
      try {
        const text = await this.app.vault.cachedRead(file);
        const idx = text.toLowerCase().indexOf(cleanQuery);
        if (idx >= 0) {
          const start = Math.max(0, idx - 40);
          const end = Math.min(text.length, idx + cleanQuery.length + 60);
          const snippet = text.slice(start, end).replace(/\n+/g, ' ');
          results.push({
            path: file.path,
            matchType: 'content',
            snippet: `...${snippet}...`,
          });
          if (results.length >= maxResults) break;
        }
      } catch {
        // Skip inaccessible files
      }
    }

    return results;
  }

  /**
   * Finds outgoing links and backlinks for a given note.
   */
  public findLinkedNotes(notePath: string): { outgoing: string[]; backlinks: string[] } {
    const safePath = this.sanitizeVaultPath(notePath);
    const targetFile = this.app.vault.getAbstractFileByPath(safePath);
    if (!isVaultFile(targetFile)) {
      return { outgoing: [], backlinks: [] };
    }

    const metadata = this.app.metadataCache.getFileCache(targetFile);
    const outgoing: string[] = [];
    if (metadata && metadata.links) {
      for (const link of metadata.links) {
        outgoing.push(link.link);
      }
    }

    const backlinks: string[] = [];
    const resolvedLinks = this.app.metadataCache.resolvedLinks;
    for (const sourcePath in resolvedLinks) {
      const linksForSource = resolvedLinks[sourcePath];
      if (linksForSource && linksForSource[safePath]) {
        backlinks.push(sourcePath);
      }
    }

    return {
      outgoing: Array.from(new Set(outgoing)),
      backlinks: Array.from(new Set(backlinks)),
    };
  }

  /**
   * Proposes a patch to a note and generates a unified diff.
   */
  public async proposePatch(
    filePath: string,
    proposedContent: string,
    conversationId: string,
    taskId?: string
  ): Promise<FileDiffProposal> {
    const safePath = this.sanitizeVaultPath(filePath);
    let originalContent = '';
    const file = this.app.vault.getAbstractFileByPath(safePath);

    if (isVaultFile(file)) {
      originalContent = await this.app.vault.read(file);
    }

    const diff = this.generateSimpleUnifiedDiff(safePath, originalContent, proposedContent);

    return {
      id: `diff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      taskId,
      conversationId,
      filePath: safePath,
      isVaultFile: true,
      originalContent,
      proposedContent,
      unifiedDiff: diff,
      status: 'pending',
      timestampMillis: Date.now(),
    };
  }

  /**
   * Applies an approved patch with concurrent modification detection.
   */
  public async applyPatch(proposal: FileDiffProposal): Promise<{ success: boolean; error?: string }> {
    const safePath = this.sanitizeVaultPath(proposal.filePath);
    let targetFile = this.app.vault.getAbstractFileByPath(safePath);

    if (targetFile && !isVaultFile(targetFile)) {
      return { success: false, error: `Target path '${safePath}' is not a note file.` };
    }

    if (isVaultFile(targetFile)) {
      // Concurrent change check: ensure file content matches proposal.originalContent
      const currentContent = await this.app.vault.read(targetFile);
      if (currentContent !== proposal.originalContent) {
        return {
          success: false,
          error: `Concurrent modification detected: Note '${safePath}' was modified by the user or an external process after this edit was proposed. Please review the updated note before applying.`,
        };
      }

      // Record undo snapshot
      this.recordUndo(safePath, currentContent, proposal.proposedContent);
      await this.app.vault.modify(targetFile, proposal.proposedContent);
    } else {
      // File does not exist yet: create note and parent directories if needed
      await this.ensureParentFolderExists(safePath);
      this.recordUndo(safePath, '', proposal.proposedContent);
      await this.app.vault.create(safePath, proposal.proposedContent);
    }

    proposal.status = 'applied';
    return { success: true };
  }

  /**
   * Reverts the last agent modification for a given file.
   */
  public async undoAgentChange(filePath: string): Promise<{ success: boolean; revertedToSnapshot?: boolean; error?: string }> {
    const safePath = this.sanitizeVaultPath(filePath);
    const undoIdx = this.undoHistory.findIndex((r) => r.filePath === safePath);

    if (undoIdx === -1) {
      return { success: false, error: `No undo record found for note '${safePath}'.` };
    }

    const [record] = this.undoHistory.splice(undoIdx, 1);
    const targetFile = this.app.vault.getAbstractFileByPath(safePath);

    if (!targetFile && !record.previousContent) {
      return { success: true, revertedToSnapshot: true };
    }

    if (isVaultFile(targetFile)) {
      if (!record.previousContent) {
        // Was newly created by agent: delete it safely
        await this.app.vault.delete(targetFile);
      } else {
        await this.app.vault.modify(targetFile, record.previousContent);
      }
      return { success: true, revertedToSnapshot: true };
    }

    return { success: false, error: `Cannot undo: Note '${safePath}' no longer exists in vault.` };
  }

  private recordUndo(filePath: string, previousContent: string, appliedContent: string): void {
    this.undoHistory.unshift({
      id: `undo-${Date.now()}`,
      filePath,
      previousContent,
      appliedContent,
      timestampMillis: Date.now(),
    });
    if (this.undoHistory.length > VaultTools.MAX_UNDO_ITEMS) {
      this.undoHistory.pop();
    }
  }

  private async ensureParentFolderExists(filePath: string): Promise<void> {
    const parts = filePath.split('/');
    if (parts.length <= 1) return;
    const folderPath = parts.slice(0, -1).join('/');
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!folder) {
      await this.app.vault.createFolder(folderPath);
    }
  }

  public generateSimpleUnifiedDiff(path: string, original: string, modified: string): string {
    const origLines = original ? original.split('\n') : [];
    const modLines = modified ? modified.split('\n') : [];
    const diffLines: string[] = [`--- a/${path}`, `+++ b/${path}`];

    let i = 0;
    let j = 0;
    while (i < origLines.length || j < modLines.length) {
      if (i < origLines.length && j < modLines.length && origLines[i] === modLines[j]) {
        diffLines.push(` ${origLines[i]}`);
        i++;
        j++;
      } else if (j < modLines.length && (i >= origLines.length || !origLines.includes(modLines[j]))) {
        diffLines.push(`+${modLines[j]}`);
        j++;
      } else if (i < origLines.length) {
        diffLines.push(`-${origLines[i]}`);
        i++;
      }
    }

    return diffLines.join('\n');
  }
}
