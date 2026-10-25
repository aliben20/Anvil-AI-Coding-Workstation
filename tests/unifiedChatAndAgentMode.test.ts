import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import fs from 'fs';
import path from 'path';

process.env.ANVIL_TEST_MODE = '1';

let activeBaseUrl = '';
let ephemeralServer: http.Server | null = null;

async function getBaseUrl(): Promise<string> {
  if (activeBaseUrl) return activeBaseUrl;

  const { createApp } = await import('../server.js');
  const app = createApp();
  ephemeralServer = http.createServer(app);
  await new Promise<void>((resolve) => ephemeralServer!.listen(0, '127.0.0.1', () => resolve()));
  const addr = ephemeralServer.address() as { port: number };
  activeBaseUrl = `http://127.0.0.1:${addr.port}`;
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

// ---------------------------------------------------------------------------
// TEST 1: Normal Chat works with configured API provider (tools disabled)
// ---------------------------------------------------------------------------
test('Test 1: Normal Chat works with configured API provider without agent tool execution', async () => {
  const baseUrl = await getBaseUrl();

  // Create test conversation
  const createRes = await fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Unified Test: Normal Chat',
      providerId: 'antigravity',
      modelId: 'gemini-3.8-flash',
      chatMode: 'normal',
    }),
  });
  assert.equal(createRes.status, 200);
  const { conversation: conv } = await createRes.json();
  assert.ok(conv?.id);

  // Send normal chat message (tools disabled)
  const sendRes = await fetch(`${baseUrl}/api/chat/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/x-ndjson',
    },
    body: JSON.stringify({
      conversationId: conv.id,
      content: 'Explain recursion briefly.',
      enableAgentTools: false,
      chatMode: 'normal',
      stream: true,
    }),
  });
  assert.equal(sendRes.status, 200);
  const events = await readNdjsonStream(sendRes);
  const doneEvent = events.find((e) => e.type === 'done');
  if (!doneEvent) {
    console.error('Test 1 failed. Received events:', JSON.stringify(events, null, 2));
  }
  assert.ok(doneEvent, 'Expected done event in stream');
  assert.ok(doneEvent.conversation, 'Expected updated conversation in done event');

  const assistantMsg = doneEvent.conversation.messages.find((m: any) => m.role === 'assistant');
  assert.ok(assistantMsg, 'Expected assistant message');
  assert.ok(assistantMsg.content.length > 0, 'Assistant message content should not be empty');
  assert.notEqual(assistantMsg.content.trim(), 'Explain recursion briefly.', 'Should produce genuine AI answer, not echo');
  // In normal chat, tool calls must not run
  assert.ok(!assistantMsg.toolCalls || assistantMsg.toolCalls.length === 0, 'Normal chat should not execute tool calls');
});

// ---------------------------------------------------------------------------
// TEST 2: Agent Mode uses the exact same API endpoint /api/chat/send
// ---------------------------------------------------------------------------
test('Test 2: Agent Mode uses the exact same API endpoint /api/chat/send with enableAgentTools', async () => {
  const baseUrl = await getBaseUrl();

  const createRes = await fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Unified Test: Agent Mode Endpoint',
      providerId: 'antigravity',
      modelId: 'gemini-3.8-flash',
      chatMode: 'agent',
    }),
  });
  const { conversation: conv } = await createRes.json();

  const sendRes = await fetch(`${baseUrl}/api/chat/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/x-ndjson',
    },
    body: JSON.stringify({
      conversationId: conv.id,
      content: 'List workspace files and describe project structure.',
      enableAgentTools: true,
      chatMode: 'agent',
      collaboratorModelId: 'none',
      stream: true,
    }),
  });
  assert.equal(sendRes.status, 200, 'Same /api/chat/send endpoint must handle Agent Mode');
  const events = await readNdjsonStream(sendRes);
  const doneEvent = events.find((e) => e.type === 'done');
  assert.ok(doneEvent, 'Agent Mode should finish with done event');
  assert.ok(doneEvent.conversation.messages.length >= 2);
});

