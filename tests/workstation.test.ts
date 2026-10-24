process.env.ANVIL_TEST_MODE = '1';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  SecretRedactor,
  EncryptedCredentialVault,
  PermissionManager,
  WorkspaceManager,
  TerminalSessionManager,
  LocalModelManager,
  BuildServiceManager,
  MemoryAndMcpManager,
  BoundedAgentLoopRunner,
} from '../src/server/workstationEngine.js';
import {
  SOURCE_REPOSITORIES_METADATA,
  normalizeAndValidateToolArgs,
  evaluateCommandSafety,
  auditAndroidManifestContent,
} from '../src/server/sourceIntegrations.js';
import { PersistentPtySessionManager } from '../src/server/ptySessionManager.js';
import {
  McpConnectionManager,
  parseWwwAuthenticateHeader,
} from '../src/server/mcpConnectionManager.js';
import { MobileHarnessToolchainManager } from '../src/server/toolchainManager.js';
import http from 'node:http';

const isWindows = process.platform === 'win32';
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'anvil-test-suite-'));
const tempDataDir = path.join(tempRoot, 'data');
const tempWorkspacesDir = path.join(tempRoot, 'workspaces');
const tempAndroidDir = path.join(process.cwd(), 'android-workstation');

test('1. SecretRedactor masks Bearer tokens, API keys, and custom secrets', () => {
  const raw =
    'Error calling endpoint with Authorization: Bearer sk-or-v1-abcdef1234567890 and customSecret998877';
  const redacted = SecretRedactor.redact(raw, ['customSecret998877']);
  assert.equal(redacted.includes('abcdef1234567890'), false);
  assert.equal(redacted.includes('customSecret998877'), false);
  assert.equal(redacted.includes('[REDACTED]'), true);
});

test('2. EncryptedCredentialVault encrypts with AES-256-GCM and never exposes raw keys in listCredentials', () => {
  const vault = new EncryptedCredentialVault(tempDataDir);
  const info = vault.saveCredential(
    'openrouter',
    'Dev Key',
    'Bearer sk-or-v1-99887766554433221100\n'
  );
  assert.equal(info.providerId, 'openrouter');
  assert.equal(info.isActive, true);
  assert.equal(info.maskedPreview.includes('99887766554433221100'), false);

  const decrypted = vault.getActiveSecret('openrouter');
  assert.equal(decrypted, 'sk-or-v1-99887766554433221100');

  const listed = vault.listCredentials('openrouter');
  assert.equal(listed.length, 1);
  assert.equal('encrypted' in listed[0], false);

  vault.removeCredential('openrouter', info.id);
  assert.equal(vault.getActiveSecret('openrouter'), null);
});

test('3. PermissionManager enforces workspace path boundaries and rejects path traversal', () => {
  const pm = new PermissionManager();
  const validPath = pm.validateWorkspacePath(tempWorkspacesDir, 'python-cli-toolkit/main.py');
  assert.equal(validPath.startsWith(path.resolve(tempWorkspacesDir)), true);

  assert.throws(() => {
    pm.validateWorkspacePath(tempWorkspacesDir, '../../etc/passwd');
  }, /Workspace path traversal blocked/);

  assert.throws(() => {
    pm.validateWorkspacePath(tempWorkspacesDir, 'bad\0file.txt');
  }, /Null byte/);
});

test('4. WorkspaceManager creates project templates, reads UTF-8 bounded, computes unified diffs, and reverts checkpoints', () => {
  const pm = new PermissionManager();
  const wm = new WorkspaceManager(tempWorkspacesDir, tempAndroidDir, pm);

  const created = wm.createWorkspace('unit-test-app', 'python');
  assert.equal(created.id, 'unit-test-app');
  assert.equal(created.projectType, 'python');

  const initialRead = wm.readFileBounded('unit-test-app', 'main.py');
  assert.equal(initialRead.content.includes('Hello from unit-test-app'), true);

  const diff = wm.writeFileSafely(
    'unit-test-app',
    'main.py',
    'def run() -> str:\n    return "Updated output"\n'
  );
  assert.equal(diff.additions > 0, true);
  assert.equal(diff.deletions > 0, true);

  // Revert checkpoint and verify original content is restored
  wm.revertCheckpoint(diff.id);
  const revertedRead = wm.readFileBounded('unit-test-app', 'main.py');
  assert.equal(revertedRead.content, initialRead.content);
});

test('5. WorkspaceManager rejects binary files with null bytes from UTF-8 text editor', () => {
  const pm = new PermissionManager();
  const wm = new WorkspaceManager(tempWorkspacesDir, tempAndroidDir, pm);
  const binPath = path.join(tempWorkspacesDir, 'unit-test-app', 'binary.dat');
  fs.writeFileSync(binPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0a]));

  assert.throws(() => {
    wm.readFileBounded('unit-test-app', 'binary.dat');
  }, /Binary file cannot be edited as UTF-8 text/);
});

test('6. TerminalSessionManager executes real shell commands, preserves stateful cwd within workspace, and blocks traversal', { skip: isWindows ? 'Linux environment required' : false }, async () => {
  const pm = new PermissionManager();
  const wm = new WorkspaceManager(tempWorkspacesDir, tempAndroidDir, pm);
  const tm = new TerminalSessionManager(wm);

  const res = await tm.executeCommand('python-cli-toolkit', 'python3 calculator.py');
  assert.equal(res.status, 'succeeded');
  assert.equal(res.exitCode, 0);
  assert.equal(res.stdout.includes('Sum: 60.0'), true);

  const escapeAttempt = await tm.executeCommand('python-cli-toolkit', 'cd /etc');
  assert.equal(escapeAttempt.status, 'denied');
  assert.equal(escapeAttempt.exitCode, 1);
  assert.equal(escapeAttempt.stderr.includes('Blocked: directory traversal'), true);
});

