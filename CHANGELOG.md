# Changelog (`CHANGELOG.md`)

## [1.0.0] - 2026-10-17
### Added
- **Phase 0 & 1 Audits**: Audited host Linux container (`docs/ENVIRONMENT.md`) and cloned/inspected `techjarves/Mobile-Harness` (`docs/MOBILE_HARNESS_AUDIT.md`) and `AbuZar-Ansarii/PocketStrike-AI` (`docs/POCKETSTRIKE_AUDIT.md`), documenting architecture, feature matrix, and MIT attribution notices.
- **Standalone Native Android Project (`/android-workstation`)**: Created complete Kotlin 2.0 + Jetpack Compose project (`io.anvil.workstation`) with `AndroidManifest.xml`, `network_security_config.xml`, `file_paths.xml`, 12 core interfaces across modular packages, and JUnit 4 unit tests.
- **Full-Stack Workstation Runtime (`server.ts` + `src/`)**:
  - AES-256-GCM encrypted credential vault (`EncryptedCredentialVault`) and automatic secret redaction (`SecretRedactor`).
  - Multi-provider AI system supporting Server-Side Gemini (`gemini-3.8-flash`), OpenRouter, OpenAI, Anthropic, and DeepSeek with live connection testing and model discovery.
  - Bounded ReAct Agent Engine with least-privilege `PermissionManager` (`ALLOW`, `ASK`, `DENY`), interactive user approval prompts, and real `AbortController` cancellation.
  - Scoped Workspace Manager with 5 project templates, bounded UTF-8 file editor, unified diff computation, and checkpoint rollback.
  - Real Linux Terminal session with working directory isolation, command history, exit codes, and `SIGTERM`/`SIGKILL` cancellation.
  - Build Service with real toolchain verification, `.tar.gz` Android Studio project export, and binary `.apk` ZIP/Manifest/DEX verifier.
  - Scoped Memory Store, JSON-RPC 2.0 MCP client discovery, and GGUF v2/v3 binary header inspector.
