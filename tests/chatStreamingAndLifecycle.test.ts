import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import fs from 'fs';
import path from 'path';
import {
  WorkspaceManager,
  TerminalSessionManager,
  PermissionManager,
  MemoryAndMcpManager,
  BuildServiceManager,
  BoundedAgentLoopRunner,
  ToolCallRecord,
} from '../src/server/workstationEngine.js';

process.env.ANVIL_TEST_MODE = '1';
const { createApp } = await import('../server.js');

const ROOT_DIR = process.cwd();
const TEST_DATA_DIR = path.join(ROOT_DIR, '.anvil-data', 'test-streaming');
const WORKSPACES_DIR = path.join(ROOT_DIR, 'workspaces');
const ANDROID_NATIVE_DIR = path.join(ROOT_DIR, 'android-workstation');

fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

async function readNdjsonStream(res: Response): Promise<Array<Record<string, any>>> {
  const events: Array<Record<string, any>> = [];
  if (!res.body) return events;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) {
        events.push(JSON.parse(line.trim()));
      }
    }
  }
  if (buffer.trim()) {
    events.push(JSON.parse(buffer.trim()));
  }
  return events;
}

test('Scenario 1 & 4: Sending "hi" with Local AI GGUF model immediately emits accepted + status + incremental tokens without triggering workspace tools', async () => {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const createRes = await fetch(`${baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'New Chat',
        workspaceId: 'kotlin-notes-apk',
        providerId: 'local-ai',
        modelId: 'smollm2-135m-instruct-q4_k_m.gguf',
      }),
    });
    const created = await createRes.json();
    const convId = created.conversation.id;

    const sendRes = await fetch(`${baseUrl}/api/chat/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson',
      },
      body: JSON.stringify({
        conversationId: convId,
        content: 'hi',
        enableAgentTools: false,
        stream: true,
      }),
    });

    assert.equal(sendRes.status, 200);
    assert.equal(
      (sendRes.headers.get('content-type') || '').includes('application/x-ndjson'),
      true
    );

    const streamEvents = await readNdjsonStream(sendRes);
    const eventTypes = streamEvents.map((e) => e.type);

    // Must start with immediate acceptance and connecting status
    assert.equal(eventTypes[0], 'accepted');
    assert.equal(streamEvents[0].conversationTitle, 'hi');
    assert.equal(eventTypes.includes('status'), true);

    // Must emit incremental token deltas from node-llama-cpp
    const tokenEvents = streamEvents.filter((e) => e.type === 'token');
    assert.equal(tokenEvents.length >= 1, true);
    assert.equal(typeof tokenEvents[0].delta, 'string');
    assert.equal(tokenEvents[tokenEvents.length - 1].accumulatedText.length > 0, true);

    // Must not execute any workspace or terminal tools on ordinary "hi"
    const toolEvents = streamEvents.filter((e) => e.type === 'tool_call');
    assert.equal(toolEvents.length, 0);

    // Must finalize with done event
    const doneEvt = streamEvents.find((e) => e.type === 'done');
    assert.ok(doneEvt);
    assert.equal(doneEvt.assistantMessage.taskState, 'completed');
    assert.equal(doneEvt.assistantMessage.content.length > 0, true);
  } finally {
    server.close();
  }
});

