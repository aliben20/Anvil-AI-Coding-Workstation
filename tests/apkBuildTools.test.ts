import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  WorkspaceManager,
  TerminalSessionManager,
  PermissionManager,
  MemoryAndMcpManager,
  BuildServiceManager,
  BoundedAgentLoopRunner,
  AgentActivityEvent,
} from '../src/server/workstationEngine.js';

const ROOT_DIR = process.cwd();
const TEST_DATA_DIR = path.join(ROOT_DIR, '.anvil-data', 'test-apk-build');
const WORKSPACES_DIR = path.join(ROOT_DIR, 'workspaces');
const ANDROID_NATIVE_DIR = path.join(ROOT_DIR, 'android-workstation');

fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

test('1. BuildServiceManager probes host Android toolchain (JDK + Android SDK)', () => {
  const pm = new PermissionManager();
  const wm = new WorkspaceManager(WORKSPACES_DIR, ANDROID_NATIVE_DIR, pm, TEST_DATA_DIR);
  const tm = new TerminalSessionManager(wm);
  const bsm = new BuildServiceManager(wm, tm, TEST_DATA_DIR);

  const tc = bsm.probeAndroidToolchain();
  assert.equal(typeof tc.isAvailable, 'boolean');
  assert.equal(typeof tc.diagnostic, 'string');
  if (tc.isAvailable) {
    assert.equal(Boolean(tc.androidJarPath && fs.existsSync(tc.androidJarPath)), true);
    assert.equal(Boolean(tc.aapt2Path && fs.existsSync(tc.aapt2Path)), true);
    assert.equal(Boolean(tc.d8Path && fs.existsSync(tc.d8Path)), true);
    assert.equal(Boolean(tc.zipalignPath && fs.existsSync(tc.zipalignPath)), true);
  }
});

test('2. BuildServiceManager builds real release APK for kotlin-notes-apk with small file size optimization', async () => {
  const pm = new PermissionManager();
  const wm = new WorkspaceManager(WORKSPACES_DIR, ANDROID_NATIVE_DIR, pm, TEST_DATA_DIR);
  const tm = new TerminalSessionManager(wm);
  const bsm = new BuildServiceManager(wm, tm, TEST_DATA_DIR);

  const tc = bsm.probeAndroidToolchain();
  if (!tc.isAvailable) {
    console.log('Skipping APK build test: Android SDK/JDK not available in this test runner environment');
    return;
  }

  const emittedStates: string[] = [];
  const buildResult = await bsm.buildAndroidApk('kotlin-notes-apk', {
    variant: 'release',
    optimizeSize: true,
    onProgress: (ev) => {
      emittedStates.push(ev.state);
    },
  });

  assert.equal(buildResult.status, 'SUCCEEDED');
  assert.equal(buildResult.exitCode, 0);
  assert.equal(Boolean(buildResult.artifactPath && fs.existsSync(buildResult.artifactPath)), true);
  assert.equal(typeof buildResult.artifactSizeBytes, 'number');
  assert.equal(buildResult.artifactSizeBytes! > 500, true);
  // Small size optimization verification: APK should be under 50 KB (typically ~1.3 KB)
  assert.equal(buildResult.artifactSizeBytes! < 50 * 1024, true);

  // Verification report
  assert.equal(Boolean(buildResult.apkVerification), true);
  assert.equal(buildResult.apkVerification!.isZipContainer, true);
  assert.equal(buildResult.apkVerification!.containsAndroidManifest, true);
  assert.equal(buildResult.apkVerification!.containsClassesDex, true);
  assert.equal(buildResult.apkVerification!.verified, true);
  assert.equal(typeof buildResult.apkVerification!.sha256Hex, 'string');

  // Verify activity states were emitted
  assert.equal(emittedStates.includes('COMPILING_RESOURCES'), true);
  assert.equal(emittedStates.includes('COMPILING_CODE'), true);
  assert.equal(emittedStates.includes('PACKAGING_APK'), true);
  assert.equal(emittedStates.includes('COMPLETED'), true);
});

test('3. BuildServiceManager verifies APK container integrity and flags non-existent files', () => {
  const pm = new PermissionManager();
  const wm = new WorkspaceManager(WORKSPACES_DIR, ANDROID_NATIVE_DIR, pm, TEST_DATA_DIR);
  const tm = new TerminalSessionManager(wm);
  const bsm = new BuildServiceManager(wm, tm, TEST_DATA_DIR);

  const missing = bsm.verifyApkArtifact('non-existent-test-path.apk');
  assert.equal(missing.exists, false);
  assert.equal(missing.verified, false);

  const existingApkPath = path.join(
    WORKSPACES_DIR,
    'kotlin-notes-apk',
    'app',
    'build',
    'outputs',
    'apk',
    'release',
    'kotlin-notes-apk-release.apk'
  );

  if (fs.existsSync(existingApkPath)) {
    const verified = bsm.verifyApkArtifact(existingApkPath);
    assert.equal(verified.exists, true);
    assert.equal(verified.isZipContainer, true);
    assert.equal(verified.containsAndroidManifest, true);
    assert.equal(verified.containsClassesDex, true);
    assert.equal(verified.verified, true);
    assert.equal(typeof verified.sha256Hex, 'string');
    assert.equal(verified.sizeBytes > 0, true);
  }
});

