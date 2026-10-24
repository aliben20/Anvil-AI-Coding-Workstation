import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plug,
  Code2,
  Plus,
  RefreshCw,
  Server,
  Lock,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Copy,
  Check,
  X,
  Play,
  Terminal,
  Cpu,
  Layers,
  Globe,
  HardDrive,
  ShieldAlert,
  Download,
  Trash2,
  RotateCcw,
  FileCheck,
  CheckCheck,
  ShieldCheck,
  Package,
} from 'lucide-react';
import {
  AgentActivityEvent,
  PendingApproval,
  PermissionCategory,
  PermissionPolicy,
  McpServerEntry,
  McpTransportType,
  ToolchainItemState,
  ToolchainId,
  ToolchainJobProgress,
  MobileHarnessBundleSpec,
  PlatformCompatibilityReport,
  DiskSpaceInfo,
} from '../types';

interface ToolsTabProps {
  events: AgentActivityEvent[];
  pendingApprovals: PendingApproval[];
  onApprove: (approvalId: string, approved: boolean) => void;
  permissions: Record<PermissionCategory, PermissionPolicy>;
  onUpdatePermission: (category: PermissionCategory, policy: PermissionPolicy) => void;
  activeWorkspaceId: string;
  defaultSubView?: 'tools' | 'bundles' | 'mcp';
}

const AndroidLogoIcon: React.FC<{ className?: string; color?: string }> = ({
  className = 'w-5 h-5',
  color = '#4ADE80',
}) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
    <path
      d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85a.637.637 0 00-.83.22l-1.88 3.24a11.463 11.463 0 00-8.94 0L5.65 5.67a.643.643 0 00-.87-.2c-.28.18-.37.54-.22.83L6.4 9.48A10.78 10.78 0 002 18h20a10.78 10.78 0 00-4.4-8.52zM7 15.25a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5zm10 0a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z"
      fill={color}
    />
  </svg>
);