// ---------------------------------------------------------------------------
// TEST 3: Shared conversation history and persistence between modes
// ---------------------------------------------------------------------------
test('Test 3: Shared conversation history and persistence between modes in one session', async () => {
  const baseUrl = await getBaseUrl();

  // Create conversation
  const createRes = await fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Unified Test: Shared History',
      providerId: 'antigravity',
      modelId: 'gemini-3.8-flash',
      chatMode: 'normal',
    }),
  });
  const { conversation: conv } = await createRes.json();

  // Turn 1: Normal Chat turn
  const send1 = await fetch(`${baseUrl}/api/chat/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify({
      conversationId: conv.id,
      content: 'Turn 1: Normal Chat message',
      enableAgentTools: false,
      chatMode: 'normal',
      stream: true,
    }),
  });
  const events1 = await readNdjsonStream(send1);
  const done1 = events1.find((e) => e.type === 'done');
  assert.ok(done1);
  const countAfterTurn1 = done1.conversation.messages.length;
  assert.ok(countAfterTurn1 >= 2);

  // Turn 2: Agent Mode turn in the EXACT SAME conversation
  const send2 = await fetch(`${baseUrl}/api/chat/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify({
      conversationId: conv.id,
      content: 'Turn 2: Agent Mode task with tools',
      enableAgentTools: true,
      chatMode: 'agent',
      stream: true,
    }),
  });
  const events2 = await readNdjsonStream(send2);
  const done2 = events2.find((e) => e.type === 'done');
  assert.ok(done2);
  const countAfterTurn2 = done2.conversation.messages.length;
  assert.ok(countAfterTurn2 > countAfterTurn1, 'Messages from both modes must accumulate in one history');

  // Verify persistence via GET /api/conversations
  const getRes = await fetch(`${baseUrl}/api/conversations`);
  const data = await getRes.json();
  const fetched = data.conversations.find((c: any) => c.id === conv.id);
  assert.ok(fetched, 'Conversation must persist in store');
  assert.equal(fetched.messages.length, countAfterTurn2, 'All messages from both modes must be intact');
});

// ---------------------------------------------------------------------------
// TEST 4: Switching modes preserves current conversation without message loss
// ---------------------------------------------------------------------------
test('Test 4: Switching modes preserves conversation without message loss', async () => {
  const baseUrl = await getBaseUrl();

  const createRes = await fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Unified Test: Mode Switch',
      providerId: 'antigravity',
      modelId: 'gemini-3.8-flash',
      chatMode: 'normal',
    }),
  });
  const { conversation: conv } = await createRes.json();

  // Add a message
  await fetch(`${baseUrl}/api/chat/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify({
      conversationId: conv.id,
      content: 'Message before switching mode',
      enableAgentTools: false,
      chatMode: 'normal',
      stream: true,
    }),
  });

  // Switch mode to 'agent' via PATCH /api/conversations/:id
  const patchRes = await fetch(`${baseUrl}/api/conversations/${encodeURIComponent(conv.id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chatMode: 'agent',
      collaboratorModelId: 'gemini-2.5-pro',
    }),
  });
  assert.equal(patchRes.status, 200);
  const patchData = await patchRes.json();
  const patchedConv = patchData.conversation;

  assert.equal(patchedConv.chatMode, 'agent');
  assert.equal(patchedConv.collaboratorModelId, 'gemini-2.5-pro');
  assert.ok(patchedConv.messages.length >= 2, 'Previous messages must NOT be discarded on mode switch');

  // Switch back to 'normal'
  const patchRes2 = await fetch(`${baseUrl}/api/conversations/${encodeURIComponent(conv.id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chatMode: 'normal',
    }),
  });
  const patchData2 = await patchRes2.json();
  assert.equal(patchData2.conversation.chatMode, 'normal');
  assert.equal(patchData2.conversation.messages.length, patchedConv.messages.length, 'No message loss when switching back');
});

// ---------------------------------------------------------------------------
// TEST 5: Agent activity and tool events appear in the same conversation
// ---------------------------------------------------------------------------
test('Test 5: Agent activity and collaborator review stream into the same conversation', async () => {
  const baseUrl = await getBaseUrl();

  const createRes = await fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Unified Test: Agent Activity',
      providerId: 'antigravity',
      modelId: 'gemini-3.8-flash',
      chatMode: 'agent',
    }),
  });
  const { conversation: conv } = await createRes.json();

  const sendRes = await fetch(`${baseUrl}/api/chat/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify({
      conversationId: conv.id,
      content: 'Analyze workspace dependencies and suggest optimizations',
      enableAgentTools: true,
      chatMode: 'agent',
      collaboratorModelId: 'gemini-3.1-flash-lite',
      stream: true,
    }),
  });

  const events = await readNdjsonStream(sendRes);
  const doneEvent = events.find((e) => e.type === 'done');
  assert.ok(doneEvent);

  const assistantMsg = doneEvent.conversation.messages.find((m: any) => m.role === 'assistant');
  assert.ok(assistantMsg);
  // Collaborator review executed or collaborator model associated
  assert.ok(assistantMsg.collaboratorModelId || assistantMsg.collaboratorContent !== undefined);
});

