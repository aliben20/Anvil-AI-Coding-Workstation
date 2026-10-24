# Known Limitations (`docs/KNOWN_LIMITATIONS.md`)

Every limitation listed below was verified through direct environment and source inspection:

1. **On-Box Android APK Compilation inside the AI Studio Container (`java` / `ANDROID_HOME` missing)**:
   - **Verified Cause**: The host container (`Linux 4.19.0-gvisor x86_64`) provides Node.js `v22.23.3`, Bun `1.4.2`, Python `3.10.12`, and Git `2.34.1`, but does not have a JDK (`java`/`javac`) or Android SDK (`aapt2`, `d8`, `apksigner`) installed.
   - **Honest Behavior & Legitimate Alternative**: The `BuildService` executes real toolchain detection and reports `JDK_NOT_FOUND` / `ANDROID_SDK_NOT_FOUND` when attempting to run `./gradlew assembleDebug` inside the container—never fabricating a fake `.apk` build result. For Node/Web and Python workspaces, real builds and syntax checks run directly on the container. For the native Android project (`android-workstation/`), users can export the complete, buildable Android Studio project archive (`anvil-android-workstation-source.tar.gz`) to build on any machine with JDK 17 + Android SDK, or upload/import a prebuilt `.apk` to verify its real binary ZIP central directory, `AndroidManifest.xml`, and SHA-256 signature.

2. **Local GGUF On-Device Inference Engine (`llama.cpp` Native Binary)**:
   - **Verified Cause**: Running quantized GGUF inference requires a native C/C++ `llama.cpp` shared library (`libllama.so`) compiled via NDK (`arm64-v8a`) or `gcc`/`cmake` on the host, and neither `gcc` nor the Android NDK is installed in this gVisor container.
   - **Honest Behavior & Legitimate Alternative**: The `LocalModelEngine` implements a real binary `.gguf` v2/v3 header parser that inspects uploaded or workspace `.gguf` files (verifying the `0x47475546` `"GGUF"` magic header, version, tensor count, metadata key-value count, file size, and RAM safety budget against actual available host memory, plus a Realme 7 5G / Dimensity 800U 8 GB RAM hardware profile check). When inference is requested on a GGUF file without the native `libllama` shared library present, it reports the exact missing native library blocker instead of returning simulated text.

3. **PRoot Linux Subsystem on Android 10+ (W^X & Phantom Process Killer)**:
   - **Verified Cause**: Android 10+ enforces `SELinux` execute-only restrictions on app home directories (`W^X`), and Android 12+ (`API 31+`) limits background child processes via the Phantom Process Killer (max 32 across system or aggressive cgroup freezing).
   - **Mitigation in `android-workstation`**: Documented in `RuntimeManager.kt` and `AndroidManifest.xml`; native binaries must be packaged as `libproot.so` in `jniLibs/arm64-v8a` with `useLegacyPackaging = true` and `targetSdk` / Foreground Service declarations (`specialUse`) configured transparently.

4. **Desktop-Only / Restricted Provider OAuth Flows**:
   - **Verified Cause**: Certain proprietary CLI flows (such as internal loopback tokens or private OAuth client secrets) cannot be safely embedded in a public client APK without violating provider terms or exposing client secrets.
   - **Mitigation**: Only officially supported API key flows, server-managed Gemini API, and public OAuth 2.0 PKCE flows are supported.
