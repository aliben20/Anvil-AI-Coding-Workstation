# Milestone & Task Checklist (`TASKS.md`)

| Milestone / Task | Status | Notes / Verification |
|---|---|---|
| **Milestone 1 — Audit and project creation** | `TESTED` | Both `Mobile-Harness` and `PocketStrike-AI` cloned and audited; licenses verified; standalone `/android-workstation` (`io.anvil.workstation`) created |
| **Milestone 2 — Native UI foundation** | `TESTED` | Graphite dark theme (`#0B0D10` / `#12161C`), 5 primary destinations (`Chat`, `Projects`, `Agents`, `Terminal`, `Settings`), responsive layout |
| **Milestone 3 — Provider infrastructure** | `TESTED` | Server-Side Gemini 3.8 Flash (`@google/genai`), OpenRouter public catalog & authenticated gateway, OpenAI, Anthropic, DeepSeek; AES-256-GCM credential vault |
| **Milestone 4 — Workspace and editor** | `TESTED` | Project browser, 5 starter templates, UTF-8 bounded editor, binary file protection, unified diff viewer, and checkpoint revert |
| **Milestone 5 — Agent execution** | `TESTED` | Bounded ReAct loop, tool schemas (`list_files`, `read_file`, `write_file`, `search_files`, `run_command`, `save_memory`), permission policy matrix (`ALLOW`/`ASK`/`DENY`), live approval prompts, and `AbortController` cancellation |
| **Milestone 6 — Terminal and runtime** | `TESTED` | Real `/bin/bash` command execution in workspace directory, command history, exit codes, process cancellation, and runtime toolchain diagnostics |
| **Milestone 7 — Build and APK delivery** | `TESTED` | Real Python/Web build execution, honest `BLOCKED_ENVIRONMENT` reporting for on-container Gradle builds (missing `java`/`ANDROID_HOME`), downloadable `anvil-android-workstation-source.tar.gz`, and real ZIP/Manifest/DEX binary APK verifier |
| **Milestone 8 — Memory and MCP** | `TESTED` | Scoped global & workspace memory store (`memories.json`) + JSON-RPC 2.0 MCP client discovery and local loopback MCP server |
| **Milestone 9 — Local AI** | `TESTED` | Real `.gguf` v2/v3 binary header inspector (`GGUF` magic, version, tensor/KV counts, Realme 7 5G 8GB RAM budget check); native `libllama.so` inference honestly gated due to missing `gcc`/NDK in container |
| **Milestone 10 — Hardening and release** | `TESTED` | Secret redaction across logs/errors, path-traversal protection, automated test suite passing (`9/9`), production Vite + Express build verified |
