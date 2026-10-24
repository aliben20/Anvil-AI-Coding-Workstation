<div align="center">

# OBSIDIAN · Anvil AI Coding Workstation

**Next-Generation Developer Workstation · Multi-Agent Collaboration · On-Device & Cloud AI · Android Native Toolchain**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.0-61dafb?logo=react&logoColor=black)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4.3-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Obsidian Plugin](https://img.shields.io/badge/Obsidian_Plugin-API_v1.14+-7C3AED?logo=obsidian&logoColor=white)](https://obsidian.md/)
[![Android](https://img.shields.io/badge/Android-Kotlin_2.0_%7C_Compose-3DDC84?logo=android&logoColor=white)](https://developer.android.com/)
[![llama.cpp](https://img.shields.io/badge/On--Device_AI-node--llama--cpp_v3-F59E0B)](https://github.com/withcatai/node-llama-cpp)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)

</div>

---

## 1. Overview

**OBSIDIAN (Anvil AI Coding Workstation)** is an end-to-end, multi-agent AI coding environment designed for real engineering workflows across desktop, web, Android devices, and Obsidian knowledge vaults. 

Rather than functioning as a standard conversational wrapper, OBSIDIAN combines **bounded autonomous agent loops**, **on-device GGUF inference (`llama.cpp`)**, **cloud model routing (Gemini 3.8 Flash, Claude 3.5 Sonnet, GPT-4o)**, **Linux PTY terminal session execution**, **unified workspace diffing & rollback**, and **native Android APK compilation & verification**.

Furthermore, OBSIDIAN introduces **Duet Agent** — a native Obsidian plugin and companion daemon that enables pair-programming agents to collaborate directly with notes, design docs, and codebases inside Obsidian.

---

## 2. Key Features

- **Multi-Agent Orchestration**:
  - Primary Autonomous Coder paired with a secondary Critic/Reviewer agent.
  - Step budget controls, token tracking, and structured tool loops with interactive operator approvals (`ALLOW`, `ASK`, `DENY`).
- **Obsidian Duet Agent Plugin**:
  - Native Obsidian vault view (`apps/obsidian-plugin/`) with live activity streaming, markdown note inspection, backlink graph analysis, unified diff review, and non-destructive undo snapshots.
  - Dedicated local companion daemon (`apps/companion/`) with master token pairing, task crash recovery, and process sandboxing.
- **On-Device Local AI Engine**:
  - Quantized GGUF execution powered by `node-llama-cpp`.
  - Supports offline on-device models (SmolLM2-135M, Qwen2.5-Coder-1.5B, Llama-3.2-1B, and vision models) with strict token generation, memory validation, and repetition penalty control.
- **Cloud AI Provider Engine**:
  - Native Google Gemini streaming (`gemini-3.8-flash`, `gemini-2.5-pro`) with function calling.
  - Dynamic provider adapters for OpenAI, Anthropic, OpenRouter, DeepSeek, and Ollama.
  - AES-256-GCM encrypted credential vault with automatic secret redaction.
- **Native Android Workstation**:
  - Production Jetpack Compose + Kotlin 2.0 app (`io.anvil.workstation`) in `/android-workstation`.
  - Android harness toolchain (`MobileHarnessToolchainManager`), AAPT2 manifest audits, and binary APK DEX/resource validation.
- **Multi-Directory Skills System**:
  - Scans workspace, user profile, system, and plugin directories for standard `SKILL.md` playbooks with YAML frontmatter.
  - Automatic keyword and intent matching injecting targeted guidance into agent loops.
- **Developer Experience**:
  - Pure NDJSON token streaming (`/api/chat/send`) with sub-millisecond response latency.
  - Dark graphite visual design (`#0D0F12`), Lucide icons, persistent terminal tabs, and responsive desktop/mobile overlays.

---

## 3. Architecture & Subsystems

```
                                      ┌─────────────────────────────────────┐
                                      │         OBSIDIAN Web UI             │
                                      │  (Vite + React 19 + Tailwind v4)    │
                                      └──────────────────┬──────────────────┘
                                                         │ NDJSON Stream
                                                         ▼
┌─────────────────────────────────────┐       ┌─────────────────────────────────────┐
│       Obsidian Duet Plugin          │       │      Full-Stack Server Entry        │
│   (Vault Tools + Diff Proposal)     │       │            (server.ts)              │
└──────────────────┬──────────────────┘       └──────────────────┬──────────────────┘
                   │ HTTP / WS                                   │
                   ▼                                             ├─► BoundedAgentLoopRunner
┌─────────────────────────────────────┐                          ├─► EncryptedCredentialVault
│       Duet Companion Service        │                          ├─► PersistentPtySessionManager
│       (apps/companion :3842)        │                          ├─► SkillsManager
└──────────────────┬──────────────────┘                          ├─► BuildServiceManager
                   │                                             └─► WorkspaceManager
                   ▼                                                     │
┌─────────────────────────────────────┐                                  ▼
│        Security & Sandboxing        │                 ┌─────────────────────────────────┐
│ (Path bounds, Command allowlist)    │                 │   Inference Generation Router   │
└─────────────────────────────────────┘                 ├────────────────┬────────────────┤
                                                        │                │                │
                                                        ▼                ▼                ▼
                                                Google Gemini 3.8    Local GGUF      Cloud REST
                                                 (Stream + Tools)   (node-llama-cpp) (OpenAI/Anthropic)
```

### Core Subsystems

| Module | Location | Description |
| :--- | :--- | :--- |
| **Server Entrypoint** | [`server.ts`](server.ts) | Express + Vite integration, API routes, NDJSON streaming, and agent orchestration. |
| **Workstation Engine** | [`src/server/workstationEngine.ts`](src/server/workstationEngine.ts) | Bounded agent loops, vault credentials, permission policies, workspace manager, and APK verifier. |
| **Local Llama Engine** | [`src/server/localLlamaEngine.ts`](src/server/localLlamaEngine.ts) | Native llama.cpp GGUF inference, context sequence management, and temperature controls. |
| **Skills System** | [`src/server/skillsManager.ts`](src/server/skillsManager.ts) | Multi-directory discovery of `SKILL.md` files across user, global, workspace, and plugin paths. |
| **PTY Session Manager** | [`src/server/ptySessionManager.ts`](src/server/ptySessionManager.ts) | Cross-platform interactive shell sessions (PowerShell, Bash, Zsh) with secret masking. |
| **Diagnostics Runner** | [`src/server/diagnosticsRunner.ts`](src/server/diagnosticsRunner.ts) | Automated probe suite for hardware, toolchains, permissions, build pipelines, and AI backends. |
| **Duet Obsidian Plugin** | [`apps/obsidian-plugin/`](apps/obsidian-plugin/) | Official Obsidian plugin for reviewable note patches, dual-agent chat, and backlink graphs. |
| **Duet Companion Service** | [`apps/companion/`](apps/companion/) | Lightweight daemon running background tasks, task crash recovery, and security sandboxing. |
| **Android Workstation** | [`android-workstation/`](android-workstation/) | Native Kotlin 2.0 + Jetpack Compose Android app with offline terminal & build tools. |

---

## 4. Getting Started

### Prerequisites

- **Node.js**: `v20.0.0` or higher (Node 22+ recommended).
- **Package Manager**: `npm` (v10+) or `bun`.
- **C/C++ Build Tools** (Optional, for native `node-llama-cpp` compilation on your platform).
- **Java 17 / Android SDK** (Optional, for building native Android APKs locally).

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/aliben20/Anvil-AI-Coding-Workstation.git
   cd Anvil-AI-Coding-Workstation
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   Open `.env` and set your credentials (e.g., `GEMINI_API_KEY`).

4. **Start the OBSIDIAN Workstation:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your web browser.

---

## 5. Running the Obsidian Duet Agent

### 1. Build the Obsidian Plugin
To compile the Obsidian plugin bundle into `dist/` and `dev-vault/.obsidian/plugins/`:
```bash
npm run build:plugin
```

### 2. Start the Background Companion Service
The companion provides persistent task execution, secure pairing, and local tool execution:
```bash
npm run companion
```
The companion service starts on `http://127.0.0.1:3842`.

### 3. Open in Obsidian
1. Open Obsidian and select **Open folder as vault** $\rightarrow$ select `dev-vault`.
2. Navigate to **Settings $\rightarrow$ Community Plugins** and enable **Obsidian Duet Agent**.
3. Click the Duet icon in the left ribbon to launch the collaborative multi-agent workspace.

---

## 6. Testing & Quality Assurance

OBSIDIAN features a comprehensive automated testing suite verifying security, inference, streaming, and tool execution.

```bash
# Run core workstation and inference regression tests
npm test

# Run multi-agent Duet, vault tools, and companion security tests
npm run test:duet

# Run all test suites
npm run test:all

# Perform TypeScript static analysis
npm run lint

# Build production client bundle
npm run build
```

### Key Test Suites

- **`tests/chatEchoRegression.test.ts`**: Verifies role separation, non-echo responses for arithmetic (`5+2`) and sequential numbers, actionable error handling for unconfigured providers, and stream cancellation.
- **`tests/security/securityPolicies.test.ts`**: Validates path traversal blocks, binary execution allowlists, and companion authentication.
- **`tests/plugin/vaultToolsAndDiff.test.ts`**: Verifies unified diff generation, atomic patch application, concurrent modification protection, and undo snapshots.
- **`tests/companion/companionService.test.ts`**: Verifies master token pairing, task crash recovery, and background execution.

---

## 7. Configuration Reference

| Environment Variable | Default | Purpose |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | - | Primary Google Gemini API key for cloud model turns. |
| `PORT` | `3000` | Port for the web workstation and API backend. |
| `NODE_ENV` | `development` | Runtime mode (`development` or `production`). |
| `COMPANION_PORT` | `3842` | Port for the Obsidian Duet Agent companion daemon. |
| `COMPANION_HOST` | `127.0.0.1` | Binding interface for companion security isolation. |
| `COMPANION_MASTER_TOKEN` | Generated | Shared secret token for authenticating Obsidian vault pairing. |
| `OPENAI_API_KEY` | - | Optional OpenAI API key. |
| `ANTHROPIC_API_KEY` | - | Optional Anthropic API key. |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Endpoint for local Ollama instances. |

---

## 8. Repository Structure

```
Anvil-AI-Coding-Workstation/
├── android-workstation/     # Native Android Kotlin 2.0 & Jetpack Compose project
├── apps/
│   ├── companion/           # Duet companion daemon with task persistence
│   └── obsidian-plugin/     # Obsidian Duet Agent plugin source & manifest
├── docs/                    # Architecture audits, environment specs, and reports
├── packages/
│   └── contracts/           # Shared TypeScript interfaces & protocol contracts
├── public/                  # Static assets and template fixtures
├── src/
│   ├── components/          # React 19 UI tabs (Chat, Models, Agent, Terminal, Settings)
│   ├── server/              # Backend engines (workstation, llama, skills, pty, toolchains)
│   ├── App.tsx              # Root workstation application container & streaming handler
│   └── types.ts             # Domain models, event types, and protocol definitions
├── tests/                   # Automated unit, integration, and security test suites
├── dev-vault/               # Development Obsidian vault for plugin testing
├── server.ts                # Express backend server with live Vite HMR
├── package.json             # Root dependency and script definitions
└── tsconfig.json            # TypeScript configuration
```

---

## 9. Security & Privacy

1. **Local-First Execution**:
   - On-device inference runs 100% locally through quantized GGUF weights via `llama.cpp`. No prompt data or code leaves your workstation when Local AI is active.
2. **Encrypted Credential Storage**:
   - All stored API tokens and secrets are encrypted with AES-256-GCM using keys stored exclusively on the host filesystem (`vault.key`).
3. **Automatic Secret Redaction**:
   - `SecretRedactor` dynamically masks API tokens, private keys, and passwords before logging or streaming payloads across the network.
4. **Sandboxed Command Execution**:
   - The Companion and Terminal engines enforce strict command allowlists, directory bounds, and timeout ceilings, preventing traversal and unapproved filesystem operations.

---

## 10. License

This project is licensed under the **MIT License**. See [LICENSE](LICENSE) for details.
Attribution notices for integrated components are preserved in [`docs/`](docs/).
