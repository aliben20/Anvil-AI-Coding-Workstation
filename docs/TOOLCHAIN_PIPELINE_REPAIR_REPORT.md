# OBSIDIAN Workstation — Toolchain Download & Installation Pipeline Diagnosis & Repair Report

**Date:** October 25, 2026  
**Status:** FULLY REPAIRED & VERIFIED  
**Components:** Android Native (`android-workstation`), Backend Core (`src/server/toolchainManager.ts`), Bridge (`MainActivity.kt`, `AndroidWebBridge.kt`)  
**Test Suite:** `tests/toolchainDownloadPipeline.test.ts` (13/13 scenarios passing)

---

## 1. Executive Summary

A comprehensive end-to-end audit and repair of the toolchain download, validation, extraction, and lifecycle management pipeline was conducted across both the Android application (`android-workstation`) and the backend workstation service (`src/server/toolchainManager.ts`).

Prior to this fix, toolchain downloads initiated from the Android application failed before installation could complete due to several critical root causes:
1. In native Android mode, the web bridge (`AndroidWebBridge.kt`) was completely missing handlers for POST `/api/toolchains/resources/download`, POST `/api/toolchains/install`, POST `/api/toolchains/:id/install`, POST `/api/toolchains/cancel`, and POST `/api/toolchains/verify`, falling through to an empty no-op response.
2. The WebView `EventSource` bootstrap in `MainActivity.kt` only intercepted `/api/agent/events`, causing `/api/toolchains/stream` to fail.
3. The backend downloader used `await res.arrayBuffer()` to buffer entire multi-hundred-megabyte archives directly into memory, risking process OOM crashes.
4. Downloader targeted dead GitHub release URLs (`https://github.com/techjarves/Mobile-Harness/releases/download/v1.0.7/...`) returning HTTP 404, without URL resolution diagnostics or local mirror fallback.
5. Checksum verification used placeholder reverse-hex dummy strings rather than real SHA-256 digests.
6. The installation pipeline executed `/bin/bash -c "apt-get install..."`, which immediately crashes on native Android (Bionic libc without PRoot) and Windows.
7. Archive extraction lacked path traversal checks (Zip-Slip vulnerability) and atomic staging/rollback.

All seven issues have been resolved with native Android and backend implementations, accompanied by a 13-test automated suite covering all failure, recovery, and security scenarios.

---

## 2. Complete Pipeline Trace & Root Cause Analysis

### A. Android Native Web Bridge (`AndroidWebBridge.kt` & `MainActivity.kt`)
- **Inspection**: When running standalone on Android, all frontend `fetch()` calls are intercepted and routed through `AndroidWebBridge.requestSync`.
- **Failure Root Cause**:
  - `GET /api/toolchains` only returned hardcoded dummy entries (`android-sdk-35` and `openjdk-17`).
  - `GET /api/toolchains/resources` returned `{ "bundles": [] }`.
  - `POST /api/toolchains/resources/download`, `POST /api/toolchains/install`, `POST /api/toolchains/:id/install`, `POST /api/toolchains/cancel`, and `POST /api/toolchains/verify` hit `else -> JSONObject().put("ok", true).toString()`. No download or install task was ever initiated.
  - The WebView `BRIDGE_BOOTSTRAP_JS` `EventSource` shim ignored `/api/toolchains/stream`, attempting to open an invalid network connection to `https://appassets.androidplatform.net/api/toolchains/stream`.

### B. Memory-Heavy Downloader & Dead URLs (`src/server/toolchainManager.ts`)
- **Failure Root Cause**:
  - `downloadRepositoryAsset` called `const res = await fetch(targetUrl); const arrayBuffer = await res.arrayBuffer(); const buffer = Buffer.from(arrayBuffer); fs.writeFileSync(localPath, buffer);`.
  - Large toolchain archives (e.g. Android SDK at ~570MB compressed, ~866MB uncompressed) were read entirely into RAM in a single contiguous buffer.
  - Upstream release v1.0.7 assets were missing, returning HTTP 404.
  - Downloader lacked `.part` staging, writing incomplete or corrupt streams directly into destination paths.

### C. Security & Extraction (Zip-Slip Vulnerability)
- **Failure Root Cause**:
  - No archive decompression or extraction logic was executed after downloading bundles.
  - No verification of relative entry paths, leaving the application vulnerable to Zip-Slip directory traversal (`../../`).

### D. Platform Architecture Incompatibilities
- **Failure Root Cause**:
  - Native Android uses Bionic libc; it does not contain Debian `apt-get` or glibc packages outside of PRoot.
  - Blindly executing `/bin/bash` crashed on Windows and Android hosts.

---

## 3. Implementation of Repairs

### 1. Robust Streaming Downloader (`downloadWithDiagnostics`)
Implemented in `src/server/toolchainManager.ts`:
- **Protocol & URL Validation**: Validates HTTP/HTTPS scheme and hostname. Enforces HTTPS integrity and blocks insecure redirect downgrades.
- **Safe Redirection**: Follows up to 5 redirects safely with cycle/loop detection.
- **Pre-Flight Disk Space Check**: Verifies `availableBytes >= requiredBytes` before making network requests; immediately reports `DiskSpaceExhaustedException`.
- **Streaming into `.part`**: Uses chunk-by-chunk stream reader into a temporary `${destination}.part` file, preventing high RAM consumption.
- **Incremental SHA-256**: Hashes chunks on the fly using `crypto.createHash('sha256')`.
- **Content Validation**: Detects and rejects HTML error documents (e.g. `<!DOCTYPE html>`) saved as binary archives.
- **Integrity Validation**: Verifies `Content-Length` matches actual received bytes and `actualSha256 === expectedSha256`.
- **Clean Cancellation & Rollback**: Aborts streams, closes file descriptors, and deletes `.part` files immediately on failure or cancellation.
- **Atomic Promotion**: Renames verified `.part` file to the final destination path upon validation.