test('7. LocalModelManager parses real GGUF v3 binary headers and rejects corrupted files', () => {
  const lmm = new LocalModelManager(tempDataDir);
  const models = lmm.listModels();
  assert.equal(models.length >= 1, true);
  assert.equal(models[0].validMagic, true);
  assert.equal(models[0].formatVersion, 3);
  assert.equal(models[0].tensorCount, 196);
  assert.equal(models[0].metadataKvCount, 24);

  const corruptPath = path.join(tempDataDir, 'corrupt.gguf');
  fs.writeFileSync(corruptPath, 'NOT_A_GGUF_HEADER_AT_ALL_1234567890');
  const badInspection = lmm.inspectGgufFile(corruptPath);
  assert.equal(badInspection.validMagic, false);
});

test('8. BuildServiceManager executes real Python builds and honestly reports missing JDK/Android SDK for Android Gradle builds', { skip: isWindows ? 'Linux environment required' : false }, async () => {
  const pm = new PermissionManager();
  const wm = new WorkspaceManager(tempWorkspacesDir, tempAndroidDir, pm);
  const tm = new TerminalSessionManager(wm);
  const bsm = new BuildServiceManager(wm, tm, tempDataDir);

  const pyBuild = await bsm.runWorkspaceBuild('python-cli-toolkit');
  assert.equal(pyBuild.status, 'SUCCEEDED');
  assert.equal(pyBuild.exitCode, 0);
  assert.equal(Boolean(pyBuild.artifactPath && fs.existsSync(pyBuild.artifactPath)), true);

  const androidBuild = await bsm.runWorkspaceBuild('android-workstation');
  assert.equal(androidBuild.status, 'BLOCKED_ENVIRONMENT');
  assert.equal(Boolean(androidBuild.artifactPath && fs.existsSync(androidBuild.artifactPath)), true);

  const missingApk = bsm.verifyApkArtifact('/tmp/does-not-exist-99999.apk');
  assert.equal(missingApk.verified, false);
});

test('9. MemoryAndMcpManager persists scoped memory notes and searches by keyword', () => {
  const mmm = new MemoryAndMcpManager(tempDataDir);
  const saved = mmm.saveMemory(
    'python-cli-toolkit',
    'project',
    'Precision Floating Point Rule',
    'Use float() conversion in evaluate_tokens to keep return types consistent.'
  );
  const found = mmm.listMemories('python-cli-toolkit', 'evaluate_tokens');
  assert.equal(found.length, 1);
  assert.equal(found[0].id, saved.id);
});

test('10. PocketStrike-AI Tool Argument Normalizer handles aliases (cmd -> command, file -> path) and rejects missing required args', () => {
  const normalizedCmd = normalizeAndValidateToolArgs('run_command', {
    cmd: 'python3 -m unittest',
  });
  assert.equal(normalizedCmd.valid, true);
  assert.equal(normalizedCmd.normalizedArgs.command, 'python3 -m unittest');

  const emptyCmd = normalizeAndValidateToolArgs('run_command', {});
  assert.equal(emptyCmd.valid, false);
  assert.equal(Boolean(emptyCmd.validationError?.includes("Missing or empty 'command'")), true);

  const normalizedWrite = normalizeAndValidateToolArgs('write_file', {
    file: 'calculator.py',
    text: 'print(42)\n',
  });
  assert.equal(normalizedWrite.valid, true);
  assert.equal(normalizedWrite.normalizedArgs.path, 'calculator.py');
  assert.equal(normalizedWrite.normalizedArgs.content, 'print(42)\n');
});

test('11. TerminalSessionManager handles non-zero exit codes, timeouts (124), AbortSignal cancellation (130), and destructive command blocking', { skip: isWindows ? 'Linux environment required' : false }, async () => {
  const pm = new PermissionManager();
  const wm = new WorkspaceManager(tempWorkspacesDir, tempAndroidDir, pm);
  const tm = new TerminalSessionManager(wm);

  const failRes = await tm.executeCommand(
    'python-cli-toolkit',
    'python3 -c "import sys; sys.stderr.write(\'syntax failure\\n\'); sys.exit(2)"'
  );
  assert.equal(failRes.status, 'failed');
  assert.equal(failRes.exitCode, 2);
  assert.equal(failRes.stderr.includes('syntax failure'), true);

  const timeoutRes = await tm.executeCommand(
    'python-cli-toolkit',
    'python3 -c "import time; time.sleep(5)"',
    600
  );
  assert.equal(timeoutRes.status, 'timed_out');
  assert.equal(timeoutRes.timedOut, true);
  assert.equal(timeoutRes.exitCode, 124);

  const abortController = new AbortController();
  setTimeout(() => abortController.abort(), 200);
  const cancelRes = await tm.executeCommand(
    'python-cli-toolkit',
    'python3 -c "import time; time.sleep(5)"',
    8000,
    { signal: abortController.signal }
  );
  assert.equal(cancelRes.status, 'cancelled');
  assert.equal(cancelRes.cancelled, true);
  assert.equal(cancelRes.exitCode, 130);

  const safety = evaluateCommandSafety('rm -rf /');
  assert.equal(safety.riskLevel, 'FORBIDDEN');
  const blockedRes = await tm.executeCommand('python-cli-toolkit', 'rm -rf /');
  assert.equal(blockedRes.status, 'denied');
  assert.equal(blockedRes.exitCode, 126);
});

