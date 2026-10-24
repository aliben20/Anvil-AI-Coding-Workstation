/**
 * Obsidian Duet Agent - Vault Tools, Diff Review & Undo Tests
 * Tests 9, 10, 11, 12, 13
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { VaultTools } from '../../apps/obsidian-plugin/src/vault-tools.js';

// Mock Obsidian App & Vault for unit testing
function createMockApp() {
  const store = new Map<string, string>();

  function mockFile(filePath: string) {
    return { path: filePath } as any;
  }
  function mockFolder(folderPath: string) {
    return { path: folderPath } as any;
  }

  const vault = {
    async read(file: any) {
      if (!store.has(file.path)) throw new Error('File not found');
      return store.get(file.path)!;
    },
    async modify(file: any, content: string) {
      store.set(file.path, content);
    },
    async create(path: string, content: string) {
      store.set(path, content);
      return mockFile(path);
    },
    async createFolder(path: string) {
      return mockFolder(path);
    },
    async delete(file: any) {
      store.delete(file.path);
    },
    getAbstractFileByPath(path: string) {
      if (store.has(path)) {
        return mockFile(path);
      }
      return null;
    },
    getMarkdownFiles() {
      return Array.from(store.keys()).map((p) => mockFile(p));
    },
  };

  const metadataCache = {
    getFileCache() { return { links: [] }; },
    resolvedLinks: {},
  };

  const workspace = {
    getActiveFile() { return null; },
    getActiveViewOfType() { return null; },
  };

  return { vault, metadataCache, workspace, _store: store } as any;
}

test('Vault Tools: sanitizeVaultPath blocks directory traversal and illegal characters', () => {
  const mockApp = createMockApp();
  const tools = new VaultTools(mockApp);

  // Normal safe path
  assert.equal(tools.sanitizeVaultPath('Notes/Work.md'), 'Notes/Work.md');
  assert.equal(tools.sanitizeVaultPath('/Daily/2026-10-23.md'), 'Daily/2026-10-23.md');

  // Traversal attempts
  assert.throws(() => tools.sanitizeVaultPath('../secret.txt'), /Path traversal denied/i);
  assert.throws(() => tools.sanitizeVaultPath('../../Windows/System32'), /Path traversal denied/i);
});

test('Vault Tools: proposePatch generates accurate unified diff (Test 10)', async () => {
  const mockApp = createMockApp();
  const tools = new VaultTools(mockApp);

  const original = 'Line 1\nLine 2\nLine 3';
  const modified = 'Line 1\nLine 2 (Modified)\nLine 3\nLine 4';

  const diff = tools.generateSimpleUnifiedDiff('test.md', original, modified);
  assert.ok(diff.includes('--- a/test.md'));
  assert.ok(diff.includes('+++ b/test.md'));
  assert.ok(diff.includes('+Line 2 (Modified)'));
  assert.ok(diff.includes('+Line 4'));
});

test('Vault Tools: applyPatch creates new note, modifies note, and respects concurrent edits (Test 11 & 12)', async () => {
  const mockApp = createMockApp();
  const tools = new VaultTools(mockApp);

  const proposal = await tools.proposePatch('Notes/Project.md', '# New Project Note\nContent here', 'conv-1');

  // 1. Rejected edit test: If not applied, file does not exist (Test 11)
  assert.equal(mockApp.vault.getAbstractFileByPath('Notes/Project.md'), null);

  // 2. Apply patch: creates note (Test 12)
  const applyRes = await tools.applyPatch(proposal);
  assert.equal(applyRes.success, true);
  assert.equal(await mockApp.vault.read({ path: 'Notes/Project.md' }), '# New Project Note\nContent here');

  // 3. Propose second modification
  const proposal2 = await tools.proposePatch('Notes/Project.md', '# New Project Note\nUpdated Content', 'conv-1');

  // Simulate user making a concurrent edit in the meantime
  await mockApp.vault.modify({ path: 'Notes/Project.md' }, '# User edited this first!');

  // Attempting to apply proposal2 must detect the conflict and abort!
  const conflictRes = await tools.applyPatch(proposal2);
  assert.equal(conflictRes.success, false);
  assert.ok(conflictRes.error?.includes('Concurrent modification detected'));
  // Ensure user edit was preserved
  assert.equal(await mockApp.vault.read({ path: 'Notes/Project.md' }), '# User edited this first!');
});

test('Vault Tools: undoAgentChange safely restores prior note state (Test 13)', async () => {
  const mockApp = createMockApp();
  const tools = new VaultTools(mockApp);

  mockApp._store.set('Doc.md', 'Version 1 original text');

  const proposal = await tools.proposePatch('Doc.md', 'Version 2 agent text', 'conv-undo');
  await tools.applyPatch(proposal);
  assert.equal(await mockApp.vault.read({ path: 'Doc.md' }), 'Version 2 agent text');

  // Execute undo
  const undoRes = await tools.undoAgentChange('Doc.md');
  assert.equal(undoRes.success, true);
  assert.equal(undoRes.revertedToSnapshot, true);
  assert.equal(await mockApp.vault.read({ path: 'Doc.md' }), 'Version 1 original text');
});
