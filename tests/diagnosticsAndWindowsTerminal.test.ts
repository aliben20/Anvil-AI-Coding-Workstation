import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';

process.env.ANVIL_TEST_MODE = '1';

test('Windows Terminal: kotlin-notes-apk session path, dir, cd tracking, and exit codes', async () => {
  const { ptySessionManager, workspaceManager } = await import('../server.js');
  const expectedPath = workspaceManager.getWorkspaceRoot('kotlin-notes-apk');

  const session = await ptySessionManager.createSession({
    workspaceId: 'kotlin-notes-apk',
    title: 'test-kotlin-notes',
  });

  try {
    const pwdRes = await ptySessionManager.executeInSession(session.sessionId, 'pwd', 5000);
    assert.equal(pwdRes.cwd.toLowerCase(), expectedPath.toLowerCase());

    const dirCmd = process.platform === 'win32' ? 'dir /b' : 'ls -1';
    const dirRes = await ptySessionManager.executeInSession(session.sessionId, dirCmd, 5000);
    assert.equal(dirRes.exitCode, 0);
    assert.equal(
      dirRes.output.includes('settings.gradle.kts') || dirRes.output.includes('app'),
      true
    );

    const cdRes = await ptySessionManager.executeInSession(session.sessionId, 'cd app && pwd', 5000);
    assert.equal(
      cdRes.cwd.toLowerCase(),
      path.join(expectedPath, 'app').toLowerCase()
    );

    const failRes = await ptySessionManager.executeInSession(
      session.sessionId,
      'nonexistent_command_xyz_987',
      5000
    );
    assert.notEqual(failRes.exitCode, 0);
  } finally {
    await ptySessionManager.closeSession(session.sessionId, true);
  }
});

test('Full 12-Category Diagnostics Suite & Real GGUF Local AI Verification', async () => {
  const { diagnosticsRunner } = await import('../server.js');
  const report = await diagnosticsRunner.runDiagnostics({
    activeWorkspaceId: 'kotlin-notes-apk',
  });

  assert.equal(report.summary.failed, 0, `Expected 0 failed checks, got: ${JSON.stringify(report.results.filter((r) => r.status === 'fail'))}`);
  assert.equal(report.summary.total >= 26, true);

  // Verify all 6 Local AI capability flags when SmolLM2 GGUF is installed
  const ggufPath = path.join(
    process.cwd(),
    '.anvil-data',
    'local-models',
    'smollm2-135m-instruct-q4_k_m.gguf'
  );
  if (fs.existsSync(ggufPath)) {
    assert.equal(report.localAiCapabilities.modelInstalled, true);
    assert.equal(report.localAiCapabilities.modelLoaded, true);
    assert.equal(report.localAiCapabilities.backendReady, true);
    assert.equal(report.localAiCapabilities.inferenceSuccessful, true);
    assert.equal(report.localAiCapabilities.toolCallingSupported, true);
    assert.equal(report.localAiCapabilities.workspaceToolsAvailable, true);
  }

  const html = diagnosticsRunner.formatHtmlReport(report);
  assert.equal(html.includes('OBSIDIAN — Full Application QA & Diagnostic Report'), true);
});