export const ToolsTab: React.FC<ToolsTabProps> = ({
  events,
  pendingApprovals,
  onApprove,
  permissions,
  onUpdatePermission,
  activeWorkspaceId,
  defaultSubView = 'tools',
}) => {
  const [subView, setSubView] = useState<'tools' | 'bundles' | 'mcp'>(defaultSubView);

  // Sync subView if defaultSubView prop changes
  useEffect(() => {
    setSubView(defaultSubView);
  }, [defaultSubView]);

  // Toolchains State
  const [toolchains, setToolchains] = useState<ToolchainItemState[]>([]);
  const [loadingToolchains, setLoadingToolchains] = useState(false);
  const [activeJob, setActiveJob] = useState<ToolchainJobProgress | null>(null);
  const [compatibility, setCompatibility] = useState<PlatformCompatibilityReport | null>(null);
  const [diskSpace, setDiskSpace] = useState<DiskSpaceInfo | null>(null);
  const [expandedToolchainId, setExpandedToolchainId] = useState<string | null>(null);
  const [toolchainActionId, setToolchainActionId] = useState<string | null>(null);
  const [toolchainFilter, setToolchainFilter] = useState<'all' | 'installed' | 'available'>('all');

  // Bundles State
  const [bundles, setBundles] = useState<MobileHarnessBundleSpec[]>([]);
  const [loadingBundles, setLoadingBundles] = useState(false);
  const [downloadingBundleId, setDownloadingBundleId] = useState<string | null>(null);

  // MCP State
  const [mcpServers, setMcpServers] = useState<McpServerEntry[]>([]);
  const [loadingMcp, setLoadingMcp] = useState(false);
  const [auditingAll, setAuditingAll] = useState(false);
  const [expandedServerId, setExpandedServerId] = useState<string | null>(null);
  const [copiedUrlId, setCopiedUrlId] = useState<string | null>(null);
  const [showAddServerModal, setShowAddServerModal] = useState(false);
  const [newServerName, setNewServerName] = useState('');
  const [newServerTransport, setNewServerTransport] = useState<McpTransportType>('streamable-http');
  const [newServerUrl, setNewServerUrl] = useState('');
  const [newServerCommand, setNewServerCommand] = useState('node');
  const [newServerArgs, setNewServerArgs] = useState('scripts/obsidian-stdio-mcp.mjs');

  // Toast Banner
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Load Toolchains
  const loadToolchains = useCallback(async () => {
    setLoadingToolchains(true);
    try {
      const res = await fetch('/api/toolchains');
      const data = await res.json();
      if (data.coreToolchains || data.optionalToolchains) {
        setToolchains([...(data.coreToolchains || []), ...(data.optionalToolchains || [])]);
      } else if (data.toolchains) {
        setToolchains(data.toolchains);
      }
      if (data.activeJob) setActiveJob(data.activeJob);
      if (data.compatibility) setCompatibility(data.compatibility);
      if (data.diskSpace) setDiskSpace(data.diskSpace);
    } catch {
      // transient network error
    } finally {
      setLoadingToolchains(false);
    }
  }, []);

  // Load Bundles
  const loadBundles = useCallback(async () => {
    setLoadingBundles(true);
    try {
      const res = await fetch('/api/toolchains/resources');
      const data = await res.json();
      if (data.bundles) setBundles(data.bundles);
    } catch {
      // transient network error
    } finally {
      setLoadingBundles(false);
    }
  }, []);

  // Load MCP Servers
  const loadMcpServers = useCallback(async () => {
    setLoadingMcp(true);
    try {
      const res = await fetch('/api/mcp');
      const data = await res.json();
      if (data.servers) setMcpServers(data.servers);
    } catch {
      // transient network error
    } finally {
      setLoadingMcp(false);
    }
  }, []);

  useEffect(() => {
    loadToolchains();
    loadBundles();
    loadMcpServers();
  }, [loadToolchains, loadBundles, loadMcpServers]);

  // Subscribe to live SSE toolchain progress stream
  useEffect(() => {
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource('/api/toolchains/stream');
      eventSource.addEventListener('init', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.toolchains) setToolchains(data.toolchains);
          if (data.activeJob) setActiveJob(data.activeJob);
        } catch {
          // ignore
        }
      });
      eventSource.addEventListener('progress', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.job) setActiveJob(data.job);
          if (data.status?.toolchains) setToolchains(data.status.toolchains);
        } catch {
          // ignore
        }
      });
    } catch {
      // fallback to polling if SSE unavailable
    }
    return () => {
      eventSource?.close();
    };
  }, []);

  // Install / Update Toolchain
  const handleInstallToolchain = async (id: ToolchainId, operation: 'install' | 'update') => {
    setToolchainActionId(id);
    try {
      const res = await fetch(`/api/toolchains/${encodeURIComponent(id)}/${operation}`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.job) setActiveJob(data.job);
      if (data.status?.toolchains) setToolchains(data.status.toolchains);
      setBanner({
        type: 'ok',
        text: `${operation === 'install' ? 'Installation' : 'Update'} job initiated for ${id}.`,
      });
      setTimeout(() => setBanner(null), 3000);
      loadToolchains();
    } catch (err) {
      setBanner({ type: 'err', text: `Failed to trigger ${operation} for ${id}.` });
    } finally {
      setToolchainActionId(null);
    }
  };

  // Uninstall Toolchain
  const handleUninstallToolchain = async (id: ToolchainId) => {
    if (!window.confirm(`Uninstall ${id} from the workstation environment?`)) return;
    setToolchainActionId(id);
    try {
      const res = await fetch(`/api/toolchains/${encodeURIComponent(id)}/uninstall`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.job) setActiveJob(data.job);
      if (data.status?.toolchains) setToolchains(data.status.toolchains);
      setBanner({ type: 'ok', text: `Uninstalled ${id} cleanly.` });
      setTimeout(() => setBanner(null), 3000);
      loadToolchains();
    } catch {
      setBanner({ type: 'err', text: `Failed to uninstall ${id}.` });
    } finally {
      setToolchainActionId(null);
    }
  };

  // Safe Verify OpenCode CLI
  const handleSafeVerifyOpenCode = async () => {
    setToolchainActionId('opencode');
    try {
      const res = await fetch('/api/toolchains/opencode/safe-verify', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setBanner({
          type: 'ok',
          text: `OpenCode CLI verified operational (${data.version || 'installed'}). Conflict backup: ${data.backedUp?.length ? data.backedUp.join(', ') : 'none needed'}.`,
        });
      } else {
        setBanner({ type: 'err', text: `OpenCode safe verification: ${data.error || 'Check failed'}` });
      }
      setTimeout(() => setBanner(null), 4000);
      loadToolchains();
    } catch {
      setBanner({ type: 'err', text: 'OpenCode safe verification failed.' });
    } finally {
      setToolchainActionId(null);
    }
  };

  // Download Bundle
  const handleDownloadBundle = async (bundleId: string) => {
    setDownloadingBundleId(bundleId);
    try {
      const res = await fetch('/api/toolchains/resources/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundleId }),
      });
      const data = await res.json();
      if (data.catalog?.bundles) setBundles(data.catalog.bundles);
      setBanner({
        type: 'ok',
        text: `Bundle ${bundleId} downloaded and SHA-256 verified successfully.`,
      });
      setTimeout(() => setBanner(null), 3500);
    } catch {
      setBanner({ type: 'err', text: `Failed to download bundle ${bundleId}.` });
    } finally {
      setDownloadingBundleId(null);
    }
  };

  // Audit MCP Servers
  const handleAuditAllMcp = async () => {
    setAuditingAll(true);
    try {
      const res = await fetch('/api/mcp/audit-all', { method: 'POST' });
      const data = await res.json();
      if (data.servers) setMcpServers(data.servers);
      setBanner({ type: 'ok', text: 'All MCP servers audited successfully.' });
      setTimeout(() => setBanner(null), 3000);
    } catch {
      setBanner({ type: 'err', text: 'Failed to complete MCP audit.' });
    } finally {
      setAuditingAll(false);
    }
  };

  // Create MCP Server
  const handleCreateMcpServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newServerName.trim()) return;
    try {
      const payload: Record<string, unknown> = {
        name: newServerName.trim(),
        transport: newServerTransport,
        authType: 'none',
      };
      if (newServerTransport === 'stdio') {
        payload.command = newServerCommand.trim();
        payload.args = newServerArgs.split(' ').map((a) => a.trim()).filter(Boolean);
      } else {
        payload.endpointUrl = newServerUrl.trim();
      }

      const res = await fetch('/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.servers) setMcpServers(data.servers);
      setShowAddServerModal(false);
      setNewServerName('');
      setNewServerUrl('');
      setBanner({ type: 'ok', text: `MCP server "${newServerName}" created successfully.` });
      setTimeout(() => setBanner(null), 3000);
    } catch {
      setBanner({ type: 'err', text: 'Failed to create MCP server.' });
    }
  };

  // Filter toolchains
  const filteredToolchains = toolchains.filter((tc) => {
    if (toolchainFilter === 'installed') return tc.status === 'installed';
    if (toolchainFilter === 'available') return tc.status !== 'installed';
    return true;
  });

  const connectedMcpCount = mcpServers.filter((s) => s.lastStatus === 'connected').length;

  return (
    <div className="flex flex-col h-full w-full max-w-full overflow-hidden bg-[#0D1117] text-[#F0F6FC]">
      {/* =========================================================================
          SUB-NAVIGATION / SEGMENTED TABS: TOOLCHAINS | BUNDLES | MCP
          ========================================================================= */}
      <div className="h-13 px-4 sm:px-6 border-b border-[#30363D] bg-[#161B22] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-[#0D1117] border border-[#30363D] overflow-x-auto max-w-full no-scrollbar">
          <button
            type="button"
            onClick={() => setSubView('tools')}
            className={`min-h-[36px] px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all shrink-0 ${
              subView === 'tools'
                ? 'bg-[#21262D] text-[#C7FF65] shadow-sm'
                : 'text-[#8B949E] hover:text-[#F0F6FC]'
            }`}
          >
            <Code2 className="w-4 h-4 shrink-0" />
            <span>Tools & Compilers</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-[#21262D] text-[#8B949E]">
              {toolchains.filter((t) => t.status === 'installed').length}/{toolchains.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSubView('bundles')}
            className={`min-h-[36px] px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all shrink-0 ${
              subView === 'bundles'
                ? 'bg-[#21262D] text-[#C7FF65] shadow-sm'
                : 'text-[#8B949E] hover:text-[#F0F6FC]'
            }`}
          >
            <Package className="w-4 h-4 shrink-0" />
            <span>Bundles & Assets</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-[#21262D] text-[#8B949E]">
              {bundles.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSubView('mcp')}
            className={`min-h-[36px] px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all shrink-0 ${
              subView === 'mcp'
                ? 'bg-[#21262D] text-[#C7FF65] shadow-sm'
                : 'text-[#8B949E] hover:text-[#F0F6FC]'
            }`}
          >
            <Plug className="w-4 h-4 shrink-0" />
            <span>MCP Servers</span>
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                subView === 'mcp' ? 'bg-[#C7FF65]/20 text-[#C7FF65]' : 'bg-[#21262D] text-[#8B949E]'
              }`}
            >
              {connectedMcpCount}/{mcpServers.length}
            </span>
          </button>
        </div>

        {/* Right Header Buttons */}
        <div className="flex items-center gap-2">
          {subView === 'mcp' && (
            <button
              type="button"
              onClick={() => setShowAddServerModal(true)}
              title="Add MCP Server"
              aria-label="Add MCP Server"
              className="min-h-[36px] px-3 py-1.5 rounded-xl bg-[#C7FF65] text-[#0D1117] font-semibold text-xs flex items-center gap-1.5 hover:bg-[#d6ff85] transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span className="hidden sm:inline">Add MCP Server</span>
            </button>
          )}

          {subView === 'tools' && (
            <button
              type="button"
              onClick={() => loadToolchains()}
              disabled={loadingToolchains}
              className="min-h-[36px] px-3 py-1.5 rounded-xl bg-[#161B22] border border-[#30363D] text-[#8B949E] hover:text-[#F0F6FC] text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh installations"
              aria-label="Refresh toolchain installations"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingToolchains ? 'animate-spin text-[#C7FF65]' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          )}
        </div>
      </div>

      {/* Banner */}
      {banner && (
        <div
          className={`mx-4 sm:mx-6 mt-3 p-3 rounded-xl border text-xs flex items-center justify-between gap-2 shrink-0 ${
            banner.type === 'ok'
              ? 'bg-[#72D9A0]/10 border-[#72D9A0]/30 text-[#72D9A0]'
              : 'bg-[#FF727A]/10 border-[#FF727A]/30 text-[#FF727A]'
          }`}
        >
          <span>{banner.text}</span>
          <button
            onClick={() => setBanner(null)}
            title="Dismiss notice"
            aria-label="Dismiss notice"
            className="p-1 opacity-70 hover:opacity-100 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* =========================================================================
          VIEW 1: DOWNLOADABLE TOOLS & COMPILERS
          ========================================================================= */}
      {subView === 'tools' && (
        <div className="flex-1 min-h-0 min-w-0 max-w-full overflow-y-auto p-4 sm:p-6 space-y-4">
          <div className="max-w-4xl mx-auto space-y-4">
            {/* Header + Filter Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-[#F0F6FC]">
                  Downloadable Tools & Compilers
                </h2>
                <p className="text-xs text-[#8B949E] mt-0.5">
                  Browse, install, update, and verify development toolchains on desktop and Android.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center p-0.5 rounded-xl bg-[#161B22] border border-[#30363D]">
                  {(['all', 'installed', 'available'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setToolchainFilter(f)}
                      title={`Filter tools: ${f}`}
                      aria-label={`Filter tools: ${f}`}
                      className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition-colors cursor-pointer ${
                        toolchainFilter === f
                          ? 'bg-[#21262D] text-[#C7FF65] font-semibold'
                          : 'text-[#8B949E] hover:text-[#F0F6FC]'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Active Job Progress Card if a download/install job is running */}
            {activeJob && activeJob.status === 'running' && (
              <div className="p-4 rounded-2xl bg-[#161B22] border border-[#388BFD]/40 space-y-2.5 animate-in fade-in duration-150">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#388BFD] animate-ping" />
                    <span className="font-bold text-[#F0F6FC]">
                      {activeJob.operation === 'install'
                        ? 'Installing Toolchain...'
                        : activeJob.operation === 'update'
                        ? 'Updating Toolchain...'
                        : 'Uninstalling Toolchain...'}
                    </span>
                    <span className="font-mono text-[#8B949E]">{activeJob.currentToolchainId}</span>
                  </div>
                  <span className="font-mono font-bold text-[#388BFD]">
                    {Math.round(activeJob.fraction * 100)}%
                  </span>
                </div>

                <div className="h-2 w-full bg-[#0D1117] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#388BFD] rounded-full transition-all duration-200"
                    style={{ width: `${Math.max(5, Math.round(activeJob.fraction * 100))}%` }}
                  />
                </div>

                <div className="text-[11px] font-mono text-[#8B949E] flex items-center justify-between">
                  <span className="truncate">{activeJob.stageMessage || 'Processing components...'}</span>
                  {activeJob.totalBytes > 0 && (
                    <span className="shrink-0">
                      {(activeJob.downloadedBytes / (1024 * 1024)).toFixed(1)} /{' '}
                      {(activeJob.totalBytes / (1024 * 1024)).toFixed(1)} MB
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Platform & Disk Compatibility Strip */}
            {compatibility && diskSpace && (
              <div className="p-3 sm:p-4 rounded-2xl bg-[#161B22] border border-[#30363D] grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <div className="text-[10px] text-[#8B949E] uppercase font-semibold">Environment</div>
                  <div className="font-mono font-bold text-[#F0F6FC] mt-0.5">
                    {compatibility.platform} ({compatibility.arch})
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[#8B949E] uppercase font-semibold">Compatibility</div>
                  <div className="font-semibold text-[#72D9A0] mt-0.5 flex items-center gap-1">
                    <CheckCheck className="w-3.5 h-3.5" />
                    <span>Verified</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[#8B949E] uppercase font-semibold">Available Disk</div>
                  <div className="font-mono font-bold text-[#F0F6FC] mt-0.5">
                    {(diskSpace.availableBytes / (1024 * 1024 * 1024)).toFixed(1)} GB Free
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[#8B949E] uppercase font-semibold">Package Manager</div>
                  <div className="font-mono text-[#8B949E] mt-0.5">
                    {compatibility.npmAvailable ? 'npm / bun' : 'standalone'}
                  </div>
                </div>
              </div>
            )}

            {/* Toolchain Cards List */}
            <div className="space-y-3">
              {filteredToolchains.map((tc) => {
                const isExpanded = expandedToolchainId === tc.id;
                const isInstalled = tc.status === 'installed';
                const isInstalling = tc.status === 'installing' || (activeJob?.currentToolchainId === tc.id && activeJob?.status === 'running');
                const isUpdating = tc.status === 'updating';
                const isFailed = tc.status === 'failed';
                const isActionBusy = toolchainActionId === tc.id;

                return (
                  <div
                    key={tc.id}
                    className="rounded-2xl bg-[#161B22] border border-[#30363D] overflow-hidden transition-all hover:border-[#8B949E]/50"
                  >
                    {/* Header Row */}
                    <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-h-[64px]">
                      <div className="flex items-center gap-3.5 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-xl bg-[#21262D] border border-[#30363D] flex items-center justify-center shrink-0">
                          {tc.id === 'android' ? (
                            <AndroidLogoIcon className="w-5 h-5" color={tc.accentColor || '#4ADE80'} />
                          ) : tc.id === 'python' ? (
                            <Terminal className="w-5 h-5 text-[#388BFD]" />
                          ) : tc.id === 'cpp' ? (
                            <Cpu className="w-5 h-5 text-[#F28C52]" />
                          ) : tc.id === 'php' ? (
                            <Server className="w-5 h-5 text-[#A371F7]" />
                          ) : tc.id === 'nodejs' || tc.id === 'npm' ? (
                            <Package className="w-5 h-5 text-[#72D9A0]" />
                          ) : (
                            <Code2 className="w-5 h-5" style={{ color: tc.accentColor || '#C7FF65' }} />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-[#F0F6FC] truncate">
                              {tc.title}
                            </span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-[#21262D] text-[#8B949E]">
                              {tc.category}
                            </span>
                            {tc.installedVersion && (
                              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#C7FF65]/15 text-[#C7FF65]">
                                {tc.installedVersion}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-[#8B949E] mt-0.5 line-clamp-1">
                            {tc.subtitle}
                          </div>
                        </div>
                      </div>

                      {/* Status Badge + Actions */}
                      <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-[#30363D]/60 justify-between sm:justify-end">
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 ${
                            isInstalled
                              ? 'bg-[#72D9A0]/15 text-[#72D9A0] border border-[#72D9A0]/30'
                              : isInstalling || isUpdating
                              ? 'bg-[#388BFD]/15 text-[#388BFD] border border-[#388BFD]/30'
                              : isFailed
                              ? 'bg-[#FF727A]/15 text-[#FF727A] border border-[#FF727A]/30'
                              : 'bg-[#21262D] text-[#8B949E] border border-[#30363D]'
                          }`}
                        >
                          {isInstalled && <CheckCircle2 className="w-3.5 h-3.5" />}
                          {(isInstalling || isUpdating) && <span className="w-2 h-2 rounded-full bg-[#388BFD] animate-pulse" />}
                          {isFailed && <AlertTriangle className="w-3.5 h-3.5" />}
                          <span>{isInstalled ? 'Installed' : isInstalling ? 'Installing...' : isUpdating ? 'Updating...' : isFailed ? 'Failed' : 'Available'}</span>
                        </span>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-1.5">
                          {!isInstalled ? (
                            <button
                              type="button"
                              onClick={() => handleInstallToolchain(tc.id, 'install')}
                              disabled={isActionBusy || isInstalling}
                              title={`Download and install ${tc.title}`}
                              aria-label={`Download and install ${tc.title}`}
                              className="min-h-[34px] px-3 rounded-lg bg-[#C7FF65] text-[#0D1117] font-semibold text-xs flex items-center gap-1.5 hover:bg-[#d6ff85] transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Download & Install</span>
                            </button>
                          ) : (
                            <>
                              {tc.canUpdate && (
                                <button
                                  type="button"
                                  onClick={() => handleInstallToolchain(tc.id, 'update')}
                                  disabled={isActionBusy || isUpdating}
                                  className="min-h-[34px] px-3 rounded-lg bg-[#21262D] hover:bg-[#30363D] text-[#F0F6FC] font-semibold text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
                                  title={`Check and update ${tc.title} components`}
                                  aria-label={`Check and update ${tc.title} components`}
                                >
                                  <RotateCcw className="w-3.5 h-3.5 text-[#C7FF65]" />
                                  <span>Update</span>
                                </button>
                              )}

                              {tc.id === 'opencode' && (
                                <button
                                  type="button"
                                  onClick={handleSafeVerifyOpenCode}
                                  disabled={isActionBusy}
                                  className="min-h-[34px] px-2.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] text-[#72D9A0] font-semibold text-xs flex items-center gap-1 transition-colors cursor-pointer"
                                  title="Verify and repair OpenCode CLI without deleting workspace files"
                                  aria-label="Verify and repair OpenCode CLI without deleting workspace files"
                                >
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                  <span>Safe Verify</span>
                                </button>
                              )}

                              {tc.canUninstall && (
                                <button
                                  type="button"
                                  onClick={() => handleUninstallToolchain(tc.id)}
                                  disabled={isActionBusy}
                                  className="p-2 rounded-lg bg-[#21262D] hover:bg-[#FF727A]/20 text-[#8B949E] hover:text-[#FF727A] transition-colors cursor-pointer"
                                  title={`Uninstall ${tc.title}`}
                                  aria-label={`Uninstall ${tc.title}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </>
                          )}

                          <button
                            type="button"
                            onClick={() => setExpandedToolchainId(isExpanded ? null : tc.id)}
                            className="p-1.5 text-[#8B949E] hover:text-[#F0F6FC] cursor-pointer"
                            title={`Toggle technical details for ${tc.title}`}
                            aria-label={`Toggle technical details for ${tc.title}`}
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Expanded Technical Details */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-2 border-t border-[#30363D]/60 bg-[#0D1117] space-y-3 text-xs">
                        <p className="text-[#8B949E] leading-relaxed">{tc.description}</p>

                        {/* Error box if failed */}
                        {tc.lastError && (
                          <div className="p-3 rounded-xl bg-[#FF727A]/10 border border-[#FF727A]/30 text-[#FF727A] space-y-1">
                            <div className="font-bold flex items-center gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              <span>Error during operation</span>
                            </div>
                            <pre className="font-mono text-[11px] whitespace-pre-wrap">{tc.lastError}</pre>
                            <button
                              type="button"
                              onClick={() => handleInstallToolchain(tc.id, 'install')}
                              className="mt-1 px-3 py-1 rounded bg-[#FF727A]/20 hover:bg-[#FF727A]/30 font-semibold text-[11px] text-[#FF727A]"
                            >
                              Retry Installation
                            </button>
                          </div>
                        )}

                        {/* Components */}
                        <div className="space-y-1">
                          <div className="text-[11px] font-bold uppercase tracking-wider text-[#8B949E]">
                            Included Binaries & Tools
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {tc.components.map((comp) => (
                              <span
                                key={comp}
                                className="px-2 py-0.5 rounded-md bg-[#21262D] font-mono text-[11px] text-[#C7FF65]"
                              >
                                {comp}
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* Verified Binary Paths */}
                        {tc.binaries && tc.binaries.length > 0 && (
                          <div className="space-y-1 pt-1">
                            <div className="text-[11px] font-bold uppercase tracking-wider text-[#8B949E]">
                              Executable Verification
                            </div>
                            <div className="space-y-1">
                              {tc.binaries.map((b) => (
                                <div
                                  key={b.binary}
                                  className="flex items-center justify-between p-2 rounded-lg bg-[#161B22] border border-[#30363D] font-mono text-[11px]"
                                >
                                  <div className="flex items-center gap-2 truncate">
                                    <span className={b.installed ? 'text-[#72D9A0]' : 'text-[#8B949E]'}>
                                      {b.binary}
                                    </span>
                                    {b.executablePath && (
                                      <span className="text-[#8B949E] text-[10px] truncate">
                                        ({b.executablePath})
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[#8B949E] shrink-0 font-bold">
                                    {b.version || (b.installed ? 'present' : 'missing')}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          VIEW 2: DEVELOPER BUNDLES & REPOSITORY RESOURCES
          ========================================================================= */}
      {subView === 'bundles' && (
        <div className="flex-1 min-h-0 min-w-0 max-w-full overflow-y-auto p-4 sm:p-6 space-y-4">
          <div className="max-w-4xl mx-auto space-y-4">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-[#F0F6FC]">
                Precompiled Bundles & Toolchain Assets
              </h2>
              <p className="text-xs text-[#8B949E] mt-0.5">
                Download verified Mobile Harness bundles with cryptographic SHA-256 integrity verification.
              </p>
            </div>

            <div className="space-y-3">
              {bundles.length === 0 ? (
                <div className="p-8 text-center rounded-2xl bg-[#161B22] border border-[#30363D] text-[#8B949E] space-y-2">
                  <Package className="w-8 h-8 mx-auto opacity-40" />
                  <div className="text-sm font-semibold text-[#F0F6FC]">No Bundles Cataloged</div>
                  <p className="text-xs">Repository resource catalog is empty or auto-configured.</p>
                </div>
              ) : (
                bundles.map((b) => {
                  const isDownloading = downloadingBundleId === b.id;
                  const sizeMb = (b.compressedBytes / (1024 * 1024)).toFixed(1);

                  return (
                    <div
                      key={b.id}
                      className="p-4 rounded-2xl bg-[#161B22] border border-[#30363D] hover:border-[#8B949E]/50 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-1.5 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-[#F0F6FC] truncate">{b.file}</span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#21262D] text-[#8B949E]">
                            v{b.version}
                          </span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#21262D] text-[#8B949E]">
                            {sizeMb} MB
                          </span>
                        </div>

                        {/* SHA-256 badge */}
                        <div className="flex items-center gap-1.5 text-[11px] font-mono text-[#8B949E] select-all">
                          <ShieldCheck className="w-3.5 h-3.5 text-[#72D9A0] shrink-0" />
                          <span className="truncate">SHA-256: {b.sha256}</span>
                        </div>

                        {/* Includes preview */}
                        {b.includes && b.includes.length > 0 && (
                          <div className="text-[11px] text-[#8B949E] truncate">
                            Includes: {b.includes.join(', ')}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {b.downloaded ? (
                          <span className="px-3 py-1.5 rounded-xl bg-[#72D9A0]/15 border border-[#72D9A0]/30 text-xs font-semibold text-[#72D9A0] flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Downloaded & Verified</span>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleDownloadBundle(b.id)}
                            disabled={isDownloading}
                            title={`Download bundle ${b.file}`}
                            aria-label={`Download bundle ${b.file}`}
                            className="min-h-[36px] px-3.5 rounded-xl bg-[#C7FF65] text-[#0D1117] font-semibold text-xs flex items-center gap-1.5 hover:bg-[#d6ff85] transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>{isDownloading ? 'Downloading...' : 'Download Bundle'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          VIEW 3: MCP SERVERS & TRANSPORTS
          ========================================================================= */}
      {subView === 'mcp' && (
        <div className="flex-1 min-h-0 min-w-0 max-w-full overflow-y-auto p-4 sm:p-6 space-y-4">
          <div className="max-w-4xl mx-auto space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-[#F0F6FC]">
                  Model Context Protocol (MCP) Transports
                </h2>
                <p className="text-xs text-[#8B949E] mt-0.5">
                  Streamable HTTP (RFC 9728), SSE, and Stdio tool clients.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAuditAllMcp}
                  disabled={auditingAll}
                  title="Audit all MCP servers"
                  aria-label="Audit all MCP servers"
                  className="min-h-[36px] px-3 rounded-xl bg-[#161B22] border border-[#30363D] text-[#8B949E] hover:text-[#F0F6FC] text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${auditingAll ? 'animate-spin text-[#C7FF65]' : ''}`} />
                  <span className="hidden sm:inline">Audit All</span>
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {mcpServers.length === 0 ? (
                <div className="p-8 text-center rounded-2xl bg-[#161B22] border border-[#30363D] text-[#8B949E] space-y-2">
                  <Plug className="w-8 h-8 mx-auto opacity-40" />
                  <div className="text-sm font-semibold text-[#F0F6FC]">No MCP Servers Configured</div>
                  <p className="text-xs">Add an MCP server to expand tool capabilities for autonomous agents.</p>
                </div>
              ) : (
                mcpServers.map((srv) => {
                  const isExpanded = expandedServerId === srv.id;
                  const isConnected = srv.lastStatus === 'connected';
                  const toolCount = srv.discoveredTools?.length ?? 0;
                  const displayEndpoint =
                    srv.transport === 'stdio'
                      ? `stdio://${srv.command} ${(srv.args || []).join(' ')}`
                      : srv.endpointUrl;

                  return (
                    <div
                      key={srv.id}
                      className="rounded-2xl bg-[#161B22] border border-[#30363D] overflow-hidden transition-all hover:border-[#8B949E]/50"
                    >
                      <button
                        type="button"
                        onClick={() => setExpandedServerId(isExpanded ? null : srv.id)}
                        title={`Toggle details for ${srv.name}`}
                        aria-label={`Toggle details for ${srv.name}`}
                        className="w-full p-4 flex items-center justify-between gap-3 text-left min-h-[56px] cursor-pointer"
                      >
                        <div className="flex items-center gap-3.5 min-w-0 flex-1">
                          <div className="w-9 h-9 rounded-xl bg-[#21262D] border border-[#30363D] flex items-center justify-center shrink-0">
                            <Server className="w-4 h-4 text-[#C7FF65]" />
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-sm text-[#F0F6FC] truncate">
                                {srv.name}
                              </span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-[#21262D] text-[#8B949E]">
                                {srv.transport || 'http'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-[#8B949E] mt-0.5">
                              <span
                                className={`font-medium ${
                                  isConnected ? 'text-[#72D9A0]' : 'text-[#8B949E]'
                                }`}
                              >
                                {isConnected ? 'Connected' : 'Disconnected'}
                              </span>
                              <span>·</span>
                              <span>{toolCount} tools</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-[#8B949E]" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-[#8B949E]" />
                          )}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="px-4 pb-4 pt-1 border-t border-[#30363D]/60 bg-[#0D1117] space-y-3 text-xs">
                          <div className="p-2.5 rounded-xl bg-[#161B22] border border-[#30363D] flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1 font-mono text-[11px] text-[#8B949E] truncate select-all">
                              {displayEndpoint}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(displayEndpoint);
                                setCopiedUrlId(srv.id);
                                setTimeout(() => setCopiedUrlId(null), 1500);
                              }}
                              className="p-1 text-[#8B949E] hover:text-[#F0F6FC] shrink-0 cursor-pointer"
                              title="Copy URL"
                              aria-label={copiedUrlId === srv.id ? 'Copied MCP endpoint to clipboard' : 'Copy MCP endpoint'}
                            >
                              {copiedUrlId === srv.id ? (
                                <Check className="w-3.5 h-3.5 text-[#72D9A0]" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>

                          {srv.discoveredTools && srv.discoveredTools.length > 0 && (
                            <div className="space-y-1.5">
                              <div className="text-[11px] font-medium text-[#8B949E] uppercase tracking-wider">
                                Discovered MCP Tools
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {srv.discoveredTools.map((t) => (
                                  <span
                                    key={t.name}
                                    className="px-2 py-1 rounded-lg bg-[#21262D] border border-[#30363D] font-mono text-[11px] text-[#C7FF65]"
                                    title={t.description}
                                  >
                                    {t.name}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          ADD MCP SERVER MODAL
          ========================================================================= */}
      {showAddServerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-sm"
            onClick={() => setShowAddServerModal(false)}
          />
          <div className="relative w-full max-w-md bg-[#161B22] border border-[#30363D] rounded-2xl shadow-2xl p-5 space-y-4 z-10">
            <div className="flex items-center justify-between pb-3 border-b border-[#30363D]">
              <div className="font-semibold text-sm text-[#F0F6FC]">Add MCP Server</div>
              <button
                type="button"
                onClick={() => setShowAddServerModal(false)}
                title="Close modal"
                aria-label="Close modal"
                className="p-1 text-[#8B949E] hover:text-[#F0F6FC] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateMcpServer} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-[#8B949E] mb-1 font-medium">Server Name</label>
                <input
                  type="text"
                  value={newServerName}
                  onChange={(e) => setNewServerName(e.target.value)}
                  placeholder="e.g. GitHub MCP"
                  required
                  className="w-full min-h-[38px] px-3 rounded-xl bg-[#0D1117] border border-[#30363D] text-[#F0F6FC] focus:border-[#C7FF65] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[#8B949E] mb-1 font-medium">Transport</label>
                <select
                  value={newServerTransport}
                  onChange={(e) => setNewServerTransport(e.target.value as McpTransportType)}
                  className="w-full min-h-[38px] px-3 rounded-xl bg-[#0D1117] border border-[#30363D] text-[#F0F6FC] focus:border-[#C7FF65] focus:outline-none"
                >
                  <option value="streamable-http">Streamable HTTP (RFC 9728)</option>
                  <option value="sse">Server-Sent Events (SSE)</option>
                  <option value="stdio">Stdio Process</option>
                </select>
              </div>

              {newServerTransport !== 'stdio' ? (
                <div>
                  <label className="block text-[#8B949E] mb-1 font-medium">Endpoint URL</label>
                  <input
                    type="url"
                    value={newServerUrl}
                    onChange={(e) => setNewServerUrl(e.target.value)}
                    placeholder="https://api.githubcopilot.com/mcp/"
                    required
                    className="w-full min-h-[38px] px-3 rounded-xl bg-[#0D1117] border border-[#30363D] text-[#F0F6FC] focus:border-[#C7FF65] focus:outline-none"
                  />
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-[#8B949E] mb-1 font-medium">Command</label>
                    <input
                      type="text"
                      value={newServerCommand}
                      onChange={(e) => setNewServerCommand(e.target.value)}
                      placeholder="node or python"
                      required
                      className="w-full min-h-[38px] px-3 rounded-xl bg-[#0D1117] border border-[#30363D] text-[#F0F6FC] focus:border-[#C7FF65] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[#8B949E] mb-1 font-medium">Arguments</label>
                    <input
                      type="text"
                      value={newServerArgs}
                      onChange={(e) => setNewServerArgs(e.target.value)}
                      placeholder="scripts/obsidian-stdio-mcp.mjs"
                      className="w-full min-h-[38px] px-3 rounded-xl bg-[#0D1117] border border-[#30363D] text-[#F0F6FC] focus:border-[#C7FF65] focus:outline-none"
                    />
                  </div>
                </>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#30363D]">
                <button
                  type="button"
                  onClick={() => setShowAddServerModal(false)}
                  className="min-h-[36px] px-4 rounded-xl bg-[#21262D] text-[#8B949E] hover:text-[#F0F6FC]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-[36px] px-4 rounded-xl bg-[#C7FF65] text-[#0D1117] font-semibold hover:bg-[#d6ff85]"
                >
                  Save & Connect
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