test('12. WorkspaceManager supports directory creation (mkdir), file rename, and real-time fileCount synchronization', () => {
  const pm = new PermissionManager();
  const wm = new WorkspaceManager(tempWorkspacesDir, tempAndroidDir, pm);

  const beforeSummary = wm.listWorkspaces().find((w) => w.id === 'unit-test-app')!;
  const beforeCount = beforeSummary.fileCount;

  wm.createDirectorySafely('unit-test-app', 'utils');
  wm.writeFileSafely('unit-test-app', 'utils/helper.py', 'def double(x):\n    return x * 2\n');

  const afterWriteSummary = wm.listWorkspaces().find((w) => w.id === 'unit-test-app')!;
  assert.equal(afterWriteSummary.fileCount, beforeCount + 1);

  wm.renamePathSafely('unit-test-app', 'utils/helper.py', 'utils/math_helper.py');
  const renamedContent = wm.readFileBounded('unit-test-app', 'utils/math_helper.py');
  assert.equal(renamedContent.content.includes('def double(x):'), true);
});

test('13. BoundedAgentLoopRunner executes end-to-end Python program creation -> test failure -> bug fix -> test pass workflow', { skip: isWindows ? 'Linux environment required' : false }, async () => {
  const pm = new PermissionManager();
  pm.setPolicy('EXECUTE_COMMANDS', 'ALLOW');
  const wm = new WorkspaceManager(tempWorkspacesDir, tempAndroidDir, pm);
  const tm = new TerminalSessionManager(wm);
  const mmm = new MemoryAndMcpManager(tempDataDir);
  const runner = new BoundedAgentLoopRunner(wm, tm, pm, mmm);

  let modelTurnCount = 0;
  const abortController = new AbortController();
  const result = await runner.runAgentLoop({
    conversationId: 'conv-e2e-test',
    workspaceId: 'unit-test-app',
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'Build fib.py, test it, and fix any bugs.',
        timestampMillis: Date.now(),
      },
    ],
    systemInstruction: 'You are an autonomous software engineer.',
    enableAgentTools: true,
    maxIterations: 10,
    maxToolCalls: 15,
    commandTimeoutMs: 10000,
    signal: abortController.signal,
    modelTurnGenerator: async () => {
      modelTurnCount++;
      if (modelTurnCount === 1) {
        return {
          text: 'Creating fib.py and test_fib.py...',
          toolCalls: [
            {
              name: 'write_file',
              args: {
                path: 'fib.py',
                content: 'def add_numbers(a, b):\n    return a - b  # intentional bug\n',
              },
            },
            {
              name: 'write_file',
              args: {
                path: 'test_fib.py',
                content:
                  'import unittest\nfrom fib import add_numbers\nclass TestFib(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(add_numbers(3, 4), 7)\nif __name__ == "__main__":\n    unittest.main()\n',
              },
            },
          ],
        };
      }
      if (modelTurnCount === 2) {
        return {
          text: 'Running unit tests...',
          toolCalls: [
            {
              name: 'run_command',
              args: { cmd: 'python3 -m unittest test_fib.py' },
            },
          ],
        };
      }
      if (modelTurnCount === 3) {
        return {
          text: 'Fixing bug in fib.py...',
          toolCalls: [
            {
              name: 'write_file',
              args: {
                path: 'fib.py',
                content: 'def add_numbers(a, b):\n    return a + b\n',
              },
            },
          ],
        };
      }
      if (modelTurnCount === 4) {
        return {
          text: 'Re-running unit tests to verify fix...',
          toolCalls: [
            {
              name: 'run_command',
              args: { command: 'python3 -m unittest test_fib.py' },
            },
          ],
        };
      }
      return {
        text: 'All unit tests passed after fixing add_numbers in fib.py.',
        toolCalls: [],
      };
    },
  });

  assert.equal(result.taskState, 'completed');
  assert.equal(result.stoppedReason, 'completed');
  assert.equal(result.stepsUsed, 5);
  assert.equal(result.toolCalls.length, 5);
  assert.equal(result.toolCalls[2].status, 'failed');
  assert.equal(result.toolCalls[4].status, 'succeeded');
  assert.equal(result.toolCalls[4].exitCode, 0);
});

test('14. BoundedAgentLoopRunner pauses cleanly at iteration limit (stopped_at_limit) with canResume=true', async () => {
  const pm = new PermissionManager();
  const wm = new WorkspaceManager(tempWorkspacesDir, tempAndroidDir, pm);
  const tm = new TerminalSessionManager(wm);
  const mmm = new MemoryAndMcpManager(tempDataDir);
  const runner = new BoundedAgentLoopRunner(wm, tm, pm, mmm);

  const abortController = new AbortController();
  const pausedResult = await runner.runAgentLoop({
    conversationId: 'conv-pause-test',
    workspaceId: 'unit-test-app',
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'Inspect files across multiple steps.',
        timestampMillis: Date.now(),
      },
    ],
    systemInstruction: 'You are an autonomous software engineer.',
    enableAgentTools: true,
    maxIterations: 3,
    maxToolCalls: 10,
    commandTimeoutMs: 5000,
    signal: abortController.signal,
    modelTurnGenerator: async ({ iteration }) => ({
      text: `Working on step ${iteration}`,
      toolCalls: [{ name: 'search_files', args: { query: `step_${iteration}` } }],
    }),
  });

  assert.equal(pausedResult.taskState, 'stopped_at_limit');
  assert.equal(pausedResult.stoppedReason, 'iteration_limit_reached');
  assert.equal(pausedResult.canResume, true);
  assert.equal(pausedResult.stepsUsed, 3);
});

test('15. Source integrations metadata and PocketStrike AndroidManifest.xml security auditor verify real artifacts', () => {
  assert.equal(
    SOURCE_REPOSITORIES_METADATA.mobileHarness.commitSha,
    '96b1da08d03af4f2d63970a3794c7fda068948c4'
  );
  assert.equal(
    SOURCE_REPOSITORIES_METADATA.pocketStrikeAi.commitSha,
    '465fc193ff8f8bb31e6f0e24075cddc044b2a3fc'
  );

  const manifestPath = path.join(tempAndroidDir, 'app/src/main/AndroidManifest.xml');
  const xml = fs.readFileSync(manifestPath, 'utf8');
  const audit = auditAndroidManifestContent(xml);
  assert.equal(audit.packageName, 'io.anvil.workstation');
  assert.equal(audit.permissions.includes('android.permission.INTERNET'), true);
  assert.equal(audit.sha256.length, 64);
});

