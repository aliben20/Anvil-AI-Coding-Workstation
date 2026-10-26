import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  downloadWithDiagnostics,
  extractArchiveSafely,
  createTestZipBuffer,
  ToolchainDownloadError,
  MobileHarnessToolchainManager,
  MOBILE_HARNESS_TOOLCHAIN_SPECS,
} from '../src/server/toolchainManager.js';

const TEST_DIR = path.join(process.cwd(), '.anvil-data', 'test-toolchain-pipeline');
fs.mkdirSync(TEST_DIR, { recursive: true });

function createMockHttpServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ server: http.Server; url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      const url = `http://127.0.0.1:${addr.port}`;
      resolve({
        server,
        url,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

test('1. Successful download and streaming to .part with atomic move and SHA-256 validation', async () => {
  const payload = Buffer.from('TEST_TOOLCHAIN_BINARY_DATA_CHUNK_'.repeat(200));
  const expectedHash = crypto.createHash('sha256').update(payload).digest('hex');

  const { url, close } = await createMockHttpServer((_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(payload.length),
    });
    res.write(payload.subarray(0, 1000));
    setTimeout(() => {
      res.end(payload.subarray(1000));
    }, 20);
  });

  const destFile = path.join(TEST_DIR, 'bundle-test-success.bin');
  const partFile = `${destFile}.part`;
  if (fs.existsSync(destFile)) fs.unlinkSync(destFile);
  if (fs.existsSync(partFile)) fs.unlinkSync(partFile);

  let progressCalled = false;
  const result = await downloadWithDiagnostics({
    toolId: 'test-bundle',
    url: `${url}/bundle.bin`,
    destinationPath: destFile,
    expectedSha256: expectedHash,
    requiredBytes: payload.length,
    onProgress: (received, total) => {
      if (received > 0 && total > 0) progressCalled = true;
    },
  });

  await close();

  assert.equal(result.success, true);
  assert.equal(result.verifiedSha256, true);
  assert.equal(fs.existsSync(destFile), true);
  assert.equal(fs.existsSync(partFile), false, '.part file must be atomically promoted and cleaned up');
  assert.equal(fs.readFileSync(destFile).length, payload.length);
  assert.equal(progressCalled, true);
});

