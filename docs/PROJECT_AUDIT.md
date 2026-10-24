# Project Audit — OBSIDIAN AI Coding Workstation

## 1. Executive Summary

This audit documents the complete architecture, runtime capabilities, defect root-cause investigation, and repository integration status of the **OBSIDIAN · ANVIL** AI Coding Workstation.

## 2. Workstation Subsystems Audited

| Subsystem | Source Location | Audit Status | Verification Method |
| :--- | :--- | :--- | :--- |
| **Bounded ReAct Agent Loop** | `src/server/workstationEngine.ts` (`BoundedAgentLoopRunner`), `server.ts` | **VERIFIED WORKING** | Automated multi-step integration tests + real tool execution |
| **Structured Shell Execution (`run_command`)** | `src/server/workstationEngine.ts` (`TerminalSessionManager.executeCommand`) | **VERIFIED WORKING** | Unit & integration tests for exit=0, exit!=0, timeout (124), cancel (130), and command safety guard |
| **Workspace File I/O & Path Sandbox** | `src/server/workstationEngine.ts` (`WorkspaceManager`, `PermissionManager`) | **VERIFIED WORKING** | Symlink/traversal tests, read/write/edit/delete/mkdir/rename + checkpoint rollback tests |
| **Permission Governance & Approval Gate** | `server.ts` (`checkPermissionAndMaybeWait`), `src/components/ChatTab.tsx` | **VERIFIED WORKING** | Tested `ALLOW`, `ASK` (interactive modal + inline chat banner), and `DENY` policies |
| **Source Repository Integrations** | `src/server/sourceIntegrations.ts` | **VERIFIED WORKING** | Cloned & integrated `techjarves/Mobile-Harness` (`96b1da0`) and `AbuZar-Ansarii/PocketStrike-AI` (`666144e`) |
| **Secret Redaction & Vault** | `src/server/workstationEngine.ts` (`SecretRedactor`, `EncryptedSecretVault`) | **VERIFIED WORKING** | AES-256-GCM encryption + regex token masking tests |
| **Android APK Binary Verifier & Manifest Auditor** | `src/server/workstationEngine.ts` (`AndroidBuildAndApkVerifier`), `src/server/sourceIntegrations.ts` | **VERIFIED WORKING** | Central Directory ZIP + `AndroidManifest.xml` + `classes.dex` + SHA-256 verification tests |
| **Three-Zone OBSIDIAN UI** | `src/App.tsx`, `src/components/*` | **VERIFIED WORKING** | Production Vite build (`compile_applet`), TypeScript strict check (`lint_applet`), and live HTTP verification |

## 3. Forensic Root-Cause Findings from Production Session Telemetry

During inspection of `.anvil-data/conversations.json` (`conv-1776442006905`, workspace `android-workstation`), four concrete root causes were identified for the failure of the prompt *"build a simple python program, test it, and fix any errors"*:

1. **Tool Argument Alias Mismatch (`cmd` vs `command`)**:
   - The LLM invoked `run_command` with `args: {}` or alternative keys (`cmd`, `script`) because `executeToolCall` previously checked `String(args.command || '')` without normalizing common aliases or returning an actionable schema error.
2. **Permission Gate (`EXECUTE_COMMANDS = ASK`) Deadlock & Non-Descriptive Timeout**:
   - By default, `EXECUTE_COMMANDS` is set to `ASK`. When `run_command` triggered `checkPermissionAndMaybeWait`, the approval card was only rendered inside the right-hand inspector or Agents tab—not inline inside the active Chat stream. After 45 seconds without user interaction, the promise resolved to `false` and returned a generic string (`Tool run_command was denied by permission policy or user`), causing the LLM to retry `run_command` 5 consecutive times until exhausting its 6-step budget.
3. **Host Toolchain Blindness (`pytest` vs `python3 -m unittest`)**:
   - The agent attempted to run `pytest`, which is not installed in the container image, instead of `python3 -m unittest` (which is installed and available at `/usr/bin/python3` 3.13.5).
4. **Workspace File Count Desynchronization (`WorkspaceFile(20)`)**:
   - `App.tsx` fetched `/api/workspaces` once on mount and did not re-fetch workspace summaries after `/api/chat/send` completed, leaving the file count badge at `20` even after `calculator.py` and `test_calculator.py` were created on disk (bringing the real count to `22`).
