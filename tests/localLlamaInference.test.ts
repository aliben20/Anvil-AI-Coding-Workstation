import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { LocalModelManager } from '../src/server/workstationEngine.js';
import { LocalLlamaEngine, localLlamaEngine } from '../src/server/localLlamaEngine.js';

test('Local AI Inference: rejects fake stub fixtures without weights', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anvil-local-ai-test-'));
  try {
    const lmm = new LocalModelManager(tempDir);
    const catalog = lmm.listCatalogModels();

    // Since tempDir has no full weights, all catalog models should be isDownloaded: false, downloadStatus: available
    for (const m of catalog) {
      assert.equal(m.isDownloaded, false);
      assert.equal(m.downloadStatus, 'available');
    }

    // Creating a stub file < 1MB should be reported as fixture only
    const stubPath = path.join(tempDir, 'test-stub.gguf');
    const buf = Buffer.alloc(128);
    buf.write('GGUF', 0, 4, 'ascii');
    buf.writeUInt32LE(3, 4);
    buf.writeBigUInt64LE(196n, 8);
    buf.writeBigUInt64LE(24n, 16);
    fs.writeFileSync(stubPath, buf);

    const inspection = lmm.inspectGgufFile(stubPath);
    assert.equal(inspection.validMagic, true);
    assert.match(inspection.diagnosticMessage, /Header fixture only/i);

    // Attempting to install when weights are missing should throw an honest error
    assert.throws(
      () => lmm.installModel('qwen2.5-coder-1.5b-q4_k_m.gguf'),
      /Model weights for '.*' are not downloaded/i
    );

    // Engine should throw honest error if attempting to load stub fixture
    const engine = new LocalLlamaEngine();
    await assert.rejects(
      () => engine.loadModel(stubPath),
      /stub fixture.*Full GGUF tensor weights/i
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Local AI Inference: zero fabricated promotional templates in codebase', () => {
  const workstationPath = path.join(process.cwd(), 'src', 'server', 'workstationEngine.ts');
  const serverPath = path.join(process.cwd(), 'server.ts');
  const workstationContent = fs.readFileSync(workstationPath, 'utf8');
  const serverContent = fs.readFileSync(serverPath, 'utf8');

  const forbidden = [
    'Summary of Analysis',
    'validated this query',
    'toolchain and shell execution support enabled',
    'Zero cloud latency & full data privacy',
  ];

  for (const phrase of forbidden) {
    assert.equal(
      workstationContent.includes(phrase),
      false,
      `workstationEngine.ts must not contain fabricated phrase: "${phrase}"`
    );
    assert.equal(
      serverContent.includes(phrase),
      false,
      `server.ts must not contain fabricated phrase: "${phrase}"`
    );
  }
});
