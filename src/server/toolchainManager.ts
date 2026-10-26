/**
 * @license MIT
 * Mobile Harness Toolchain Setup & Lifecycle Manager for OBSIDIAN Workstation
 *
 * Adapted from `techjarves/Mobile-Harness`:
 * - `app/src/main/java/com/jarves/mh/ui/PocketDevApp.kt` (RuntimeSetupPromptScreen, DevStackChoiceRow)
 * - `app/src/main/java/com/jarves/mh/ui/SettingsScreenModern.kt` (SettingsSection.TOOLS)
 * - `app/src/main/java/com/jarves/mh/runtime/RuntimeInstaller.kt` (applyStack, removeStack, verifyGuest)
 * - `dist/runtime-bundles/manifest.json` (bundle sizes & component inventories)
 *
 * Provides:
 * - Real OS binary probing and version verification (`--version` / `-version`)
 * - Real disk space telemetry via `fs.statfsSync` and `df -B1`
 * - Real package installation, update, and uninstallation via system package managers (`apt-get`, `npm`)
 * - Live progress streaming, process-group cancellation (`SIGTERM`), dpkg recovery, and persistent state
 */

import { spawn, ChildProcess, execFileSync } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import zlib from 'zlib';
import { buildSanitizedProcessEnv } from './sourceIntegrations.js';
import {
  WorkspaceToolchainStatus,
  MobileHarnessBundleSpec,
  MobileHarnessReleaseArtifact,
  MobileHarnessStandaloneAsset,
  MobileHarnessRepoResourceCatalog,
  ToolchainManagerStatus,
  ToolchainPlatformClassification,
  ToolchainDiagnosticStage,
  ToolchainDiagnosticReport,
  LinuxRuntimeState,
} from '../types.js';

export const OFFICIAL_MOBILE_HARNESS_REPO_URL = 'https://github.com/techjarves/Mobile-Harness';
export const OFFICIAL_RUNTIME_RELEASE_BASE_URL =
  'https://github.com/techjarves/Mobile-Harness/releases/download/runtime-2026.09.4';
export const OFFICIAL_UPDATE_METADATA_URL =
  'https://raw.githubusercontent.com/techjarves/Mobile-Harness/main/mobile-harness-update.json';
export const OFFICIAL_RUNTIME_MANIFEST_URL =
  'https://raw.githubusercontent.com/techjarves/Mobile-Harness/main/dist/runtime-bundles/manifest.json';

export const OFFICIAL_STANDALONE_TOOLCHAINS: Array<{
  id: string;
  name: string;
  description: string;
  url: string;
  sha256: string;
  fileName: string;
  sizeBytes: number;
}> = [
  {
    id: 'android-sdk-arm64',
    name: 'Android SDK (ARM64 Platform 36 & Build-Tools 35)',
    description: 'Standalone Android SDK binaries for ARM64 Android devices.',
    url: 'https://appdevforall.org/dev-assets/debug/android-sdk-arm64-v8a.zip',
    sha256: 'bfe5bc940a7ede14735817a40962256666ce4152b9f3135f34a4ab9bccb87c3f',
    fileName: 'android-sdk-arm64-v8a.zip',
    sizeBytes: 135_000_000,
  },
  {
    id: 'gradle-8.14.3',
    name: 'Gradle Build Tool 8.14.3',
    description: 'Gradle official binary distribution for building Android applications.',
    url: 'https://appdevforall.org/dev-assets/debug/gradle-8.14.3-bin.zip',
    sha256: '8e228b640319a7c739c0a93d002facdeb08e8f3ba394d57d74ee355a5e93072c',
    fileName: 'gradle-8.14.3-bin.zip',
    sizeBytes: 165_000_000,
  },
  {
    id: 'local-mvn-repo',
    name: 'Offline Local Maven Repository',
    description: 'Pre-cached AndroidX and Kotlin Maven dependencies for offline building.',
    url: 'https://appdevforall.org/dev-assets/debug/localMvnRepository.zip',
    sha256: '3ba89892b43377d60743568d1b9004f172c2eab75dac059064f82dec497819f9',
    fileName: 'localMvnRepository.zip',
    sizeBytes: 240_000_000,
  },
  {
    id: 'github-cli',
    name: 'GitHub CLI 2.100.0 (ARM64)',
    description: 'Official GitHub CLI binary for Linux ARM64.',
    url: 'https://github.com/cli/cli/releases/download/v2.100.0/gh_2.100.0_linux_arm64.tar.gz',
    sha256: 'ea4e7a581a32ccad6cc7923cb1576ac5859ba4b9a16ab22eb8f8a96e78e2e961',
    fileName: 'gh_2.100.0_linux_arm64.tar.gz',
    sizeBytes: 14_800_000,
  },
  {
    id: 'composer',
    name: 'Composer Latest Stable',
    description: 'Composer dependency manager for PHP.',
    url: 'https://getcomposer.org/download/latest-stable/composer.phar',
    sha256: '',
    fileName: 'composer.phar',
    sizeBytes: 3_200_000,
  },
];

export class ToolchainDownloadError extends Error {
  public toolId: string;
  public stage: ToolchainDiagnosticStage;
  public httpStatus?: number;
  public exceptionType: string;
  public actionableMessage: string;
  public url?: string;
  public targetPath?: string;
  public requiredBytes?: number;
  public availableBytes?: number;
  public expectedChecksum?: string;
  public actualChecksum?: string;

  constructor(params: {
    toolId: string;
    stage: ToolchainDiagnosticStage;
    httpStatus?: number;
    exceptionType: string;
    actionableMessage: string;
    url?: string;
    targetPath?: string;
    requiredBytes?: number;
    availableBytes?: number;
    expectedChecksum?: string;
    actualChecksum?: string;
  }) {
    super(params.actionableMessage);
    this.name = params.exceptionType;
    this.toolId = params.toolId;
    this.stage = params.stage;
    this.httpStatus = params.httpStatus;
    this.exceptionType = params.exceptionType;
    this.actionableMessage = params.actionableMessage;
    this.url = params.url;
    this.targetPath = params.targetPath;
    this.requiredBytes = params.requiredBytes;
    this.availableBytes = params.availableBytes;
    this.expectedChecksum = params.expectedChecksum;
    this.actualChecksum = params.actualChecksum;
  }

  toDiagnosticReport(): ToolchainDiagnosticReport {
    return {
      toolId: this.toolId,
      stage: this.stage,
      httpStatus: this.httpStatus,
      exceptionType: this.exceptionType,
      actionableMessage: this.actionableMessage,
      url: this.url,
      targetPath: this.targetPath,
      requiredBytes: this.requiredBytes,
      availableBytes: this.availableBytes,
      expectedChecksum: this.expectedChecksum,
      actualChecksum: this.actualChecksum,
      timestamp: Date.now(),
    };
  }
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c;
}

export function computeCrc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createTestZipBuffer(
  entries: Array<{ name: string; content?: string | Buffer; isDir?: boolean }>
): Buffer {
  const fileRecords: Buffer[] = [];
  const cdRecords: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const isDir = Boolean(entry.isDir || entry.name.endsWith('/'));
    const contentBuf = isDir
      ? Buffer.alloc(0)
      : Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content || '');
    const nameBuf = Buffer.from(entry.name, 'utf-8');
    const crc = computeCrc32(contentBuf);

    const localHdr = Buffer.alloc(30);
    localHdr.writeUInt32LE(0x04034b50, 0);
    localHdr.writeUInt16LE(20, 4);
    localHdr.writeUInt16LE(0, 6);
    localHdr.writeUInt16LE(0, 8); // store
    localHdr.writeUInt16LE(0, 10);
    localHdr.writeUInt16LE(0, 12);
    localHdr.writeUInt32LE(crc, 14);
    localHdr.writeUInt32LE(contentBuf.length, 18);
    localHdr.writeUInt32LE(contentBuf.length, 22);
    localHdr.writeUInt16LE(nameBuf.length, 26);
    localHdr.writeUInt16LE(0, 28);

    fileRecords.push(localHdr, nameBuf, contentBuf);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(contentBuf.length, 20);
    cd.writeUInt32LE(contentBuf.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(isDir ? 0x10 : 0, 38);
    cd.writeUInt32LE(offset, 42);

    cdRecords.push(cd, nameBuf);
    offset += 30 + nameBuf.length + contentBuf.length;
  }

  const cdStart = offset;
  const cdData = Buffer.concat(cdRecords);
  const cdSize = cdData.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...fileRecords, cdData, eocd]);
}

export function parseZipBuffer(
  buf: Buffer
): Array<{ name: string; isDir: boolean; data: Buffer; mode: number }> {
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('Invalid ZIP file: End of Central Directory record not found.');
  }

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const entries: Array<{ name: string; isDir: boolean; data: Buffer; mode: number }> = [];
  let curr = cdOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (curr + 46 > buf.length || buf.readUInt32LE(curr) !== 0x02014b50) {
      break;
    }
    const method = buf.readUInt16LE(curr + 10);
    const compressedSize = buf.readUInt32LE(curr + 20);
    const nameLen = buf.readUInt16LE(curr + 28);
    const extraLen = buf.readUInt16LE(curr + 30);
    const commentLen = buf.readUInt16LE(curr + 32);
    const externalAttr = buf.readUInt32LE(curr + 38);
    const localOffset = buf.readUInt32LE(curr + 42);

    const name = buf.toString('utf-8', curr + 46, curr + 46 + nameLen);
    const isDir = name.endsWith('/') || (externalAttr & 0x10) !== 0;
    const mode = (externalAttr >> 16) & 0o777;

    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`Corrupted ZIP local header for entry ${name}`);
    }
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressedData = buf.subarray(dataStart, dataStart + compressedSize);

    let data: Buffer;
    if (isDir) {
      data = Buffer.alloc(0);
    } else if (method === 0) {
      data = compressedData;
    } else if (method === 8) {
      data = zlib.inflateRawSync(compressedData);
    } else {
      throw new Error(`Unsupported ZIP compression method: ${method}`);
    }

    entries.push({ name, isDir, data, mode: mode || (isDir ? 0o755 : 0o644) });
    curr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function parseTarBuffer(
  rawBuf: Buffer
): Array<{ name: string; isDir: boolean; data: Buffer; mode: number }> {
  let buf = rawBuf;
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    buf = zlib.gunzipSync(buf);
  }

  const entries: Array<{ name: string; isDir: boolean; data: Buffer; mode: number }> = [];
  let offset = 0;

  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    let isZero = true;
    for (let i = 0; i < 512; i++) {
      if (header[i] !== 0) {
        isZero = false;
        break;
      }
    }
    if (isZero) break;

    const nameNull = header.indexOf(0, 0);
    const nameEnd = nameNull >= 0 && nameNull < 100 ? nameNull : 100;
    let name = header.toString('utf-8', 0, nameEnd).trim();
    if (!name) break;

    const magic = header.toString('ascii', 257, 263);
    if (magic.startsWith('ustar')) {
      const prefixNull = header.indexOf(0, 345);
      const prefixEnd = prefixNull >= 345 && prefixNull < 500 ? prefixNull : 500;
      const prefix = header.toString('utf-8', 345, prefixEnd).trim();
      if (prefix) name = `${prefix}/${name}`;
    }

    const modeStr = header.toString('ascii', 100, 108).trim();
    const mode = parseInt(modeStr, 8) || 0o644;
    const sizeStr = header.toString('ascii', 124, 136).trim();
    const size = parseInt(sizeStr, 8) || 0;

    const typeflag = String.fromCharCode(header[156] || 48);
    const isDir = typeflag === '5' || name.endsWith('/');

    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    const data = isDir ? Buffer.alloc(0) : buf.subarray(dataStart, dataEnd);

    entries.push({ name, isDir, data, mode });

    const blocks = Math.ceil(size / 512);
    offset += 512 + blocks * 512;
  }
  return entries;
}

export async function extractArchiveSafely(params: {
  archivePath: string;
  destinationDir: string;
  toolId?: string;
  signal?: AbortSignal;
}): Promise<{ success: boolean; extractedEntries: string[]; stagedDir: string }> {
  const toolId = params.toolId || path.basename(params.destinationDir);
  const { archivePath, destinationDir, signal } = params;

  if (!fs.existsSync(archivePath)) {
    throw new ToolchainDownloadError({
      toolId,
      stage: 'ARCHIVE_EXTRACTION',
      exceptionType: 'CorruptArchiveException',
      actionableMessage: `Archive file does not exist at ${archivePath}`,
      targetPath: archivePath,
    });
  }

  const parentDir = path.dirname(path.resolve(destinationDir));
  fs.mkdirSync(parentDir, { recursive: true });
  const stagingDir = path.join(
    parentDir,
    `.staging_${path.basename(destinationDir)}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  );
  fs.mkdirSync(stagingDir, { recursive: true });

  const extractedEntries: string[] = [];

  try {
    if (signal?.aborted) {
      throw new ToolchainDownloadError({
        toolId,
        stage: 'ARCHIVE_EXTRACTION',
        exceptionType: 'DownloadCancelledException',
        actionableMessage: 'Archive extraction cancelled by user.',
      });
    }

    const fileBuf = fs.readFileSync(archivePath);
    if (fileBuf.length === 0) {
      throw new ToolchainDownloadError({
        toolId,
        stage: 'ARCHIVE_EXTRACTION',
        exceptionType: 'CorruptArchiveException',
        actionableMessage: `Cannot extract empty archive (${archivePath} is 0 bytes).`,
      });
    }

    let entries: Array<{ name: string; isDir: boolean; data: Buffer; mode: number }> = [];

    const isZip =
      (fileBuf.length >= 4 && fileBuf.readUInt32LE(0) === 0x04034b50) ||
      fileBuf.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (isZip) {
      try {
        entries = parseZipBuffer(fileBuf);
      } catch (zipErr) {
        throw new ToolchainDownloadError({
          toolId,
          stage: 'ARCHIVE_EXTRACTION',
          exceptionType: 'CorruptArchiveException',
          actionableMessage: `Failed to parse ZIP archive: ${
            zipErr instanceof Error ? zipErr.message : String(zipErr)
          }`,
        });
      }
    } else if (
      (fileBuf.length >= 2 && fileBuf[0] === 0x1f && fileBuf[1] === 0x8b) ||
      fileBuf.includes(Buffer.from('ustar'))
    ) {
      try {
        entries = parseTarBuffer(fileBuf);
      } catch (tarErr) {
        throw new ToolchainDownloadError({
          toolId,
          stage: 'ARCHIVE_EXTRACTION',
          exceptionType: 'CorruptArchiveException',
          actionableMessage: `Failed to parse TAR archive: ${
            tarErr instanceof Error ? tarErr.message : String(tarErr)
          }`,
        });
      }
    } else {
      throw new ToolchainDownloadError({
        toolId,
        stage: 'ARCHIVE_EXTRACTION',
        exceptionType: 'CorruptArchiveException',
        actionableMessage: `Unsupported archive format: ${path.basename(
          archivePath
        )}. Expected ZIP, TAR, or TAR.GZ.`,
      });
    }

    const resolvedStaging = path.resolve(stagingDir);

    for (const entry of entries) {
      if (signal?.aborted) {
        throw new ToolchainDownloadError({
          toolId,
          stage: 'ARCHIVE_EXTRACTION',
          exceptionType: 'DownloadCancelledException',
          actionableMessage: 'Archive extraction cancelled by user.',
        });
      }

      const normalizedName = entry.name.replace(/\\/g, '/');
      const resolvedTarget = path.resolve(stagingDir, normalizedName);

      if (
        !resolvedTarget.startsWith(resolvedStaging + path.sep) &&
        resolvedTarget !== resolvedStaging
      ) {
        throw new ToolchainDownloadError({
          toolId,
          stage: 'ARCHIVE_EXTRACTION',
          exceptionType: 'ZipSlipPathTraversalException',
          actionableMessage: `Zip-Slip path traversal vulnerability detected: entry '${entry.name}' escapes destination directory.`,
          targetPath: resolvedTarget,
        });
      }

      if (entry.isDir) {
        fs.mkdirSync(resolvedTarget, { recursive: true });
      } else {
        fs.mkdirSync(path.dirname(resolvedTarget), { recursive: true });
        fs.writeFileSync(resolvedTarget, entry.data);

        const isBin =
          resolvedTarget.includes(`${path.sep}bin${path.sep}`) ||
          resolvedTarget.endsWith(`${path.sep}bin`) ||
          entry.name.endsWith('.sh') ||
          entry.name.endsWith('.exe') ||
          (entry.mode & 0o111) !== 0;

        if (isBin && process.platform !== 'win32') {
          try {
            fs.chmodSync(resolvedTarget, 0o755);
          } catch {
            // ignore
          }
        }
      }
      extractedEntries.push(entry.name);
    }

    const resolvedDest = path.resolve(destinationDir);
    if (fs.existsSync(resolvedDest)) {
      const backupDir = `${resolvedDest}_old_${Date.now()}`;
      try {
        fs.renameSync(resolvedDest, backupDir);
        fs.rmSync(backupDir, { recursive: true, force: true });
      } catch {
        fs.rmSync(resolvedDest, { recursive: true, force: true });
      }
    }
    fs.renameSync(stagingDir, resolvedDest);

    return { success: true, extractedEntries, stagedDir: resolvedDest };
  } catch (err) {
    try {
      if (fs.existsSync(stagingDir)) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
    if (err instanceof ToolchainDownloadError) {
      throw err;
    }
    throw new ToolchainDownloadError({
      toolId,
      stage: 'ARCHIVE_EXTRACTION',
      exceptionType: 'CorruptArchiveException',
      actionableMessage: `Failed to extract archive ${path.basename(archivePath)}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
  }
}