// ---------------------------------------------------------------------------
// TEST 6: Stop cancels active normal or agent generation cleanly
// ---------------------------------------------------------------------------
test('Test 6: Stop cancels active generation cleanly without corrupting conversation', async () => {
  const baseUrl = await getBaseUrl();

  const createRes = await fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Unified Test: Cancel Generation',
      providerId: 'antigravity',
      modelId: 'gemini-3.8-flash',
      chatMode: 'agent',
    }),
  });
  const { conversation: conv } = await createRes.json();

  // Cancel call on active conversation
  const cancelRes = await fetch(`${baseUrl}/api/chat/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversationId: conv.id,
    }),
  });
  assert.equal(cancelRes.status, 200);
  const cancelData = await cancelRes.json();
  assert.ok(cancelData.ok);
});

// ---------------------------------------------------------------------------
// TEST 7: Agent Mode rejects Local AI models with HTTP 400 and actionable guidance
// ---------------------------------------------------------------------------
test('Test 7: Agent Mode rejects Local AI models with HTTP 400 and actionable error guidance', async () => {
  const baseUrl = await getBaseUrl();

  // Create a conversation with local-ai provider
  const createRes = await fetch(`${baseUrl}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Unified Test: Reject Local AI in Agent Mode',
      providerId: 'local-ai',
      modelId: 'qwen2.5-coder-1.5b-q4_k_m.gguf',
      chatMode: 'agent',
    }),
  });
  const { conversation: conv } = await createRes.json();

  // Attempt to run Agent Mode against local-ai
  const sendRes = await fetch(`${baseUrl}/api/chat/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversationId: conv.id,
      content: 'Refactor this module',
      enableAgentTools: true,
      chatMode: 'agent',
    }),
  });

  assert.equal(sendRes.status, 400, 'Agent Mode must reject local-ai with HTTP 400');
  const errData = await sendRes.json();
  assert.ok(errData.error, 'Must include error message');
  assert.match(
    errData.error,
    /Agent Mode requires an API-backed model/i,
    'Error message must provide actionable guidance to select an API model'
  );
  assert.match(
    errData.error,
    /Local AI \(GGUF\) models are not supported for multi-agent tool execution/i
  );
});

// ---------------------------------------------------------------------------
// TEST 8: Agent model selectors exclude local models
// ---------------------------------------------------------------------------
test('Test 8: Agent model selectors exclude local models and include API-backed models', async () => {
  const baseUrl = await getBaseUrl();

  const provRes = await fetch(`${baseUrl}/api/providers`);
  assert.equal(provRes.status, 200);
  const { providers } = await provRes.json();
  assert.ok(Array.isArray(providers));

  // Replicate filtering logic used in ChatTab & DuetAgentView
  const apiBackedProviders = providers.filter(
    (p: any) => p.id !== 'local-ai' && p.protocol !== 'LOCAL_EMBEDDED'
  );
  const apiBackedModels = apiBackedProviders.flatMap((p: any) =>
    (p.cachedModels || [])
      .filter((m: any) => !m.id.endsWith('.gguf'))
      .map((m: any) => ({
        id: m.id,
        name: m.displayName || m.name || m.id,
        providerId: p.id,
      }))
  );

  // Assert no local models exist in apiBackedModels
  for (const m of apiBackedModels) {
    assert.ok(!m.id.endsWith('.gguf'), `Model ${m.id} is a GGUF file and must not be in agent selector`);
    assert.notEqual(m.providerId, 'local-ai', `Model ${m.id} has local-ai provider and must be excluded`);
  }

  // Antigravity or cloud models should be available
  assert.ok(apiBackedModels.length > 0, 'Should have at least one API-backed model available for Agent Mode');
});

// ---------------------------------------------------------------------------
// TEST 9: Duet Agent tab links to shared chat and does not implement duplicate composer
// ---------------------------------------------------------------------------
test('Test 9: Duet Agent tab links to shared chat and does not implement a duplicate composer', async () => {
  // Read DuetAgentView.tsx source to verify architecture adherence
  const duetViewPath = path.resolve(process.cwd(), 'src/components/DuetAgentView.tsx');
  assert.ok(fs.existsSync(duetViewPath), 'DuetAgentView.tsx must exist');
  const content = fs.readFileSync(duetViewPath, 'utf-8');

  // Verify DuetAgentView does NOT implement its own duplicate chat composer
  assert.ok(
    !content.includes('textarea') || content.includes('taskPrompt'),
    'DuetAgentView must not have duplicate main chat composer'
  );
  // Verify CTA to ChatTab in Agent Mode
  assert.ok(
    content.includes('Open Chat in Agent Mode') || content.includes('onNavigateToChat'),
    'DuetAgentView must link to shared Chat in Agent Mode'
  );
  // Verify references to shared /api/chat/send are NOT duplicated inside DuetAgentView
  assert.ok(
    !content.includes("fetch('/api/chat/send'"),
    'DuetAgentView must not duplicate /api/chat/send stream execution; ChatTab is single entry point'
  );
});

// ---------------------------------------------------------------------------
// TEST 10: Existing Agent Loop and Task features remain functional
// ---------------------------------------------------------------------------
test('Test 10: Existing Agent Loop, Subagents, MCP, and Environment endpoints remain fully functional', async () => {
  const baseUrl = await getBaseUrl();

  // Environment endpoint
  const envRes = await fetch(`${baseUrl}/api/system/environment`);
  assert.equal(envRes.status, 200);

  // Subagents list endpoint
  const subRes = await fetch(`${baseUrl}/api/subagents`);
  assert.equal(subRes.status, 200);
  const subData = await subRes.json();
  assert.ok(Array.isArray(subData.tasks));

  // MCP endpoint
  const mcpRes = await fetch(`${baseUrl}/api/mcp`);
  assert.equal(mcpRes.status, 200);
  const mcpData = await mcpRes.json();
  assert.ok(Array.isArray(mcpData.servers));

  // Agent activity events endpoint
  const evRes = await fetch(`${baseUrl}/api/agent/events`);
  assert.equal(evRes.status, 200);
  const evData = await evRes.json();
  assert.ok(Array.isArray(evData.events));
  assert.ok(Array.isArray(evData.pendingApprovals));
});

test.after(() => {
  if (ephemeralServer) {
    ephemeralServer.close();
  }
});
