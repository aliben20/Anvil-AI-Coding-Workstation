import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SkillsManager } from '../src/server/skillsManager.js';

describe('OBSIDIAN Skills System Suite', () => {
  let tempDir: string;
  let skillsManager: SkillsManager;

  const mockWorkspaceResolver = {
    getWorkspaceRoot: (wsId: string) => path.join(tempDir, 'workspaces', wsId),
  };

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-skills-test-'));
    skillsManager = new SkillsManager(tempDir, mockWorkspaceResolver);
  });

  after(() => {
    try {
      skillsManager.dispose();
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test('seeds all 8 initial production-grade built-in skills on startup', () => {
    const list = skillsManager.listSkills();
    assert.ok(list.length >= 8, `Expected at least 8 seeded skills, got ${list.length}`);

    const expectedIds = [
      'android-apk-builder',
      'apk-size-optimizer',
      'kotlin-compose-dev',
      'build-failure-debugger',
      'code-reviewer',
      'test-planner',
      'responsive-ui-designer',
      'manifest-security-auditor',
    ];

    for (const id of expectedIds) {
      const found = list.find((s) => s.id === id);
      assert.ok(found, `Expected built-in skill "${id}" to be present.`);
      assert.equal(found.enabled, true);
      assert.equal(found.scope, 'global');
      assert.equal(found.source, 'built-in');
      assert.ok(found.requiredTools.length > 0, `Skill ${id} should declare tools.`);
    }
  });

  test('supports progressive disclosure: summary excludes instructions, getSkill includes instructions', () => {
    const list = skillsManager.listSkills();
    const apkSummary = list.find((s) => s.id === 'android-apk-builder');
    assert.ok(apkSummary);
    // SkillSummary should not contain instructions
    assert.equal((apkSummary as any).instructions, undefined);

    const fullDef = skillsManager.getSkill('android-apk-builder');
    assert.ok(fullDef);
    assert.equal(fullDef.id, 'android-apk-builder');
    assert.ok(fullDef.instructions.includes('# Android APK Builder Playbook'));
    assert.ok(fullDef.instructions.length > 50);
  });

  test('parses and serializes Agent Skills convention SKILL.md with YAML frontmatter', () => {
    const sampleRaw = `---
name: "Custom Linting Pro"
description: "Advanced linting guidelines for OBSIDIAN projects."
version: "2.1.0"
category: code
scope: global
author: "Security Team"
tools:
  - read_file
  - search_files
keywords:
  - lint
  - static-analysis
  - formatting
prerequisites:
  - node 18+
---

# Instructions
Run static analysis on every modified file and verify formatting rules.
`;

    const { frontmatter, instructions } = skillsManager.parseSkillMarkdown(sampleRaw);
    assert.equal(frontmatter.name, 'Custom Linting Pro');
    assert.equal(frontmatter.description, 'Advanced linting guidelines for OBSIDIAN projects.');
    assert.equal(frontmatter.version, '2.1.0');
    assert.equal(frontmatter.category, 'code');
    assert.deepEqual(frontmatter.tools, ['read_file', 'search_files']);
    assert.deepEqual(frontmatter.keywords, ['lint', 'static-analysis', 'formatting']);
    assert.ok(instructions.includes('Run static analysis on every modified file'));

    const serialized = skillsManager.serializeSkillMarkdown({
      name: String(frontmatter.name),
      description: String(frontmatter.description),
      version: String(frontmatter.version),
      category: String(frontmatter.category),
      scope: 'global',
      author: String(frontmatter.author),
      tools: frontmatter.tools as string[],
      keywords: frontmatter.keywords as string[],
      prerequisites: frontmatter.prerequisites as string[],
      instructions,
    });

    assert.ok(serialized.startsWith('---'));
    assert.ok(serialized.includes('name: "Custom Linting Pro"'));
    assert.ok(serialized.includes('tools:'));
    assert.ok(serialized.includes('  - read_file'));
  });

  test('security: sanitizes skill IDs and blocks path traversal attempts', () => {
    assert.throws(
      () => {
        skillsManager.sanitizeId('../../../etc/passwd');
      },
      /Invalid skill ID/
    );

    assert.throws(
      () => {
        skillsManager.sanitizeId('..\\windows\\system32');
      },
      /Invalid skill ID/
    );

    assert.throws(
      () => {
        skillsManager.sanitizeId('');
      },
      /Invalid skill ID/
    );

    // Valid sanitization
    const valid = skillsManager.sanitizeId('My Awesome Skill 123!');
    assert.equal(valid, 'my-awesome-skill-123');
  });

  test('selective runtime matching: conversational greetings match ZERO skills', () => {
    const greetings = [
      'hi',
      'hello',
      'hey!',
      'Good morning',
      'who are you',
      'what can you do',
      'thanks',
      'thank you',
      'howdy',
    ];

    for (const prompt of greetings) {
      const matched = skillsManager.matchSkills(prompt);
      assert.equal(
        matched.length,
        0,
        `Expected greeting "${prompt}" to match 0 skills, but got: ${matched.map((s) => s.id).join(', ')}`
      );
    }
  });

  test('selective runtime matching: build requests selectively match android build skills', () => {
    const buildPrompt = 'Please build the notes APK with release optimizations and verify container';
    const matched = skillsManager.matchSkills(buildPrompt);

    assert.ok(matched.length >= 1, 'Should match relevant build skills');
    const ids = matched.map((s) => s.id);
    assert.ok(
      ids.includes('android-apk-builder'),
      `Expected android-apk-builder in matched list: ${ids.join(', ')}`
    );
    // Should NOT match unrelated skills like responsive-ui-designer or code-reviewer
    assert.ok(!ids.includes('responsive-ui-designer'));
  });

  test('selective runtime matching: supports explicit skill invocations (@skill:id and $id)', () => {
    const explicitPrompt = 'Can you run a check with @skill:kotlin-compose-dev on the main screen?';
    const matched = skillsManager.matchSkills(explicitPrompt);

    assert.ok(matched.length >= 1);
    const ids = matched.map((s) => s.id);
    assert.ok(
      ids.includes('kotlin-compose-dev'),
      `Expected kotlin-compose-dev to be explicitly matched: ${ids.join(', ')}`
    );
  });

  test('persists toggle of enabled/disabled state and ignores disabled skills during matching', () => {
    // Disable android-apk-builder
    skillsManager.setSkillEnabled('android-apk-builder', false);

    const apkDef = skillsManager.getSkill('android-apk-builder');
    assert.ok(apkDef);
    assert.equal(apkDef.enabled, false);

    // Requesting build should now NOT match the disabled skill
    const matched = skillsManager.matchSkills('build the android APK now');
    const ids = matched.map((s) => s.id);
    assert.ok(
      !ids.includes('android-apk-builder'),
      'Disabled skill must not be matched in execution pipeline'
    );

    // Re-enable
    skillsManager.setSkillEnabled('android-apk-builder', true);
    const apkDefReenabled = skillsManager.getSkill('android-apk-builder');
    assert.ok(apkDefReenabled);
    assert.equal(apkDefReenabled.enabled, true);
  });

  test('allows creating, importing, and deleting custom skills', () => {
    const custom = skillsManager.createSkill({
      id: 'custom-sqlite-helper',
      name: 'Custom SQLite Helper',
      description: 'Room and SQLite optimization guidelines for mobile database layers.',
      category: 'code',
      scope: 'global',
      instructions: `# SQLite Playbook\nAlways use transactions and indexed columns for fast queries.`,
      keywords: ['sqlite', 'database', 'room', 'sql'],
      requiredTools: ['read_file', 'write_file'],
    });

    assert.equal(custom.id, 'custom-sqlite-helper');
    assert.equal(custom.name, 'Custom SQLite Helper');

    // Test retrieval
    const retrieved = skillsManager.getSkill('custom-sqlite-helper');
    assert.ok(retrieved);
    assert.equal(retrieved.category, 'code');

    // Test import from markdown string
    const importedMarkdown = `---
name: "Web Performance Tuner"
description: "Vite bundle analysis and compression optimizer."
category: ui
tools: [run_command]
keywords: [vite, bundle, rollup, minify]
---

# Vite Optimization
Use manual chunks and tree-shaking plugins.
`;
    const imported = skillsManager.importFromMarkdown(importedMarkdown, 'global');
    assert.ok(imported.id.includes('web-performance-tuner'));
    assert.equal(imported.source, 'imported');

    // Clean up created skills
    const deleted1 = skillsManager.deleteSkill('custom-sqlite-helper');
    assert.equal(deleted1, true);
    const deleted2 = skillsManager.deleteSkill(imported.id);
    assert.equal(deleted2, true);

    assert.equal(skillsManager.getSkill('custom-sqlite-helper'), null);
  });

  test('discovers skills across multi-directory conventions (.agents/skills, .skills, skills, .anvil/skills)', () => {
    const wsId = 'test-multi-dir-ws';
    const wsRoot = path.join(tempDir, 'workspaces', wsId);

    // 1. Create skill in .agents/skills
    const agentSkillDir = path.join(wsRoot, '.agents', 'skills', 'skill-from-agents');
    fs.mkdirSync(agentSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentSkillDir, 'SKILL.md'),
      `---
name: Skill From Agents
description: "Discovered from .agents/skills directory."
---
# Instructions
Agents skill playbook.`
    );

    // 2. Create skill in .skills
    const dotSkillDir = path.join(wsRoot, '.skills', 'skill-from-dotskills');
    fs.mkdirSync(dotSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(dotSkillDir, 'SKILL.md'),
      `---
name: Skill From DotSkills
description: "Discovered from .skills directory."
---
# Instructions
DotSkills playbook.`
    );

    // 3. Create skill in skills/
    const normalSkillDir = path.join(wsRoot, 'skills', 'skill-from-normalskills');
    fs.mkdirSync(normalSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(normalSkillDir, 'SKILL.md'),
      `---
name: Skill From NormalSkills
description: "Discovered from skills directory."
---
# Instructions
Normal skills playbook.`
    );

    // 4. Create skill in .anvil/skills
    const anvilSkillDir = path.join(wsRoot, '.anvil', 'skills', 'skill-from-anvil');
    fs.mkdirSync(anvilSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(anvilSkillDir, 'SKILL.md'),
      `---
name: Skill From Anvil
description: "Discovered from .anvil/skills directory."
---
# Instructions
Anvil skills playbook.`
    );

    const list = skillsManager.listSkills(wsId);
    const foundAgents = list.find((s) => s.id === 'skill-from-agents');
    const foundDot = list.find((s) => s.id === 'skill-from-dotskills');
    const foundNormal = list.find((s) => s.id === 'skill-from-normalskills');
    const foundAnvil = list.find((s) => s.id === 'skill-from-anvil');

    assert.ok(foundAgents, 'Skill in .agents/skills should be discovered');
    assert.equal(foundAgents.scope, 'workspace');
    assert.equal(foundAgents.validationStatus, 'valid');
    assert.ok(foundAgents.canonicalPath?.includes('.agents'));

    assert.ok(foundDot, 'Skill in .skills should be discovered');
    assert.equal(foundDot.scope, 'workspace');
    assert.equal(foundDot.validationStatus, 'valid');

    assert.ok(foundNormal, 'Skill in skills/ should be discovered');
    assert.equal(foundNormal.scope, 'workspace');
    assert.equal(foundNormal.validationStatus, 'valid');

    assert.ok(foundAnvil, 'Skill in .anvil/skills should be discovered');
    assert.equal(foundAnvil.scope, 'workspace');
    assert.equal(foundAnvil.validationStatus, 'valid');
  });

  test('accurately classifies validation status: valid, invalid, and missing', () => {
    const wsId = 'test-validation-ws';
    const wsRoot = path.join(tempDir, 'workspaces', wsId);

    // 1. Missing SKILL.md folder
    const emptyFolder = path.join(wsRoot, '.agents', 'skills', 'empty-skill-dir');
    fs.mkdirSync(emptyFolder, { recursive: true });

    // 2. Invalid frontmatter (missing description)
    const invalidSkillDir = path.join(wsRoot, '.agents', 'skills', 'invalid-skill');
    fs.mkdirSync(invalidSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(invalidSkillDir, 'SKILL.md'),
      `---
name: Incomplete Skill
---
# Instructions
Missing description in frontmatter.`
    );

    const list = skillsManager.listSkills(wsId);
    const missing = list.find((s) => s.id === 'empty-skill-dir');
    const invalid = list.find((s) => s.id === 'invalid-skill');

    assert.ok(missing, 'Missing SKILL.md folder should be reported');
    assert.equal(missing.validationStatus, 'missing');
    assert.ok(missing.validationError?.includes('Missing SKILL.md'));
    assert.equal(missing.enabled, false);

    assert.ok(invalid, 'Invalid frontmatter should be reported');
    assert.equal(invalid.validationStatus, 'invalid');
    assert.ok(invalid.validationError?.includes('Missing "description"'));
    assert.equal(invalid.enabled, false);
  });

  test('tolerantly parses complex YAML frontmatter with escaped quotes and multiline blocks', () => {
    const raw = `---
name: code-review
description: "Review the changes along two axes. Use when the user asks to \\"review since X\\"."
tools:
  - read_file
  - run_command
keywords:
  - review
  - audit
---

# Code Review Protocol
Perform thorough review.`;

    const { frontmatter, instructions } = skillsManager.parseSkillMarkdown(raw);
    assert.equal(frontmatter.name, 'code-review');
    assert.equal(
      frontmatter.description,
      'Review the changes along two axes. Use when the user asks to "review since X".'
    );
    assert.deepEqual(frontmatter.tools, ['read_file', 'run_command']);
    assert.deepEqual(frontmatter.keywords, ['review', 'audit']);
    assert.ok(instructions.includes('Perform thorough review.'));
  });

  test('notifies listeners on rescan and setupWatchers', (t, done) => {
    let notified = false;
    const unsubscribe = skillsManager.onSkillsChanged((wsId) => {
      notified = true;
      unsubscribe();
      assert.ok(true);
      done();
    });

    skillsManager.rescan();
  });

  test('discovers all real installed skills in workspaces/j-j/.agents/skills when available', () => {
    const realWsResolver = {
      getWorkspaceRoot: (id: string) => path.join(process.cwd(), 'workspaces', id),
    };
    const realManager = new SkillsManager(path.join(process.cwd(), '.anvil-data'), realWsResolver);
    const jjSkills = realManager.listSkills('j-j');

    const jjWorkspaceSkills = jjSkills.filter((s) => s.scope === 'workspace');
    assert.ok(
      jjWorkspaceSkills.length >= 38,
      `Expected at least 38 installed skills in j-j, found ${jjWorkspaceSkills.length}`
    );

    const askMatt = jjSkills.find((s) => s.id === 'ask-matt');
    assert.ok(askMatt, 'ask-matt should be discovered in j-j');
    assert.equal(askMatt.scope, 'workspace');
    assert.equal(askMatt.validationStatus, 'valid');

    const codeReview = jjSkills.find((s) => s.id === 'code-review');
    assert.ok(codeReview, 'code-review should be discovered in j-j');
    assert.equal(codeReview.scope, 'workspace');
    assert.equal(codeReview.validationStatus, 'valid');
    assert.ok(codeReview.description.includes('review since X'));

    realManager.dispose();
  });
});