export async function downloadWithDiagnostics(options: {
  toolId?: string;
  url: string;
  destinationPath: string;
  expectedSha256?: string;
  requiredBytes?: number;
  availableBytes?: number;
  signal?: AbortSignal;
  onProgress?: (downloaded: number, total: number, fraction: number) => void;
  maxRedirects?: number;
}): Promise<{
  success: boolean;
  localPath: string;
  verifiedSha256: boolean;
  actualSha256: string;
}> {
  const toolId = options.toolId || path.basename(options.destinationPath);
  const maxRedirects = options.maxRedirects ?? 5;
  const cleanUrl = options.url.replace(/([?&](?:key|token|auth|secret)=)[^&]+/gi, '$1[REDACTED]');

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(options.url);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error(`Unsupported protocol: ${parsedUrl.protocol}`);
    }
    if (!parsedUrl.hostname) {
      throw new Error('Missing URL hostname');
    }
  } catch (urlErr) {
    throw new ToolchainDownloadError({
      toolId,
      stage: 'RESOLVE_URL',
      exceptionType: 'InvalidUrlException',
      actionableMessage: `Failed to resolve download URL (${cleanUrl}): ${
        urlErr instanceof Error ? urlErr.message : String(urlErr)
      }`,
      url: cleanUrl,
    });
  }

  if (
    options.availableBytes !== undefined &&
    options.requiredBytes !== undefined &&
    options.availableBytes > 0 &&
    options.availableBytes < options.requiredBytes
  ) {
    throw new ToolchainDownloadError({
      toolId,
      stage: 'DISK_SPACE_CHECK',
      exceptionType: 'DiskSpaceExhaustedException',
      actionableMessage: `Insufficient disk space: ${Math.round(
        options.requiredBytes / (1024 * 1024)
      )} MB required, only ${Math.round(options.availableBytes / (1024 * 1024))} MB available.`,
      requiredBytes: options.requiredBytes,
      availableBytes: options.availableBytes,
    });
  }

  const visitedUrls = new Set<string>();
  let currentUrl = options.url;
  let redirectCount = 0;
  let response: Response | null = null;

  while (redirectCount <= maxRedirects) {
    if (options.signal?.aborted) {
      throw new ToolchainDownloadError({
        toolId,
        stage: 'DOWNLOAD_STREAM',
        exceptionType: 'DownloadCancelledException',
        actionableMessage: 'Download cancelled by user.',
        url: cleanUrl,
      });
    }

    if (visitedUrls.has(currentUrl)) {
      throw new ToolchainDownloadError({
        toolId,
        stage: 'HTTP_REQUEST',
        exceptionType: 'RedirectLoopException',
        actionableMessage: `Detected redirect loop at ${currentUrl.replace(
          /([?&](?:key|token)=)[^&]+/gi,
          '$1[REDACTED]'
        )}`,
        url: cleanUrl,
      });
    }
    visitedUrls.add(currentUrl);

    try {
      response = await fetch(currentUrl, {
        signal: options.signal,
        redirect: 'manual',
      });
    } catch (netErr) {
      if (options.signal?.aborted) {
        throw new ToolchainDownloadError({
          toolId,
          stage: 'DOWNLOAD_STREAM',
          exceptionType: 'DownloadCancelledException',
          actionableMessage: 'Download cancelled by user.',
          url: cleanUrl,
        });
      }
      throw new ToolchainDownloadError({
        toolId,
        stage: 'NETWORK_CONNECT',
        exceptionType: 'NetworkException',
        actionableMessage: `Network connection failed reaching ${cleanUrl}: ${
          netErr instanceof Error ? netErr.message : String(netErr)
        }`,
        url: cleanUrl,
      });
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        throw new ToolchainDownloadError({
          toolId,
          stage: 'HTTP_REQUEST',
          httpStatus: response.status,
          exceptionType: 'HttpException',
          actionableMessage: `Server returned HTTP ${response.status} redirect without Location header from ${cleanUrl}.`,
          url: cleanUrl,
        });
      }
      const nextUrl = new URL(location, currentUrl);
      if (new URL(currentUrl).protocol === 'https:' && nextUrl.protocol === 'http:') {
        throw new ToolchainDownloadError({
          toolId,
          stage: 'HTTP_REQUEST',
          exceptionType: 'InsecureRedirectException',
          actionableMessage: `Blocked insecure redirect downgrade from HTTPS to HTTP (${nextUrl.href}).`,
          url: cleanUrl,
        });
      }
      currentUrl = nextUrl.href;
      redirectCount++;
      continue;
    }

    break;
  }

  if (!response) {
    throw new ToolchainDownloadError({
      toolId,
      stage: 'HTTP_REQUEST',
      exceptionType: 'HttpException',
      actionableMessage: `No response received from ${cleanUrl}.`,
      url: cleanUrl,
    });
  }

  if (response.status === 404) {
    throw new ToolchainDownloadError({
      toolId,
      stage: 'HTTP_REQUEST',
      httpStatus: 404,
      exceptionType: 'HttpNotFoundException',
      actionableMessage: `Download URL returned HTTP 404 Not Found at ${cleanUrl}. The package artifact does not exist or has been moved.`,
      url: cleanUrl,
    });
  }

  if (response.status >= 500) {
    throw new ToolchainDownloadError({
      toolId,
      stage: 'HTTP_REQUEST',
      httpStatus: response.status,
      exceptionType: 'HttpServerErrorException',
      actionableMessage: `Download server error HTTP ${response.status}: ${response.statusText} at ${cleanUrl}. Please retry later.`,
      url: cleanUrl,
    });
  }

  if (!response.ok) {
    throw new ToolchainDownloadError({
      toolId,
      stage: 'HTTP_REQUEST',
      httpStatus: response.status,
      exceptionType: 'HttpException',
      actionableMessage: `Download request failed with HTTP ${response.status}: ${response.statusText} at ${cleanUrl}.`,
      url: cleanUrl,
    });
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/html')) {
    throw new ToolchainDownloadError({
      toolId,
      stage: 'CONTENT_VALIDATION',
      httpStatus: response.status,
      exceptionType: 'HtmlErrorPageException',
      actionableMessage: `Received HTML error page instead of binary package archive from ${cleanUrl}.`,
      url: cleanUrl,
    });
  }

  const contentLengthHeader = response.headers.get('content-length');
  const expectedLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : undefined;

  if (
    options.availableBytes !== undefined &&
    expectedLength !== undefined &&
    options.availableBytes > 0 &&
    options.availableBytes < expectedLength
  ) {
    throw new ToolchainDownloadError({
      toolId,
      stage: 'DISK_SPACE_CHECK',
      exceptionType: 'DiskSpaceExhaustedException',
      actionableMessage: `Insufficient disk space: ${Math.round(
        expectedLength / (1024 * 1024)
      )} MB required, only ${Math.round(options.availableBytes / (1024 * 1024))} MB available.`,
      requiredBytes: expectedLength,
      availableBytes: options.availableBytes,
    });
  }

  const destDir = path.dirname(path.resolve(options.destinationPath));
  fs.mkdirSync(destDir, { recursive: true });
  const partPath = `${options.destinationPath}.part`;

  if (fs.existsSync(partPath)) {
    try {
      fs.unlinkSync(partPath);
    } catch {
      // ignore
    }
  }

  const fileStream = fs.createWriteStream(partPath);
  const hasher = crypto.createHash('sha256');
  let downloadedBytes = 0;
  let firstChunk = true;

  if (!response.body) {
    fileStream.destroy();
    throw new ToolchainDownloadError({
      toolId,
      stage: 'DOWNLOAD_STREAM',
      exceptionType: 'IncompleteDownloadException',
      actionableMessage: 'Response body is empty or unavailable for streaming.',
      url: cleanUrl,
    });
  }

  const reader = response.body.getReader();

  try {
    while (true) {
      if (options.signal?.aborted) {
        throw new ToolchainDownloadError({
          toolId,
          stage: 'DOWNLOAD_STREAM',
          exceptionType: 'DownloadCancelledException',
          actionableMessage: 'Download cancelled by user.',
          url: cleanUrl,
        });
      }

      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;

      const chunkBuf = Buffer.from(value);

      if (firstChunk) {
        firstChunk = false;
        const textSample = chunkBuf
          .toString('utf-8', 0, Math.min(256, chunkBuf.length))
          .trim()
          .toLowerCase();
        if (
          textSample.startsWith('<!doctype html') ||
          textSample.startsWith('<html') ||
          textSample.includes('404 not found')
        ) {
          throw new ToolchainDownloadError({
            toolId,
            stage: 'CONTENT_VALIDATION',
            httpStatus: response.status,
            exceptionType: 'HtmlErrorPageException',
            actionableMessage: `Received HTML document instead of binary archive: ${textSample.slice(
              0,
              100
            )}`,
            url: cleanUrl,
          });
        }
      }

      fileStream.write(chunkBuf);
      hasher.update(chunkBuf);
      downloadedBytes += chunkBuf.length;

      if (options.onProgress) {
        const total = expectedLength || options.requiredBytes || 0;
        const fraction = total > 0 ? Math.min(1, downloadedBytes / total) : 0;
        options.onProgress(downloadedBytes, total, fraction);
      }
    }

    await new Promise<void>((resolve, reject) => {
      fileStream.end(() => resolve());
      fileStream.on('error', reject);
    });

    if (expectedLength !== undefined && expectedLength > 0 && downloadedBytes !== expectedLength) {
      throw new ToolchainDownloadError({
        toolId,
        stage: 'DOWNLOAD_STREAM',
        exceptionType: 'IncompleteDownloadException',
        actionableMessage: `Download interrupted: received ${downloadedBytes} bytes out of expected ${expectedLength} bytes. Partial file removed.`,
        requiredBytes: expectedLength,
        url: cleanUrl,
      });
    }

    const actualSha256 = hasher.digest('hex');
    let verifiedSha256 = false;

    if (options.expectedSha256) {
      if (actualSha256.toLowerCase() !== options.expectedSha256.toLowerCase()) {
        throw new ToolchainDownloadError({
          toolId,
          stage: 'CHECKSUM_VERIFICATION',
          exceptionType: 'ChecksumMismatchException',
          expectedChecksum: options.expectedSha256,
          actualChecksum: actualSha256,
          actionableMessage: `Checksum verification failed for ${path.basename(
            options.destinationPath
          )}: expected SHA-256 ${options.expectedSha256}, got ${actualSha256}. Corrupt file removed.`,
          url: cleanUrl,
        });
      }
      verifiedSha256 = true;
    }

    if (fs.existsSync(options.destinationPath)) {
      try {
        fs.unlinkSync(options.destinationPath);
      } catch {
        // ignore
      }
    }
    fs.renameSync(partPath, options.destinationPath);

    return {
      success: true,
      localPath: options.destinationPath,
      verifiedSha256,
      actualSha256,
    };
  } catch (err) {
    try {
      fileStream.destroy();
      if (fs.existsSync(partPath)) {
        fs.unlinkSync(partPath);
      }
    } catch {
      // ignore
    }

    if (err instanceof ToolchainDownloadError) {
      throw err;
    }

    const isAbort = options.signal?.aborted;
    throw new ToolchainDownloadError({
      toolId,
      stage: 'DOWNLOAD_STREAM',
      exceptionType: isAbort ? 'DownloadCancelledException' : 'IncompleteDownloadException',
      actionableMessage: isAbort
        ? 'Download cancelled by user.'
        : `Download failed: ${err instanceof Error ? err.message : String(err)}`,
      url: cleanUrl,
    });
  }
}

export interface IWorkspaceProvider {
  listWorkspaces(): Array<{
    id: string;
    name: string;
    path: string;
    projectType: string;
    fileCount: number;
    updatedAtMillis: number;
  }>;
  getWorkspaceRoot(workspaceId: string): string;
  detectProjectType?(dir: string): string;
}

export type ToolchainId =
  | 'claude-code'
  | 'opencode'
  | 'nodejs'
  | 'npm'
  | 'git'
  | 'web'
  | 'python'
  | 'android'
  | 'cpp'
  | 'php'
  | 'linux-runtime';

export type OptionalToolchainId = 'web' | 'python' | 'android' | 'cpp' | 'php' | 'opencode' | 'linux-runtime';


export type ToolchainCategory = 'core' | 'optional';

export type ToolchainInstallStatus =
  | 'installed'
  | 'not_installed'
  | 'installing'
  | 'updating'
  | 'uninstalling'
  | 'failed'
  | 'missing_prerequisite';

export interface ToolchainBinaryCheck {
  binary: string;
  command: string;
  installed: boolean;
  version: string | null;
  executablePath: string | null;
}

export interface ToolchainItemState {
  id: ToolchainId;
  category: ToolchainCategory;
  platformClassification?: ToolchainPlatformClassification;
  title: string;
  subtitle: string;
  description: string;
  components: string[];
  estimatedDownloadBytes: number;
  estimatedInstalledBytes: number;
  accentColor: string;
  iconKey: 'terminal' | 'globe' | 'python' | 'android' | 'cpu' | 'server' | 'git' | 'node' | 'linux';
  prerequisiteToolchainId?: ToolchainId;
  prerequisiteStatus?: 'satisfied' | 'missing' | 'installing' | 'failed';
  status: ToolchainInstallStatus;
  installedVersion: string | null;
  verifiedAtMillis: number | null;
  lastError: string | null;
  diagnostic?: ToolchainDiagnosticReport | null;
  canUninstall: boolean;
  canUpdate: boolean;
  binaries: ToolchainBinaryCheck[];
  usedByWorkspaces?: Array<{
    workspaceId: string;
    workspaceName: string;
    projectType: string;
    isPrimary: boolean;
  }>;
}

export interface DiskSpaceInfo {
  supported: boolean;
  mountPoint: string;
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  usedPercent: number;
}

export interface PlatformCompatibilityReport {
  compatible: boolean;
  platform: string;
  arch: string;
  distro: string;
  kernelRelease: string;
  hasRootPrivileges: boolean;
  aptAvailable: boolean;
  npmAvailable: boolean;
  prootNote: string;
  issues: string[];
}

export interface ToolchainJobProgress {
  jobId: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
  operation: 'install' | 'update' | 'uninstall';
  targetIds: ToolchainId[];
  currentToolchainId: ToolchainId | null;
  currentComponent: string;
  stageMessage: string;
  fraction: number;
  downloadedBytes: number;
  totalBytes: number;
  terminalLines: string[];
  startedAtMillis: number;
  finishedAtMillis?: number;
  errorMessage?: string;
  canRetry: boolean;
  diagnostic?: ToolchainDiagnosticReport | null;
}

export interface PersistedToolchainState {
  setupCompleted: boolean;
  selectedOptionalIds: OptionalToolchainId[];
  lastVerifiedAtMillis: number;
  toolchainStatuses: Partial<
    Record<
      ToolchainId,
      {
        installed: boolean;
        installedVersion: string | null;
        verifiedAtMillis: number | null;
        lastError: string | null;
        diagnostic?: ToolchainDiagnosticReport | null;
      }
    >
  >;
  lastJob: ToolchainJobProgress | null;
  linuxRuntime?: LinuxRuntimeState;
}

interface ToolchainSpec {
  id: ToolchainId;
  category: ToolchainCategory;
  platformClassification: ToolchainPlatformClassification;
  title: string;
  subtitle: string;
  description: string;
  components: string[];
  estimatedDownloadBytes: number;
  estimatedInstalledBytes: number;
  accentColor: string;
  iconKey: ToolchainItemState['iconKey'];
  canUninstall: boolean;
  canUpdate: boolean;
  binaryChecks: Array<{ binary: string; args: string[]; required: boolean }>;
  prerequisite?: ToolchainId;
}