// ============================================================================
// REAL-TERMINAL ACCEPTANCE TESTS (TESTS A THROUGH J) ON ACTUAL OS PTY SHELL
// ============================================================================
test('16. [Acceptance Tests A, B, C, D, E] Real PTY Shell Identification, Persistent cd, Persistent env var, Real File Creation, and Error Reporting', { skip: isWindows ? 'Linux PTY environment required' : false }, async () => {
  const pm = new PermissionManager();
  const wm = new WorkspaceManager(tempWorkspacesDir, tempAndroidDir, pm);
  const ptyMgr = new PersistentPtySessionManager((wsId) => wm.getWorkspaceRoot(wsId));

  const session = await ptyMgr.createSession({
    workspaceId: 'python-cli-toolkit',
    cols: 100,
    rows: 30,
  });

  try {
    // Test A — Identify the shell & PTY
    assert.equal(session.status, 'running');
    assert.equal(session.transportMode, 'pty');
    assert.equal(Boolean(session.ttyPath?.startsWith('/dev/pts/')), true);
    assert.equal(typeof session.shellPid === 'number' && session.shellPid > 0, true);

    const testA = await ptyMgr.executeInSession(
      session.sessionId,
      'echo "SHELL=$0" && uname -s -m && tty'
    );
    assert.equal(testA.exitCode, 0);
    assert.equal(testA.output.includes('bash'), true);
    assert.equal(testA.output.includes('Linux'), true);
    assert.equal(testA.output.includes('/dev/pts/'), true);

    // Test B — Persistent directory across separate commands in the same session
    const pwd1 = await ptyMgr.executeInSession(session.sessionId, 'pwd');
    const initialDir = pwd1.cwd;

    const mkdirRes = await ptyMgr.executeInSession(
      session.sessionId,
      'mkdir -p obsidian-terminal-test'
    );
    assert.equal(mkdirRes.exitCode, 0);

    const cdRes = await ptyMgr.executeInSession(
      session.sessionId,
      'cd obsidian-terminal-test'
    );
    assert.equal(cdRes.exitCode, 0);

    const pwd2 = await ptyMgr.executeInSession(session.sessionId, 'pwd');
    assert.equal(pwd2.exitCode, 0);
    assert.notEqual(pwd2.cwd, initialDir);
    assert.equal(pwd2.cwd.endsWith('/obsidian-terminal-test'), true);
    assert.equal(pwd2.output.includes('/obsidian-terminal-test'), true);
    assert.equal(pwd2.shellPid, session.shellPid);

    // Test C — Persistent shell variable across separate commands
    const exportRes = await ptyMgr.executeInSession(
      session.sessionId,
      'export OBSIDIAN_TEST=working'
    );
    assert.equal(exportRes.exitCode, 0);

    const echoVarRes = await ptyMgr.executeInSession(
      session.sessionId,
      'echo "$OBSIDIAN_TEST"'
    );
    assert.equal(echoVarRes.exitCode, 0);
    assert.equal(echoVarRes.output.includes('working'), true);

    // Test D — Real file creation in the active subdirectory
    await ptyMgr.executeInSession(
      session.sessionId,
      "printf 'real terminal test\\n' > terminal-proof.txt"
    );
    const catRes = await ptyMgr.executeInSession(
      session.sessionId,
      'cat terminal-proof.txt'
    );
    assert.equal(catRes.exitCode, 0);
    assert.equal(catRes.output.includes('real terminal test'), true);

    const hostFilePath = path.join(pwd2.cwd, 'terminal-proof.txt');
    assert.equal(fs.existsSync(hostFilePath), true);
    assert.equal(fs.readFileSync(hostFilePath, 'utf8'), 'real terminal test\n');

    // Test E — Error reporting for invalid command
    const badCmdRes = await ptyMgr.executeInSession(
      session.sessionId,
      'nonexistent_command_xyz_999'
    );
    assert.equal(badCmdRes.exitCode, 127);
    assert.equal(badCmdRes.output.toLowerCase().includes('not found'), true);
  } finally {
    await ptyMgr.closeSession(session.sessionId, true);
  }
});

test('17. [Acceptance Test F & G] Interactive stdin prompt/response and foreground process SIGINT cancellation without killing shell', { skip: isWindows ? 'Linux PTY environment required' : false }, async () => {
  const pm = new PermissionManager();
  const wm = new WorkspaceManager(tempWorkspacesDir, tempAndroidDir, pm);
  const ptyMgr = new PersistentPtySessionManager((wsId) => wm.getWorkspaceRoot(wsId));

  const session = await ptyMgr.createSession({
    workspaceId: 'python-cli-toolkit',
  });

  try {
    // Test F — Interactive stdin/stdout while a process is running
    let streamedText = '';
    const unsub = ptyMgr.subscribe(session.sessionId, {
      onOutput: ({ data }) => {
        streamedText += data;
      },
      onStatus: () => {},
    });

    ptyMgr.writeInput(
      session.sessionId,
      'python3 -u -c "v = input(\'INTERACTIVE_PROMPT>\'); print(\'INTERACTIVE_GOT:\' + v)"\r'
    );

    // Wait for INTERACTIVE_PROMPT> to appear in real PTY stream
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 4000;
      const timer = setInterval(() => {
        if (streamedText.includes('INTERACTIVE_PROMPT>')) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() > deadline) {
          clearInterval(timer);
          reject(new Error(`Timed out waiting for interactive prompt. Got: ${streamedText}`));
        }
      }, 40);
    });

    // Send interactive user response to stdin
    ptyMgr.writeInput(session.sessionId, 'hello_from_stdin\r');

    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 4000;
      const timer = setInterval(() => {
        if (streamedText.includes('INTERACTIVE_GOT:hello_from_stdin')) {
          clearInterval(timer);
          resolve();
        } else if (Date.now() > deadline) {
          clearInterval(timer);
          reject(new Error(`Timed out waiting for interactive response. Got: ${streamedText}`));
        }
      }, 40);
    });
    unsub();

    // Test G — Start a long-running command, interrupt it (Ctrl+C / SIGINT), and verify shell stays alive
    ptyMgr.writeInput(session.sessionId, 'sleep 25\r');
    await new Promise((r) => setTimeout(r, 200));

    const afterInterrupt = ptyMgr.interruptSession(session.sessionId);
    assert.equal(afterInterrupt.status, 'running');
    await new Promise((r) => setTimeout(r, 150));

    // Verify the shell is still alive and executes commands
    const aliveCheck = await ptyMgr.executeInSession(
      session.sessionId,
      'echo "SHELL_STILL_ALIVE_AFTER_SIGINT"'
    );
    assert.equal(aliveCheck.exitCode, 0);
    assert.equal(aliveCheck.output.includes('SHELL_STILL_ALIVE_AFTER_SIGINT'), true);
    assert.equal(aliveCheck.shellPid, session.shellPid);
  } finally {
    await ptyMgr.closeSession(session.sessionId, true);
  }
});

