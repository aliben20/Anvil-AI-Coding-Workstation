import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  Globe,
  Terminal,
  Cpu,
  Server,
  HardDrive,
  RefreshCw,
  Trash2,
  X,
  AlertCircle,
  CheckCircle2,
  Sliders,
  RotateCcw,
  Sun,
  ChevronDown,
  ChevronUp,
  Folder,
  Layers,
  FolderGit2,
  GitBranch,
  FileCode,
  Package,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';
import {
  ToolchainId,
  OptionalToolchainId,
  ToolchainItemState,
  ToolchainManagerStatus,
  ToolchainJobProgress,
  WorkspaceToolchainStatus,
  MobileHarnessBundleSpec,
  MobileHarnessReleaseArtifact,
  MobileHarnessRepoResourceCatalog,
} from '../types';

export function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  if (mb >= 10) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1)} MB`;
}

/**
 * Custom Android Robot Head SVG matching the Mobile Harness screenshot icon (`#4ADE80`).
 */
const AndroidLogoIcon: React.FC<{ className?: string; color?: string }> = ({
  className = 'w-5 h-5',
  color = '#4ADE80',
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85a.637.637 0 00-.83.22l-1.88 3.24a11.463 11.463 0 00-8.94 0L5.65 5.67a.643.643 0 00-.87-.2c-.28.18-.37.54-.22.83L6.4 9.48A10.78 10.78 0 002 18h20a10.78 10.78 0 00-4.4-8.52zM7 15.25a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5zm10 0a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z"
      fill={color}
    />
  </svg>
);

const ToolchainIconBox: React.FC<{
  iconKey: ToolchainItemState['iconKey'];
  accentColor: string;
}> = ({ iconKey, accentColor }) => {
  return (
    <div
      className="w-9 h-9 rounded-[10px] bg-[#1B222D] flex items-center justify-center shrink-0"
      aria-hidden="true"
    >
      {iconKey === 'globe' && (
        <Globe className="w-[19px] h-[19px]" style={{ color: accentColor }} />
      )}
      {iconKey === 'python' && (
        <Terminal className="w-[19px] h-[19px]" style={{ color: accentColor }} />
      )}
      {iconKey === 'android' && (
        <AndroidLogoIcon className="w-[20px] h-[20px]" color={accentColor} />
      )}
      {iconKey === 'cpu' && (
        <Cpu className="w-[19px] h-[19px]" style={{ color: accentColor }} />
      )}
      {iconKey === 'server' && (
        <Server className="w-[19px] h-[19px]" style={{ color: accentColor }} />
      )}
      {(iconKey === 'terminal' || iconKey === 'git' || iconKey === 'node') && (
        <Terminal className="w-[19px] h-[19px]" style={{ color: accentColor }} />
      )}
    </div>
  );
};

interface MobileHarnessToolchainSectionProps {
  defaultOpenChooser?: boolean;
  activeWorkspaceId?: string;
  onSelectWorkspace?: (workspaceId: string) => void;
}

export const MobileHarnessToolchainSection: React.FC<MobileHarnessToolchainSectionProps> = ({
  defaultOpenChooser = false,
  activeWorkspaceId,
  onSelectWorkspace,
}) => {
  const [statusData, setStatusData] = useState<ToolchainManagerStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [chooserOpen, setChooserOpen] = useState<boolean>(defaultOpenChooser);
  const [selectedOptional, setSelectedOptional] = useState<Set<OptionalToolchainId>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmUninstallId, setConfirmUninstallId] = useState<ToolchainId | null>(null);
  const [expandedDetailsId, setExpandedDetailsId] = useState<ToolchainId | null>(null);
  const [verifying, setVerifying] = useState<boolean>(false);
  const [subView, setSubView] = useState<'toolchains' | 'workspaces' | 'repository'>('toolchains');
  const [downloadingAsset, setDownloadingAsset] = useState<string | null>(null);
  const [downloadMessage, setDownloadMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [activatingWorkspaceId, setActivatingWorkspaceId] = useState<string | null>(null);
  const initializedSelectionRef = useRef<boolean>(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);


  const fetchToolchainStatus = async () => {
    try {
      const res = await fetch('/api/toolchains');
      if (!res.ok) return;
      const data: ToolchainManagerStatus = await res.json();
      setStatusData(data);
      if (!initializedSelectionRef.current && Array.isArray(data.selectedOptionalIds)) {
        setSelectedOptional(new Set(data.selectedOptionalIds));
        initializedSelectionRef.current = true;
      }
    } catch {
      // ignore transient error
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchToolchainStatus();

    // Subscribe to real-time SSE stream for live installation progress
    const es = new EventSource('/api/toolchains/stream');
    es.addEventListener('init', (ev) => {
      try {
        const parsed: ToolchainManagerStatus = JSON.parse((ev as MessageEvent).data);
        setStatusData(parsed);
        setLoading(false);
      } catch {
        // ignore
      }
    });

    es.addEventListener('progress', (ev) => {
      try {
        const payload = JSON.parse((ev as MessageEvent).data) as {
          job: ToolchainJobProgress | null;
          status?: ToolchainManagerStatus;
        };
        if (payload.status) {
          setStatusData(payload.status);
        } else if (payload.job) {
          setStatusData((prev) => (prev ? { ...prev, activeJob: payload.job } : prev));
        }
      } catch {
        // ignore
      }
    });

    return () => {
      es.close();
    };
  }, []);

  // Poll while a job is actively running as backup for SSE
  const activeJob = statusData?.activeJob || null;
  const isJobRunning = activeJob?.status === 'running';

  useEffect(() => {
    if (!isJobRunning) return;
    const timer = setInterval(() => {
      fetchToolchainStatus();
    }, 1000);
    return () => clearInterval(timer);
  }, [isJobRunning]);

  useEffect(() => {
    if (isJobRunning && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [activeJob?.terminalLines.length, isJobRunning]);

  const handleToggleOptional = async (id: OptionalToolchainId) => {
    const next = new Set(selectedOptional);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedOptional(next);
    const arr = Array.from(next);
    try {
      await fetch('/api/toolchains/selection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedOptionalIds: arr }),
      });
    } catch {
      // ignore
    }
  };

  const handleInstallMobileHarness = async () => {
    setActionError(null);
    const selectedIds = Array.from(selectedOptional);
    try {
      const res = await fetch('/api/toolchains/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolchainIds: selectedIds }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Failed to start Mobile Harness toolchain installation.');
        return;
      }
      if (data.status) setStatusData(data.status);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Network error starting installation.');
    }
  };

  const handleSingleToolchainAction = async (
    id: ToolchainId,
    action: 'install' | 'update' | 'uninstall'
  ) => {
    setActionError(null);
    setConfirmUninstallId(null);
    try {
      const res = await fetch(`/api/toolchains/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || `Failed to ${action} toolchain.`);
        return;
      }
      if (data.status) setStatusData(data.status);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `Error performing ${action}.`);
    }
  };

  const handleCancelJob = async () => {
    setActionError(null);
    try {
      const res = await fetch('/api/toolchains/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.status) setStatusData(data.status);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Error cancelling installation.');
    }
  };

  const handleRetryLastJob = async () => {
    if (!activeJob) return;
    setActionError(null);
    if (activeJob.operation === 'install' && activeJob.targetIds.length > 1) {
      const optionalTargets = activeJob.targetIds.filter((id) =>
        ['web', 'python', 'android', 'cpp', 'php'].includes(id)
      );
      try {
        const res = await fetch('/api/toolchains/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toolchainIds: optionalTargets }),
        });
        const data = await res.json();
        if (!res.ok) {
          setActionError(data.error || 'Retry failed.');
          return;
        }
        if (data.status) setStatusData(data.status);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Retry network error.');
      }
    } else if (activeJob.targetIds[0]) {
      await handleSingleToolchainAction(activeJob.targetIds[0], activeJob.operation);
    }
  };

  const handleVerifyAll = async () => {
    setVerifying(true);
    setActionError(null);
    try {
      const res = await fetch('/api/toolchains/verify', { method: 'POST' });
      const data = await res.json();
      if (res.ok) setStatusData(data);
    } finally {
      setVerifying(false);
    }
  };

  const handleDownloadAsset = async (params: {
    variant?: 'online' | 'offline';
    bundleId?: string;
  }) => {
    const key = params.variant || params.bundleId || 'asset';
    setDownloadingAsset(key);
    setDownloadMessage(null);
    try {
      const res = await fetch('/api/toolchains/resources/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (!res.ok) {
        setDownloadMessage({ text: data.error || 'Failed to download asset.', ok: false });
      } else {
        setDownloadMessage({
          text: data.message || 'Asset downloaded and verified.',
          ok: Boolean(data.verifiedSha256),
        });
        fetchToolchainStatus();
      }
    } catch (err) {
      setDownloadMessage({
        text: err instanceof Error ? err.message : 'Error downloading asset.',
        ok: false,
      });
    } finally {
      setDownloadingAsset(null);
    }
  };

  const handleInstallMissingForWorkspace = async (wsId: string) => {
    setActionError(null);
    try {
      const res = await fetch(
        `/api/toolchains/workspaces/${encodeURIComponent(wsId)}/install-missing`,
        { method: 'POST' }
      );
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error || 'Failed to start installation for workspace.');
        return;
      }
      if (data.status) setStatusData(data.status);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Error installing workspace dependencies.'
      );
    }
  };

  const handleSwitchWorkspace = async (wsId: string) => {
    setActivatingWorkspaceId(wsId);
    try {
      const res = await fetch(`/api/toolchains/workspaces/${encodeURIComponent(wsId)}/activate`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok && data.fullStatus) {
        setStatusData(data.fullStatus);
        onSelectWorkspace?.(wsId);
      }
    } finally {
      setActivatingWorkspaceId(null);
    }
  };


  const coreToolchains = statusData?.coreToolchains || [];
  const optionalToolchains = statusData?.optionalToolchains || [];
  const diskSpace = statusData?.diskSpace;
  const compatibility = statusData?.compatibility;

  const selectedOptionalSpecs = optionalToolchains.filter((t) =>
    selectedOptional.has(t.id as OptionalToolchainId)
  );
  const selectedDownloadBytes = selectedOptionalSpecs.reduce(
    (sum, t) => sum + t.estimatedDownloadBytes,
    0
  );
  const installedOptionalCount = optionalToolchains.filter(
    (t) => t.status === 'installed'
  ).length;

  // Render Live Installation Progress Card (reused in both Chooser Modal and Settings View)
  const renderLiveJobBanner = () => {
    if (!activeJob || activeJob.status === 'idle') return null;

    const pct = Math.round(Math.max(0, Math.min(1, activeJob.fraction)) * 100);
    const isRunning = activeJob.status === 'running';
    const isFailed = activeJob.status === 'failed';
    const isCancelled = activeJob.status === 'cancelled';
    const isCompleted = activeJob.status === 'completed';

    return (
      <div
        className={`rounded-[16px] border p-4 space-y-3 transition-colors ${
          isFailed
            ? 'bg-[#FF727A]/10 border-[#FF727A]/40'
            : isCancelled
            ? 'bg-[#F4C46A]/10 border-[#F4C46A]/40'
            : isCompleted
            ? 'bg-[#69D69E]/10 border-[#69D69E]/40'
            : 'bg-[#131821] border-[#F28C52]/50'
        }`}
        role="status"
        aria-live="polite"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {isRunning && (
              <RefreshCw className="w-4 h-4 text-[#F28C52] animate-spin shrink-0" />
            )}
            {isCompleted && (
              <CheckCircle2 className="w-4 h-4 text-[#69D69E] shrink-0" />
            )}
            {(isFailed || isCancelled) && (
              <AlertCircle
                className={`w-4 h-4 shrink-0 ${
                  isFailed ? 'text-[#FF727A]' : 'text-[#F4C46A]'
                }`}
              />
            )}
            <span className="text-xs font-semibold text-[#E6EDF3] truncate">
              {isRunning
                ? `${
                    activeJob.operation === 'uninstall'
                      ? 'Uninstalling'
                      : activeJob.operation === 'update'
                      ? 'Updating'
                      : 'Installing'
                  }: ${activeJob.currentComponent}`
                : isCompleted
                ? 'Mobile Harness Toolchain Operation Complete'
                : isCancelled
                ? 'Toolchain Operation Cancelled'
                : 'Toolchain Operation Failed'}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-mono font-bold text-[#F28C52] tabular-nums">
              {pct}%
            </span>
            {isRunning && (
              <button
                type="button"
                onClick={handleCancelJob}
                className="min-h-[32px] px-2.5 py-1 rounded-lg bg-[#FF727A]/20 hover:bg-[#FF727A]/30 border border-[#FF727A]/50 text-[#FF727A] text-xs font-medium flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" />
                <span>Cancel</span>
              </button>
            )}
            {(isFailed || isCancelled) && activeJob.canRetry && (
              <button
                type="button"
                onClick={handleRetryLastJob}
                className="min-h-[32px] px-2.5 py-1 rounded-lg bg-[#F28C52] text-[#241107] hover:opacity-95 text-xs font-semibold flex items-center gap-1"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Retry</span>
              </button>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-2 bg-[#1B222D] rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-200 ${
              isFailed
                ? 'bg-[#FF727A]'
                : isCancelled
                ? 'bg-[#F4C46A]'
                : isCompleted
                ? 'bg-[#69D69E]'
                : 'bg-[#F28C52]'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="text-xs text-[#9AA0A6] font-mono break-words">
          {activeJob.stageMessage}
        </div>

        {activeJob.errorMessage && (isFailed || isCancelled) && (
          <div className="text-xs text-[#FF727A] bg-[#0B0E14] border border-[#FF727A]/30 rounded-lg p-2.5 font-mono break-words">
            {activeJob.errorMessage}
          </div>
        )}

        {/* Live Setup Terminal Output */}
        {activeJob.terminalLines.length > 0 && (
          <div className="bg-[#0B0E14] border border-[#2A3240] rounded-xl p-2.5 max-h-40 overflow-y-auto font-mono text-[11px] text-[#9AA0A6] space-y-1">
            {activeJob.terminalLines.slice(-25).map((line, idx) => (
              <div key={idx} className="leading-relaxed break-all">
                {line}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>
    );
  };

  return (
    <section
      aria-label="Mobile Harness Toolchains & Resources"
      className="bg-[#0E1013] border border-[#272C33] rounded-xl p-4 sm:p-5 space-y-5 min-w-0"
    >
      {/* Top Section Header with Repository Attribution and Global Navigation */}
      <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-[#272C33]">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[#42281D]/60 border border-[#F28C52]/50 flex items-center justify-center shrink-0 mt-0.5">
            <Terminal className="w-5 h-5 text-[#F28C52]" />
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-[#F4F5F6] tracking-tight">
                Mobile Harness Toolchains & Resources
              </h2>
              <span className="text-xs text-[#6E7580]">·</span>
              <a
                href="https://github.com/techjarves/Mobile-Harness"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#161B22] border border-[#30363D] text-[11px] font-mono text-[#F28C52] hover:border-[#F28C52] transition-colors"
                title="View upstream techjarves/Mobile-Harness repository"
              >
                <GitBranch className="w-3 h-3" />
                <span>v1.0.7 (96b1da0)</span>
                <ExternalLink className="w-2.5 h-2.5 opacity-60" />
              </a>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#161B22] border border-[#30363D] text-[11px] font-mono text-[#A0A6AF]">
                <Folder className="w-3 h-3 text-[#8DA8FF]" />
                <span>.anvil-data/mobile-harness</span>
              </span>
            </div>
            <p className="text-xs text-[#A0A6AF] leading-relaxed">
              Shared repository toolchains, multi-workspace dependency isolation, runtime bundles, and upstream Mobile-Harness release assets.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleVerifyAll}
            disabled={verifying || isJobRunning}
            className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#14171B] hover:bg-[#1B1F24] border border-[#272C33] text-xs font-medium text-[#F4F5F6] flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 text-[#8DA8FF] shrink-0 ${
                verifying ? 'animate-spin' : ''
              }`}
            />
            <span>Verify Versions</span>
          </button>

          <button
            type="button"
            onClick={() => setChooserOpen(true)}
            className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-[#F28C52] hover:bg-[#f59a65] text-[#241107] text-xs font-bold flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <Sliders className="w-3.5 h-3.5 shrink-0" />
            <span>Choose Your Tools</span>
          </button>
        </div>
      </div>

      {/* Sub-navigation Switcher (Toolchains, Workspaces, Repository Resources) */}
      <div className="flex flex-wrap items-center gap-1.5 pb-2 border-b border-[#272C33]">
        <button
          type="button"
          onClick={() => setSubView('toolchains')}
          className={`min-h-[34px] px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap ${
            subView === 'toolchains'
              ? 'bg-[#1B1F24] text-[#F28C52] border border-[#F28C52]/40'
              : 'text-[#A0A6AF] hover:text-[#F4F5F6] bg-[#0E1013] border border-transparent'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Toolchains & Runtimes</span>
          <span className="text-[11px] font-mono px-1.5 py-0.2 bg-[#0E1013] rounded text-[#E6EDF3] border border-[#272C33]">
            4 + {installedOptionalCount}/{optionalToolchains.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setSubView('workspaces')}
          className={`min-h-[34px] px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap ${
            subView === 'workspaces'
              ? 'bg-[#1B1F24] text-[#C7FF65] border border-[#C7FF65]/40'
              : 'text-[#A0A6AF] hover:text-[#F4F5F6] bg-[#0E1013] border border-transparent'
          }`}
        >
          <FolderGit2 className="w-3.5 h-3.5" />
          <span>Workspaces Integration</span>
          <span className="text-[11px] font-mono px-1.5 py-0.2 bg-[#0E1013] rounded text-[#E6EDF3] border border-[#272C33]">
            {statusData?.workspaces?.length || 0}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setSubView('repository')}
          className={`min-h-[34px] px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap ${
            subView === 'repository'
              ? 'bg-[#1B1F24] text-[#8DA8FF] border border-[#8DA8FF]/40'
              : 'text-[#A0A6AF] hover:text-[#F4F5F6] bg-[#0E1013] border border-transparent'
          }`}
        >
          <Package className="w-3.5 h-3.5" />
          <span>Repository Resources & Bundles</span>
          <span className="text-[11px] font-mono px-1.5 py-0.2 bg-[#0E1013] rounded text-[#E6EDF3] border border-[#272C33]">
            {statusData?.repositoryResources?.bundles?.length || 0} Bundles
          </span>
        </button>
      </div>

      {/* Disk Space & Host Compatibility Telemetry Bar */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {diskSpace && diskSpace.supported && (
          <div className="p-3.5 rounded-xl bg-[#090A0C] border border-[#272C33] space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-[#F4F5F6] font-medium">
                <HardDrive className="w-4 h-4 text-[#F28C52] shrink-0" />
                <span>Available Disk Space ({diskSpace.mountPoint})</span>
              </div>
              <span className="font-mono text-xs text-[#69D69E] font-semibold tabular-nums">
                {formatStorageBytes(diskSpace.availableBytes)} free
              </span>
            </div>
            <div className="w-full h-1.5 bg-[#1B222D] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#F28C52]"
                style={{ width: `${Math.max(2, diskSpace.usedPercent)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono text-[#A0A6AF] tabular-nums">
              <span>
                Used: {formatStorageBytes(diskSpace.usedBytes)} ({diskSpace.usedPercent}%)
              </span>
              <span>Total: {formatStorageBytes(diskSpace.totalBytes)}</span>
            </div>
          </div>
        )}

        {compatibility && (
          <div className="p-3.5 rounded-xl bg-[#090A0C] border border-[#272C33] space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-[#F4F5F6]">
                Runtime Environment & Package Manager
              </span>
              <span
                className={`font-mono text-[11px] font-semibold ${
                  compatibility.compatible ? 'text-[#69D69E]' : 'text-[#FF727A]'
                }`}
              >
                {compatibility.compatible ? 'Compatible' : 'Unsupported'}
              </span>
            </div>
            <div className="text-[11px] font-mono text-[#A0A6AF] truncate">
              {compatibility.distro} · {compatibility.arch} ·{' '}
              {compatibility.aptAvailable ? 'apt-get ready' : 'apt unavailable'} ·{' '}
              {compatibility.npmAvailable ? 'npm ready' : 'npm unavailable'}
            </div>
            <div className="text-[11px] text-[#6E7580] leading-snug">
              {compatibility.prootNote}
            </div>
          </div>
        )}
      </div>

      {actionError && (
        <div className="p-3 rounded-xl bg-[#FF727A]/10 border border-[#FF727A]/40 text-xs text-[#FF727A] flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="break-words">{actionError}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-[#FF727A] hover:underline text-xs shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {downloadMessage && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-start justify-between gap-2 ${
            downloadMessage.ok
              ? 'bg-[#69D69E]/10 border-[#69D69E]/40 text-[#69D69E]'
              : 'bg-[#FF727A]/10 border-[#FF727A]/40 text-[#FF727A]'
          }`}
        >
          <div className="flex items-start gap-2 min-w-0">
            {downloadMessage.ok ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span className="break-words font-mono text-[11px]">{downloadMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setDownloadMessage(null)}
            className="hover:underline text-xs shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Live Installation Progress */}
      {renderLiveJobBanner()}

      {/* SUBVIEW 1: TOOLCHAINS & RUNTIMES */}
      {subView === 'toolchains' && (
        <div className="space-y-5">
          {/* Core Tools Included */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold tracking-wider uppercase text-[#A0A6AF]">
                Core tools included
              </h3>
              <span className="text-[11px] font-mono text-[#69D69E]">
                Always included · Active in all workspaces
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {coreToolchains.map((core) => (
                <div
                  key={core.id}
                  className="p-3 rounded-xl bg-[#090A0C] border border-[#272C33] flex flex-col justify-between gap-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[#F4F5F6] truncate">
                        {core.title}
                      </div>
                      <div className="text-[11px] text-[#A0A6AF] truncate mt-0.5">
                        {core.subtitle}
                      </div>
                    </div>
                    <Check className="w-4 h-4 text-[#69D69E] shrink-0 mt-0.5" />
                  </div>
                  <div className="text-[11px] font-mono text-[#69D69E] truncate tabular-nums">
                    {core.installedVersion || 'Verified'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Optional Toolchains Management List */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-bold tracking-wider uppercase text-[#A0A6AF]">
                Optional Toolchains
              </h3>
              <button
                type="button"
                onClick={() => setChooserOpen(true)}
                className="text-xs text-[#F28C52] hover:underline font-medium"
              >
                Open “Choose your tools” setup screen →
              </button>
            </div>

            {loading ? (
              <div className="p-6 text-center text-xs text-[#A0A6AF]">
                Probing installed toolchains...
              </div>
            ) : (
              <div className="divide-y divide-[#272C33] border border-[#272C33] rounded-xl bg-[#090A0C] overflow-hidden">
                {optionalToolchains.map((item) => {
                  const isInstalled = item.status === 'installed';
                  const isBusy =
                    item.status === 'installing' ||
                    item.status === 'updating' ||
                    item.status === 'uninstalling';
                  const isFailed = item.status === 'failed';
                  const isSelected = selectedOptional.has(item.id as OptionalToolchainId);
                  const isExpanded = expandedDetailsId === item.id;
                  const currentActiveWs =
                    statusData?.activeWorkspaceId || activeWorkspaceId || '';

                  return (
                    <div key={item.id} className="p-3.5 sm:p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <ToolchainIconBox
                            iconKey={item.iconKey}
                            accentColor={item.accentColor}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-[#F4F5F6]">
                                {item.title}
                              </span>
                              <span className="text-[#6E7580]">·</span>
                              <span
                                className={`text-[11px] font-mono font-semibold ${
                                  isInstalled
                                    ? 'text-[#69D69E]'
                                    : isBusy
                                    ? 'text-[#F28C52]'
                                    : isFailed
                                    ? 'text-[#FF727A]'
                                    : 'text-[#A0A6AF]'
                                }`}
                              >
                                {isInstalled
                                  ? 'Installed'
                                  : item.status === 'installing'
                                  ? 'Installing...'
                                  : item.status === 'updating'
                                  ? 'Updating...'
                                  : item.status === 'uninstalling'
                                  ? 'Uninstalling...'
                                  : isFailed
                                  ? 'Failed'
                                  : isSelected
                                  ? 'Selected (Not Installed)'
                                  : 'Not Installed'}
                              </span>
                              <span className="text-[#6E7580]">·</span>
                              <span className="text-[11px] font-mono text-[#A0A6AF] tabular-nums">
                                ~{formatStorageBytes(item.estimatedDownloadBytes)}
                              </span>
                            </div>
                            <p className="text-xs text-[#A0A6AF] mt-0.5">{item.subtitle}</p>
                            {isInstalled && item.installedVersion && (
                              <div className="text-[11px] font-mono text-[#69D69E] mt-1 truncate">
                                {item.installedVersion}
                              </div>
                            )}
                            {item.lastError && !isInstalled && (
                              <div className="text-[11px] font-mono text-[#FF727A] mt-1 break-words">
                                Last error: {item.lastError}
                              </div>
                            )}

                            {/* Workspaces using this toolchain */}
                            {item.usedByWorkspaces && item.usedByWorkspaces.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-2 border-t border-[#1C2128]">
                                <span className="text-[11px] text-[#6E7580]">
                                  Used by workspaces:
                                </span>
                                {item.usedByWorkspaces.map((ws) => {
                                  const isActive = ws.workspaceId === currentActiveWs;
                                  return (
                                    <button
                                      key={ws.workspaceId}
                                      type="button"
                                      onClick={() => handleSwitchWorkspace(ws.workspaceId)}
                                      className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors border ${
                                        isActive
                                          ? 'bg-[#F28C52]/20 border-[#F28C52] text-[#F28C52] font-semibold'
                                          : 'bg-[#14171B] border-[#272C33] text-[#A0A6AF] hover:text-[#F4F5F6]'
                                      }`}
                                      title={`Switch active context to ${ws.workspaceName}`}
                                    >
                                      {ws.workspaceName}
                                      {ws.isPrimary ? ' (primary)' : ''}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Action Controls per Optional Toolchain */}
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedDetailsId(isExpanded ? null : item.id)
                            }
                            className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#14171B] hover:bg-[#1B1F24] border border-[#272C33] text-xs text-[#A0A6AF] hover:text-[#F4F5F6] flex items-center gap-1"
                          >
                            <span>Details</span>
                            {isExpanded ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </button>

                          {!isInstalled && !isBusy && (
                            <button
                              type="button"
                              disabled={isJobRunning}
                              onClick={() =>
                                handleSingleToolchainAction(item.id, 'install')
                              }
                              className="min-h-[34px] px-3 py-1 rounded-lg bg-[#F28C52] hover:bg-[#f59a65] disabled:opacity-50 text-[#241107] text-xs font-bold flex items-center gap-1.5"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>{isFailed ? 'Retry Install' : 'Install'}</span>
                            </button>
                          )}

                          {isInstalled && !isBusy && (
                            <>
                              <button
                                type="button"
                                disabled={isJobRunning}
                                onClick={() =>
                                  handleSingleToolchainAction(item.id, 'update')
                                }
                                className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#14171B] hover:bg-[#1B1F24] disabled:opacity-50 border border-[#272C33] text-xs font-medium text-[#F4F5F6] flex items-center gap-1"
                              >
                                <RefreshCw className="w-3 h-3 text-[#8DA8FF]" />
                                <span>Update</span>
                              </button>

                              {confirmUninstallId === item.id ? (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleSingleToolchainAction(item.id, 'uninstall')
                                    }
                                    className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#FF727A] text-[#090A0C] text-xs font-bold"
                                  >
                                    Confirm Remove
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmUninstallId(null)}
                                    className="min-h-[34px] px-2 py-1 rounded-lg bg-[#14171B] border border-[#272C33] text-xs text-[#A0A6AF]"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  disabled={isJobRunning}
                                  onClick={() => setConfirmUninstallId(item.id)}
                                  className="min-h-[34px] px-2.5 py-1 rounded-lg bg-[#14171B] hover:bg-[#FF727A]/15 disabled:opacity-50 border border-[#272C33] hover:border-[#FF727A]/40 text-xs font-medium text-[#FF727A] flex items-center gap-1"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  <span>Uninstall</span>
                                </button>
                              )}
                            </>
                          )}

                          {isBusy && (
                            <button
                              type="button"
                              onClick={handleCancelJob}
                              className="min-h-[34px] px-3 py-1 rounded-lg bg-[#FF727A]/20 border border-[#FF727A]/50 text-[#FF727A] text-xs font-medium"
                            >
                              Cancel
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Expanded Binary & Component Inspection */}
                      {isExpanded && (
                        <div className="pt-2 border-t border-[#272C33] space-y-2 text-xs">
                          <div className="text-[#A0A6AF]">
                            <span className="font-semibold text-[#F4F5F6]">Components: </span>
                            {item.components.join(' · ')}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {item.binaries.map((bin) => (
                              <div
                                key={bin.binary}
                                className="p-2 rounded-lg bg-[#0E1013] border border-[#272C33] font-mono text-[11px] flex items-center justify-between gap-2"
                              >
                                <div className="min-w-0">
                                  <div className="text-[#F4F5F6] font-semibold">
                                    $ {bin.command}
                                  </div>
                                  <div className="text-[#A0A6AF] truncate">
                                    {bin.installed
                                      ? bin.version || bin.executablePath
                                      : 'Binary not present on PATH'}
                                  </div>
                                </div>
                                <span
                                  className={`shrink-0 ${
                                    bin.installed ? 'text-[#69D69E]' : 'text-[#6E7580]'
                                  }`}
                                >
                                  {bin.installed ? 'OK' : 'Missing'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUBVIEW 2: WORKSPACES INTEGRATION */}
      {subView === 'workspaces' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-bold tracking-wider uppercase text-[#A0A6AF]">
                Discovered Workspaces & Toolchain Compatibility
              </h3>
              <p className="text-xs text-[#6E7580] mt-0.5">
                Every workspace discovered via OBSIDIAN workspace registry with project-specific dependency isolation and shared host runtime mapping.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="text-[#69D69E]">
                {statusData?.workspaces?.filter((w) => w.satisfied).length || 0} Satisfied
              </span>
              <span className="text-[#6E7580]">·</span>
              <span className="text-[#F28C52]">
                {statusData?.workspaces?.filter((w) => !w.satisfied).length || 0} Missing
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {(statusData?.workspaces || []).map((ws) => {
              const currentActiveWs =
                statusData?.activeWorkspaceId || activeWorkspaceId || '';
              const isActive = ws.workspaceId === currentActiveWs;

              return (
                <div
                  key={ws.workspaceId}
                  className={`p-4 rounded-xl border space-y-3 transition-colors ${
                    isActive
                      ? 'bg-[#131821] border-[#F28C52]/50'
                      : 'bg-[#090A0C] border-[#272C33]'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-[#F4F5F6]">
                          {ws.workspaceName}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-[#14171B] border border-[#272C33] text-[#8DA8FF]">
                          {ws.projectType}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold ${
                            ws.satisfied
                              ? 'bg-[#69D69E]/10 border border-[#69D69E]/30 text-[#69D69E]'
                              : 'bg-[#FF727A]/10 border border-[#FF727A]/30 text-[#FF727A]'
                          }`}
                        >
                          {ws.satisfied
                            ? 'Toolchains Satisfied'
                            : `Missing: ${ws.missingToolchains.join(', ')}`}
                        </span>
                        {isActive && (
                          <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-[#F28C52]/20 border border-[#F28C52]/60 text-[#F28C52] font-semibold">
                            Active Context
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-[#6E7580] truncate">
                        Path: {ws.workspacePath}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {!ws.satisfied && (
                        <button
                          type="button"
                          disabled={isJobRunning}
                          onClick={() => handleInstallMissingForWorkspace(ws.workspaceId)}
                          className="min-h-[34px] px-3 py-1.5 rounded-lg bg-[#F28C52] hover:bg-[#f59a65] disabled:opacity-50 text-[#241107] text-xs font-bold flex items-center gap-1.5"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Install Missing Toolchains</span>
                        </button>
                      )}

                      {!isActive ? (
                        <button
                          type="button"
                          disabled={activatingWorkspaceId === ws.workspaceId}
                          onClick={() => handleSwitchWorkspace(ws.workspaceId)}
                          className="min-h-[34px] px-3 py-1.5 rounded-lg bg-[#14171B] hover:bg-[#1B1F24] border border-[#272C33] text-xs text-[#F4F5F6] flex items-center gap-1.5 font-medium"
                        >
                          <Check className="w-3.5 h-3.5 text-[#C7FF65]" />
                          <span>Switch to Workspace</span>
                        </button>
                      ) : (
                        <span className="text-xs text-[#69D69E] font-medium flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Current</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Resource Ownership & Breakdown */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-2 border-t border-[#1C2128] text-xs">
                    {/* Shared Host Tools */}
                    <div className="p-2.5 rounded-lg bg-[#0E1013] border border-[#272C33] space-y-1.5">
                      <div className="text-[11px] font-semibold text-[#A0A6AF] flex items-center gap-1">
                        <Terminal className="w-3 h-3 text-[#F28C52]" />
                        <span>Shared Host Tools (Reusable across workspaces)</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {ws.sharedHostTools.map((tool) => (
                          <span
                            key={tool.toolchainId}
                            className={`px-2 py-0.5 rounded text-[11px] font-mono border ${
                              tool.installed
                                ? 'bg-[#14171B] border-[#272C33] text-[#69D69E]'
                                : 'bg-[#FF727A]/10 border-[#FF727A]/30 text-[#FF727A]'
                            }`}
                          >
                            {tool.title}: {tool.installed ? tool.version || 'Installed' : 'Missing'}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Isolated Local Dependencies */}
                    <div className="p-2.5 rounded-lg bg-[#0E1013] border border-[#272C33] space-y-1.5">
                      <div className="text-[11px] font-semibold text-[#A0A6AF] flex items-center gap-1">
                        <Folder className="w-3 h-3 text-[#8DA8FF]" />
                        <span>Isolated Workspace Dependencies</span>
                      </div>
                      {ws.isolatedLocalDependencies.length > 0 ? (
                        <div className="space-y-1">
                          {ws.isolatedLocalDependencies.map((dep, idx) => (
                            <div
                              key={idx}
                              className="text-[11px] font-mono text-[#A0A6AF] bg-[#14171B] px-2 py-0.5 rounded border border-[#272C33] flex items-center justify-between"
                            >
                              <span>{dep.details}</span>
                              <span className="text-[#6E7580]">
                                {formatStorageBytes(dep.sizeBytes)}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-[11px] text-[#6E7580] italic">
                          No isolated dependencies installed yet (run package installs inside workspace terminal).
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SUBVIEW 3: REPOSITORY RESOURCES & BUNDLES */}
      {subView === 'repository' && (
        <div className="space-y-5">
          {/* Upstream Repo Card */}
          <div className="p-4 rounded-xl bg-[#090A0C] border border-[#272C33] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-[#F28C52]" />
                <span className="text-sm font-semibold text-[#F4F5F6]">
                  Upstream Repository: techjarves/Mobile-Harness
                </span>
                <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-[#161B22] border border-[#30363D] text-[#69D69E]">
                  Tag: {statusData?.repositoryResources?.tag || 'v1.0.7'}
                </span>
              </div>
              <a
                href="https://github.com/techjarves/Mobile-Harness"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-[#F28C52] hover:underline flex items-center gap-1"
              >
                <span>View on GitHub</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono text-[#A0A6AF]">
              <div className="p-2.5 rounded-lg bg-[#0E1013] border border-[#272C33]">
                <div className="text-[#6E7580] text-[10px] uppercase">Commit Hash</div>
                <div className="text-[#F4F5F6] mt-0.5 truncate">
                  {statusData?.repositoryResources?.commitHash || '96b1da0'}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-[#0E1013] border border-[#272C33]">
                <div className="text-[#6E7580] text-[10px] uppercase">Designated Shared Dir</div>
                <div className="text-[#8DA8FF] mt-0.5 truncate">
                  {statusData?.repositoryResources?.repoDirectory || '.anvil-data/mobile-harness'}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-[#0E1013] border border-[#272C33]">
                <div className="text-[#6E7580] text-[10px] uppercase">Cached Disk Usage</div>
                <div className="text-[#69D69E] mt-0.5">
                  {formatStorageBytes(
                    statusData?.repositoryResources?.totalDiskUsageBytes || 8_800_000
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Runtime Bundles Catalog from dist/runtime-bundles/manifest.json */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold tracking-wider uppercase text-[#A0A6AF]">
                Runtime Bundles Catalog (dist/runtime-bundles/manifest.json)
              </h3>
              <span className="text-[11px] font-mono text-[#8DA8FF]">
                Schema v{statusData?.repositoryResources?.manifestSchemaVersion || 1} ·{' '}
                {statusData?.repositoryResources?.architecture || 'arm64'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(statusData?.repositoryResources?.bundles || []).map((bundle) => (
                <div
                  key={bundle.id}
                  className="p-3.5 rounded-xl bg-[#090A0C] border border-[#272C33] space-y-2.5 flex flex-col justify-between"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[#F4F5F6] uppercase tracking-wide">
                        {bundle.id} (v{bundle.version})
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                          bundle.downloaded && bundle.verifiedChecksum
                            ? 'bg-[#69D69E]/10 border border-[#69D69E]/30 text-[#69D69E]'
                            : 'bg-[#14171B] border border-[#272C33] text-[#A0A6AF]'
                        }`}
                      >
                        {bundle.downloaded && bundle.verifiedChecksum
                          ? 'Verified'
                          : bundle.downloaded
                          ? 'Downloaded'
                          : 'Available'}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-[#8DA8FF] truncate">
                      {bundle.file}
                    </div>
                    <div className="text-[11px] font-mono text-[#6E7580] truncate">
                      SHA256: {bundle.sha256}
                    </div>
                    <div className="text-xs text-[#A0A6AF]">
                      <span className="font-semibold text-[#E6EDF3]">Includes: </span>
                      {bundle.includes.join(', ')}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-[#1C2128] text-xs">
                    <span className="text-[11px] font-mono text-[#A0A6AF]">
                      {formatStorageBytes(bundle.compressedBytes)} compressed /{' '}
                      {formatStorageBytes(bundle.uncompressedBytes)} unpacked
                    </span>
                    <button
                      type="button"
                      disabled={downloadingAsset === bundle.id}
                      onClick={() => handleDownloadAsset({ bundleId: bundle.id })}
                      className="px-2.5 py-1 rounded bg-[#14171B] hover:bg-[#1B1F24] border border-[#272C33] text-xs font-medium text-[#F4F5F6] flex items-center gap-1 transition-colors"
                    >
                      <Download
                        className={`w-3 h-3 text-[#F28C52] ${
                          downloadingAsset === bundle.id ? 'animate-bounce' : ''
                        }`}
                      />
                      <span>
                        {downloadingAsset === bundle.id
                          ? 'Downloading...'
                          : bundle.downloaded
                          ? 'Verify'
                          : 'Download'}
                      </span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Release Artifacts from mobile-harness-update.json */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold tracking-wider uppercase text-[#A0A6AF]">
                Mobile Harness Release Artifacts (mobile-harness-update.json)
              </h3>
              <span className="text-[11px] font-mono text-[#69D69E]">
                v{statusData?.repositoryResources?.releaseVersionName || '1.0.7'} (code{' '}
                {statusData?.repositoryResources?.releaseVersionCode || 8})
              </span>
            </div>

            {statusData?.repositoryResources?.releaseNotes && (
              <div className="p-3 rounded-lg bg-[#090A0C] border border-[#272C33] text-xs text-[#A0A6AF] leading-relaxed">
                <span className="font-semibold text-[#F4F5F6]">Release Notes: </span>
                {statusData.repositoryResources.releaseNotes}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(statusData?.repositoryResources?.releaseArtifacts || []).map((art) => (
                <div
                  key={art.variant}
                  className="p-3.5 rounded-xl bg-[#090A0C] border border-[#272C33] space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[#F4F5F6] uppercase">
                      {art.variant} APK
                    </span>
                    <span className="text-xs font-mono text-[#69D69E]">
                      {formatStorageBytes(art.sizeBytes)}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-[#6E7580] truncate">
                    SHA256: {art.sha256}
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <span
                      className={`text-[11px] font-mono ${
                        art.downloaded && art.verifiedChecksum
                          ? 'text-[#69D69E]'
                          : 'text-[#A0A6AF]'
                      }`}
                    >
                      {art.downloaded && art.verifiedChecksum
                        ? 'Cached & Verified'
                        : art.downloaded
                        ? 'Downloaded'
                        : 'Ready to Download'}
                    </span>
                    <button
                      type="button"
                      disabled={downloadingAsset === art.variant}
                      onClick={() => handleDownloadAsset({ variant: art.variant })}
                      className="px-2.5 py-1 rounded bg-[#14171B] hover:bg-[#1B1F24] border border-[#272C33] text-xs font-medium text-[#F4F5F6] flex items-center gap-1 transition-colors"
                    >
                      <Download
                        className={`w-3 h-3 text-[#F28C52] ${
                          downloadingAsset === art.variant ? 'animate-bounce' : ''
                        }`}
                      />
                      <span>
                        {downloadingAsset === art.variant
                          ? 'Downloading...'
                          : art.downloaded
                          ? 'Verify Checksum'
                          : 'Download & Verify'}
                      </span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Repository Scripts (scripts/runtime-bundles/) */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-bold tracking-wider uppercase text-[#A0A6AF]">
              Repository Scripts & Packaging Tools (scripts/runtime-bundles/)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {(statusData?.repositoryResources?.scripts || []).map((script) => (
                <div
                  key={script.name}
                  className="p-3 rounded-xl bg-[#090A0C] border border-[#272C33] space-y-1.5 font-mono text-[11px]"
                >
                  <div className="text-[#8DA8FF] font-semibold truncate flex items-center gap-1">
                    <FileCode className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{script.name}</span>
                  </div>
                  <div className="text-[11px] text-[#A0A6AF] line-clamp-2 font-sans">
                    {script.description}
                  </div>
                  <div className="text-[10px] text-[#6E7580] pt-1">
                    {script.executable ? 'Executable (chmod +x)' : 'Script'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}



      {/* =====================================================================
          MOBILE HARNESS "CHOOSE YOUR TOOLS" SETUP SCREEN MODAL
          Matches https://i.ibb.co/60746Jq4/setup-toolchains.png
      ===================================================================== */}
      {chooserOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-0 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile Harness Toolchain Setup"
        >
          <div className="w-full max-w-[430px] min-h-[100dvh] sm:min-h-0 sm:max-h-[92vh] bg-[#0B0E14] text-[#E6EDF3] sm:rounded-[28px] sm:border sm:border-[#2A3240] shadow-2xl flex flex-col overflow-hidden">
            {/* Top Mobile Harness App Bar */}
            <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => setChooserOpen(false)}
                  aria-label="Back to Settings"
                  className="min-h-[40px] min-w-[40px] -ml-1 rounded-xl flex items-center justify-center text-[#E6EDF3] hover:bg-[#131821] transition-colors"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>

                <div className="w-9 h-9 rounded-[11px] bg-[#261914] border border-[#6E3B22] flex items-center justify-center shrink-0">
                  <Terminal className="w-4 h-4 text-[#F28C52]" />
                </div>

                <span className="text-[19px] font-bold tracking-tight text-[#E6EDF3] truncate">
                  Mobile Harness
                </span>
              </div>

              <button
                type="button"
                onClick={handleVerifyAll}
                title="Refresh toolchain verification"
                aria-label="Refresh toolchain verification"
                className="min-h-[40px] min-w-[40px] rounded-xl flex items-center justify-center text-[#9AA0A6] hover:text-[#E6EDF3] hover:bg-[#131821] transition-colors"
              >
                <Sun className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto px-5 pt-2 pb-6 space-y-5">
              {/* Header Kicker, Title & Subtitle */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-bold tracking-[0.09em] uppercase text-[#F28C52]">
                  TOOLCHAIN SETUP
                </div>
                <h2 className="text-[26px] leading-tight font-bold text-[#E6EDF3] tracking-tight">
                  Choose your tools
                </h2>
                <p className="text-[13.5px] text-[#9AA0A6] leading-snug pt-0.5">
                  Start lightweight. You can install more toolchains later from Settings.
                </p>
              </div>

              {/* Core Tools Included Card */}
              <div className="rounded-[18px] bg-[#131821] border border-[#2A3240] px-3.5 py-3.5 flex items-center justify-between gap-3">
                <div className="w-9 h-9 rounded-[10px] bg-[#1B222D] flex items-center justify-center shrink-0">
                  <Terminal className="w-[19px] h-[19px] text-[#F28C52]" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold text-[#E6EDF3]">
                    Core tools included
                  </div>
                  <div className="text-[12px] text-[#9AA0A6] flex flex-wrap items-center gap-x-1.5 gap-y-0.5 mt-0.5">
                    <span>Claude Code</span>
                    <span aria-hidden="true">·</span>
                    <span>Node.js</span>
                    <span aria-hidden="true">·</span>
                    <span>npm</span>
                    <span aria-hidden="true">·</span>
                    <span>Git</span>
                  </div>
                </div>

                <Check className="w-5 h-5 text-[#69D69E] shrink-0" aria-label="Included" />
              </div>

              {/* OPTIONAL TOOLCHAINS Section */}
              <div className="space-y-2.5">
                <div className="text-[11px] font-bold tracking-[0.09em] uppercase text-[#9AA0A6]">
                  OPTIONAL TOOLCHAINS
                </div>

                <div className="rounded-[18px] bg-[#131821] border border-[#2A3240] overflow-hidden">
                  {optionalToolchains.map((stack, index) => {
                    const isSelected = selectedOptional.has(stack.id as OptionalToolchainId);
                    const isVerifiedInstalled = stack.status === 'installed';

                    return (
                      <div key={stack.id}>
                        <label
                          onClick={(e) => {
                            e.preventDefault();
                            handleToggleOptional(stack.id as OptionalToolchainId);
                          }}
                          className={`w-full px-3.5 py-3 flex items-center justify-between gap-3 cursor-pointer select-none transition-colors ${
                            isSelected ? 'bg-[#F28C52]/[0.08]' : 'hover:bg-[#1B222D]/50'
                          }`}
                        >
                          <ToolchainIconBox
                            iconKey={stack.iconKey}
                            accentColor={stack.accentColor}
                          />

                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[13.5px] font-semibold text-[#E6EDF3]">
                                {stack.title}
                              </span>
                              {isVerifiedInstalled && (
                                <span className="text-[10.5px] font-mono text-[#69D69E]">
                                  · Installed
                                </span>
                              )}
                            </div>
                            <div className="text-[11.5px] text-[#9AA0A6] truncate mt-0.5">
                              {stack.subtitle}
                            </div>
                          </div>

                          {/* Real accessible checkbox */}
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() =>
                              handleToggleOptional(stack.id as OptionalToolchainId)
                            }
                            aria-label={stack.title}
                            className="sr-only"
                          />
                          <div
                            role="checkbox"
                            aria-checked={isSelected}
                             aria-label={`Select ${stack.title}`}
                            className={`w-[22px] h-[22px] rounded-[6px] flex items-center justify-center transition-colors shrink-0 ${
                              isSelected
                                ? 'bg-[#F28C52] border-[1.5px] border-[#F28C52] text-[#241107]'
                                : 'bg-transparent border-[1.5px] border-[#333B4A]'
                            }`}
                          >
                            {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                          </div>
                        </label>

                        {index < optionalToolchains.length - 1 && (
                          <div className="ml-[58px] border-t border-[#2A3240]/70" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Selected Components & Storage Summary */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-2 text-[12px] text-[#9AA0A6]">
                  <Server className="w-4 h-4 text-[#9AA0A6] shrink-0" />
                  <span>
                    {selectedOptionalSpecs.length === 0
                      ? 'Core runtime only · smallest download'
                      : `${selectedOptionalSpecs.length} optional toolchain${
                          selectedOptionalSpecs.length > 1 ? 's' : ''
                        } selected · ~${formatStorageBytes(selectedDownloadBytes)} download`}
                  </span>
                </div>

                {selectedOptionalSpecs.length > 0 && (
                  <div className="p-3 rounded-xl bg-[#131821] border border-[#2A3240] text-[11.5px] text-[#9AA0A6] space-y-1">
                    <div className="font-semibold text-[#E6EDF3]">
                      Components to validate & install:
                    </div>
                    {selectedOptionalSpecs.map((s) => (
                      <div key={s.id} className="flex items-center justify-between gap-2">
                        <span className="truncate">
                          {s.title}: {s.components.join(', ')}
                        </span>
                        <span className="font-mono text-[#F28C52] shrink-0 tabular-nums">
                          {formatStorageBytes(s.estimatedDownloadBytes)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {actionError && (
                <div className="p-3 rounded-xl bg-[#FF727A]/15 border border-[#FF727A]/40 text-xs text-[#FF727A]">
                  {actionError}
                </div>
              )}

              {/* Live Installation Progress inside Modal */}
              {renderLiveJobBanner()}

              {/* Primary Bottom Action Button: Install Mobile Harness */}
              <div className="pt-1">
                <button
                  type="button"
                  disabled={isJobRunning || (compatibility ? !compatibility.compatible : false)}
                  onClick={handleInstallMobileHarness}
                  title="Install Mobile Harness toolchain"
                  aria-label="Install Mobile Harness toolchain"
                  className="w-full h-[54px] rounded-[14px] bg-[#F28C52] hover:bg-[#f59a65] active:scale-[0.99] disabled:opacity-50 text-[#241107] font-bold text-[15px] flex items-center justify-center gap-2.5 shadow-lg transition-all"
                >
                  <Download className="w-5 h-5 stroke-[2.2]" />
                  <span>
                    {isJobRunning
                      ? 'Installing Mobile Harness...'
                      : 'Install Mobile Harness'}
                  </span>
                  <ArrowRight className="w-[18px] h-[18px] stroke-[2.2]" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
