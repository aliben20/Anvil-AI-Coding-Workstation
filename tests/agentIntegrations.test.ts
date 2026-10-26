import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AgentToolIntegrationManager } from '../src/server/agentToolIntegrationManager.js';
import { DEFAULT_PROVIDERS } from '../src/server/workstationEngine.js';

const ROOT_DIR = process.cwd();
const TEST_DATA_DIR = path.join(ROOT_DIR, '.anvil-data', 'test-integrations');

test('Integration Registry: src/types.ts defines 4 agent integrations and explicit states', () => {
  const typesPath = path.join(ROOT_DIR, 'src', 'types.ts');
  const content = fs.readFileSync(typesPath, 'utf8');

  // Verify all 4 required tool IDs
  assert.ok(content.includes("'mobile-harness'"), 'Must include mobile-harness');
  assert.ok(content.includes("'antigravity'"), 'Must include antigravity');
  assert.ok(content.includes("'opencode'"), 'Must include opencode');
  assert.ok(content.includes("'claude-code'"), 'Must include claude-code');

  // Verify explicit lifecycle states
  assert.ok(content.includes("'Not installed'"), 'Must include Not installed');
  assert.ok(content.includes("'Installing'"), 'Must include Installing');
  assert.ok(content.includes("'Installed'"), 'Must include Installed');
  assert.ok(content.includes("'Authentication required'"), 'Must include Authentication required');
  assert.ok(content.includes("'Connecting'"), 'Must include Connecting');
  assert.ok(content.includes("'Ready'"), 'Must include Ready');
  assert.ok(content.includes("'Failed'"), 'Must include Failed');
  assert.ok(content.includes("'Unsupported on this device'"), 'Must include Unsupported on this device');
});

test('AgentToolIntegrationManager: returns live status for all 4 integrations without secrets leakage', async () => {
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

  const mockVault: Record<string, string> = {
    antigravity: 'test-gemini-key',
  };

  const manager = new AgentToolIntegrationManager(
    TEST_DATA_DIR,
    ROOT_DIR,
    (key) => mockVault[key] || null,
    (key, val) => {
      mockVault[key] = val;
    }
  );

  const integrations = await manager.getAllIntegrations();
  assert.equal(integrations.length, 4, 'Must return exactly 4 agent integrations');

  const ids = integrations.map((i) => i.id);
  assert.ok(ids.includes('mobile-harness'), 'Must include mobile-harness');
  assert.ok(ids.includes('antigravity'), 'Must include antigravity');
  assert.ok(ids.includes('opencode'), 'Must include opencode');
  assert.ok(ids.includes('claude-code'), 'Must include claude-code');

  // Secrets integrity check: No raw secrets exposed
  for (const item of integrations) {
    assert.equal((item as any).apiKey, undefined, `apiKey must not be exposed on ${item.id}`);
    assert.ok(item.capabilities, `${item.id} must define capability flags`);
    assert.ok(item.availableModels.length > 0, `${item.id} must define models or profiles`);
    assert.ok(item.supportedPlatforms.length > 0, `${item.id} must define supported platforms`);
  }

  // Check Antigravity authentication state derived from vault key
  const ag = integrations.find((i) => i.id === 'antigravity');
  assert.ok(ag, 'Antigravity integration must exist');
  assert.equal(ag.hasStoredApiKey, true, 'Antigravity should detect mockVault key');
  assert.equal(ag.authStatus, 'authenticated');
});

test('AgentToolIntegrationManager: configure updates hostUrl and apiKey safely', async () => {
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

  const mockVault: Record<string, string> = {};
  const manager = new AgentToolIntegrationManager(
    TEST_DATA_DIR,
    ROOT_DIR,
    (key) => mockVault[key] || null,
    (key, val) => {
      mockVault[key] = val;
    }
  );

  const updated = await manager.configureIntegration('mobile-harness', {
    hostUrl: 'http://192.168.1.100:8000',
    mode: 'remote_host',
  });

  assert.equal(updated.id, 'mobile-harness');
  assert.equal(updated.hostUrl, 'http://192.168.1.100:8000');
  assert.equal(updated.isRemoteHost, true);

  // Configure Claude Code with an API key
  const updatedClaude = await manager.configureIntegration('claude-code', {
    apiKey: 'sk-ant-test-secret-key-12345',
  });

  assert.equal(updatedClaude.id, 'claude-code');
  assert.equal(updatedClaude.hasStoredApiKey, true);
  assert.equal(mockVault['claude-code'], 'sk-ant-test-secret-key-12345');
  assert.equal((updatedClaude as any).apiKey, undefined, 'Raw secret must not be in returned object');
});

test('Workstation Engine: DEFAULT_PROVIDERS registers claude-code, opencode, and mobile-harness', () => {
  const providerIds = DEFAULT_PROVIDERS.map((p) => p.id);
  assert.ok(providerIds.includes('claude-code'), 'DEFAULT_PROVIDERS must include claude-code');
  assert.ok(providerIds.includes('opencode'), 'DEFAULT_PROVIDERS must include opencode');
  assert.ok(providerIds.includes('mobile-harness'), 'DEFAULT_PROVIDERS must include mobile-harness');
  assert.ok(providerIds.includes('antigravity'), 'DEFAULT_PROVIDERS must include antigravity');
});

test('ToolsTab UI: contains Coding Agents subview and actions', () => {
  const toolsTabPath = path.join(ROOT_DIR, 'src', 'components', 'ToolsTab.tsx');
  const content = fs.readFileSync(toolsTabPath, 'utf8');

  assert.ok(content.includes("subView === 'integrations'"), 'ToolsTab must handle integrations subView');
  assert.ok(content.includes('Coding Agents & AI Toolchains'), 'ToolsTab must render Coding Agents title');
  assert.ok(content.includes('handleVerifyIntegration'), 'ToolsTab must define verify handler');
  assert.ok(content.includes('handleOpenConfigureIntegration'), 'ToolsTab must define configure handler');
  assert.ok(content.includes('handleInstallIntegration'), 'ToolsTab must define install handler');
});

test('ChatTab UI: AI Model Selector includes Coding Agents tab', () => {
  const chatTabPath = path.join(ROOT_DIR, 'src', 'components', 'ChatTab.tsx');
  const content = fs.readFileSync(chatTabPath, 'utf8');

  assert.ok(content.includes("modelSelectorTab === 'agents'"), 'ChatTab must support agents modelSelectorTab');
  assert.ok(content.includes('fetchAgentIntegrations'), 'ChatTab must fetch integrations from API');
  assert.ok(content.includes('Select & Connect'), 'ChatTab must provide 1-tap select and connect action');
  assert.ok(content.includes('isCurrentClaudeCode'), 'ChatTab header must support Claude Code indicator');
  assert.ok(content.includes('isCurrentOpenCode'), 'ChatTab header must support OpenCode indicator');
  assert.ok(content.includes('isCurrentMobileHarness'), 'ChatTab header must support Mobile Harness indicator');
});