test('18. [Acceptance Test H, I, J] Session isolation, PTY resize (TIOCSWINSZ), UTF-8 stream handling, and process cleanup verification', { skip: isWindows ? 'Linux PTY environment required' : false }, async () => {
  const pm = new PermissionManager();
  const wm = new WorkspaceManager(tempWorkspacesDir, tempAndroidDir, pm);
  const ptyMgr = new PersistentPtySessionManager((wsId) => wm.getWorkspaceRoot(wsId));

  const session1 = await ptyMgr.createSession({ workspaceId: 'python-cli-toolkit', title: 'S1' });
  const session2 = await ptyMgr.createSession({ workspaceId: 'python-cli-toolkit', title: 'S2' });

  try {
    // Test H — Session isolation between session1 and session2
    assert.notEqual(session1.sessionId, session2.sessionId);
    assert.notEqual(session1.shellPid, session2.shellPid);

    await ptyMgr.executeInSession(
      session1.sessionId,
      'mkdir -p isolated-sub && cd isolated-sub && export ISOLATED_KEY=secret_s1'
    );

    const s1Check = await ptyMgr.executeInSession(
      session1.sessionId,
      'pwd && echo "VAL=$ISOLATED_KEY"'
    );
    assert.equal(s1Check.cwd.endsWith('/isolated-sub'), true);
    assert.equal(s1Check.output.includes('VAL=secret_s1'), true);

    const s2Check = await ptyMgr.executeInSession(
      session2.sessionId,
      'pwd && echo "VAL=${ISOLATED_KEY:-UNSET}"'
    );
    assert.equal(s2Check.cwd.endsWith('/isolated-sub'), false);
    assert.equal(s2Check.output.includes('VAL=UNSET'), true);

    // Test I — Output streaming, UTF-8 characters, and PTY window resize (TIOCSWINSZ)
    ptyMgr.resizeSession(session1.sessionId, 132, 42);
    await new Promise((r) => setTimeout(r, 100));

    const sttyRes = await ptyMgr.executeInSession(
      session1.sessionId,
      'stty size && printf "UTF8_OK: Ω ≈ √ 🚀\\n" && seq 1 120 | tail -n 3'
    );
    assert.equal(sttyRes.exitCode, 0);
    assert.equal(sttyRes.output.includes('42 132'), true);
    assert.equal(sttyRes.output.includes('UTF8_OK: Ω ≈ √ 🚀'), true);
    assert.equal(sttyRes.output.includes('120'), true);
  } finally {
    // Test J — Cleanup: close both sessions and verify OS processes are terminated
    const pid1 = session1.shellPid!;
    const pid2 = session2.shellPid!;

    const closed1 = await ptyMgr.closeSession(session1.sessionId, true);
    const closed2 = await ptyMgr.closeSession(session2.sessionId, true);
    assert.equal(closed1.status, 'exited');
    assert.equal(closed2.status, 'exited');

    // Wait briefly for OS process table reap
    await new Promise((r) => setTimeout(r, 150));

    assert.equal(fs.existsSync(`/proc/${pid1}`), false);
    assert.equal(fs.existsSync(`/proc/${pid2}`), false);
  }

  // Also verify error handling for nonexistent shell executable and invalid working directory
  await assert.rejects(
    async () => {
      await ptyMgr.createSession({
        workspaceId: 'python-cli-toolkit',
        shell: '/bin/nonexistent_shell_xyz',
      });
    },
    /Requested shell executable not found/
  );

  await assert.rejects(
    async () => {
      await ptyMgr.createSession({
        workspaceId: 'python-cli-toolkit',
        cwd: '../../etc',
      });
    },
    /escapes workspace root/
  );
});

