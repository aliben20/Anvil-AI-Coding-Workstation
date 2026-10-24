# Architecture Specification — OBSIDIAN AI Coding Workstation

## 1. System Topology

OBSIDIAN is a full-stack TypeScript/React + Express engineering workstation designed around a strict three-zone layout and a bounded, auditable ReAct agent runtime.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                        OBSIDIAN 3-ZONE REACT FRONTEND                            │
│  ┌────────────────────┐  ┌──────────────────────────────────┐  ┌──────────────┐  │
│  │ Zone 1: Left Rail  │  │ Zone 2: Primary Work Surface     │  │ Zone 3:      │  │
│  │ • Session Switcher │  │ • ChatTab (Inline Tool Approvals,│  │ Contextual   │  │
│  │ • Workspace Select │  │   Continue/Retry, Step Budget)   │  │ Inspector    │  │
│  │ • Nav Destinations │  │ • ProjectsTab (Editor/Diffs/APK) │  │ • Env Status │  │
│  │ • Active Provider  │  │ • AgentsTab (Policy/Memory/MCP)  │  │ • Checkpoints│  │
│  │                    │  │ • TerminalTab (Full Linux Shell) │  │ • Live Steps │  │
│  └────────────────────┘  └──────────────────────────────────┘  └──────────────┘  │
└─────────────────────────────────────────┬────────────────────────────────────────┘
                                          │ REST / JSON-RPC 2.0
┌─────────────────────────────────────────▼────────────────────────────────────────┐
│                       EXPRESS SERVER & WORKSTATION ENGINE                        │
│  • BoundedAgentLoopRunner (State machine: running -> completed / paused / error) │
│  • normalizeAndValidateToolArgs (PocketStrike-AI parameter alias normalizer)     │
│  • TerminalSessionManager (Structured CommandExecutionResult, AbortSignal kill)  │
│  • WorkspaceManager (Symlink-safe sandboxed path resolver, diff checkpoints)     │
│  • PermissionManager (ALLOW / ASK / DENY with inline UI approval resolution)     │
│  • EncryptedSecretVault (AES-256-GCM) & SecretRedactor                           │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## 2. Bounded Agent Loop State Machine (`BoundedAgentLoopRunner`)

Each agent execution turn tracks an explicit `TaskExecutionState`:
- `idle`: Waiting for user prompt.
- `running`: Actively streaming model thoughts or executing workspace tools.
- `waiting_approval`: Paused on an `ASK` permission policy with an inline approval banner in the chat stream and inspector.
- `completed`: Model finished all tool calls and produced a verified final response.
- `paused_iteration_limit`: Reached `maxIterations` (configurable 2–20, default 10) while tool calls were still pending. Preserves full conversation and tool context so the user can click **Continue Task** (`POST /api/chat/continue`).
- `cancelled`: Aborted by user (`POST /api/chat/cancel`), immediately terminating any active child process via `AbortSignal`.
- `failed`: Unrecoverable model or tool error with an inline **Retry** action.

## 3. Structured Command Execution Contract (`CommandExecutionResult`)

Every call to `run_command` or `/api/terminal/exec` returns a deterministic structure:
- `status`: `'succeeded' | 'failed' | 'timed_out' | 'cancelled' | 'blocked'`
- `command`: Normalized shell command string
- `cwd`: Validated canonical directory inside the active workspace
- `exitCode`: Numeric process exit code (`0` on success, `124` on timeout, `130` on cancel, `126` on safety block)
- `stdout` & `stderr`: Redacted UTF-8 process streams
- `durationMs`: Wall-clock execution time
- `timedOut` & `cancelled`: Explicit boolean flags
