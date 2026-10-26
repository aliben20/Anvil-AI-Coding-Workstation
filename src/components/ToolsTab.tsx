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
  Bot,
  Sparkles,
  Smartphone,
  Settings2,
  ExternalLink,
  Shield,
  FileText,
  Info,
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
  AgentToolIntegration,
  AgentIntegrationId,
  IntegrationLifecycleState,
  ToolchainDiagnosticStage,
  ToolchainDiagnosticReport,
} from '../types';

interface ToolsTabProps {
  events: AgentActivityEvent[];
  pendingApprovals: PendingApproval[];
  onApprove: (approvalId: string, approved: boolean) => void;
  permissions: Record<PermissionCategory, PermissionPolicy>;
  onUpdatePermission: (category: PermissionCategory, policy: PermissionPolicy) => void;
  activeWorkspaceId: string;
  defaultSubView?: 'tools' | 'integrations' | 'bundles' | 'mcp';
  onSelectAgentIntegration?: (integrationId: AgentIntegrationId, modelId?: string) => void;
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
  onSelectAgentIntegration,
}) => {
  const [subView, setSubView] = useState<'tools' | 'integrations' | 'bundles' | 'mcp'>(defaultSubView);

  // Sync subView if defaultSubView prop changes
  useEffect(() => {
    setSubView(defaultSubView);
  }, [defaultSubView]);

  // Coding Agents State
  const [integrations, setIntegrations] = useState<AgentToolIntegration[]>([]);
  const [loadingIntegrations, setLoadingIntegrations] = useState(false);
  const [verifyingIntegrationId, setVerifyingIntegrationId] = useState<AgentIntegrationId | null>(null);
  const [installingIntegrationId, setInstallingIntegrationId] = useState<AgentIntegrationId | null>(null);
  const [configuringIntegration, setConfiguringIntegration] = useState<AgentToolIntegration | null>(null);
  const [configHostUrl, setConfigHostUrl] = useState('');
  const [configMode, setConfigMode] = useState<'local' | 'remote_host'>('local');
  const [configApiKey, setConfigApiKey] = useState('');
  const [showConfigApiKey, setShowConfigApiKey] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

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

  // Diagnostic Error Details Modal State
  const [errorModalData, setErrorModalData] = useState<{
    toolId?: string;
    title: string;
    stage: ToolchainDiagnosticStage | string;
    httpStatus?: number | null;
    exceptionType?: string;
    message: string;
    url?: string | null;
    targetPath?: string | null;
    expectedChecksum?: string | null;
    actualChecksum?: string | null;
    requiredBytes?: number | null;
    availableBytes?: number | null;
    timestamp: number;
    canRetry: boolean;
    retryAction?: () => void;
  } | null>(null);
  const [copiedDiagnostics, setCopiedDiagnostics] = useState(false);

  const handleOpenErrorDetails = (tc: ToolchainItemState) => {
    const diag = tc.diagnostic;
    setErrorModalData({
      toolId: tc.id,
      title: `${tc.title} Diagnostic Details`,
      stage: diag?.stage || 'ENVIRONMENT_PROBE',
      httpStatus: diag?.httpStatus,
      exceptionType: diag?.exceptionType || 'InstallationError',
      message:
        diag?.actionableMessage ||
        tc.lastError ||
        'An error occurred during toolchain installation or verification.',
      url: diag?.url,
      targetPath: diag?.targetPath,
      expectedChecksum: diag?.expectedChecksum,
      actualChecksum: diag?.actualChecksum,
      requiredBytes: diag?.requiredBytes,
      availableBytes: diag?.availableBytes,
      timestamp: diag?.timestamp || Date.now(),
      canRetry: true,
      retryAction: () =>
        handleInstallToolchain(tc.id, tc.status === 'updating' ? 'update' : 'install'),
    });
  };

  const handleOpenJobErrorDetails = (job: ToolchainJobProgress) => {
    const diag = job.diagnostic;
    setErrorModalData({
      toolId: job.currentToolchainId || 'toolchain-job',
      title: `Job Failed: ${job.currentComponent || job.currentToolchainId || 'Toolchain Operation'}`,
      stage: diag?.stage || 'JOB_EXECUTION',
      httpStatus: diag?.httpStatus,
      exceptionType: diag?.exceptionType || 'JobExecutionError',
      message:
        job.errorMessage || diag?.actionableMessage || job.stageMessage || 'Toolchain operation failed.',
      url: diag?.url,
      targetPath: diag?.targetPath,
      expectedChecksum: diag?.expectedChecksum,
      actualChecksum: diag?.actualChecksum,
      requiredBytes: diag?.requiredBytes,
      availableBytes: diag?.availableBytes,
      timestamp: diag?.timestamp || job.finishedAtMillis || Date.now(),
      canRetry: job.canRetry,
      retryAction: job.currentToolchainId
        ? () => {
            if (job.operation === 'uninstall') {
              handleUninstallToolchain(job.currentToolchainId!);
            } else {
              handleInstallToolchain(
                job.currentToolchainId!,
                job.operation === 'update' ? 'update' : 'install'
              );
            }
          }
        : undefined,
    });
  };

  const handleDismissError = async (toolId?: string) => {
    if (toolId) {
      try {
        await fetch(`/api/toolchains/${encodeURIComponent(toolId)}/clear-error`, {
          method: 'POST',
        });
      } catch {
        // ignore
      }
      setToolchains((prev) =>
        prev.map((t) =>
          t.id === toolId
            ? { ...t, lastError: null, diagnostic: null, status: 'not_installed' }
            : t
        )
      );
    }
    if (activeJob && activeJob.status === 'failed') {
      setActiveJob((prev) =>
        prev ? { ...prev, status: 'idle', errorMessage: undefined, diagnostic: null } : null
      );
    }
    setErrorModalData(null);
  };

  const handleCopyDiagnostics = () => {
    if (!errorModalData) return;
    const cleanReport = {
      toolId: errorModalData.toolId,
      title: errorModalData.title,
      stage: errorModalData.stage,
      httpStatus: errorModalData.httpStatus,
      exceptionType: errorModalData.exceptionType,
      actionableMessage: errorModalData.message,
      targetPath: errorModalData.targetPath,
      url: errorModalData.url?.replace(/([?&](?:token|key|secret|auth)=)[^&]+/gi, '$1[REDACTED]'),
      expectedChecksum: errorModalData.expectedChecksum,
      actualChecksum: errorModalData.actualChecksum,
      requiredBytes: errorModalData.requiredBytes,
      availableBytes: errorModalData.availableBytes,
      timestamp: new Date(errorModalData.timestamp).toISOString(),
    };
    navigator.clipboard.writeText(JSON.stringify(cleanReport, null, 2));
    setCopiedDiagnostics(true);
    setTimeout(() => setCopiedDiagnostics(false), 2000);
  };

  const handleOpenDocumentation = () => {
    window.open('https://github.com/techjarves/Mobile-Harness', '_blank', 'noopener,noreferrer');
  };

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

  // Load Coding Agent Integrations
  const loadIntegrations = useCallback(async () => {
    setLoadingIntegrations(true);
    try {
      const res = await fetch('/api/integrations');
      const data = await res.json();
      if (Array.isArray(data.integrations)) {
        setIntegrations(data.integrations);
      }
    } catch {
      // transient network error
    } finally {
      setLoadingIntegrations(false);
    }
  }, []);

  const handleVerifyIntegration = async (id: AgentIntegrationId) => {
    setVerifyingIntegrationId(id);
    try {
      const res = await fetch(`/api/integrations/${encodeURIComponent(id)}/verify`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.integration) {
        setIntegrations((prev) =>
          prev.map((item) => (item.id === id ? data.integration : item))
        );
        setBanner({
          type: data.success ? 'ok' : 'err',
          text: data.message || `Verification completed for ${id}.`,
        });
        setTimeout(() => setBanner(null), 4000);
      }
    } catch {
      setBanner({ type: 'err', text: `Failed to verify integration ${id}.` });
    } finally {
      setVerifyingIntegrationId(null);
    }
  };

  const handleInstallIntegration = async (id: AgentIntegrationId) => {
    setInstallingIntegrationId(id);
    try {
      const res = await fetch(`/api/integrations/${encodeURIComponent(id)}/install`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.integration) {
        setIntegrations((prev) =>
          prev.map((item) => (item.id === id ? data.integration : item))
        );
        setBanner({
          type: data.success ? 'ok' : 'err',
          text: data.message || `Installation completed for ${id}.`,
        });
        setTimeout(() => setBanner(null), 4500);
      }
    } catch {
      setBanner({ type: 'err', text: `Failed to install integration ${id}.` });
    } finally {
      setInstallingIntegrationId(null);
    }
  };

  const handleOpenConfigureIntegration = (item: AgentToolIntegration) => {
    setConfiguringIntegration(item);
    setConfigHostUrl(item.hostUrl || '');
    setConfigMode(item.isRemoteHost ? 'remote_host' : 'local');
    setConfigApiKey('');
    setShowConfigApiKey(false);
  };

  const handleSaveIntegrationConfig = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!configuringIntegration) return;
    setSavingConfig(true);
    try {
      const res = await fetch(
        `/api/integrations/${encodeURIComponent(configuringIntegration.id)}/configure`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hostUrl: configHostUrl.trim() || undefined,
            connectionMode: configMode,
            apiKey: configApiKey.trim() || undefined,
          }),
        }
      );
      const data = await res.json();
      if (data.integration) {
        setIntegrations((prev) =>
          prev.map((item) =>
            item.id === data.integration.id ? data.integration : item
          )
        );
        setBanner({
          type: 'ok',
          text: `Configured ${data.integration.name} successfully.`,
        });
        setTimeout(() => setBanner(null), 3500);
      }
      setConfiguringIntegration(null);
    } catch {
      setBanner({ type: 'err', text: 'Failed to update configuration.' });
    } finally {
      setSavingConfig(false);
    }
  };

  useEffect(() => {
    loadToolchains();
    loadBundles();
    loadMcpServers();
    loadIntegrations();
  }, [loadToolchains, loadBundles, loadMcpServers, loadIntegrations]);

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

  const getStateBadge = (state: IntegrationLifecycleState) => {
    switch (state) {
      case 'Ready':
        return {
          bg: 'bg-[#72D9A0]/15 text-[#72D9A0] border-[#72D9A0]/30',
          icon: <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />,
        };
      case 'Installed':
        return {
          bg: 'bg-[#58A6FF]/15 text-[#58A6FF] border-[#58A6FF]/30',
          icon: <Check className="w-3.5 h-3.5 shrink-0" />,
        };
      case 'Installing':
        return {
          bg: 'bg-[#C7FF65]/15 text-[#C7FF65] border-[#C7FF65]/30',
          icon: <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" />,
        };
      case 'Connecting':
        return {
          bg: 'bg-[#E3B341]/15 text-[#E3B341] border-[#E3B341]/30',
          icon: <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" />,
        };
      case 'Authentication required':
        return {
          bg: 'bg-[#DB6D28]/15 text-[#DB6D28] border-[#DB6D28]/30',
          icon: <Lock className="w-3.5 h-3.5 shrink-0" />,
        };
      case 'Failed':
        return {
          bg: 'bg-[#FF727A]/15 text-[#FF727A] border-[#FF727A]/30',
          icon: <XCircle className="w-3.5 h-3.5 shrink-0" />,
        };
      case 'Unsupported on this device':
        return {
          bg: 'bg-[#21262D] text-[#8B949E] border-[#30363D]',
          icon: <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-[#E3B341]" />,
        };
      case 'Not installed':
      default:
        return {
          bg: 'bg-[#21262D] text-[#8B949E] border-[#30363D]',
          icon: <Download className="w-3.5 h-3.5 shrink-0" />,
        };
    }
  };

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
            onClick={() => setSubView('integrations')}
            className={`min-h-[36px] px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all shrink-0 ${
              subView === 'integrations'
                ? 'bg-[#21262D] text-[#C7FF65] shadow-sm'
                : 'text-[#8B949E] hover:text-[#F0F6FC]'
            }`}
          >
            <Bot className="w-4 h-4 shrink-0" />
            <span>Coding Agents</span>
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                subView === 'integrations'
                  ? 'bg-[#C7FF65]/20 text-[#C7FF65]'
                  : 'bg-[#21262D] text-[#8B949E]'
              }`}
            >
              {integrations.filter((i) => i.overallState === 'Ready').length}/{integrations.length || 4}
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
          {subView === 'integrations' && (
            <button
              type="button"
              onClick={() => loadIntegrations()}
              disabled={loadingIntegrations}
              className="min-h-[36px] px-3 py-1.5 rounded-xl bg-[#161B22] border border-[#30363D] text-[#8B949E] hover:text-[#F0F6FC] text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh coding agent integrations"
              aria-label="Refresh coding agent integrations"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingIntegrations ? 'animate-spin text-[#C7FF65]' : ''}`} />
              <span className="hidden sm:inline">Verify All</span>
            </button>
          )}

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

            {/* Active Job Failed Card with interactive touch target & details trigger (Bug B Repair) */}
            {activeJob && activeJob.status === 'failed' && (
              <div
                onClick={() => handleOpenJobErrorDetails(activeJob)}
                role="button"
                tabIndex={0}
                aria-label="View failed installation error details"
                className="p-4 rounded-2xl bg-[#FF727A]/10 border border-[#FF727A]/40 space-y-2.5 transition-all hover:bg-[#FF727A]/15 cursor-pointer animate-in fade-in duration-150"
              >
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-[#FF727A] shrink-0" />
                    <span className="font-bold text-[#F0F6FC]">
                      {activeJob.operation === 'install'
                        ? 'Installation Failed'
                        : activeJob.operation === 'update'
                        ? 'Update Failed'
                        : 'Uninstallation Failed'}
                    </span>
                    <span className="font-mono text-[#8B949E]">{activeJob.currentToolchainId}</span>
                  </div>
                  {activeJob.diagnostic?.stage && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#FF727A]/20 text-[#FF727A] border border-[#FF727A]/30">
                      {activeJob.diagnostic.stage}
                    </span>
                  )}
                </div>

                <div className="text-xs text-[#F0F6FC]/90 font-mono line-clamp-2">
                  {activeJob.errorMessage || activeJob.stageMessage || 'An unexpected error occurred during installation.'}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#FF727A]/20">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenJobErrorDetails(activeJob);
                    }}
                    className="min-h-[44px] px-3.5 py-1.5 rounded-xl bg-[#21262D] hover:bg-[#30363D] text-[#FF727A] font-semibold text-xs flex items-center gap-1.5 border border-[#FF727A]/30 transition-colors cursor-pointer"
                    title="View error diagnostics, HTTP status, and resolution"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>View Error Details</span>
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDismissError(activeJob.currentToolchainId || undefined);
                      }}
                      className="min-h-[44px] px-3.5 py-1.5 rounded-xl bg-[#21262D] hover:bg-[#30363D] text-[#8B949E] hover:text-[#F0F6FC] font-semibold text-xs transition-colors cursor-pointer"
                    >
                      Dismiss
                    </button>
                    {activeJob.currentToolchainId && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (activeJob.operation === 'uninstall') {
                            handleUninstallToolchain(activeJob.currentToolchainId!);
                          } else {
                            handleInstallToolchain(
                              activeJob.currentToolchainId!,
                              activeJob.operation === 'update' ? 'update' : 'install'
                            );
                          }
                        }}
                        className="min-h-[44px] px-4 py-1.5 rounded-xl bg-[#C7FF65] text-[#0D1117] font-bold text-xs flex items-center gap-1.5 hover:bg-[#d6ff85] transition-colors cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Retry</span>
                      </button>
                    )}
                  </div>
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
                        {isFailed ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenErrorDetails(tc);
                            }}
                            title="Tappable: View error details and diagnostics"
                            aria-label={`View error diagnostic details for ${tc.title}`}
                            className="min-h-[44px] px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-[#FF727A]/20 hover:bg-[#FF727A]/30 text-[#FF727A] border border-[#FF727A]/40 transition-colors cursor-pointer"
                          >
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span>Failed · Details</span>
                          </button>
                        ) : (
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 ${
                              isInstalled
                                ? 'bg-[#72D9A0]/15 text-[#72D9A0] border border-[#72D9A0]/30'
                                : isInstalling || isUpdating
                                ? 'bg-[#388BFD]/15 text-[#388BFD] border border-[#388BFD]/30'
                                : 'bg-[#21262D] text-[#8B949E] border border-[#30363D]'
                            }`}
                          >
                            {isInstalled && <CheckCircle2 className="w-3.5 h-3.5" />}
                            {(isInstalling || isUpdating) && <span className="w-2 h-2 rounded-full bg-[#388BFD] animate-pulse" />}
                            <span>{isInstalled ? 'Installed' : isInstalling ? 'Installing...' : isUpdating ? 'Updating...' : 'Available'}</span>
                          </span>
                        )}

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

                    {/* Interactive Error Strip if toolchain has failure (Bug B Repair) */}
                    {tc.lastError && (
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenErrorDetails(tc);
                        }}
                        role="button"
                        tabIndex={0}
                        aria-label={`View diagnostic error details for ${tc.title}`}
                        className="mx-4 mb-3 p-3 rounded-xl bg-[#FF727A]/10 border border-[#FF727A]/30 hover:border-[#FF727A]/60 text-[#FF727A] flex items-center justify-between gap-3 cursor-pointer transition-colors min-h-[44px]"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <AlertTriangle className="w-4 h-4 shrink-0 text-[#FF727A]" />
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-[#F0F6FC] truncate">Installation / Verification Failed</div>
                            <div className="text-[11px] text-[#FF727A] truncate font-mono">{tc.lastError}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 text-xs font-semibold shrink-0 text-[#FF727A]">
                          <span>Inspect</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    )}

                    {/* Expanded Technical Details */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-2 border-t border-[#30363D]/60 bg-[#0D1117] space-y-3 text-xs">
                        <p className="text-[#8B949E] leading-relaxed">{tc.description}</p>

                        {/* Error box if failed */}
                        {tc.lastError && (
                          <div className="p-3.5 rounded-xl bg-[#FF727A]/10 border border-[#FF727A]/30 text-[#FF727A] space-y-2.5">
                            <div className="flex items-center justify-between">
                              <div className="font-bold flex items-center gap-1.5 text-xs text-[#F0F6FC]">
                                <AlertTriangle className="w-4 h-4 text-[#FF727A]" />
                                <span>Toolchain Operation Failed</span>
                              </div>
                              {tc.diagnostic?.stage && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#FF727A]/20 text-[#FF727A]">
                                  {tc.diagnostic.stage}
                                </span>
                              )}
                            </div>
                            <pre className="font-mono text-[11px] whitespace-pre-wrap leading-relaxed text-[#FF727A]">
                              {tc.lastError}
                            </pre>
                            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[#FF727A]/20">
                              <button
                                type="button"
                                onClick={() => handleOpenErrorDetails(tc)}
                                className="min-h-[44px] px-3.5 py-1.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] text-[#FF727A] font-semibold text-xs flex items-center gap-1.5 border border-[#FF727A]/40 cursor-pointer"
                              >
                                <FileText className="w-3.5 h-3.5" />
                                <span>Inspect Diagnostics Modal</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleInstallToolchain(tc.id, 'install')}
                                disabled={isActionBusy || isInstalling}
                                className="min-h-[44px] px-3.5 py-1.5 rounded-lg bg-[#C7FF65] hover:bg-[#d6ff85] font-bold text-xs text-[#0D1117] flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>Retry Installation</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDismissError(tc.id)}
                                className="min-h-[44px] px-3 py-1.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] text-[#8B949E] hover:text-[#F0F6FC] font-semibold text-xs cursor-pointer"
                              >
                                Dismiss Error
                              </button>
                            </div>
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
          VIEW: CODING AGENTS & AI TOOLCHAINS (Mobile Harness, Antigravity, OpenCode, Claude Code)
          ========================================================================= */}
      {subView === 'integrations' && (
        <div className="flex-1 min-h-0 min-w-0 max-w-full overflow-y-auto p-4 sm:p-6 space-y-4">
          <div className="max-w-4xl mx-auto space-y-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-[#F0F6FC] flex items-center gap-2">
                  <Bot className="w-6 h-6 text-[#C7FF65]" />
                  Coding Agents & AI Toolchains
                </h2>
                <p className="text-xs text-[#8B949E] mt-1">
                  Verified autonomous agents, host daemons, and test harnesses. Truthful runtime probing distinguishes ARM64 binaries, PRoot environments, and remote lab hosts.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-lg text-xs font-mono bg-[#161B22] border border-[#30363D] text-[#8B949E]">
                  Host ABI: {compatibility?.platform || 'android'} ({compatibility?.arch || 'arm64-v8a'})
                </span>
              </div>
            </div>

            {/* Loading state */}
            {loadingIntegrations && integrations.length === 0 ? (
              <div className="p-12 text-center text-xs text-[#8B949E] bg-[#161B22] border border-[#30363D] rounded-2xl flex flex-col items-center justify-center gap-3">
                <RefreshCw className="w-6 h-6 animate-spin text-[#C7FF65]" />
                <span>Probing coding agent runtimes & host bridges...</span>
              </div>
            ) : (
              <div className="space-y-4">
                {integrations.map((item) => {
                  const isVerifying = verifyingIntegrationId === item.id;
                  const isInstalling = installingIntegrationId === item.id;
                  const stateBadge = getStateBadge(item.overallState);

                  return (
                    <div
                      key={item.id}
                      className="bg-[#161B22] border border-[#30363D] rounded-2xl p-4 sm:p-5 space-y-3.5 transition-all hover:border-[#30363D]/80"
                    >
                      {/* Top Header Row */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 shadow-inner"
                            style={{
                              backgroundColor: `${item.accentColor}15`,
                              borderColor: `${item.accentColor}40`,
                              color: item.accentColor,
                            }}
                          >
                            {item.id === 'mobile-harness' ? (
                              <Smartphone className="w-5 h-5" />
                            ) : item.id === 'antigravity' ? (
                              <Sparkles className="w-5 h-5" />
                            ) : item.id === 'opencode' ? (
                              <Code2 className="w-5 h-5" />
                            ) : (
                              <Bot className="w-5 h-5" />
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-sm sm:text-base text-[#F0F6FC]">
                                {item.name}
                              </span>
                              {item.installedVersion && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#0D1117] text-[#C7FF65] border border-[#30363D]">
                                  v{item.installedVersion}
                                </span>
                              )}
                              <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider bg-[#21262D] text-[#8B949E]">
                                {item.category.replace('_', ' ')}
                              </span>
                            </div>
                            <p className="text-xs text-[#8B949E] mt-0.5">
                              {item.description}
                            </p>
                          </div>
                        </div>

                        {/* Status Badge */}
                        <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
                          <span
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${stateBadge.bg}`}
                          >
                            {stateBadge.icon}
                            <span>{item.overallState}</span>
                          </span>
                        </div>
                      </div>

                      {/* Capabilities & Mode Badges */}
                      <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
                        <span className="text-[#8B949E] mr-1">Connection:</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#0D1117] border border-[#30363D] text-[#58A6FF]">
                          {item.isRemoteHost ? `Remote: ${item.hostUrl || 'host'}` : 'Local Process'}
                        </span>

                        <span className="text-[#8B949E] mx-1">|</span>
                        <span className="text-[#8B949E] mr-1">Capabilities:</span>
                        {item.capabilities.chat && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] bg-[#C7FF65]/10 text-[#C7FF65] border border-[#C7FF65]/20 font-medium">
                            Chat
                          </span>
                        )}
                        {item.capabilities.streaming && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] bg-[#58A6FF]/10 text-[#58A6FF] border border-[#58A6FF]/20 font-medium">
                            Stream
                          </span>
                        )}
                        {item.capabilities.tools && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] bg-[#E3B341]/10 text-[#E3B341] border border-[#E3B341]/20 font-medium">
                            Tools
                          </span>
                        )}
                        {item.capabilities.terminal && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] bg-[#DB6D28]/10 text-[#DB6D28] border border-[#DB6D28]/20 font-medium">
                            Terminal
                          </span>
                        )}
                        {item.capabilities.workspaceAccess && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] bg-[#BC8CFF]/10 text-[#BC8CFF] border border-[#BC8CFF]/20 font-medium">
                            Workspace
                          </span>
                        )}
                        {item.capabilities.agentExecution && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] bg-[#72D9A0]/10 text-[#72D9A0] border border-[#72D9A0]/20 font-medium">
                            Autonomous Loop
                          </span>
                        )}
                      </div>

                      {/* Technical Specs & Runtime Requirements */}
                      <div className="p-3 rounded-xl bg-[#0D1117] border border-[#30363D]/70 space-y-1.5 text-xs">
                        <div className="flex items-start gap-2">
                          <Cpu className="w-3.5 h-3.5 text-[#8B949E] shrink-0 mt-0.5" />
                          <div>
                            <span className="text-[#8B949E]">Requirements: </span>
                            <span className="text-[#F0F6FC] font-medium">
                              {item.runtimeRequirements}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-start gap-2">
                          <Layers className="w-3.5 h-3.5 text-[#8B949E] shrink-0 mt-0.5" />
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[#8B949E]">Supported Platforms: </span>
                            {item.supportedPlatforms.map((plat) => (
                              <span
                                key={plat}
                                className="px-1.5 py-0.2 rounded text-[10px] bg-[#161B22] text-[#8B949E] border border-[#30363D]"
                              >
                                {plat}
                              </span>
                            ))}
                          </div>
                        </div>
                        {item.availableModels.length > 0 && (
                          <div className="flex items-start gap-2 pt-1 border-t border-[#30363D]/40">
                            <Bot className="w-3.5 h-3.5 text-[#C7FF65] shrink-0 mt-0.5" />
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[#8B949E]">Exposed Models/Profiles: </span>
                              {item.availableModels.map((m) => (
                                <span
                                  key={m.id}
                                  className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#161B22] text-[#C7FF65] border border-[#C7FF65]/30 font-semibold"
                                >
                                  {m.name}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Verification Status Banner */}
                      {item.lastVerificationResult && (
                        <div
                          className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${
                            item.lastVerificationResult.success
                              ? 'bg-[#72D9A0]/10 border-[#72D9A0]/30 text-[#72D9A0]'
                              : 'bg-[#FF727A]/10 border-[#FF727A]/30 text-[#FF727A]'
                          }`}
                        >
                          {item.lastVerificationResult.success ? (
                            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                          )}
                          <div className="flex-1">
                            <div className="font-semibold">
                              {item.lastVerificationResult.message}
                            </div>
                            {item.lastVerificationResult.details && (
                              <div className="text-[11px] opacity-80 mt-1 font-mono break-all">
                                {item.lastVerificationResult.details}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Action Buttons Row */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#30363D]/60">
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Verify Action */}
                          <button
                            type="button"
                            onClick={() => handleVerifyIntegration(item.id)}
                            disabled={isVerifying}
                            className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-[#21262D] hover:bg-[#30363D] text-[#F0F6FC] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 ${isVerifying ? 'animate-spin text-[#C7FF65]' : ''}`}
                            />
                            <span>{isVerifying ? 'Verifying...' : 'Verify'}</span>
                          </button>

                          {/* Configure Action */}
                          <button
                            type="button"
                            onClick={() => handleOpenConfigureIntegration(item)}
                            className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-[#21262D] hover:bg-[#30363D] text-[#F0F6FC] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <Settings2 className="w-3.5 h-3.5 text-[#58A6FF]" />
                            <span>Configure</span>
                          </button>

                          {/* Install / Update Action if supported */}
                          {item.overallState !== 'Unsupported on this device' && (
                            <button
                              type="button"
                              onClick={() => handleInstallIntegration(item.id)}
                              disabled={isInstalling}
                              className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-[#21262D] hover:bg-[#30363D] text-[#F0F6FC] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                            >
                              <Download
                                className={`w-3.5 h-3.5 ${isInstalling ? 'animate-spin text-[#C7FF65]' : 'text-[#C7FF65]'}`}
                              />
                              <span>
                                {isInstalling
                                  ? 'Installing...'
                                  : item.installStatus === 'installed'
                                  ? 'Reinstall'
                                  : 'Install'}
                              </span>
                            </button>
                          )}
                        </div>

                        {/* Select in Chat Button */}
                        {onSelectAgentIntegration && (
                          <button
                            type="button"
                            onClick={() =>
                              onSelectAgentIntegration(
                                item.id,
                                item.availableModels[0]?.id
                              )
                            }
                            disabled={item.overallState === 'Unsupported on this device'}
                            className={`min-h-[38px] px-4 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                              item.overallState === 'Ready'
                                ? 'bg-[#C7FF65] text-[#0D1117] hover:bg-[#d6ff85] shadow-sm'
                                : 'bg-[#21262D] text-[#8B949E] hover:text-[#F0F6FC]'
                            }`}
                          >
                            <Bot className="w-3.5 h-3.5 shrink-0" />
                            <span>Select in Chat</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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
      {/* =========================================================================
          CONFIGURE CODING AGENT INTEGRATION MODAL
          ========================================================================= */}
      {configuringIntegration && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-sm"
            onClick={() => setConfiguringIntegration(null)}
          />
          <div className="relative w-full max-w-md bg-[#161B22] border border-[#30363D] rounded-2xl shadow-2xl p-5 space-y-4 z-10">
            <div className="flex items-center justify-between pb-3 border-b border-[#30363D]">
              <div className="font-semibold text-sm text-[#F0F6FC] flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-[#C7FF65]" />
                <span>Configure {configuringIntegration.name}</span>
              </div>
              <button
                type="button"
                onClick={() => setConfiguringIntegration(null)}
                title="Close modal"
                aria-label="Close modal"
                className="p-1 text-[#8B949E] hover:text-[#F0F6FC] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveIntegrationConfig} className="space-y-3.5 text-xs">
              {/* Host URL Input */}
              <div>
                <label className="block text-[#8B949E] mb-1 font-medium">
                  Host / Lab Bridge URL
                </label>
                <input
                  type="text"
                  value={configHostUrl}
                  onChange={(e) => setConfigHostUrl(e.target.value)}
                  placeholder={
                    configuringIntegration.id === 'mobile-harness'
                      ? 'http://127.0.0.1:8000'
                      : configuringIntegration.id === 'antigravity'
                      ? 'http://localhost:59895'
                      : 'http://127.0.0.1:3000'
                  }
                  className="w-full min-h-[38px] px-3 rounded-xl bg-[#0D1117] border border-[#30363D] text-[#F0F6FC] font-mono focus:border-[#C7FF65] focus:outline-none"
                />
                <p className="text-[10px] text-[#8B949E] mt-1">
                  Connect to a local daemon or remote lab server over the network.
                </p>
              </div>

              {/* Mode Selector */}
              <div>
                <label className="block text-[#8B949E] mb-1 font-medium">Execution Mode</label>
                <select
                  value={configMode}
                  onChange={(e) => setConfigMode(e.target.value as 'local' | 'remote_host')}
                  className="w-full min-h-[38px] px-3 rounded-xl bg-[#0D1117] border border-[#30363D] text-[#F0F6FC] focus:border-[#C7FF65] focus:outline-none"
                >
                  <option value="local">Local Binary / CLI Process</option>
                  <option value="remote_host">Remote Host / Lab Server Bridge</option>
                </select>
              </div>

              {/* API Key Input */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[#8B949E] font-medium">
                    {configuringIntegration.id === 'claude-code'
                      ? 'Anthropic API Key'
                      : configuringIntegration.id === 'antigravity'
                      ? 'Google Gemini API Key'
                      : configuringIntegration.id === 'opencode'
                      ? 'OpenRouter or OpenAI API Key'
                      : 'API / Authentication Token (Optional)'}
                  </label>
                  {configuringIntegration.hasStoredApiKey && (
                    <span className="text-[10px] text-[#72D9A0] font-mono">
                      ✓ Stored in Vault
                    </span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showConfigApiKey ? 'text' : 'password'}
                    value={configApiKey}
                    onChange={(e) => setConfigApiKey(e.target.value)}
                    placeholder={
                      configuringIntegration.hasStoredApiKey
                        ? 'Leave empty to keep existing key'
                        : 'sk-ant-•••• or AIza••••'
                    }
                    className="w-full min-h-[38px] px-3 pr-14 rounded-xl bg-[#0D1117] border border-[#30363D] text-[#F0F6FC] font-mono focus:border-[#C7FF65] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfigApiKey((v) => !v)}
                    className="absolute right-2.5 top-2.5 text-[#8B949E] hover:text-[#F0F6FC] cursor-pointer text-[11px]"
                  >
                    {showConfigApiKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                <p className="text-[10px] text-[#8B949E] mt-1">
                  Stored securely in workstation vault. Never logged or transmitted in cleartext.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#30363D]">
                <button
                  type="button"
                  onClick={() => setConfiguringIntegration(null)}
                  className="min-h-[36px] px-4 rounded-xl bg-[#21262D] text-[#8B949E] hover:text-[#F0F6FC]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingConfig}
                  className="min-h-[36px] px-4 rounded-xl bg-[#C7FF65] text-[#0D1117] font-semibold hover:bg-[#d6ff85] disabled:opacity-50 cursor-pointer"
                >
                  {savingConfig ? 'Saving...' : 'Save & Verify'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          ERROR DETAILS & DIAGNOSTICS MODAL (Bug B Repair)
          ========================================================================= */}
      {errorModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setErrorModalData(null)}
          />
          <div className="relative w-full max-w-lg bg-[#161B22] border border-[#FF727A]/40 rounded-2xl shadow-2xl p-5 sm:p-6 space-y-4 z-10 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-3 border-b border-[#30363D] gap-3">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="w-7 h-7 rounded-lg bg-[#FF727A]/15 border border-[#FF727A]/30 flex items-center justify-center shrink-0">
                    <AlertTriangle className="w-4 h-4 text-[#FF727A]" />
                  </div>
                  <h3 className="font-bold text-sm sm:text-base text-[#F0F6FC] truncate">
                    {errorModalData.title}
                  </h3>
                </div>
                <div className="flex items-center gap-2 flex-wrap text-[11px] font-mono">
                  <span className="px-2 py-0.5 rounded bg-[#FF727A]/20 text-[#FF727A] border border-[#FF727A]/30 font-semibold">
                    Stage: {errorModalData.stage}
                  </span>
                  {errorModalData.httpStatus && (
                    <span className="px-2 py-0.5 rounded bg-[#388BFD]/20 text-[#58A6FF] border border-[#388BFD]/30 font-semibold">
                      HTTP {errorModalData.httpStatus}
                    </span>
                  )}
                  {errorModalData.exceptionType && (
                    <span className="px-2 py-0.5 rounded bg-[#21262D] text-[#8B949E] border border-[#30363D]">
                      {errorModalData.exceptionType}
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setErrorModalData(null)}
                title="Close error details"
                aria-label="Close error details modal"
                className="min-h-[44px] min-w-[44px] p-2 text-[#8B949E] hover:text-[#F0F6FC] rounded-xl bg-[#21262D] hover:bg-[#30363D] flex items-center justify-center cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Actionable Error Message */}
            <div className="p-3.5 rounded-xl bg-[#FF727A]/10 border border-[#FF727A]/30 space-y-1.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#FF727A] flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5" />
                <span>Actionable Diagnosis</span>
              </div>
              <p className="text-xs text-[#F0F6FC] leading-relaxed whitespace-pre-wrap font-mono">
                {errorModalData.message}
              </p>
            </div>

            {/* Diagnostic Metadata breakdown */}
            <div className="p-3.5 rounded-xl bg-[#0D1117] border border-[#30363D] space-y-2 text-xs font-mono">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#8B949E] pb-1 border-b border-[#30363D]/60">
                Diagnostic Metadata
              </div>

              {errorModalData.url && (
                <div className="space-y-0.5">
                  <span className="text-[#8B949E] text-[10px] block">Source URL:</span>
                  <span className="text-[#58A6FF] break-all select-all text-[11px]">
                    {errorModalData.url}
                  </span>
                </div>
              )}

              {errorModalData.targetPath && (
                <div className="space-y-0.5">
                  <span className="text-[#8B949E] text-[10px] block">Destination Path:</span>
                  <span className="text-[#F0F6FC] break-all select-all text-[11px]">
                    {errorModalData.targetPath}
                  </span>
                </div>
              )}

              {errorModalData.expectedChecksum && (
                <div className="space-y-1 pt-1">
                  <div className="space-y-0.5">
                    <span className="text-[#8B949E] text-[10px] block">Expected SHA-256:</span>
                    <span className="text-[#72D9A0] break-all select-all text-[11px]">
                      {errorModalData.expectedChecksum}
                    </span>
                  </div>
                  {errorModalData.actualChecksum && (
                    <div className="space-y-0.5">
                      <span className="text-[#8B949E] text-[10px] block">Actual Received SHA-256:</span>
                      <span className="text-[#FF727A] break-all select-all text-[11px]">
                        {errorModalData.actualChecksum}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {errorModalData.requiredBytes !== undefined && errorModalData.requiredBytes !== null && (
                <div className="flex items-center justify-between text-[11px] pt-1 border-t border-[#30363D]/40">
                  <span className="text-[#8B949E]">Required Space:</span>
                  <span className="text-[#F0F6FC]">
                    {(errorModalData.requiredBytes / (1024 * 1024)).toFixed(1)} MB
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between text-[11px] pt-1 border-t border-[#30363D]/40">
                <span className="text-[#8B949E]">Timestamp:</span>
                <span className="text-[#8B949E]">
                  {new Date(errorModalData.timestamp).toLocaleTimeString()}
                </span>
              </div>
            </div>

            {/* Action Buttons Row */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-3 border-t border-[#30363D]">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyDiagnostics}
                  className="min-h-[44px] px-3.5 rounded-xl bg-[#21262D] hover:bg-[#30363D] text-[#F0F6FC] text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer flex-1 sm:flex-initial"
                  title="Copy redacted diagnostic JSON to clipboard"
                >
                  {copiedDiagnostics ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#72D9A0]" />
                      <span className="text-[#72D9A0]">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Diagnostics</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleOpenDocumentation}
                  className="min-h-[44px] px-3.5 rounded-xl bg-[#21262D] hover:bg-[#30363D] text-[#8B949E] hover:text-[#F0F6FC] text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer flex-1 sm:flex-initial"
                  title="Open Mobile Harness upstream repository & documentation"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Upstream Docs</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleDismissError(errorModalData.toolId)}
                  className="min-h-[44px] px-4 rounded-xl bg-[#21262D] hover:bg-[#30363D] text-[#8B949E] hover:text-[#F0F6FC] text-xs font-semibold transition-colors cursor-pointer flex-1 sm:flex-initial"
                >
                  Dismiss
                </button>

                {errorModalData.canRetry && errorModalData.retryAction && (
                  <button
                    type="button"
                    onClick={() => {
                      const act = errorModalData.retryAction;
                      setErrorModalData(null);
                      act?.();
                    }}
                    disabled={activeJob?.status === 'running'}
                    className="min-h-[44px] px-5 rounded-xl bg-[#C7FF65] hover:bg-[#d6ff85] text-[#0D1117] text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 flex-1 sm:flex-initial"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Retry Download</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