test('Scenario 2: Longer prompt streams multiple incremental token chunks in order', async () => {
  const pm = new PermissionManager();
  const wm = new WorkspaceManager(WORKSPACES_DIR, ANDROID_NATIVE_DIR, pm, TEST_DATA_DIR);
  const tm = new TerminalSessionManager(wm);
  const bsm = new BuildServiceManager(wm, tm, TEST_DATA_DIR);
  const mm = new MemoryAndMcpManager(TEST_DATA_DIR);
  const runner = new BoundedAgentLoopRunner(wm, tm, pm, mm, bsm);

  const deltas: string[] = [];
  const snapshots: string[] = [];

  const result = await runner.runAgentLoop({
    conversationId: 'conv-stream-long',
    workspaceId: 'kotlin-notes-apk',
    messages: [{ id: 'u1', role: 'user', content: 'Explain Kotlin coroutines in 3 bullet points.', timestampMillis: Date.now() }],
    enableAgentTools: false,
    systemInstruction: 'You are OBSIDIAN AI.',
    maxIterations: 3,
    maxToolCalls: 4,
    commandTimeoutMs: 5000,
    requestTimeoutMs: 5000,
    maxRetries: 0,
    signal: new AbortController().signal,
    knownSecrets: [],
    onTokenDelta: (delta, accumulated) => {
      deltas.push(delta);
      snapshots.push(accumulated);
    },
    modelTurnGenerator: async ({ onToken }) => {
      const chunks = [
        '### Kotlin Coroutines\n\n',
        '1. **Structured Concurrency**: Coroutines run inside a `CoroutineScope`.\n',
        '2. **Suspend Functions**: Non-blocking asynchronous execution.\n',
        '3. **Dispatchers**: Route work across `Dispatchers.IO` and `Dispatchers.Main`.',
      ];
      for (const c of chunks) {
        onToken?.(c);
      }
      return { text: chunks.join('') };
    },
  });

  assert.equal(deltas.length, 4);
  assert.equal(snapshots[0], '### Kotlin Coroutines\n\n');
  assert.equal(snapshots[3], result.finalText);
  assert.equal(result.taskState, 'completed');
});

test('Scenario 3: Coding task emits live tool_call start (running) -> completed (succeeded) updates inline before final streamed synthesis', async () => {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const createRes = await fetch(`${baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Coding Task Session',
        workspaceId: 'kotlin-notes-apk',
        providerId: 'local-ai',
        modelId: 'smollm2-135m-instruct-q4_k_m.gguf',
      }),
    });
    const created = await createRes.json();
    const convId = created.conversation.id;

    const sendRes = await fetch(`${baseUrl}/api/chat/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson',
      },
      body: JSON.stringify({
        conversationId: convId,
        content: 'Inspect the workspace files and read MainActivity.kt',
        enableAgentTools: true,
        stream: true,
      }),
    });

    const streamEvents = await readNdjsonStream(sendRes);
    const toolEvents = streamEvents.filter((e) => e.type === 'tool_call');

    // Should emit running -> succeeded transitions for workspace inspection tools
    assert.equal(toolEvents.length >= 2, true);
    const hasRunningPhase = toolEvents.some((e) => e.toolCall?.status === 'running');
    const hasSucceededPhase = toolEvents.some((e) => e.toolCall?.status === 'succeeded');
    assert.equal(hasRunningPhase, true);
    assert.equal(hasSucceededPhase, true);

    const doneEvt = streamEvents.find((e) => e.type === 'done');
    assert.ok(doneEvt);
    assert.equal(Array.isArray(doneEvt.assistantMessage.toolCalls), true);
    assert.equal(doneEvt.assistantMessage.toolCalls.length >= 1, true);
    assert.equal(doneEvt.assistantMessage.content.length > 0, true);
  } finally {
    server.close();
  }
});

test('Scenario 5: Clicking Stop / cancelling mid-stream aborts generation, preserves partial output, and marks turn cancelled', async () => {
  const pm = new PermissionManager();
  const wm = new WorkspaceManager(WORKSPACES_DIR, ANDROID_NATIVE_DIR, pm, TEST_DATA_DIR);
  const tm = new TerminalSessionManager(wm);
  const bsm = new BuildServiceManager(wm, tm, TEST_DATA_DIR);
  const mm = new MemoryAndMcpManager(TEST_DATA_DIR);
  const runner = new BoundedAgentLoopRunner(wm, tm, pm, mm, bsm);

  const abortController = new AbortController();
  const receivedTokens: string[] = [];

  const result = await runner.runAgentLoop({
    conversationId: 'conv-cancel-midstream',
    workspaceId: 'kotlin-notes-apk',
    messages: [{ id: 'u1', role: 'user', content: 'Write a long guide.', timestampMillis: Date.now() }],
    enableAgentTools: false,
    systemInstruction: 'You are OBSIDIAN AI.',
    maxIterations: 3,
    maxToolCalls: 4,
    commandTimeoutMs: 5000,
    requestTimeoutMs: 5000,
    maxRetries: 0,
    signal: abortController.signal,
    knownSecrets: [],
    onTokenDelta: (delta) => {
      receivedTokens.push(delta);
      if (receivedTokens.length === 2) {
        abortController.abort();
      }
    },
    modelTurnGenerator: async ({ signal, onToken }) => {
      const parts = ['First partial paragraph. ', 'Second partial sentence. ', 'Third sentence that should never appear.'];
      let built = '';
      for (const p of parts) {
        if (signal.aborted) break;
        built += p;
        onToken?.(p);
      }
      return { text: built };
    },
  });

  assert.equal(result.taskState, 'cancelled');
  assert.equal(result.stoppedReason, 'cancelled');
  // Partial output must be preserved, and post-abort chunk must not appear
  assert.equal(result.finalText, 'First partial paragraph. Second partial sentence. ');
  assert.equal(result.finalText.includes('Third sentence'), false);
});

