/**
 * Obsidian Duet Agent - Security & Permission Enforcement Test Suite
 * Tests 9, 16, and boundary policies.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { PermissionPolicyEnforcer } from '../../apps/companion/src/tools/policies.js';
import { CompanionAuthManager } from '../../apps/companion/src/api/auth.js';
import { CompanionDatabase } from '../../apps/companion/src/storage/database.js';
import { DatabaseMigrator } from '../../apps/companion/src/storage/migrations.js';
import { CompanionRepository } from '../../apps/companion/src/storage/repository.js';

test('Security Policy: Path validation allows paths inside approved roots and blocks traversal', () => {
  const tempProjectDir = path.resolve('.anvil-data/test-project-root');
  fs.mkdirSync(tempProjectDir, { recursive: true });

  const enforcer = new PermissionPolicyEnforcer([tempProjectDir]);

  // Valid path inside approved root
  const validPath = path.join(tempProjectDir, 'src', 'index.ts');
  const checked = enforcer.validateProjectPath(validPath);
  assert.ok(checked.toLowerCase().startsWith(tempProjectDir.toLowerCase()));

  // Rejection 1: Directory traversal using '..'
  assert.throws(
    () => enforcer.validateProjectPath(path.join(tempProjectDir, '..', '..', 'UnauthorizedFolder', 'file.txt')),
    /Access Denied/i
  );

  // Rejection 2: Arbitrary external system path
  assert.throws(
    () => enforcer.validateProjectPath('C:\\Windows\\System32\\drivers\\etc\\hosts'),
    /Security Exception|Access Denied/i
  );

  // Rejection 3: Sensitive path patterns (.ssh, .aws)
  assert.throws(
    () => enforcer.validateProjectPath(path.join(tempProjectDir, '.ssh', 'id_rsa')),
    /Security Exception.*sensitive path/i
  );

  // Rejection 4: Illegal device names (NUL, CON)
  assert.throws(
    () => enforcer.validateProjectPath(path.join(tempProjectDir, 'nul.txt')),
    /Security Exception.*device names/i
  );
});

test('Security Policy: Terminal executable allowlist strictly blocks arbitrary shells or destructive binaries', () => {
  const enforcer = new PermissionPolicyEnforcer();

  // Allowed executables
  assert.equal(enforcer.validateTerminalExecutable('git'), 'git');
  assert.equal(enforcer.validateTerminalExecutable('npm'), 'npm');
  assert.equal(enforcer.validateTerminalExecutable('node'), 'node');

  // Blocked executables
  assert.throws(() => enforcer.validateTerminalExecutable('powershell'), /Command execution blocked/i);
  assert.throws(() => enforcer.validateTerminalExecutable('cmd'), /Command execution blocked/i);
  assert.throws(() => enforcer.validateTerminalExecutable('rmdir'), /Command execution blocked/i);
  assert.throws(() => enforcer.validateTerminalExecutable('curl'), /Command execution blocked/i);
});

test('Security Policy: Browser URL validation blocks internal networks and cloud metadata', () => {
  const enforcer = new PermissionPolicyEnforcer();

  // Allowed domain
  const validUrl = enforcer.validateBrowserUrl('https://docs.anthropic.com/en/docs');
  assert.equal(validUrl.hostname, 'docs.anthropic.com');

  // Blocked 1: Cloud metadata IP
  assert.throws(() => enforcer.validateBrowserUrl('http://169.254.169.254/latest/meta-data'), /Security Exception.*cloud metadata/i);

  // Blocked 2: Localhost / loopback
  assert.throws(() => enforcer.validateBrowserUrl('http://127.0.0.1:8080/admin'), /Security Exception.*internal\/private/i);
  assert.throws(() => enforcer.validateBrowserUrl('http://localhost:3000'), /Security Exception.*internal\/private/i);

  // Blocked 3: Private subnet
  assert.throws(() => enforcer.validateBrowserUrl('http://192.168.1.1/router'), /Security Exception.*internal\/private/i);

  // Blocked 4: Unapproved external domain
  assert.throws(() => enforcer.validateBrowserUrl('https://malicious-site.example.org'), /not in the approved browser allowlist/i);
});

test('Security Policy: Companion rejects unauthorized requests (HTTP 401)', () => {
  const db = new CompanionDatabase(':memory:');
  new DatabaseMigrator(db.getRawDb()).runMigrations();
  const repo = new CompanionRepository(db.getRawDb());
  const auth = new CompanionAuthManager(repo);

  const mockReply = {
    statusCode: 200,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(data: any) {
      this.body = data;
      return this;
    },
  };

  // Missing Authorization header
  const reqNoHeader = { headers: {} } as any;
  const ok1 = auth.authenticateRequest(reqNoHeader, mockReply as any);
  assert.equal(ok1, false);
  assert.equal(mockReply.statusCode, 401);

  // Invalid Token
  const reqBadToken = { headers: { authorization: 'Bearer completely-fake-token-12345' } } as any;
  const ok2 = auth.authenticateRequest(reqBadToken, mockReply as any);
  assert.equal(ok2, false);
  assert.equal(mockReply.statusCode, 401);

  // Valid Token
  const validToken = auth.getOrCreatePairingToken();
  const reqGood = { headers: { authorization: `Bearer ${validToken}` } } as any;
  const ok3 = auth.authenticateRequest(reqGood, mockReply as any);
  assert.equal(ok3, true);

  db.close();
});