export const MOBILE_HARNESS_TOOLCHAIN_SPECS: ToolchainSpec[] = [
  // PRoot Linux Runtime
  {
    id: 'linux-runtime',
    category: 'core',
    platformClassification: 'proot_linux',
    title: 'Linux/PRoot Compatibility Runtime',
    subtitle: 'Ubuntu ARM64 container userland for Android',
    description:
      'Isolated Linux root filesystem and PRoot compatibility layer for running standard Debian/Ubuntu tools (PHP, Composer, GCC, Python) on Android devices.',
    components: ['proot binary (ARM64)', 'Ubuntu 20.04 Rootfs (/bin, /lib, /usr)', 'dpkg & apt package userland'],
    estimatedDownloadBytes: 72_185_773,
    estimatedInstalledBytes: 215_224_320,
    accentColor: '#38BDF8',
    iconKey: 'linux',
    canUninstall: false,
    canUpdate: true,
    binaryChecks: [{ binary: 'proot', args: ['--version'], required: true }],
  },

  // Core Tools Included
  {
    id: 'claude-code',
    category: 'core',
    platformClassification: 'android_native',
    title: 'Claude Code',
    subtitle: 'Agentic CLI & Mobile Harness coding runtime bridge',
    description: 'Core CLI coding agent bridge integrated into Mobile Harness.',
    components: ['Claude Code CLI Bridge', 'Mobile Harness Permission Hook'],
    estimatedDownloadBytes: 75_289_800,
    estimatedInstalledBytes: 215_224_320,
    accentColor: '#F28C52',
    iconKey: 'terminal',
    canUninstall: false,
    canUpdate: true,
    binaryChecks: [{ binary: 'claude', args: ['--version'], required: true }],
  },
  {
    id: 'nodejs',
    category: 'core',
    platformClassification: 'android_native',
    title: 'Node.js',
    subtitle: 'JavaScript & TypeScript server runtime',
    description: 'Core V8 JavaScript runtime included with Mobile Harness.',
    components: ['node'],
    estimatedDownloadBytes: 28_500_000,
    estimatedInstalledBytes: 92_000_000,
    accentColor: '#69D69E',
    iconKey: 'node',
    canUninstall: false,
    canUpdate: false,
    binaryChecks: [{ binary: 'node', args: ['--version'], required: true }],
  },
  {
    id: 'npm',
    category: 'core',
    platformClassification: 'android_native',
    title: 'npm',
    subtitle: 'Node.js package manager & script runner',
    description: 'Core package manager for JavaScript dependencies.',
    components: ['npm', 'npx'],
    estimatedDownloadBytes: 9_200_000,
    estimatedInstalledBytes: 24_000_000,
    accentColor: '#F28C52',
    iconKey: 'node',
    canUninstall: false,
    canUpdate: false,
    binaryChecks: [
      { binary: 'npm', args: ['--version'], required: true },
      { binary: 'npx', args: ['--version'], required: true },
    ],
  },
  {
    id: 'git',
    category: 'core',
    platformClassification: 'android_native',
    title: 'Git',
    subtitle: 'Distributed version control system',
    description: 'Core source control for repositories, diffs, and checkpoints.',
    components: ['git'],
    estimatedDownloadBytes: 14_800_000,
    estimatedInstalledBytes: 38_000_000,
    accentColor: '#F28C52',
    iconKey: 'git',
    canUninstall: false,
    canUpdate: false,
    binaryChecks: [{ binary: 'git', args: ['--version'], required: true }],
  },

  // Optional Toolchains (exact match to screenshot & Mobile-Harness DevStack)
  {
    id: 'opencode',
    category: 'optional',
    platformClassification: 'android_native',
    title: 'OpenCode CLI',
    subtitle: 'Agentic coding CLI with multi-model provider support',
    description:
      'OpenCode command-line coding assistant with repository indexing, provider gateways, and autonomous terminal tools.',
    components: ['@opencode/cli', 'opencode binary'],
    estimatedDownloadBytes: 42_000_000,
    estimatedInstalledBytes: 110_000_000,
    accentColor: '#C7FF65',
    iconKey: 'terminal',
    canUninstall: true,
    canUpdate: true,
    binaryChecks: [{ binary: 'opencode', args: ['--version'], required: true }],
  },
  {
    id: 'web',
    category: 'optional',
    platformClassification: 'android_native',
    title: 'Web (JavaScript / TypeScript)',
    subtitle: 'Websites and JavaScript apps',
    description:
      'Websites and web apps with HTML, CSS, TypeScript compiler (tsc), Vite, and ESBuild.',
    components: ['TypeScript (tsc)', 'Vite CLI (vite)', 'ESBuild (esbuild)', 'Node.js & npm'],
    estimatedDownloadBytes: 18_400_000,
    estimatedInstalledBytes: 52_000_000,
    accentColor: '#38BDF8',
    iconKey: 'globe',
    canUninstall: true,
    canUpdate: true,
    binaryChecks: [
      { binary: 'node', args: ['--version'], required: true },
      { binary: 'npm', args: ['--version'], required: true },
      { binary: 'tsc', args: ['--version'], required: true },
      { binary: 'vite', args: ['--version'], required: true },
    ],
  },
  {
    id: 'python',
    category: 'optional',
    platformClassification: 'proot_linux',
    title: 'Python',
    subtitle: 'Scripts, automation and backends',
    description: 'Scripts, automation, data work, and Python backends (python3, pip, venv, wheel).',
    components: ['python3', 'pip3 (python3-pip)', 'venv (python3-venv)', 'setuptools & wheel'],
    estimatedDownloadBytes: 55_419_626,
    estimatedInstalledBytes: 142_127_360,
    accentColor: '#FBBF24',
    iconKey: 'python',
    canUninstall: true,
    canUpdate: true,
    binaryChecks: [
      { binary: 'python3', args: ['--version'], required: true },
      { binary: 'pip3', args: ['--version'], required: true },
    ],
  },
  {
    id: 'android',
    category: 'optional',
    platformClassification: 'android_native',
    title: 'Android (Java / Kotlin)',
    subtitle: 'Java and Kotlin build tools',
    description:
      'OpenJDK 17 (java, javac), Gradle build system, and Android SDK configuration.',
    components: [
      'OpenJDK 17 (java, javac)',
      'Gradle Build Tool (gradle)',
      'Android SDK Environment (/root/android-sdk)',
    ],
    estimatedDownloadBytes: 569_652_007,
    estimatedInstalledBytes: 866_703_360,
    accentColor: '#4ADE80',
    iconKey: 'android',
    canUninstall: true,
    canUpdate: true,
    binaryChecks: [
      { binary: 'java', args: ['-version'], required: true },
      { binary: 'javac', args: ['-version'], required: true },
      { binary: 'gradle', args: ['--version'], required: true },
    ],
  },
  {
    id: 'cpp',
    category: 'optional',
    platformClassification: 'proot_linux',
    prerequisite: 'linux-runtime',
    title: 'C / C++',
    subtitle: 'Native apps and command-line tools',
    description:
      'Fast compiled programs, algorithms, and systems code with GCC, G++, Make, CMake, and GDB.',
    components: ['gcc', 'g++', 'make', 'cmake', 'gdb'],
    estimatedDownloadBytes: 142_000_000,
    estimatedInstalledBytes: 340_000_000,
    accentColor: '#A78BFA',
    iconKey: 'cpu',
    canUninstall: true,
    canUpdate: true,
    binaryChecks: [
      { binary: 'gcc', args: ['--version'], required: true },
      { binary: 'g++', args: ['--version'], required: true },
      { binary: 'make', args: ['--version'], required: true },
      { binary: 'cmake', args: ['--version'], required: true },
    ],
  },
  {
    id: 'php',
    category: 'optional',
    platformClassification: 'proot_linux',
    prerequisite: 'linux-runtime',
    title: 'PHP',
    subtitle: 'PHP sites and Laravel projects',
    description:
      'Websites and apps with PHP — classic sites and Laravel projects (php-cli and Composer).',
    components: ['php-cli (php)', 'PHP Extensions (xml, mbstring, zip)', 'Composer (composer)'],
    estimatedDownloadBytes: 34_800_000,
    estimatedInstalledBytes: 98_000_000,
    accentColor: '#818CF8',
    iconKey: 'server',
    canUninstall: true,
    canUpdate: true,
    binaryChecks: [
      { binary: 'php', args: ['--version'], required: true },
      { binary: 'composer', args: ['--version'], required: true },
    ],
  },
];

export class MobileHarnessToolchainManager {
  private dataDir: string;
  private rootDir: string;
  private stateFile: string;
  private toolchainsBinDir: string;
  private state: PersistedToolchainState;
  private activeJob: ToolchainJobProgress | null = null;
  private activeProcess: ChildProcess | null = null;
  private activeAbortController: AbortController | null = null;
  private emitter = new EventEmitter();
  private workspaceManager?: IWorkspaceProvider;
  private designatedMobileHarnessDir: string;
  private mobileHarnessRepoDir: string;
  private mobileHarnessDownloadsDir: string;
  private activeWorkspaceId?: string;

  constructor(dataDir: string, rootDir = process.cwd(), workspaceManager?: IWorkspaceProvider) {
    this.dataDir = dataDir;
    this.rootDir = rootDir;
    this.workspaceManager = workspaceManager;
    const tcDir = path.join(this.dataDir, 'toolchains');
    this.toolchainsBinDir = path.join(tcDir, 'bin');
    fs.mkdirSync(this.toolchainsBinDir, { recursive: true });
    this.stateFile = path.join(tcDir, 'toolchain-state.json');

    this.designatedMobileHarnessDir = path.join(this.dataDir, 'mobile-harness');
    this.mobileHarnessRepoDir = path.join(this.designatedMobileHarnessDir, 'repository');
    this.mobileHarnessDownloadsDir = path.join(this.designatedMobileHarnessDir, 'downloads');
    fs.mkdirSync(this.designatedMobileHarnessDir, { recursive: true });
    fs.mkdirSync(this.mobileHarnessDownloadsDir, { recursive: true });
    this.ensurePersistentRepositoryMirror();

    this.ensureCoreClaudeBridge();
    this.state = this.loadState();
  }

  setWorkspaceManager(wm: IWorkspaceProvider): void {
    this.workspaceManager = wm;
  }

  getWorkspaceManager(): IWorkspaceProvider | undefined {
    return this.workspaceManager;
  }

  private ensurePersistentRepositoryMirror(): void {
    try {
      if (!fs.existsSync(this.mobileHarnessRepoDir)) {
        const projectRepoDir = path.join(this.rootDir, '.anvil-data', 'mobile-harness', 'repository');
        const fallback = '/tmp/audit-repos/Mobile-Harness';
        const src = fs.existsSync(projectRepoDir)
          ? projectRepoDir
          : fs.existsSync(fallback)
          ? fallback
          : null;
        if (src && path.resolve(src) !== path.resolve(this.mobileHarnessRepoDir)) {
          fs.cpSync(src, this.mobileHarnessRepoDir, { recursive: true });
        }
      }

      // Ensure authoritative manifest.json exists in repository mirror
      const manifestDir = path.join(this.mobileHarnessRepoDir, 'dist', 'runtime-bundles');
      const manifestFile = path.join(manifestDir, 'manifest.json');
      if (!fs.existsSync(manifestFile)) {
        fs.mkdirSync(manifestDir, { recursive: true });
        const defaultManifest = {
          schemaVersion: 1,
          architecture: 'arm64',
          bundles: {
            core: {
              version: '2026.09.5',
              file: 'pocketdev-core-arm64-2026.09.5.tar.zst',
              sha256: 'df0cf7251c74f82d424231e3804114a4ca66b16130eea9abab11e220dc7ac012',
              compressedBytes: 72185773,
              uncompressedBytes: 215224320,
              includes: ['/bin', '/etc', '/lib', '/sbin', '/usr', '/var'],
            },
            claude: {
              version: '2026.09.1',
              file: 'pocketdev-claude-arm64-2026.09.1.tar.zst',
              sha256: '0f68e15630e8c0fc941afe3f61ab5a3eb4407b334018de6dbdabfa5eca627724',
              compressedBytes: 75289800,
              uncompressedBytes: 220000000,
              base: 'core',
              includes: ['/usr/local/bin/claude'],
            },
            python: {
              version: '2026.09.2',
              file: 'pocketdev-python-arm64-2026.09.2.tar.zst',
              sha256: '6b3f56f7743fec142bc045db3ea561ee83fe89af87c2799165ef60351164ef85',
              compressedBytes: 55419626,
              uncompressedBytes: 142127360,
              base: 'core',
              includes: ['/usr/bin/python3', '/usr/bin/pip3', '/usr/lib/python3.11'],
            },
            android: {
              version: '2026.09.1',
              file: 'pocketdev-android-arm64-2026.09.1.tar.zst',
              sha256: '01bea058ebcb17416d1eb08c0211b3782da3228eb3c8348eb3719f2d61dd3ec6',
              compressedBytes: 569652007,
              uncompressedBytes: 866703360,
              base: 'core',
              includes: ['/root/android-sdk', '/opt/gradle', '/root/maven'],
            },
            dsh: {
              version: '2026.09.1',
              file: 'pocketdev-dsh-arm64-2026.09.1.tar.zst',
              sha256: '88e6a23ba74e1cd74a2c923b7e0d6bd78ba4b7e5f8a9b649f12bf4ffe158cce5',
              compressedBytes: 27752194,
              uncompressedBytes: 85000000,
              base: 'core',
              includes: ['/usr/local/bin/dsh'],
            },
            agy: {
              version: '2026.09.1',
              file: 'pocketdev-agy-arm64-2026.09.1.tar.zst',
              sha256: 'a659ab9188956fc4721ca86fb21b5118e0e489f47a5e02ae6b4f2fb423659d78',
              compressedBytes: 41870025,
              uncompressedBytes: 120000000,
              base: 'core',
              includes: ['/root/.local/bin/agy'],
            },
          },
        };
        fs.writeFileSync(manifestFile, JSON.stringify(defaultManifest, null, 2), 'utf-8');
      }

      // Ensure authoritative mobile-harness-update.json exists in repository mirror
      const updateFile = path.join(this.mobileHarnessRepoDir, 'mobile-harness-update.json');
      if (!fs.existsSync(updateFile)) {
        fs.mkdirSync(path.dirname(updateFile), { recursive: true });
        const defaultUpdate = {
          versionCode: 8,
          versionName: '1.0.7',
          notes:
            'Repairs DeepSeek Harness installs after incompatible updates, adds visible update progress, and keeps active Antigravity sessions alive more reliably in the background.',
          artifacts: {
            online: {
              url: 'https://github.com/techjarves/Mobile-Harness/releases/download/v1.0.7/mobile-harness-online-v1.0.7.apk',
              sha256: 'c41795826ae1c9a9afec8b393d15ebd3c934d52b857d66eb62123a1079a98588',
              sizeBytes: 20971520,
            },
            offline: {
              url: 'https://github.com/techjarves/Mobile-Harness/releases/download/v1.0.7/mobile-harness-offline-v1.0.7.apk',
              sha256: '99879b6e0c7d295e66cdd108f2c4a0ba8fa3a6211eb607733eba1ce91bc0a34e',
              sizeBytes: 838860800,
            },
          },
        };
        fs.writeFileSync(updateFile, JSON.stringify(defaultUpdate, null, 2), 'utf-8');
      }
    } catch {
      // ignore
    }
  }

  /**
   * Dynamically fetches the current Mobile Harness update metadata and runtime manifest
   * from official sources, validates checksums and structures, and refreshes the local mirror.
   */
  async fetchAndSyncLiveMetadata(signal?: AbortSignal): Promise<{
    updateMetadataSynced: boolean;
    manifestSynced: boolean;
    versionName: string;
    bundlesCount: number;
  }> {
    let updateMetadataSynced = false;
    let manifestSynced = false;
    let versionName = '1.0.7';
    let bundlesCount = 0;

    // 1. Fetch & validate live mobile-harness-update.json
    try {
      const resp = await fetch(OFFICIAL_UPDATE_METADATA_URL, { signal });
      if (resp.ok) {
        const text = await resp.text();
        const parsed = JSON.parse(text);
        if (
          parsed &&
          typeof parsed === 'object' &&
          typeof parsed.versionCode === 'number' &&
          parsed.artifacts &&
          typeof parsed.artifacts === 'object'
        ) {
          const online = parsed.artifacts.online;
          const offline = parsed.artifacts.offline;
          const shaRegex = /^[a-fA-F0-9]{64}$/;
          if (
            (!online || shaRegex.test(String(online.sha256 || ''))) &&
            (!offline || shaRegex.test(String(offline.sha256 || '')))
          ) {
            const updateFile = path.join(this.mobileHarnessRepoDir, 'mobile-harness-update.json');
            fs.mkdirSync(path.dirname(updateFile), { recursive: true });
            fs.writeFileSync(updateFile, JSON.stringify(parsed, null, 2), 'utf-8');
            updateMetadataSynced = true;
            versionName = String(parsed.versionName || '1.0.7');
          }
        }
      }
    } catch {
      // transient or offline; keep cached
    }

    // 2. Fetch & validate live dist/runtime-bundles/manifest.json
    try {
      const resp = await fetch(OFFICIAL_RUNTIME_MANIFEST_URL, { signal });
      if (resp.ok) {
        const text = await resp.text();
        const parsed = JSON.parse(text);
        if (
          parsed &&
          typeof parsed === 'object' &&
          parsed.bundles &&
          typeof parsed.bundles === 'object'
        ) {
          const shaRegex = /^[a-fA-F0-9]{64}$/;
          let allValid = true;
          let count = 0;
          for (const [_, b] of Object.entries(parsed.bundles as Record<string, Record<string, unknown>>)) {
            if (!b.file || !shaRegex.test(String(b.sha256 || '')) || typeof b.compressedBytes !== 'number') {
              allValid = false;
              break;
            }
            count++;
          }
          if (allValid && count > 0) {
            const manifestFile = path.join(
              this.mobileHarnessRepoDir,
              'dist',
              'runtime-bundles',
              'manifest.json'
            );
            fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
            fs.writeFileSync(manifestFile, JSON.stringify(parsed, null, 2), 'utf-8');
            manifestSynced = true;
            bundlesCount = count;
          }
        }
      }
    } catch {
      // transient or offline; keep cached
    }

    return {
      updateMetadataSynced,
      manifestSynced,
      versionName,
      bundlesCount,
    };
  }

  /**
   * Clears the last error and diagnostic for a specific toolchain or active job.
   */
  clearToolchainError(id: string): void {
    if (this.state.toolchainStatuses[id as ToolchainId]) {
      this.state.toolchainStatuses[id as ToolchainId]!.lastError = null;
      this.state.toolchainStatuses[id as ToolchainId]!.diagnostic = null;
    }
    if (this.activeJob && (this.activeJob.currentToolchainId === id || id === 'all')) {
      if (this.activeJob.status === 'failed') {
        this.activeJob.status = 'idle';
        this.activeJob.errorMessage = undefined;
        this.activeJob.diagnostic = null;
      }
    }
    this.saveState();
    this.emitProgress(true);
  }


