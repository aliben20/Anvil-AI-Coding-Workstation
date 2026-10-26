import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();

test('Duet Agent Android: TabDestination includes duet', () => {
  const typesPath = path.join(ROOT_DIR, 'src', 'types.ts');
  const content = fs.readFileSync(typesPath, 'utf8');
  assert.ok(
    content.includes("| 'duet'"),
    'src/types.ts must include "duet" in TabDestination union'
  );
});

test('Duet Agent Android: App.tsx routes duet tab and top hub bar', () => {
  const appPath = path.join(ROOT_DIR, 'src', 'App.tsx');
  const content = fs.readFileSync(appPath, 'utf8');

  assert.ok(
    content.includes("import { DuetAgentView } from './components/DuetAgentView'"),
    'App.tsx must import DuetAgentView'
  );
  assert.ok(
    content.includes("activeTab === 'duet'"),
    'App.tsx must route activeTab === "duet"'
  );
  assert.ok(
    content.includes("{ id: 'duet' as TabDestination, label: 'Duet', icon: Bot }"),
    'App.tsx top hub items must include Duet'
  );
  assert.ok(
    content.includes("activeTab === 'agents' || activeTab === 'duet'"),
    'Mobile bottom nav must highlight Agents tab when duet is active'
  );
});

test('Duet Agent Android: DuetAgentView has responsive mobile segmented controls', () => {
  const duetPath = path.join(ROOT_DIR, 'src', 'components', 'DuetAgentView.tsx');
  const content = fs.readFileSync(duetPath, 'utf8');

  assert.ok(
    content.includes("const [mobileTab, setMobileTab] = useState<'workspace' | 'agents' | 'diffs'>('workspace');"),
    'DuetAgentView must support mobile sub-tabs (workspace, agents, diffs)'
  );
  assert.ok(
    content.includes('2x AI'),
    'DuetAgentView must show 2x AI collaboration badge'
  );
  assert.ok(
    content.includes('Dual-Model Orchestration Engine'),
    'DuetAgentView must display dual-model orchestration header'
  );
  assert.ok(
    content.includes('LEAD CODER'),
    'DuetAgentView must render Primary Agent Lead Coder card'
  );
  assert.ok(
    content.includes('PEER REVIEWER'),
    'DuetAgentView must render Collaborator Peer Reviewer card'
  );
  assert.ok(
    content.includes('96% CONSENSUS ALIGNED'),
    'DuetAgentView must render consensus alignment status'
  );
  assert.ok(
    content.includes('min-h-[44px]'),
    'DuetAgentView must ensure minimum 44px touch targets for Android'
  );
});

test('Duet Agent Android: Native Android Jetpack Compose has Duet Multi-Agent mode', () => {
  const vmPath = path.join(
    ROOT_DIR,
    'android-workstation/app/src/main/java/io/anvil/workstation/ui/WorkstationViewModel.kt'
  );
  const vmContent = fs.readFileSync(vmPath, 'utf8');

  assert.ok(
    vmContent.includes('class DuetTurn('),
    'WorkstationViewModel must define DuetTurn class'
  );
  assert.ok(
    vmContent.includes('fun runDuetTurn()'),
    'WorkstationViewModel must implement runDuetTurn() function'
  );

  const nativeAppPath = path.join(
    ROOT_DIR,
    'android-workstation/app/src/main/java/io/anvil/workstation/ui/ObsidianNativeApp.kt'
  );
  const nativeAppContent = fs.readFileSync(nativeAppPath, 'utf8');

  assert.ok(
    nativeAppContent.includes('Duet Multi-Agent (2x AI)'),
    'ObsidianNativeApp must render Duet Multi-Agent (2x AI) filter chip'
  );
  assert.ok(
    nativeAppContent.includes('private fun DuetTurnCard(turn: DuetTurn)'),
    'ObsidianNativeApp must define DuetTurnCard component'
  );
  assert.ok(
    nativeAppContent.includes('96% Consensus Aligned'),
    'ObsidianNativeApp must show consensus status badge'
  );
});
