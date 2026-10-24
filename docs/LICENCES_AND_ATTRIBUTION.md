# Licenses and Attribution (`docs/LICENCES_AND_ATTRIBUTION.md`)

## 1. New Application Identity & License
- **Application Name**: Anvil AI Coding Workstation
- **Package ID**: `io.anvil.workstation`
- **Project Directory**: `/android-workstation` (Native Android Kotlin/Compose project) and `/` (Full-stack Interactive Workstation Host)
- **License**: MIT License

## 2. Audited Source Repositories & Licenses

### A. Mobile-Harness (`https://github.com/techjarves/Mobile-Harness`)
- **Primary License**: MIT License
- **Copyright Notice**:
  ```text
  MIT License
  Copyright (c) 2026 Mobile Harness Contributors

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.
  ```
- **Reused / Adapted Architectural Concepts**:
  - Android Keystore AES-GCM credential encryption pool (`ApiKeyVault`).
  - Multi-protocol provider discovery and validation (`ProviderApiClient`).
  - Bounded UTF-8/binary file reading and workspace diff checkpoints (`BoundedFileReads`, `WorkspaceCheckpoints`).
  - Android Gradle project template generation, build stage tracking, and `PackageInstaller` session handoff (`AndroidBuildSupport`, `AndroidProjectTemplateGenerator`, `AndroidAppInstaller`).
- **Third-Party Native Components in Mobile-Harness (Not bundled as binary blobs in source repo)**:
  - `proot` (GPLv2) and `talloc` (LGPLv3+) are separate userspace executables invoked across process boundaries when the optional Linux runtime bundle is installed on-device.

### B. PocketStrike-AI (`https://github.com/AbuZar-Ansarii/PocketStrike-AI`)
- **Primary License**: MIT License
- **Copyright Notice**:
  ```text
  MIT License
  Copyright (c) 2026 Mohd Abuzar

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.
  ```
- **Reused / Adapted Architectural Concepts**:
  - Model Context Protocol (MCP) JSON-RPC 2.0 over Streamable HTTP and Server-Sent Events (SSE) tool discovery and execution.
  - Structured Markdown/JSON memory persistence (`memory.md`, `user.md`, project context notes) with explicit user retention controls.
  - Stateful working-directory command execution (`StatefulShell`).
