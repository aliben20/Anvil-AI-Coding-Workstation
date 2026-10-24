import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';

process.env.ANVIL_TEST_MODE = '1';

let activeBaseUrl = 'http://127.0.0.1:3000';
let ephemeralServer: http.Server | null = null;

async function getBaseUrl(): Promise<string> {
  try {
    const res = await fetch('http://127.0.0.1:3000/api/system/environment');
    if (res.ok) {
      activeBaseUrl = 'http://127.0.0.1:3000';
      return activeBaseUrl;
    }
  } catch {}

  if (!ephemeralServer) {
    const { createApp } = await import('../server.js');
    const app = createApp();
    ephemeralServer = http.createServer(app);
    await new Promise<void>((resolve) => ephemeralServer!.listen(0, '127.0.0.1', () => resolve()));
    const addr = ephemeralServer.address() as { port: number };
    activeBaseUrl = `http://127.0.0.1:${addr.port}`;
  }
  return activeBaseUrl;
}

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
        try {
          events.push(JSON.parse(line.trim()));
        } catch {}
      }
    }
  }
  if (buffer.trim()) {
    try {
      events.push(JSON.parse(buffer.trim()));
    } catch {}
  }
  return events;
}

test('Regression 1: Genuine AI answer for 5+2 without echoing user prompt', async () => {
  const baseUrl = await getBaseUrl();
  const createRes = await fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Math Test',
      workspaceId: 'kotlin-notes-apk',
      providerId: 'local-ai',
      modelId: 'smollm2-135m-instruct-q4_k_m.gguf',
    }),
  });
  const created = await createRes.json();
  const convId = created.conversation.id;

  const sendRes = await fetch(`${baseUrl}/api/chat/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify({
      conversationId: convId,
      content: '5+2',
      enableAgentTools: false,
      stream: true,
    }),
  });

  assert.equal(sendRes.status, 200);
  const events = await readNdjsonStream(sendRes);
  const doneEvent = events.find((e) => e.type === 'done');
  assert.ok(doneEvent, `Must emit done event, received: ${events.map((e) => e.type).join(', ')}`);

  const assistantMsg = doneEvent.conversation.messages.find((m: any) => m.role === 'assistant');
  assert.ok(assistantMsg, 'Assistant message must exist');
  assert.notEqual(assistantMsg.content.trim(), '5+2', 'Assistant message must NOT echo the user prompt "5+2"');
  assert.ok(assistantMsg.content.length > 5, 'Assistant message must contain genuine model text');

  // Strict role separation:
  const userMsg = doneEvent.conversation.messages.find((m: any) => m.role === 'user');
  assert.equal(userMsg.role, 'user');
  assert.equal(userMsg.content, '5+2');
  assert.equal(assistantMsg.role, 'assistant');
});

test('Regression 2: Sequential messages (5+2, 45858, 25) do not echo user inputs', async (t) => {
  const baseUrl = await getBaseUrl();
  const createRes = await fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Sequential Test',
      workspaceId: 'kotlin-notes-apk',
      providerId: 'local-ai',
      modelId: 'smollm2-135m-instruct-q4_k_m.gguf',
    }),
  });
  const created = await createRes.json();
  const convId = created.conversation.id;

  await t.test('Turn 1: 5+2 generates genuine answer, not an echo', async () => {
    const res1 = await fetch(`${baseUrl}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify({ conversationId: convId, content: '5+2', enableAgentTools: false, stream: true }),
    });
    const events1 = await readNdjsonStream(res1);
    const done1 = events1.find((e) => e.type === 'done');
    assert.ok(done1, 'Turn 1 must emit done event');
    const msg1 = done1.conversation.messages[done1.conversation.messages.length - 1];
    assert.notEqual(msg1.content.trim(), '5+2', 'Turn 1 must not echo 5+2');
  });

  await t.test('Turn 2: 45858 generates genuine answer, not an echo', async () => {
    const res2 = await fetch(`${baseUrl}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify({ conversationId: convId, content: '45858', enableAgentTools: false, stream: true }),
    });
    const events2 = await readNdjsonStream(res2);
    const done2 = events2.find((e) => e.type === 'done');
    assert.ok(done2, 'Turn 2 must emit done event');
    const msg2 = done2.conversation.messages[done2.conversation.messages.length - 1];
    assert.notEqual(msg2.content.trim(), '45858', 'Turn 2 must not echo 45858');
  });

  await t.test('Turn 3: 25 generates genuine answer, not an echo', async () => {
    const res3 = await fetch(`${baseUrl}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
      body: JSON.stringify({ conversationId: convId, content: '25', enableAgentTools: false, stream: true }),
    });
    const events3 = await readNdjsonStream(res3);
    const done3 = events3.find((e) => e.type === 'done');
    assert.ok(done3, 'Turn 3 must emit done event');
    const msg3 = done3.conversation.messages[done3.conversation.messages.length - 1];
    assert.notEqual(msg3.content.trim(), '25', 'Turn 3 must not echo 25');
  });
});

