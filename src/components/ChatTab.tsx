import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  Square,
  Copy,
  Check,
  Paperclip,
  AlertCircle,
  RotateCcw,
  Terminal as TerminalIcon,
  FolderGit2,
  ChevronRight,
  ChevronDown,
  Clock,
  FileText,
  MessageSquare,
  Code2,
  Image as ImageIcon,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Layers,
  X,
  FileCode,
  HardDrive,
  Download,
  Trash2,
  Plus,
  Cpu,
  PanelLeft,
  PanelLeftClose,
  History,
  Pencil,
  Search,
  Cloud,
  Globe,
  RefreshCw,
  Eye,
  User,
  Play,
  CheckSquare,
  Activity,
  Server,
  Radio,
  ArrowRight,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import {
  Conversation,
  ProviderSummary,
  WorkspaceSummary,
  AgentActivityEvent,
  PendingApproval,
  ToolCallRecord,
  LocalAiModel,
  SubAgentTask,
  SkillDefinition,
} from '../types';
import { ChatMarkdown } from './ChatMarkdown';
import { formatBytes } from '../design/tokens';

export interface ObsidianCrystalLogoProps {
  className?: string;
  withBadge?: boolean;
  cursorColor?: string;
}

export const ObsidianCrystalLogo: React.FC<ObsidianCrystalLogoProps> = ({
  className = 'w-10 h-10',
  withBadge = true,
  cursorColor,
}) => (
  <svg
    viewBox={withBadge ? '0 0 512 512' : '150 70 280 370'}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    role="img"
    aria-label="OBSIDIAN Icon"
  >
    {withBadge && (
      <>
        {/* Sleek Dark Squircle App Icon Surface */}
        <rect width="512" height="512" rx="112" fill="#0E1217" />
        <rect
          width="506"
          height="506"
          x="3"
          y="3"
          rx="110"
          stroke="#21262D"
          strokeWidth="6"
        />
      </>
    )}

    {/* Facet 1: Top-Right Crisp Off-White Highlight */}
    <path
      d="M262,84 L348,162 L275,152 Z"
      fill="#F3F4F6"
    />

    {/* Facet 2: Upper-Left Medium Steel-Slate */}
    <path
      d="M254,84 L267,154 L211,284 L169,162 Z"
      fill="#64748B"
    />

    {/* Facet 3: Main Right Cool Silver-Slate */}
    <path
      d="M274,160 L350,171 L301,357 L215,289 Z"
      fill="#94A3B8"
    />

    {/* Facet 4: Far-Left Vertical Deep Slate */}
    <path
      d="M166,174 L207,292 L166,362 Z"
      fill="#3B4758"
    />

    {/* Facet 5: Bottom-Left Dark Slate */}
    <path
      d="M169,370 L209,299 L244,427 Z"
      fill="#475569"
    />

    {/* Facet 6: Bottom-Right Medium-Dark Slate */}
    <path
      d="M216,298 L298,363 L252,428 Z"
      fill="#5A677A"
    />

    {/* Olive-Sage Terminal Cursor Underscore ("_") */}
    <path
      d="M332,334 H416 V360 H332 Z"
      fill={cursorColor || '#9EC43B'}
      className="transition-colors group-hover:fill-[#C7FF65]"
    />
  </svg>
);

interface ChatTabProps {
  activeConv: Conversation | undefined;
  conversations?: Conversation[];
  onSelectConversation?: (id: string) => void;
  onNewConversation?: () => void;
  onDeleteConversation?: (id: string) => void;
  onUpdateConversationMeta: (
    convId: string,
    patch: {
      title?: string;
      workspaceId?: string;
      providerId?: string;
      modelId?: string;
      agentId?: string;
    }
  ) => void;
  providers: ProviderSummary[];
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string;
  events: AgentActivityEvent[];
  pendingApprovals: PendingApproval[];
  onApproveTool: (approvalId: string, approved: boolean) => void;
  sending: boolean;
  chatError: string | null;
  onDismissError: () => void;
  onSendMessage: (
    text: string,
    attachedFile?: { name: string; content: string } | null,
    enableAgentTools?: boolean,
    options?: { retryLastUserMessage?: boolean }
  ) => void;
  onContinueTask: () => void;
  onRetryToolCall: (toolName: string, args: Record<string, unknown>) => Promise<void>;
  onStopGeneration: () => void;
  maxAgentIterations: number;
  onChangeMaxIterations: (nextMax: number) => void;
  onNavigateToProjects: () => void;
  onNavigateToTerminal: (command?: string) => void;
  onNavigateToProviders: () => void;
  onNavigateToSettings: () => void;
  onNavigateToImages?: () => void;
  onNavigateToPreview?: () => void;
  onNavigateToAgents?: () => void;
  onNavigateToSkills?: () => void;
  subagentTasks?: SubAgentTask[];
  onRefreshTasks?: () => void;
}

interface ConversationDateGroup {
  label: string;
  conversations: Conversation[];
}

function groupConversationsByDate(
  convList: Conversation[],
  searchQuery: string
): ConversationDateGroup[] {
  const filtered = convList.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const titleMatch = (c.title || '').toLowerCase().includes(q);
    const msgMatch = (c.messages || []).some((m) => (m.content || '').toLowerCase().includes(q));
    return titleMatch || msgMatch;
  });

  const sorted = [...filtered].sort(
    (a, b) => (b.updatedAtMillis || b.createdAtMillis || 0) - (a.updatedAtMillis || a.createdAtMillis || 0)
  );

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOf7Days = startOfToday - 7 * 86400000;
  const startOf30Days = startOfToday - 30 * 86400000;

  const today: Conversation[] = [];
  const yesterday: Conversation[] = [];
  const prev7Days: Conversation[] = [];
  const prev30Days: Conversation[] = [];
  const older: Conversation[] = [];

  for (const conv of sorted) {
    const time = conv.updatedAtMillis || conv.createdAtMillis || 0;
    if (time >= startOfToday) {
      today.push(conv);
    } else if (time >= startOfYesterday) {
      yesterday.push(conv);
    } else if (time >= startOf7Days) {
      prev7Days.push(conv);
    } else if (time >= startOf30Days) {
      prev30Days.push(conv);
    } else {
      older.push(conv);
    }
  }

  const groups: ConversationDateGroup[] = [];
  if (today.length > 0) groups.push({ label: 'Today', conversations: today });
  if (yesterday.length > 0) groups.push({ label: 'Yesterday', conversations: yesterday });
  if (prev7Days.length > 0) groups.push({ label: 'Previous 7 Days', conversations: prev7Days });
  if (prev30Days.length > 0) groups.push({ label: 'Previous 30 Days', conversations: prev30Days });
  if (older.length > 0) groups.push({ label: 'Older', conversations: older });

  return groups;
}

