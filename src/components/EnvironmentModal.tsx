import React from 'react';
import {
  Monitor,
  Smartphone,
  Server,
  HardDrive,
  Cpu,
  Terminal,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Folder,
  X,
  Layers,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { EnvironmentReport } from '../services/environmentService';

interface EnvironmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: EnvironmentReport | null;
  onRefresh: () => void;
  loading?: boolean;
}

export const EnvironmentModal: React.FC<EnvironmentModalProps> = ({
  isOpen,
  onClose,
  report,
  onRefresh,
  loading = false,
}) => {
  if (!isOpen || !report) return null;

  const isAndroidNative = report.client.isAndroidNative;
  const isMobileBrowser = report.client.isMobile && !isAndroidNative;
  const isDesktop = !report.client.isMobile;

  const isRemoteBackend = report.filesystem.owner === 'remote_pc';

  const freeMemGb = (report.capabilities.freeMemoryBytes / (1024 * 1024 * 1024)).toFixed(1);
  const totalMemGb = (report.capabilities.totalMemoryBytes / (1024 * 1024 * 1024)).toFixed(1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="w-full max-w-2xl bg-[#161B22] border border-[#30363D] rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-[#F0F6FC]"
        role="dialog"
        aria-labelledby="env-modal-title"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#30363D] flex items-center justify-between gap-3 bg-[#0D1117] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#C7FF65]/10 border border-[#C7FF65]/30 flex items-center justify-center text-[#C7FF65]">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 id="env-modal-title" className="text-sm sm:text-base font-bold text-[#F0F6FC]">
                Execution Environment & Runtime Diagnostics
              </h2>
              <p className="text-xs text-[#8B949E]">
                Authoritative breakdown of client hardware, backend host, filesystem owner, and inference.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onRefresh}
              disabled={loading}
              className="p-1.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-[#8B949E] hover:text-[#F0F6FC] transition-colors cursor-pointer"
              title="Refresh environment status"
              aria-label="Refresh environment status"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#C7FF65]' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-[#8B949E] hover:text-[#FF727A] transition-colors cursor-pointer"
              title="Close environment dialog"
              aria-label="Close environment dialog"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Body Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* Architecture Reality Warning / Status Banner */}
          {isMobileBrowser && (
            <div className="p-3.5 rounded-xl bg-[#D29922]/15 border border-[#D29922]/40 text-[#F4C46A] flex items-start gap-2.5 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Mobile Browser Sandbox Notice: </span>
                You are connecting from a mobile web browser to a remote PC backend. All terminal commands, project
                files, and GGUF inference run on the host PC (<span className="font-mono">{report.backend.hostname}</span>
                ), not on this mobile device. Mobile browsers do not grant native Android filesystem access.
              </div>
            </div>
          )}

          {isAndroidNative && (
            <div className="p-3.5 rounded-xl bg-[#238636]/15 border border-[#238636]/40 text-[#72D9A0] flex items-start gap-2.5 text-xs">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Native Android App Runtime: </span>
                Running inside <span className="font-mono">io.anvil.workstation</span> on {report.client.deviceModel || 'Android'}.
                Filesystem access uses Android Scoped Storage and GGUF models can be imported via Storage Access Framework (SAF).
              </div>
            </div>
          )}

          {isDesktop && !isRemoteBackend && (
            <div className="p-3.5 rounded-xl bg-[#58A6FF]/15 border border-[#58A6FF]/40 text-[#79C0FF] flex items-start gap-2.5 text-xs">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Local Desktop Workstation: </span>
                Client and backend execute natively on this {report.backend.osName} PC ({report.backend.hostname}). Full shell PTY and local filesystem acceleration are enabled.
              </div>
            </div>
          )}

          {/* 4 Primary Diagnostic Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* 1. Client Device */}
            <div className="p-3.5 rounded-xl bg-[#0D1117] border border-[#30363D] space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-[#8B949E] font-semibold">
                  {report.client.isMobile ? (
                    <Smartphone className="w-3.5 h-3.5 text-[#C7FF65]" />
                  ) : (
                    <Monitor className="w-3.5 h-3.5 text-[#58A6FF]" />
                  )}
                  <span>1. Client Device</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#21262D] text-[#C7FF65]">
                  {report.client.platform}
                </span>
              </div>
              <div className="text-sm font-bold text-[#F0F6FC]">{report.client.label}</div>
              <div className="text-[11px] text-[#8B949E] space-y-1 font-mono">
                <div>Type: {isAndroidNative ? 'Native Android APK' : isMobileBrowser ? 'Mobile Browser' : 'Desktop Browser'}</div>
                {report.client.deviceModel && <div>Device: {report.client.manufacturer} {report.client.deviceModel}</div>}
                {report.client.androidApiLevel && <div>API Level: Android {report.client.androidApiLevel}</div>}
              </div>
            </div>

            {/* 2. Execution Backend */}
            <div className="p-3.5 rounded-xl bg-[#0D1117] border border-[#30363D] space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-[#8B949E] font-semibold">
                  <Server className="w-3.5 h-3.5 text-[#F4C46A]" />
                  <span>2. Backend Host</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#21262D] text-[#79C0FF]">
                  {report.backend.arch}
                </span>
              </div>
              <div className="text-sm font-bold text-[#F0F6FC]">{report.backend.label}</div>
              <div className="text-[11px] text-[#8B949E] space-y-1 font-mono">
                <div>Hostname: {report.backend.hostname}</div>
                <div>OS Platform: {report.backend.os} ({report.backend.release})</div>
                {report.backend.nodeVersion && <div>Node.js: {report.backend.nodeVersion}</div>}
              </div>
            </div>

            {/* 3. Filesystem Owner & Workspace Root */}
            <div className="p-3.5 rounded-xl bg-[#0D1117] border border-[#30363D] space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-[#8B949E] font-semibold">
                  <HardDrive className="w-3.5 h-3.5 text-[#C7FF65]" />
                  <span>3. Filesystem Storage</span>
                </div>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                    report.filesystem.accessible
                      ? 'bg-[#238636]/20 text-[#72D9A0]'
                      : 'bg-[#DA3633]/20 text-[#FF727A]'
                  }`}
                >
                  {report.filesystem.accessible ? 'Accessible' : 'Restricted'}
                </span>
              </div>
              <div className="text-sm font-bold text-[#F0F6FC]">{report.filesystem.ownerLabel}</div>
              <div className="text-[11px] text-[#8B949E] space-y-1">
                <div className="flex items-center gap-1 text-[#C7FF65] font-mono truncate" title={report.filesystem.workspaceRoot}>
                  <Folder className="w-3 h-3 shrink-0" />
                  <span className="truncate">{report.filesystem.workspaceRoot}</span>
                </div>
                <div className="font-mono text-[10px]">
                  Path separator: &apos;{report.filesystem.pathSeparator}&apos; · {report.filesystem.isWindowsPaths ? 'Windows Drive Paths' : 'POSIX Paths'}
                </div>
              </div>
            </div>

            {/* 4. Local AI Capabilities */}
            <div className="p-3.5 rounded-xl bg-[#0D1117] border border-[#30363D] space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-[#8B949E] font-semibold">
                  <Cpu className="w-3.5 h-3.5 text-[#C7FF65]" />
                  <span>4. Local AI Runtime</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#21262D] text-[#C7FF65]">
                  {report.capabilities.modelsCount} models
                </span>
              </div>
              <div className="text-sm font-bold text-[#F0F6FC]">{report.capabilities.inferenceEngine}</div>
              <div className="text-[11px] text-[#8B949E] space-y-1 font-mono">
                <div>RAM: {freeMemGb} GB free / {totalMemGb} GB total</div>
                <div className="truncate" title={report.capabilities.modelsDirectory}>
                  Dir: {report.capabilities.modelsDirectory}
                </div>
                <div>ARM64 Support: {report.capabilities.arm64 ? 'Yes (Native)' : 'No (x64 Emulation/Host)'}</div>
              </div>
            </div>
          </div>

          {/* Shell & Process Capabilities Section */}
          <div className="p-3.5 rounded-xl bg-[#0D1117] border border-[#30363D] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#8B949E] flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-[#C7FF65]" />
                Shell & Process Execution Capabilities
              </span>
              <span className="text-[10px] font-mono text-[#8B949E]">
                {report.capabilities.shell ? 'Host Process Available' : 'Restricted Sandbox'}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
              <div className="p-2 rounded-lg bg-[#161B22] border border-[#30363D]">
                <div className="text-[10px] text-[#8B949E]">Shell Execution</div>
                <div className={report.capabilities.shell ? 'text-[#72D9A0] font-bold' : 'text-[#FF727A]'}>
                  {report.capabilities.shell ? (report.capabilities.shellType || 'Enabled') : 'Disabled'}
                </div>
              </div>
              <div className="p-2 rounded-lg bg-[#161B22] border border-[#30363D]">
                <div className="text-[10px] text-[#8B949E]">Interactive PTY</div>
                <div className={report.capabilities.pty ? 'text-[#72D9A0] font-bold' : 'text-[#8B949E]'}>
                  {report.capabilities.pty ? 'Active (xterm)' : 'Piped Only'}
                </div>
              </div>
              <div className="p-2 rounded-lg bg-[#161B22] border border-[#30363D]">
                <div className="text-[10px] text-[#8B949E]">GGUF Models Dir</div>
                <div className={report.capabilities.modelsDirAccessible ? 'text-[#72D9A0] font-bold' : 'text-[#FF727A]'}>
                  {report.capabilities.modelsDirAccessible ? 'Mounted' : 'Missing'}
                </div>
              </div>
              <div className="p-2 rounded-lg bg-[#161B22] border border-[#30363D]">
                <div className="text-[10px] text-[#8B949E]">Filesystem Owner</div>
                <div className="text-[#C7FF65] font-bold truncate">
                  {report.filesystem.owner}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#30363D] bg-[#0D1117] flex items-center justify-between text-xs text-[#8B949E]">
          <div>Verified through real OS and backend runtime APIs.</div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-[#F0F6FC] font-medium transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
