# Reproducible Build & Installation Guide (`docs/BUILD_AND_INSTALL.md`)

## 1. Building the Native Android Application (`android-workstation/`)

The standalone native Android application (`io.anvil.workstation`) is located in the `/android-workstation` directory (and can also be downloaded directly from the Workstation UI via **Builds → Export Android Studio Project (`.tar.gz`)**).

### Prerequisites (on Windows, macOS, or Linux Build Host)
- **JDK**: OpenJDK 17 (`JAVA_HOME` pointing to JDK 17).
- **Android SDK**:
  - `platforms;android-35`
  - `build-tools;35.0.0`
  - Optional for native PRoot/JNI bridges: `ndk;28.2.13676358` and `cmake;3.22.1`
- Set `ANDROID_HOME` (e.g., `export ANDROID_HOME=$HOME/Android/Sdk` on Linux/macOS or `E:\Android\Sdk` on Windows).

### Build Commands
```bash
cd android-workstation

# Run unit tests (Provider parsing, Vault redaction, Agent limits, Workspace path security, GGUF header parser)
./gradlew testDebugUnitTest

# Build Debug APK
./gradlew assembleDebug

# Build Release APK (unsigned or signed with ANVIL_KEYSTORE_* env vars)
./gradlew assembleRelease
```

### Expected Verified APK Output Path (when built with Android SDK)
- Debug APK: `android-workstation/app/build/outputs/apk/debug/app-debug.apk`
- Release APK: `android-workstation/app/build/outputs/apk/release/app-release.apk`

### Installing on an Android Device (Realme 7 5G / ARM64 Android 9+)
1. **Via ADB over USB or Wireless Debugging**:
   ```bash
   adb devices
   adb install -r android-workstation/app/build/outputs/apk/debug/app-debug.apk
   ```
2. **On-Device Installation**:
   - Copy `app-debug.apk` to the device's `Downloads` folder or build inside the workstation.
   - Use the **Builds → Install APK** action, which invokes Android's `PackageInstaller` session (`ACTION_VIEW` / `PackageInstaller.SessionParams.MODE_FULL_INSTALL`) with `FileProvider` URI and `REQUEST_INSTALL_PACKAGES` permission check.

---

## 2. Running and Building the Full-Stack Workstation Host

In this environment (or any Node.js 20+ Linux/macOS/Windows machine):

```bash
# Run automated unit and integration test suite
npm test

# Type-check and lint
npm run lint

# Build production bundle
npm run build

# Start the workstation server on port 3000
npm run dev
```