### 2. Self-Contained Safe Archive Extractor (`extractArchiveSafely`)
Implemented in `src/server/toolchainManager.ts`:
- **Zero-Dependency ZIP & TAR Engine**: Parses ZIP (methods 0 store and 8 deflate) and TAR / TAR.GZ archives without requiring external binaries (`unzip` or `tar`).
- **Zip-Slip Protection**: Resolves every entry path and strictly enforces `resolvedTarget.startsWith(resolvedStaging + path.sep)`. Rejects directory traversal entries (`../../`) immediately.
- **Atomic Staging Directory**: Extracts entries into a temporary staging folder (`.staging_<target>_<timestamp>`).
- **Executable Permissions**: Ensures `0o755` permissions for binaries in `bin/` or matching executable scripts (`.sh`, `.exe`).
- **Atomic Promotion & Rollback**: Promotes staging directory to destination on success; completely wipes staging directory on failure.

### 3. Native Android Toolchain Manager (`AndroidToolchainManager.kt`)
Created in `android-workstation/app/src/main/java/io/anvil/workstation/toolchain/AndroidToolchainManager.kt`:
- **App-Private Storage**: Installs all tools under `context.filesDir/toolchains` (`/data/user/0/io.anvil.workstation/files/toolchains`).
- **Storage Monitoring**: Checks `context.filesDir.usableSpace` before starting downloads and extractions.
- **Streaming Downloader**: Implements chunked streaming (32KB buffer) using `HttpURLConnection` to `downloads/<file>.part` with live progress events, HTML error page detection, SHA-256 calculation, and cancellation handling.
- **Safe ZIP Extraction**: Extracts archives with Java `ZipInputStream`, validates entry canonical paths against Zip-Slip traversal, and marks binaries executable with `targetFile.setExecutable(true, false)`.
- **State Persistence**: Persists installed status, versions, verification timestamps, and diagnostics in `SharedPreferences`.

### 4. Android Web Bridge & EventSource Integration
- **`AndroidWebBridge.kt`**: Integrated `AndroidToolchainManager` to handle all toolchain REST requests:
  - `GET /api/toolchains` & `/api/toolchains/state`
  - `POST /api/toolchains/verify`
  - `POST /api/toolchains/selection`
  - `POST /api/toolchains/install` & `POST /api/toolchains/:id/install`
  - `POST /api/toolchains/cancel`
  - `GET /api/toolchains/resources`
  - `POST /api/toolchains/resources/download`
- **`MainActivity.kt`**: Updated `BRIDGE_BOOTSTRAP_JS` so `window.EventSource` intercepts `/api/toolchains/stream` and dispatches live `init` and `progress` events from `window.__obsidianReceiveToolchainEvent`.

### 5. Truthful Platform Classification
Updated `MOBILE_HARNESS_TOOLCHAIN_SPECS` with `platformClassification`:
- `android_native`: Claude Code, Node.js, npm, Git, OpenCode CLI, Web tools, Android SDK 35 (AAPT2, D8, apksigner).
- `proot_linux`: Python 3, C/C++ (GCC/Make), PHP (Composer) requiring Debian/Ubuntu guest.
- `downloadable_data`: SDK platforms, Maven caches, GGUF models.
- If a tool requires PRoot Linux on native Android without PRoot installed, reports an actionable diagnostic without crashing:
  `"[Tool] requires a PRoot Linux environment on Android. Native Android Bionic cannot install Debian packages directly without PRoot."`

---

## 4. Verification Evidence & Automated Test Results

The test suite `tests/toolchainDownloadPipeline.test.ts` was written and executed to verify all 13 required scenarios:

| # | Test Scenario | Expected Behavior | Outcome |
|---|---|---|---|
| 1 | Successful download & streaming | Streams chunk-by-chunk to `.part`, verifies SHA-256, atomically renames to target | **PASS** |
| 2 | HTTP 404 response handling | Rejects with `HttpNotFoundException`, reports URL, does not save file | **PASS** |
| 3 | HTTP 500 server error handling | Rejects with `HttpServerErrorException`, reports status code | **PASS** |
| 4 | Network connection / TLS failure | Captures unreachable host, reports `NetworkException` | **PASS** |
| 5 | Interrupted download cleanup | Server drops socket mid-stream; cleans up `.part` file | **PASS** |
| 6 | Insufficient disk space pre-check | Detects required > available storage; fails before network request | **PASS** |
| 7 | Checksum mismatch detection | Corrupted payload rejected with `ChecksumMismatchException`; `.part` deleted | **PASS** |
| 8 | HTML error page detection | Server returns 200 with HTML error; rejected with `HtmlErrorPageException` | **PASS** |
| 9 | Zip-Slip path traversal prevention | Rejects archive with `../../evil.sh`; does not escape staging dir | **PASS** |
| 10 | Staging rollback on error | Corrupt archive extraction fails; staging directory completely deleted | **PASS** |
| 11 | Mid-stream cancellation | AbortController aborts download; deletes `.part` and leaves no partial state | **PASS** |
| 12 | State persistence across restart | Persists selection and tool states across manager instances | **PASS** |
| 13 | Platform classification & binary checks | Verifies platform classification, executable permissions, and version probing | **PASS** |

### Test Execution Command:
```powershell
npx tsx --test tests/toolchainDownloadPipeline.test.ts
```
**Result:** 13 passed, 0 failed, 0 skipped.

### Full Project Verification:
```powershell
npm run lint; npm run build; npm run test:duet
```
**Result:** All lint checks passed (0 errors), Vite production bundle built successfully, and 16/16 Duet/Companion tests passed.
