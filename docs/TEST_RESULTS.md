# Automated Test Execution Results (`docs/TEST_RESULTS.md`)

## 1. Executed Test Suite (`npm test` / `tsx --test tests/workstation.test.ts`)
- **Command**: `ANVIL_TEST_MODE=1 tsx --test tests/workstation.test.ts`
- **Result**: `9 passed, 0 failed` (`duration_ms: 755.54 ms`)

| Test Case | Status | Duration | Verified Behavior |
|---|---|---|---|
| `1. SecretRedactor masks Bearer tokens, API keys, and custom secrets` | `TESTED` (PASS) | `1.82 ms` | Strips `Bearer <token>`, `sk-or-v1-*` prefixes, and custom vault secrets from logs and error strings |
| `2. EncryptedCredentialVault encrypts with AES-256-GCM and never exposes raw keys in listCredentials` | `TESTED` (PASS) | `3.05 ms` | Encrypts API keys with 256-bit AES-GCM + auth tag, sanitizes whitespace/Bearer prefix, and masks output |
| `3. PermissionManager enforces workspace path boundaries and rejects path traversal` | `TESTED` (PASS) | `0.75 ms` | Blocks `../../etc/passwd` traversal and null-byte injection |
| `4. WorkspaceManager creates project templates, reads UTF-8 bounded, computes unified diffs, and reverts checkpoints` | `TESTED` (PASS) | `3.18 ms` | Verifies template generation, UTF-8 file writes, `+`/`-` unified diff calculation, and checkpoint rollback |
| `5. WorkspaceManager rejects binary files with null bytes from UTF-8 text editor` | `TESTED` (PASS) | `0.72 ms` | Detects null bytes in binary files and blocks silent corruption |
| `6. TerminalSessionManager executes real shell commands, preserves stateful cwd within workspace, and blocks traversal` | `TESTED` (PASS) | `50.57 ms` | Runs real `python3 calculator.py`, verifies stdout & exit code `0`, and blocks `cd /etc` outside workspace |
| `7. LocalModelManager parses real GGUF v3 binary headers and rejects corrupted files` | `TESTED` (PASS) | `3.57 ms` | Parses 24-byte `GGUF` v3 little-endian binary header (`196` tensors, `24` KV pairs) and rejects invalid headers |
| `8. BuildServiceManager executes real Python builds and honestly reports missing JDK/Android SDK for Android Gradle builds` | `TESTED` (PASS) | `265.68 ms` | Runs real Python compile + unit tests, packages `.tar.gz` artifacts, and reports `BLOCKED_ENVIRONMENT` when `java`/`gradle` is absent |
| `9. MemoryAndMcpManager persists scoped memory notes and searches by keyword` | `TESTED` (PASS) | `1.34 ms` | Saves workspace-scoped memory notes and retrieves matching entries by keyword |

## 2. Native Android JUnit Test Suite (`android-workstation/app/src/test/java/io/anvil/workstation/WorkstationCoreUnitTest.kt`)
- **Status**: `IMPLEMENTED` (Requires JDK 17 + Android Gradle Plugin on host to execute `./gradlew testDebugUnitTest`; blocked inside container because `java`/`javac` is not installed in the gVisor container).
- **Covered Tests**:
  - `secretRedactor_masksBearerAndApiKeys`
  - `permissionManager_blocksPathTraversalOutsideWorkspace`
  - `workspaceManager_computesUnifiedDiffAndDetectsBinary`
  - `buildService_verifiesRealApkZipStructure`
  - `ggufInspector_parsesRealBinaryHeaderAndChecksMemory`
  - `mcpClient_validatesToolSchemasAndRejectsErrors`
