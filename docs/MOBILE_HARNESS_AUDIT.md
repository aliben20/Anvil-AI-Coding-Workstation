# Mobile-Harness Repository Audit (`docs/MOBILE_HARNESS_AUDIT.md`)

## 1. Repository Overview
- **Source URL**: `https://github.com/techjarves/Mobile-Harness`
- **Inspected Commit / Branch**: `main` (cloned and verified locally at `/tmp/audit-repos/Mobile-Harness`)
- **Application ID**: `com.jarves.mh` (UI titled `PocketDevApp` / `Mobile Harness`)
- **License**: MIT License (`Copyright (c) 2026 Mobile Harness Contributors`), plus `third_party/talloc` (LGPLv3+), `third_party/proot` (GPLv2), `third_party/libandroid-shmem` (BSD).
- **Primary Language & UI Framework**: Kotlin (`jvmTarget = "17"`) with **Jetpack Compose** (`androidx.compose:compose-bom:2025.02.00`, Material 3) and JNI/C++ (`src/main/cpp/CMakeLists.txt`).

## 2. Structural & Architectural Findings
| Component | Source Files Inspected | Technical Assessment |
|---|---|---|
| **Entry Point & UI** | `MainActivity.kt` (104 lines), `ui/PocketDevApp.kt` (7,378 lines), `ui/MainViewModel.kt` (5,400 lines), `ui/AgentScreen.kt` (2,194 lines), `ui/TerminalScreen.kt` (548 lines), `ui/SettingsScreenModern.kt` (1,115 lines) | Native Jetpack Compose UI with localized strings (`values`, `values-ar`, `values-es`, `values-hi`, `values-ru`, `values-zh`). **Weakness**: `PocketDevApp.kt` (7.3k lines) and `MainViewModel.kt` (5.4k lines) are monolithic god-classes that tightly couple UI state, runtime installation, and chat rendering. |
| **Credential Security** | `data/ApiKeyVault.kt` (175 lines) | **Strong component**: Uses Android Keystore (`AES/GCM/NoPadding`, 128-bit GCM tag, alias `pocket-provider-key`) to encrypt multiple named API keys per provider in `SharedPreferences("pocket_secrets")`, stripping `Bearer ` prefixes and accidental terminal line wraps via `cleanSecret()`. |
| **Provider Client & Routing** | `network/ProviderApiClient.kt` (639 lines), `runtime/OpenRouterRoutingGateway.kt` (148 lines), `runtime/LocalFormatGateway.kt` (287 lines), `model/Models.kt` (405 lines) | **Strong component**: Supports `ProviderKind` (`ANTHROPIC`, `CLAUDE_OAUTH`, `OPENAI`, `LLM_ROUTER` / OpenRouter, `DEEPSEEK`, `KIMI`, `OPENCODE_ZEN`, `NVIDIA_NIM`, `CUSTOM`) across three wire protocols (`ANTHROPIC_GATEWAY`, `OPENAI_CHAT`, `OPENAI_RESPONSES`). Includes local loopback gateways (`OpenRouterRoutingGateway`, `LocalFormatGateway`) to translate between Anthropic Messages format and OpenAI Chat/Responses formats. |
| **Agent Bridges & Runtime** | `runtime/AgentDriver.kt` (92 lines), `runtime/ClaudeRuntimeBridge.kt` (1,130 lines), `runtime/DshRuntimeBridge.kt` (1,061 lines), `runtime/AntigravityRuntimeBridge.kt` (721 lines), `runtime/RuntimeInstaller.kt` (1,997 lines) | Wraps external CLI coding agents (`claude-code`, `deepseek-harness`, `antigravity`) inside an ARM64 Ubuntu 20.04 PRoot rootfs (`pocketdev-core-arm64-*.tar.zst`). Uses `RuntimeExecutionService` foreground service and `NativeSpawnProcess` JNI bridge. |
| **Workspace & Checkpoints** | `runtime/WorkspaceCheckpoints.kt` (309 lines), `runtime/BoundedFileReads.kt` (32 lines) | **Strong component**: Implements safe bounded file reading (`BoundedFileReads`) so large or binary files do not OOM the Android heap, and snapshot-based workspace checkpoints (`WorkspaceCheckpoints`) for diffing and reverting agent edits. |
| **Android Build Support** | `runtime/AndroidBuildSupport.kt` (1,073 lines), `runtime/AndroidProjectTemplateGenerator.kt` (229 lines), `runtime/AndroidAppInstaller.kt` (235 lines) | **Strong component**: Generates clean starter Android Gradle projects (`AndroidProjectTemplateGenerator`), invokes `./gradlew --no-daemon --max-workers=2` with a custom `aapt2` override inside PRoot, parses compiler diagnostics (`AndroidBuildIssue`), locates output APKs (`AndroidApkInfo`), and hands off installation via Android `PackageInstaller` session (`AndroidAppInstaller`). |

## 3. Reusability Decisions for Anvil AI Coding Workstation
1. **Reuse & Adapt (MIT Licensed)**:
   - `ApiKeyVault` pattern: Keystore-backed AES-GCM multi-key pool per provider with whitespace/Bearer sanitization and strict secret redaction.
   - `ProviderApiClient` & multi-protocol architecture: Support for OpenRouter (`/api/v1/models`), OpenAI Chat (`/v1/chat/completions`), OpenAI Responses (`/v1/responses`), Anthropic Messages (`/v1/messages`), DeepSeek, and OpenCode Zen.
   - `BoundedFileReads` & `WorkspaceCheckpoints`: Safe UTF-8 / binary file detection, size-bounded reads, and before/after file diffing + revert checkpoints.
   - `AndroidBuildSupport` & `AndroidProjectTemplateGenerator`: Structured build stages (`PREPARING`, `RESOLVING`, `COMPILING`, `PACKAGING`, `FINDING_APK`, `COMPLETE`, `FAILED`), structured error parsing, and `PackageInstaller` intent flow.
2. **Refactor & Replace**:
   - Break apart the 7,378-line `PocketDevApp.kt` and 5,400-line `MainViewModel.kt` into clean, modular packages (`chat`, `providers`, `agents`, `workspace`, `terminal`, `buildsystem`, `memory`, `mcp`, `localai`, `security`, `settings`).
   - Do **not** depend on proprietary or unverified third-party CLI tarballs (`pocketdev-agy-arm64` / `pocketdev-claude-arm64`) that require external binary downloads to function; implement a native, self-contained bounded ReAct `AgentEngine` with explicit tool schemas and permission gates.