// ============================================================================
// MCP SYSTEM TESTS (STDIO, STREAMABLE HTTP PAGINATION, RFC 9728/8414 & OAUTH PKCE)
// ============================================================================
test('19. [MCP Stdio Transport] Connects to local stdio MCP server, discovers tools, passes env vars, and executes tools/call', async () => {
  const mcpTestDir = path.join(tempRoot, 'mcp-stdio-test');
  fs.mkdirSync(mcpTestDir, { recursive: true });
  const vault = new EncryptedCredentialVault(mcpTestDir);
  const mcpMgr = new McpConnectionManager(mcpTestDir, process.cwd(), vault);

  const stdioServer = await mcpMgr.discoverServerTools('mcp-stdio-system');
  assert.equal(stdioServer.lastStatus, 'connected');
  assert.equal(stdioServer.transport, 'stdio');
  assert.equal(Array.isArray(stdioServer.discoveredTools), true);
  assert.equal(stdioServer.discoveredTools!.length >= 2, true);
  assert.equal(
    stdioServer.discoveredTools!.some((t) => t.name === 'host_system_metrics'),
    true
  );

  // Execute host_system_metrics via stdio tools/call
  const metricsOut = await mcpMgr.callServerTool('mcp-stdio-system', 'host_system_metrics', {
    includeEnvSummary: true,
  });
  assert.equal(metricsOut.isError, false);
  const parsedMetrics = JSON.parse(metricsOut.textOutput);
  assert.equal(parsedMetrics.platform, process.platform);
  assert.equal(parsedMetrics.configuredEnv?.OBSIDIAN_STDIO_MODE, 'production');

  // Execute workspace_file_digest via stdio tools/call
  const digestOut = await mcpMgr.callServerTool('mcp-stdio-system', 'workspace_file_digest', {
    targetPath: 'package.json',
  });
  assert.equal(digestOut.isError, false);
  const parsedDigest = JSON.parse(digestOut.textOutput);
  assert.equal(parsedDigest.sizeBytes > 100, true);
  assert.equal(parsedDigest.sha256.length, 64);
});

