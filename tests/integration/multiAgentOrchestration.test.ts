/**
 * Obsidian Duet Agent - Multi-Agent Orchestration & Integration Test Suite
 * Tests 3, 5, 7, 8, 17
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { createCompanionServer } from '../../apps/companion/src/api/server.js';
import { ProjectFilesystemTools } from '../../apps/companion/src/tools/filesystem.js';
import { PermissionPolicyEnforcer } from '../../apps/companion/src/tools/policies.js';
import { AnthropicProvider } from '../../apps/companion/src/providers/anthropic.js';
import { OpenAIProvider } from '../../apps/companion/src/providers/openai.js';

test('Multi-Agent: Two independent read-only tasks run concurrently without blocking (Test 7)', async () => {
  const { runtime } = createCompanionServer(':memory:');
  const queue = runtime.getQueue();

  let task1Started = 0;
  let task2Started = 0;
  let task1Ended = 0;
  let task2Ended = 0;

  // Register custom slow read-only executors
  (runtime as any).workerPool.registerExecutor('researcher', async () => {
    task1Started = Date.now();
    await new Promise((r) => setTimeout(r, 60));
    task1Ended = Date.now();
    return { findings: ['Item A'] };
  });

  (runtime as any).workerPool.registerExecutor('vault-assistant', async () => {
    task2Started = Date.now();
    await new Promise((r) => setTimeout(r, 60));
    task2Ended = Date.now();
    return { notes: ['Item B'] };
  });

  const t1 = queue.enqueueTask('conv-concurrent', 'researcher', 'Research Task 1', {});
  const t2 = queue.enqueueTask('conv-concurrent', 'vault-assistant', 'Vault Read Task 2', {});

  // Run concurrently
  const [res1, res2] = await Promise.all([
    (runtime as any).workerPool.runTask(t1),
    (runtime as any).workerPool.runTask(t2),
  ]);

  assert.equal(res1.status, 'completed');
  assert.equal(res2.status, 'completed');

  // Both should have run overlapping in time (concurrency)
  assert.ok(task2Started <= task1Ended);
  assert.ok(task1Started <= task2Ended);
});

test('Multi-Agent: Serialized write locking prevents concurrent file corruption (Test 8)', async () => {
  const testRoot = path.resolve('.anvil-data/write-lock-test');
  fs.mkdirSync(testRoot, { recursive: true });

  const enforcer = new PermissionPolicyEnforcer([testRoot]);
  const fsTools = new ProjectFilesystemTools(enforcer);

  const targetFile = path.join(testRoot, 'shared-state.txt');

  // Launch 10 concurrent writes to the same file
  const writes = Array.from({ length: 10 }, (_, i) =>
    fsTools.writeFile(targetFile, `Write attempt ${i + 1} at timestamp ${Date.now()}`)
  );

  const results = await Promise.all(writes);
  assert.equal(results.length, 10);
  assert.ok(results.every((r) => r.success));

  // The file must contain valid, non-corrupted text matching one of the writes
  const finalContent = fs.readFileSync(targetFile, 'utf-8');
  assert.ok(finalContent.startsWith('Write attempt '));
});

test('Multi-Agent: Stop / AbortSignal cancels active turn and emits turn.interrupted (Test 5)', async () => {
  const { runtime } = createCompanionServer(':memory:');
  const abortController = new AbortController();

  const events: any[] = [];

  const promise = runtime.runSession({
    conversationId: 'conv-cancel-test',
    messages: [{ id: 'u1', role: 'user', content: 'Generate a huge response', timestampMillis: Date.now() }],
    providerId: 'ollama',
    modelId: 'llama3.2',
    signal: abortController.signal,
    onEvent: (e) => {
      events.push(e);
      if (events.length >= 2) {
        abortController.abort();
      }
    },
  });

  await promise;

  // Should have received turn.interrupted
  const hasInterrupted = events.some((e) => e.topic === 'turn.interrupted');
  assert.ok(hasInterrupted, 'Must emit turn.interrupted event when aborted');
});

test('Multi-Agent: Unconfigured cloud credentials throw clear, honest errors (Test 3 & 17)', async () => {
  // 1. Anthropic without API key
  const anthropic = new AnthropicProvider('');
  await assert.rejects(
    () => anthropic.generateStream(
      { modelId: 'claude-3-5-sonnet', messages: [{ id: '1', role: 'user', content: 'Hi', timestampMillis: Date.now() }] },
      () => {}
    ),
    /Authentication Required.*Anthropic API key is missing/i
  );

  // 2. OpenAI without API key
  const openai = new OpenAIProvider('');
  await assert.rejects(
    () => openai.generateStream(
      { modelId: 'gpt-4o', messages: [{ id: '1', role: 'user', content: 'Hi', timestampMillis: Date.now() }] },
      () => {}
    ),
    /Authentication Required.*OpenAI API key is missing/i
  );
});