test('Scenario 6, 7 & 8: Invalid provider returns structured error, retry succeeds without duplicating user message, and concurrent conversations stay isolated', async () => {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // Create Conversation A with unconfigured provider (openai without API key)
    const convARes = await fetch(`${baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Conv A',
        workspaceId: 'kotlin-notes-apk',
        providerId: 'openai',
        modelId: 'gpt-4o-mini',
      }),
    });
    const convA = (await convARes.json()).conversation;

    // Create Conversation B with Local AI
    const convBRes = await fetch(`${baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Conv B',
        workspaceId: 'kotlin-notes-apk',
        providerId: 'local-ai',
        modelId: 'smollm2-135m-instruct-q4_k_m.gguf',
      }),
    });
    const convB = (await convBRes.json()).conversation;

    // Send on Conv A -> should emit structured error event because OpenAI has no API key
    const failStreamRes = await fetch(`${baseUrl}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify({
        conversationId: convA.id,
        content: 'Hello from Conv A',
        enableAgentTools: false,
        stream: true,
      }),
    });
    const failEvents = await readNdjsonStream(failStreamRes);
    const errEvt = failEvents.find((e) => e.type === 'error');
    assert.ok(errEvt);
    assert.equal(errEvt.conversationId, convA.id);
    assert.equal(typeof errEvt.error, 'string');

    // Switch Conv A to local-ai and Retry (retryLastUserMessage: true)
    await fetch(`${baseUrl}/api/conversations/${encodeURIComponent(convA.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: 'local-ai',
        modelId: 'smollm2-135m-instruct-q4_k_m.gguf',
      }),
    });

    const retryStreamRes = await fetch(`${baseUrl}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify({
        conversationId: convA.id,
        content: 'Hello from Conv A',
        enableAgentTools: false,
        stream: true,
        retryLastUserMessage: true,
      }),
    });
    const retryEvents = await readNdjsonStream(retryStreamRes);
    const retryDone = retryEvents.find((e) => e.type === 'done');
    assert.ok(retryDone);

    // Verify Conv A has exactly 1 user message (no duplicate from retry) and 1 completed assistant message
    const userMsgsA = retryDone.conversation.messages.filter((m: any) => m.role === 'user');
    assert.equal(userMsgsA.length, 1);
    assert.equal(userMsgsA[0].content, 'Hello from Conv A');

    // Verify Conv B remained completely untouched while Conv A ran (Scenario 7)
    const allConvsRes = await fetch(`${baseUrl}/api/conversations`).then((r) => r.json());
    const fetchedB = allConvsRes.conversations.find((c: any) => c.id === convB.id);
    assert.equal(fetchedB.messages.length, 0);
  } finally {
    server.close();
  }
});

test('Scenario 8: Antigravity Local Host provider testing and real-time streaming with Gemini 3.8 Flash', async () => {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // 1. Test provider connectivity
    const testRes = await fetch(`${baseUrl}/api/providers/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'antigravity' }),
    });
    const testData = await testRes.json();
    assert.equal(testRes.status, 200);
    assert.equal(testData.connected, true);
    assert.ok(Array.isArray(testData.models));
    const has38Flash = testData.models.some((m: any) => m.id === 'gemini-3.8-flash');
    assert.ok(has38Flash, 'gemini-3.8-flash should be listed in models');

    // 2. Create conversation with Antigravity and gemini-3.8-flash
    const createRes = await fetch(`${baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Antigravity Test Chat',
        workspaceId: 'kotlin-notes-apk',
        providerId: 'antigravity',
        modelId: 'gemini-3.8-flash',
      }),
    });
    assert.equal(createRes.status, 200);
    const created = await createRes.json();
    const convId = created.conversation.id;

    // 3. Send message with streaming
    const sendRes = await fetch(`${baseUrl}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify({
        conversationId: convId,
        content: 'Hello Gemini 3.8 Flash on Antigravity host!',
        enableAgentTools: false,
        stream: true,
      }),
    });
    assert.equal(sendRes.status, 200);

    const events = await readNdjsonStream(sendRes);
    const types = events.map((e) => e.type);

    assert.ok(types.includes('accepted'), 'Must emit accepted event');
    assert.ok(types.includes('status'), 'Must emit status event');
    assert.ok(types.includes('token'), 'Must emit token event');
    assert.ok(types.includes('done'), 'Must emit done event');

    const doneEvent = events.find((e) => e.type === 'done');
    assert.ok(doneEvent);
    const assistantMsg = doneEvent.conversation.messages.find((m: any) => m.role === 'assistant');
    assert.ok(assistantMsg);
    assert.ok(assistantMsg.content.length > 0, 'Assistant message content should not be empty');
    assert.equal(
      assistantMsg.content.includes('### Antigravity · Gemini 3.8 Flash Execution Analysis'),
      false,
      'Must not include boilerplate execution analysis header'
    );
  } finally {
    server.close();
  }
});