test('4. BoundedAgentLoopRunner executes check_toolchain, build_apk, and verify_apk tools end-to-end', async () => {
  const pm = new PermissionManager();
  const wm = new WorkspaceManager(WORKSPACES_DIR, ANDROID_NATIVE_DIR, pm, TEST_DATA_DIR);
  const tm = new TerminalSessionManager(wm);
  const mmm = new MemoryAndMcpManager(TEST_DATA_DIR);
  const bsm = new BuildServiceManager(wm, tm, TEST_DATA_DIR);
  const runner = new BoundedAgentLoopRunner(wm, tm, pm, mmm, bsm);

  const tc = bsm.probeAndroidToolchain();
  if (!tc.isAvailable) {
    console.log('Skipping agent loop tool execution test: Android SDK/JDK not available');
    return;
  }

  const activities: AgentActivityEvent[] = [];
  const onEmitActivity = (ev: any) => {
    activities.push(ev);
  };

  // Test tool 1: check_toolchain
  const toolchainRes = await runner.executeSingleTool({
    conversationId: 'test-conv',
    workspaceId: 'kotlin-notes-apk',
    toolName: 'check_toolchain',
    rawArgs: {},
    commandTimeoutMs: 15_000,
    signal: new AbortController().signal,
    onEmitActivity,
  });
  assert.equal(toolchainRes.status, 'succeeded');
  assert.equal(toolchainRes.output!.includes('Available: YES'), true);

  // Test tool 2: build_apk
  const buildRes = await runner.executeSingleTool({
    conversationId: 'test-conv',
    workspaceId: 'kotlin-notes-apk',
    toolName: 'build_apk',
    rawArgs: { variant: 'release', optimize_size: true },
    commandTimeoutMs: 60_000,
    signal: new AbortController().signal,
    onEmitActivity,
  });
  assert.equal(buildRes.status, 'succeeded');
  assert.equal(buildRes.output!.includes('Build Status: SUCCEEDED'), true);
  assert.equal(buildRes.output!.includes('APK Container Valid: true'), true);
  assert.equal(buildRes.output!.includes('Contains classes.dex: true'), true);

  // Test tool 3: verify_apk
  const verifyRes = await runner.executeSingleTool({
    conversationId: 'test-conv',
    workspaceId: 'kotlin-notes-apk',
    toolName: 'verify_apk',
    rawArgs: {},
    commandTimeoutMs: 15_000,
    signal: new AbortController().signal,
    onEmitActivity,
  });
  assert.equal(verifyRes.status, 'succeeded');
  assert.equal(verifyRes.output!.includes('Verification Result: PASSED'), true);
  assert.equal(verifyRes.output!.includes('Valid ZIP Container: true'), true);
  assert.equal(verifyRes.output!.includes('Contains classes.dex: true'), true);
});

test('5. verifyApkArtifact verifies real android-workstation-debug.apk without false positives or intent actions', () => {
  const pm = new PermissionManager();
  const wm = new WorkspaceManager(WORKSPACES_DIR, ANDROID_NATIVE_DIR, pm, TEST_DATA_DIR);
  const tm = new TerminalSessionManager(wm);
  const bsm = new BuildServiceManager(wm, tm, TEST_DATA_DIR);

  const nativeApkPath = path.join(
    ANDROID_NATIVE_DIR,
    'app',
    'build',
    'outputs',
    'apk',
    'debug',
    'app-debug.apk'
  );

  if (fs.existsSync(nativeApkPath)) {
    const report = bsm.verifyApkArtifact(nativeApkPath);
    assert.equal(report.exists, true);
    assert.equal(report.isZipContainer, true);
    assert.equal(report.containsAndroidManifest, true);
    assert.equal(report.containsClassesDex, true);
    assert.equal(report.verified, true);
    assert.equal(report.verifiedPackageName, 'io.anvil.workstation.debug');
    assert.equal(report.packageNameHint, 'io.anvil.workstation.debug');
    // Ensure intent action is NOT matched
    assert.equal(report.packageNameHint?.includes('PICK_IMAGES'), false);
    assert.equal(report.packageNameHint?.includes('.action.'), false);
    assert.equal(report.isSigned, true);
    assert.equal(typeof report.sha256Hex, 'string');
    assert.equal(report.sizeBytes > 10 * 1024 * 1024, true);
  }
});

test('6. BuildServiceManager fails immediately when compiler or manifest errors occur', async () => {
  const pm = new PermissionManager();
  const wm = new WorkspaceManager(WORKSPACES_DIR, ANDROID_NATIVE_DIR, pm, TEST_DATA_DIR);
  const tm = new TerminalSessionManager(wm);
  const bsm = new BuildServiceManager(wm, tm, TEST_DATA_DIR);

  // Attempting to build a non-existent or invalid workspace should fail cleanly
  const res = await bsm.buildAndroidApk('j-j');
  assert.equal(res.status, 'FAILED');
  assert.notEqual(res.exitCode, 0);
  assert.equal(res.artifactPath, null);
  assert.equal(res.apkVerification, null);
});
