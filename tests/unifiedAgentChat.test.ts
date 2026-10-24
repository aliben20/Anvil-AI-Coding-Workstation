import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import http from 'http';
import {
  WorkspaceManager,
  TerminalSessionManager,
  PermissionManager,
  MemoryAndMcpManager,
  BuildServiceManager,
  BoundedAgentLoopRunner,
  AgentActivityEvent,
} from '../src/server/workstationEngine.js';
import { MobileHarnessToolchainManager } from '../src/server/toolchainManager.js';

const ROOT_DIR = process.cwd();
const TEST_DATA_DIR = path.join(ROOT_DIR, '.anvil-data', 'test-unified-agent');
const WORKSPACES_DIR = path.join(ROOT_DIR, 'workspaces');
const ANDROID_NATIVE_DIR = path.join(ROOT_DIR, 'android-workstation');

fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

process.env.ANVIL_TEST_MODE = '1';
const { createApp } = await import('../server.js');

test('1. BoundedAgentLoopRunner executes audit_manifest tool on Android workspace', async () => {
  const pm = new PermissionManager();
  const wm = new WorkspaceManager(WORKSPACES_DIR, ANDROID_NATIVE_DIR, pm, TEST_DATA_DIR);
  const tm = new TerminalSessionManager(wm);
  const bsm = new BuildServiceManager(wm, tm, TEST_DATA_DIR);
  const mm = new MemoryAndMcpManager(TEST_DATA_DIR);
  const tcm = new MobileHarnessToolchainManager(TEST_DATA_DIR, ROOT_DIR, wm);
  const runner = new BoundedAgentLoopRunner(wm, tm, pm, mm, bsm, tcm);

  const res = await runner.executeSingleTool({
    conversationId: 'test-conv',
    workspaceId: 'kotlin-notes-apk',
    toolName: 'audit_manifest',
    rawArgs: {},
    commandTimeoutMs: 5000,
    signal: new AbortController().signal,
  });

  assert.equal(res.status, 'succeeded');
  assert.equal(typeof res.output, 'string');
  assert.equal(res.output?.includes('Package Name: io.anvil.notes'), true);
  assert.equal(res.output?.includes('SHA-256:'), true);
});

test('2. Simple conversational message returns pure text without executing tools', async () => {
  const pm = new PermissionManager();
  const wm = new WorkspaceManager(WORKSPACES_DIR, ANDROID_NATIVE_DIR, pm, TEST_DATA_DIR);
  const tm = new TerminalSessionManager(wm);
  const bsm = new BuildServiceManager(wm, tm, TEST_DATA_DIR);
  const mm = new MemoryAndMcpManager(TEST_DATA_DIR);
  const runner = new BoundedAgentLoopRunner(wm, tm, pm, mm, bsm);

  const executedTools: string[] = [];
  const result = await runner.runAgentLoop({
    conversationId: 'test-greeting',
    workspaceId: 'kotlin-notes-apk',
    messages: [{ id: 'm1', role: 'user', content: 'hi', timestampMillis: Date.now() }],
    enableAgentTools: true,
    systemInstruction: 'You are OBSIDIAN AI coding assistant.',
    maxIterations: 5,
    maxToolCalls: 10,
    commandTimeoutMs: 5000,
    signal: new AbortController().signal,
    modelTurnGenerator: async ({ iteration }: { iteration: number }) => {
      if (iteration === 1) {
        return { text: 'Hello! How can I help you with your Android project today?' };
      }
      return { text: 'Done.' };
    },
    onEmitActivity: (ev: any) => {
      if (ev.toolName) executedTools.push(ev.toolName);
    },
  });

  assert.equal(result.taskState, 'completed');
  assert.equal(result.toolCalls.length, 0);
  assert.equal(executedTools.length, 0);
  assert.equal(result.finalText.includes('Hello! How can I help you'), true);
});