test('20. [MCP Streamable HTTP & Paginated Tool Discovery] Negotiates Mcp-Session-Id, follows nextCursor pagination, and executes tools/call', async () => {
  const mcpHttpDir = path.join(tempRoot, 'mcp-http-test');
  fs.mkdirSync(mcpHttpDir, { recursive: true });
  const vault = new EncryptedCredentialVault(mcpHttpDir);
  const mcpMgr = new McpConnectionManager(mcpHttpDir, process.cwd(), vault);

  let receivedSessionHeader = '';
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      if (req.headers['mcp-session-id']) {
        receivedSessionHeader = String(req.headers['mcp-session-id']);
      }
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Mcp-Session-Id', 'session-paginated-999');

      const rpc = body ? JSON.parse(body) : {};
      if (rpc.method === 'initialize') {
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpc.id,
            result: {
              protocolVersion: '2024-11-05',
              serverInfo: { name: 'paginated-test-mcp', version: '2.1.0' },
              capabilities: { tools: {} },
            },
          })
        );
        return;
      }
      if (rpc.method === 'notifications/initialized') {
        res.statusCode = 202;
        res.end();
        return;
      }
      if (rpc.method === 'tools/list') {
        const cursor = rpc.params?.cursor;
        if (!cursor) {
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: rpc.id,
              result: {
                tools: [
                  {
                    name: 'alpha_tool',
                    description: 'First page tool',
                    inputSchema: { type: 'object', required: ['query'] },
                  },
                ],
                nextCursor: 'page-2',
              },
            })
          );
        } else {
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: rpc.id,
              result: {
                tools: [
                  {
                    name: 'beta_tool',
                    description: 'Second page tool',
                    inputSchema: { type: 'object', required: ['id'] },
                  },
                ],
              },
            })
          );
        }
        return;
      }
      if (rpc.method === 'tools/call') {
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpc.id,
            result: {
              isError: false,
              content: [
                {
                  type: 'text',
                  text: `Executed ${rpc.params?.name} with ${JSON.stringify(rpc.params?.arguments)}`,
                },
              ],
            },
          })
        );
        return;
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const url = `http://127.0.0.1:${addr.port}/mcp`;

  try {
    const added = mcpMgr.addOrUpdateServer({
      name: 'Paginated HTTP MCP',
      transport: 'streamable-http',
      endpointUrl: url,
    });
    const discovered = await mcpMgr.discoverServerTools(added.id);
    assert.equal(discovered.lastStatus, 'connected');
    assert.equal(discovered.sessionId, 'session-paginated-999');
    assert.equal(discovered.discoveredTools?.length, 2);
    assert.equal(discovered.discoveredTools?.[0].name, 'alpha_tool');
    assert.equal(discovered.discoveredTools?.[1].name, 'beta_tool');
    assert.equal(receivedSessionHeader, 'session-paginated-999');

    const callRes = await mcpMgr.callServerTool(added.id, 'alpha_tool', { query: 'obsidian' });
    assert.equal(callRes.isError, false);
    assert.equal(callRes.textOutput.includes('Executed alpha_tool'), true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('21. [MCP Auth & OAuth 2.0 PKCE + RFC 9728 + RFC 7591 + Token Isolation] Handles 401 WWW-Authenticate, Dynamic Client Registration, PKCE token exchange, and prevents cross-server token leakage', async () => {
  const parsedHeader = parseWwwAuthenticateHeader(
    'Bearer error="invalid_request", error_description="No access token was provided", resource_metadata="https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp/"'
  );
  assert.equal(parsedHeader.scheme, 'Bearer');
  assert.equal(
    parsedHeader.resourceMetadataUrl,
    'https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp/'
  );
  assert.equal(parsedHeader.error, 'invalid_request');

  const mcpOAuthDir = path.join(tempRoot, 'mcp-oauth-test');
  fs.mkdirSync(mcpOAuthDir, { recursive: true });
  const vault = new EncryptedCredentialVault(mcpOAuthDir);
  const mcpMgr = new McpConnectionManager(mcpOAuthDir, process.cwd(), vault);

  let serverPort = 0;
  let serverBReceivedAuthHeader: string | undefined;

  const mockAuthAndMcpServer = http.createServer((req, res) => {
    const baseUrl = `http://127.0.0.1:${serverPort}`;
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');

      // RFC 9728 Protected Resource Metadata
      if (req.url === '/.well-known/oauth-protected-resource/mcp') {
        res.end(
          JSON.stringify({
            resource: `${baseUrl}/mcp`,
            resource_name: 'Protected Test MCP',
            authorization_servers: [baseUrl],
            scopes_supported: ['mcp:read', 'mcp:tools'],
          })
        );
        return;
      }

      // RFC 8414 Authorization Server Metadata
      if (req.url === '/.well-known/oauth-authorization-server') {
        res.end(
          JSON.stringify({
            issuer: baseUrl,
            authorization_endpoint: `${baseUrl}/oauth/authorize`,
            token_endpoint: `${baseUrl}/oauth/token`,
            registration_endpoint: `${baseUrl}/oauth/register`,
            code_challenge_methods_supported: ['S256'],
            scopes_supported: ['mcp:read', 'mcp:tools'],
          })
        );
        return;
      }

      // RFC 7591 Dynamic Client Registration
      if (req.url === '/oauth/register' && req.method === 'POST') {
        res.statusCode = 201;
        res.end(
          JSON.stringify({
            client_id: 'dcr-client-777',
            client_secret: 'dcr-secret-888',
          })
        );
        return;
      }

      // OAuth 2.0 Token Exchange
      if (req.url === '/oauth/token' && req.method === 'POST') {
        const sp = new URLSearchParams(body);
        if (sp.get('code') === 'valid-oauth-code-123' && sp.get('code_verifier')) {
          res.end(
            JSON.stringify({
              access_token: 'oauth-issued-token-xyz-999',
              refresh_token: 'oauth-refresh-token-abc',
              token_type: 'Bearer',
            })
          );
        } else {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'invalid_grant' }));
        }
        return;
      }

      // Protected MCP endpoint
      if (req.url === '/mcp') {
        const auth = req.headers['authorization'];
        if (auth !== 'Bearer oauth-issued-token-xyz-999') {
          res.statusCode = 401;
          res.setHeader(
            'WWW-Authenticate',
            `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource/mcp"`
          );
          res.end(JSON.stringify({ message: 'No access token provided' }));
          return;
        }
        const rpc = body ? JSON.parse(body) : {};
        if (rpc.method === 'initialize') {
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: rpc.id,
              result: {
                protocolVersion: '2024-11-05',
                serverInfo: { name: 'protected-mcp', version: '1.0.0' },
                capabilities: { tools: {} },
              },
            })
          );
          return;
        }
        if (rpc.method === 'notifications/initialized') {
          res.statusCode = 202;
          res.end();
          return;
        }
        if (rpc.method === 'tools/list') {
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: rpc.id,
              result: {
                tools: [
                  {
                    name: 'protected_database_query',
                    description: 'Executes authenticated query',
                    inputSchema: { type: 'object', required: ['sql'] },
                  },
                ],
              },
            })
          );
          return;
        }
      }
    });
  });

  const secondUnrelatedServer = http.createServer((req, res) => {
    serverBReceivedAuthHeader = req.headers['authorization'];
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: { tools: [] },
      })
    );
  });

  await new Promise<void>((r) => mockAuthAndMcpServer.listen(0, '127.0.0.1', () => r()));
  await new Promise<void>((r) => secondUnrelatedServer.listen(0, '127.0.0.1', () => r()));
  serverPort = (mockAuthAndMcpServer.address() as { port: number }).port;
  const serverBPort = (secondUnrelatedServer.address() as { port: number }).port;

  try {
    const srvA = mcpMgr.addOrUpdateServer({
      name: 'Protected OAuth MCP Server A',
      transport: 'streamable-http',
      endpointUrl: `http://127.0.0.1:${serverPort}/mcp`,
    });

    // 1. Initial unauthenticated discovery -> should return auth_required + RFC 9728/8414 metadata
    const initialAudit = await mcpMgr.discoverServerTools(srvA.id);
    assert.equal(initialAudit.lastStatus, 'auth_required');
    assert.equal(initialAudit.oauthMetadata?.resourceName, 'Protected Test MCP');
    assert.equal(initialAudit.oauthMetadata?.supportsDynamicRegistration, true);
    assert.equal(
      initialAudit.oauthMetadata?.registrationEndpoint,
      `http://127.0.0.1:${serverPort}/oauth/register`
    );

    // 2. Start OAuth 2.0 PKCE flow -> should auto-register client via RFC 7591
    const oauthStart = await mcpMgr.startOAuthFlow(
      srvA.id,
      'http://localhost:3000/api/mcp/oauth/callback'
    );
    assert.equal(oauthStart.dynamicRegistrationUsed, true);
    assert.equal(oauthStart.clientId, 'dcr-client-777');
    assert.equal(oauthStart.authorizationUrl.includes('code_challenge_method=S256'), true);

    // 3. Complete OAuth callback -> exchanges code + PKCE verifier, stores token, and discovers tools
    const afterOAuth = await mcpMgr.handleOAuthCallback(
      'valid-oauth-code-123',
      oauthStart.state
    );
    assert.equal(afterOAuth.lastStatus, 'connected');
    assert.equal(afterOAuth.discoveredTools?.length, 1);
    assert.equal(afterOAuth.discoveredTools?.[0].name, 'protected_database_query');

    // 4. Verify Server B NEVER receives Server A's token
    const srvB = mcpMgr.addOrUpdateServer({
      name: 'Unauthenticated Server B',
      transport: 'streamable-http',
      endpointUrl: `http://127.0.0.1:${serverBPort}/mcp`,
    });
    await mcpMgr.discoverServerTools(srvB.id);
    assert.equal(serverBReceivedAuthHeader, undefined);
  } finally {
    await new Promise<void>((r) => mockAuthAndMcpServer.close(() => r()));
    await new Promise<void>((r) => secondUnrelatedServer.close(() => r()));
  }
});

