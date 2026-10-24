/**
 * Obsidian Duet Agent - Windows Companion Service Test Suite
 * Tests 1, 2, 3, 4, 5, 6, 14, 15, 16
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createCompanionServer } from '../../apps/companion/src/api/server.js';
import { GenerateRequest, GenerateResponse, ModelProvider } from '../../packages/contracts/src/types.js';

// Mock Provider for deterministic offline testing of 7+9 and streaming
class MockDeterministicProvider implements ModelProvider {
  public id = 'mock-provider';
  public name = 'Mock Deterministic Provider';
  public type = 'compatible' as const;
  public baseUrl = 'mock://test';
  public defaultModelId = 'mock-v1';

  public async listModels() {
    return [{ id: 'mock-v1', name: 'Mock v1', supportsStreaming: true, supportsTools: true, isLocal: true }];
  }

  public async generate(req: GenerateRequest): Promise<GenerateResponse> {
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')?.content || '';
    if (lastUser.includes('7 + 9') || lastUser.includes('7+9')) {
      return { text: 'The sum of 7 and 9 is 16.' };
    }
    return { text: `Mock response to: ${lastUser}` };
  }

  public async generateStream(
    req: GenerateRequest,
    onToken: (c: string) => void,
    signal?: AbortSignal
  ): Promise<GenerateResponse> {
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')?.content || '';
    let responseText = `Mock response to: ${lastUser}`;
    if (lastUser.includes('7 + 9') || lastUser.includes('7+9')) {
      responseText = '7 + 9 = 16';
    }

    const chunks = responseText.split(' ');
    for (const chunk of chunks) {
      if (signal?.aborted) throw new Error('Cancelled');
      onToken(chunk + ' ');
    }
    return { text: responseText };
  }
}

test('Companion: Health check returns status, version, and provider registry', async () => {
  const { app, db } = createCompanionServer(':memory:');

  // 1. /api/health
  const res = await app.inject({
    method: 'GET',
    url: '/api/health',
  });
  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.payload);
  assert.equal(data.status, 'ok');
  assert.equal(data.version, '1.0.0');
  assert.ok(Array.isArray(data.availableProviders));
  assert.ok(data.availableProviders.includes('ollama'));

  // 2. /health alias
  const aliasRes = await app.inject({
    method: 'GET',
    url: '/health',
  });
  assert.equal(aliasRes.statusCode, 200);

  // 3. GET / returns JSON service index by default
  const rootJsonRes = await app.inject({
    method: 'GET',
    url: '/',
    headers: { accept: 'application/json' },
  });
  assert.equal(rootJsonRes.statusCode, 200);
  const rootData = JSON.parse(rootJsonRes.payload);
  assert.equal(rootData.service, 'Obsidian Duet Agent Companion');
  assert.equal(rootData.status, 'ok');
  assert.ok(rootData.endpoints.health);

  // 4. GET / returns HTML dashboard when browser requests text/html
  const rootHtmlRes = await app.inject({
    method: 'GET',
    url: '/',
    headers: { accept: 'text/html,application/xhtml+xml' },
  });
  assert.equal(rootHtmlRes.statusCode, 200);
  assert.ok(rootHtmlRes.headers['content-type']?.includes('text/html'));
  assert.ok(rootHtmlRes.payload.includes('Obsidian Duet Agent Companion'));

  // 5. Unknown route returns 404 with helpful guidance
  const notFoundRes = await app.inject({
    method: 'GET',
    url: '/unknown-route-xyz',
  });
  assert.equal(notFoundRes.statusCode, 404);
  const notFoundData = JSON.parse(notFoundRes.payload);
  assert.ok(notFoundData.hint);

  await app.close();
  db.close();
});

test('Companion: Pairing flow succeeds with master token and rejects invalid tokens', async () => {
  const { app, auth, db } = createCompanionServer(':memory:');
  const masterToken = auth.getOrCreatePairingToken();

  // 1. Rejected pairing with wrong token
  const failRes = await app.inject({
    method: 'POST',
    url: '/api/pair',
    payload: { pairingToken: 'wrong-token-abc-123', clientName: 'Test' },
  });
  assert.equal(failRes.statusCode, 401);

  // 2. Successful pairing with master token
  const successRes = await app.inject({
    method: 'POST',
    url: '/api/pair',
    payload: { pairingToken: masterToken, clientName: 'Obsidian Desktop Plugin' },
  });
  assert.equal(successRes.statusCode, 200);
  const data = JSON.parse(successRes.payload);
  assert.equal(data.success, true);
  assert.equal(data.token, masterToken);

  await app.close();
  db.close();
});

test('Companion: Arithmetic question "What is 7 + 9?" returns real answer 16 directly without tool loop (Test 1 & 2)', async () => {
  const { app, auth, runtime, db } = createCompanionServer(':memory:');
  const token = auth.getOrCreatePairingToken();

  // Inject deterministic provider for unit test
  const mockProvider = new MockDeterministicProvider();
  (runtime as any).providers.register(mockProvider);

  const res = await app.inject({
    method: 'POST',
    url: '/api/chat/stream',
    headers: {
      authorization: `Bearer ${token}`,
    },
    payload: {
      conversationId: 'conv-test-math',
      content: 'What is 7 + 9?',
      providerId: 'mock-provider',
      modelId: 'mock-v1',
    },
  });

  assert.equal(res.statusCode, 200);
  const rawLines = res.payload.split('\n').filter((l) => l.trim().length > 0);
  const events = rawLines.map((l) => JSON.parse(l));

  // Must emit turn.started, model.requested, message.delta, turn.completed
  const topics = events.map((e) => e.topic);
  assert.ok(topics.includes('turn.started'));
  assert.ok(topics.includes('model.requested'));
  assert.ok(topics.includes('message.delta'));
  assert.ok(topics.includes('turn.completed'));

  // Test 2: Must NOT create subtasks or enter tool approval loops for pure arithmetic
  assert.equal(topics.includes('task.created'), false);
  assert.equal(topics.includes('approval.required'), false);

  // Test 1: Check final answer contains 16
  const deltas = events.filter((e) => e.topic === 'message.delta');
  const finalDelta = deltas[deltas.length - 1];
  assert.ok(finalDelta.payload.accumulatedText.includes('16'));

  await app.close();
  db.close();
});

test('Companion: Task persistence & crash recovery transitions interrupted tasks to paused (Test 6, 14, 15)', async () => {
  const { app, repo, db } = createCompanionServer(':memory:');

  // 1. Create a task in 'running' state
  repo.createTask({
    id: 'task-crash-1',
    conversationId: 'conv-crash',
    agentRole: 'coder',
    title: 'Background task interrupted by system restart',
    status: 'running',
    inputPayload: { action: 'build' },
    createdAtMillis: Date.now(),
    updatedAtMillis: Date.now(),
  });

  const beforeRecovery = repo.getTask('task-crash-1');
  assert.equal(beforeRecovery?.status, 'running');

  // 2. Simulate Companion restart and run recovery
  const recoveredCount = repo.recoverInterruptedTasks();
  assert.equal(recoveredCount, 1);

  const afterRecovery = repo.getTask('task-crash-1');
  assert.equal(afterRecovery?.status, 'paused');
  assert.ok(afterRecovery?.error?.includes('Companion restarted'));

  // 3. Conversation history persistence (Test 14)
  repo.saveConversation({
    id: 'conv-persist-1',
    title: 'Durable Conversation',
    providerId: 'ollama',
    modelId: 'llama3.2',
    messages: [],
    createdAtMillis: Date.now(),
    updatedAtMillis: Date.now(),
  });
  repo.appendMessage('conv-persist-1', {
    id: 'm1',
    role: 'user',
    content: 'Persisted note query',
    timestampMillis: Date.now(),
  });
  repo.appendMessage('conv-persist-1', {
    id: 'm2',
    role: 'assistant',
    content: 'Persisted answer',
    timestampMillis: Date.now(),
  });

  const loadedConv = repo.getConversation('conv-persist-1');
  assert.ok(loadedConv);
  assert.equal(loadedConv.messages.length, 2);
  assert.equal(loadedConv.messages[0].content, 'Persisted note query');
  assert.equal(loadedConv.messages[1].content, 'Persisted answer');

  await app.close();
  db.close();
});