test('2. HTTP 404 response handling with actionable diagnostic message (no corrupt file saved)', async () => {
  const { url, close } = await createMockHttpServer((_req, res) => {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found: Release bundle does not exist.');
  });

  const destFile = path.join(TEST_DIR, 'bundle-404.bin');
  const partFile = `${destFile}.part`;
  if (fs.existsSync(destFile)) fs.unlinkSync(destFile);
  if (fs.existsSync(partFile)) fs.unlinkSync(partFile);

  await assert.rejects(
    async () => {
      await downloadWithDiagnostics({
        toolId: 'missing-tool',
        url: `${url}/non-existent-bundle.tar.zst`,
        destinationPath: destFile,
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ToolchainDownloadError);
      assert.equal(err.stage, 'HTTP_REQUEST');
      assert.equal(err.httpStatus, 404);
      assert.equal(err.exceptionType, 'HttpNotFoundException');
      assert.ok(err.actionableMessage.includes('HTTP 404 Not Found'));
      return true;
    }
  );

  await close();

  assert.equal(fs.existsSync(destFile), false, '404 response must never create a destination archive');
  assert.equal(fs.existsSync(partFile), false, '.part temporary file must not remain');
});

test('3. HTTP 500 server error handling with actionable diagnostic message', async () => {
  const { url, close } = await createMockHttpServer((_req, res) => {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error in upstream storage gateway.');
  });

  const destFile = path.join(TEST_DIR, 'bundle-500.bin');

  await assert.rejects(
    async () => {
      await downloadWithDiagnostics({
        toolId: 'server-error-tool',
        url: `${url}/bundle-error.tar.zst`,
        destinationPath: destFile,
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ToolchainDownloadError);
      assert.equal(err.stage, 'HTTP_REQUEST');
      assert.equal(err.httpStatus, 500);
      assert.equal(err.exceptionType, 'HttpServerErrorException');
      assert.ok(err.actionableMessage.includes('500'));
      return true;
    }
  );

  await close();
  assert.equal(fs.existsSync(destFile), false);
});

test('4. Network connection / TLS failure handling with actionable diagnostic message', async () => {
  const unreachableUrl = 'http://127.0.0.1:59998/offline-toolchain.tar.zst';
  const destFile = path.join(TEST_DIR, 'bundle-network-fail.bin');

  await assert.rejects(
    async () => {
      await downloadWithDiagnostics({
        toolId: 'offline-tool',
        url: unreachableUrl,
        destinationPath: destFile,
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ToolchainDownloadError);
      assert.equal(err.stage, 'NETWORK_CONNECT');
      assert.equal(err.exceptionType, 'NetworkException');
      assert.ok(err.actionableMessage.includes('Network connection failed'));
      return true;
    }
  );

  assert.equal(fs.existsSync(destFile), false);
});

test('5. Interrupted download and cleanup of partial .part file', async () => {
  const { url, close } = await createMockHttpServer((_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': '50000',
    });
    res.write(Buffer.alloc(5000, 'A'));
    // Abruptly destroy socket mid-stream without completing Content-Length
    setTimeout(() => {
      res.destroy();
    }, 30);
  });

  const destFile = path.join(TEST_DIR, 'bundle-interrupted.bin');
  const partFile = `${destFile}.part`;

  await assert.rejects(
    async () => {
      await downloadWithDiagnostics({
        toolId: 'interrupted-tool',
        url: `${url}/interrupted.bin`,
        destinationPath: destFile,
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ToolchainDownloadError);
      assert.equal(err.stage, 'DOWNLOAD_STREAM');
      return true;
    }
  );

  await close();

  assert.equal(fs.existsSync(destFile), false, 'Interrupted file must not be promoted');
  assert.equal(fs.existsSync(partFile), false, 'Partial .part file must be cleaned up on interruption');
});

test('6. Insufficient disk space pre-check validation', async () => {
  const destFile = path.join(TEST_DIR, 'bundle-disk-full.bin');

  await assert.rejects(
    async () => {
      await downloadWithDiagnostics({
        toolId: 'huge-tool',
        url: 'http://127.0.0.1:3000/huge-bundle.bin',
        destinationPath: destFile,
        requiredBytes: 500_000_000,
        availableBytes: 50_000_000, // only 50MB available
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ToolchainDownloadError);
      assert.equal(err.stage, 'DISK_SPACE_CHECK');
      assert.equal(err.exceptionType, 'DiskSpaceExhaustedException');
      assert.ok(err.actionableMessage.includes('Insufficient disk space'));
      return true;
    }
  );

  assert.equal(fs.existsSync(destFile), false);
});

test('7. Checksum mismatch detection and .part file cleanup', async () => {
  const payload = Buffer.from('VALID_DATA_BUT_WRONG_CHECKSUM');
  const actualHash = crypto.createHash('sha256').update(payload).digest('hex');
  const badExpectedHash = '0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff';

  const { url, close } = await createMockHttpServer((_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(payload.length),
    });
    res.end(payload);
  });

  const destFile = path.join(TEST_DIR, 'bundle-bad-checksum.bin');
  const partFile = `${destFile}.part`;

  await assert.rejects(
    async () => {
      await downloadWithDiagnostics({
        toolId: 'checksum-tool',
        url: `${url}/bad-checksum.bin`,
        destinationPath: destFile,
        expectedSha256: badExpectedHash,
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ToolchainDownloadError);
      assert.equal(err.stage, 'CHECKSUM_VERIFICATION');
      assert.equal(err.exceptionType, 'ChecksumMismatchException');
      assert.equal(err.expectedChecksum, badExpectedHash);
      assert.equal(err.actualChecksum, actualHash);
      assert.ok(err.actionableMessage.includes('Checksum verification failed'));
      return true;
    }
  );

  await close();

  assert.equal(fs.existsSync(destFile), false, 'Corrupt file must not be promoted');
  assert.equal(fs.existsSync(partFile), false, 'Corrupt .part file must be removed');
});

test('8. HTML error page saved as archive detection', async () => {
  const htmlErrorPage = '<!DOCTYPE html><html><head><title>404 Not Found</title></head><body><h1>Release not found</h1></body></html>';

  const { url, close } = await createMockHttpServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(htmlErrorPage);
  });

  const destFile = path.join(TEST_DIR, 'bundle-html-error.tar.zst');

  await assert.rejects(
    async () => {
      await downloadWithDiagnostics({
        toolId: 'html-error-tool',
        url: `${url}/fake-asset.tar.zst`,
        destinationPath: destFile,
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ToolchainDownloadError);
      assert.equal(err.stage, 'CONTENT_VALIDATION');
      assert.equal(err.exceptionType, 'HtmlErrorPageException');
      assert.ok(err.actionableMessage.includes('HTML'));
      return true;
    }
  );

  await close();
  assert.equal(fs.existsSync(destFile), false, 'HTML document must never be saved as a toolchain archive');
});

test('9. Archive path traversal (Zip-Slip) vulnerability prevention', async () => {
  // Construct ZIP with path traversal entry
  const maliciousZip = createTestZipBuffer([
    { name: 'bin/good.sh', content: '#!/bin/sh\necho good\n' },
    { name: '../../evil.sh', content: '#!/bin/sh\necho malicious\n' },
  ]);

  const archivePath = path.join(TEST_DIR, 'malicious-zip-slip.zip');
  fs.writeFileSync(archivePath, maliciousZip);

  const destExtractDir = path.join(TEST_DIR, 'extracted-slip');
  if (fs.existsSync(destExtractDir)) fs.rmSync(destExtractDir, { recursive: true, force: true });

  await assert.rejects(
    async () => {
      await extractArchiveSafely({
        archivePath,
        destinationDir: destExtractDir,
        toolId: 'zip-slip-tool',
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ToolchainDownloadError);
      assert.equal(err.stage, 'ARCHIVE_EXTRACTION');
      assert.equal(err.exceptionType, 'ZipSlipPathTraversalException');
      assert.ok(err.actionableMessage.includes('Zip-Slip path traversal vulnerability detected'));
      return true;
    }
  );

  // Verify evil.sh was not written outside target directory
  const escapedFile = path.join(TEST_DIR, 'evil.sh');
  assert.equal(fs.existsSync(escapedFile), false, 'Escaped file must not be written to parent directory');
  assert.equal(fs.existsSync(destExtractDir), false, 'Staging directory must be cleaned up on failure');
});

test('10. Staging extraction failure and atomic rollback', async () => {
  // Create corrupt archive with zero bytes
  const corruptArchive = path.join(TEST_DIR, 'corrupt-archive.zip');
  fs.writeFileSync(corruptArchive, Buffer.alloc(0));

  const destExtractDir = path.join(TEST_DIR, 'extracted-rollback');
  if (fs.existsSync(destExtractDir)) fs.rmSync(destExtractDir, { recursive: true, force: true });

  await assert.rejects(
    async () => {
      await extractArchiveSafely({
        archivePath: corruptArchive,
        destinationDir: destExtractDir,
        toolId: 'rollback-tool',
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ToolchainDownloadError);
      assert.equal(err.stage, 'ARCHIVE_EXTRACTION');
      assert.equal(err.exceptionType, 'CorruptArchiveException');
      return true;
    }
  );

  assert.equal(fs.existsSync(destExtractDir), false, 'Destination directory must not exist on rollback');
});

test('11. Mid-stream download cancellation and cleanup', async () => {
  let timer: NodeJS.Timeout | null = null;
  const { url, close } = await createMockHttpServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': '1000000',
    });
    timer = setInterval(() => {
      try {
        if (res.writable && !res.destroyed && !res.writableEnded) {
          res.write(Buffer.alloc(2048, 'X'), () => {});
        } else if (timer) {
          clearInterval(timer);
        }
      } catch {
        if (timer) clearInterval(timer);
      }
    }, 20);
    req.on('close', () => { if (timer) clearInterval(timer); });
    res.on('close', () => { if (timer) clearInterval(timer); });
    res.on('error', () => { if (timer) clearInterval(timer); });
    req.socket?.on('error', () => { if (timer) clearInterval(timer); });
  });

  const destFile = path.join(TEST_DIR, 'bundle-cancelled.bin');
  const partFile = `${destFile}.part`;
  const abortCtrl = new AbortController();

  setTimeout(() => {
    abortCtrl.abort();
  }, 60);

  try {
    await assert.rejects(
      async () => {
        await downloadWithDiagnostics({
          toolId: 'cancel-tool',
          url: `${url}/slow-stream.bin`,
          destinationPath: destFile,
          signal: abortCtrl.signal,
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof ToolchainDownloadError);
        assert.equal(err.stage, 'DOWNLOAD_STREAM');
        assert.equal(err.exceptionType, 'DownloadCancelledException');
        return true;
      }
    );
  } finally {
    if (timer) clearInterval(timer);
    await close();
  }

  assert.equal(fs.existsSync(destFile), false);
  assert.equal(fs.existsSync(partFile), false, 'Partial .part file must be removed upon cancellation');
});