test('Scenario 9: Workspace lifecycle (empty creation without README, rename, remove) and natural greetings', async () => {
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // 1. Create a workspace with empty template
    const wsName = `clean-test-project-${Date.now()}`;
    const createWsRes = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: wsName, templateId: 'empty' }),
    });
    assert.equal(createWsRes.status, 200);
    const createData = await createWsRes.json();
    const createdId = createData.workspace.id;

    // Verify no generic README.md was automatically generated
    const filesRes = await fetch(`${baseUrl}/api/workspaces/${encodeURIComponent(createdId)}/files`);
    const filesData = await filesRes.json();
    assert.equal(filesData.files.length, 0, 'Empty workspace must not contain auto-generated README.md');

    // 2. Natural greeting test: send "hi"
    const convRes = await fetch(`${baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Greeting Chat',
        workspaceId: createdId,
        providerId: 'antigravity',
        modelId: 'gemini-3.8-flash',
      }),
    });
    const convData = await convRes.json();

    const sendRes = await fetch(`${baseUrl}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify({
        conversationId: convData.conversation.id,
        content: 'hi',
        enableAgentTools: false,
        stream: true,
      }),
    });
    const events = await readNdjsonStream(sendRes);
    const doneEvt = events.find((e) => e.type === 'done');
    assert.ok(doneEvt);
    const reply = doneEvt.conversation.messages.find((m: any) => m.role === 'assistant')?.content || '';
    assert.ok(/hello|hi\b/i.test(reply), 'Greeting should reply naturally with a greeting');
    assert.equal(reply.includes('### Antigravity'), false, 'Must not prepend Antigravity header');
    assert.equal(reply.includes('live streaming operational'), false, 'Must not claim live streaming operational');

    // 3. Rename workspace
    const newWsName = `${wsName}-renamed`;
    const renameRes = await fetch(`${baseUrl}/api/workspaces/${encodeURIComponent(createdId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newWsName }),
    });
    assert.equal(renameRes.status, 200);
    const renameData = await renameRes.json();
    const renamedId = renameData.workspace.id;

    // 4. Remove workspace reference (safe, deleteFiles = false)
    const removeRes = await fetch(`${baseUrl}/api/workspaces/${encodeURIComponent(renamedId)}?deleteFiles=false`, {
      method: 'DELETE',
    });
    assert.equal(removeRes.status, 200);
    const removeData = await removeRes.json();
    assert.equal(removeData.workspaces.some((w: any) => w.id === renamedId), false);
  } finally {
    server.close();
  }
});