test('3. APK Build request triggers check_toolchain, build_apk, and verify_apk with small size output', async () => {
  const pm = new PermissionManager();
  const wm = new WorkspaceManager(WORKSPACES_DIR, ANDROID_NATIVE_DIR, pm, TEST_DATA_DIR);
  const tm = new TerminalSessionManager(wm);
  const bsm = new BuildServiceManager(wm, tm, TEST_DATA_DIR);
  const mm = new MemoryAndMcpManager(TEST_DATA_DIR);
  const tcm = new MobileHarnessToolchainManager(TEST_DATA_DIR, ROOT_DIR, wm);
  const runner = new BoundedAgentLoopRunner(wm, tm, pm, mm, bsm, tcm);

  const tc = bsm.probeAndroidToolchain();
  if (!tc.isAvailable) {
    console.log('Skipping end-to-end build check: Host toolchain not available');
    return;
  }

  const activities: AgentActivityEvent[] = [];
  const result = await runner.runAgentLoop({
    conversationId: 'test-build-flow',
    workspaceId: 'kotlin-notes-apk',
    messages: [{ id: 'm1', role: 'user', content: 'build the notes APK with a small file size', timestampMillis: Date.now() }],
    enableAgentTools: true,
    systemInstruction: 'Build release APK and optimize size.',
    maxIterations: 6,
    maxToolCalls: 10,
    commandTimeoutMs: 25000,
    signal: new AbortController().signal,
    modelTurnGenerator: async ({ iteration, contents }: { iteration: number; contents?: any }) => {
      if (iteration === 1) {
        return {
          toolCalls: [{ name: 'check_toolchain', args: {} }],
        };
      }
      if (iteration === 2) {
        return {
          toolCalls: [{ name: 'build_apk', args: { variant: 'release', optimize_size: true } }],
        };
      }
      if (iteration === 3) {
        return {
          toolCalls: [{ name: 'verify_apk', args: {} }],
        };
      }
      return {
        text: 'Successfully built and verified kotlin-notes-apk-release.apk (~1.34 KB).',
      };
    },
    onEmitActivity: (ev: any) => {
      activities.push({
        ...ev,
        id: `act-${Date.now()}-${Math.random()}`,
        timestampMillis: Date.now(),
      });
    },
  });

  assert.equal(result.taskState, 'completed');
  assert.equal(result.toolCalls.length, 3);
  assert.equal(result.toolCalls[0].name, 'check_toolchain');
  assert.equal(result.toolCalls[1].name, 'build_apk');
  assert.equal(result.toolCalls[2].name, 'verify_apk');
  assert.equal(result.toolCalls[1].status, 'succeeded');
  assert.equal(result.toolCalls[2].status, 'succeeded');

  // Verify activity events included build stages
  const states = activities.map((a) => a.state);
  assert.equal(states.includes('COMPILING_RESOURCES') || states.includes('PREPARING_BUILD'), true);
  assert.equal(states.includes('COMPLETED'), true);
});

test('4. Server exposes /api/agent/events/stream SSE endpoint and emits events', async () => {
  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as { port: number };

  try {
    const sseResponse = await new Promise<{ status: number; contentType: string; dataReceived: string }>((resolve, reject) => {
      const req = http.get(`http://localhost:${address.port}/api/agent/events/stream`, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk.toString('utf-8');
          if (body.includes('event: snapshot')) {
            req.destroy();
            resolve({
              status: res.statusCode || 0,
              contentType: res.headers['content-type'] || '',
              dataReceived: body,
            });
          }
        });
      });
      req.on('error', (err) => {
        // Destroy causes ECONNRESET which is expected when we stop early
        if ((err as any).code === 'ECONNRESET') return;
        reject(err);
      });
    });

    assert.equal(sseResponse.status, 200);
    assert.equal(sseResponse.contentType.includes('text/event-stream'), true);
    assert.equal(sseResponse.dataReceived.includes('event: snapshot'), true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