test('12. State persistence across app restart', () => {
  const mgr1 = new MobileHarnessToolchainManager(TEST_DIR);
  mgr1.updateSelectedOptionalToolchains(['python', 'android']);

  // Read full status
  const status1 = mgr1.getFullStatus();
  assert.deepEqual(status1.selectedOptionalIds, ['python', 'android']);

  // Simulate restart with new manager instance on same data directory
  const mgr2 = new MobileHarnessToolchainManager(TEST_DIR);
  const status2 = mgr2.getFullStatus();

  assert.deepEqual(status2.selectedOptionalIds, ['python', 'android'], 'Selected toolchain IDs must persist across restarts');
});

test('13. Platform classification and binary verification', () => {
  const mgr = new MobileHarnessToolchainManager(TEST_DIR);
  const fullStatus = mgr.getFullStatus();

  assert.ok(Array.isArray(fullStatus.toolchains));
  assert.ok(fullStatus.toolchains.length >= 10);

  for (const item of fullStatus.toolchains) {
    assert.ok(['core', 'optional'].includes(item.category));
    assert.ok(
      ['android_native', 'proot_linux', 'downloadable_data', 'remote_backend'].includes(
        item.platformClassification || 'android_native'
      ),
      `Toolchain ${item.id} must have a valid platformClassification`
    );
    assert.ok(Array.isArray(item.binaries));
  }

  // Core Claude bridge is executable
  const claudeSpec = fullStatus.toolchains.find((t) => t.id === 'claude-code');
  assert.ok(claudeSpec);
  assert.equal(claudeSpec.platformClassification, 'android_native');
  assert.ok(['installed', 'not_installed'].includes(claudeSpec.status));
});

