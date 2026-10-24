# Development Environment Audit (`docs/ENVIRONMENT.md`)

## 1. Discovered Host Environment
- **Kernel & OS**: `Linux localhost 4.19.0-gvisor #1 SMP x86_64 GNU/Linux` (Containerized Linux environment under gVisor sandbox).
- **Filesystem & Disk Space**:
  - Root mount (`/`): `504 GB` total, `285 MB` used, `504 GB` available (`1%` utilization).
  - `/tmp` and `/dev/shm`: `504 GB` available.
- **Network & Git Connectivity**:
  - `git`: Installed (`git version 2.34.1`). Outbound HTTPS access to GitHub (`https://github.com/techjarves/Mobile-Harness` and `https://github.com/AbuZar-Ansarii/PocketStrike-AI`) succeeded; both repositories were cloned into `/tmp/audit-repos/` and inspected directly.
  - `curl` (`7.88.1` with OpenSSL `3.0.22`) and `wget` (`1.21.2`): Installed and verified.

## 2. Installed Runtimes & Compilers
| Tool / Runtime | Status | Version / Path | Notes |
|---|---|---|---|
| **Node.js** | Available | `v22.23.3` (`/usr/local/bin/node`) | Used for full-stack runtime, Express server, and test execution |
| **npm** | Available | `10.9.9` (`/usr/local/bin/npm`) | Package manager |
| **Bun** | Available | `1.4.2` (`/usr/local/bin/bun`) | Fast JS/TS runtime and test runner |
| **Python 3** | Available | `Python 3.10.12` (`/usr/bin/python3`) | Used for scripting, deterministic archive creation, and workspace templates |
| **Git** | Available | `2.34.1` (`/usr/bin/git`) | Repository cloning and diff tracking |
| **Unzip / Tar** | Available | `/usr/bin/unzip`, `/bin/tar` | Archive inspection and packaging |
| **JDK (`java` / `javac`)** | Missing in container | `not found` | Blocker for local Gradle/AAPT2 APK compilation inside this container |
| **Android SDK / NDK** | Missing in container | `not found` (`ANDROID_HOME` unset) | No `sdkmanager`, `aapt2`, `d8`, or `apksigner` installed on host |
| **Gradle / Kotlin CLI** | Missing in container | `not found` | Requires JDK 17+ and Android SDK |
| **Android Emulator / ADB** | Missing in container | `not found` | No connected physical device or emulator in gVisor container |

## 3. Source Project Toolchain Requirements (from Audit)
- **Mobile-Harness (`com.jarves.mh`)**:
  - Uses Kotlin + Jetpack Compose (`compose-bom:2025.02.00`, `activity-compose:1.10.0`), `compileSdk = 36`, `minSdk = 28`, `targetSdk = 28` (or `36` for Play builds).
  - Requires **JDK 17** (`JavaVersion.VERSION_17`), **Android NDK `28.2.13676358`** (for 16 KiB page-aligned static `proot` + `talloc` + `libandroid-shmem` native binaries targeting `arm64-v8a`), and CMake `3.22.1`.
- **PocketStrike-AI**:
  - Written in **Python 3** (`server.py`, 7,234 lines) with a Flask server and Vanilla JS/HTML/CSS frontend (`templates/index.html`, `static/script.js`), designed to run inside Android Termux or Linux/macOS.

## 4. Environment Strategy & Blocker Resolution
1. **Standalone Native Android Project (`android-workstation/`)**:
   - Created as a complete, modular Kotlin + Jetpack Compose Android project with unique application ID `io.anvil.workstation` (`compileSdk = 35`, `minSdk = 28`, JDK 17, Compose BOM `2025.02.00`), containing all 14 architectural packages (`core`, `designsystem`, `chat`, `providers`, `agents`, `workspace`, `terminal`, `runtime`, `buildsystem`, `memory`, `mcp`, `localai`, `security`, `settings`) and JUnit unit tests.
   - Because this Linux gVisor container does not have `java`/`javac` or the Android SDK installed, **on-box Gradle APK compilation cannot complete inside this container**. Following Mandatory Rule 7 ("Never claim that an APK built successfully unless the build actually completed and the resulting artifact exists") and Rule 14 ("If a feature cannot be implemented on Android because of platform restrictions, document the exact limitation and implement the best legitimate alternative"), the Build Service runs real pre-flight environment checks (`java`, `javac`, `gradle`, `ANDROID_HOME`), honestly reports the missing JDK/Android SDK blocker in this container, packages the complete Android Studio project as a downloadable `.tar.gz` bundle, and provides real APK binary verification (ZIP central directory + `AndroidManifest.xml` inspection + SHA-256) for any built or imported APK.
2. **Live Full-Stack Workstation Host (`server.ts` + React UI on Port 3000)**:
   - Runs the exact same modular architecture live against the real Linux container filesystem, real `/bin/bash` child processes, real AES-256-GCM encrypted credential storage, real HTTP AI providers (Server-Side Gemini 3.8 Flash + OpenRouter, OpenAI, Anthropic, DeepSeek, OpenCode Zen), real ReAct agent loop with permission enforcement, real unified file diffs, and real MCP HTTP/SSE discovery.