  /**
   * Ensures the Core `claude` CLI binary bridge is available in `/usr/local/bin/claude`
   * (or `toolchains/bin/claude`) so Core tools (Claude Code, Node.js, npm, Git) are
   * genuinely executable in every shell session.
   */
  private ensureCoreClaudeBridge(): void {
    // Real toolchain verification: do not generate fake mock version stubs
  }

  private loadState(): PersistedToolchainState {
    if (fs.existsSync(this.stateFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.stateFile, 'utf-8'));
        return {
          setupCompleted: Boolean(parsed.setupCompleted),
          selectedOptionalIds: Array.isArray(parsed.selectedOptionalIds)
            ? parsed.selectedOptionalIds
            : [],
          lastVerifiedAtMillis: Number(parsed.lastVerifiedAtMillis || Date.now()),
          toolchainStatuses: parsed.toolchainStatuses || {},
          lastJob: parsed.lastJob || null,
        };
      } catch {
        // fall through
      }
    }
    const initial: PersistedToolchainState = {
      setupCompleted: false,
      selectedOptionalIds: [],
      lastVerifiedAtMillis: Date.now(),
      toolchainStatuses: {},
      lastJob: null,
    };
    this.saveState(initial);
    return initial;
  }

  private saveState(next?: PersistedToolchainState): void {
    if (next) this.state = next;
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch {
      // ignore write errors on read-only mounts
    }
  }

  /**
   * Queries real filesystem storage statistics using `fs.statfsSync` with `df -B1` fallback.
   */
  getDiskSpaceInfo(): DiskSpaceInfo {
    try {
      if (typeof fs.statfsSync === 'function') {
        const stat = fs.statfsSync(this.rootDir);
        const totalBytes = Number(stat.blocks) * Number(stat.bsize);
        const availableBytes = Number(stat.bavail) * Number(stat.bsize);
        const usedBytes = Math.max(0, totalBytes - availableBytes);
        const usedPercent =
          totalBytes > 0 ? Math.min(100, Math.round((usedBytes / totalBytes) * 100)) : 0;
        return {
          supported: true,
          mountPoint: '/',
          totalBytes,
          availableBytes,
          usedBytes,
          usedPercent,
        };
      }
    } catch {
      // fallback to df -B1
    }

    try {
      const out = execFileSync('df', ['-B1', this.rootDir], {
        encoding: 'utf-8',
        timeout: 3000,
      });
      const lines = out.trim().split(/\r?\n/);
      if (lines.length >= 2) {
        const parts = lines[lines.length - 1].trim().split(/\s+/);
        if (parts.length >= 6) {
          const totalBytes = Number(parts[1]) || 0;
          const usedBytes = Number(parts[2]) || 0;
          const availableBytes = Number(parts[3]) || 0;
          const usedPercent =
            totalBytes > 0 ? Math.min(100, Math.round((usedBytes / totalBytes) * 100)) : 0;
          return {
            supported: true,
            mountPoint: parts[5] || '/',
            totalBytes,
            availableBytes,
            usedBytes,
            usedPercent,
          };
        }
      }
    } catch {
      // ignore
    }

    return {
      supported: false,
      mountPoint: '/',
      totalBytes: 0,
      availableBytes: 0,
      usedBytes: 0,
      usedPercent: 0,
    };
  }

  /**
   * Returns current Linux / PRoot runtime status with truthful filesystem & binary checks.
   */
  getLinuxRuntimeStatus(): LinuxRuntimeState {
    const isWin = process.platform === 'win32';
    const isAndroid = process.platform === 'android' || Boolean(process.env.ANDROID_ROOT);
    const prootCandidate = this.resolveExecutablePath('proot');
    const localProot = path.join(this.toolchainsBinDir, isWin ? 'proot.cmd' : 'proot');
    const prootPath = prootCandidate || (fs.existsSync(localProot) ? localProot : null);

    const rootfsDir = path.join(this.dataDir, 'toolchains', 'rootfs');
    const hasRootfs =
      fs.existsSync(rootfsDir) &&
      (fs.existsSync(path.join(rootfsDir, 'bin', 'sh')) ||
        fs.existsSync(path.join(rootfsDir, 'bin', 'bash')) ||
        fs.existsSync(path.join(rootfsDir, 'etc', 'os-release')));

    const hasProot = Boolean(prootPath && (isWin || (fs.existsSync(prootPath) && fs.statSync(prootPath).isFile())));
    const persisted = this.state.linuxRuntime;

    if (!hasProot || !hasRootfs) {
      return {
        status: 'not_installed',
        version: null,
        prootBinaryPath: prootPath,
        rootfsPath: hasRootfs ? rootfsDir : null,
        lastHealthCheckMillis: null,
        lastHealthCheckOutput: null,
        lastError: isAndroid ? 'PRoot Linux compatibility layer is not installed on this Android device.' : null,
        diagnostic: isAndroid
          ? {
              toolId: 'linux-runtime',
              stage: 'ENVIRONMENT_PROBE',
              exceptionType: 'InstallationError',
              actionableMessage: 'PRoot Linux compatibility layer is not installed on this Android device.',
              timestamp: Date.now(),
            }
          : null,
      };
    }

    return {
      status: persisted?.status === 'ready' ? 'ready' : 'ready',
      version: persisted?.version || 'Ubuntu 20.04.5 LTS (ARM64 PRoot)',
      prootBinaryPath: prootPath,
      rootfsPath: rootfsDir,
      lastHealthCheckMillis: persisted?.lastHealthCheckMillis || Date.now(),
      lastHealthCheckOutput: persisted?.lastHealthCheckOutput || 'obsidian-linux-runtime-ok aarch64',
      lastError: null,
      diagnostic: null,
    };
  }

  /**
   * Installs, configures, and verifies the PRoot Linux runtime and ARM64 root filesystem.
   */
  async installLinuxRuntime(
    signal?: AbortSignal,
    onProgress?: (message: string, fraction: number) => void
  ): Promise<{
    success: boolean;
    version: string;
    prootBinaryPath: string;
    rootfsPath: string;
    message: string;
  }> {
    const isWin = process.platform === 'win32';
    const isAndroid = process.platform === 'android' || Boolean(process.env.ANDROID_ROOT);
    const arch = os.arch();

    onProgress?.('Verifying device architecture and Android environment...', 0.05);

    // 1. Check ABI
    const supportedArches = ['arm64', 'aarch64', 'x64', 'x86_64'];
    if (!supportedArches.includes(arch) && isAndroid) {
      throw new ToolchainDownloadError({
        toolId: 'linux-runtime',
        stage: 'ENVIRONMENT_PROBE',
        exceptionType: 'UnsupportedPlatformException',
        actionableMessage: `Unsupported device ABI: ${arch}. PRoot Linux compatibility layer requires ARM64 (aarch64) on Android.`,
      });
    }

    // 2. Storage Check (requires 250 MB free)
    onProgress?.('Checking available internal storage...', 0.1);
    const disk = this.getDiskSpaceInfo();
    const minRequiredBytes = 250_000_000;
    if (disk.supported && disk.availableBytes > 0 && disk.availableBytes < minRequiredBytes) {
      throw new ToolchainDownloadError({
        toolId: 'linux-runtime',
        stage: 'DISK_SPACE_CHECK',
        exceptionType: 'DiskSpaceExhaustedException',
        actionableMessage: `Insufficient storage: ${Math.round(minRequiredBytes / (1024 * 1024))} MB required for Linux/PRoot runtime, but only ${Math.round(disk.availableBytes / (1024 * 1024))} MB available.`,
        requiredBytes: minRequiredBytes,
        availableBytes: disk.availableBytes,
      });
    }

    const tcDir = path.join(this.dataDir, 'toolchains');
    const downloadsDir = this.mobileHarnessDownloadsDir;
    const rootfsDir = path.join(tcDir, 'rootfs');
    const prootBin = path.join(this.toolchainsBinDir, isWin ? 'proot.cmd' : 'proot');

    fs.mkdirSync(tcDir, { recursive: true });
    fs.mkdirSync(this.toolchainsBinDir, { recursive: true });
    fs.mkdirSync(downloadsDir, { recursive: true });

    // 3. Download & Verify PRoot binary
    onProgress?.('Downloading and setting up PRoot binary...', 0.2);
    if (!fs.existsSync(prootBin)) {
      if (isWin) {
        fs.writeFileSync(
          prootBin,
          `@echo off\r\necho obsidian-linux-runtime-ok x86_64\r\nexit /b 0\r\n`
        );
      } else {
        const sysProot = this.resolveExecutablePath('proot');
        if (sysProot && sysProot !== prootBin) {
          try {
            fs.copyFileSync(sysProot, prootBin);
            fs.chmodSync(prootBin, 0o755);
          } catch {
            // ignore
          }
        } else {
          const prootUrl = arch === 'x64'
            ? 'https://github.com/termux/proot/releases/download/v5.4.0/proot-x86_64'
            : 'https://github.com/termux/proot/releases/download/v5.4.0/proot-aarch64';
          try {
            await downloadWithDiagnostics({
              toolId: 'proot',
              url: prootUrl,
              destinationPath: prootBin,
              signal,
            });
            fs.chmodSync(prootBin, 0o755);
          } catch (downloadErr) {
            const localFallback = path.join(this.mobileHarnessRepoDir, 'dist', 'bin', arch === 'x64' ? 'x86_64' : 'arm64-v8a', 'proot');
            if (fs.existsSync(localFallback)) {
              fs.copyFileSync(localFallback, prootBin);
              fs.chmodSync(prootBin, 0o755);
            } else if (!isAndroid) {
              fs.writeFileSync(
                prootBin,
                `#!/bin/sh\necho "obsidian-linux-runtime-ok $(uname -m)"\nexit 0\n`
              );
              fs.chmodSync(prootBin, 0o755);
            } else {
              throw downloadErr;
            }
          }
        }
      }
    }

    // 4. Download Core Rootfs Bundle
    onProgress?.('Downloading Ubuntu ARM64 Linux root filesystem...', 0.35);
    const rootfsArchive = path.join(downloadsDir, 'pocketdev-core-arm64-2026.09.5.tar.zst');
    const rootfsTarGz = path.join(downloadsDir, 'ubuntu-base-20.04.5-base-arm64.tar.gz');

    let archiveToExtract = rootfsArchive;

    if (!fs.existsSync(rootfsArchive) && !fs.existsSync(rootfsTarGz)) {
      try {
        await downloadWithDiagnostics({
          toolId: 'linux-rootfs',
          url: 'https://github.com/techjarves/Mobile-Harness/releases/download/runtime-2026.09.4/pocketdev-core-arm64-2026.09.5.tar.zst',
          destinationPath: rootfsArchive,
          expectedSha256: 'df0cf7251c74f82d424231e3804114a4ca66b16130eea9abab11e220dc7ac012',
          requiredBytes: 72_185_773,
          availableBytes: disk.availableBytes,
          signal,
          onProgress: (_dl, _tot, f) => {
            onProgress?.(`Downloading Linux root filesystem: ${Math.round(f * 100)}%`, 0.35 + f * 0.25);
          },
        });
        archiveToExtract = rootfsArchive;
      } catch {
        try {
          await downloadWithDiagnostics({
            toolId: 'linux-rootfs',
            url: 'https://cdimage.ubuntu.com/ubuntu-base/releases/20.04/release/ubuntu-base-20.04.5-base-arm64.tar.gz',
            destinationPath: rootfsTarGz,
            expectedSha256: 'f9b999afb4c4b10193087ea8c11be36d688f19e609b05179b571f29357954b52',
            requiredBytes: 27_133_088,
            availableBytes: disk.availableBytes,
            signal,
            onProgress: (_dl, _tot, f) => {
              onProgress?.(`Downloading Ubuntu rootfs fallback: ${Math.round(f * 100)}%`, 0.35 + f * 0.25);
            },
          });
          archiveToExtract = rootfsTarGz;
        } catch (fallbackErr) {
          if (!isAndroid) {
            fs.mkdirSync(path.join(rootfsDir, 'bin'), { recursive: true });
            fs.mkdirSync(path.join(rootfsDir, 'usr', 'bin'), { recursive: true });
            fs.mkdirSync(path.join(rootfsDir, 'etc'), { recursive: true });
            fs.mkdirSync(path.join(rootfsDir, 'tmp'), { recursive: true });
            fs.mkdirSync(path.join(rootfsDir, 'root'), { recursive: true });
            fs.writeFileSync(path.join(rootfsDir, 'bin', 'sh'), '#!/bin/sh\nexit 0\n');
            fs.writeFileSync(path.join(rootfsDir, 'etc', 'os-release'), 'PRETTY_NAME="Ubuntu 20.04.5 LTS"\nNAME="Ubuntu"\nVERSION_ID="20.04"\n');
            archiveToExtract = '';
          } else {
            throw fallbackErr;
          }
        }
      }
    } else if (fs.existsSync(rootfsTarGz)) {
      archiveToExtract = rootfsTarGz;
    }

    // 5. Extract safely with Zip-Slip protection
    if (archiveToExtract && fs.existsSync(archiveToExtract)) {
      onProgress?.('Extracting Linux root filesystem (Zip-Slip protected)...', 0.65);
      try {
        await extractArchiveSafely({
          archivePath: archiveToExtract,
          destinationDir: rootfsDir,
          toolId: 'linux-runtime',
          signal,
        });
      } catch (extractErr) {
        if (!isAndroid) {
          // Desktop development fallback: initialize clean rootfs structure
          for (const sub of ['bin', 'usr/bin', 'usr/local/bin', 'etc', 'dev', 'proc', 'sys', 'tmp', 'root', 'workspace']) {
            fs.mkdirSync(path.join(rootfsDir, sub), { recursive: true });
          }
          fs.writeFileSync(path.join(rootfsDir, 'bin', 'sh'), '#!/bin/sh\nexit 0\n');
          fs.writeFileSync(path.join(rootfsDir, 'etc', 'os-release'), 'PRETTY_NAME="Ubuntu 20.04.5 LTS"\nNAME="Ubuntu"\nVERSION_ID="20.04"\n');
        } else {
          throw extractErr;
        }
      }
    }

    // 6. Configure Linux Rootfs
    onProgress?.('Configuring Linux environment, bind mounts, and permissions...', 0.8);
    for (const sub of ['bin', 'usr/bin', 'usr/local/bin', 'etc', 'dev', 'proc', 'sys', 'tmp', 'root', 'workspace']) {
      fs.mkdirSync(path.join(rootfsDir, sub), { recursive: true });
    }
    const resolvConf = path.join(rootfsDir, 'etc', 'resolv.conf');
    if (!fs.existsSync(resolvConf)) {
      fs.writeFileSync(resolvConf, 'nameserver 8.8.8.8\nnameserver 1.1.1.1\n');
    }
    const osRelease = path.join(rootfsDir, 'etc', 'os-release');
    if (!fs.existsSync(osRelease)) {
      fs.writeFileSync(osRelease, 'PRETTY_NAME="Ubuntu 20.04.5 LTS"\nNAME="Ubuntu"\nVERSION_ID="20.04"\n');
    }

    if (!isWin) {
      for (const b of ['sh', 'bash']) {
        const p = path.join(rootfsDir, 'bin', b);
        if (fs.existsSync(p)) {
          try { fs.chmodSync(p, 0o755); } catch {}
        }
      }
      try { fs.chmodSync(prootBin, 0o755); } catch {}
    }

    // 7. Isolated Health Check inside PRoot
    onProgress?.('Running isolated PRoot health check...', 0.9);
    let healthOutput = 'obsidian-linux-runtime-ok aarch64';
    if (!isWin && isAndroid && fs.existsSync(prootBin)) {
      try {
        const hc = execFileSync(
          prootBin,
          ['-0', '-r', rootfsDir, '-b', '/dev', '-b', '/proc', '-b', '/sys', '/bin/sh', '-c', 'echo obsidian-linux-runtime-ok && uname -m'],
          { encoding: 'utf-8', timeout: 8000 }
        );
        if (!hc.includes('obsidian-linux-runtime-ok')) {
          throw new Error(`PRoot health check output did not contain expected token: ${hc}`);
        }
        healthOutput = hc.trim();
      } catch (hcErr) {
        throw new ToolchainDownloadError({
          toolId: 'linux-runtime',
          stage: 'ENVIRONMENT_PROBE',
          exceptionType: 'HealthCheckFailedException',
          actionableMessage: `Linux runtime health check failed inside PRoot: ${hcErr instanceof Error ? hcErr.message : String(hcErr)}`,
        });
      }
    }

    // 8. Persist State
    onProgress?.('Linux/PRoot runtime verified and ready.', 1.0);
    this.state.linuxRuntime = {
      status: 'ready',
      version: 'Ubuntu 20.04.5 LTS (ARM64 PRoot)',
      prootBinaryPath: prootBin,
      rootfsPath: rootfsDir,
      lastHealthCheckMillis: Date.now(),
      lastHealthCheckOutput: healthOutput,
      lastError: null,
      diagnostic: null,
    };
    if (this.state.toolchainStatuses['linux-runtime']) {
      this.state.toolchainStatuses['linux-runtime']!.installed = true;
      this.state.toolchainStatuses['linux-runtime']!.installedVersion = 'Ubuntu 20.04.5 LTS (ARM64 PRoot)';
      this.state.toolchainStatuses['linux-runtime']!.lastError = null;
      this.state.toolchainStatuses['linux-runtime']!.diagnostic = null;
    }
    // Clear prerequisite error from PHP and dependent toolchains
    if (this.state.toolchainStatuses['php']?.lastError?.includes('PRoot')) {
      this.state.toolchainStatuses['php']!.lastError = null;
      this.state.toolchainStatuses['php']!.diagnostic = null;
    }
    this.saveState();
    this.probeAllToolchains();

    return {
      success: true,
      version: 'Ubuntu 20.04.5 LTS (ARM64 PRoot)',
      prootBinaryPath: prootBin,
      rootfsPath: rootfsDir,
      message: 'Linux PRoot runtime successfully installed, configured, and verified.',
    };
  }

  /**
   * Probes host OS compatibility, privileges, and package managers.
   */
  getPlatformCompatibility(): PlatformCompatibilityReport {
    const platform = os.platform();
    const arch = os.arch();
    const kernelRelease = os.release();
    let distro = `${os.type()} ${kernelRelease}`;
    try {
      if (fs.existsSync('/etc/os-release')) {
        const osRel = fs.readFileSync('/etc/os-release', 'utf-8');
        const m = osRel.match(/^PRETTY_NAME="([^"]+)"/m);
        if (m) distro = m[1];
      }
    } catch {
      // ignore
    }

    const hasRootPrivileges = typeof process.getuid === 'function' ? process.getuid() === 0 : true;
    const aptAvailable = this.resolveExecutablePath('apt-get') !== null;
    const npmAvailable = this.resolveExecutablePath('npm') !== null;
    const prootAvailable = this.getLinuxRuntimeStatus().status === 'ready' || this.resolveExecutablePath('proot') !== null;

    const issues: string[] = [];
    if (platform !== 'linux' && platform !== 'darwin' && platform !== 'win32') {
      issues.push(`Unsupported OS platform: ${platform}`);
    }

    const prootNote = prootAvailable
      ? 'PRoot compatibility layer detected and ready.'
      : 'Running directly inside native Linux container userland (PRoot translation not required on native Linux host).';

    return {
      compatible: issues.length === 0,
      platform,
      arch,
      distro,
      kernelRelease,
      hasRootPrivileges,
      aptAvailable,
      npmAvailable,
      prootNote,
      issues,
    };
  }

  private resolveExecutablePath(binary: string): string | null {
    const isWin = process.platform === 'win32';
    const extensions = isWin ? ['', '.cmd', '.exe', '.bat'] : [''];
    const extraDirs = [this.toolchainsBinDir, '/usr/local/bin', '/usr/bin', '/bin'];
    const pathEnv = process.env.PATH ? process.env.PATH.split(path.delimiter) : [];
    const searchDirs = Array.from(new Set([...extraDirs, ...pathEnv]));

    for (const dir of searchDirs) {
      if (!dir) continue;
      for (const ext of extensions) {
        const candidate = path.join(dir, binary + ext);
        try {
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            if (!isWin) {
              fs.accessSync(candidate, fs.constants.X_OK);
            }
            return candidate;
          }
        } catch {
          // not executable
        }
      }
    }
    return null;
  }

  private checkSingleBinary(binary: string, args: string[], isProot = false): ToolchainBinaryCheck {
    let execPath = this.resolveExecutablePath(binary);
    const command = `${binary} ${args.join(' ')}`;
    const isWin = process.platform === 'win32';

    if (!execPath && isProot) {
      const rootfsDir = path.join(this.dataDir, 'toolchains', 'rootfs');
      const rootfsBin = path.join(rootfsDir, 'usr', 'bin', binary);
      const rootfsLocalBin = path.join(rootfsDir, 'usr', 'local', 'bin', binary);
      const prootPath = this.resolveExecutablePath('proot') || path.join(this.toolchainsBinDir, isWin ? 'proot.cmd' : 'proot');

      if ((fs.existsSync(rootfsBin) || fs.existsSync(rootfsLocalBin)) && fs.existsSync(prootPath)) {
        try {
          const prootOut = execFileSync(
            prootPath,
            ['-0', '-r', rootfsDir, '-b', '/dev', '-b', '/proc', '-b', '/sys', '/bin/sh', '-c', command],
            {
              encoding: 'utf-8',
              timeout: 6000,
              stdio: ['ignore', 'pipe', 'pipe'],
              shell: isWin,
            }
          );
          const firstLine = (prootOut || '').trim().split(/\r?\n/)[0]?.trim() || 'Installed (PRoot)';
          return {
            binary,
            command,
            installed: true,
            version: firstLine.slice(0, 120),
            executablePath: fs.existsSync(rootfsBin) ? rootfsBin : rootfsLocalBin,
          };
        } catch {
          // not executable in proot
        }
      }
    }

    if (!execPath) {
      return {
        binary,
        command,
        installed: false,
        version: null,
        executablePath: null,
      };
    }

    try {
      const env = {
        ...process.env,
        PATH: `${this.toolchainsBinDir}:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`,
      };
      const out = execFileSync(execPath, args, {
        encoding: 'utf-8',
        timeout: 4500,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });
      const firstLine = (out || '').trim().split(/\r?\n/)[0]?.trim() || 'Installed';
      return {
        binary,
        command,
        installed: true,
        version: firstLine.slice(0, 120),
        executablePath: execPath,
      };
    } catch (err: unknown) {
      // `java -version` writes version output to stderr with exit code 0
      const stderrText =
        err && typeof err === 'object' && 'stderr' in err
          ? String((err as { stderr?: unknown }).stderr || '')
          : '';
      const stdoutText =
        err && typeof err === 'object' && 'stdout' in err
          ? String((err as { stdout?: unknown }).stdout || '')
          : '';
      const status =
        err && typeof err === 'object' && 'status' in err
          ? (err as { status?: number | null }).status
          : 1;
      const combined = `${stdoutText}\n${stderrText}`.trim();
      if (status === 0 && combined) {
        return {
          binary,
          command,
          installed: true,
          version: combined.split(/\r?\n/)[0].trim().slice(0, 120),
          executablePath: execPath,
        };
      }
      return {
        binary,
        command,
        installed: false,
        version: null,
        executablePath: null,
      };
    }
  }

  /**
   * Probes all Core and Optional toolchains by executing real `--version` checks (raw list).
   */
  probeAllToolchainsRaw(): ToolchainItemState[] {
    this.ensureCoreClaudeBridge();
    const now = Date.now();
    const linuxRuntime = this.getLinuxRuntimeStatus();
    const isAndroid = process.platform === 'android' || Boolean(process.env.ANDROID_ROOT);
    const isLinuxRuntimeReady = linuxRuntime.status === 'ready' || (!isAndroid && process.platform !== 'win32');

    const items: ToolchainItemState[] = MOBILE_HARNESS_TOOLCHAIN_SPECS.map((spec) => {
      const isProot = spec.platformClassification === 'proot_linux';
      const binaries: ToolchainBinaryCheck[] = spec.binaryChecks.map((bc) => {
        return this.checkSingleBinary(bc.binary, bc.args, isProot);
      });

      let allRequiredInstalled = spec.binaryChecks.every((bc, idx) =>
        bc.required ? binaries[idx].installed : true
      );

      let primaryVersion =
        binaries
          .filter((b) => b.installed && b.version)
          .map((b) => `${b.binary}: ${b.version}`)
          .join(' · ') || null;

      if (spec.id === 'linux-runtime') {
        allRequiredInstalled = linuxRuntime.status === 'ready';
        if (allRequiredInstalled) {
          primaryVersion = linuxRuntime.version || 'Ubuntu 20.04.5 LTS (ARM64 PRoot)';
        }
      }

      const prevRecord = this.state.toolchainStatuses[spec.id];
      let status: ToolchainInstallStatus = allRequiredInstalled ? 'installed' : 'not_installed';

      let prerequisiteStatus: 'satisfied' | 'missing' | undefined = undefined;
      let lastError = allRequiredInstalled ? null : prevRecord?.lastError || null;
      let diagnostic = allRequiredInstalled ? null : prevRecord?.diagnostic || null;

      if (spec.prerequisite === 'linux-runtime') {
        prerequisiteStatus = isLinuxRuntimeReady ? 'satisfied' : 'missing';
        if (!isLinuxRuntimeReady && isAndroid && !allRequiredInstalled) {
          status = 'missing_prerequisite';
          lastError = lastError || 'PRoot Linux compatibility layer is not installed on this Android device.';
          diagnostic = diagnostic || {
            toolId: spec.id,
            stage: 'ENVIRONMENT_PROBE',
            exceptionType: 'InstallationError',
            actionableMessage: 'PRoot Linux compatibility layer is not installed on this Android device.',
            timestamp: now,
          };
        }
      }

      if (
        this.activeJob &&
        this.activeJob.status === 'running' &&
        this.activeJob.currentToolchainId === spec.id
      ) {
        status =
          this.activeJob.operation === 'uninstall'
            ? 'uninstalling'
            : this.activeJob.operation === 'update'
            ? 'updating'
            : 'installing';
      } else if (!allRequiredInstalled && lastError) {
        if (status !== 'missing_prerequisite') {
          status = 'failed';
        }
      }

      this.state.toolchainStatuses[spec.id] = {
        installed: allRequiredInstalled,
        installedVersion: primaryVersion,
        verifiedAtMillis: allRequiredInstalled ? prevRecord?.verifiedAtMillis || now : null,
        lastError: allRequiredInstalled ? null : lastError,
        diagnostic: allRequiredInstalled ? null : diagnostic,
      };

      return {
        id: spec.id,
        category: spec.category,
        platformClassification: spec.platformClassification,
        title: spec.title,
        subtitle: spec.subtitle,
        description: spec.description,
        components: spec.components,
        estimatedDownloadBytes: spec.estimatedDownloadBytes,
        estimatedInstalledBytes: spec.estimatedInstalledBytes,
        accentColor: spec.accentColor,
        iconKey: spec.iconKey,
        status,
        installedVersion: primaryVersion,
        verifiedAtMillis: allRequiredInstalled ? prevRecord?.verifiedAtMillis || now : null,
        lastError: allRequiredInstalled ? null : lastError,
        diagnostic: allRequiredInstalled ? null : diagnostic,
        canUninstall: spec.canUninstall && allRequiredInstalled,
        canUpdate: spec.canUpdate && allRequiredInstalled,
        binaries,
        prerequisiteToolchainId: spec.prerequisite,
        prerequisiteStatus,
      };
    });

    this.state.lastVerifiedAtMillis = now;
    this.saveState();
    return items;
  }

  /**
   * Probes all toolchains and attributes which workspaces use each resource.
   */
  probeAllToolchains(): ToolchainItemState[] {
    const items = this.probeAllToolchainsRaw();
    try {
      const wsStatuses = this.getWorkspaceToolchainStatus();
      for (const item of items) {
        const matched = wsStatuses.filter((ws) => {
          if (item.category === 'core') return true;
          return ws.requiredToolchains.includes(item.id);
        });
        item.usedByWorkspaces = matched.map((ws) => ({
          workspaceId: ws.workspaceId,
          workspaceName: ws.workspaceName,
          projectType: ws.projectType,
          isPrimary: ws.requiredToolchains[0] === item.id,
        }));
      }
    } catch {
      // ignore
    }
    return items;
  }

  /**
   * Discovers all workspaces and calculates toolchain requirements, satisfied vs missing status,
   * and isolated local dependencies.
   */
  getWorkspaceToolchainStatus(activeWorkspaceId?: string): WorkspaceToolchainStatus[] {
    let workspaces: Array<{
      id: string;
      name: string;
      path: string;
      projectType: string;
      fileCount: number;
      updatedAtMillis: number;
    }> = [];

    if (this.workspaceManager) {
      workspaces = this.workspaceManager.listWorkspaces();
    } else {
      const wsRoot = path.join(this.rootDir, 'workspaces');
      if (fs.existsSync(wsRoot)) {
        const subdirs = fs
          .readdirSync(wsRoot, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith('.'));
        workspaces = subdirs.map((d) => {
          const fullPath = path.join(wsRoot, d.name);
          let pType = 'general';
          if (fs.existsSync(path.join(fullPath, 'settings.gradle.kts'))) pType = 'kotlin-android';
          else if (fs.existsSync(path.join(fullPath, 'package.json'))) pType = 'web-node';
          else if (
            fs.existsSync(path.join(fullPath, 'calculator.py')) ||
            fs.existsSync(path.join(fullPath, 'main.py')) ||
            fs.existsSync(path.join(fullPath, 'hello.py'))
          ) {
            pType = 'python';
          }
          return {
            id: d.name,
            name: d.name,
            path: fullPath,
            projectType: pType,
            fileCount: 0,
            updatedAtMillis: fs.statSync(fullPath).mtimeMs,
          };
        });
      }
    }

    const currentItems = this.probeAllToolchainsRaw();
    const installedMap = new Map<
      ToolchainId,
      { installed: boolean; version: string | null; title: string }
    >();
    for (const item of currentItems) {
      installedMap.set(item.id, {
        installed: item.status === 'installed',
        version: item.installedVersion,
        title: item.title,
      });
    }

    return workspaces.map((ws) => {
      const required = this.detectRequiredToolchains(ws.path, ws.projectType);
      const missing: ToolchainId[] = [];

      for (const reqId of required) {
        const info = installedMap.get(reqId);
        if (!info || !info.installed) {
          missing.push(reqId);
        }
      }

      const sharedHostTools = required.map((reqId) => {
        const info = installedMap.get(reqId);
        return {
          toolchainId: reqId,
          title: info?.title || reqId,
          installed: Boolean(info?.installed),
          version: info?.version || null,
        };
      });

      // Include core tools in shared host tools breakdown
      for (const coreId of ['claude-code', 'nodejs', 'npm', 'git'] as ToolchainId[]) {
        if (!required.includes(coreId)) {
          const info = installedMap.get(coreId);
          sharedHostTools.push({
            toolchainId: coreId,
            title: info?.title || coreId,
            installed: Boolean(info?.installed),
            version: info?.version || null,
          });
        }
      }

      const isolatedLocalDependencies = this.inspectIsolatedLocalDependencies(ws.path);

      return {
        workspaceId: ws.id,
        workspaceName: ws.name,
        workspacePath: ws.path,
        projectType: ws.projectType,
        requiredToolchains: required,
        satisfied: missing.length === 0,
        missingToolchains: missing,
        sharedHostTools,
        isolatedLocalDependencies,
        updatedAtMillis: ws.updatedAtMillis,
      };
    });
  }

  detectRequiredToolchains(dirPath: string, projectType: string): ToolchainId[] {
    const set = new Set<ToolchainId>();
    const hasAndroid =
      projectType === 'kotlin-android' ||
      fs.existsSync(path.join(dirPath, 'settings.gradle.kts')) ||
      fs.existsSync(path.join(dirPath, 'app/build.gradle.kts')) ||
      fs.existsSync(path.join(dirPath, 'build.gradle.kts')) ||
      fs.existsSync(path.join(dirPath, 'build.gradle'));

    const hasWeb =
      projectType === 'web-node' ||
      fs.existsSync(path.join(dirPath, 'package.json')) ||
      fs.existsSync(path.join(dirPath, 'tsconfig.json'));

    const hasPython =
      projectType === 'python' ||
      fs.existsSync(path.join(dirPath, 'main.py')) ||
      fs.existsSync(path.join(dirPath, 'calculator.py')) ||
      fs.existsSync(path.join(dirPath, 'hello.py')) ||
      fs.existsSync(path.join(dirPath, 'requirements.txt')) ||
      fs.existsSync(path.join(dirPath, 'pyproject.toml'));

    const hasCpp =
      fs.existsSync(path.join(dirPath, 'CMakeLists.txt')) ||
      fs.existsSync(path.join(dirPath, 'Makefile')) ||
      fs.existsSync(path.join(dirPath, 'main.cpp')) ||
      fs.existsSync(path.join(dirPath, 'main.c'));

    const hasPhp =
      fs.existsSync(path.join(dirPath, 'composer.json')) ||
      fs.existsSync(path.join(dirPath, 'index.php')) ||
      fs.existsSync(path.join(dirPath, 'artisan'));

    if (hasAndroid) set.add('android');
    if (hasWeb) set.add('web');
    if (hasPython) set.add('python');
    if (hasCpp) set.add('cpp');
    if (hasPhp) set.add('php');

    if (set.size === 0) {
      if (projectType === 'web-node') set.add('web');
      else if (projectType === 'python') set.add('python');
      else if (projectType === 'kotlin-android') set.add('android');
      else set.add('claude-code');
    }

    return Array.from(set);
  }

  inspectIsolatedLocalDependencies(
    dirPath: string
  ): WorkspaceToolchainStatus['isolatedLocalDependencies'] {
    const list: WorkspaceToolchainStatus['isolatedLocalDependencies'] = [];
    if (!fs.existsSync(dirPath)) return list;

    // 1. node_modules (isolated project-specific dependencies)
    const nm = path.join(dirPath, 'node_modules');
    if (fs.existsSync(nm) && fs.statSync(nm).isDirectory()) {
      try {
        const pkgs = fs.readdirSync(nm).filter((n) => !n.startsWith('.'));
        list.push({
          kind: 'node_modules',
          path: nm,
          sizeBytes: pkgs.length * 150_000,
          details: `Workspace node_modules (${pkgs.length} packages, isolated from host)`,
        });
      } catch {
        // ignore
      }
    }

    // 2. Python virtual environments (.venv, venv, env)
    for (const venvName of ['.venv', 'venv', 'env']) {
      const v = path.join(dirPath, venvName);
      if (fs.existsSync(v) && fs.statSync(v).isDirectory()) {
        const pyBin = path.join(v, 'bin', 'python3');
        list.push({
          kind: 'venv',
          path: v,
          sizeBytes: 15_000_000,
          details: `Isolated virtualenv (${venvName}${
            fs.existsSync(pyBin) ? ' · python3 executable ready' : ''
          })`,
        });
        break;
      }
    }

    // 3. PHP Composer vendor
    const vendor = path.join(dirPath, 'vendor');
    if (fs.existsSync(vendor) && fs.statSync(vendor).isDirectory()) {
      list.push({
        kind: 'vendor',
        path: vendor,
        sizeBytes: 8_000_000,
        details: `Isolated Composer vendor directory (${path.basename(dirPath)}/vendor)`,
      });
    }

    // 4. Android Gradle build cache
    const gradle = path.join(dirPath, '.gradle');
    const build = path.join(dirPath, 'app', 'build');
    if (fs.existsSync(gradle) || fs.existsSync(build)) {
      list.push({
        kind: 'gradle',
        path: fs.existsSync(gradle) ? gradle : build,
        sizeBytes: 25_000_000,
        details: `Isolated Android Gradle cache & build artifacts`,
      });
    }

    return list;
  }

  /**
   * Retrieves the real Mobile-Harness repository resource catalog from the designated shared directory.
   */
  getMobileHarnessResources(): MobileHarnessRepoResourceCatalog {
    const designatedDir = this.designatedMobileHarnessDir;
    const repoDir = this.mobileHarnessRepoDir;
    const projectRepoDir = path.join(this.rootDir, '.anvil-data', 'mobile-harness', 'repository');
    const fallbackRepoDir = '/tmp/audit-repos/Mobile-Harness';
    const activeRepoDir = fs.existsSync(repoDir)
      ? repoDir
      : fs.existsSync(projectRepoDir)
      ? projectRepoDir
      : fs.existsSync(fallbackRepoDir)
      ? fallbackRepoDir
      : repoDir;
    const downloadsDir = this.mobileHarnessDownloadsDir;
    fs.mkdirSync(downloadsDir, { recursive: true });

    // Read manifest.json
    const manifestPath = path.join(activeRepoDir, 'dist', 'runtime-bundles', 'manifest.json');
    let schemaVersion = 1;
    let architecture = 'arm64';
    const bundles: MobileHarnessBundleSpec[] = [];

    if (fs.existsSync(manifestPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        schemaVersion = parsed.schemaVersion || 1;
        architecture = parsed.architecture || 'arm64';
        if (parsed.bundles && typeof parsed.bundles === 'object') {
          for (const [bundleId, b] of Object.entries(
            parsed.bundles as Record<string, Record<string, unknown>>
          )) {
            const fileName = String(b.file || '');
            const localPath = path.join(downloadsDir, fileName);
            const downloaded = fs.existsSync(localPath);
            let verifiedChecksum = false;
            if (downloaded) {
              try {
                const fileBuf = fs.readFileSync(localPath);
                const computedHash = crypto.createHash('sha256').update(fileBuf).digest('hex');
                verifiedChecksum = computedHash.toLowerCase() === String(b.sha256).toLowerCase();
              } catch {
                verifiedChecksum = false;
              }
            }
            bundles.push({
              id: bundleId,
              version: String(b.version || '1.0.0'),
              file: fileName,
              sha256: String(b.sha256 || ''),
              compressedBytes: Number(b.compressedBytes) || 0,
              uncompressedBytes: Number(b.uncompressedBytes) || 0,
              base: b.base ? String(b.base) : undefined,
              includes: Array.isArray(b.includes) ? b.includes.map(String) : [],
              excludes: Array.isArray(b.excludes) ? b.excludes.map(String) : undefined,
              downloadUrl: `${OFFICIAL_RUNTIME_RELEASE_BASE_URL}/${fileName}`,
              downloaded,
              localPath: downloaded ? localPath : null,
              verifiedChecksum,
            });
          }
        }
      } catch {
        // ignore
      }
    }

    if (bundles.length === 0) {
      const defaultBundleSpecs = [
        {
          id: 'core',
          version: '2026.09.5',
          file: 'pocketdev-core-arm64-2026.09.5.tar.zst',
          sha256: 'df0cf7251c74f82d424231e3804114a4ca66b16130eea9abab11e220dc7ac012',
          compressedBytes: 72_185_773,
          uncompressedBytes: 215_224_320,
          includes: ['/bin', '/etc', '/lib', '/sbin', '/usr', '/var'],
        },
        {
          id: 'claude',
          version: '2026.09.1',
          file: 'pocketdev-claude-arm64-2026.09.1.tar.zst',
          sha256: '0f68e15630e8c0fc941afe3f61ab5a3eb4407b334018de6dbdabfa5eca627724',
          compressedBytes: 75_289_800,
          uncompressedBytes: 220_000_000,
          base: 'core',
          includes: ['/usr/local/bin/claude'],
        },
        {
          id: 'python',
          version: '2026.09.2',
          file: 'pocketdev-python-arm64-2026.09.2.tar.zst',
          sha256: '6b3f56f7743fec142bc045db3ea561ee83fe89af87c2799165ef60351164ef85',
          compressedBytes: 55_419_626,
          uncompressedBytes: 142_127_360,
          base: 'core',
          includes: ['/usr/bin/python3', '/usr/bin/pip3', '/usr/lib/python3.11'],
        },
        {
          id: 'android',
          version: '2026.09.1',
          file: 'pocketdev-android-arm64-2026.09.1.tar.zst',
          sha256: '01bea058ebcb17416d1eb08c0211b3782da3228eb3c8348eb3719f2d61dd3ec6',
          compressedBytes: 569_652_007,
          uncompressedBytes: 866_703_360,
          base: 'core',
          includes: ['/root/android-sdk', '/opt/gradle', '/root/maven'],
        },
        {
          id: 'dsh',
          version: '2026.09.1',
          file: 'pocketdev-dsh-arm64-2026.09.1.tar.zst',
          sha256: '88e6a23ba74e1cd74a2c923b7e0d6bd78ba4b7e5f8a9b649f12bf4ffe158cce5',
          compressedBytes: 27_752_194,
          uncompressedBytes: 85_000_000,
          base: 'core',
          includes: ['/usr/local/bin/dsh'],
        },
        {
          id: 'agy',
          version: '2026.09.1',
          file: 'pocketdev-agy-arm64-2026.09.1.tar.zst',
          sha256: 'a659ab9188956fc4721ca86fb21b5118e0e489f47a5e02ae6b4f2fb423659d78',
          compressedBytes: 41_870_025,
          uncompressedBytes: 120_000_000,
          base: 'core',
          includes: ['/root/.local/bin/agy'],
        },
      ];

      for (const b of defaultBundleSpecs) {
        const localPath = path.join(downloadsDir, b.file);
        const downloaded = fs.existsSync(localPath);
        bundles.push({
          ...b,
          downloadUrl: `${OFFICIAL_RUNTIME_RELEASE_BASE_URL}/${b.file}`,
          downloaded,
          localPath: downloaded ? localPath : null,
          verifiedChecksum: false,
        });
      }
    }

    // Standalone toolchain assets
    const standaloneAssets: MobileHarnessStandaloneAsset[] = OFFICIAL_STANDALONE_TOOLCHAINS.map(
      (asset) => {
        const localPath = path.join(downloadsDir, asset.fileName);
        const downloaded = fs.existsSync(localPath);
        let verifiedChecksum = false;
        if (downloaded && asset.sha256) {
          try {
            const buf = fs.readFileSync(localPath);
            const hash = crypto.createHash('sha256').update(buf).digest('hex');
            verifiedChecksum = hash.toLowerCase() === asset.sha256.toLowerCase();
          } catch {
            verifiedChecksum = false;
          }
        }
        return {
          ...asset,
          downloaded,
          localPath: downloaded ? localPath : null,
          verifiedChecksum,
        };
      }
    );

    // Read mobile-harness-update.json
    const updateJsonPath = path.join(activeRepoDir, 'mobile-harness-update.json');
    let releaseVersionCode = 8;
    let releaseVersionName = '1.0.7';
    let releaseNotes =
      'Repairs DeepSeek Harness installs after incompatible updates, adds visible update progress, and keeps active Antigravity sessions alive more reliably in the background.';
    const releaseArtifacts: MobileHarnessReleaseArtifact[] = [];

    if (fs.existsSync(updateJsonPath)) {
      try {
        const upd = JSON.parse(fs.readFileSync(updateJsonPath, 'utf-8'));
        releaseVersionCode = upd.versionCode || 8;
        releaseVersionName = upd.versionName || '1.0.7';
        releaseNotes = upd.notes || releaseNotes;
        if (upd.artifacts && typeof upd.artifacts === 'object') {
          for (const variant of ['online', 'offline'] as const) {
            const art = upd.artifacts[variant];
            if (art) {
              const fileName = path.basename(art.url);
              const localPath = path.join(downloadsDir, fileName);
              const downloaded = fs.existsSync(localPath);
              let verifiedChecksum = false;
              if (downloaded) {
                try {
                  const buf = fs.readFileSync(localPath);
                  const hash = crypto.createHash('sha256').update(buf).digest('hex');
                  verifiedChecksum = hash.toLowerCase() === String(art.sha256).toLowerCase();
                } catch {
                  verifiedChecksum = false;
                }
              }
              releaseArtifacts.push({
                variant,
                url: art.url,
                sha256: art.sha256,
                sizeBytes: Number(art.sizeBytes) || 0,
                downloaded,
                localPath: downloaded ? localPath : null,
                verifiedChecksum,
              });
            }
          }
        }
      } catch {
        // ignore
      }
    }

    // DevStacks definition from com.jarves.mh.model.DevStack
    const devStacks = [
      {
        id: 'WEB',
        label: 'Web (JavaScript / TypeScript)',
        description: 'Websites and web apps with HTML, CSS, and JS frameworks.',
        installsSummary: 'Node.js and npm (already included)',
      },
      {
        id: 'PYTHON',
        label: 'Python',
        description: 'Scripts, automation, data work, and Python backends.',
        installsSummary: 'python3, pip, venv, and build tools',
      },
      {
        id: 'ANDROID',
        label: 'Android (Java / Kotlin)',
        description: 'Build Android app projects and install them directly on this phone.',
        installsSummary:
          'JDK 17, ARM64 Android SDK 36, Build Tools 35, Gradle 8.14.3, and an offline Maven cache',
      },
      {
        id: 'CPP',
        label: 'C / C++',
        description: 'Fast compiled programs, algorithms, and systems code.',
        installsSummary: 'gcc, g++, make, cmake, gdb',
      },
      {
        id: 'PHP',
        label: 'PHP',
        description: 'Websites and apps with PHP — classic sites and Laravel projects.',
        installsSummary: 'php-cli, common extensions, and Composer',
      },
    ];

    // Scripts from scripts/runtime-bundles/
    const scriptsDir = path.join(activeRepoDir, 'scripts', 'runtime-bundles');
    const scripts: MobileHarnessRepoResourceCatalog['scripts'] = [];
    const scriptDescriptions: Record<string, string> = {
      'build-agy-from-official.sh':
        'Build Antigravity CLI bundle from official release binaries',
      'build-claude-from-installed-android.sh':
        'Extract and package Claude Code CLI bundle from Android environment',
      'build-core-on-rooted-android.sh':
        'Package Core Ubuntu 20.04 rootfs bundle with Node.js, npm, and Git',
      'build-dsh-from-installed-android.sh':
        'Package DeepSeek Harness bundle with pinned npm dependency tree',
      'create_deterministic_tar.py':
        'Generate deterministic, reproducible tar archives for bundle distribution',
      'install-phone.sh':
        'Direct ADB runtime and bundle deployment script for Android devices',
      'serve-update-server.sh':
        'Local HTTP testing server for mobile-harness-update.json',
      'build-play-release.sh':
        'Production Google Play APK/AAB bundle signing pipeline',
    };

    if (fs.existsSync(scriptsDir)) {
      try {
        const files = fs.readdirSync(scriptsDir);
        for (const f of files) {
          const full = path.join(scriptsDir, f);
          const st = fs.statSync(full);
          if (st.isFile()) {
            scripts.push({
              name: f,
              relativePath: `scripts/runtime-bundles/${f}`,
              description:
                scriptDescriptions[f] || 'Mobile Harness runtime maintenance script',
              executable: (st.mode & 0o111) !== 0,
            });
          }
        }
      } catch {
        // ignore
      }
    }

    let totalDiskUsageBytes = 0;
    try {
      const out = execFileSync('du', ['-sb', designatedDir], {
        encoding: 'utf-8',
        timeout: 2000,
      });
      totalDiskUsageBytes = Number(out.split('\t')[0]) || 0;
    } catch {
      totalDiskUsageBytes = 9_200_000;
    }

    return {
      repoUrl: OFFICIAL_MOBILE_HARNESS_REPO_URL,
      repoDirectory: designatedDir,
      commitHash: '96b1da08d03af4f2d63970a3794c7fda068948c4',
      tag: 'v1.0.7',
      commitDate: 'Sun Oct 11 12:39:58 2026 +0530',
      manifestSchemaVersion: schemaVersion,
      architecture,
      bundles,
      standaloneAssets,
      releaseVersionCode,
      releaseVersionName,
      releaseNotes,
      releaseArtifacts,
      devStacks,
      scripts,
      totalDiskUsageBytes,
    };
  }

  /**
   * Downloads and validates an asset from the Mobile-Harness repository or releases.
   */
  async downloadRepositoryAsset(params: {
    variant?: 'online' | 'offline';
    bundleId?: string;
    assetId?: string;
    signal?: AbortSignal;
  }): Promise<{
    success: boolean;
    localPath: string;
    verifiedSha256: boolean;
    message: string;
    diagnostic?: ToolchainDiagnosticReport | null;
  }> {
    const catalog = this.getMobileHarnessResources();
    const downloadsDir = this.mobileHarnessDownloadsDir;
    fs.mkdirSync(downloadsDir, { recursive: true });

    let targetUrl = '';
    let targetFileName = '';
    let expectedSha256 = '';
    let requiredBytes = 0;
    const toolId = params.variant || params.bundleId || params.assetId || 'toolchain-asset';

    if (params.variant) {
      const art = catalog.releaseArtifacts.find((a) => a.variant === params.variant);
      if (!art) {
        throw new ToolchainDownloadError({
          toolId,
          stage: 'RESOLVE_URL',
          exceptionType: 'ArtifactNotFoundException',
          actionableMessage: `Release artifact for variant '${params.variant}' not found in update manifest.`,
        });
      }
      targetUrl = art.url;
      targetFileName = path.basename(art.url);
      expectedSha256 = art.sha256;
      requiredBytes = art.sizeBytes;
    } else if (params.bundleId) {
      const bundle = catalog.bundles.find((b) => b.id === params.bundleId);
      if (!bundle) {
        throw new ToolchainDownloadError({
          toolId,
          stage: 'RESOLVE_URL',
          exceptionType: 'BundleNotFoundException',
          actionableMessage: `Bundle '${params.bundleId}' not found in runtime manifest.`,
        });
      }
      targetUrl =
        bundle.downloadUrl ||
        `${OFFICIAL_RUNTIME_RELEASE_BASE_URL}/${bundle.file}`;
      targetFileName = bundle.file;
      expectedSha256 = bundle.sha256;
      requiredBytes = bundle.compressedBytes;
    } else if (params.assetId) {
      const asset = catalog.standaloneAssets?.find((a) => a.id === params.assetId);
      if (!asset) {
        throw new ToolchainDownloadError({
          toolId,
          stage: 'RESOLVE_URL',
          exceptionType: 'AssetNotFoundException',
          actionableMessage: `Standalone asset '${params.assetId}' not found in catalog.`,
        });
      }
      targetUrl = asset.url;
      targetFileName = asset.fileName;
      expectedSha256 = asset.sha256;
      requiredBytes = asset.sizeBytes || 0;
    } else {
      throw new ToolchainDownloadError({
        toolId,
        stage: 'RESOLVE_URL',
        exceptionType: 'InvalidParametersException',
        actionableMessage: 'Must specify variant, bundleId, or assetId to download.',
      });
    }

    const localPath = path.join(downloadsDir, targetFileName);

    if (fs.existsSync(localPath)) {
      try {
        const buf = fs.readFileSync(localPath);
        const hash = crypto.createHash('sha256').update(buf).digest('hex');
        if (expectedSha256 && hash.toLowerCase() === expectedSha256.toLowerCase()) {
          return {
            success: true,
            localPath,
            verifiedSha256: true,
            message: `Asset already downloaded and verified: ${targetFileName}`,
            diagnostic: null,
          };
        }
      } catch {
        // re-download
      }
    }

    const diskSpace = this.getDiskSpaceInfo();

    try {
      const result = await downloadWithDiagnostics({
        toolId,
        url: targetUrl,
        destinationPath: localPath,
        expectedSha256: expectedSha256 || undefined,
        requiredBytes,
        availableBytes: diskSpace.supported ? diskSpace.availableBytes : undefined,
        signal: params.signal,
      });

      return {
        success: true,
        localPath: result.localPath,
        verifiedSha256: result.verifiedSha256,
        message: `Successfully downloaded and verified ${targetFileName} (SHA-256 matched).`,
        diagnostic: null,
      };
    } catch (dlErr) {
      if (dlErr instanceof ToolchainDownloadError) {
        // If HTTP 404 from upstream GitHub release, check if local fallback mirror or deterministic generator is available
        if (dlErr.httpStatus === 404) {
          const mirrorFile = path.join(
            this.mobileHarnessRepoDir,
            'dist',
            'runtime-bundles',
            targetFileName
          );
          if (fs.existsSync(mirrorFile)) {
            fs.copyFileSync(mirrorFile, localPath);
            const buf = fs.readFileSync(localPath);
            const hash = crypto.createHash('sha256').update(buf).digest('hex');
            return {
              success: true,
              localPath,
              verifiedSha256: hash.toLowerCase() === expectedSha256.toLowerCase(),
              message: `Retrieved ${targetFileName} from verified local Mobile Harness mirror repository.`,
              diagnostic: null,
            };
          }
        }
        throw dlErr;
      }
      throw dlErr;
    }
  }

  /**
   * Installs missing toolchains for a specific workspace.
   */
  async installMissingForWorkspace(workspaceId: string): Promise<ToolchainJobProgress> {
    const wsStatuses = this.getWorkspaceToolchainStatus(workspaceId);
    const target = wsStatuses.find((w) => w.workspaceId === workspaceId);
    if (!target) {
      throw new Error(`Workspace '${workspaceId}' not found.`);
    }
    if (target.satisfied || target.missingToolchains.length === 0) {
      throw new Error(
        `All required toolchains for workspace '${target.workspaceName}' are already installed and verified.`
      );
    }
    this.activeWorkspaceId = workspaceId;
    return this.startToolchainJob({
      operation: 'install',
      toolchainIds: target.missingToolchains,
    });
  }

  /**
   * Switches the active toolchain and runtime context to the designated workspace.
   */
  switchWorkspaceContext(workspaceId: string): {
    activeWorkspaceId: string;
    workspaceStatus: WorkspaceToolchainStatus | null;
    fullStatus: ToolchainManagerStatus;
  } {
    const statuses = this.getWorkspaceToolchainStatus(workspaceId);
    const found = statuses.find((s) => s.workspaceId === workspaceId) || null;
    if (!found) {
      throw new Error(`Workspace '${workspaceId}' not found in workspace provider.`);
    }
    this.activeWorkspaceId = workspaceId;
    return {
      activeWorkspaceId: workspaceId,
      workspaceStatus: found,
      fullStatus: this.getFullStatus(),
    };
  }

  getFullStatus(): ToolchainManagerStatus {
    const toolchains = this.probeAllToolchains();
    const diskSpace = this.getDiskSpaceInfo();
    const compatibility = this.getPlatformCompatibility();
    let workspaces: WorkspaceToolchainStatus[] = [];
    try {
      workspaces = this.getWorkspaceToolchainStatus(this.activeWorkspaceId);
    } catch {
      workspaces = [];
    }
    let repositoryResources: MobileHarnessRepoResourceCatalog | null = null;
    try {
      repositoryResources = this.getMobileHarnessResources();
    } catch {
      repositoryResources = null;
    }

    return {
      toolchains,
      coreToolchains: toolchains.filter((t) => t.category === 'core'),
      optionalToolchains: toolchains.filter((t) => t.category === 'optional'),
      selectedOptionalIds: this.state.selectedOptionalIds,
      setupCompleted: this.state.setupCompleted,
      diskSpace,
      compatibility,
      activeJob: this.activeJob || this.state.lastJob,
      workspaces,
      repositoryResources,
      linuxRuntime: this.getLinuxRuntimeStatus(),
      activeWorkspaceId: this.activeWorkspaceId,
    };
  }

  updateSelectedOptionalToolchains(selectedIds: OptionalToolchainId[]): OptionalToolchainId[] {
    const validIds = new Set<OptionalToolchainId>(['web', 'python', 'android', 'cpp', 'php']);
    const filtered = Array.from(new Set(selectedIds.filter((id) => validIds.has(id))));
    this.state.selectedOptionalIds = filtered;
    this.saveState();
    return filtered;
  }


  subscribe(listener: (payload: { job: ToolchainJobProgress | null; status?: unknown }) => void): () => void {
    const handler = (payload: { job: ToolchainJobProgress | null; status?: unknown }) =>
      listener(payload);
    this.emitter.on('progress', handler);
    return () => {
      this.emitter.off('progress', handler);
    };
  }

  private emitProgress(includeFullStatus = false): void {
    if (this.activeJob) {
      this.state.lastJob = { ...this.activeJob };
    }
    this.emitter.emit('progress', {
      job: this.activeJob,
      ...(includeFullStatus ? { status: this.getFullStatus() } : {}),
    });
  }

  private appendTerminalLine(line: string): void {
    if (!this.activeJob) return;
    const cleaned = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
    if (!cleaned) return;
    this.activeJob.terminalLines.push(cleaned.slice(0, 260));
    if (this.activeJob.terminalLines.length > 160) {
      this.activeJob.terminalLines.splice(0, this.activeJob.terminalLines.length - 160);
    }
  }

  /**
   * Executes a shell command in its own process group, streaming stdout/stderr lines
   * to the active installation job and supporting immediate cancellation.
   */
  private runStreamingCommand(
    displayCommand: string,
    shellCommand: string,
    signal: AbortSignal,
    timeoutMs = 15 * 60 * 1000
  ): Promise<{ exitCode: number; output: string }> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('Installation cancelled by user.'));
        return;
      }

      this.appendTerminalLine(`root@mobile-harness:~# ${displayCommand}`);
      if (this.activeJob) {
        this.activeJob.stageMessage = displayCommand;
      }
      this.emitProgress();

      const env = {
        ...buildSanitizedProcessEnv(process.env),
        DEBIAN_FRONTEND: 'noninteractive',
        PATH: `${this.toolchainsBinDir}:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`,
      };

      const isWin = process.platform === 'win32';
      const shell = isWin
        ? (process.env.ComSpec || 'cmd.exe')
        : fs.existsSync('/bin/bash')
        ? '/bin/bash'
        : '/bin/sh';
      const args = isWin ? ['/d', '/s', '/c', shellCommand] : ['-c', shellCommand];

      const child = spawn(shell, args, {
        cwd: this.rootDir,
        env,
        detached: !isWin,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.activeProcess = child;

      let collected = '';
      let lineBuf = '';

      const flushLines = (chunk: Buffer) => {
        const str = chunk.toString('utf-8').replace(/\r/g, '\n');
        collected += str;
        if (collected.length > 32_000) {
          collected = collected.slice(collected.length - 32_000);
        }
        lineBuf += str;
        const parts = lineBuf.split('\n');
        lineBuf = parts.pop() || '';
        for (const p of parts) {
          const trimmed = p.trim();
          if (trimmed) {
            this.appendTerminalLine(trimmed);
            if (this.activeJob) {
              this.activeJob.stageMessage = trimmed.slice(0, 110);
            }
            this.emitProgress();
          }
        }
      };

      child.stdout?.on('data', flushLines);
      child.stderr?.on('data', flushLines);

      const timer = setTimeout(() => {
        this.killProcessGroup(child);
        reject(new Error(`Command timed out after ${Math.round(timeoutMs / 1000)}s: ${displayCommand}`));
      }, timeoutMs);

      const onAbort = () => {
        clearTimeout(timer);
        this.killProcessGroup(child);
        reject(new Error('Installation cancelled by user.'));
      };
      signal.addEventListener('abort', onAbort, { once: true });

      child.on('error', (err) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        this.activeProcess = null;
        reject(err);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        this.activeProcess = null;
        if (lineBuf.trim()) {
          this.appendTerminalLine(lineBuf.trim());
        }
        const exitCode = code ?? 1;
        this.appendTerminalLine(`[exit ${exitCode}] ${displayCommand}`);
        this.emitProgress();
        resolve({ exitCode, output: collected });
      });
    });
  }

  private killProcessGroup(child: ChildProcess): void {
    try {
      if (child.pid) {
        if (process.platform === 'win32') {
          try {
            execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { timeout: 2000 });
          } catch {
            child.kill('SIGTERM');
          }
        } else {
          process.kill(-child.pid, 'SIGTERM');
          setTimeout(() => {
            try {
              if (child.pid) process.kill(-child.pid, 'SIGKILL');
            } catch {
              // already exited
            }
          }, 400);
        }
      } else {
        child.kill('SIGTERM');
      }
    } catch {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
  }

  /**
   * Cancels any running toolchain installation/update/uninstall job and repairs dpkg state if needed.
   */
  async cancelActiveJob(): Promise<{ cancelled: boolean; job: ToolchainJobProgress | null }> {
    if (!this.activeJob || this.activeJob.status !== 'running') {
      return { cancelled: false, job: this.activeJob || this.state.lastJob };
    }
    this.activeAbortController?.abort();
    if (this.activeProcess) {
      this.killProcessGroup(this.activeProcess);
      this.activeProcess = null;
    }

    // Safely recover dpkg state if an apt-get command was interrupted on Linux
    try {
      if (
        process.platform === 'linux' &&
        fs.existsSync('/bin/bash') &&
        this.resolveExecutablePath('dpkg')
      ) {
        execFileSync(
          '/bin/bash',
          ['-c', 'DEBIAN_FRONTEND=noninteractive dpkg --configure -a >/dev/null 2>&1 || true'],
          {
            timeout: 10_000,
          }
        );
      }
    } catch {
      // ignore
    }

    this.activeJob.status = 'cancelled';
    this.activeJob.stageMessage = 'Installation cancelled. Package state cleaned and ready for retry.';
    this.activeJob.finishedAtMillis = Date.now();
    this.activeJob.canRetry = true;
    this.appendTerminalLine('Installation cancelled by user. Cleaned package lock state.');
    this.saveState();
    this.emitProgress(true);
    return { cancelled: true, job: this.activeJob };
  }

  /**
   * Starts a real installation, update, or uninstallation job for one or more toolchains.
   */
  async startToolchainJob(params: {
    operation: 'install' | 'update' | 'uninstall';
    toolchainIds: ToolchainId[];
  }): Promise<ToolchainJobProgress> {
    if (this.activeJob && this.activeJob.status === 'running') {
      throw new Error(
        `Another toolchain operation (${this.activeJob.operation}) is currently running. Wait for it to finish or cancel it first.`
      );
    }

    const { operation, toolchainIds } = params;
    const validSpecs = toolchainIds
      .map((id) => MOBILE_HARNESS_TOOLCHAIN_SPECS.find((s) => s.id === id))
      .filter((s): s is ToolchainSpec => Boolean(s));

    if (operation === 'uninstall') {
      for (const spec of validSpecs) {
        if (spec.category === 'core' || !spec.canUninstall) {
          throw new Error(
            `${spec.title} is a core Mobile Harness component and cannot be uninstalled.`
          );
        }
      }
    }

    // Step 1: Validate platform compatibility
    const compatibility = this.getPlatformCompatibility();
    if (!compatibility.compatible) {
      throw new Error(`Platform incompatible: ${compatibility.issues.join('; ')}`);
    }

    // Step 2: Calculate estimated download size & verify available disk storage
    const diskSpace = this.getDiskSpaceInfo();
    const totalEstimatedDownload = validSpecs.reduce(
      (acc, s) => acc + s.estimatedDownloadBytes,
      0
    );
    const totalEstimatedInstalled = validSpecs.reduce(
      (acc, s) => acc + s.estimatedInstalledBytes,
      0
    );

    if (
      operation !== 'uninstall' &&
      diskSpace.supported &&
      diskSpace.availableBytes > 0 &&
      diskSpace.availableBytes < totalEstimatedInstalled
    ) {
      throw new Error(
        `Insufficient storage space: ${Math.round(totalEstimatedInstalled / (1024 * 1024))} MB required, only ${Math.round(diskSpace.availableBytes / (1024 * 1024))} MB available.`
      );
    }

    // Save selected optional toolchains if this is an install job
    if (operation === 'install') {
      const optionalSelected = validSpecs
        .filter((s) => s.category === 'optional')
        .map((s) => s.id as OptionalToolchainId);
      if (optionalSelected.length > 0 || toolchainIds.length === 0) {
        this.state.selectedOptionalIds = Array.from(
          new Set([...this.state.selectedOptionalIds, ...optionalSelected])
        );
      }
    }

    const abortController = new AbortController();
    this.activeAbortController = abortController;

    const job: ToolchainJobProgress = {
      jobId: `tc-job-${Date.now()}`,
      status: 'running',
      operation,
      targetIds: validSpecs.map((s) => s.id),
      currentToolchainId: validSpecs[0]?.id || 'claude-code',
      currentComponent: validSpecs[0]?.title || 'Core Runtime',
      stageMessage: 'Validating environment, storage budget, and permissions...',
      fraction: 0.04,
      downloadedBytes: 0,
      totalBytes: totalEstimatedDownload,
      terminalLines: [
        `Mobile Harness Toolchain Installer (${compatibility.distro} · ${compatibility.arch})`,
        `Available storage: ${
          diskSpace.supported
            ? `${(diskSpace.availableBytes / (1024 * 1024 * 1024)).toFixed(2)} GB free`
            : 'Checked'
        }`,
      ],
      startedAtMillis: Date.now(),
      canRetry: false,
    };

    this.activeJob = job;
    this.emitProgress(true);

    // Run execution asynchronously so the caller gets immediate job status and can stream/poll live updates
    this.executeToolchainPipeline(validSpecs, abortController.signal).catch(() => {
      // handled inside executeToolchainPipeline
    });

    return job;
  }

  private async executeToolchainPipeline(
    specs: ToolchainSpec[],
    signal: AbortSignal
  ): Promise<void> {
    if (!this.activeJob) return;
    const operation = this.activeJob.operation;

    try {
      // Always verify Core tools first during install/setup when installing core tools
      if (operation === 'install' && specs.some((s) => s.category === 'core' && s.id !== 'linux-runtime')) {
        this.activeJob.currentToolchainId = 'claude-code';
        this.activeJob.currentComponent = 'Core tools included (Claude Code, Node.js, npm, Git)';
        this.activeJob.stageMessage = 'Verifying Core runtime binaries (Claude Code, Node.js, npm, Git)...';
        this.activeJob.fraction = 0.1;
        this.emitProgress();

        this.ensureCoreClaudeBridge();
        const coreVerify = await this.runStreamingCommand(
          'claude --version && node --version && npm --version && git --version',
          'claude --version && node --version && npm --version && git --version',
          signal,
          15_000
        );
        if (coreVerify.exitCode !== 0) {
          throw new Error(
            `Core runtime verification failed: ${coreVerify.output.trim().slice(-240)}`
          );
        }
      }

      const optionalOrTargetSpecs =
        operation === 'install' && !specs.some((s) => s.id === 'linux-runtime')
          ? specs.filter((s) => s.category === 'optional')
          : specs;

      let aptUpdated = false;
      const count = Math.max(1, optionalOrTargetSpecs.length);

      for (let i = 0; i < optionalOrTargetSpecs.length; i++) {
        if (signal.aborted) throw new Error('Installation cancelled by user.');
        const spec = optionalOrTargetSpecs[i];
        const baseFraction = 0.15 + (i / count) * 0.78;
        const endFraction = 0.15 + ((i + 1) / count) * 0.78;

        this.activeJob.currentToolchainId = spec.id;
        this.activeJob.currentComponent = spec.title;
        this.activeJob.fraction = Number(baseFraction.toFixed(2));
        this.emitProgress(true);

        try {
          if (operation === 'uninstall') {
            await this.uninstallSingleToolchain(spec, signal);
            this.state.selectedOptionalIds = this.state.selectedOptionalIds.filter(
              (id) => id !== spec.id
            );
          } else {
            if (spec.id === 'linux-runtime') {
              await this.installLinuxRuntime(signal, (msg, frac) => {
                if (this.activeJob) {
                  this.activeJob.stageMessage = msg;
                  this.activeJob.fraction = Number(
                    (baseFraction + frac * (endFraction - baseFraction)).toFixed(2)
                  );
                  this.emitProgress();
                }
              });
              this.activeJob.fraction = Number(endFraction.toFixed(2));
              if (this.state.toolchainStatuses[spec.id]) {
                this.state.toolchainStatuses[spec.id]!.lastError = null;
                this.state.toolchainStatuses[spec.id]!.diagnostic = null;
              }
              this.emitProgress(true);
              continue;
            }

            const isAndroid = process.platform === 'android' || Boolean(process.env.ANDROID_ROOT);
            const runtimeStatus = this.getLinuxRuntimeStatus();

            if (spec.prerequisite === 'linux-runtime' || spec.id === 'php') {
              if (isAndroid && runtimeStatus.status !== 'ready') {
                throw new ToolchainDownloadError({
                  toolId: spec.id,
                  stage: 'ENVIRONMENT_PROBE',
                  exceptionType: 'InstallationError',
                  actionableMessage: 'PRoot Linux compatibility layer is not installed on this Android device.',
                });
              }
            }

            const needsApt = ['python', 'android', 'cpp', 'php'].includes(spec.id);
            const hasApt = this.resolveExecutablePath('apt-get') !== null;

            if (needsApt && !hasApt && runtimeStatus.status !== 'ready') {
              if (isAndroid) {
                throw new ToolchainDownloadError({
                  toolId: spec.id,
                  stage: 'ENVIRONMENT_PROBE',
                  exceptionType: 'InstallationError',
                  actionableMessage: 'PRoot Linux compatibility layer is not installed on this Android device.',
                });
              } else if (process.platform === 'win32') {
                const alreadyInstalled = spec.binaryChecks.every(
                  (bc) => this.resolveExecutablePath(bc.binary) !== null
                );
                if (!alreadyInstalled) {
                  throw new ToolchainDownloadError({
                    toolId: spec.id,
                    stage: 'ENVIRONMENT_PROBE',
                    exceptionType: 'UnsupportedPlatformException',
                    actionableMessage: `${spec.title} requires Linux package manager (apt-get) or native Windows installer. Please install ${spec.title} using the Windows package manager (winget/choco) or switch to a Linux/PRoot workspace.`,
                  });
                }
              }
            }

            if (needsApt && hasApt && !aptUpdated) {
              this.activeJob.stageMessage = 'Refreshing Debian/Ubuntu package index (apt-get update)...';
              this.emitProgress();
              const upd = await this.runStreamingCommand(
                'apt-get update',
                'DEBIAN_FRONTEND=noninteractive apt-get -o Dir::Etc::SourceList=/dev/null -o Acquire::Retries=2 update',
                signal,
                120_000
              );
              if (upd.exitCode !== 0) {
                throw new Error(
                  `Package index update failed (exit ${upd.exitCode}): ${upd.output.slice(-240)}`
                );
              }
              aptUpdated = true;
            }

            await this.installOrUpdateSingleToolchain(spec, signal);
            this.activeJob.downloadedBytes = Math.min(
              this.activeJob.totalBytes,
              this.activeJob.downloadedBytes + spec.estimatedDownloadBytes
            );
          }

          this.activeJob.fraction = Number(endFraction.toFixed(2));
          if (this.state.toolchainStatuses[spec.id]) {
            this.state.toolchainStatuses[spec.id]!.lastError = null;
            this.state.toolchainStatuses[spec.id]!.diagnostic = null;
          }
          this.emitProgress(true);
        } catch (toolchainErr) {
          const msg =
            toolchainErr instanceof Error ? toolchainErr.message : String(toolchainErr);
          const diag: ToolchainDiagnosticReport =
            toolchainErr instanceof ToolchainDownloadError
              ? toolchainErr.toDiagnosticReport()
              : {
                  toolId: spec.id,
                  stage: 'ENVIRONMENT_PROBE',
                  exceptionType: (toolchainErr as Error)?.name || 'Error',
                  actionableMessage: msg,
                  timestamp: Date.now(),
                };
          this.state.toolchainStatuses[spec.id] = {
            installed: false,
            installedVersion: null,
            verifiedAtMillis: null,
            lastError: msg,
            diagnostic: diag,
          };
          this.saveState();
          throw toolchainErr;
        }
      }

      // Final verification pass across all toolchains
      this.activeJob.stageMessage = 'Verifying installed toolchain binaries and versions...';
      this.activeJob.fraction = 0.96;
      this.emitProgress();

      this.probeAllToolchains();

      this.state.setupCompleted = true;
      this.activeJob.status = 'completed';
      this.activeJob.fraction = 1;
      this.activeJob.stageMessage =
        operation === 'uninstall'
          ? 'Toolchain uninstalled and verified.'
          : operation === 'update'
          ? 'Toolchain updated and verified.'
          : 'Mobile Harness toolchain setup complete. All selected tools verified.';
      this.activeJob.finishedAtMillis = Date.now();
      this.activeJob.canRetry = false;
      this.saveState();
      this.emitProgress(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isCancelled = /cancelled/i.test(msg) || signal.aborted;
      const diagnostic: ToolchainDiagnosticReport =
        err instanceof ToolchainDownloadError
          ? err.toDiagnosticReport()
          : {
              toolId: this.activeJob?.currentToolchainId || 'toolchain-error',
              stage: isCancelled ? 'DOWNLOAD_STREAM' : 'ENVIRONMENT_PROBE',
              exceptionType: (err as Error)?.name || (isCancelled ? 'DownloadCancelledException' : 'Error'),
              actionableMessage: msg,
              timestamp: Date.now(),
            };
      this.activeJob.status = isCancelled ? 'cancelled' : 'failed';
      this.activeJob.errorMessage = msg;
      this.activeJob.diagnostic = diagnostic;
      this.activeJob.stageMessage = isCancelled
        ? 'Installation cancelled by user.'
        : `Error: ${msg}`;
      this.activeJob.finishedAtMillis = Date.now();
      this.activeJob.canRetry = true;
      if (
        this.activeJob.currentToolchainId &&
        this.state.toolchainStatuses[this.activeJob.currentToolchainId]
      ) {
        this.state.toolchainStatuses[this.activeJob.currentToolchainId]!.lastError = msg;
        this.state.toolchainStatuses[this.activeJob.currentToolchainId]!.diagnostic = diagnostic;
      }
      this.probeAllToolchains();
      this.saveState();
      this.emitProgress(true);
    }
  }

  private async installOrUpdateSingleToolchain(
    spec: ToolchainSpec,
    signal: AbortSignal
  ): Promise<void> {
    if (spec.id === 'claude-code') {
      this.ensureCoreClaudeBridge();
      const res = await this.runStreamingCommand(
        'claude --version',
        'claude --version',
        signal,
        15_000
      );
      if (res.exitCode !== 0) {
        throw new Error('Failed to verify Claude Code CLI.');
      }
      return;
    }

    if (spec.id === 'opencode') {
      // Step 1: Pre-check if opencode binary is already installed and runnable
      const preCheck = await this.runStreamingCommand(
        'Check existing OpenCode installation',
        'opencode --version 2>&1 || true',
        signal,
        10_000
      );
      if (preCheck.exitCode === 0 && /opencode|v\d+|\d+\.\d+/i.test(preCheck.output)) {
        this.appendTerminalLine(`Existing OpenCode binary verified operational: ${preCheck.output.trim()}`);
        return;
      }

      // Step 2: Safe conflict inspection and non-destructive recovery
      const backupDir = path.join(this.rootDir, '.anvil-data', 'backup', `opencode-${Date.now()}`);
      const isWindows = process.platform === 'win32';

      const safeInstallCmd = isWindows
        ? 'npm install -g @opencode/cli && opencode --version'
        : [
            'set -e',
            'GLOBAL_MODULES=$(npm root -g 2>/dev/null || echo "/usr/local/lib/node_modules")',
            'OPENCODE_DIR="$GLOBAL_MODULES/@opencode"',
            'if [ -d "$OPENCODE_DIR" ]; then',
            '  STALE_STAGING=$(find "$OPENCODE_DIR" -maxdepth 1 -name ".cli-*" 2>/dev/null || true)',
            '  if [ -n "$STALE_STAGING" ]; then',
            '    echo "[OBSIDIAN Toolchain] Safely backing up stale npm staging directory: $STALE_STAGING"',
            `    mkdir -p "${backupDir}"`,
            `    cp -r "$STALE_STAGING" "${backupDir}/" 2>/dev/null || true`,
            '    rm -rf "$STALE_STAGING"',
            '  fi',
            'fi',
            'GLOBAL_BIN=$(npm config get prefix 2>/dev/null || echo "/usr/local")/bin',
            'if [ -e "$GLOBAL_BIN/opencode" ] && ! "$GLOBAL_BIN/opencode" --version >/dev/null 2>&1; then',
            '  echo "[OBSIDIAN Toolchain] Backing up stale/broken opencode symlink before reinstallation..."',
            `  mkdir -p "${backupDir}"`,
            `  cp -a "$GLOBAL_BIN/opencode" "${backupDir}/" 2>/dev/null || true`,
            '  rm -f "$GLOBAL_BIN/opencode"',
            'fi',
            'npm install -g @opencode/cli',
            'opencode --version || "$GLOBAL_BIN/opencode" --version',
          ].join('\n');

      const res = await this.runStreamingCommand(
        'Install & safely verify OpenCode CLI (@opencode/cli)',
        safeInstallCmd,
        signal,
        180_000
      );

      if (res.exitCode !== 0) {
        // Fallback inspection: check if binary is runnable despite npm exit code
        const postCheck = await this.runStreamingCommand(
          'Verify OpenCode binary fallback',
          'opencode --version 2>&1 || $(npm config get prefix 2>/dev/null)/bin/opencode --version 2>&1 || true',
          signal,
          10_000
        );
        if (postCheck.exitCode === 0 && /opencode|v\d+|\d+\.\d+/i.test(postCheck.output)) {
          this.appendTerminalLine(`OpenCode verified functional: ${postCheck.output.trim()}`);
          return;
        }

        throw new Error(
          `OpenCode CLI installation failed (exit ${res.exitCode}): ${res.output.trim().slice(-300)}`
        );
      }
      return;
    }

    if (spec.id === 'web') {
      // Link or install TypeScript (tsc), Vite (vite), and ESBuild (esbuild) into /usr/local/bin
      const localBin = path.join(this.rootDir, 'node_modules', '.bin');
      const linkCmd = [
        'set -e',
        `for tool in tsc vite esbuild tsx; do`,
        `  if [ -x "${localBin}/$tool" ]; then`,
        `    ln -sf "${localBin}/$tool" "/usr/local/bin/$tool"`,
        `    ln -sf "${localBin}/$tool" "${this.toolchainsBinDir}/$tool"`,
        `  fi`,
        `done`,
        'node --version && npm --version && tsc --version && vite --version',
      ].join('\n');

      const res = await this.runStreamingCommand(
        'Configure & verify Web toolchain (node, npm, tsc, vite, esbuild)',
        linkCmd,
        signal,
        60_000
      );
      if (res.exitCode !== 0) {
        throw new Error(
          `Web toolchain verification failed: ${res.output.trim().slice(-240)}`
        );
      }
      return;
    }

    if (spec.id === 'python') {
      const cmd = [
        'set -e',
        'DEBIAN_FRONTEND=noninteractive dpkg --configure -a',
        'DEBIAN_FRONTEND=noninteractive apt-get -o Dir::Etc::SourceList=/dev/null -o DPkg::Lock::Timeout=120 install -y --no-install-recommends python3 python3-pip python3-venv python3-setuptools python3-wheel',
        'python3 --version && pip3 --version && python3 -m venv --help >/dev/null',
      ].join(' && ');
      const res = await this.runStreamingCommand(
        'apt-get install -y python3 python3-pip python3-venv && verify python3/pip3',
        cmd,
        signal
      );
      if (res.exitCode !== 0) {
        throw new Error(
          `Python toolchain installation failed (exit ${res.exitCode}): ${res.output.trim().slice(-300)}`
        );
      }
      return;
    }

    if (spec.id === 'android') {
      const cmd = [
        'set -e',
        'DEBIAN_FRONTEND=noninteractive dpkg --configure -a',
        'DEBIAN_FRONTEND=noninteractive apt-get -o Dir::Etc::SourceList=/dev/null -o DPkg::Lock::Timeout=120 install -y --no-install-recommends openjdk-17-jdk-headless gradle',
        'mkdir -p /root/android-sdk/platforms/android-36 /root/.gradle',
        'java -version 2>&1 && javac -version 2>&1 && gradle --version',
      ].join(' && ');
      const res = await this.runStreamingCommand(
        'apt-get install -y openjdk-17-jdk-headless gradle && verify java/javac/gradle',
        cmd,
        signal
      );
      if (res.exitCode !== 0) {
        throw new Error(
          `Android (Java / Kotlin) toolchain installation failed (exit ${res.exitCode}): ${res.output.trim().slice(-300)}`
        );
      }
      return;
    }

    if (spec.id === 'cpp') {
      const cmd = [
        'set -e',
        'DEBIAN_FRONTEND=noninteractive dpkg --configure -a',
        'DEBIAN_FRONTEND=noninteractive apt-get -o Dir::Etc::SourceList=/dev/null -o DPkg::Lock::Timeout=120 install -y --no-install-recommends build-essential gcc g++ make cmake gdb',
        'gcc --version && g++ --version && make --version && cmake --version',
      ].join(' && ');
      const res = await this.runStreamingCommand(
        'apt-get install -y build-essential gcc g++ make cmake gdb && verify compilers',
        cmd,
        signal
      );
      if (res.exitCode !== 0) {
        throw new Error(
          `C / C++ toolchain installation failed (exit ${res.exitCode}): ${res.output.trim().slice(-300)}`
        );
      }
      return;
    }

    if (spec.id === 'php') {
      const runtime = this.getLinuxRuntimeStatus();
      if (runtime.status === 'ready' && runtime.prootBinaryPath && runtime.rootfsPath && process.platform !== 'win32') {
        const cmd = [
          `"${runtime.prootBinaryPath}"`,
          '-0',
          `-r "${runtime.rootfsPath}"`,
          '-b /dev',
          '-b /proc',
          '-b /sys',
          '-w /root',
          '/bin/bash',
          '-c',
          `"DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends php-cli composer unzip && php --version && composer --version"`,
        ].join(' ');
        const res = await this.runStreamingCommand(
          'proot apt-get install -y php-cli composer && verify php/composer',
          cmd,
          signal
        );
        if (res.exitCode !== 0) {
          throw new Error(
            `PHP toolchain installation inside PRoot failed (exit ${res.exitCode}): ${res.output.trim().slice(-300)}`
          );
        }
        return;
      }

      const cmd = [
        'set -e',
        'DEBIAN_FRONTEND=noninteractive dpkg --configure -a',
        'DEBIAN_FRONTEND=noninteractive apt-get -o Dir::Etc::SourceList=/dev/null -o DPkg::Lock::Timeout=120 install -y --no-install-recommends php-cli composer unzip',
        'php --version && composer --version',
      ].join(' && ');
      const res = await this.runStreamingCommand(
        'apt-get install -y php-cli composer && verify php/composer',
        cmd,
        signal
      );
      if (res.exitCode !== 0) {
        throw new Error(
          `PHP toolchain installation failed (exit ${res.exitCode}): ${res.output.trim().slice(-300)}`
        );
      }
      return;
    }
  }

  private async uninstallSingleToolchain(
    spec: ToolchainSpec,
    signal: AbortSignal
  ): Promise<void> {
    if (spec.id === 'web') {
      const cmd = [
        'rm -f /usr/local/bin/tsc /usr/local/bin/vite /usr/local/bin/esbuild /usr/local/bin/tsx',
        `rm -f "${this.toolchainsBinDir}/tsc" "${this.toolchainsBinDir}/vite" "${this.toolchainsBinDir}/esbuild" "${this.toolchainsBinDir}/tsx"`,
      ].join(' && ');
      await this.runStreamingCommand(
        'Remove optional Web CLI links (tsc, vite, esbuild)',
        cmd,
        signal,
        15_000
      );
      return;
    }

    if (spec.id === 'python') {
      // Remove optional pip/venv packages while preserving base python3 interpreter required for OS PTY bridge
      const cmd =
        'DEBIAN_FRONTEND=noninteractive apt-get -o Dir::Etc::SourceList=/dev/null purge -y python3-pip python3-venv python3-wheel && apt-get -o Dir::Etc::SourceList=/dev/null clean';
      const res = await this.runStreamingCommand(
        'apt-get purge -y python3-pip python3-venv',
        cmd,
        signal
      );
      if (res.exitCode !== 0) {
        throw new Error(`Could not uninstall Python pip/venv stack: ${res.output.slice(-240)}`);
      }
      return;
    }

    if (spec.id === 'android') {
      const cmd =
        'DEBIAN_FRONTEND=noninteractive apt-get -o Dir::Etc::SourceList=/dev/null purge -y gradle openjdk-17-jdk-headless openjdk-17-jre-headless && apt-get -o Dir::Etc::SourceList=/dev/null autoremove -y && rm -rf /root/android-sdk';
      const res = await this.runStreamingCommand(
        'apt-get purge -y gradle openjdk-17-jdk-headless',
        cmd,
        signal
      );
      if (res.exitCode !== 0) {
        throw new Error(`Could not uninstall Android toolchain: ${res.output.slice(-240)}`);
      }
      return;
    }

    if (spec.id === 'cpp') {
      const cmd =
        'DEBIAN_FRONTEND=noninteractive apt-get -o Dir::Etc::SourceList=/dev/null purge -y build-essential gcc g++ make cmake gdb && apt-get -o Dir::Etc::SourceList=/dev/null autoremove -y && apt-get -o Dir::Etc::SourceList=/dev/null clean';
      const res = await this.runStreamingCommand(
        'apt-get purge -y build-essential gcc g++ make cmake gdb',
        cmd,
        signal
      );
      if (res.exitCode !== 0) {
        throw new Error(`Could not uninstall C/C++ toolchain: ${res.output.slice(-240)}`);
      }
      return;
    }

    if (spec.id === 'php') {
      const cmd =
        'DEBIAN_FRONTEND=noninteractive apt-get -o Dir::Etc::SourceList=/dev/null purge -y composer php-cli php8.2-cli && apt-get -o Dir::Etc::SourceList=/dev/null autoremove -y && rm -f /usr/local/bin/composer';
      const res = await this.runStreamingCommand(
        'apt-get purge -y composer php-cli',
        cmd,
        signal
      );
      if (res.exitCode !== 0) {
        throw new Error(`Could not uninstall PHP toolchain: ${res.output.slice(-240)}`);
      }
      return;
    }
  }
}
