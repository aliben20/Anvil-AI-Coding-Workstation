# PocketStrike-AI Repository Audit (`docs/POCKETSTRIKE_AUDIT.md`)

## 1. Repository Overview
- **Source URL**: `https://github.com/AbuZar-Ansarii/PocketStrike-AI`
- **Inspected Commit / Branch**: `main` (cloned and verified locally at `/tmp/audit-repos/PocketStrike-AI`)
- **License**: MIT License (`Copyright (c) 2026 Mohd Abuzar`)
- **Primary Language & Stack**: Python 3 (`server.py`, 7,234 lines) running a Flask server with a Vanilla HTML/CSS/JS web dashboard (`templates/index.html`, `static/script.js`, `static/style.css`), targeted at Android Termux as well as Linux/macOS/Windows.

## 2. Structural & Architectural Findings
| Component | Source Location in `server.py` | Technical Assessment |
|---|---|---|
| **ReAct Agent Loop** | `get_ai_response_with_tools()`, `get_ai_response_stream()`, `execute_local_tool()` | Implements a multi-turn Reasoning + Action loop supporting tool calls over OpenAI-compatible and Ollama endpoints. **Weakness**: Tool execution has broad privileges by default and mixes offensive security/device control tools (`make_phone_call`, `send_sms`, `subnet_port_sweep`, `execute_root_command`) with coding tools in a single 7,234-line file. |
| **Memory System** | `initialize_memory_files()` (lines 165–260), `auto_evolve_memory_background()` | **Useful concept**: Stores human-readable, structured Markdown context files inside `workspace/agent/` (`user.md`, `memory.md`, `agent.md`) alongside `conversations.json`. However, background auto-evolution (`auto_evolve_memory_background`) can silently mutate memory from untrusted conversation text if not gated. |
| **MCP Client Integration** | `load_mcp_connections()`, `StdioMcpConnection` (lines 5794–5940), `query_streamable_http_tools()`, `call_streamable_http_tool()`, `query_remote_mcp_tools()` | **Strong component**: Implements JSON-RPC 2.0 MCP client discovery (`tools/list`) and invocation (`tools/call`) over both Streamable HTTP (`POST`) and SSE (`parse_sse_response`), plus stdio subprocesses. |
| **Stateful Shell** | `class StatefulShell` (lines 1180–1290), `execute_termux_command()` | Maintains current working directory and environment state across sequential shell commands with timeout handling. |
| **System & Offensive Tools** | `audit_sms_inbox`, `take_camera_photo`, `detect_arp_spoofing`, `check_subdomain_takeover`, `smart_ui_click` | Over 50 Termux/ADB/network tools. Many require invasive Android permissions (SMS, Contacts, Camera, Root, Accessibility UI dumping) that violate least-privilege principles for a software engineering workstation. |

## 3. Reusability Decisions for Anvil AI Coding Workstation
1. **Reuse & Adapt (MIT Licensed)**:
   - **MCP Client Protocol (HTTP/SSE JSON-RPC 2.0)**: Adapt PocketStrike's `query_streamable_http_tools`, `parse_sse_response`, and `call_streamable_http_tool` into a clean, permission-gated `McpClient` module with timeout, schema validation, and explicit tool confirmation.
   - **Structured Workspace & Global Memory (`user.md`, `memory.md`, `project-notes.md`)**: Adapt the transparent Markdown/JSON memory store concept, enhanced with keyword + relevance scoring, retention controls, project isolation, and explicit user control (no silent background mutation from untrusted output).
   - **Stateful Shell Session**: Adapt the working-directory-preserving shell runner with strict workspace path validation, output size caps, exit code capture, and signal termination (`SIGINT`/`SIGTERM`).
2. **Reject / Exclude**:
   - Exclude all invasive phone/SMS/camera/accessibility/network-scanning tools (`send_sms`, `make_phone_call`, `audit_sms_inbox`, `subnet_port_sweep`, `execute_root_command`).
   - Replace the single-file 7,234-line Python script architecture with strongly typed, modular interfaces in both the native Android Kotlin codebase (`android-workstation/`) and the live TypeScript workstation runtime.