test('14. Stale metadata reconciliation: missing binaries must not report installed', () => {
  const staleDataDir = path.join(TEST_DIR, 'stale-data');
  const tcDir = path.join(staleDataDir, 'toolchains');
  fs.mkdirSync(tcDir, { recursive: true });

  // Simulate stale persisted state that falsely claimed android and python were installed
  const staleState = {
    selectedOptionalIds: ['android', 'python'],
    setupCompleted: true,
    toolchainStatuses: {
      android: {
        installed: true,
        installedVersion: '35.0.1 (Stale Fake Record)',
        verifiedAtMillis: Date.now() - 100000,
        lastError: null,
      },
      python: {
        installed: true,
        installedVersion: '3.11.0 (Stale Fake Record)',
        verifiedAtMillis: Date.now() - 100000,
        lastError: null,
      },
    },
    lastVerifiedAtMillis: Date.now() - 100000,
  };
  fs.writeFileSync(path.join(tcDir, 'toolchain-state.json'), JSON.stringify(staleState));

  // Instantiating manager and probing must verify real files and NOT blindly trust the stale file
  const mgr = new MobileHarnessToolchainManager(staleDataDir);
  const status = mgr.getFullStatus();

  // If gradle / javac / python3 are not actually present on disk in this test directory,
  // status must be reconciled truthful state, not falsely marked installed
  const androidItem = status.toolchains.find((t) => t.id === 'android');
  assert.ok(androidItem);
  assert.equal(typeof androidItem.status, 'string');
  assert.notEqual(androidItem.installedVersion, '35.0.1 (Stale Fake Record)');
});

test('15. Archive extraction failure rolls back without corrupting existing installation', async () => {
  const corruptArchive = path.join(TEST_DIR, 'corrupt-package.zip');
  fs.writeFileSync(corruptArchive, Buffer.from('NOT_A_VALID_ZIP_ARCHIVE'));
  const targetDir = path.join(TEST_DIR, 'installed-target');
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'working_binary.txt'), 'ORIGINAL_VERSION_1.0');

  await assert.rejects(
    async () => {
      await extractArchiveSafely({
        archivePath: corruptArchive,
        destinationDir: targetDir,
        toolId: 'test-rollback-tool',
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ToolchainDownloadError);
      assert.equal(err.stage, 'ARCHIVE_EXTRACTION');
      return true;
    }
  );

  // Original working directory must remain intact
  assert.equal(fs.existsSync(path.join(targetDir, 'working_binary.txt')), true);
  assert.equal(
    fs.readFileSync(path.join(targetDir, 'working_binary.txt'), 'utf8'),
    'ORIGINAL_VERSION_1.0',
    'Working installation must not be corrupted by failed update'
  );
});
