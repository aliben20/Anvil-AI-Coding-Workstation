# Source Integration Report — Mobile-Harness & PocketStrike-AI

## 1. Audited Upstream Repositories & Exact Revisions

Both upstream repositories were cloned and inspected directly at their HEAD commits:

| Repository | URL | License | Exact Commit SHA | Commit Date & Summary |
| :--- | :--- | :--- | :--- | :--- |
| **techjarves/Mobile-Harness** | `https://github.com/techjarves/Mobile-Harness` | MIT | `96b1da08d03af4f2d63970a3794c7fda068948c4` | `2026-04-16` — *feat: native spawn process & proot runner* |
| **AbuZar-Ansarii/PocketStrike-AI** | `https://github.com/AbuZar-Ansarii/PocketStrike-AI` | MIT | `666144e59f2af42654f5934394b9f33b1e846059` | `2026-04-12` — *Update README and server.py* |

---

## 2. Feature & Module Classification Matrix

### 2.1 `techjarves/Mobile-Harness` (`96b1da08d03af4f2d63970a3794c7fda068948c4`)

| Upstream File / Module | Classification | Target Integration Location | Adaptation & Notes |
| :--- | :--- | :--- | :--- |
| `app/src/main/java/com/jarves/mh/runtime/AgentDriver.kt` | **ADAPTED** | `src/server/sourceIntegrations.ts` (`BUILTIN_AGENT_PROFILES`) & `src/server/workstationEngine.ts` (`BoundedAgentLoopRunner`) | Adapted the multi-profile agent driver (`coder`, `planner`, `verifier`) and bounded iteration state machine into TypeScript. |
| `app/src/main/java/com/jarves/mh/runtime/BoundedFileReads.kt` | **ADAPTED** | `src/server/sourceIntegrations.ts` (`readBoundedWorkspaceFile`) & `WorkspaceManager.readFile` | Ported UTF-8/binary null-byte inspection and 256 KB truncation guard to prevent memory exhaustion during large file reads. |
| `app/src/main/java/com/jarves/mh/runtime/NativeSpawnProcess.kt` | **ADAPTED** | `src/server/sourceIntegrations.ts` (`buildSanitizedProcessEnv`) & `TerminalSessionManager.executeCommand` | Ported sanitized environment variable construction (`HOME`, `TERM=xterm-256color`, `PYTHONUNBUFFERED=1`) and secret stripping (`GEMINI_API_KEY`, `ANVIL_MASTER_SECRET`) for child processes. |
| `app/src/main/java/com/jarves/mh/runtime/WorkspaceCheckpoints.kt` | **ADAPTED** | `src/server/workstationEngine.ts` (`WorkspaceManager.writeFile`, `revertCheckpoint`) | Ported pre-mutation file snapshots, unified diff line computation, and single-click checkpoint restoration. |
| `app/src/main/java/com/jarves/mh/runtime/AndroidAppInstaller.kt` & `PackageInstallReceiver.kt` | **ADAPTED (Android Source + Verifier)** | `android-workstation/app/src/main/java/io/anvil/workstation/apk/ApkInstallerEngine.kt` & `AndroidBuildAndApkVerifier` | Preserved in the downloadable Kotlin Android source project and paired with server-side ZIP/DEX/Manifest binary verification. |
| `app/src/main/java/com/jarves/mh/runtime/ProotProcessRunner.kt` & `TermuxBootstrapInstaller.kt` | **REJECTED (Android-ARM64 Specific)** | Documented in `SOURCE_REPOSITORIES_METADATA.rejectedModules` | Depends on Android `/data/data/com.jarves.mh` paths and ARM64 `libproot.so`. Replaced on the web/cloud host by native Linux `child_process.spawn('/bin/bash')`. |

---

### 2.2 `AbuZar-Ansarii/PocketStrike-AI` (`666144e59f2af42654f5934394b9f33b1e846059`)

| Upstream File / Module | Classification | Target Integration Location | Adaptation & Notes |
| :--- | :--- | :--- | :--- |
| `server.py:4918-4975` (`parse_arguments`) | **ADAPTED** | `src/server/sourceIntegrations.ts` (`normalizeAndValidateToolArgs`) | Ported robust LLM tool-call argument normalizer that maps common parameter aliases (`cmd`/`script` -> `command`, `file`/`filepath` -> `path`, `oldText` -> `search`, `newText` -> `replace`) and rejects empty invocations with actionable hints. |
| `server.py:1535-1605` (`run_shell_command`) | **ADAPTED** | `src/server/sourceIntegrations.ts` (`evaluateCommandSafety`) & `TerminalSessionManager.executeCommand` | Ported destructive shell command blocklist (`rm -rf /`, fork bombs, raw disk writes, host shutdown) while allowing legitimate workspace build/test commands. |
| `server.py:5365-5425` (`get_ai_response_with_tools`) | **ADAPTED** | `src/server/workstationEngine.ts` (`BoundedAgentLoopRunner.runLoop`) | Ported duplicate tool-call loop breaker, per-step telemetry emission, and graceful iteration-limit pause (`paused_iteration_limit`) with resume support. |
| `server.py:378-436` (`audit_manifest`) | **ADAPTED** | `src/server/sourceIntegrations.ts` (`auditAndroidManifestContent`) & `POST /api/builds/audit-manifest` | Ported AndroidManifest.xml security parser detecting `android:debuggable="true"`, dangerous permissions, and exported components. |
| `server.py:5977-6110` (`mcp_request` / `mcp_call_tool`) | **ADAPTED** | `src/server/workstationEngine.ts` (`MemoryAndMcpManager`) | Ported JSON-RPC 2.0 Streamable HTTP (`initialize`, `tools/list`, `tools/call`) with SSE `data:` frame parsing. |
| Offensive Exploitation Prompts & Unscoped Host Tools (`nuclei`, `sqlmap`, `hydra`, `frida`) | **REJECTED (Out-of-Scope / Unsafe)** | Documented in `SOURCE_REPOSITORIES_METADATA.rejectedModules` | Excluded to keep the workstation strictly focused on safe software engineering, testing, and Android/Python/Web development. |