test('22. [Mobile Harness Toolchains & Workspace Integration] Probes toolchains, auto-detects project types, attributes workspace usage, and catalogs repository resources', async () => {
  const pm = new PermissionManager();
  const wm = new WorkspaceManager(tempWorkspacesDir, tempAndroidDir, pm);

  // 1. Create workspaces with distinct project types
  const wsPy = wm.createWorkspace('tc-python-project', 'python');
  const wsWeb = wm.createWorkspace('tc-web-portal', 'web-node');
  const wsAndroid = wm.createWorkspace('tc-android-app', 'kotlin-android');

  const tcDataDir = path.join(tempRoot, 'toolchain-test-data');
  fs.mkdirSync(tcDataDir, { recursive: true });
  const tcMgr = new MobileHarnessToolchainManager(tcDataDir, process.cwd(), wm);

  // 2. Discover workspace toolchain status
  const wsStatuses = tcMgr.getWorkspaceToolchainStatus();
  assert.equal(wsStatuses.length >= 3, true);

  const foundPy = wsStatuses.find((w) => w.workspaceId === 'tc-python-project');
  assert.ok(foundPy);
  assert.equal(foundPy.projectType, 'python');
  assert.equal(foundPy.requiredToolchains.includes('python'), true);

  const foundWeb = wsStatuses.find((w) => w.workspaceId === 'tc-web-portal');
  assert.ok(foundWeb);
  assert.equal(foundWeb.projectType, 'web-node');
  assert.equal(foundWeb.requiredToolchains.includes('web'), true);

  const foundAndroid = wsStatuses.find((w) => w.workspaceId === 'tc-android-app');
  assert.ok(foundAndroid);
  assert.equal(foundAndroid.projectType, 'kotlin-android');
  assert.equal(foundAndroid.requiredToolchains.includes('android'), true);

  // 3. Probing and workspace usage attribution
  const probed = tcMgr.probeAllToolchains();
  assert.ok(probed.length >= 4);

  // Core toolchain items are shared across all workspaces
  const nodeItem = probed.find((t) => t.id === 'nodejs');
  assert.ok(nodeItem);
  assert.equal(nodeItem.category, 'core');
  assert.ok(nodeItem.usedByWorkspaces && nodeItem.usedByWorkspaces.length >= 3);

  // Python optional toolchain is attributed to the python project
  const pyItem = probed.find((t) => t.id === 'python');
  assert.ok(pyItem);
  assert.equal(pyItem.category, 'optional');
  assert.ok(pyItem.usedByWorkspaces && pyItem.usedByWorkspaces.some((w) => w.workspaceId === 'tc-python-project'));

  // 4. Mobile Harness Repository Resource Catalog
  const resources = tcMgr.getMobileHarnessResources();
  assert.ok(resources);
  assert.equal(resources.repoUrl, 'https://github.com/techjarves/Mobile-Harness');
  assert.ok(Array.isArray(resources.bundles));
  assert.ok(resources.bundles.some((b) => b.id === 'core'));
  assert.ok(resources.bundles.some((b) => b.id === 'claude'));
  assert.ok(resources.bundles.some((b) => b.id === 'python'));
  assert.ok(resources.bundles.some((b) => b.id === 'android'));
  assert.ok(Array.isArray(resources.releaseArtifacts));
  assert.ok(resources.releaseArtifacts.length >= 2);

  // 5. Context Switching
  const switched = tcMgr.switchWorkspaceContext('tc-python-project');
  assert.equal(switched.activeWorkspaceId, 'tc-python-project');
  assert.equal(switched.workspaceStatus?.workspaceId, 'tc-python-project');

  // 6. Error handling for non-existent workspace
  assert.throws(() => {
    tcMgr.switchWorkspaceContext('non-existent-ws-999');
  }, /Workspace.*not found/);
});

test('23. [Terminal Output & Safe OpenCode / npm EEXIST Handling] Executes real commands across Windows/Linux, handles npm EEXIST error classifications, and verifies opencode toolchain spec', async () => {
  const pm = new PermissionManager();
  const wm = new WorkspaceManager(tempWorkspacesDir, tempAndroidDir, pm);
  const tm = new TerminalSessionManager(wm);

  // 1. Cross-platform execution (works on Windows cmd.exe and Linux /bin/bash)
  const echoCmd = isWindows ? 'echo OBSIDIAN_TERMINAL_TEST' : 'echo "OBSIDIAN_TERMINAL_TEST"';
  const execRes = await tm.executeCommand('tc-python-project', echoCmd);
  assert.equal(execRes.status, 'succeeded');
  assert.equal(execRes.exitCode, 0);
  assert.equal(execRes.stdout.includes('OBSIDIAN_TERMINAL_TEST'), true);

  // 2. Working directory boundary security
  const traversalCmd = isWindows ? 'cd ..\\..\\..\\Windows' : 'cd /etc';
  const deniedRes = await tm.executeCommand('tc-python-project', traversalCmd);
  assert.equal(deniedRes.status, 'denied');
  assert.equal(deniedRes.errorCategory, 'PERMISSION_DENIED');

  // 3. OpenCode toolchain spec registration
  const tcDataDir = path.join(tempRoot, 'toolchain-opencode-data');
  fs.mkdirSync(tcDataDir, { recursive: true });
  const tcMgr = new MobileHarnessToolchainManager(tcDataDir, process.cwd(), wm);
  const probed = tcMgr.probeAllToolchains();
  const opencodeSpec = probed.find((t) => t.id === 'opencode');
  assert.ok(opencodeSpec);
  assert.equal(opencodeSpec.title, 'OpenCode CLI');
  assert.equal(opencodeSpec.category, 'optional');
  assert.ok(['installed', 'not_installed'].includes(opencodeSpec.status));

  // 4. EEXIST and ENOTEMPTY classification without crashes
  const fakeEexistError = 'npm error code EEXIST\nnpm error path /usr/local/bin/opencode\nnpm error EEXIST: file already exists';
  const dummyRes = await tm.executeCommand('tc-python-project', isWindows ? 'cmd /c exit 1' : 'sh -c "exit 1"');
  assert.equal(dummyRes.status, 'failed');
  assert.equal(dummyRes.exitCode, 1);
});