test('Regression 3: Unavailable provider returns actionable error and does NOT silently echo or switch model', async () => {
  const baseUrl = await getBaseUrl();
  const createRes = await fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Unconfigured Provider Test',
      workspaceId: 'kotlin-notes-apk',
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
    }),
  });
  const created = await createRes.json();
  const convId = created.conversation.id;

  const sendRes = await fetch(`${baseUrl}/api/chat/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify({ conversationId: convId, content: '5+2', enableAgentTools: false, stream: true }),
  });

  const events = await readNdjsonStream(sendRes);
  const errorEvent = events.find((e) => e.type === 'error');
  assert.ok(errorEvent, 'Must emit error event for unconfigured provider');
  assert.ok(
    errorEvent.error.includes('Authentication Required'),
    `Error must clearly indicate authentication required, got: ${errorEvent.error}`
  );

  // Verify the conversation state has taskState = 'failed'
  const convRes = await fetch(`${baseUrl}/api/conversations`);
  const convJson = await convRes.json();
  const convList = convJson.conversations || [];
  const updatedConv = convList.find((c: any) => c.id === convId);
  assert.ok(updatedConv, 'Updated conversation must be found');
  assert.equal(updatedConv.taskState, 'failed');
  const lastMsg = updatedConv.messages[updatedConv.messages.length - 1];
  assert.equal(lastMsg.role, 'assistant');
  assert.notEqual(
    lastMsg.content.trim(),
    '5+2',
    'Assistant message must never be populated with the user prompt on error'
  );
});

test('Regression 4: Stop/Cancellation mid-stream aborts cleanly and marks turn cancelled', async () => {
  const baseUrl = await getBaseUrl();
  const createRes = await fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Cancel Test',
      workspaceId: 'kotlin-notes-apk',
      providerId: 'local-ai',
      modelId: 'smollm2-135m-instruct-q4_k_m.gguf',
    }),
  });
  const created = await createRes.json();
  const convId = created.conversation.id;

  const controller = new AbortController();
  const sendPromise = fetch(`${baseUrl}/api/chat/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    signal: controller.signal,
    body: JSON.stringify({
      conversationId: convId,
      content: 'Write an exhaustive essay on quantum physics and general relativity with full mathematical proofs',
      enableAgentTools: false,
      stream: true,
    }),
  });

  // Wait 100ms then abort stream
  setTimeout(() => {
    controller.abort();
  }, 100);

  await sendPromise.catch(() => {});

  // Call cancel endpoint to confirm server cancellation
  const cancelRes = await fetch(`${baseUrl}/api/chat/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId: convId }),
  });
  assert.equal(cancelRes.status, 200);
  const cancelData = await cancelRes.json();
  assert.equal(cancelData.cancelled, true);
  assert.equal(cancelData.conversation.taskState, 'cancelled');

  if (ephemeralServer) {
    ephemeralServer.close();
  }
});
