export interface ClientEnvironment {
  platform: 'desktop_browser' | 'mobile_browser' | 'android_native' | 'android_browser' | 'ios_browser';
  isMobile: boolean;
  isAndroidNative: boolean;
  userAgent?: string;
  deviceModel?: string;
  manufacturer?: string;
  androidApiLevel?: number;
  label: string;
}

export interface BackendEnvironment {
  os: string;
  platform: string;
  osName: string;
  arch: string;
  hostname: string;
  release: string;
  nodeVersion?: string;
  isNativeAndroid: boolean;
  isWindows: boolean;
  isLinux: boolean;
  isMac: boolean;
  isContainer: boolean;
  label: string;
}

export interface FilesystemEnvironment {
  owner: 'local_pc' | 'remote_pc' | 'android_native';
  ownerLabel: string;
  workspaceId: string;
  workspaceRoot: string;
  accessible: boolean;
  pathSeparator: string;
  isWindowsPaths: boolean;
}

export interface CapabilitiesEnvironment {
  shell: boolean;
  shellType?: string;
  pty: boolean;
  localAi: boolean;
  arm64: boolean;
  freeMemoryBytes: number;
  totalMemoryBytes: number;
  modelsDirectory: string;
  modelsDirAccessible: boolean;
  modelsCount: number;
  inferenceEngine: string;
}

export interface EnvironmentReport {
  client: ClientEnvironment;
  backend: BackendEnvironment;
  filesystem: FilesystemEnvironment;
  capabilities: CapabilitiesEnvironment;
}

let cachedEnvironment: EnvironmentReport | null = null;
const listeners = new Set<(report: EnvironmentReport) => void>();

export function isAndroidNativeClient(): boolean {
  return (
    typeof window !== 'undefined' &&
    (Boolean((window as any).AndroidApiBridge) || Boolean((window as any).AndroidOverlay))
  );
}

export function isMobileBrowserClient(): boolean {
  if (typeof window === 'undefined') return false;
  if (isAndroidNativeClient()) return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

export function isDesktopClient(): boolean {
  return !isAndroidNativeClient() && !isMobileBrowserClient();
}

export async function getEnvironmentReport(workspaceId?: string): Promise<EnvironmentReport> {
  const wsQuery = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
  const headers: Record<string, string> = {};
  if (isAndroidNativeClient()) {
    headers['x-obsidian-android-native'] = 'true';
  }

  try {
    const res = await fetch(`/api/system/environment${wsQuery}`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: EnvironmentReport = await res.json();
    cachedEnvironment = data;
    listeners.forEach((l) => l(data));
    return data;
  } catch (err) {
    if (cachedEnvironment) return cachedEnvironment;
    // Fallback based on real client discovery:
    const isNative = isAndroidNativeClient();
    const isMobile = isMobileUserAgent();
    const isWin = typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows');

    const fallback: EnvironmentReport = {
      client: {
        platform: isNative ? 'android_native' : isMobile ? 'mobile_browser' : 'desktop_browser',
        isMobile,
        isAndroidNative: isNative,
        label: isNative
          ? 'Android Native App (io.anvil.workstation)'
          : isMobile
          ? 'Mobile Web Browser'
          : 'Desktop Browser (PC)',
      },
      backend: {
        os: isNative ? 'android' : isWin ? 'win32' : 'linux',
        platform: isNative ? 'android' : isWin ? 'win32' : 'linux',
        osName: isNative ? 'Android' : isWin ? 'Windows' : 'Linux',
        arch: isNative ? 'arm64' : 'x64',
        hostname: 'workstation',
        release: '1.0.0',
        isNativeAndroid: isNative,
        isWindows: isWin && !isNative,
        isLinux: isNative,
        isMac: false,
        isContainer: false,
        label: isNative ? 'Android Native Standalone' : isWin ? 'Windows Host PC' : 'Linux Workstation',
      },
      filesystem: {
        owner: isNative ? 'android_native' : isMobile ? 'remote_pc' : 'local_pc',
        ownerLabel: isNative
          ? 'Android App Storage (/data/user/0/...)'
          : isMobile
          ? 'Remote Host PC Storage'
          : 'Local PC Storage',
        workspaceId: workspaceId || 'android-workstation',
        workspaceRoot: isNative ? '/data/user/0/io.anvil.workstation/files/workspaces' : 'workspaces',
        accessible: true,
        pathSeparator: isWin && !isNative ? '\\' : '/',
        isWindowsPaths: isWin && !isNative,
      },
      capabilities: {
        shell: !isNative,
        pty: !isNative,
        localAi: true,
        arm64: isNative,
        freeMemoryBytes: 4 * 1024 * 1024 * 1024,
        totalMemoryBytes: 8 * 1024 * 1024 * 1024,
        modelsDirectory: isNative ? 'models' : '.anvil-data/local-models',
        modelsDirAccessible: true,
        modelsCount: 0,
        inferenceEngine: isNative ? 'On-Device GGUF Engine' : 'node-llama-cpp (Host)',
      },
    };
    cachedEnvironment = fallback;
    return fallback;
  }
}

function isMobileUserAgent(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

export function subscribeEnvironment(callback: (report: EnvironmentReport) => void): () => void {
  listeners.add(callback);
  if (cachedEnvironment) callback(cachedEnvironment);
  return () => {
    listeners.delete(callback);
  };
}
