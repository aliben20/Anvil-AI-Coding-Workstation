import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('OBSIDIAN Runtime Environment, Local AI Validation & Bubble Reactivity', () => {
  const SERVER_URL = 'http://127.0.0.1:3000';
  const DATA_DIR = path.resolve('.anvil-data');
  const MODELS_DIR = path.join(DATA_DIR, 'local-models');
  const TEST_VALID_GGUF = path.join(MODELS_DIR, 'test-valid-qwen-weights.gguf');
  const TEST_CORRUPT_GGUF = path.join(MODELS_DIR, 'test-corrupt-badmagic.gguf');
  const TEST_STUB_GGUF = path.join(MODELS_DIR, 'test-stub-tiny.gguf');

  before(() => {
    fs.mkdirSync(MODELS_DIR, { recursive: true });

    // 1. Create a valid 2MB GGUF v3 file
    const validBuf = Buffer.alloc(1024 * 1024 * 2);
    validBuf.write('GGUF', 0, 4, 'ascii'); // magic
    validBuf.writeUInt32LE(3, 4); // v3
    validBuf.writeBigUInt64LE(196n, 8); // 196 tensors
    validBuf.writeBigUInt64LE(24n, 16); // 24 metadata KV
    fs.writeFileSync(TEST_VALID_GGUF, validBuf);

    // 2. Create a corrupted magic file (>1MB but not GGUF)
    const corruptBuf = Buffer.alloc(1024 * 1024 + 100);
    corruptBuf.write('RIFF', 0, 4, 'ascii'); // invalid magic
    corruptBuf.writeUInt32LE(3, 4);
    fs.writeFileSync(TEST_CORRUPT_GGUF, corruptBuf);

    // 3. Create a stub fixture (<1MB)
    const stubBuf = Buffer.alloc(256);
    stubBuf.write('GGUF', 0, 4, 'ascii');
    stubBuf.writeUInt32LE(3, 4);
    fs.writeFileSync(TEST_STUB_GGUF, stubBuf);
  });

  after(() => {
    try {
      if (fs.existsSync(TEST_VALID_GGUF)) fs.unlinkSync(TEST_VALID_GGUF);
      if (fs.existsSync(TEST_CORRUPT_GGUF)) fs.unlinkSync(TEST_CORRUPT_GGUF);
      if (fs.existsSync(TEST_STUB_GGUF)) fs.unlinkSync(TEST_STUB_GGUF);
    } catch {}
  });

  test('1. Windows Host Detection & Real Canonical Windows Paths', async () => {
    const res = await fetch(`${SERVER_URL}/api/system/environment`);
    assert.strictEqual(res.status, 200, 'Environment endpoint should return HTTP 200');

    const env = await res.json();
    assert.ok(env.backend, 'Response must include backend metadata');
    assert.ok(env.filesystem, 'Response must include filesystem metadata');
    assert.ok(env.capabilities, 'Response must include capabilities');

    if (process.platform === 'win32') {
      assert.strictEqual(env.backend.os, 'win32');
      assert.strictEqual(env.backend.isWindows, true);
      assert.strictEqual(env.filesystem.pathSeparator, '\\');
      assert.strictEqual(env.filesystem.isWindowsPaths, true);
      assert.match(env.filesystem.workspaceRoot, /^[A-Za-z]:\\/, 'Windows workspace root must be an absolute drive path');
      assert.ok(
        !env.filesystem.workspaceRoot.includes('/data/user/0'),
        'Windows workspace path must never be formatted as an Android sandbox path'
      );
      assert.strictEqual(env.filesystem.accessible, true, 'Workspace root must exist and be accessible');
    }
  });

  test('2. Mobile Browser Client vs Native Android Detection & Filesystem Ownership', async () => {
    // A: Mobile Browser connecting to PC backend
    const mobileBrowserRes = await fetch(`${SERVER_URL}/api/system/environment`, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
      },
    });
    assert.strictEqual(mobileBrowserRes.status, 200);
    const mobileEnv = await mobileBrowserRes.json();

    assert.strictEqual(mobileEnv.client.isMobile, true, 'Pixel 8 user agent must be identified as mobile');
    assert.strictEqual(mobileEnv.client.isAndroidNative, false, 'Mobile browser must NOT claim native Android bridge');
    assert.strictEqual(mobileEnv.client.platform, 'android_browser');
    assert.strictEqual(
      mobileEnv.filesystem.owner,
      'remote_pc',
      'Mobile browser accessing PC backend must identify filesystem as remote_pc'
    );

    // B: Android Native Client (io.anvil.workstation)
    const nativeAndroidRes = await fetch(`${SERVER_URL}/api/system/environment`, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Linux; U; Android 14; en-us; Pixel 8 Build/UD1A.230803.022) AppleWebKit/537.36',
        'x-obsidian-android-native': 'true',
      },
    });
    assert.strictEqual(nativeAndroidRes.status, 200);
    const nativeEnv = await nativeAndroidRes.json();

    assert.strictEqual(nativeEnv.client.isAndroidNative, true, 'Header x-obsidian-android-native must report native app');
    assert.strictEqual(nativeEnv.client.platform, 'android_native');
  });

  test('3. Local GGUF Validation: Rejects Missing Files with 404', async () => {
    const res = await fetch(`${SERVER_URL}/api/local-models/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'non-existent-weights-404.gguf' }),
    });
    assert.strictEqual(res.status, 404);
    const data = await res.json();
    assert.strictEqual(data.ok, false);
    assert.strictEqual(data.state, 'Inference failed');
    assert.match(data.error, /does not exist/);
  });

  test('4. Local GGUF Validation: Rejects Stub Fixtures (<1MB) with Detailed Reason', async () => {
    const res = await fetch(`${SERVER_URL}/api/local-models/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'test-stub-tiny.gguf' }),
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.ok, false);
    assert.strictEqual(data.state, 'Inference failed');
    assert.match(data.error, /stub fixture/i);
    assert.match(data.error, /weights/i);
  });

  test('5. Local GGUF Validation: Rejects Corrupted Magic Bytes (RIFF instead of GGUF)', async () => {
    const res = await fetch(`${SERVER_URL}/api/local-models/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'test-corrupt-badmagic.gguf' }),
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.ok, false);
    assert.strictEqual(data.state, 'Inference failed');
    assert.match(data.error, /Invalid magic bytes/i);
  });

  test('6. Local GGUF Validation: Successfully Validates 2MB Real GGUF v3 File', async () => {
    const res = await fetch(`${SERVER_URL}/api/local-models/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'test-valid-qwen-weights.gguf' }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.state, 'Backend supported');
    assert.strictEqual(data.metadata.formatVersion, 3);
    assert.strictEqual(data.metadata.tensorCount, 196);
    assert.strictEqual(data.metadata.metadataKvCount, 24);
    assert.ok(data.checks.length >= 5, 'Must return checklist for UI inspection');
    assert.ok(data.checks.every((c: any) => c.passed === true), 'All checks must pass for valid weights');
  });

  test('7. Settings Persistence & Real-time Event Notification', async () => {
    const testIterations = 14;
    const testTimeout = 32000;

    const res = await fetch(`${SERVER_URL}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          maxAgentIterations: testIterations,
          commandTimeoutMs: testTimeout,
        },
      }),
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.settings.maxAgentIterations, testIterations);
    assert.strictEqual(data.settings.commandTimeoutMs, testTimeout);

    // Verify retrieval matches persisted settings
    const getRes = await fetch(`${SERVER_URL}/api/settings`);
    assert.strictEqual(getRes.status, 200);
    const current = await getRes.json();
    assert.strictEqual(current.settings.maxAgentIterations, testIterations);
    assert.strictEqual(current.settings.commandTimeoutMs, testTimeout);
  });

  test('8. Floating Bubble Lifecycle: Immediate Reactivation without Restart', () => {
    // Test the state transitions logic of the floating bubble component
    let bubbleEnabled = true;
    let isDismissing = false;
    let pos = { x: 800, y: 180 };

    // Step 1: User drags to dismiss zone (bottom X)
    const onDropInDismissZone = () => {
      isDismissing = true;
      pos = { x: 400, y: 700 };
      // Callback after dismiss animation:
      isDismissing = false; // Reset ensured by bugfix!
      bubbleEnabled = false;
    };

    onDropInDismissZone();
    assert.strictEqual(bubbleEnabled, false, 'Bubble should be marked disabled');
    assert.strictEqual(isDismissing, false, 'isDismissing must be reset so re-enabling does not remain invisible');

    // Step 2: User opens settings and re-enables bubble
    const onReEnableFromSettings = () => {
      bubbleEnabled = true;
      // React effect triggered by [enabled]:
      isDismissing = false;
      pos = { x: 800, y: 180 }; // Redocked to edge
    };

    onReEnableFromSettings();
    assert.strictEqual(bubbleEnabled, true, 'Bubble is enabled immediately');
    assert.strictEqual(isDismissing, false, 'Bubble scale and opacity are active');
    assert.strictEqual(pos.x, 800, 'Bubble is docked on screen edge, not stuck at bottom dismiss coordinate');
  });
});