export const ChatTab: React.FC<ChatTabProps> = ({
  activeConv,
  conversations,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onUpdateConversationMeta,
  providers,
  workspaces,
  activeWorkspaceId,
  events,
  pendingApprovals,
  onApproveTool,
  sending,
  chatError,
  onDismissError,
  onSendMessage,
  onContinueTask,
  onRetryToolCall,
  onStopGeneration,
  maxAgentIterations,
  onChangeMaxIterations,
  onNavigateToProjects,
  onNavigateToTerminal,
  onNavigateToProviders,
  onNavigateToSettings,
  onNavigateToImages,
  onNavigateToPreview,
  onNavigateToAgents,
  onNavigateToSkills,
  subagentTasks,
  onRefreshTasks,
}) => {
  const [promptInput, setPromptInput] = useState('');
  const [activeMode, setActiveMode] = useState<'Chat Mode' | 'Code Mode' | 'Write Mode'>('Chat Mode');
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showModeDropdown, setShowModeDropdown] = useState(false);

  // Skill inspection preview modal state
  const [previewSkillId, setPreviewSkillId] = useState<string | null>(null);
  const [previewSkillData, setPreviewSkillData] = useState<SkillDefinition | null>(null);
  const [loadingSkillPreview, setLoadingSkillPreview] = useState(false);

  const handleOpenSkillPreview = async (skillId: string) => {
    setPreviewSkillId(skillId);
    setLoadingSkillPreview(true);
    try {
      const url = activeConv?.workspaceId
        ? `/api/skills/${encodeURIComponent(skillId)}?workspaceId=${encodeURIComponent(activeConv.workspaceId)}`
        : `/api/skills/${encodeURIComponent(skillId)}`;
      const res = await fetch(url);
      if (res.ok) {
        const d = await res.json();
        setPreviewSkillData(d.skill || null);
      }
    } catch (err) {
      console.error('Failed to preview skill:', err);
    } finally {
      setLoadingSkillPreview(false);
    }
  };

  // ChatGPT-style Chat Sessions & Historique State
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('obsidian_chat_history_open');
      if (saved !== null) return saved === 'true';
      return window.innerWidth >= 1280; // default open on wide desktop screens
    }
    return true;
  });
  const [historySearch, setHistorySearch] = useState<string>('');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitleText, setEditingTitleText] = useState<string>('');
  const [sessionToDeleteId, setSessionToDeleteId] = useState<string | null>(null);
  const [expandedSequences, setExpandedSequences] = useState<Record<string, boolean>>({});

  const toggleSequence = (id: string) => {
    setExpandedSequences((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Sync isHistoryOpen to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('obsidian_chat_history_open', String(isHistoryOpen));
    } catch {}
  }, [isHistoryOpen]);

  // Global Ctrl+K / Cmd+K to start New Chat
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onNewConversation?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onNewConversation]);

  const handleStartRename = (conv: Conversation, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingSessionId(conv.id);
    setEditingTitleText(conv.title);
  };

  const handleSaveRename = async (convId: string) => {
    const trimmed = editingTitleText.trim();
    if (trimmed && onUpdateConversationMeta) {
      await onUpdateConversationMeta(convId, { title: trimmed });
    }
    setEditingSessionId(null);
  };

  const handleDeleteSession = async (convId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (onDeleteConversation) {
      await onDeleteConversation(convId);
    }
    setSessionToDeleteId(null);
  };
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [attachedFileInfo, setAttachedFileInfo] = useState<{ name: string; content: string } | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<Array<{ relativePath: string; sizeBytes: number }>>([]);
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);

  const [localModels, setLocalModels] = useState<LocalAiModel[]>([]);
  const [freeHostRamBytes, setFreeHostRamBytes] = useState<number>(0);
  const [loadingLocalModels, setLoadingLocalModels] = useState(false);
  const [installingModelId, setInstallingModelId] = useState<string | null>(null);
  const [modelSelectorTab, setModelSelectorTab] = useState<'antigravity' | 'local' | 'cloud'>('antigravity');
  const [showImportForm, setShowImportForm] = useState(false);
  const [importFilePath, setImportFilePath] = useState('');
  const [importCustomName, setImportCustomName] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [selectedCloudProviderId, setSelectedCloudProviderId] = useState<string>(
    activeConv?.providerId && activeConv.providerId !== 'local-ai'
      ? activeConv.providerId
      : 'antigravity'
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Top Header Drawers & Panels
  const [showMcpModal, setShowMcpModal] = useState<boolean>(false);
  const [showTasksDrawer, setShowTasksDrawer] = useState<boolean>(false);

  // MCP Management State
  const [mcpServers, setMcpServers] = useState<any[]>([]);
  const [mcpLoading, setMcpLoading] = useState<boolean>(false);
  const [mcpAuditing, setMcpAuditing] = useState<boolean>(false);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [showAddMcpForm, setShowAddMcpForm] = useState<boolean>(false);
  const [newMcpName, setNewMcpName] = useState<string>('');
  const [newMcpTransport, setNewMcpTransport] = useState<'streamable-http' | 'stdio' | 'sse'>('streamable-http');
  const [newMcpUrl, setNewMcpUrl] = useState<string>('http://localhost:3000/api/mcp-loopback');
  const [newMcpCommand, setNewMcpCommand] = useState<string>('');
  const [newMcpArgs, setNewMcpArgs] = useState<string>('');
  const [expandedMcpServerId, setExpandedMcpServerId] = useState<string | null>(null);

  // Subagents & Tasks State
  const [internalTasks, setInternalTasks] = useState<SubAgentTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState<boolean>(false);
  const [spawnRole, setSpawnRole] = useState<string>('Code Architect');
  const [spawnPrompt, setSpawnPrompt] = useState<string>('');
  const [spawningTask, setSpawningTask] = useState<boolean>(false);
  const [spawnSuccess, setSpawnSuccess] = useState<string | null>(null);
  const [spawnError, setSpawnError] = useState<string | null>(null);

  const currentTasks = subagentTasks && subagentTasks.length > 0 ? subagentTasks : internalTasks;
  const runningTasksCount = currentTasks.filter((t) => t.status === 'running').length;

  const fetchMcpServers = async () => {
    setMcpLoading(true);
    setMcpError(null);
    try {
      const res = await fetch('/api/mcp');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data.servers)) {
        setMcpServers(data.servers);
      }
    } catch (err: any) {
      setMcpError(err?.message || 'Failed to load MCP servers');
    } finally {
      setMcpLoading(false);
    }
  };

  const handleAuditAllMcp = async () => {
    setMcpAuditing(true);
    setMcpError(null);
    try {
      const res = await fetch('/api/mcp/audit-all', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data.servers)) {
        setMcpServers(data.servers);
      }
    } catch (err: any) {
      setMcpError(err?.message || 'Audit failed');
    } finally {
      setMcpAuditing(false);
    }
  };

  const handleDiscoverMcpTools = async (id: string) => {
    try {
      const res = await fetch(`/api/mcp/${id}/discover`, { method: 'POST' });
      const data = await res.json();
      if (Array.isArray(data.servers)) {
        setMcpServers(data.servers);
      } else {
        await fetchMcpServers();
      }
      setExpandedMcpServerId(id);
    } catch (err: any) {
      setMcpError(err?.message || 'Tool discovery failed');
    }
  };

  const handleAddMcpServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMcpName.trim()) return;
    try {
      const body: any = {
        name: newMcpName.trim(),
        transport: newMcpTransport,
      };
      if (newMcpTransport === 'stdio') {
        body.command = newMcpCommand.trim();
        body.args = newMcpArgs.split(' ').map((s) => s.trim()).filter(Boolean);
      } else {
        body.endpointUrl = newMcpUrl.trim();
      }
      const res = await fetch('/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to register MCP server');
      const data = await res.json();
      if (Array.isArray(data.servers)) setMcpServers(data.servers);
      else await fetchMcpServers();
      setShowAddMcpForm(false);
      setNewMcpName('');
    } catch (err: any) {
      setMcpError(err?.message || 'Error adding server');
    }
  };

  const handleDeleteMcpServer = async (id: string) => {
    try {
      const res = await fetch(`/api/mcp/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (Array.isArray(data.servers)) setMcpServers(data.servers);
      else await fetchMcpServers();
    } catch (err: any) {
      setMcpError(err?.message || 'Failed to remove server');
    }
  };

  const fetchSubagentTasks = async () => {
    setTasksLoading(true);
    try {
      const res = await fetch('/api/subagents');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.tasks)) setInternalTasks(data.tasks);
      }
    } catch {
      // ignore
    } finally {
      setTasksLoading(false);
    }
  };

  const handleSpawnSubagent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!spawnPrompt.trim()) return;
    setSpawningTask(true);
    setSpawnError(null);
    setSpawnSuccess(null);
    try {
      const res = await fetch('/api/subagents/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: spawnRole,
          taskPrompt: spawnPrompt.trim(),
          workspaceId: activeWorkspaceId,
          conversationId: activeConv?.id,
          providerId: activeConv?.providerId,
          modelId: activeConv?.modelId,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setSpawnSuccess(`Sub-agent spawned! Task ID: ${data.taskId?.slice(0, 8) || 'Active'}`);
      setSpawnPrompt('');
      await fetchSubagentTasks();
      if (onRefreshTasks) onRefreshTasks();
      setTimeout(() => setSpawnSuccess(null), 4000);
    } catch (err: any) {
      setSpawnError(err?.message || 'Failed to spawn sub-agent');
    } finally {
      setSpawningTask(false);
    }
  };

  const handleCancelSubagentTask = async (taskId: string) => {
    try {
      await fetch(`/api/subagents/${taskId}/cancel`, { method: 'POST' });
      await fetchSubagentTasks();
      if (onRefreshTasks) onRefreshTasks();
    } catch {
      // ignore
    }
  };

  const handleDeleteSubagentTask = async (taskId: string) => {
    try {
      await fetch(`/api/subagents/${taskId}`, { method: 'DELETE' });
      await fetchSubagentTasks();
      if (onRefreshTasks) onRefreshTasks();
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchMcpServers();
    fetchSubagentTasks();
  }, []);

  const isCurrentLocal = activeConv?.providerId === 'local-ai';
  const isCurrentAntigravity = activeConv?.providerId === 'antigravity';
  const activeProvider =
    providers.find((p) => p.id === (activeConv?.providerId || 'antigravity')) ||
    providers.find((p) => p.id === 'antigravity') ||
    providers[0];
  const availableModels = activeProvider?.cachedModels || [];
  const currentModelId =
    activeConv?.modelId ||
    (isCurrentLocal
      ? 'qwen2.5-coder-1.5b-q4_k_m.gguf'
      : activeProvider?.defaultModel || 'gemini-3.8-flash');

  const currentLocalModel = isCurrentLocal
    ? localModels.find(
        (m) =>
          m.id === currentModelId ||
          m.id === `${currentModelId}.gguf` ||
          m.displayName === currentModelId
      )
    : null;

  const currentModelName = currentLocalModel
    ? currentLocalModel.displayName
    : currentModelId === 'gemini-3.8-flash'
    ? 'Gemini 3.8 Flash'
    : currentModelId === 'gemini-3.1-flash-lite'
    ? 'Gemini 3.1 Flash Lite'
    : currentModelId === 'gemini-2.5-pro'
    ? 'Gemini 2.5 Pro'
    : currentModelId;

  const fetchLocalModels = async () => {
    setLoadingLocalModels(true);
    try {
      const res = await fetch('/api/local-models');
      const data = await res.json();
      if (Array.isArray(data.models)) setLocalModels(data.models);
      if (typeof data.freeMemoryBytes === 'number') setFreeHostRamBytes(data.freeMemoryBytes);
    } catch {
      // ignore
    } finally {
      setLoadingLocalModels(false);
    }
  };

  useEffect(() => {
    fetchLocalModels();
  }, []);

  const handleInstallLocalModel = async (modelId: string) => {
    setInstallingModelId(modelId);
    try {
      const res = await fetch('/api/local-models/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.models)) {
        setLocalModels(data.models);
      }
    } catch (err) {
      console.error('Failed to install model:', err);
    } finally {
      setInstallingModelId(null);
    }
  };

  const handleImportLocalModel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importFilePath.trim()) return;
    setImportError(null);
    setImportSuccess(null);
    try {
      const res = await fetch('/api/local-models/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: importFilePath.trim(),
          customName: importCustomName.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data.error || 'Failed to import GGUF model.');
        return;
      }
      if (Array.isArray(data.models)) {
        setLocalModels(data.models);
      }
      setImportSuccess(`Imported "${data.model?.displayName || 'model'}" successfully!`);
      setImportFilePath('');
      setImportCustomName('');
      setTimeout(() => {
        setShowImportForm(false);
        setImportSuccess(null);
      }, 1500);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteLocalModel = async (modelId: string) => {
    try {
      const res = await fetch(`/api/local-models/${encodeURIComponent(modelId)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.models)) {
        setLocalModels(data.models);
      }
    } catch (err) {
      console.error('Failed to delete model:', err);
    }
  };

  const handleSelectLocalModel = (model: LocalAiModel) => {
    if (activeConv) {
      onUpdateConversationMeta(activeConv.id, {
        providerId: 'local-ai',
        modelId: model.id,
      });
    }
    setShowModelDropdown(false);
  };

  const handleSelectCloudModel = (providerId: string, modelId: string) => {
    if (activeConv) {
      onUpdateConversationMeta(activeConv.id, {
        providerId,
        modelId,
      });
    }
    setShowModelDropdown(false);
  };

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef<boolean>(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState<boolean>(false);

  const handleConversationScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < 120;
    isNearBottomRef.current = nearBottom;
    setShowScrollToBottom(!nearBottom);
  };

  const scrollToLatest = (behavior: ScrollBehavior = 'smooth') => {
    isNearBottomRef.current = true;
    setShowScrollToBottom(false);
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  const lastMessage = activeConv?.messages[activeConv.messages.length - 1];
  const lastMessageContentLength = lastMessage?.content?.length || 0;
  const lastMessageToolCount = lastMessage?.toolCalls?.length || 0;

  useEffect(() => {
    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({
        behavior: sending ? 'auto' : 'smooth',
      });
    }
  }, [
    activeConv?.id,
    activeConv?.messages.length,
    lastMessageContentLength,
    lastMessageToolCount,
    sending,
    pendingApprovals.length,
  ]);

  useEffect(() => {
    fetch(`/api/workspaces/${encodeURIComponent(activeWorkspaceId)}/files`)
      .then((r) => r.json())
      .then((d) => {
        if (d.files) setWorkspaceFiles(d.files);
      })
      .catch(() => {});
  }, [activeWorkspaceId, activeConv?.messages.length]);

  const handleSubmit = (
    e?: React.FormEvent,
    overridePrompt?: string,
    options?: { retryLastUserMessage?: boolean }
  ) => {
    if (e) e.preventDefault();
    const text = (overridePrompt ?? promptInput).trim();
    if (!text && !attachedFileInfo) return;
    if (sending) return;

    // Distinguish chat vs agent mode:
    // If activeMode is 'Code Mode' OR if the prompt explicitly asks for building or workspace actions
    const hasCodeIntent = /\b(build|apk|gradle|compile|test|edit|write|create|delete|fix|run|inspect|setup)\b/i.test(text);
    const useAgentTools = activeMode === 'Code Mode' || hasCodeIntent;

    isNearBottomRef.current = true;
    setShowScrollToBottom(false);
    onSendMessage(text, attachedFileInfo, useAgentTools, options);

    if (!overridePrompt) {
      setPromptInput('');
      setAttachedFileInfo(null);
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPromptInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 240)}px`;
  };

  const handleDeviceFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setAttachedFileInfo({
        name: file.name,
        content: String(reader.result || ''),
      });
    };
    reader.readAsText(file);
  };

  const handleAttachWorkspaceFile = async (relPath: string) => {
    setShowWorkspacePicker(false);
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(activeWorkspaceId)}/file?path=${encodeURIComponent(relPath)}`
      );
      const data = await res.json();
      if (res.ok && typeof data.content === 'string') {
        setAttachedFileInfo({
          name: `${activeWorkspaceId}/${relPath}`,
          content: data.content,
        });
      }
    } catch {
      // ignore
    }
  };

  const copyMessage = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const userMessages = activeConv?.messages.filter((m) => m.role === 'user') || [];
  const hasMessages = userMessages.length > 0;

  // Reusable Spacious Prompt Composer Component
  const renderPromptComposer = (isCenteredWelcome = false) => (
    <div
      className={`w-full relative transition-all ${
        isCenteredWelcome ? 'mt-8' : 'pt-2'
      }`}
    >
      <form
        onSubmit={(e) => handleSubmit(e)}
        className="w-full rounded-2xl bg-[#161B22] border border-[#30363D] hover:border-[#8B949E]/50 focus-within:border-[#8B949E] transition-all p-3 sm:p-4 shadow-2xl"
      >
        {/* Attached file chip */}
        {attachedFileInfo && (
          <div className="mb-2.5 inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-[#21262D] border border-[#30363D] text-xs text-[#F0F6FC]">
            <FileCode className="w-3.5 h-3.5 text-[#388BFD]" />
            <span className="font-mono truncate max-w-xs">{attachedFileInfo.name}</span>
            <button
              type="button"
              onClick={() => setAttachedFileInfo(null)}
              title="Remove attached file"
              aria-label="Remove attached file"
              className="text-[#8B949E] hover:text-[#FF727A] ml-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Multiline Textarea */}
        <div className="w-full">
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleDeviceFileSelect}
            className="hidden"
          />
          <textarea
            ref={textareaRef}
            value={promptInput}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            rows={isCenteredWelcome ? 2 : 2}
            placeholder="Ask anything, describe an idea, or paste a prompt..."
            className="w-full bg-transparent text-sm sm:text-base text-[#F0F6FC] placeholder-[#8B949E] focus:outline-none resize-none leading-relaxed py-1 min-h-[50px]"
          />
        </div>


        {/* Bottom Toolbar inside Composer: Unified Single Row, Never Multi-line Wrapping */}
        <div className="mt-2 pt-2 border-t border-[#30363D]/40 flex items-center justify-between gap-2 min-w-0">
          {/* Left Controls: Attachment, Model & Mode */}
          <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-x-auto no-scrollbar">
            {/* Attachment Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Attach a file"
              aria-label="Attach a file"
              className="p-1.5 rounded-lg text-[#8B949E] hover:text-[#F0F6FC] hover:bg-[#21262D] transition-colors shrink-0 cursor-pointer"
            >
              <Paperclip className="w-4 h-4" />
            </button>

            {/* Model Selector Pill */}
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => {
                  setShowModelDropdown((v) => !v);
                  setShowModeDropdown(false);
                  if (activeConv?.providerId === 'local-ai') {
                    setModelSelectorTab('local');
                  } else if (activeConv?.providerId === 'antigravity') {
                    setModelSelectorTab('antigravity');
                  }
                }}
                className={`px-2.5 py-1 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors shrink-0 max-w-[150px] sm:max-w-[260px] cursor-pointer ${
                  isCurrentLocal
                    ? 'bg-[#1C2128] border-[#C7FF65]/40 text-[#C7FF65] hover:bg-[#21262D]'
                    : isCurrentAntigravity
                    ? 'bg-[#1C2128] border-[#58A6FF]/40 text-[#58A6FF] hover:bg-[#21262D]'
                    : 'bg-[#21262D] hover:bg-[#30363D] border-[#30363D] text-[#F0F6FC]'
                }`}
                title={`Active: ${currentModelName} (${isCurrentLocal ? 'On-Device Local AI' : isCurrentAntigravity ? 'Antigravity Local Host' : activeProvider?.name || 'Cloud'})`}
                aria-label={`Select AI Model: ${currentModelName}`}
              >
                {isCurrentLocal ? (
                  <HardDrive className="w-3.5 h-3.5 text-[#C7FF65] shrink-0" />
                ) : isCurrentAntigravity ? (
                  <Sparkles className="w-3.5 h-3.5 text-[#58A6FF] shrink-0" />
                ) : (
                  <Cpu className="w-3.5 h-3.5 text-[#C7FF65] shrink-0" />
                )}
                <span className="truncate">
                  {currentModelName}
                </span>
                {isCurrentLocal ? (
                  <span className="hidden sm:inline-block px-1 py-0.2 rounded text-[10px] bg-[#C7FF65]/20 text-[#C7FF65] font-semibold">
                    Local
                  </span>
                ) : isCurrentAntigravity ? (
                  <span className="hidden sm:inline-block px-1.5 py-0.2 rounded text-[10px] bg-[#58A6FF]/20 text-[#58A6FF] font-semibold">
                    Antigravity
                  </span>
                ) : null}
                <ChevronDown className="w-3 h-3 text-[#8B949E] shrink-0" />
              </button>
            </div>

            {/* Mode Selector Pill */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowModeDropdown((v) => !v);
                  setShowModelDropdown(false);
                }}
                title="Select Interaction Mode"
                aria-label="Select Interaction Mode"
                className="px-2.5 py-1 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-xs font-medium text-[#F0F6FC] flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer"
              >
                <Layers className="w-3.5 h-3.5 text-[#8B949E] shrink-0" />
                <span className="truncate">{activeMode.replace(' Mode', '')}</span>
                <ChevronDown className="w-3 h-3 text-[#8B949E] shrink-0" />
              </button>


              {showModeDropdown && (
                <>
                  {/* Mobile Slide-Up Bottom Sheet for Mode */}
                  <div className="sm:hidden fixed inset-0 z-50 flex flex-col justify-end">
                    <div
                      className="fixed inset-0 bg-black/60 backdrop-blur-sm"
                      onClick={() => setShowModeDropdown(false)}
                    />
                    <div className="relative w-full bg-[#161B22] border-t border-[#30363D] rounded-t-2xl p-4 max-h-[50vh] flex flex-col z-10 safe-bottom shadow-2xl">
                      <div className="w-10 h-1 bg-[#30363D] rounded-full mx-auto mb-3 shrink-0" />
                      <div className="flex items-center justify-between pb-3 border-b border-[#30363D] shrink-0">
                        <div className="flex items-center gap-2">
                          <Layers className="w-4 h-4 text-[#C7FF65]" />
                          <span className="text-sm font-semibold text-[#F0F6FC]">Select Mode</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowModeDropdown(false)}
                          title="Close Mode Selector"
                          aria-label="Close Mode Selector"
                          className="p-1 rounded text-[#8B949E] hover:text-[#F0F6FC] cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="py-2 space-y-1">
                        {(['Chat Mode', 'Code Mode', 'Write Mode'] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => {
                              setActiveMode(mode);
                              setShowModeDropdown(false);
                            }}
                            className={`w-full text-left px-3 py-2.5 rounded-xl text-xs flex items-center justify-between transition-colors cursor-pointer ${
                              activeMode === mode
                                ? 'bg-[#21262D] text-[#C7FF65] font-semibold border border-[#C7FF65]/30'
                                : 'text-[#F0F6FC] hover:bg-[#21262D]'
                            }`}
                          >
                            <span>{mode}</span>
                            {activeMode === mode && <Check className="w-4 h-4 text-[#C7FF65] shrink-0" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Desktop Dropdown */}
                  <div className="hidden sm:block absolute left-0 bottom-full mb-2 w-48 rounded-xl bg-[#161B22] border border-[#30363D] shadow-2xl p-1.5 z-50 space-y-1">
                    {(['Chat Mode', 'Code Mode', 'Write Mode'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => {
                          setActiveMode(mode);
                          setShowModeDropdown(false);
                        }}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between transition-colors cursor-pointer ${
                          activeMode === mode
                            ? 'bg-[#21262D] text-[#C7FF65] font-semibold'
                            : 'text-[#F0F6FC] hover:bg-[#21262D]'
                        }`}
                      >
                        <span>{mode}</span>
                        {activeMode === mode && <Check className="w-3.5 h-3.5 shrink-0" />}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Workspace File Picker Toggle */}
            <button
              type="button"
              onClick={() => setShowWorkspacePicker((v) => !v)}
              title="Browse and select workspace files"
              aria-label={`Workspace Files (${workspaceFiles.length})`}
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-[#8B949E] hover:text-[#F0F6FC] hover:bg-[#21262D] transition-colors cursor-pointer"
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Workspace Files ({workspaceFiles.length})</span>
            </button>
          </div>

          {/* Right Action: Send / Stop Button */}
          <div className="flex items-center shrink-0">
            {sending ? (
              <button
                type="button"
                onClick={onStopGeneration}
                title="Stop AI Generation"
                aria-label="Stop AI Generation"
                className="min-h-[34px] px-3.5 py-1.5 rounded-xl bg-[#DA3633] text-white font-bold text-xs flex items-center gap-1.5 hover:bg-[#DA3633]/90 transition-all shrink-0 cursor-pointer"
              >
                <Square className="w-3.5 h-3.5" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!promptInput.trim() && !attachedFileInfo}
                className="w-9 h-9 rounded-xl bg-[#C7FF65] text-[#0D1117] font-bold text-xs flex items-center justify-center hover:bg-[#B8F558] disabled:opacity-40 transition-all shadow-md shrink-0 cursor-pointer"
                title="Send Prompt (Enter)"
                aria-label="Send Prompt"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>


        {/* Workspace File Picker Modal/Drawer */}
        {showWorkspacePicker && (
          <div className="mt-3 p-3 rounded-xl bg-[#0D1117] border border-[#30363D] max-h-48 overflow-y-auto space-y-1">
            <div className="text-[11px] font-semibold text-[#8B949E] px-1 pb-1">
              Select file to attach from {activeWorkspaceId}:
            </div>
            {workspaceFiles.slice(0, 30).map((wf) => (
              <div
                key={wf.relativePath}
                className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-[#161B22] text-xs transition-colors"
              >
                <span className="font-mono text-[#F0F6FC] truncate">{wf.relativePath}</span>
                <button
                  type="button"
                  onClick={() => handleAttachWorkspaceFile(wf.relativePath)}
                  className="px-2 py-0.5 rounded bg-[#21262D] hover:bg-[#30363D] text-[#C7FF65] text-[11px] font-medium"
                >
                  Attach
                </button>
              </div>
            ))}
          </div>
        )}
      </form>
    </div>
  );

  // Dedicated Root-Level Responsive Model Selector Modal / Bottom Sheet
  const renderModelSelectorModal = () => {

    if (!showModelDropdown) return null;

    return (
      <div className="fixed inset-0 z-[100] flex flex-col justify-end sm:justify-center sm:items-center p-0 sm:p-4">
        {/* Full Viewport Backdrop with Strong Blur and High Contrast */}
        <div
          className="fixed inset-0 bg-black/85 backdrop-blur-md"
          onClick={() => setShowModelDropdown(false)}
        />

        {/* Responsive Modal/Sheet Panel */}
        <div className="relative w-full sm:max-w-xl bg-[#161B22] border-t sm:border border-[#30363D] rounded-t-2xl sm:rounded-2xl max-h-[85vh] flex flex-col z-10 shadow-2xl overflow-hidden safe-bottom animate-in fade-in duration-150">
          {/* Mobile Drag Indicator */}
          <div className="sm:hidden w-10 h-1 bg-[#30363D] rounded-full mx-auto my-2.5 shrink-0" />

          {/* Modal Header */}
          <div className="px-4 py-3 border-b border-[#30363D] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#21262D] border border-[#30363D] flex items-center justify-center text-[#C7FF65]">
                {modelSelectorTab === 'local' ? (
                  <HardDrive className="w-4 h-4" />
                ) : (
                  <Cloud className="w-4 h-4" />
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[#F0F6FC]">
                  AI Model Selector
                </h3>
                <p className="text-[11px] text-[#8B949E]">
                  Switch models without leaving the conversation
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowModelDropdown(false)}
              className="p-1.5 rounded-lg text-[#8B949E] hover:text-[#F0F6FC] hover:bg-[#21262D] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Segmented Top Tabs: Antigravity vs Local AI vs Cloud */}
          <div className="px-4 pt-3 pb-2 border-b border-[#30363D]/60 shrink-0 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setModelSelectorTab('antigravity')}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                modelSelectorTab === 'antigravity'
                  ? 'bg-[#58A6FF] text-[#0D1117] shadow-sm'
                  : 'bg-[#21262D] text-[#8B949E] hover:text-[#F0F6FC] hover:bg-[#30363D]'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span>Antigravity (Local Host)</span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  modelSelectorTab === 'antigravity'
                    ? 'bg-[#0D1117]/20 text-[#0D1117]'
                    : 'bg-[#30363D] text-[#58A6FF]'
                }`}
              >
                Gemini 3.8
              </span>
            </button>

            <button
              type="button"
              onClick={() => setModelSelectorTab('local')}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                modelSelectorTab === 'local'
                  ? 'bg-[#C7FF65] text-[#0D1117] shadow-sm'
                  : 'bg-[#21262D] text-[#8B949E] hover:text-[#F0F6FC] hover:bg-[#30363D]'
              }`}
            >
              <HardDrive className="w-3.5 h-3.5 shrink-0" />
              <span>Local AI (GGUF)</span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  modelSelectorTab === 'local'
                    ? 'bg-[#0D1117]/20 text-[#0D1117]'
                    : 'bg-[#30363D] text-[#C7FF65]'
                }`}
              >
                {localModels.filter((m) => m.isDownloaded).length} Ready
              </span>
            </button>

            <button
              type="button"
              onClick={() => setModelSelectorTab('cloud')}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                modelSelectorTab === 'cloud'
                  ? 'bg-[#C7FF65] text-[#0D1117] shadow-sm'
                  : 'bg-[#21262D] text-[#8B949E] hover:text-[#F0F6FC] hover:bg-[#30363D]'
              }`}
            >
              <Cloud className="w-3.5 h-3.5 shrink-0" />
              <span>Cloud Providers</span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  modelSelectorTab === 'cloud'
                    ? 'bg-[#0D1117]/20 text-[#0D1117]'
                    : 'bg-[#30363D] text-[#8B949E]'
                }`}
              >
                {providers.filter((p) => p.id !== 'local-ai' && p.id !== 'antigravity').length}
              </span>
            </button>
          </div>

          {/* Scrollable Content Body */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
            {modelSelectorTab === 'antigravity' ? (
              <div className="space-y-3">
                {/* Antigravity Local Host Banner */}
                <div className="p-3.5 rounded-xl bg-[#0D1117] border border-[#58A6FF]/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 text-xs">
                  <div className="flex items-center gap-2.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#58A6FF] animate-pulse shrink-0" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[#F0F6FC] font-bold text-sm">
                          Antigravity Local Host Engine
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#58A6FF]/20 text-[#58A6FF] border border-[#58A6FF]/30">
                          localhost:59895
                        </span>
                      </div>
                      <p className="text-[11px] text-[#8B949E] mt-0.5">
                        Connected to Google Antigravity Local Host with real-time token streaming and autonomous workspace tool execution.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Antigravity Models Cards */}
                <div className="space-y-2.5">
                  {[
                    {
                      id: 'gemini-3.8-flash',
                      name: 'Gemini 3.8 Flash',
                      badge: 'Default / Fast',
                      context: '1.0M ctx',
                      description:
                        'Next-generation low-latency intelligence tuned for rapid agent coding, streaming turn generation, and Antigravity workflow orchestration.',
                    },
                    {
                      id: 'gemini-3.1-flash-lite',
                      name: 'Gemini 3.1 Flash Lite',
                      badge: 'Ultra Fast',
                      context: '1.0M ctx',
                      description:
                        'Ultra-lightweight fast turnaround model for rapid edits, terminal summarization, and responsive interactive chat.',
                    },
                    {
                      id: 'gemini-2.5-pro',
                      name: 'Gemini 2.5 Pro',
                      badge: 'Deep Reasoning',
                      context: '2.0M ctx',
                      description:
                        'Deep reasoning model for complex architectural refactoring, comprehensive test authoring, and multi-file analysis.',
                    },
                  ].map((m) => {
                    const isSel = activeConv?.providerId === 'antigravity' && currentModelId === m.id;
                    return (
                      <div
                        key={m.id}
                        className={`p-3.5 rounded-xl border transition-all ${
                          isSel
                            ? 'bg-[#1C2128] border-[#58A6FF]/60 ring-1 ring-[#58A6FF]/30'
                            : 'bg-[#0D1117] border-[#30363D] hover:border-[#8B949E]/50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-xs sm:text-sm text-[#F0F6FC]">
                                {m.name}
                              </span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#58A6FF]/20 text-[#58A6FF] border border-[#58A6FF]/30">
                                {m.badge}
                              </span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#21262D] text-[#8B949E]">
                                {m.context}
                              </span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#238636]/20 text-[#3FB950]">
                                Streaming
                              </span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#C7FF65]/20 text-[#C7FF65]">
                                Tools
                              </span>
                            </div>
                            <p className="text-[11px] text-[#8B949E] mt-1 leading-relaxed">
                              {m.description}
                            </p>
                          </div>

                          <div className="shrink-0 self-center">
                            {isSel ? (
                              <span className="px-3 py-1.5 rounded-lg bg-[#58A6FF]/20 text-[#58A6FF] border border-[#58A6FF]/40 text-xs font-semibold flex items-center gap-1.5">
                                <Check className="w-3.5 h-3.5" />
                                Active
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleSelectCloudModel('antigravity', m.id)}
                                className="px-3 py-1.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] text-[#F0F6FC] hover:text-[#58A6FF] border border-[#30363D] font-semibold text-xs transition-colors cursor-pointer"
                              >
                                Select
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : modelSelectorTab === 'local' ? (
              <>
                {/* Local Engine Banner */}
                <div className="p-3 rounded-xl bg-[#0D1117] border border-[#30363D] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#C7FF65] shrink-0" />
                    <span className="text-[#F0F6FC] font-medium">
                      Offline Inference Engine Operational
                    </span>
                    <span className="text-[#8B949E] hidden sm:inline">
                      · Zero network or API keys required
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-[#8B949E]">
                    {freeHostRamBytes > 0 && (
                      <span className="font-mono bg-[#161B22] px-2 py-0.5 rounded border border-[#30363D]">
                        Free RAM: {(freeHostRamBytes / (1024 ** 3)).toFixed(1)} GB
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={fetchLocalModels}
                      disabled={loadingLocalModels}
                      className="p-1 rounded text-[#8B949E] hover:text-[#F0F6FC] cursor-pointer"
                      title="Refresh local models"
                      aria-label="Refresh local models"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingLocalModels ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>

                {/* Model Cards List */}
                <div className="space-y-2.5">
                  {localModels.map((m) => {
                    const isSel = isCurrentLocal && (currentModelId === m.id || currentModelId === `${m.id}.gguf`);
                    return (
                      <div
                        key={m.id}
                        className={`p-3.5 rounded-xl border transition-all ${
                          isSel
                            ? 'bg-[#1C2128] border-[#C7FF65]/60 ring-1 ring-[#C7FF65]/30'
                            : 'bg-[#0D1117] border-[#30363D] hover:border-[#8B949E]/50'
                        }`}
                      >
                        {/* Title row */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-xs sm:text-sm text-[#F0F6FC] truncate">
                                {m.displayName}
                              </span>
                              {m.isRecommended && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#C7FF65]/20 text-[#C7FF65] border border-[#C7FF65]/40">
                                  Recommended
                                </span>
                              )}
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#21262D] text-[#8B949E]">
                                {m.format}
                              </span>
                            </div>
                            <p className="text-[11px] text-[#8B949E] mt-0.5 leading-relaxed">
                              {m.description}
                            </p>
                          </div>

                          {/* Download / Installed Status badge */}
                          <div className="shrink-0">
                            {m.isDownloaded ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#238636]/20 text-[#3FB950] border border-[#238636]/40 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#3FB950]" />
                                Ready
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#21262D] text-[#8B949E] border border-[#30363D]">
                                Catalog
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Metrics & Spec Row */}
                        <div className="mt-2.5 pt-2 border-t border-[#30363D]/60 flex items-center justify-between flex-wrap gap-2 text-xs">
                          <div className="flex items-center gap-2.5 flex-wrap text-[11px]">
                            <span className="font-mono text-[#8B949E] bg-[#161B22] px-2 py-0.5 rounded border border-[#30363D]">
                              📦 {m.sizeDisplay}
                            </span>
                            <span className="font-mono text-[#8B949E] bg-[#161B22] px-2 py-0.5 rounded border border-[#30363D]">
                              🧠 {m.ramRequiredDisplay}
                            </span>
                            {m.fitsHostMemory !== false ? (
                              <span className="text-[#3FB950] font-medium flex items-center gap-1">
                                <Check className="w-3 h-3" /> RAM Safe
                              </span>
                            ) : (
                              <span className="text-[#D29922] font-medium flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" /> Constrained
                              </span>
                            )}
                            {m.supportsTools && (
                              <span className="text-[#C7FF65] font-medium flex items-center gap-1">
                                <Check className="w-3 h-3" /> Coding Tools
                              </span>
                            )}
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center gap-2 shrink-0">
                            {m.isDownloaded ? (
                              <>
                                {isSel ? (
                                  <span className="px-3 py-1.5 rounded-lg bg-[#C7FF65]/20 text-[#C7FF65] border border-[#C7FF65]/40 text-xs font-semibold flex items-center gap-1.5">
                                    <Check className="w-3.5 h-3.5" />
                                    Active
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleSelectLocalModel(m)}
                                    className="px-3 py-1.5 rounded-lg bg-[#C7FF65] hover:bg-[#B8F558] text-[#0D1117] font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                                  >
                                    Select Model
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleDeleteLocalModel(m.id)}
                                  className="p-1.5 rounded-lg text-[#8B949E] hover:text-[#FF727A] hover:bg-[#21262D] transition-colors cursor-pointer"
                                  title="Delete model binary to free disk space"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                disabled={installingModelId === m.id}
                                onClick={() => handleInstallLocalModel(m.id)}
                                className="px-3 py-1.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-[#C7FF65] font-semibold text-xs flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                              >
                                <Download className={`w-3.5 h-3.5 ${installingModelId === m.id ? 'animate-bounce' : ''}`} />
                                {installingModelId === m.id ? 'Installing...' : `Download (${m.sizeDisplay})`}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Import GGUF Section */}
                <div className="pt-2 border-t border-[#30363D]">
                  {!showImportForm ? (
                    <button
                      type="button"
                      onClick={() => setShowImportForm(true)}
                      className="w-full py-2.5 px-3 rounded-xl border border-dashed border-[#30363D] hover:border-[#8B949E] text-xs text-[#8B949E] hover:text-[#F0F6FC] transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Plus className="w-4 h-4 text-[#C7FF65]" />
                      <span>Import Custom GGUF File from Host Disk</span>
                    </button>
                  ) : (
                    <form
                      onSubmit={handleImportLocalModel}
                      className="p-3 rounded-xl bg-[#0D1117] border border-[#30363D] space-y-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[#F0F6FC]">
                          Import Local GGUF Model
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowImportForm(false)}
                          className="text-xs text-[#8B949E] hover:text-[#F0F6FC] cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>

                      <div>
                        <label className="text-[11px] font-medium text-[#8B949E] block mb-1">
                          Absolute File Path to .gguf:
                        </label>
                        <input
                          type="text"
                          value={importFilePath}
                          onChange={(e) => setImportFilePath(e.target.value)}
                          placeholder="e.g. C:/models/custom-model.gguf or .anvil-data/local-models/model.gguf"
                          className="w-full px-2.5 py-1.5 rounded-lg bg-[#161B22] border border-[#30363D] text-xs text-[#F0F6FC] font-mono focus:border-[#C7FF65] outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] font-medium text-[#8B949E] block mb-1">
                          Custom Display Name (optional):
                        </label>
                        <input
                          type="text"
                          value={importCustomName}
                          onChange={(e) => setImportCustomName(e.target.value)}
                          placeholder="e.g. Fine-Tuned Code Assistant"
                          className="w-full px-2.5 py-1.5 rounded-lg bg-[#161B22] border border-[#30363D] text-xs text-[#F0F6FC] focus:border-[#C7FF65] outline-none"
                        />
                      </div>

                      {importError && (
                        <div className="p-2 rounded bg-[#DA3633]/20 border border-[#DA3633]/40 text-xs text-[#FF727A] flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          <span>{importError}</span>
                        </div>
                      )}

                      {importSuccess && (
                        <div className="p-2 rounded bg-[#238636]/20 border border-[#238636]/40 text-xs text-[#3FB950] flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>{importSuccess}</span>
                        </div>
                      )}

                      <button
                        type="submit"
                        className="w-full py-2 rounded-lg bg-[#C7FF65] text-[#0D1117] font-bold text-xs flex items-center justify-center gap-1.5 hover:bg-[#B8F558] cursor-pointer"
                      >
                        Verify GGUF Header & Import
                      </button>
                    </form>
                  )}
                </div>
              </>
            ) : (
              /* Cloud Providers Tab */
              <div className="space-y-3">
                {/* Provider Selector Pills */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                  {providers
                    .filter((p) => p.id !== 'local-ai')
                    .map((p) => {
                      const isProvActive = p.id === selectedCloudProviderId;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setSelectedCloudProviderId(p.id)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                            isProvActive
                              ? 'bg-[#21262D] text-[#C7FF65] border border-[#C7FF65]/40'
                              : 'bg-[#0D1117] text-[#8B949E] hover:text-[#F0F6FC] border border-[#30363D]'
                          }`}
                        >
                          <span>{p.name.split(' (')[0]}</span>
                        </button>
                      );
                    })}
                </div>

                {/* Selected Provider Info */}
                {(() => {
                  const prov =
                    providers.find((p) => p.id === selectedCloudProviderId) ||
                    providers.find((p) => p.id !== 'local-ai') ||
                    providers[0];
                  const provModels = prov?.cachedModels || [];
                  const isConnected = prov?.connected;

                  return (
                    <div className="space-y-2.5">
                      <div className="p-2.5 rounded-xl bg-[#0D1117] border border-[#30363D] flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              isConnected ? 'bg-[#3FB950]' : 'bg-[#D29922]'
                            }`}
                          />
                          <span className="font-semibold text-[#F0F6FC]">{prov?.name}</span>
                        </div>
                        <span
                          className={`text-[11px] font-mono px-2 py-0.5 rounded ${
                            isConnected
                              ? 'bg-[#238636]/20 text-[#3FB950]'
                              : 'bg-[#D29922]/20 text-[#D29922]'
                          }`}
                        >
                          {isConnected ? 'Connected' : 'Auth Required'}
                        </span>
                      </div>

                      <div className="space-y-1.5">
                        {provModels.map((m, idx) => {
                          const isSel = !isCurrentLocal && activeConv?.providerId === prov.id && currentModelId === m.id;
                          return (
                            <div
                              key={`${prov.id}-${m.id}-${idx}`}
                              className={`p-3 rounded-xl border flex items-center justify-between gap-2 transition-all ${
                                isSel
                                  ? 'bg-[#1C2128] border-[#C7FF65]/50 ring-1 ring-[#C7FF65]/30'
                                  : 'bg-[#0D1117] border-[#30363D] hover:border-[#8B949E]'
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-xs text-[#F0F6FC] truncate">
                                    {m.displayName || m.id}
                                  </span>
                                  {m.isFreeTierVerified && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#3FB950]/20 text-[#3FB950]">
                                      Free Tier
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-1 text-[11px] text-[#8B949E]">
                                  {m.contextWindowTokens && (
                                    <span className="font-mono">
                                      {m.contextWindowTokens >= 1000000
                                        ? `${(m.contextWindowTokens / 1000000).toFixed(1)}M ctx`
                                        : `${Math.round(m.contextWindowTokens / 1000)}k ctx`}
                                    </span>
                                  )}
                                  {m.supportsTools && (
                                    <span className="text-[#C7FF65]">· Tools</span>
                                  )}
                                  {m.supportsStreaming && (
                                    <span>· Stream</span>
                                  )}
                                </div>
                              </div>

                              <div className="shrink-0">
                                {isSel ? (
                                  <span className="px-3 py-1.5 rounded-lg bg-[#C7FF65]/20 text-[#C7FF65] border border-[#C7FF65]/40 text-xs font-semibold flex items-center gap-1.5">
                                    <Check className="w-3.5 h-3.5" />
                                    Active
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleSelectCloudModel(prov.id, m.id)}
                                    className="px-3 py-1.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] text-[#F0F6FC] hover:text-[#C7FF65] border border-[#30363D] font-semibold text-xs transition-colors cursor-pointer"
                                  >
                                    Select
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Bottom Configure Link */}
          <div className="p-3 border-t border-[#30363D] shrink-0 flex items-center justify-between text-xs bg-[#0D1117]">
            <span className="text-[#8B949E]">
              Selected model persists for this conversation.
            </span>
            <button
              type="button"
              onClick={() => {
                setShowModelDropdown(false);
                onNavigateToProviders();
              }}
              className="text-[#388BFD] hover:underline font-medium flex items-center gap-1 cursor-pointer"
            >
              <span>Configure API Keys & Providers →</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Dedicated Root-Level MCP Servers & Tools Modal / Bottom Sheet
  const renderMcpModal = () => {
    if (!showMcpModal) return null;

    return (
      <div className="fixed inset-0 z-[100] flex flex-col justify-end sm:justify-center sm:items-center p-0 sm:p-4">
        {/* Full Viewport Backdrop */}
        <div
          className="fixed inset-0 bg-black/85 backdrop-blur-md"
          onClick={() => setShowMcpModal(false)}
        />

        {/* Modal / Sheet Container */}
        <div className="relative w-full sm:max-w-2xl bg-[#161B22] border-t sm:border border-[#30363D] rounded-t-2xl sm:rounded-2xl max-h-[85vh] flex flex-col z-10 shadow-2xl overflow-hidden safe-bottom animate-in fade-in duration-150">
          {/* Mobile Handle */}
          <div className="sm:hidden w-10 h-1 bg-[#30363D] rounded-full mx-auto my-2.5 shrink-0" />

          {/* Modal Header */}
          <div className="px-4 py-3 border-b border-[#30363D] flex items-center justify-between shrink-0 bg-[#161B22]">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#21262D] border border-[#30363D] flex items-center justify-center text-[#C7FF65]">
                <Cpu className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-semibold text-[#F0F6FC]">
                  Model Context Protocol (MCP) Hub
                </h2>
                <p className="text-[11px] text-[#8B949E]">
                  Inspect servers, check real connection states, and discover active tools.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAuditAllMcp}
                disabled={mcpAuditing}
                className="px-2.5 py-1.5 rounded-lg border border-[#30363D] bg-[#21262D] hover:bg-[#30363D] text-xs text-[#8B949E] hover:text-[#C7FF65] flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Audit all MCP server connections"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${mcpAuditing ? 'animate-spin text-[#C7FF65]' : ''}`} />
                <span className="hidden sm:inline">Audit Connections</span>
              </button>

              <button
                type="button"
                onClick={() => setShowMcpModal(false)}
                title="Close MCP Hub"
                aria-label="Close MCP Hub"
                className="p-1.5 rounded-lg text-[#8B949E] hover:text-[#F0F6FC] hover:bg-[#21262D] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Error Banner */}
          {mcpError && (
            <div className="mx-4 mt-3 p-2.5 rounded-lg bg-[#DA3633]/15 border border-[#DA3633]/40 text-xs text-[#FF727A] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{mcpError}</span>
              </div>
              <button
                type="button"
                onClick={() => setMcpError(null)}
                title="Dismiss Error Notice"
                aria-label="Dismiss Error Notice"
                className="text-[#8B949E] hover:text-[#F0F6FC] cursor-pointer p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Modal Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {/* Action Bar: Add Server Toggle */}
            <div className="flex items-center justify-between pb-2 border-b border-[#30363D]">
              <span className="text-xs font-semibold text-[#8B949E] uppercase tracking-wider">
                Configured MCP Servers ({mcpServers.length})
              </span>
              <button
                type="button"
                onClick={() => setShowAddMcpForm((prev) => !prev)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-xs font-medium text-[#C7FF65] cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{showAddMcpForm ? 'Cancel' : 'Add Server'}</span>
              </button>
            </div>

            {/* Add Server Form */}
            {showAddMcpForm && (
              <form onSubmit={handleAddMcpServer} className="p-3.5 rounded-xl bg-[#0D1117] border border-[#30363D] space-y-3">
                <div className="text-xs font-semibold text-[#F0F6FC]">Register New MCP Server</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[11px] text-[#8B949E] mb-1 block">Server Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Memory Server"
                      value={newMcpName}
                      onChange={(e) => setNewMcpName(e.target.value)}
                      required
                      className="w-full bg-[#161B22] border border-[#30363D] rounded-lg px-2.5 py-1.5 text-xs text-[#F0F6FC] outline-none focus:border-[#C7FF65]"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-[#8B949E] mb-1 block">Transport Type</label>
                    <select
                      value={newMcpTransport}
                      onChange={(e: any) => setNewMcpTransport(e.target.value)}
                      className="w-full bg-[#161B22] border border-[#30363D] rounded-lg px-2.5 py-1.5 text-xs text-[#F0F6FC] outline-none"
                    >
                      <option value="streamable-http">Streamable HTTP (REST/JSON-RPC)</option>
                      <option value="stdio">Stdio Process (Local CLI/CLI tool)</option>
                      <option value="sse">Server-Sent Events (SSE)</option>
                    </select>
                  </div>
                </div>

                {newMcpTransport === 'stdio' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="text-[11px] text-[#8B949E] mb-1 block">Command</label>
                      <input
                        type="text"
                        placeholder="e.g. npx"
                        value={newMcpCommand}
                        onChange={(e) => setNewMcpCommand(e.target.value)}
                        required
                        className="w-full bg-[#161B22] border border-[#30363D] rounded-lg px-2.5 py-1.5 text-xs text-[#F0F6FC] outline-none focus:border-[#C7FF65]"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-[#8B949E] mb-1 block">Arguments</label>
                      <input
                        type="text"
                        placeholder="-y @modelcontextprotocol/server-memory"
                        value={newMcpArgs}
                        onChange={(e) => setNewMcpArgs(e.target.value)}
                        className="w-full bg-[#161B22] border border-[#30363D] rounded-lg px-2.5 py-1.5 text-xs text-[#F0F6FC] outline-none focus:border-[#C7FF65]"
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="text-[11px] text-[#8B949E] mb-1 block">Endpoint URL</label>
                    <input
                      type="text"
                      placeholder="http://localhost:3000/api/mcp-loopback"
                      value={newMcpUrl}
                      onChange={(e) => setNewMcpUrl(e.target.value)}
                      required
                      className="w-full bg-[#161B22] border border-[#30363D] rounded-lg px-2.5 py-1.5 text-xs text-[#F0F6FC] font-mono outline-none focus:border-[#C7FF65]"
                    />
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowAddMcpForm(false)}
                    className="px-3 py-1.5 rounded-lg border border-[#30363D] text-xs text-[#8B949E] hover:text-[#F0F6FC]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-3.5 py-1.5 rounded-lg bg-[#C7FF65] text-[#0D1117] font-semibold text-xs hover:bg-[#D4FF80] transition-colors"
                  >
                    Connect Server
                  </button>
                </div>
              </form>
            )}

            {/* Servers List */}
            {mcpLoading ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2">
                <RefreshCw className="w-6 h-6 animate-spin text-[#C7FF65]" />
                <span className="text-xs text-[#8B949E]">Loading MCP registry...</span>
              </div>
            ) : mcpServers.length === 0 ? (
              <div className="py-10 text-center rounded-xl border border-dashed border-[#30363D] p-6 space-y-3">
                <Server className="w-8 h-8 text-[#8B949E] mx-auto opacity-50" />
                <div className="text-xs text-[#8B949E]">No MCP servers registered yet.</div>
                <button
                  type="button"
                  onClick={async () => {
                    setNewMcpName('Local OBSIDIAN Loopback');
                    setNewMcpTransport('streamable-http');
                    setNewMcpUrl('http://localhost:3000/api/mcp-loopback');
                    setShowAddMcpForm(true);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-xs text-[#C7FF65] font-medium"
                >
                  Configure Default Loopback Server
                </button>
              </div>
            ) : (
              mcpServers.map((srv) => {
                const isExpanded = expandedMcpServerId === srv.id;
                const tools = srv.discoveredTools || [];
                const isOnline = srv.status === 'connected';
                const hasError = Boolean(srv.lastError);

                return (
                  <div
                    key={srv.id}
                    className="p-3.5 rounded-xl bg-[#0D1117] border border-[#30363D] hover:border-[#8B949E]/40 transition-colors space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs sm:text-sm text-[#F0F6FC]">
                            {srv.name}
                          </span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#21262D] border border-[#30363D] text-[#8B949E] uppercase">
                            {srv.transport}
                          </span>
                          {isOnline ? (
                            <span className="flex items-center gap-1 text-[10px] text-[#C7FF65] font-mono">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#C7FF65]" />
                              Connected {srv.latencyMs ? `(${srv.latencyMs}ms)` : ''}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-[10px] text-[#FF727A] font-mono">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#FF727A]" />
                              {hasError ? 'Error' : 'Offline'}
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] font-mono text-[#8B949E] truncate mt-0.5">
                          {srv.endpointUrl || `${srv.command} ${(srv.args || []).join(' ')}`}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleDiscoverMcpTools(srv.id)}
                          className="px-2 py-1 rounded bg-[#21262D] hover:bg-[#30363D] text-[11px] text-[#8B949E] hover:text-[#C7FF65] border border-[#30363D] transition-colors cursor-pointer"
                          title="Discover available tools"
                        >
                          Discover Tools
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteMcpServer(srv.id)}
                          className="p-1 rounded text-[#8B949E] hover:text-[#FF727A] hover:bg-[#21262D] transition-colors cursor-pointer"
                          title="Remove Server"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Error details if any */}
                    {hasError && (
                      <div className="p-2 rounded bg-[#DA3633]/15 border border-[#DA3633]/30 text-[11px] text-[#FF727A] leading-tight">
                        {srv.lastError}
                      </div>
                    )}

                    {/* Discovered Tools Chips */}
                    <div className="pt-1 border-t border-[#21262D] flex items-center justify-between text-[11px]">
                      <button
                        type="button"
                        onClick={() => setExpandedMcpServerId(isExpanded ? null : srv.id)}
                        className="text-[#8B949E] hover:text-[#F0F6FC] flex items-center gap-1 font-mono cursor-pointer"
                      >
                        <Layers className="w-3 h-3 text-[#C7FF65]" />
                        <span>{tools.length} Tools Available</span>
                        <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </button>

                      <span className="text-[10px] text-[#8B949E]">
                        Last Checked: {srv.lastAuditAt ? new Date(srv.lastAuditAt).toLocaleTimeString() : 'Never'}
                      </span>
                    </div>

                    {isExpanded && tools.length > 0 && (
                      <div className="mt-2 p-2 rounded-lg bg-[#161B22] border border-[#30363D] space-y-1.5">
                        {tools.map((t: any) => (
                          <div key={t.name} className="flex flex-col text-[11px]">
                            <div className="font-mono text-[#C7FF65] font-semibold">{t.name}</div>
                            {t.description && (
                              <div className="text-[#8B949E] text-[10px] line-clamp-1">{t.description}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Modal Footer */}
          <div className="p-3 border-t border-[#30363D] shrink-0 flex items-center justify-between text-xs bg-[#0D1117]">
            <span className="text-[#8B949E]">
              MCP protocol v1.32.1 compliant
            </span>
            <button
              type="button"
              onClick={() => {
                setShowMcpModal(false);
                onNavigateToProjects();
              }}
              className="text-[#388BFD] hover:underline font-medium flex items-center gap-1 cursor-pointer"
            >
              <span>Manage Tools in Full View →</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Dedicated Root-Level Tasks & Sub-Agents Drawer
  const renderTasksDrawer = () => {
    if (!showTasksDrawer) return null;

    const tasks = currentTasks;
    const running = tasks.filter((t) => t.status === 'running');

    return (
      <div className="fixed inset-0 z-[100] flex justify-end">
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-xs"
          onClick={() => setShowTasksDrawer(false)}
        />

        {/* Slide-over Drawer Panel */}
        <div className="relative w-full sm:w-[440px] bg-[#161B22] border-l border-[#30363D] h-full flex flex-col z-10 shadow-2xl overflow-hidden animate-in slide-in-from-right duration-200">
          {/* Drawer Header */}
          <div className="px-4 py-3 border-b border-[#30363D] flex items-center justify-between shrink-0 bg-[#161B22]">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#21262D] border border-[#30363D] flex items-center justify-center text-[#C7FF65]">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm sm:text-base font-semibold text-[#F0F6FC]">
                    Tasks & Sub-Agents
                  </h2>
                  {running.length > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full bg-[#C7FF65] text-[#0D1117] text-[10px] font-bold">
                      {running.length} Active
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-[#8B949E]">
                  Delegate work to autonomous sub-agents and inspect progress.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={fetchSubagentTasks}
                disabled={tasksLoading}
                className="p-1.5 rounded-lg text-[#8B949E] hover:text-[#C7FF65] hover:bg-[#21262D] transition-colors cursor-pointer"
                title="Refresh tasks"
                aria-label="Refresh tasks"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${tasksLoading ? 'animate-spin text-[#C7FF65]' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => setShowTasksDrawer(false)}
                className="p-1.5 rounded-lg text-[#8B949E] hover:text-[#F0F6FC] hover:bg-[#21262D] transition-colors cursor-pointer"
                title="Close Tasks Drawer"
                aria-label="Close Tasks Drawer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Drawer Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Quick Delegation Form */}
            <div className="p-3.5 rounded-xl bg-[#0D1117] border border-[#30363D] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#F0F6FC] flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-[#C7FF65]" />
                  <span>Delegate to Sub-Agent</span>
                </span>
                <span className="text-[10px] font-mono text-[#8B949E]">Optional Background Task</span>
              </div>

              {/* Role Selector Pills */}
              <div className="flex flex-wrap gap-1.5">
                {[
                  'Code Architect',
                  'Test Engineer',
                  'UI Designer',
                  'Security Auditor',
                  'Refactor Specialist',
                ].map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setSpawnRole(role)}
                    className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                      spawnRole === role
                        ? 'bg-[#21262D] border border-[#C7FF65] text-[#C7FF65]'
                        : 'bg-[#161B22] border border-[#30363D] text-[#8B949E] hover:text-[#F0F6FC]'
                    }`}
                  >
                    {role}
                  </button>
                ))}
              </div>

              {/* Task Prompt Form */}
              <form onSubmit={handleSpawnSubagent} className="space-y-2">
                <textarea
                  rows={2}
                  value={spawnPrompt}
                  onChange={(e) => setSpawnPrompt(e.target.value)}
                  placeholder={`Describe what the ${spawnRole} should execute in ${activeWorkspaceId}...`}
                  className="w-full bg-[#161B22] border border-[#30363D] focus:border-[#C7FF65] rounded-lg p-2 text-xs text-[#F0F6FC] outline-none resize-none"
                />

                {spawnSuccess && (
                  <div className="p-2 rounded bg-[#C7FF65]/10 border border-[#C7FF65]/30 text-[11px] text-[#C7FF65]">
                    {spawnSuccess}
                  </div>
                )}
                {spawnError && (
                  <div className="p-2 rounded bg-[#DA3633]/15 border border-[#DA3633]/30 text-[11px] text-[#FF727A]">
                    {spawnError}
                  </div>
                )}

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={spawningTask || !spawnPrompt.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#C7FF65] text-[#0D1117] font-semibold text-xs hover:bg-[#D4FF80] disabled:opacity-50 transition-colors cursor-pointer"
                    title="Launch autonomous sub-agent"
                    aria-label="Launch autonomous sub-agent"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>{spawningTask ? 'Spawning...' : 'Spawn Sub-Agent'}</span>
                  </button>
                </div>
              </form>
            </div>

            {/* Task List Section */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs text-[#8B949E] font-semibold uppercase tracking-wider">
                <span>Task Stream ({tasks.length})</span>
                {running.length > 0 && (
                  <span className="text-[#C7FF65] font-mono text-[10px] animate-pulse">
                    ● Real-Time Progress
                  </span>
                )}
              </div>

              {tasks.length === 0 ? (
                <div className="py-8 text-center rounded-xl border border-dashed border-[#30363D] p-4 text-xs text-[#8B949E]">
                  No tasks dispatched yet. Use the delegation composer above to launch an autonomous sub-agent.
                </div>
              ) : (
                tasks.map((task) => {
                  const isRunning = task.status === 'running';
                  const isCompleted = task.status === 'completed';
                  const isFailed = task.status === 'failed';

                  return (
                    <div
                      key={task.id}
                      className="p-3 rounded-xl bg-[#0D1117] border border-[#30363D] hover:border-[#8B949E]/50 transition-colors space-y-2"
                    >
                      {/* Task Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-[#F0F6FC]">
                              {task.role}
                            </span>
                            <span
                              className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                                isRunning
                                  ? 'bg-[#C7FF65]/15 text-[#C7FF65] border border-[#C7FF65]/40 animate-pulse'
                                  : isCompleted
                                  ? 'bg-[#238636]/20 text-[#3FB950] border border-[#238636]/40'
                                  : isFailed
                                  ? 'bg-[#DA3633]/20 text-[#FF727A] border border-[#DA3633]/40'
                                  : 'bg-[#21262D] text-[#8B949E]'
                              }`}
                            >
                              {task.status}
                            </span>
                          </div>
                          <p className="text-[11px] text-[#8B949E] line-clamp-2 mt-1">
                            {task.taskPrompt}
                          </p>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 shrink-0">
                          {isRunning && (
                            <button
                              type="button"
                              onClick={() => handleCancelSubagentTask(task.id)}
                              className="px-2 py-0.5 rounded bg-[#DA3633]/20 hover:bg-[#DA3633]/40 text-[#FF727A] text-[10px] font-semibold border border-[#DA3633]/40 cursor-pointer"
                              title="Cancel running task"
                              aria-label="Cancel running task"
                            >
                              Cancel
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteSubagentTask(task.id)}
                            className="p-1 rounded text-[#8B949E] hover:text-[#FF727A] cursor-pointer"
                            title="Delete task record"
                            aria-label={`Delete task: ${task.role}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Progress & Current Step */}
                      {task.currentStep && (
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] font-mono text-[#8B949E]">
                            <span className="truncate max-w-[200px]">{task.currentStep}</span>
                            <span>{task.progressPercent ?? 50}%</span>
                          </div>
                          <div className="w-full h-1 bg-[#21262D] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#C7FF65] transition-all duration-300"
                              style={{ width: `${task.progressPercent ?? 50}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Output snippet if completed */}
                      {task.resultSummary && (
                        <div className="p-2 rounded bg-[#161B22] border border-[#30363D] text-[11px] font-mono text-[#F0F6FC]/90 max-h-24 overflow-y-auto">
                          {task.resultSummary}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Drawer Footer */}
          <div className="p-3 border-t border-[#30363D] shrink-0 flex items-center justify-between text-xs bg-[#0D1117]">
            <span className="text-[#8B949E]">
              Autonomous bounded sub-agents
            </span>
            {onNavigateToAgents && (
              <button
                type="button"
                onClick={() => {
                  setShowTasksDrawer(false);
                  onNavigateToAgents();
                }}
                className="text-[#388BFD] hover:underline font-medium flex items-center gap-1 cursor-pointer"
              >
                <span>Full Agents Hub →</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderSingleToolCard = (tc: ToolCallRecord, idx: number) => {
    const toolName = tc.name || tc.toolName || 'tool';
    const isBuildOrApk =
      toolName === 'build_apk' || toolName === 'verify_apk' || toolName === 'build_project';
    const isCommand = toolName === 'run_command';
    const isFileMutation = toolName === 'write_file' || toolName === 'delete_file';
    const isFileInspection =
      toolName === 'read_file' ||
      toolName === 'list_files' ||
      toolName === 'search_files' ||
      toolName === 'audit_manifest';
    const isToolchain =
      toolName === 'check_toolchain' ||
      toolName === 'install_toolchain' ||
      toolName === 'download_bundle';
    const isRunning =
      tc.status === 'running' || tc.status === 'queued' || tc.status === 'awaiting_approval';
    const isSuccess = tc.status === 'succeeded' || tc.status === 'completed';

    // 1. Android APK Build & Verification Card
    if (isBuildOrApk) {
      const outputText = tc.output || tc.stdout || '';
      const sizeMatch = outputText.match(/Size:\s*([^\r\n]+)/i);
      const pkgMatch = outputText.match(/Package(?:\s*Name(?:\s*Hint)?)?:\s*([^\r\n]+)/i);
      const pathMatch = outputText.match(/(?:File|Path|Artifact):\s*([^\r\n]+)/i);
      const isRelease =
        String(tc.args?.variant || '').toLowerCase() === 'release' ||
        outputText.toLowerCase().includes('release');

      const rawArtifact = pathMatch ? pathMatch[1].trim() : '';
      const artifactFilename = rawArtifact.split(/[\\/]/).pop() || (isRelease ? 'kotlin-notes-apk-release.apk' : 'android-workstation-debug.apk');
      const artifactDownloadUrl = `/api/artifacts/${encodeURIComponent(artifactFilename)}`;

      return (
        <div
          key={idx}
          className={`rounded-xl border p-3.5 transition-all text-xs space-y-2.5 ${
            isRunning
              ? 'bg-[#121820] border-[#C7FF65]/50 shadow-sm'
              : isSuccess
              ? 'bg-[#0E1711] border-[#238636]/40 shadow-sm'
              : 'bg-[#1C1412] border-[#DA3633]/40'
          }`}
        >
          {/* Header Row */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 font-mono">
              <div className="p-1.5 rounded-lg bg-[#C7FF65]/10 border border-[#C7FF65]/30 text-[#C7FF65]">
                <FileCode className="w-4 h-4" />
              </div>
              <div>
                <div className="font-semibold text-[#F0F6FC] text-sm">
                  {toolName === 'build_apk'
                    ? `Android APK Build (${isRelease ? 'Release · Optimized' : 'Debug'})`
                    : toolName === 'verify_apk'
                    ? 'APK Container Integrity & Checksum Verification'
                    : 'Workspace Android Project Build'}
                </div>
                <div className="text-[11px] text-[#8B949E]">
                  AAPT2 + D8 Dexer + ZipAlign pipeline
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {tc.durationMs ? (
                <span className="text-[11px] font-mono text-[#8B949E] px-2 py-0.5 rounded bg-[#161B22] border border-[#30363D]">
                  {tc.durationMs}ms
                </span>
              ) : null}
              {isRunning ? (
                <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-[#C7FF65]/15 text-[#C7FF65] border border-[#C7FF65]/40 flex items-center gap-1.5 animate-pulse">
                  <RefreshCw className="w-3 h-3 animate-spin" /> RUNNING…
                </span>
              ) : isSuccess ? (
                <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-[#238636]/20 text-[#3FB950] border border-[#238636]/40 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> VERIFIED
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-[#DA3633]/20 text-[#F85149] border border-[#DA3633]/40 flex items-center gap-1">
                  <XCircle className="w-3.5 h-3.5" /> FAILED
                </span>
              )}
            </div>
          </div>

          {/* Quick Metrics Bar & Direct Download Action */}
          <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
            <div className="flex items-center gap-2 flex-wrap">
              {sizeMatch && (
                <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-bold bg-[#C7FF65]/15 text-[#C7FF65] border border-[#C7FF65]/30 flex items-center gap-1.5 shadow-sm">
                  <span>📦</span>
                  <span>{sizeMatch[1].trim()}</span>
                </span>
              )}
              {pkgMatch && (
                <span className="px-2.5 py-1 rounded-lg text-xs font-mono bg-[#161B22] text-[#8B949E] border border-[#30363D]">
                  <span className="text-[#F0F6FC]">{pkgMatch[1].trim()}</span>
                </span>
              )}
              <span className="px-2 py-1 rounded-lg text-[11px] font-mono bg-[#161B22] text-[#58A6FF] border border-[#30363D]/80">
                classes.dex verified
              </span>
              <span className="px-2 py-1 rounded-lg text-[11px] font-mono bg-[#161B22] text-[#58A6FF] border border-[#30363D]/80">
                4-byte zipalign
              </span>
            </div>

            {isSuccess && (
              <a
                href={artifactDownloadUrl}
                download={artifactFilename}
                className="px-3 py-1.5 rounded-lg bg-[#C7FF65] hover:bg-[#B5F545] text-[#0A0D10] font-bold text-xs flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer"
                title={`Download ${artifactFilename}`}
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download APK</span>
              </a>
            )}
          </div>

          {pathMatch && (
            <div className="text-[11px] font-mono text-[#8B949E] truncate">
              Artifact: <span className="text-[#F0F6FC]">{pathMatch[1].trim()}</span>
            </div>
          )}

          {/* Collapsible Build & Verification Output */}
          <details className="group rounded-lg bg-[#090D12] border border-[#30363D]/60 overflow-hidden">
            <summary className="px-3 py-1.5 cursor-pointer flex items-center justify-between text-[#8B949E] hover:text-[#F0F6FC] font-mono text-[11px] list-none select-none">
              <span className="flex items-center gap-1.5">
                <TerminalIcon className="w-3 h-3 text-[#C7FF65]" />
                <span>Compiler & Packaging Execution Log</span>
              </span>
              <ChevronDown className="w-3.5 h-3.5 group-open:rotate-180 transition-transform" />
            </summary>
            <div className="p-2.5 border-t border-[#30363D]/50 bg-[#090D12] space-y-1.5 font-mono text-[11px]">
              <pre className="text-[#8B949E] overflow-x-auto max-h-56 leading-relaxed whitespace-pre-wrap">
                {outputText || (isRunning ? 'Executing build pipeline…' : '(Build completed without error logs)')}
              </pre>
            </div>
          </details>
        </div>
      );
    }

    // 2. Terminal Shell Command Execution Card
    if (isCommand) {
      const cmd = String(tc.args?.command || '');
      const cwd = String(tc.args?.cwd || tc.cwd || '');
      const out = tc.output || tc.stdout || tc.stderr || '';
      const exitCode = tc.exitCode ?? (isSuccess ? 0 : 1);

      return (
        <div
          key={idx}
          className={`rounded-xl border bg-[#0E1217] p-3 text-xs space-y-2 font-mono ${
            isRunning ? 'border-[#C7FF65]/50' : 'border-[#30363D]'
          }`}
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 max-w-[80%] min-w-0">
              <TerminalIcon className="w-3.5 h-3.5 text-[#C7FF65] shrink-0" />
              <code className="px-2 py-0.5 rounded bg-[#161B22] border border-[#30363D] text-[#7EE787] font-bold text-xs truncate">
                {cmd}
              </code>
              {cwd && (
                <span className="text-[10px] text-[#8B949E] truncate hidden sm:inline">
                  in {cwd}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {tc.durationMs ? (
                <span className="text-[10px] text-[#8B949E]">{tc.durationMs}ms</span>
              ) : null}
              {isRunning ? (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold border bg-[#C7FF65]/15 text-[#C7FF65] border-[#C7FF65]/40 flex items-center gap-1 animate-pulse">
                  <RefreshCw className="w-2.5 h-2.5 animate-spin" /> RUNNING…
                </span>
              ) : (
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                    exitCode === 0
                      ? 'bg-[#238636]/20 text-[#3FB950] border-[#238636]/40'
                      : 'bg-[#DA3633]/20 text-[#F85149] border-[#DA3633]/40'
                  }`}
                >
                  exit {exitCode}
                </span>
              )}
            </div>
          </div>

          {out && (
            <div className="rounded-lg bg-[#090D12] border border-[#21262D] p-2.5 text-[11px] max-h-48 overflow-y-auto overflow-x-auto text-[#C9D1D9] leading-relaxed whitespace-pre-wrap select-text">
              {out}
            </div>
          )}
        </div>
      );
    }

    // 3. File Mutation Card (write_file, delete_file)
    if (isFileMutation) {
      const filePath = String(tc.args?.path || '');
      const isDelete = toolName === 'delete_file';
      return (
        <div
          key={idx}
          className={`rounded-xl border bg-[#161B22] p-3 text-xs space-y-2 ${
            isRunning ? 'border-[#C7FF65]/50' : 'border-[#30363D]'
          }`}
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 font-mono min-w-0">
              <FileCode className={`w-3.5 h-3.5 shrink-0 ${isDelete ? 'text-[#F85149]' : 'text-[#F0883E]'}`} />
              <span className="font-semibold text-[#F0F6FC]">
                {isRunning ? (isDelete ? 'Deleting' : 'Writing') : isDelete ? 'Deleted' : 'Modified'}:
              </span>
              <span className="text-[#58A6FF] truncate">{filePath}</span>
            </div>
            <div className="flex items-center gap-2">
              {onNavigateToProjects && (
                <button
                  type="button"
                  onClick={onNavigateToProjects}
                  className="px-2 py-0.5 rounded text-[10px] font-mono text-[#58A6FF] hover:bg-[#58A6FF]/10 transition-colors flex items-center gap-1 cursor-pointer"
                  title="Open file in editor"
                >
                  <span>Editor</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </button>
              )}
              {isRunning ? (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-[#C7FF65]/15 text-[#C7FF65] border border-[#C7FF65]/40 flex items-center gap-1 animate-pulse">
                  <RefreshCw className="w-2.5 h-2.5 animate-spin" /> RUNNING…
                </span>
              ) : (
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                    isSuccess
                      ? 'bg-[#238636]/20 text-[#3FB950] border border-[#238636]/40'
                      : 'bg-[#DA3633]/20 text-[#F85149] border border-[#DA3633]/40'
                  }`}
                >
                  {isSuccess ? 'APPLIED' : 'FAILED'}
                </span>
              )}
            </div>
          </div>
          {tc.output && (
            <div className="text-[11px] font-mono text-[#8B949E] bg-[#0D1117] p-2 rounded border border-[#21262D] truncate">
              {tc.output}
            </div>
          )}
        </div>
      );
    }

    // 4. File Inspection / Directory / Manifest Audit Card
    if (isFileInspection) {
      const isAudit = toolName === 'audit_manifest';
      const pathLabel = String(tc.args?.path || tc.args?.query || tc.args?.subdirectory || '');
      return (
        <div
          key={idx}
          className={`rounded-xl border bg-[#161B22] p-3 text-xs space-y-2 ${
            isRunning ? 'border-[#C7FF65]/50' : 'border-[#30363D]'
          }`}
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 font-mono min-w-0">
              <FolderGit2 className="w-3.5 h-3.5 text-[#58A6FF] shrink-0" />
              <span className="font-semibold text-[#F0F6FC]">
                {isAudit
                  ? 'Manifest Security Audit'
                  : toolName === 'read_file'
                  ? 'Read Workspace File'
                  : toolName === 'search_files'
                  ? 'Workspace Search'
                  : 'Scanned Directory'}
              </span>
              {pathLabel && <span className="text-[#8B949E] text-[11px] truncate">({pathLabel})</span>}
            </div>
            {isRunning ? (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-[#C7FF65]/15 text-[#C7FF65] border border-[#C7FF65]/40 flex items-center gap-1 animate-pulse">
                <RefreshCw className="w-2.5 h-2.5 animate-spin" /> RUNNING…
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#21262D] text-[#8B949E] border border-[#30363D]">
                {isSuccess ? 'INSPECTED' : 'FAILED'}
              </span>
            )}
          </div>
          {tc.output && (
            <details className="group rounded-lg bg-[#090D12] border border-[#21262D] overflow-hidden text-[11px]">
              <summary className="px-2.5 py-1.5 cursor-pointer text-[#8B949E] hover:text-[#F0F6FC] font-mono flex items-center justify-between list-none">
                <span>View inspection details</span>
                <ChevronDown className="w-3 h-3 group-open:rotate-180 transition-transform" />
              </summary>
              <pre className="p-2.5 border-t border-[#21262D] font-mono text-[#C9D1D9] max-h-48 overflow-y-auto whitespace-pre-wrap">
                {tc.output}
              </pre>
            </details>
          )}
        </div>
      );
    }

    // 5. Toolchain / Bundle Card
    if (isToolchain) {
      const outText = tc.output || '';
      const isArm = outText.includes('arm64');
      return (
        <div
          key={idx}
          className={`rounded-xl border bg-[#161B22] p-3 text-xs space-y-2 ${
            isRunning ? 'border-[#C7FF65]/50' : 'border-[#30363D]'
          }`}
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 font-mono">
              <Cpu className="w-3.5 h-3.5 text-[#C7FF65]" />
              <span className="font-semibold text-[#F0F6FC]">
                {toolName === 'check_toolchain'
                  ? 'Build Toolchain & SDK Telemetry'
                  : toolName === 'install_toolchain'
                  ? 'Toolchain Installation'
                  : 'Runtime Bundle Package'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#21262D] text-[#7EE787] border border-[#30363D]">
                {isArm ? 'ARM64 Environment' : 'Host Architecture'}
              </span>
              {isRunning ? (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#C7FF65]/15 text-[#C7FF65] border border-[#C7FF65]/40 flex items-center gap-1 animate-pulse">
                  <RefreshCw className="w-2.5 h-2.5 animate-spin" /> PROBING…
                </span>
              ) : (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#238636]/20 text-[#3FB950] border border-[#238636]/40">
                  READY
                </span>
              )}
            </div>
          </div>
          {outText && (
            <details className="group rounded-lg bg-[#090D12] border border-[#21262D] overflow-hidden text-[11px]">
              <summary className="px-2.5 py-1.5 cursor-pointer text-[#8B949E] hover:text-[#F0F6FC] font-mono flex items-center justify-between list-none">
                <span>Compiler paths & SDK components</span>
                <ChevronDown className="w-3 h-3 group-open:rotate-180 transition-transform" />
              </summary>
              <pre className="p-2.5 border-t border-[#21262D] font-mono text-[#C9D1D9] max-h-48 overflow-y-auto whitespace-pre-wrap">
                {outText}
              </pre>
            </details>
          )}
        </div>
      );
    }

    // Default Fallback Tool Card
    return (
      <details
        key={idx}
        className="group rounded-lg bg-[#0D1117] border border-[#30363D] overflow-hidden text-xs"
      >
        <summary className="px-3 py-2 cursor-pointer flex items-center justify-between text-[#8B949E] hover:text-[#F0F6FC] transition-colors list-none">
          <div className="flex items-center gap-2 font-mono">
            <Code2 className="w-3.5 h-3.5 text-[#388BFD]" />
            <span className="font-semibold text-[#F0F6FC]">{toolName}</span>
            <span className="text-[11px] text-[#8B949E]">
              {tc.status === 'succeeded' ? '(succeeded)' : `(${tc.status})`}
            </span>
          </div>
          <ChevronDown className="w-3.5 h-3.5 group-open:rotate-180 transition-transform" />
        </summary>
        <div className="p-3 border-t border-[#30363D] space-y-2 bg-[#0D1117]">
          {tc.args && (
            <div>
              <div className="text-[10px] font-semibold text-[#8B949E] uppercase">Arguments</div>
              <pre className="p-2 rounded bg-[#161B22] text-[11px] font-mono text-[#F0F6FC] overflow-x-auto">
                {JSON.stringify(tc.args, null, 2)}
              </pre>
            </div>
          )}
          {(tc.output || tc.stdout || tc.stderr) && (
            <div>
              <div className="text-[10px] font-semibold text-[#8B949E] uppercase">Output</div>
              <pre className="p-2 rounded bg-[#161B22] text-[11px] font-mono text-[#8B949E] overflow-x-auto max-h-48">
                {tc.output || tc.stdout || tc.stderr}
              </pre>
            </div>
          )}
        </div>
      </details>
    );
  };

  // Grouped Activity Sequence timeline per assistant response
  const renderInlineActivitySequence = (
    toolCalls: ToolCallRecord[] | undefined,
    messageId: string,
    skillsUsed?: string[]
  ) => {
    if (!toolCalls || toolCalls.length === 0) return null;

    const getName = (tc: ToolCallRecord) => tc.name || tc.toolName || '';
    const isExpanded = expandedSequences[messageId] ?? true;
    const hasRunning = toolCalls.some(
      (tc) => tc.status === 'running' || tc.status === 'queued' || tc.status === 'awaiting_approval'
    );
    const hasFailures = toolCalls.some((tc) => tc.status === 'failed' || tc.status === 'timed_out');
    const totalDuration = toolCalls.reduce((acc, tc) => acc + (tc.durationMs || 0), 0);
    const hasBuild = toolCalls.some((tc) => getName(tc) === 'build_apk' || getName(tc) === 'verify_apk');
    const hasCommand = toolCalls.some((tc) => getName(tc) === 'run_command');
    const hasFileEdit = toolCalls.some((tc) => getName(tc) === 'write_file' || getName(tc) === 'delete_file');
    const hasInspect = toolCalls.some(
      (tc) =>
        getName(tc) === 'read_file' ||
        getName(tc) === 'list_files' ||
        getName(tc) === 'search_files' ||
        getName(tc) === 'audit_manifest'
    );

    return (
      <div className="my-2.5 rounded-xl border border-[#30363D] bg-[#0E1217] overflow-hidden">
        {/* Grouped Sequence Header Button */}
        <button
          type="button"
          onClick={() => toggleSequence(messageId)}
          className="w-full px-3.5 py-2.5 flex items-center justify-between gap-3 text-left hover:bg-[#161B22] transition-colors cursor-pointer select-none"
        >
          <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
            <div className="relative flex items-center justify-center">
              {hasRunning ? (
                <div className="w-2.5 h-2.5 rounded-full bg-[#C7FF65] animate-ping" />
              ) : hasFailures ? (
                <div className="w-2.5 h-2.5 rounded-full bg-[#DA3633]" />
              ) : (
                <div className="w-2.5 h-2.5 rounded-full bg-[#C7FF65]" />
              )}
            </div>
            <span className="font-mono text-xs font-semibold text-[#F0F6FC] shrink-0">
              Agent Execution ({toolCalls.length} step{toolCalls.length > 1 ? 's' : ''})
            </span>

            {/* Quick Activity Badges */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {skillsUsed && skillsUsed.length > 0 && (
                <div className="flex items-center gap-1">
                  {skillsUsed.map((sk) => (
                    <span
                      key={sk}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenSkillPreview(sk);
                      }}
                      title={`Click to preview skill playbook: ${sk}`}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#C7FF65]/15 text-[#C7FF65] border border-[#C7FF65]/30 hover:bg-[#C7FF65]/25 cursor-pointer transition-colors"
                    >
                      <Sparkles className="w-2.5 h-2.5" />
                      {sk}
                    </span>
                  ))}
                </div>
              )}
              {hasBuild && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#C7FF65]/15 text-[#C7FF65] border border-[#C7FF65]/30">
                  APK Build
                </span>
              )}
              {hasCommand && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#161B22] text-[#7EE787] border border-[#30363D]">
                  Terminal
                </span>
              )}
              {hasFileEdit && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#161B22] text-[#F0883E] border border-[#30363D]">
                  Files
                </span>
              )}
              {hasInspect && !hasFileEdit && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#161B22] text-[#58A6FF] border border-[#30363D]">
                  Workspace
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {totalDuration > 0 && (
              <span className="font-mono text-[10px] text-[#8B949E]">
                {totalDuration}ms
              </span>
            )}
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                hasRunning
                  ? 'bg-[#C7FF65]/15 text-[#C7FF65] border border-[#C7FF65]/40 animate-pulse'
                  : hasFailures
                  ? 'bg-[#DA3633]/20 text-[#F85149] border border-[#DA3633]/40'
                  : 'bg-[#238636]/20 text-[#3FB950] border border-[#238636]/40'
              }`}
            >
              {hasRunning ? 'RUNNING…' : hasFailures ? 'FAILED' : 'COMPLETED'}
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-[#8B949E] transition-transform ${
                isExpanded ? 'rotate-180' : ''
              }`}
            />
          </div>
        </button>

        {/* Expandable Step-by-Step Vertical Timeline */}
        {isExpanded && (
          <div className="p-3 border-t border-[#30363D] bg-[#090D12] space-y-2.5">
            <div className="border-l-2 border-[#30363D]/80 ml-2 pl-3.5 space-y-2.5 py-1">
              {toolCalls.map((tc, idx) => renderSingleToolCard(tc, idx))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderInFlightActivityStream = () => {
    if (!sending) return null;
    const convEvents = events
      .filter((e) => e.conversationId === activeConv?.id)
      .slice(0, 5);
    const latestEvent = convEvents[0];

    return (
      <div className="rounded-xl sm:rounded-2xl border border-[#30363D] bg-[#161B22] p-4 space-y-3 shadow-lg">
        <div className="flex items-center justify-between gap-3 text-xs flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="relative flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-[#C7FF65] animate-ping opacity-75" />
              <div className="absolute w-2 h-2 rounded-full bg-[#C7FF65]" />
            </div>
            <span className="font-semibold text-[#F0F6FC]">
              {latestEvent?.title || `Agent Reasoning with ${currentModelId}...`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-[#8B949E] uppercase tracking-wider">
              {latestEvent?.state || 'RUNNING'}
            </span>
            <button
              type="button"
              onClick={onStopGeneration}
              className="px-2.5 py-1 rounded-lg bg-[#DA3633]/20 hover:bg-[#DA3633]/40 text-[#FF727A] border border-[#DA3633]/50 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
              title="Stop current agent execution"
            >
              <Square className="w-3 h-3" />
              <span>Stop</span>
            </button>
          </div>
        </div>

        {latestEvent?.description && (
          <div className="text-xs text-[#8B949E] font-mono leading-relaxed">
            {latestEvent.description}
          </div>
        )}

        {latestEvent?.stdout && (
          <div className="rounded-lg bg-[#090D12] border border-[#21262D] p-2.5 text-[11px] font-mono text-[#7EE787] max-h-40 overflow-y-auto whitespace-pre-wrap">
            {latestEvent.stdout}
          </div>
        )}
      </div>
    );
  };

  const renderHistorySidebar = (isMobileDrawer: boolean) => {
    const allConvs = conversations && conversations.length > 0 ? conversations : (activeConv ? [activeConv] : []);
    const groups = groupConversationsByDate(allConvs, historySearch);
    const totalCount = allConvs.length;

    return (
      <div
        className={`flex flex-col h-full bg-[#161B22] border-r border-[#30363D] select-none ${
          isMobileDrawer ? 'w-80 max-w-[85vw]' : 'w-64 xl:w-72'
        }`}
      >
        {/* Sidebar Top Header */}
        <div className="h-12 px-3 border-b border-[#30363D] flex items-center justify-between shrink-0 bg-[#161B22]">
          <div className="flex items-center gap-2 min-w-0">
            <ObsidianCrystalLogo withBadge={false} className="w-4 h-4 shrink-0" />
            <span className="font-semibold text-xs text-[#F0F6FC] tracking-wider uppercase font-mono">
              Chat History
            </span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-[#21262D] text-[#8B949E] border border-[#30363D]">
              {totalCount}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setIsHistoryOpen(false)}
            className="p-1.5 rounded-lg text-[#8B949E] hover:text-[#F0F6FC] hover:bg-[#21262D] transition-colors cursor-pointer"
            title="Collapse history"
            aria-label="Collapse history"
          >
            {isMobileDrawer ? <X className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {/* Action Bar: "+ New Chat" Button & Search */}
        <div className="p-3 border-b border-[#30363D] space-y-2 shrink-0 bg-[#0D1117]/60">
          <button
            type="button"
            onClick={() => {
              onNewConversation?.();
              if (isMobileDrawer) setIsHistoryOpen(false);
            }}
            title="Start New Chat (Ctrl+K)"
            aria-label="Start New Chat"
            className="w-full py-2.5 px-3 rounded-xl bg-[#21262D] hover:bg-[#30363D] text-[#F0F6FC] hover:text-[#C7FF65] border border-[#30363D] hover:border-[#C7FF65]/40 text-xs font-semibold flex items-center justify-between transition-all group shadow-sm cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-[#C7FF65] group-hover:scale-110 transition-transform" />
              <span>New Chat</span>
            </div>
            <span className="text-[10px] font-mono text-[#8B949E] px-1.5 py-0.2 rounded bg-[#161B22] border border-[#30363D]">
              Ctrl+K
            </span>
          </button>

          {/* Quick Search in History */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#8B949E] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="Search chat history..."
              className="w-full pl-8 pr-7 py-1.5 rounded-lg bg-[#0D1117] border border-[#30363D] text-xs text-[#F0F6FC] placeholder-[#8B949E] focus:outline-none focus:border-[#C7FF65]/50 transition-colors"
            />
            {historySearch && (
              <button
                type="button"
                onClick={() => setHistorySearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8B949E] hover:text-[#F0F6FC] p-0.5 cursor-pointer"
                title="Clear search"
                aria-label="Clear search"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Sessions Historique List (Grouped by Date) */}
        <div className="flex-1 overflow-y-auto p-2 space-y-4">
          {groups.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#8B949E] space-y-2">
              <History className="w-6 h-6 mx-auto opacity-40 text-[#8B949E]" />
              <p>{historySearch ? 'No matching chats found' : 'No previous chat history'}</p>
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.label} className="space-y-1">
                {/* Group Date Header */}
                <div className="px-2.5 py-1 text-[10.5px] font-semibold tracking-wider uppercase text-[#8B949E]/80 font-mono">
                  {group.label}
                </div>

                {/* Group Sessions */}
                <div className="space-y-0.5">
                  {group.conversations.map((c) => {
                    const isSelected = c.id === activeConv?.id;
                    const isEditing = editingSessionId === c.id;
                    const isConfirmingDelete = sessionToDeleteId === c.id;

                    if (isEditing) {
                      return (
                        <div
                          key={c.id}
                          className="p-1.5 rounded-lg bg-[#21262D] border border-[#C7FF65]/50 flex items-center gap-1.5"
                        >
                          <input
                            type="text"
                            value={editingTitleText}
                            onChange={(e) => setEditingTitleText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveRename(c.id);
                              if (e.key === 'Escape') setEditingSessionId(null);
                            }}
                            autoFocus
                            className="flex-1 px-1.5 py-0.5 bg-[#0D1117] border border-[#30363D] rounded text-xs text-[#F0F6FC] focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveRename(c.id)}
                            className="p-1 rounded text-[#C7FF65] hover:bg-[#30363D] cursor-pointer"
                            title="Save title"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingSessionId(null)}
                            className="p-1 rounded text-[#8B949E] hover:bg-[#30363D] cursor-pointer"
                            title="Cancel"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    }

                    if (isConfirmingDelete) {
                      return (
                        <div
                          key={c.id}
                          className="p-2 rounded-lg bg-[#1C1412] border border-[#DA3633]/60 space-y-1.5 animate-in fade-in duration-100"
                        >
                          <div className="text-[11px] text-[#F0F6FC] font-medium flex items-center justify-between">
                            <span>Delete this session?</span>
                            <span className="text-[10px] text-[#DA3633]">Cannot undo</span>
                          </div>
                          <div className="flex items-center gap-1.5 justify-end">
                            <button
                              type="button"
                              onClick={() => setSessionToDeleteId(null)}
                              className="px-2 py-0.5 rounded text-[11px] bg-[#21262D] text-[#8B949E] hover:text-[#F0F6FC] cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleDeleteSession(c.id, e)}
                              className="px-2 py-0.5 rounded text-[11px] bg-[#DA3633] text-[#F0F6FC] font-semibold hover:bg-[#B62324] cursor-pointer"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={c.id}
                        onClick={() => {
                          onSelectConversation?.(c.id);
                          if (isMobileDrawer) setIsHistoryOpen(false);
                        }}
                        className={`group relative flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border text-xs transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[#21262D] border-[#C7FF65]/40 text-[#F0F6FC] shadow-xs'
                            : 'border-transparent hover:bg-[#21262D]/60 text-[#8B949E] hover:text-[#F0F6FC]'
                        }`}
                        title={c.title}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <MessageSquare
                            className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                              isSelected ? 'text-[#C7FF65]' : 'text-[#8B949E] group-hover:text-[#F0F6FC]'
                            }`}
                          />
                          <span className="truncate font-medium">
                            {c.title}
                          </span>
                        </div>

                        {/* Hover Action Buttons */}
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={(e) => handleStartRename(c, e)}
                            className="p-1 rounded text-[#8B949E] hover:text-[#F0F6FC] hover:bg-[#30363D] transition-colors cursor-pointer"
                            title="Rename chat"
                            aria-label={`Rename chat: ${c.title}`}
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSessionToDeleteId(c.id);
                            }}
                            className="p-1 rounded text-[#8B949E] hover:text-[#DA3633] hover:bg-[#30363D] transition-colors cursor-pointer"
                            title="Delete chat"
                            aria-label={`Delete chat: ${c.title}`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Sidebar Footer: Active Workspace & Telemetry */}
        <div className="p-2.5 border-t border-[#30363D] bg-[#0D1117]/40 flex items-center justify-between text-[11px] text-[#8B949E] font-mono shrink-0">
          <div className="flex items-center gap-1.5 truncate">
            <span className="w-1.5 h-1.5 rounded-full bg-[#C7FF65]" />
            <span className="truncate">{activeWorkspaceId}</span>
          </div>
          <span>{totalCount} {totalCount === 1 ? 'chat' : 'chats'}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full w-full max-w-full overflow-hidden bg-[#0D1117] text-[#F0F6FC] relative">
      {/* Desktop Persistent / Collapsible Left Sidebar */}
      {isHistoryOpen && (
        <div className="hidden md:block h-full shrink-0 animate-in slide-in-from-left duration-150">
          {renderHistorySidebar(false)}
        </div>
      )}

      {/* Mobile Off-Canvas Slide-Over History Drawer */}
      {isHistoryOpen && (
        <div
          className="fixed inset-0 z-50 flex md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Chat Sessions History"
        >
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setIsHistoryOpen(false)}
          />
          <div className="relative z-10 h-full animate-in slide-in-from-left duration-200">
            {renderHistorySidebar(true)}
          </div>
        </div>
      )}

      {/* Main Chat Flow (Full Width or beside History Sidebar) */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative">
        {/* =========================================================================
            CHAT TOP-RIGHT TOOLBAR & HEADER (Clean, compact, works on mobile & desktop)
            ========================================================================= */}
        <div className="h-12 px-3 sm:px-6 border-b border-[#30363D] bg-[#161B22]/80 backdrop-blur-md flex items-center justify-between gap-3 shrink-0 z-20">
          {/* Left: History Toggle, New Chat, Session Title, and Model Switcher */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {/* 1. Toggle History Sidebar Button */}
            <button
              type="button"
              onClick={() => setIsHistoryOpen((v) => !v)}
              className={`p-1.5 rounded-lg border transition-all cursor-pointer flex items-center justify-center shrink-0 ${
                isHistoryOpen
                  ? 'bg-[#21262D] border-[#C7FF65]/50 text-[#C7FF65]'
                  : 'bg-[#161B22] border-[#30363D] text-[#8B949E] hover:text-[#F0F6FC] hover:border-[#8B949E]'
              }`}
              title={isHistoryOpen ? 'Collapse Chat History' : 'Open Chat History & Sessions'}
              aria-label="Toggle Chat History"
            >
              <PanelLeft className="w-4 h-4" />
            </button>

            {/* 2. Quick "+ New Chat" Button directly in Header */}
            <button
              type="button"
              onClick={() => onNewConversation?.()}
              className="px-2.5 py-1.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] hover:border-[#C7FF65]/40 text-[#F0F6FC] hover:text-[#C7FF65] text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 shadow-xs"
              title="Start New Chat (Ctrl+K)"
              aria-label="Start New Chat"
            >
              <Plus className="w-3.5 h-3.5 text-[#C7FF65]" />
              <span className="hidden sm:inline">New Chat</span>
            </button>

            {/* 3. Active Conversation Title with Click-to-Rename */}
            <div className="flex items-center gap-1.5 min-w-0 max-w-[130px] sm:max-w-[220px] md:max-w-[280px] lg:max-w-[360px]">
              {editingSessionId === activeConv?.id ? (
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={editingTitleText}
                    onChange={(e) => setEditingTitleText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') activeConv && handleSaveRename(activeConv.id);
                      if (e.key === 'Escape') setEditingSessionId(null);
                    }}
                    autoFocus
                    className="px-2 py-0.5 bg-[#0D1117] border border-[#C7FF65]/60 rounded-md text-xs text-[#F0F6FC] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => activeConv && handleSaveRename(activeConv.id)}
                    className="p-1 text-[#C7FF65] hover:bg-[#21262D] rounded"
                    title="Save title"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingSessionId(null)}
                    className="p-1 text-[#8B949E] hover:bg-[#21262D] rounded"
                    title="Cancel"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => activeConv && handleStartRename(activeConv)}
                  className="group flex items-center gap-1.5 text-left truncate cursor-pointer rounded px-1 -mx-1 hover:bg-[#21262D]/60 transition-colors"
                  title={`Active session: ${activeConv?.title || 'OBSIDIAN AI Workstation'} (Click to rename)`}
                >
                  <span className="font-semibold text-xs sm:text-sm text-[#F0F6FC] group-hover:text-[#C7FF65] transition-colors truncate">
                    {activeConv?.title || 'OBSIDIAN AI Workstation'}
                  </span>
                  <Pencil className="w-3 h-3 text-[#8B949E] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </button>
              )}

              <span className="text-[#30363D] hidden sm:inline">•</span>

              {/* 4. Active Model Pill */}
              <button
                onClick={() => setShowModelDropdown(true)}
                className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-[11px] font-mono text-[#8B949E] hover:text-[#C7FF65] transition-colors cursor-pointer truncate max-w-[150px] shrink-0"
                title={`Switch Active AI Model (Current: ${currentModelName})`}
                aria-label={`Switch Active AI Model (Current: ${currentModelName})`}
              >
                {isCurrentLocal ? (
                  <HardDrive className="w-3 h-3 text-[#C7FF65]" />
                ) : (
                  <Cloud className="w-3 h-3 text-[#388BFD]" />
                )}
                <span className="truncate">{currentModelId}</span>
                <ChevronDown className="w-2.5 h-2.5 opacity-60" />
              </button>
            </div>
          </div>

        {/* Right: The 3 compact icon buttons */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* 1. Optional Tasks & Sub-Agents Button */}
          <button
            onClick={() => {
              const next = !showTasksDrawer;
              setShowTasksDrawer(next);
              if (next) {
                setShowMcpModal(false);
                fetchSubagentTasks();
              }
            }}
            className={`relative px-2 sm:px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
              showTasksDrawer
                ? 'bg-[#21262D] border-[#C7FF65] text-[#C7FF65] shadow-xs'
                : 'bg-[#161B22] border-[#30363D] text-[#8B949E] hover:text-[#F0F6FC] hover:border-[#8B949E]'
            }`}
            title="View Autonomous Tasks & Sub-Agents"
            aria-label="View Autonomous Tasks & Sub-Agents"
          >
            <Layers className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Tasks</span>
            {runningTasksCount > 0 ? (
              <span className="flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-[#C7FF65] text-[#0D1117] text-[10px] font-bold animate-pulse">
                {runningTasksCount}
              </span>
            ) : currentTasks.length > 0 ? (
              <span className="w-1.5 h-1.5 rounded-full bg-[#8B949E]" />
            ) : null}
          </button>

          {/* 2. MCP Button */}
          <button
            onClick={() => {
              const next = !showMcpModal;
              setShowMcpModal(next);
              if (next) {
                setShowTasksDrawer(false);
                fetchMcpServers();
              }
            }}
            className={`relative px-2 sm:px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
              showMcpModal
                ? 'bg-[#21262D] border-[#C7FF65] text-[#C7FF65] shadow-xs'
                : 'bg-[#161B22] border-[#30363D] text-[#8B949E] hover:text-[#F0F6FC] hover:border-[#8B949E]'
            }`}
            title="Model Context Protocol (MCP) Hub"
            aria-label="Model Context Protocol (MCP) Hub"
          >
            <Cpu className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">MCP</span>
            {mcpServers.length > 0 && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#388BFD]" />
            )}
          </button>

          {/* 3. Preview Button */}
          <button
            onClick={() => {
              if (onNavigateToPreview) onNavigateToPreview();
            }}
            className="px-2 sm:px-2.5 py-1.5 rounded-lg border border-[#30363D] bg-[#161B22] hover:bg-[#21262D] text-[#8B949E] hover:text-[#C7FF65] hover:border-[#C7FF65]/60 text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer"
            title="Open Live Application Preview"
            aria-label="Open Live Application Preview"
          >
            <Eye className="w-3.5 h-3.5 text-[#C7FF65]" />
            <span className="hidden sm:inline text-[#F0F6FC]">Preview</span>
          </button>
        </div>
      </div>
      {/* If No Messages: Render the Spacious Reference Welcome Screen */}
      {!hasMessages ? (
        <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 py-4 sm:py-8 flex flex-col items-center justify-center">
          <div className="max-w-[1020px] w-full mx-auto flex flex-col items-center text-center space-y-5 sm:space-y-8">
            {/* Centered Obsidian Diamond Logo */}
            <div className="flex justify-center">
              <ObsidianCrystalLogo className="w-14 h-14 sm:w-20 sm:h-20 shadow-2xl rounded-2xl hover:scale-105 transition-transform duration-200" />
            </div>

            {/* Headline & Subtitle */}
            <div className="space-y-1.5 sm:space-y-2.5 max-w-2xl px-2">
              <h1 className="text-2xl sm:text-4xl font-bold tracking-tight text-[#F0F6FC]">
                What are we making today?
              </h1>
              <p className="text-xs sm:text-base text-[#8B949E]">
                One workspace for ideas, code, and creation.
              </p>
            </div>

            {/* 4 Clean Feature Cards (2x2 on Mobile, 4-Col on Desktop) */}
            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4 w-full text-left">
              {/* Card 1: Chat */}
              <div
                onClick={() => {
                  setActiveMode('Chat Mode');
                  textareaRef.current?.focus();
                }}
                className="group p-3 sm:p-6 rounded-xl sm:rounded-2xl bg-[#161B22] border border-[#30363D] hover:border-[#8B949E] hover:bg-[#1C2128] transition-all cursor-pointer flex flex-col justify-between min-h-[96px] sm:min-h-[170px]"
              >
                <div className="space-y-1.5 sm:space-y-2">
                  <div className="flex items-center justify-between">
                    <MessageSquare className="w-5 h-5 sm:w-6 sm:h-6 text-[#C7FF65] sm:text-[#F0F6FC] stroke-[1.75]" />
                    <span className="text-[#8B949E] group-hover:text-[#F0F6FC] transition-colors text-xs font-mono sm:hidden">
                      →
                    </span>
                  </div>
                  <h3 className="text-sm sm:text-lg font-semibold text-[#F0F6FC]">Chat</h3>
                  <p className="text-[11px] sm:text-sm text-[#8B949E] leading-tight sm:leading-relaxed line-clamp-2">
                    Have a conversation with your AI assistant.
                  </p>
                </div>
                <div className="hidden sm:block pt-3">
                  <span className="text-[#8B949E] group-hover:text-[#F0F6FC] transition-colors text-sm font-mono">
                    →
                  </span>
                </div>
              </div>

              {/* Card 2: Write */}
              <div
                onClick={() => {
                  setActiveMode('Write Mode');
                  textareaRef.current?.focus();
                }}
                className="group p-3 sm:p-6 rounded-xl sm:rounded-2xl bg-[#161B22] border border-[#30363D] hover:border-[#8B949E] hover:bg-[#1C2128] transition-all cursor-pointer flex flex-col justify-between min-h-[96px] sm:min-h-[170px]"
              >
                <div className="space-y-1.5 sm:space-y-2">
                  <div className="flex items-center justify-between">
                    <FileText className="w-5 h-5 sm:w-6 sm:h-6 text-[#C7FF65] sm:text-[#F0F6FC] stroke-[1.75]" />
                    <span className="text-[#8B949E] group-hover:text-[#F0F6FC] transition-colors text-xs font-mono sm:hidden">
                      →
                    </span>
                  </div>
                  <h3 className="text-sm sm:text-lg font-semibold text-[#F0F6FC]">Write</h3>
                  <p className="text-[11px] sm:text-sm text-[#8B949E] leading-tight sm:leading-relaxed line-clamp-2">
                    Create documents, plans, and structured content.
                  </p>
                </div>
                <div className="hidden sm:block pt-3">
                  <span className="text-[#8B949E] group-hover:text-[#F0F6FC] transition-colors text-sm font-mono">
                    →
                  </span>
                </div>
              </div>

              {/* Card 3: Code */}
              <div
                onClick={() => {
                  setActiveMode('Code Mode');
                  textareaRef.current?.focus();
                }}
                className="group p-3 sm:p-6 rounded-xl sm:rounded-2xl bg-[#161B22] border border-[#30363D] hover:border-[#8B949E] hover:bg-[#1C2128] transition-all cursor-pointer flex flex-col justify-between min-h-[96px] sm:min-h-[170px]"
              >
                <div className="space-y-1.5 sm:space-y-2">
                  <div className="flex items-center justify-between">
                    <Code2 className="w-5 h-5 sm:w-6 sm:h-6 text-[#C7FF65] sm:text-[#F0F6FC] stroke-[1.75]" />
                    <span className="text-[#8B949E] group-hover:text-[#F0F6FC] transition-colors text-xs font-mono sm:hidden">
                      →
                    </span>
                  </div>
                  <h3 className="text-sm sm:text-lg font-semibold text-[#F0F6FC]">Code</h3>
                  <p className="text-[11px] sm:text-sm text-[#8B949E] leading-tight sm:leading-relaxed line-clamp-2">
                    Build, debug, and improve your projects.
                  </p>
                </div>
                <div className="hidden sm:block pt-3">
                  <span className="text-[#8B949E] group-hover:text-[#F0F6FC] transition-colors text-sm font-mono">
                    →
                  </span>
                </div>
              </div>

              {/* Card 4: Create Image */}
              <div
                onClick={() => {
                  if (onNavigateToImages) {
                    onNavigateToImages();
                  } else {
                    setPromptInput('Generate a visual concept of: ');
                    textareaRef.current?.focus();
                  }
                }}
                className="group p-3 sm:p-6 rounded-xl sm:rounded-2xl bg-[#161B22] border border-[#30363D] hover:border-[#8B949E] hover:bg-[#1C2128] transition-all cursor-pointer flex flex-col justify-between min-h-[96px] sm:min-h-[170px]"
              >
                <div className="space-y-1.5 sm:space-y-2">
                  <div className="flex items-center justify-between">
                    <ImageIcon className="w-5 h-5 sm:w-6 sm:h-6 text-[#C7FF65] sm:text-[#F0F6FC] stroke-[1.75]" />
                    <span className="text-[#8B949E] group-hover:text-[#F0F6FC] transition-colors text-xs font-mono sm:hidden">
                      →
                    </span>
                  </div>
                  <h3 className="text-sm sm:text-lg font-semibold text-[#F0F6FC]">Create Image</h3>
                  <p className="text-[11px] sm:text-sm text-[#8B949E] leading-tight sm:leading-relaxed line-clamp-2">
                    Generate and edit images with AI.
                  </p>
                </div>
                <div className="hidden sm:block pt-3">
                  <span className="text-[#8B949E] group-hover:text-[#F0F6FC] transition-colors text-sm font-mono">
                    →
                  </span>
                </div>
              </div>
            </div>

            {/* Centered Suggestion Pills */}
            <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => handleSubmit(undefined, 'Explain the architecture and codebase structure of the active workspace.')}
                className="px-3 py-1.5 sm:px-4 sm:py-2 rounded-full bg-[#161B22] border border-[#30363D] hover:border-[#8B949E] text-xs sm:text-sm text-[#8B949E] hover:text-[#F0F6FC] transition-all flex items-center gap-1.5 sm:gap-2"
              >
                <Code2 className="w-3.5 h-3.5 text-[#C7FF65]" />
                <span>Explain this code</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (onNavigateToImages) {
                    onNavigateToImages();
                  } else {
                    handleSubmit(undefined, 'Generate a visual architecture concept diagram for this workstation.');
                  }
                }}
                className="px-3 py-1.5 sm:px-4 sm:py-2 rounded-full bg-[#161B22] border border-[#30363D] hover:border-[#8B949E] text-xs sm:text-sm text-[#8B949E] hover:text-[#F0F6FC] transition-all flex items-center gap-1.5 sm:gap-2"
              >
                <ImageIcon className="w-3.5 h-3.5 text-[#58A6FF]" />
                <span>Create a visual concept</span>
              </button>

              <button
                type="button"
                onClick={() => handleSubmit(undefined, 'Help me plan and design my next feature step by step.')}
                className="px-3 py-1.5 sm:px-4 sm:py-2 rounded-full bg-[#161B22] border border-[#30363D] hover:border-[#8B949E] text-xs sm:text-sm text-[#8B949E] hover:text-[#F0F6FC] transition-all flex items-center gap-1.5 sm:gap-2"
              >
                <FolderGit2 className="w-3.5 h-3.5 text-[#9EC43B]" />
                <span>Plan my next project</span>
              </button>
            </div>

            {/* Spacious Composer */}
            {renderPromptComposer(true)}
          </div>
        </div>
      ) : (
        /* Active Conversation Flow with Pinned Bottom Composer */
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
          {/* Scrollable Conversation Stream */}
          <div
            ref={scrollContainerRef}
            onScroll={handleConversationScroll}
            className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-8 py-4 sm:py-6"
          >
            <div className="max-w-[960px] mx-auto space-y-4 sm:space-y-6">
              {/* Chat Error Notice with Retry, Restore Prompt & Switch Model */}
              {chatError && (
                <div className="p-3.5 sm:p-4 rounded-xl bg-[#DA3633]/15 border border-[#DA3633]/40 text-xs text-[#FF727A] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertCircle className="w-4 h-4 shrink-0 text-[#FF727A]" />
                    <span className="leading-relaxed">{chatError}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto flex-wrap">
                    {userMessages.length > 0 && !sending && (
                      <button
                        type="button"
                        onClick={() => {
                          const lastUser = userMessages[userMessages.length - 1];
                          if (lastUser?.content) {
                            handleSubmit(undefined, lastUser.content, { retryLastUserMessage: true });
                          }
                        }}
                        className="px-2.5 py-1 rounded-lg bg-[#C7FF65] hover:bg-[#B8F558] text-[#0D1117] font-bold text-[11px] flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Retry</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowModelDropdown(true)}
                      className="px-2.5 py-1 rounded-lg bg-[#DA3633]/30 hover:bg-[#DA3633]/50 text-white font-semibold text-[11px] flex items-center gap-1.5 transition-colors cursor-pointer border border-[#DA3633]/50"
                    >
                      <Cpu className="w-3 h-3" />
                      <span>Switch Model</span>
                    </button>
                    <button
                      type="button"
                      onClick={onDismissError}
                      className="px-2 py-1 text-xs text-[#8B949E] hover:text-[#F0F6FC] transition-colors cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}

              {/* Messages Stream */}
              {activeConv?.messages.map((m) => {
                const isUser = m.role === 'user';

                if (isUser) {
                  return (
                    <div key={m.id} className="flex justify-end group my-2 sm:my-3">
                      <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-tr-sm bg-[#1C2128] border border-[#30363D] px-4 py-3 text-sm text-[#F0F6FC] shadow-sm relative space-y-1.5">
                        <div className="whitespace-pre-wrap break-words leading-relaxed select-text">
                          {m.content}
                        </div>
                        <div className="flex items-center justify-end gap-2 pt-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-[#8B949E]">
                          <span className="font-mono tabular-nums">
                            {new Date(m.timestampMillis).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          <button
                            type="button"
                            onClick={() => copyMessage(m.id, m.content)}
                            className="p-0.5 rounded hover:text-[#F0F6FC] transition-colors cursor-pointer"
                            title={copiedId === m.id ? 'Copied' : 'Copy message'}
                          >
                            {copiedId === m.id ? (
                              <Check className="w-3 h-3 text-[#3FB950]" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }

                const isMessageActive = Boolean(
                  m.isStreaming || m.taskState === 'running' || m.taskState === 'awaiting_approval'
                );
                const isCancelled = m.taskState === 'cancelled';
                const isFailed = m.taskState === 'failed' || Boolean(m.errorExplanation);

                // Assistant Message: unboxed, document-like reading surface with grouped activity sequence
                return (
                  <div key={m.id} className="group my-4 sm:my-6 space-y-2.5" data-testid="assistant-message">
                    {/* Subtle author & model indicator + live status */}
                    <div className="flex items-center justify-between text-xs text-[#8B949E] gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="w-5 h-5 rounded-md bg-[#C7FF65]/10 border border-[#C7FF65]/30 flex items-center justify-center shrink-0">
                          <ObsidianCrystalLogo withBadge={false} className="w-3 h-3" />
                        </div>
                        <span className="font-semibold text-[#F0F6FC] text-xs">OBSIDIAN AI</span>
                        {(m.modelId || currentModelId) && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#161B22] border border-[#30363D] text-[#8B949E]">
                            {m.modelId || currentModelId}
                          </span>
                        )}
                        {isMessageActive && (
                          <span
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#C7FF65]/12 border border-[#C7FF65]/35 text-[11px] font-mono text-[#C7FF65]"
                            data-testid="live-status-pill"
                          >
                            <span className="inline-flex items-center gap-0.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#C7FF65] animate-pulse" />
                              <span
                                className="w-1.5 h-1.5 rounded-full bg-[#C7FF65] animate-pulse"
                                style={{ animationDelay: '150ms' }}
                              />
                              <span
                                className="w-1.5 h-1.5 rounded-full bg-[#C7FF65] animate-pulse"
                                style={{ animationDelay: '300ms' }}
                              />
                            </span>
                            <span>{m.streamingStatus || 'Generating response…'}</span>
                          </span>
                        )}
                        {isCancelled && (
                          <span className="px-2 py-0.5 rounded-full bg-[#21262D] border border-[#30363D] text-[10px] font-mono text-[#8B949E]">
                            Stopped by user
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {isMessageActive && (
                          <button
                            type="button"
                            onClick={onStopGeneration}
                            className="px-2.5 py-0.5 rounded-lg bg-[#DA3633]/20 hover:bg-[#DA3633]/40 text-[#FF727A] border border-[#DA3633]/50 text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                            title="Stop current generation"
                          >
                            <Square className="w-2.5 h-2.5 fill-current" />
                            <span>Stop</span>
                          </button>
                        )}
                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="font-mono text-[10px] tabular-nums">
                            {new Date(m.timestampMillis).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          {m.content && (
                            <button
                              type="button"
                              onClick={() => copyMessage(m.id, m.content)}
                              className="p-1 rounded hover:bg-[#21262D] text-[#8B949E] hover:text-[#F0F6FC] transition-colors cursor-pointer"
                              title={copiedId === m.id ? 'Copied message' : 'Copy message'}
                              aria-label="Copy message"
                            >
                              {copiedId === m.id ? (
                                <Check className="w-3.5 h-3.5 text-[#3FB950]" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Grouped Agent Activity Sequence (inline) */}
                    {m.toolCalls && m.toolCalls.length > 0 && renderInlineActivitySequence(m.toolCalls, m.id, m.skillsUsed)}

                    {/* Skill Badges (when no tool calls present) */}
                    {(!m.toolCalls || m.toolCalls.length === 0) && m.skillsUsed && m.skillsUsed.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap my-2 pl-0.5">
                        <span className="text-[10px] font-mono text-[#8B949E] flex items-center gap-1">
                          <Sparkles className="w-3 h-3 text-[#C7FF65]" />
                          SKILLS LOADED:
                        </span>
                        {m.skillsUsed.map((sk) => (
                          <button
                            key={sk}
                            type="button"
                            onClick={() => handleOpenSkillPreview(sk)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#161B22] border border-[#30363D] hover:border-[#C7FF65]/50 text-[11px] font-mono text-[#C7FF65] transition-colors cursor-pointer"
                            title={`Inspect skill playbook: ${sk}`}
                          >
                            <span>{sk}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Waiting for first token: inline placeholder with subtle 3-dot pulsing indicator */}
                    {!m.content && isMessageActive && (
                      <div
                        className="py-3 px-4 rounded-xl bg-[#161B22]/70 border border-[#30363D]/80 inline-flex items-center gap-3 text-xs text-[#C9D1D9]"
                        data-testid="assistant-streaming-placeholder"
                      >
                        <div className="flex items-center gap-1" aria-label="Waiting for model tokens">
                          <span className="w-2 h-2 rounded-full bg-[#C7FF65] animate-bounce" />
                          <span
                            className="w-2 h-2 rounded-full bg-[#C7FF65] animate-bounce"
                            style={{ animationDelay: '150ms' }}
                          />
                          <span
                            className="w-2 h-2 rounded-full bg-[#C7FF65] animate-bounce"
                            style={{ animationDelay: '300ms' }}
                          />
                        </div>
                        <span className="font-mono text-[#8B949E]">
                          {m.streamingStatus || `Connecting to ${m.modelId || currentModelId}…`}
                        </span>
                      </div>
                    )}

                    {/* Document-like markdown response body */}
                    {m.content && (
                      <div className="text-sm sm:text-base leading-relaxed text-[#F0F6FC] pl-0.5">
                        <ChatMarkdown
                          content={m.content}
                          onRunInTerminal={(cmd: string) => onNavigateToTerminal(cmd)}
                          onOpenFileInEditor={onNavigateToProjects}
                        />
                        {isMessageActive && (
                          <span
                            className="inline-block w-2 h-4 ml-1 align-middle bg-[#C7FF65] animate-pulse rounded-xs"
                            aria-hidden="true"
                          />
                        )}
                      </div>
                    )}

                    {/* Cancelled turn footer (preserves partial output + offers Retry) */}
                    {isCancelled && (
                      <div className="pt-1 flex items-center gap-3 text-xs text-[#8B949E]">
                        <span className="font-mono text-[11px]">
                          Generation stopped · {m.content ? 'Partial output preserved' : 'Cancelled before first token'}
                        </span>
                        {!sending && userMessages.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              const lastUser = userMessages[userMessages.length - 1];
                              if (lastUser?.content) {
                                handleSubmit(undefined, lastUser.content, { retryLastUserMessage: true });
                              }
                            }}
                            className="px-2.5 py-1 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-[#C7FF65] font-semibold text-[11px] inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Retry</span>
                          </button>
                        )}
                      </div>
                    )}

                    {/* Inline failed turn card with Retry & Restore Prompt */}
                    {isFailed && (
                      <div
                        className="p-3.5 rounded-xl bg-[#1C1412] border border-[#DA3633]/50 text-xs text-[#FF727A] space-y-2.5"
                        data-testid="assistant-error-card"
                      >
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 text-[#FF727A] mt-0.5" />
                          <div className="space-y-1 min-w-0">
                            <div className="font-semibold text-[#F0F6FC]">
                              Generation Failed ({m.providerId || activeConv?.providerId || 'Provider'})
                            </div>
                            <div className="text-[#FF727A] leading-relaxed break-words">
                              {m.errorExplanation || chatError || 'Model provider failed to respond.'}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              const promptToRetry =
                                m.failedPrompt || userMessages[userMessages.length - 1]?.content || '';
                              if (promptToRetry) {
                                handleSubmit(undefined, promptToRetry, { retryLastUserMessage: true });
                              }
                            }}
                            className="px-3 py-1.5 rounded-lg bg-[#C7FF65] hover:bg-[#B8F558] text-[#0D1117] font-bold text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Retry Request</span>
                          </button>
                          {(m.failedPrompt || userMessages[userMessages.length - 1]?.content) && (
                            <button
                              type="button"
                              onClick={() => {
                                const textToRestore =
                                  m.failedPrompt || userMessages[userMessages.length - 1]?.content || '';
                                setPromptInput(textToRestore);
                                textareaRef.current?.focus();
                              }}
                              className="px-3 py-1.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-[#F0F6FC] font-medium text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                            >
                              <Pencil className="w-3 h-3" />
                              <span>Edit in Composer</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setShowModelDropdown(true)}
                            className="px-3 py-1.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-[#8B949E] hover:text-[#F0F6FC] font-medium text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <Cpu className="w-3.5 h-3.5" />
                            <span>Switch Model</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Fallback activity stream only when no running assistant message is in the list */}
              {sending &&
                !activeConv?.messages.some(
                  (m) => m.role === 'assistant' && (m.isStreaming || m.taskState === 'running')
                ) &&
                renderInFlightActivityStream()}

              {/* Pending Approvals */}
              {pendingApprovals.length > 0 && (
                <div className="p-4 rounded-xl bg-[#21262D] border border-[#D29922] space-y-3 shadow-lg">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#D29922]">
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    <span>Permission Approval Required</span>
                  </div>
                  {pendingApprovals.map((pa) => (
                    <div
                      key={pa.id}
                      className="p-3 rounded-lg bg-[#161B22] border border-[#30363D] space-y-2"
                    >
                      <div className="flex items-center justify-between gap-3 text-xs flex-wrap">
                        <div className="flex items-center gap-2">
                          <code className="px-2 py-0.5 rounded bg-[#0D1117] border border-[#30363D] font-mono text-[#F0F6FC] font-bold">
                            {pa.toolName}
                          </code>
                          <span className="text-[11px] font-mono text-[#8B949E]">
                            ({pa.category})
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onApproveTool(pa.id, true)}
                            className="px-3 py-1 rounded bg-[#238636] hover:bg-[#2EA043] text-white font-medium text-xs transition-colors cursor-pointer"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => onApproveTool(pa.id, false)}
                            className="px-3 py-1 rounded bg-[#30363D] hover:bg-[#DA3633] text-[#F0F6FC] font-medium text-xs transition-colors cursor-pointer"
                          >
                            Deny
                          </button>
                        </div>
                      </div>
                      {pa.reason && (
                        <div className="text-[11px] text-[#8B949E] leading-relaxed">
                          {pa.reason}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {showScrollToBottom && (
            <div className="absolute bottom-28 sm:bottom-32 left-1/2 -translate-x-1/2 z-20">
              <button
                type="button"
                onClick={() => scrollToLatest('smooth')}
                className="px-3.5 py-1.5 rounded-full bg-[#161B22]/95 border border-[#C7FF65]/50 text-[#C7FF65] text-xs font-semibold shadow-xl flex items-center gap-1.5 hover:bg-[#21262D] transition-all cursor-pointer"
              >
                <ChevronDown className="w-3.5 h-3.5" />
                <span>Jump to latest</span>
              </button>
            </div>
          )}

          {/* Pinned Bottom Composer */}
          <div className="p-2.5 sm:p-6 bg-[#0D1117] border-t border-[#30363D] shrink-0">
            <div className="max-w-[960px] mx-auto w-full">
              {renderPromptComposer(false)}
            </div>
          </div>
        </div>
      )}

      {/* Root-Level Responsive Model Selector Modal / Bottom Sheet */}
      {renderModelSelectorModal()}
      {renderMcpModal()}
      {renderTasksDrawer()}

      {/* Skill Instruction Inspection Modal */}
      {previewSkillId && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-[#161B22] border border-[#30363D] rounded-xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#30363D] flex items-center justify-between bg-[#0D1117]">
              <div className="flex items-center gap-2 truncate">
                <Sparkles className="w-4 h-4 text-[#C7FF65] shrink-0" />
                <span className="text-sm font-semibold text-white truncate">
                  {previewSkillData?.name || previewSkillId}
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-[#21262D] text-[#8B949E] font-mono border border-[#30363D]">
                  {previewSkillId}
                </span>
              </div>
              <button
                onClick={() => {
                  setPreviewSkillId(null);
                  setPreviewSkillData(null);
                }}
                className="text-[#8B949E] hover:text-white p-1 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {loadingSkillPreview ? (
                <div className="h-40 flex items-center justify-center text-xs text-[#8B949E]">
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                  Loading skill playbook...
                </div>
              ) : previewSkillData ? (
                <>
                  <div className="text-xs text-[#C9D1D9] leading-relaxed bg-[#0D1117] p-3 rounded-lg border border-[#30363D]">
                    {previewSkillData.description}
                  </div>

                  {previewSkillData.requiredTools.length > 0 && (
                    <div>
                      <div className="text-[10px] font-mono text-[#8B949E] uppercase mb-1">
                        Declared Tool Requirements
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {previewSkillData.requiredTools.map((t) => (
                          <span
                            key={t}
                            className="px-2 py-0.5 rounded bg-[#0D1117] border border-[#30363D] text-[11px] font-mono text-[#C7FF65]"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="text-[10px] font-mono text-[#8B949E] uppercase mb-1">
                      Playbook Instructions Loaded into Context
                    </div>
                    <pre className="text-[11px] font-mono text-[#C9D1D9] bg-[#0D1117] p-3 rounded-lg border border-[#30363D] overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-80">
                      {previewSkillData.instructions}
                    </pre>
                  </div>
                </>
              ) : (
                <div className="text-xs text-[#8B949E]">Skill details unavailable.</div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-[#30363D] bg-[#0D1117] flex items-center justify-between">
              {onNavigateToSkills && (
                <button
                  type="button"
                  onClick={() => {
                    setPreviewSkillId(null);
                    onNavigateToSkills();
                  }}
                  className="text-xs text-[#C7FF65] hover:underline flex items-center gap-1 font-medium"
                >
                  Manage in Skills Library <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setPreviewSkillId(null);
                  setPreviewSkillData(null);
                }}
                className="ml-auto px-4 py-1.5 text-xs font-medium rounded-md bg-[#21262D] hover:bg-[#30363D] text-white transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

