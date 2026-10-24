import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Activity,
  Layers,
  Search,
  Code2,
  CheckSquare,
  Terminal,
  Bug,
  Plus,
  RefreshCw,
  Play,
  Pause,
  Square,
  X,
  Check,
  Copy,
  Trash2,
  RotateCcw,
  Clock,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Settings,
  Shield,
  FileCode,
  Sliders,
  Database,
  ExternalLink,
  ArrowRight,
  Send,
  CornerDownLeft,
  Maximize2,
  Minimize2,
  TerminalSquare,
  Cpu,
  Zap,
  GitBranch,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { DuetAgentView } from './DuetAgentView';
import {
  AgentActivityEvent,
  PendingApproval,
  PermissionCategory,
  PermissionPolicy,
  SubAgentRole,
  SubAgentStatus,
  SubAgentTask,
  AgentProfile,
  MemoryItem,
  Conversation,
  ProviderSummary,
} from '../types';

export interface AgentsTabProps {
  events?: AgentActivityEvent[];
  pendingApprovals?: PendingApproval[];
  onApprove?: (approvalId: string, approved: boolean) => void;
  permissions?: Record<PermissionCategory, PermissionPolicy>;
  onUpdatePermission?: (category: PermissionCategory, policy: PermissionPolicy) => void;
  activeWorkspaceId: string;
  activeConvId?: string;
  conversationId?: string;
  onSelectConversation?: (id: string) => void;
  onSelectAgent?: (agentId: string) => void;
  defaultSubView?: 'loop' | 'tasks' | 'agents' | 'memory' | 'duet';
  activeConv?: Conversation | null;
  conversations?: Conversation[];
  sending?: boolean;
  onStopGeneration?: () => void;
  onContinueTask?: () => void;
  onSendMessage?: (
    baseText: string,
    attachedFileInfo?: { name: string; content: string } | null,
    enableAgentTools?: boolean
  ) => Promise<void>;
  maxAgentIterations?: number;
  onChangeMaxIterations?: (nextMax: number) => void;
  subagentTasks?: SubAgentTask[];
  onRefreshSubagentTasks?: () => void;
  providers?: ProviderSummary[];
  onNavigateToWorkspace?: (wsId: string) => void;
}

interface RoleMeta {
  role: SubAgentRole;
  title: string;
  subtitle: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor: string;
  borderColor: string;
  bgLight: string;
  examplePrompt: string;
}

const SUBAGENT_ROLES: RoleMeta[] = [
  {
    role: 'Planner',
    title: 'Architect & Planner',
    subtitle: 'Task decomposition & dependency trees',
    description: 'Decomposes complex requests into modular, bounded subtasks with dependency graphs.',
    icon: Layers,
    accentColor: '#388BFD',
    borderColor: 'border-[#388BFD]/30',
    bgLight: 'bg-[#388BFD]/10',
    examplePrompt: 'Decompose the user authentication refactor into bounded subtasks for Researcher, Coder, and Tester.',
  },
  {
    role: 'Researcher',
    title: 'Codebase Researcher',
    subtitle: 'Symbol discovery & context mining',
    description: 'Inspects project files, libraries, configuration, and documentation to extract context.',
    icon: Search,
    accentColor: '#A371F7',
    borderColor: 'border-[#A371F7]/30',
    bgLight: 'bg-[#A371F7]/10',
    examplePrompt: 'Locate all usages of provider routing and list which endpoints handle custom URLs.',
  },
  {
    role: 'Coder',
    title: 'Software Engineer',
    subtitle: 'Production code & refactoring',
    description: 'Implements assigned features, bugfixes, and refactors within specified workspace boundaries.',
    icon: Code2,
    accentColor: '#C7FF65',
    borderColor: 'border-[#C7FF65]/30',
    bgLight: 'bg-[#C7FF65]/10',
    examplePrompt: 'Implement a validation utility for custom endpoint URLs with SSRF protection.',
  },
  {
    role: 'Reviewer',
    title: 'Code Quality Reviewer',
    subtitle: 'Diff auditing & logic checks',
    description: 'Audits unified diffs, verifies logic correctness, and identifies potential regressions.',
    icon: CheckSquare,
    accentColor: '#72D9A0',
    borderColor: 'border-[#72D9A0]/30',
    bgLight: 'bg-[#72D9A0]/10',
    examplePrompt: 'Audit git diff for any unhandled promise rejections, security leaks, or broken imports.',
  },
  {
    role: 'Tester',
    title: 'Test Verifier',
    subtitle: 'Automated test suites & assertions',
    description: 'Executes automated tests, toolchain checks, and verifies output assertions.',
    icon: Terminal,
    accentColor: '#DB61A2',
    borderColor: 'border-[#DB61A2]/30',
    bgLight: 'bg-[#DB61A2]/10',
    examplePrompt: 'Run npm test suite on terminal session and verify all unit test cases pass.',
  },
  {
    role: 'Debugger',
    title: 'Diagnostics Debugger',
    subtitle: 'Root-cause analysis & error triage',
    description: 'Investigates stack traces, build failures, and runtime errors to formulate fixes.',
    icon: Bug,
    accentColor: '#FF727A',
    borderColor: 'border-[#FF727A]/30',
    bgLight: 'bg-[#FF727A]/10',
    examplePrompt: 'Analyze the uncaught exception in PTY session flush on Windows cmd.exe and suggest the patch.',
  },
];

export const AgentsTab: React.FC<AgentsTabProps> = ({
  events = [],
  pendingApprovals = [],
  onApprove,
  permissions = {
    READ_WORKSPACE: 'ALLOW',
    WRITE_WORKSPACE: 'ASK',
    RUN_TERMINAL_COMMANDS: 'ASK',
    OUTBOUND_HTTP: 'ASK',
    BROWSER_AUTOMATION: 'ASK',
    MCP_SERVERS: 'ALLOW',
    INSTALL_PACKAGES: 'ASK',
    BUILD_PROJECTS: 'ASK',
    INSTALL_APKS: 'ASK',
    EXTERNAL_DIRECTORIES: 'DENY',
  },
  onUpdatePermission,
  activeWorkspaceId,
  activeConvId,
  conversationId,
  onSelectConversation,
  onSelectAgent,
  defaultSubView = 'loop',
  activeConv,
  conversations = [],
  sending = false,
  onStopGeneration,
  onContinueTask,
  onSendMessage,
  maxAgentIterations = 10,
  onChangeMaxIterations,
  subagentTasks = [],
  onRefreshSubagentTasks,
  providers = [],
  onNavigateToWorkspace,
}) => {
  const [subView, setSubView] = useState<'loop' | 'tasks' | 'agents' | 'memory' | 'duet'>(defaultSubView);

  // Agents Directory State
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('obsidian-autonomous-coder');
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [configuringAgent, setConfiguringAgent] = useState<AgentProfile | null>(null);

  // Install Form State
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentRole, setNewAgentRole] = useState('Specialized Engineer');
  const [newAgentDesc, setNewAgentDesc] = useState('');
  const [newAgentPrompt, setNewAgentPrompt] = useState('');
  const [newAgentMaxSteps, setNewAgentMaxSteps] = useState(10);
  const [newAgentModel, setNewAgentModel] = useState('gemini-3.8-flash');
  const [savingAgent, setSavingAgent] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  // Tasks Stream State
  const [tasks, setTasks] = useState<SubAgentTask[]>(subagentTasks);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [taskFilter, setTaskFilter] = useState<'all' | 'running' | 'completed' | 'failed'>('all');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  // Spawn Task Modal State
  const [showSpawnModal, setShowSpawnModal] = useState(false);
  const [spawnRole, setSpawnRole] = useState<SubAgentRole>('Planner');
  const [spawnTitle, setSpawnTitle] = useState('');
  const [spawnPrompt, setSpawnPrompt] = useState('');
  const [spawning, setSpawning] = useState(false);
  const [spawnError, setSpawnError] = useState<string | null>(null);

  // Memory State
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [memoryQuery, setMemoryQuery] = useState('');
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [newNoteContent, setNewNoteContent] = useState('');

  // Agent Loop Workstation State
  const [quickPromptInput, setQuickPromptInput] = useState('');
  const [isSubmittingQuickPrompt, setIsSubmittingQuickPrompt] = useState(false);
  const [selectedHierarchyAgent, setSelectedHierarchyAgent] = useState<string>('Software Engineer');
  const [selectedTimelineMilestone, setSelectedTimelineMilestone] = useState<string | null>(null);
  const [isTerminalExpanded, setIsTerminalExpanded] = useState<boolean>(false);
  const [terminalSearchFilter, setTerminalSearchFilter] = useState<string>('');
  const [copiedTerminal, setCopiedTerminal] = useState<boolean>(false);
  const [showReasoningDetails, setShowReasoningDetails] = useState<boolean>(true);
  const [activeApprovals, setActiveApprovals] = useState<PendingApproval[]>(pendingApprovals);

  useEffect(() => {
    if (pendingApprovals && pendingApprovals.length > 0) {
      setActiveApprovals(pendingApprovals);
    }
  }, [pendingApprovals]);

  // Notification Banner
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Keep tasks synced with prop or fetched
  useEffect(() => {
    if (subagentTasks.length > 0) {
      setTasks(subagentTasks);
    }
  }, [subagentTasks]);

  // Load Agents
  const loadAgents = useCallback(async () => {
    setLoadingAgents(true);
    try {
      const res = await fetch('/api/agents');
      const data = await res.json();
      if (data.agents) setAgents(data.agents);
      if (data.defaultAgentId) setSelectedAgentId(data.defaultAgentId);
    } catch {
      // transient network error
    } finally {
      setLoadingAgents(false);
    }
  }, []);

  // Load Tasks
  const loadTasks = useCallback(async (silent = false) => {
    if (!silent) setLoadingTasks(true);
    try {
      const res = await fetch('/api/subagents');
      const data = await res.json();
      if (data.tasks) {
        setTasks(data.tasks);
        if (onRefreshSubagentTasks) onRefreshSubagentTasks();
      }
    } catch {
      // transient network error
    } finally {
      if (!silent) setLoadingTasks(false);
    }
  }, [onRefreshSubagentTasks]);

  // Load Memories
  const loadMemories = useCallback(async (q = '') => {
    try {
      const res = await fetch(`/api/memories?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (data.memories) setMemories(data.memories);
    } catch {
      // transient network error
    }
  }, []);

  useEffect(() => {
    loadAgents();
    loadTasks();
    loadMemories();
  }, [loadAgents, loadTasks, loadMemories]);

  // Polling tasks while any task is running
  useEffect(() => {
    const hasRunning = tasks.some((t) => t.status === 'Running' || t.status === 'Queued');
    if (!hasRunning && subView !== 'tasks' && !sending) return;
    const interval = setInterval(() => {
      loadTasks(true);
    }, 1500);
    return () => clearInterval(interval);
  }, [tasks, subView, sending, loadTasks]);

  // Select Agent Action
  const handleSelectActiveAgent = async (agentId: string) => {
    setSelectedAgentId(agentId);
    try {
      await fetch('/api/agents/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, conversationId: activeConvId || conversationId }),
      });
      if (onSelectAgent) onSelectAgent(agentId);
      setBanner({ type: 'ok', text: `Selected active agent: ${agentId}` });
      setTimeout(() => setBanner(null), 3000);
    } catch {
      setBanner({ type: 'err', text: 'Failed to update active agent.' });
    }
  };

  // Install Custom Agent
  const handleInstallCustomAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAgentName.trim() || !newAgentPrompt.trim()) {
      setInstallError('Agent Name and System Instruction are required.');
      return;
    }
    setSavingAgent(true);
    setInstallError(null);
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newAgentName.trim(),
          role: newAgentRole.trim(),
          description: newAgentDesc.trim() || undefined,
          systemInstruction: newAgentPrompt.trim(),
          defaultMaxSteps: newAgentMaxSteps,
          defaultModelId: newAgentModel,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInstallError(data.error || 'Failed to install agent.');
        return;
      }
      if (data.agents) setAgents(data.agents);
      setShowInstallModal(false);
      setNewAgentName('');
      setNewAgentDesc('');
      setNewAgentPrompt('');
      setBanner({ type: 'ok', text: `Custom agent "${newAgentName}" installed successfully.` });
      setTimeout(() => setBanner(null), 3000);
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSavingAgent(false);
    }
  };

  // Delete Custom Agent
  const handleDeleteAgent = async (id: string) => {
    if (!window.confirm('Uninstall this custom agent profile?')) return;
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.agents) setAgents(data.agents);
      setBanner({ type: 'ok', text: 'Custom agent uninstalled.' });
      setTimeout(() => setBanner(null), 3000);
    } catch {
      setBanner({ type: 'err', text: 'Failed to uninstall agent.' });
    }
  };

  // Spawn Task
  const handleSpawnTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!spawnPrompt.trim()) return;
    setSpawning(true);
    setSpawnError(null);
    try {
      const res = await fetch('/api/subagents/spawn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: spawnRole,
          title: spawnTitle.trim() || `${spawnRole} Task`,
          taskPrompt: spawnPrompt.trim(),
          workspaceId: activeWorkspaceId,
          conversationId: activeConvId || conversationId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSpawnError(data.error || 'Failed to spawn task.');
        return;
      }
      setShowSpawnModal(false);
      setSpawnPrompt('');
      setSpawnTitle('');
      setSubView('tasks');
      loadTasks();
      setBanner({ type: 'ok', text: `Task "${data.task?.title || spawnTitle}" queued successfully.` });
      setTimeout(() => setBanner(null), 3000);
    } catch (err) {
      setSpawnError(err instanceof Error ? err.message : 'Spawn failed.');
    } finally {
      setSpawning(false);
    }
  };

  // Cancel Task
  const handleCancelTask = async (taskId: string) => {
    try {
      await fetch(`/api/subagents/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' });
      loadTasks();
    } catch {
      // ignore
    }
  };

  // Retry Task
  const handleRetryTask = async (taskId: string) => {
    try {
      await fetch(`/api/subagents/${encodeURIComponent(taskId)}/retry`, { method: 'POST' });
      loadTasks();
      setBanner({ type: 'ok', text: 'Task retried successfully.' });
      setTimeout(() => setBanner(null), 3000);
    } catch {
      setBanner({ type: 'err', text: 'Failed to retry task.' });
    }
  };

  // Delete Task
  const handleDeleteTask = async (taskId: string) => {
    try {
      await fetch(`/api/subagents/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
      loadTasks();
    } catch {
      // ignore
    }
  };

  // Save Memory Note
  const handleSaveMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteTitle.trim() || !newNoteContent.trim()) return;
    try {
      const res = await fetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: activeWorkspaceId,
          category: 'project',
          title: newNoteTitle.trim(),
          content: newNoteContent.trim(),
        }),
      });
      const data = await res.json();
      if (data.memories) setMemories(data.memories);
      setNewNoteTitle('');
      setNewNoteContent('');
      setBanner({ type: 'ok', text: 'Context note saved to workspace memory.' });
      setTimeout(() => setBanner(null), 3000);
    } catch {
      setBanner({ type: 'err', text: 'Failed to save note.' });
    }
  };

  // Quick Prompt Submission directly to Agent Loop
  const handleQuickPromptSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickPromptInput.trim() || isSubmittingQuickPrompt) return;
    setIsSubmittingQuickPrompt(true);
    try {
      if (onSendMessage) {
        await onSendMessage(quickPromptInput.trim(), null, true);
        setQuickPromptInput('');
      } else {
        // Fallback: spawn a coder subagent task
        await fetch('/api/subagents/spawn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: 'Coder',
            title: quickPromptInput.trim().slice(0, 48),
            taskPrompt: quickPromptInput.trim(),
            workspaceId: activeWorkspaceId,
            conversationId: activeConv?.id,
          }),
        });
        setQuickPromptInput('');
        loadTasks();
      }
    } catch {
      setBanner({ type: 'err', text: 'Failed to dispatch instruction.' });
    } finally {
      setIsSubmittingQuickPrompt(false);
    }
  };

  // Copy Terminal Output
  const handleCopyTerminal = () => {
    const text = events
      .map((e) => `[${e.toolName || 'agent'}] ${e.title}: ${e.stdout || e.toolOutput || e.description}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    setCopiedTerminal(true);
    setTimeout(() => setCopiedTerminal(false), 2000);
  };

  // Derived Loop Telemetry Data
  const latestAssistantMsg = useMemo(() => {
    if (!activeConv?.messages) return null;
    const msgs = [...activeConv.messages].reverse();
    return msgs.find((m) => m.role === 'assistant') || null;
  }, [activeConv]);

  const stepsUsed = latestAssistantMsg?.stepsUsed ?? (sending ? 1 : 0);
  const maxStepsConfigured = latestAssistantMsg?.maxStepsConfigured ?? maxAgentIterations ?? 10;
  const canResume = Boolean(
    latestAssistantMsg?.canResume ||
      activeConv?.taskState === 'stopped_at_limit' ||
      activeConv?.taskState === 'cancelled'
  );

  const loopStatus = useMemo(() => {
    if (sending) return 'Running';
    if (pendingApprovals.length > 0) return 'Awaiting Approval';
    if (activeConv?.taskState === 'stopped_at_limit') return 'Paused at Step Limit';
    if (activeConv?.taskState === 'completed') return 'Completed';
    if (activeConv?.taskState === 'failed') return 'Failed';
    if (activeConv?.taskState === 'cancelled') return 'Cancelled';
    return 'Idle';
  }, [sending, pendingApprovals, activeConv]);

  // Tool Calls and Modified Files Counts
  const toolCallsCount = useMemo(() => {
    if (latestAssistantMsg?.toolCalls) return latestAssistantMsg.toolCalls.length;
    return events.filter((e) => e.toolName).length;
  }, [latestAssistantMsg, events]);

  const modifiedFiles = useMemo(() => {
    if (latestAssistantMsg?.modifiedFiles && latestAssistantMsg.modifiedFiles.length > 0) {
      return latestAssistantMsg.modifiedFiles;
    }
    const set = new Set<string>();
    events.forEach((e) => {
      if (e.toolName === 'write_file' || e.toolName === 'create_file') {
        const path = e.toolInput?.replace(/^[^{]*\{/, '{') || '';
        if (path) set.add(path.slice(0, 40));
      }
    });
    return Array.from(set);
  }, [latestAssistantMsg, events]);

  // Latest Reasoning text
  const reasoningPreview = useMemo(() => {
    if (latestAssistantMsg?.content) {
      const match = latestAssistantMsg.content.match(/<thought>([\s\S]*?)<\/thought>/i);
      if (match) return match[1].trim();
      const firstLines = latestAssistantMsg.content
        .split('\n')
        .filter((l) => !l.startsWith('#') && !l.startsWith('```') && l.trim())
        .slice(0, 3)
        .join(' ');
      if (firstLines) return firstLines.slice(0, 240);
    }
    const lastEvent = events[events.length - 1];
    if (lastEvent?.description) return lastEvent.description;
    return 'Replaced in-memory token map with durable SQLite WAL-mode prepared statements. Handling connection pool recycling and mutex locking for concurrent edge runtimes.';
  }, [latestAssistantMsg, events]);

  // Latest Tool Call Record
  const latestToolCall = useMemo(() => {
    if (latestAssistantMsg?.toolCalls && latestAssistantMsg.toolCalls.length > 0) {
      return latestAssistantMsg.toolCalls[latestAssistantMsg.toolCalls.length - 1];
    }
    const lastToolEvent = [...events].reverse().find((e) => e.toolName);
    if (lastToolEvent) {
      return {
        name: lastToolEvent.toolName || 'write_file',
        args: { file: 'src/auth/session.ts' },
        durationMs: lastToolEvent.durationMs || 18,
      };
    }
    return {
      name: 'write_file',
      args: { path: 'src/auth/session.ts' },
      durationMs: 18,
    };
  }, [latestAssistantMsg, events]);

  // Filter tasks
  const filteredTasks = tasks.filter((t) => {
    if (taskFilter === 'running') return t.status === 'Running' || t.status === 'Queued';
    if (taskFilter === 'completed') return t.status === 'Completed';
    if (taskFilter === 'failed') return t.status === 'Failed' || t.status === 'Cancelled';
    return true;
  });

  const activeTasksCount = tasks.filter((t) => t.status === 'Running' || t.status === 'Queued').length;
  const completedTasksCount = tasks.filter((t) => t.status === 'Completed').length;
  const failedTasksCount = tasks.filter((t) => t.status === 'Failed').length;

  return (
    <div className="flex flex-col h-full w-full max-w-full overflow-hidden bg-[#0D1117] text-[#F0F6FC]">
      {/* =========================================================================
          TOP SEGMENTED SUB-NAV: AGENT LOOP | TASKS | PROFILES | MEMORY
          ========================================================================= */}
      <div className="h-13 px-3 sm:px-6 border-b border-[#30363D] bg-[#161B22] flex items-center justify-between gap-2 sm:gap-3 shrink-0">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-[#0D1117] border border-[#30363D] overflow-x-auto max-w-full no-scrollbar">
          {/* SubView 1: Agent Loop */}
          <button
            type="button"
            data-subview-id="loop"
            onClick={() => setSubView('loop')}
            title="View Agent Execution Loop"
            aria-label="View Agent Execution Loop"
            className={`min-h-[36px] px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 sm:gap-2 transition-all shrink-0 cursor-pointer ${
              subView === 'loop'
                ? 'bg-[#21262D] text-[#C7FF65] shadow-sm border border-[#C7FF65]/30'
                : 'text-[#8B949E] hover:text-[#F0F6FC]'
            }`}
          >
            <RotateCcw className={`w-3.5 h-3.5 shrink-0 ${sending ? 'animate-spin text-[#C7FF65]' : ''}`} />
            <span>Agent Loop</span>
            {sending && (
              <span className="w-2 h-2 rounded-full bg-[#C7FF65] animate-ping shrink-0" />
            )}
            {pendingApprovals.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold bg-[#D29922]/20 text-[#D29922] shrink-0">
                {pendingApprovals.length === 1 ? '1 Pending Approval' : `${pendingApprovals.length} Pending Approvals`}
              </span>
            )}
          </button>

          {/* SubView 2: Tasks */}
          <button
            type="button"
            data-subview-id="tasks"
            onClick={() => setSubView('tasks')}
            title="View Autonomous Tasks"
            aria-label="View Autonomous Tasks"
            className={`min-h-[36px] px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 sm:gap-2 transition-all shrink-0 cursor-pointer ${
              subView === 'tasks'
                ? 'bg-[#21262D] text-[#C7FF65] shadow-sm border border-[#C7FF65]/30'
                : 'text-[#8B949E] hover:text-[#F0F6FC]'
            }`}
          >
            <Activity className="w-3.5 h-3.5 shrink-0" />
            <span>Tasks</span>
            {activeTasksCount > 0 ? (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#388BFD]/20 text-[#388BFD] animate-pulse">
                {activeTasksCount} active
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-[#21262D] text-[#8B949E]">
                {tasks.length}
              </span>
            )}
          </button>

          {/* SubView 3: Profiles */}
          <button
            type="button"
            data-subview-id="agents"
            onClick={() => setSubView('agents')}
            title="View Agent Profiles"
            aria-label="View Agent Profiles"
            className={`min-h-[36px] px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 sm:gap-2 transition-all shrink-0 cursor-pointer ${
              subView === 'agents'
                ? 'bg-[#21262D] text-[#C7FF65] shadow-sm border border-[#C7FF65]/30'
                : 'text-[#8B949E] hover:text-[#F0F6FC]'
            }`}
          >
            <Layers className="w-3.5 h-3.5 shrink-0" />
            <span>Profiles</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-[#21262D] text-[#8B949E]">
              {agents.length || 6}
            </span>
          </button>

          {/* SubView 4: Memory */}
          <button
            type="button"
            data-subview-id="memory"
            onClick={() => setSubView('memory')}
            title="View Workspace Memory"
            aria-label="View Workspace Memory"
            className={`min-h-[36px] px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 sm:gap-2 transition-all shrink-0 cursor-pointer ${
              subView === 'memory'
                ? 'bg-[#21262D] text-[#C7FF65] shadow-sm border border-[#C7FF65]/30'
                : 'text-[#8B949E] hover:text-[#F0F6FC]'
            }`}
          >
            <Database className="w-3.5 h-3.5 shrink-0" />
            <span>Memory</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-mono bg-[#21262D] text-[#8B949E]">
              {memories.length}
            </span>
          </button>

          {/* SubView 5: Duet Agent */}
          <button
            type="button"
            data-subview-id="duet"
            onClick={() => setSubView('duet')}
            title="View Duet Multi-Agent Collaboration"
            aria-label="View Duet Multi-Agent Collaboration"
            className={`min-h-[36px] px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 sm:gap-2 transition-all shrink-0 cursor-pointer ${
              subView === 'duet'
                ? 'bg-[#21262D] text-[#C7FF65] shadow-sm border border-[#C7FF65]/30'
                : 'text-[#8B949E] hover:text-[#F0F6FC]'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 shrink-0 text-[#C7FF65]" />
            <span>Duet Agent</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold bg-[#C7FF65]/15 text-[#C7FF65] border border-[#C7FF65]/30">
              2x AI
            </span>
          </button>
        </div>

        {/* Right Action Header Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          {subView === 'loop' && (
            <button
              type="button"
              onClick={() => setShowSpawnModal(true)}
              title="Delegate Subtask"
              aria-label="Delegate Subtask"
              className="min-h-[36px] px-3 py-1.5 rounded-xl bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-[#C7FF65] font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span className="hidden sm:inline">Delegate Subtask</span>
            </button>
          )}

          {subView === 'tasks' && (
            <button
              type="button"
              onClick={() => setShowSpawnModal(true)}
              title="Spawn Autonomous Task"
              aria-label="Spawn Autonomous Task"
              className="min-h-[36px] px-3 py-1.5 rounded-xl bg-[#C7FF65] text-[#0D1117] font-semibold text-xs flex items-center gap-1.5 hover:bg-[#d6ff85] transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Spawn Task</span>
            </button>
          )}

          {subView === 'agents' && (
            <button
              type="button"
              onClick={() => setShowInstallModal(true)}
              title="Install Agent Profile"
              aria-label="Install Agent Profile"
              className="min-h-[36px] px-3 py-1.5 rounded-xl bg-[#C7FF65] text-[#0D1117] font-semibold text-xs flex items-center gap-1.5 hover:bg-[#d6ff85] transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span className="hidden sm:inline">Install Agent</span>
            </button>
          )}
        </div>
      </div>

      {/* Notification Toast */}
      {banner && (
        <div
          className={`mx-3 sm:mx-6 mt-3 p-3 rounded-xl border text-xs flex items-center justify-between gap-2 shrink-0 ${
            banner.type === 'ok'
              ? 'bg-[#72D9A0]/10 border-[#72D9A0]/30 text-[#72D9A0]'
              : 'bg-[#FF727A]/10 border-[#FF727A]/30 text-[#FF727A]'
          }`}
        >
          <span>{banner.text}</span>
          <button
            onClick={() => setBanner(null)}
            title="Dismiss banner notice"
            aria-label="Dismiss banner notice"
            className="p-1 opacity-70 hover:opacity-100 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* =========================================================================
          VIEW 1: AGENT LOOP WORKSTATION (Linear / Cursor Inspired)
          ========================================================================= */}
      {subView === 'loop' && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Scrollable Workstation Body */}
          <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 py-3.5 space-y-3.5 pb-20">
            <div className="max-w-4xl mx-auto space-y-3.5">
              {/* -------------------------------------------------------------
                  1. LIVE TASK HEADER & RUNTIME EXECUTION CONTROLS
                  ------------------------------------------------------------- */}
              <div className="bg-[#161B22] border border-[#30363D] rounded-2xl p-4 space-y-3 shadow-lg">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-1.5 text-[#8B949E] text-[11px] font-mono mb-1 truncate">
                      <GitBranch className="w-3.5 h-3.5 text-[#388BFD] shrink-0" />
                      <span>TASK-{activeConv?.id ? activeConv.id.slice(0, 6).toUpperCase() : '4089'}</span>
                      <span>•</span>
                      <span className="text-[#388BFD] truncate">
                        branch: main · {activeWorkspaceId}
                      </span>
                    </div>

                    <h1 className="text-base sm:text-xl font-bold text-[#F0F6FC] truncate tracking-tight">
                      {activeConv?.title || 'Refactor auth & SQLite session store'}
                    </h1>
                  </div>

                  {/* Runtime Quick Controls Cluster (Run, Pause, Resume, Stop) */}
                  <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                    {/* Pause Button */}
                    <button
                      type="button"
                      disabled={!sending}
                      onClick={onStopGeneration}
                      className={`w-8 h-8 rounded-xl border flex items-center justify-center transition-all cursor-pointer ${
                        sending
                          ? 'bg-[#21262D] border-[#D29922]/50 text-[#D29922] hover:bg-[#D29922]/20 active:scale-95'
                          : 'bg-[#161B22] border-[#30363D] text-[#8B949E]/40 opacity-40 cursor-not-allowed'
                      }`}
                      title="Pause execution"
                      aria-label="Pause execution"
                    >
                      <Pause className="w-4 h-4" />
                    </button>

                    {/* Resume / Step Button */}
                    <button
                      type="button"
                      disabled={!canResume || sending}
                      onClick={onContinueTask}
                      className={`min-h-[32px] px-3 rounded-xl border font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
                        canResume && !sending
                          ? 'bg-[#C7FF65] text-[#0D1117] border-[#C7FF65] hover:bg-[#d6ff85] active:scale-95 shadow-md shadow-[#C7FF65]/10'
                          : 'bg-[#161B22] border-[#30363D] text-[#8B949E]/40 opacity-40 cursor-not-allowed'
                      }`}
                      title="Resume agent loop (+10 steps)"
                      aria-label={canResume ? 'Resume agent loop' : 'Step agent execution'}
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>{canResume ? 'Resume' : 'Step'}</span>
                    </button>

                    {/* Stop / Halt Button */}
                    <button
                      type="button"
                      disabled={!sending && !canResume}
                      onClick={onStopGeneration}
                      className={`w-8 h-8 rounded-xl border flex items-center justify-center transition-all cursor-pointer ${
                        sending || canResume
                          ? 'bg-[#21262D] border-[#FF727A]/50 text-[#FF727A] hover:bg-[#FF727A]/20 active:scale-95'
                          : 'bg-[#161B22] border-[#30363D] text-[#8B949E]/40 opacity-40 cursor-not-allowed'
                      }`}
                      title="Halt loop"
                      aria-label="Halt agent loop"
                    >
                      <Square className="w-3.5 h-3.5 fill-current" />
                    </button>
                  </div>
                </div>

                {/* Telemetry Strip */}
                <div className="pt-2.5 border-t border-[#30363D]/60 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                  <div className="flex items-center space-x-2">
                    <span
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        sending
                          ? 'bg-[#C7FF65] animate-ping'
                          : loopStatus === 'Awaiting Approval'
                          ? 'bg-[#D29922] animate-pulse'
                          : loopStatus === 'Completed'
                          ? 'bg-[#72D9A0]'
                          : loopStatus === 'Failed'
                          ? 'bg-[#FF727A]'
                          : 'bg-[#8B949E]'
                      }`}
                    />
                    <span
                      className={`font-bold tracking-wide ${
                        sending
                          ? 'text-[#C7FF65]'
                          : loopStatus === 'Awaiting Approval'
                          ? 'text-[#D29922]'
                          : loopStatus === 'Completed'
                          ? 'text-[#72D9A0]'
                          : loopStatus === 'Failed'
                          ? 'text-[#FF727A]'
                          : 'text-[#8B949E]'
                      }`}
                    >
                      {loopStatus} {sending && `(Step ${stepsUsed}/${maxStepsConfigured})`}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-[#8B949E] text-[11px]">
                    <span className="flex items-center gap-1">
                      <Cpu className="w-3 h-3 text-[#388BFD]" />
                      <span>{activeConv?.modelId?.split('/')?.pop() || 'qwen2.5-coder-1.5b'}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <Terminal className="w-3 h-3 text-[#C7FF65]" />
                      <span>{toolCallsCount} tools</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <FileCode className="w-3 h-3 text-[#A371F7]" />
                      <span>{modifiedFiles.length} files</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* -------------------------------------------------------------
                  2. AGENT SWARM & HIERARCHY TREE VIEW
                  ------------------------------------------------------------- */}
              <div className="bg-[#161B22] border border-[#30363D] rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-[#30363D]/60">
                  <div className="flex items-center space-x-2">
                    <Layers className="w-4 h-4 text-[#C7FF65]" />
                    <h2 className="text-xs font-bold uppercase tracking-wider text-[#F0F6FC]">
                      Agent Swarm &amp; Hierarchy
                    </h2>
                  </div>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-[#21262D] text-[#C7FF65] border border-[#30363D]">
                    4 Tracked Agents
                  </span>
                </div>

                {/* Coordinator Root Node */}
                <div className="space-y-1.5">
                  <div className="p-3 bg-[#0D1117] border border-[#30363D] rounded-xl flex items-center justify-between">
                    <div className="flex items-center space-x-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-[#C7FF65]/15 border border-[#C7FF65]/40 flex items-center justify-center shrink-0">
                        <Layers className="w-4 h-4 text-[#C7FF65]" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center space-x-1.5">
                          <span className="font-semibold text-xs sm:text-sm text-[#F0F6FC] truncate">
                            {agents.find((a) => a.id === selectedAgentId)?.name || 'Obsidian Autonomous Coder'}
                          </span>
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#C7FF65]/10 text-[#C7FF65] border border-[#C7FF65]/30">
                            Coordinator
                          </span>
                        </div>
                        <p className="text-[11px] text-[#8B949E] font-mono truncate">
                          {activeConv?.modelId || 'qwen2.5-coder-1.5b.gguf'} • {events.length} {events.length === 1 ? 'event logged' : 'events logged'}
                        </p>
                      </div>
                    </div>

                    <span
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        sending ? 'bg-[#C7FF65] animate-ping' : 'bg-[#72D9A0]'
                      }`}
                    />
                  </div>

                  {/* Spawned Sub-Agents Tree Connector */}
                  <div className="ml-4 pl-3.5 border-l-2 border-[#30363D] space-y-2 pt-1">
                    {/* Sub-Agent 1: Planner */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedHierarchyAgent('Planner')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedHierarchyAgent('Planner');
                        }
                      }}
                      title="Inspect Planner sub-agent details"
                      aria-label="Inspect Planner sub-agent details"
                      className={`relative flex items-center justify-between p-2 rounded-xl bg-[#0D1117]/80 border transition-all cursor-pointer ${
                        selectedHierarchyAgent === 'Planner'
                          ? 'border-[#388BFD] shadow-sm'
                          : 'border-[#30363D] hover:border-[#8B949E]/40'
                      }`}
                    >
                      <span className="absolute -left-[18px] top-1/2 w-3 h-px bg-[#30363D]" />
                      <div className="flex items-center space-x-2 truncate min-w-0">
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#388BFD] shrink-0" />
                        <span className="font-semibold text-xs text-[#F0F6FC] truncate">Planner</span>
                        <span className="text-[11px] text-[#8B949E] font-mono hidden sm:inline">· 3 subtasks</span>
                      </div>
                      <span className="text-[11px] font-mono text-[#8B949E]">1.2s · 840 tok</span>
                    </div>

                    {/* Sub-Agent 2: Codebase Researcher */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedHierarchyAgent('Researcher')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedHierarchyAgent('Researcher');
                        }
                      }}
                      title="Inspect Codebase Researcher sub-agent details"
                      aria-label="Inspect Codebase Researcher sub-agent details"
                      className={`relative flex items-center justify-between p-2 rounded-xl bg-[#0D1117]/80 border transition-all cursor-pointer ${
                        selectedHierarchyAgent === 'Researcher'
                          ? 'border-[#A371F7] shadow-sm'
                          : 'border-[#30363D] hover:border-[#8B949E]/40'
                      }`}
                    >
                      <span className="absolute -left-[18px] top-1/2 w-3 h-px bg-[#30363D]" />
                      <div className="flex items-center space-x-2 truncate min-w-0">
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#A371F7] shrink-0" />
                        <span className="font-semibold text-xs text-[#F0F6FC] truncate">Codebase Researcher</span>
                        <span className="text-[11px] text-[#8B949E] font-mono hidden sm:inline">· 12 files indexed</span>
                      </div>
                      <span className="text-[11px] font-mono text-[#8B949E]">3.8s · ripgrep</span>
                    </div>

                    {/* Sub-Agent 3: Software Engineer (ACTIVE / EXECUTING) */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedHierarchyAgent('Software Engineer')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedHierarchyAgent('Software Engineer');
                        }
                      }}
                      title="Inspect Software Engineer sub-agent details"
                      aria-label="Inspect Software Engineer sub-agent details"
                      className={`relative flex items-center justify-between p-2.5 rounded-xl bg-[#21262D] border transition-all cursor-pointer ${
                        selectedHierarchyAgent === 'Software Engineer'
                          ? 'border-[#C7FF65] shadow-[0_0_12px_rgba(199,255,101,0.15)]'
                          : 'border-[#30363D]'
                      }`}
                    >
                      <span className="absolute -left-[18px] top-1/2 w-3 h-px bg-[#C7FF65]" />
                      <div className="flex items-center space-x-2 truncate min-w-0">
                        <Zap className="w-4 h-4 text-[#C7FF65] shrink-0 animate-pulse" />
                        <div className="min-w-0">
                          <div className="flex items-center space-x-1.5">
                            <span className="font-bold text-xs text-[#F0F6FC] truncate">Software Engineer</span>
                            <span className="text-[10px] font-mono font-bold bg-[#C7FF65] text-[#0D1117] px-1.5 py-0.2 rounded">
                              {sending ? 'Running' : 'Active'}
                            </span>
                          </div>
                          <p className="text-[11px] text-[#C7FF65] font-mono truncate">
                            AST syntax patcher · Step {stepsUsed}/{maxStepsConfigured}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs font-mono font-bold text-[#F0F6FC] shrink-0">8.2k tok</span>
                    </div>

                    {/* Sub-Agent 4: Test Verifier */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedHierarchyAgent('Tester')}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedHierarchyAgent('Tester');
                        }
                      }}
                      title="Inspect Test Verifier sub-agent details"
                      aria-label="Inspect Test Verifier sub-agent details"
                      className={`relative flex items-center justify-between p-2 rounded-xl bg-[#0D1117]/50 border transition-all cursor-pointer ${
                        selectedHierarchyAgent === 'Tester'
                          ? 'border-[#DB61A2] shadow-sm'
                          : 'border-[#30363D]/60 hover:border-[#8B949E]/40'
                      }`}
                    >
                      <span className="absolute -left-[18px] top-1/2 w-3 h-px bg-[#30363D]/60" />
                      <div className="flex items-center space-x-2 truncate min-w-0">
                        <Clock className="w-3.5 h-3.5 text-[#8B949E] shrink-0" />
                        <span className="font-semibold text-xs text-[#8B949E] truncate">Test Verifier</span>
                        <span className="text-[11px] text-[#8B949E]/70 font-mono hidden sm:inline">· Vitest suite</span>
                      </div>
                      <span className="text-[11px] font-mono text-[#8B949E]">Queued ⏳</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* -------------------------------------------------------------
                  3. INTERACTIVE EXECUTION TIMELINE
                  ------------------------------------------------------------- */}
              <div className="bg-[#161B22] border border-[#30363D] rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Activity className="w-4 h-4 text-[#C7FF65]" />
                    <h2 className="text-xs font-bold uppercase tracking-wider text-[#F0F6FC]">
                      Execution Timeline
                    </h2>
                  </div>
                  <span className="text-xs font-mono text-[#8B949E]">
                    Step {stepsUsed} of {maxStepsConfigured}
                  </span>
                </div>

                {/* Horizontal Step Milestone Trail */}
                <div className="flex items-center gap-2 overflow-x-auto py-1 no-scrollbar text-xs">
                  <div
                    onClick={() => setSelectedTimelineMilestone('1-4')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0D1117] border border-[#30363D] text-[#8B949E] hover:text-[#F0F6FC] hover:border-[#8B949E]/50 whitespace-nowrap cursor-pointer transition-colors"
                  >
                    <Check className="w-3.5 h-3.5 text-[#72D9A0]" />
                    <span>1-4: Schemas &amp; JWT</span>
                  </div>

                  <div
                    onClick={() => setSelectedTimelineMilestone('5-6')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0D1117] border border-[#30363D] text-[#8B949E] hover:text-[#F0F6FC] hover:border-[#8B949E]/50 whitespace-nowrap cursor-pointer transition-colors"
                  >
                    <Check className="w-3.5 h-3.5 text-[#72D9A0]" />
                    <span>5-6: SQLite Migrations</span>
                  </div>

                  <div
                    onClick={() => setSelectedTimelineMilestone('7')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#C7FF65]/15 border border-[#C7FF65] text-[#C7FF65] font-semibold whitespace-nowrap cursor-pointer shadow-sm shadow-[#C7FF65]/10"
                  >
                    <Zap className="w-3.5 h-3.5 text-[#C7FF65] animate-pulse" />
                    <span>7: Mutate session.ts</span>
                  </div>

                  <div
                    onClick={() => setSelectedTimelineMilestone('8-15')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0D1117]/50 border border-[#30363D]/50 text-[#8B949E]/70 whitespace-nowrap cursor-pointer"
                  >
                    <span>8-15: Vitest &amp; Commit</span>
                  </div>
                </div>
              </div>

              {/* -------------------------------------------------------------
                  4. CURRENT ACTIVITY LIVE CARD & APPROVAL INTERCEPT
                  ------------------------------------------------------------- */}
              <div className="bg-[#161B22] border border-[#30363D] rounded-2xl p-4 space-y-3.5">
                {/* Agent & Diff Summary Strip */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center space-x-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#C7FF65] animate-pulse shrink-0" />
                    <span className="font-bold text-xs sm:text-sm text-[#F0F6FC] truncate">
                      Software Engineer
                    </span>
                    <span className="text-[#8B949E]">•</span>
                    <span className="text-xs text-[#388BFD] font-mono truncate">
                      {sending ? 'executing tool call' : 'standby'}
                    </span>
                  </div>

                  <div className="flex items-center space-x-1.5 bg-[#0D1117] px-2 py-0.5 rounded-lg border border-[#30363D] font-mono text-xs shrink-0">
                    <span className="text-[#72D9A0] font-bold">+42</span>
                    <span className="text-[#8B949E]">/</span>
                    <span className="text-[#FF727A] font-bold">-8</span>
                  </div>
                </div>

                {/* Reasoning Engine Accordion */}
                <div className="bg-[#0D1117] p-3 rounded-xl border border-[#30363D] space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-[#8B949E]">
                    <div className="flex items-center gap-1.5 font-medium">
                      <Cpu className="w-3.5 h-3.5 text-[#C7FF65]" />
                      <span>Reasoning Engine</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono text-[#C7FF65]">18ms latency</span>
                      <button
                        type="button"
                        onClick={() => setShowReasoningDetails((v) => !v)}
                        title={showReasoningDetails ? 'Collapse reasoning details' : 'Expand reasoning details'}
                        aria-label={showReasoningDetails ? 'Collapse reasoning details' : 'Expand reasoning details'}
                        className="p-0.5 text-[#8B949E] hover:text-[#F0F6FC] cursor-pointer"
                      >
                        {showReasoningDetails ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  {showReasoningDetails && (
                    <p className="text-xs text-[#F0F6FC]/90 font-mono leading-relaxed whitespace-pre-wrap">
                      {reasoningPreview}
                    </p>
                  )}
                </div>

                {/* Active Tool Call Tag */}
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#21262D] border border-[#30363D] text-xs font-mono">
                  <div className="flex items-center space-x-2 truncate min-w-0">
                    <span className="text-[#C7FF65] font-bold">tool:</span>
                    <span className="text-[#F0F6FC] font-semibold">{latestToolCall.name}</span>
                    <span className="text-[#8B949E] truncate">
                      {String(latestToolCall.args?.path || latestToolCall.args?.file || 'src/auth/session.ts')}
                    </span>
                  </div>
                  <span className="text-[11px] text-[#8B949E] shrink-0 ml-2">sync_fs</span>
                </div>

                {/* Modified Files Chips */}
                {modifiedFiles.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#8B949E]">
                      Modified Files ({modifiedFiles.length})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {modifiedFiles.map((f, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded-lg bg-[#0D1117] border border-[#30363D] text-[#388BFD] font-mono text-[11px] flex items-center gap-1.5"
                        >
                          <FileCode className="w-3 h-3 text-[#388BFD]" />
                          <span className="truncate max-w-[200px]">{f}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* INTERACTIVE SECURITY APPROVAL REQUEST BANNER */}
                {activeApprovals.length > 0 ? (
                  <div className="rounded-2xl border-2 border-[#C7FF65] bg-[#161B22] p-4 space-y-3 shadow-xl shadow-[#C7FF65]/5 animate-in fade-in">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center space-x-2">
                        <ShieldAlert className="w-5 h-5 text-[#C7FF65]" />
                        <span className="font-bold text-xs sm:text-sm text-[#F0F6FC] tracking-wide">
                          PERMISSION APPROVAL REQUEST
                        </span>
                      </div>
                      <span className="text-[10px] font-mono bg-[#21262D] text-[#388BFD] px-2 py-0.5 rounded border border-[#30363D]">
                        LOW RISK • WORKSPACE
                      </span>
                    </div>

                    <p className="text-xs font-mono text-[#F0F6FC]">
                      Grant file write to{' '}
                      <code className="text-[#C7FF65] font-bold bg-[#0D1117] px-1.5 py-0.5 rounded border border-[#30363D]">
                        {String(
                          activeApprovals[0].arguments?.path ||
                          activeApprovals[0].arguments?.targetFile ||
                          'src/auth/session.ts'
                        )}
                      </code>
                      ?
                    </p>

                    {/* Touch-Optimized 44px Buttons */}
                    <div className="grid grid-cols-2 gap-2.5 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          const topId = activeApprovals[0].id;
                          if (onApprove) onApprove(topId, false);
                          setActiveApprovals((prev) => prev.filter((a) => a.id !== topId));
                          setBanner({ type: 'err', text: 'Permission request denied.' });
                          setTimeout(() => setBanner(null), 3000);
                        }}
                        title="Deny permission request"
                        aria-label="Deny permission request"
                        className="min-h-[44px] flex items-center justify-center space-x-2 rounded-xl bg-[#21262D] border border-[#FF727A]/50 text-[#FF727A] hover:bg-[#FF727A]/20 active:scale-98 transition-transform text-xs font-bold cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                        <span>Deny</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const topId = activeApprovals[0].id;
                          if (onApprove) onApprove(topId, true);
                          setActiveApprovals((prev) => prev.filter((a) => a.id !== topId));
                          setBanner({ type: 'ok', text: 'Permission approved. File write granted.' });
                          setTimeout(() => setBanner(null), 3000);
                        }}
                        title="Approve permission request"
                        aria-label="Approve permission request"
                        className="min-h-[44px] flex items-center justify-center space-x-2 rounded-xl bg-[#C7FF65] text-[#0D1117] hover:bg-[#d6ff85] active:scale-98 transition-transform text-xs font-bold shadow-md cursor-pointer"
                      >
                        <Check className="w-4 h-4 stroke-[3]" />
                        <span>Approve</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-[#30363D] bg-[#0D1117] p-3 flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center space-x-2 text-[#8B949E] min-w-0">
                      <Shield className="w-4 h-4 text-[#72D9A0] shrink-0" />
                      <span className="truncate">Sandbox active · 0 pending approvals</span>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await fetch('/api/agent/simulate-approval', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            conversationId: activeConv?.id,
                            workspaceId: activeWorkspaceId,
                          }),
                        });
                        const data = await res.json();
                        if (data.approval) {
                          setActiveApprovals((prev) => [data.approval, ...prev]);
                          setBanner({ type: 'ok', text: 'Simulated approval request queued.' });
                        }
                      }}
                      title="Simulate permission intercept for testing"
                      aria-label="Simulate permission intercept for testing"
                      className="text-[11px] font-mono text-[#388BFD] hover:underline shrink-0 cursor-pointer"
                    >
                      Simulate Intercept →
                    </button>
                  </div>
                )}
              </div>

              {/* -------------------------------------------------------------
                  5. INTERACTIVE TERMINAL & SUBPROCESS DRAWER (PTY)
                  ------------------------------------------------------------- */}
              <div className="bg-[#161B22] border border-[#30363D] rounded-2xl p-4 space-y-2.5">
                <div className="flex items-center justify-between pb-2 border-b border-[#30363D]/60">
                  <div className="flex items-center space-x-2">
                    <TerminalSquare className="w-4 h-4 text-[#C7FF65]" />
                    <h2 className="text-xs font-bold uppercase tracking-wider text-[#F0F6FC]">
                      Interactive Output &amp; Subprocess (PTY)
                    </h2>
                  </div>

                  <div className="flex items-center space-x-1">
                    <button
                      type="button"
                      onClick={handleCopyTerminal}
                      className="p-1.5 rounded-lg text-[#8B949E] hover:text-[#F0F6FC] hover:bg-[#21262D] transition-colors cursor-pointer"
                      title={copiedTerminal ? 'Copied terminal log to clipboard' : 'Copy terminal log to clipboard'}
                      aria-label={copiedTerminal ? 'Copied terminal log to clipboard' : 'Copy terminal log to clipboard'}
                    >
                      {copiedTerminal ? <Check className="w-3.5 h-3.5 text-[#72D9A0]" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsTerminalExpanded((v) => !v)}
                      className="p-1.5 rounded-lg text-[#8B949E] hover:text-[#F0F6FC] hover:bg-[#21262D] transition-colors cursor-pointer"
                      title={isTerminalExpanded ? 'Collapse terminal drawer' : 'Expand terminal drawer'}
                      aria-label={isTerminalExpanded ? 'Collapse terminal drawer' : 'Expand terminal drawer'}
                    >
                      {isTerminalExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Monospaced Log Pane */}
                <div
                  className={`bg-[#0D1117] p-3 rounded-xl border border-[#30363D] font-mono text-xs text-[#F0F6FC]/90 overflow-x-auto leading-relaxed space-y-1 ${
                    isTerminalExpanded ? 'max-h-96' : 'max-h-48'
                  }`}
                >
                  <div className="text-[#8B949E] flex items-center space-x-1.5">
                    <span className="text-[#C7FF65] font-bold">[agent:se]</span>
                    <span className="text-[#F0F6FC]">&gt;</span>
                    <span className="text-[#F0F6FC]">bunx ts-node --check src/auth/session.ts</span>
                  </div>
                  <div className="text-[#388BFD] pl-2 border-l border-[#30363D]">
                    [info] SQLite pragmas: WAL=1, busy_timeout=5000, foreign_keys=ON
                  </div>
                  <div className="text-[#C7FF65] font-semibold flex items-center space-x-1.5">
                    <span className="animate-pulse">›</span>
                    <span>
                      {pendingApprovals.length > 0
                        ? '[agent:se] Pending user approval for filesystem write...'
                        : '[agent:se] AST verification succeeded. Prepared statements valid.'}
                    </span>
                  </div>
                  {events.slice(-5).map((ev, i) => (
                    <div key={i} className="text-[#8B949E] text-[11px] truncate">
                      <span className="text-[#A371F7]">[{ev.toolName || 'agent'}]</span> {ev.title}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* -------------------------------------------------------------
              6. QUICK INSTRUCTION RUNNER DOCKED AT BOTTOM
              ------------------------------------------------------------- */}
          <div className="p-3 sm:p-4 bg-[#161B22] border-t border-[#30363D] shrink-0">
            <div className="max-w-4xl mx-auto w-full">
              <form onSubmit={handleQuickPromptSubmit} className="flex items-center gap-2">
                <div className="flex-1 min-w-0 relative">
                  <input
                    type="text"
                    value={quickPromptInput}
                    onChange={(e) => setQuickPromptInput(e.target.value)}
                    placeholder="> Run instruction or delegate task to agent loop..."
                    aria-label="Agent quick instruction input"
                    className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#0D1117] border border-[#30363D] text-xs sm:text-sm text-[#F0F6FC] placeholder-[#8B949E] focus:outline-none focus:border-[#C7FF65] font-mono transition-all"
                  />
                </div>

                <button
                  type="submit"
                  disabled={!quickPromptInput.trim() || isSubmittingQuickPrompt}
                  title="Run step in agent loop"
                  aria-label="Run step in agent loop"
                  className="min-h-[42px] px-4 rounded-xl bg-[#C7FF65] text-[#0D1117] font-bold text-xs flex items-center gap-1.5 hover:bg-[#d6ff85] active:scale-95 disabled:opacity-40 transition-all shadow-md shrink-0 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Run Step</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          VIEW 2: TASKS STREAM & DELEGATE HISTORY
          ========================================================================= */}
      {subView === 'tasks' && (
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-4">
          <div className="max-w-4xl mx-auto space-y-4">
            {/* Header with Filter Pills */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-[#8B949E]">
                  Autonomous Task Stream
                </h2>
                <p className="text-xs text-[#8B949E]">
                  Track multi-agent delegations, tool calls, and background processes.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => loadTasks()}
                  disabled={loadingTasks}
                  title="Refresh autonomous task stream"
                  aria-label="Refresh autonomous task stream"
                  className="min-h-[36px] px-3 rounded-xl bg-[#161B22] border border-[#30363D] text-[#8B949E] hover:text-[#F0F6FC] text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingTasks ? 'animate-spin text-[#C7FF65]' : ''}`} />
                  <span className="hidden sm:inline">Refresh</span>
                </button>

                <div className="flex items-center p-0.5 rounded-xl bg-[#161B22] border border-[#30363D]">
                  {(['all', 'running', 'completed', 'failed'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setTaskFilter(f)}
                      title={`Filter tasks by ${f}`}
                      aria-label={`Filter tasks by ${f}`}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium capitalize transition-colors cursor-pointer ${
                        taskFilter === f
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

            {/* Metrics Chips */}
            <div className="grid grid-cols-4 gap-2.5">
              <div className="p-3 rounded-xl bg-[#161B22] border border-[#30363D]">
                <div className="text-[10px] font-medium uppercase tracking-wider text-[#8B949E]">
                  Active Tasks
                </div>
                <div className="text-lg font-bold text-[#388BFD] mt-0.5">{activeTasksCount}</div>
              </div>
              <div className="p-3 rounded-xl bg-[#161B22] border border-[#30363D]">
                <div className="text-[10px] font-medium uppercase tracking-wider text-[#8B949E]">
                  Completed
                </div>
                <div className="text-lg font-bold text-[#72D9A0] mt-0.5">{completedTasksCount}</div>
              </div>
              <div className="p-3 rounded-xl bg-[#161B22] border border-[#30363D]">
                <div className="text-[10px] font-medium uppercase tracking-wider text-[#8B949E]">
                  Failed
                </div>
                <div className="text-lg font-bold text-[#FF727A] mt-0.5">{failedTasksCount}</div>
              </div>
              <div className="p-3 rounded-xl bg-[#161B22] border border-[#30363D]">
                <div className="text-[10px] font-medium uppercase tracking-wider text-[#8B949E]">
                  Total Tasks
                </div>
                <div className="text-lg font-bold text-[#F0F6FC] mt-0.5">{tasks.length}</div>
              </div>
            </div>

            {/* Task Cards List */}
            <div className="space-y-3">
              {filteredTasks.length === 0 ? (
                <div className="p-10 text-center rounded-2xl bg-[#161B22] border border-[#30363D] space-y-2 text-[#8B949E]">
                  <Activity className="w-8 h-8 mx-auto opacity-40" />
                  <div className="text-sm font-semibold text-[#F0F6FC]">No Tasks Found</div>
                  <p className="text-xs">
                    {taskFilter !== 'all'
                      ? `No tasks match the filter '${taskFilter}'.`
                      : 'Click "Spawn Task" or delegate tasks from the Agent Loop to start.'}
                  </p>
                </div>
              ) : (
                filteredTasks.map((t) => {
                  const isExpanded = expandedTaskId === t.id;
                  const isRunning = t.status === 'Running' || t.status === 'Queued';
                  const isCompleted = t.status === 'Completed';
                  const isFailed = t.status === 'Failed' || t.status === 'Cancelled';
                  const toolCallsCountLocal = t.toolCalls?.length ?? 0;
                  const changedFilesCountLocal = t.changedFiles?.length ?? 0;

                  return (
                    <div
                      key={t.id}
                      className="rounded-2xl bg-[#161B22] border border-[#30363D] overflow-hidden transition-all hover:border-[#8B949E]/50"
                    >
                      <div className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 min-w-0 flex-1">
                            <div className="w-9 h-9 rounded-xl bg-[#21262D] border border-[#30363D] flex items-center justify-center shrink-0 mt-0.5">
                              <Layers className="w-5 h-5 text-[#C7FF65]" />
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-sm text-[#F0F6FC] truncate">
                                  {t.title}
                                </span>
                                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#21262D] text-[#8B949E]">
                                  {t.role}
                                </span>
                                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#21262D] text-[#8B949E]">
                                  {t.modelId}
                                </span>
                              </div>

                              <p className="text-xs text-[#8B949E] mt-1 line-clamp-2">
                                {t.taskPrompt}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className={`px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 ${
                                isRunning
                                  ? 'bg-[#388BFD]/15 text-[#388BFD] border border-[#388BFD]/30'
                                  : isCompleted
                                  ? 'bg-[#72D9A0]/15 text-[#72D9A0] border border-[#72D9A0]/30'
                                  : 'bg-[#FF727A]/15 text-[#FF727A] border border-[#FF727A]/30'
                              }`}
                            >
                              {isRunning && <span className="w-2 h-2 rounded-full bg-[#388BFD] animate-pulse" />}
                              {isCompleted && <CheckCircle2 className="w-3.5 h-3.5" />}
                              {isFailed && <AlertCircle className="w-3.5 h-3.5" />}
                              <span>{t.status}</span>
                            </span>
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="space-y-1.5 pt-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-[#8B949E] font-medium truncate">
                              {t.currentStep || (isRunning ? 'Processing...' : 'Completed')}
                            </span>
                            <span className="font-mono text-[11px] text-[#C7FF65]">
                              {t.progress ?? 0}%
                            </span>
                          </div>

                          <div className="h-2 w-full bg-[#21262D] rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${
                                isCompleted
                                  ? 'bg-[#72D9A0]'
                                  : isFailed
                                  ? 'bg-[#FF727A]'
                                  : 'bg-[#C7FF65]'
                              }`}
                              style={{ width: `${Math.max(5, t.progress ?? 0)}%` }}
                            />
                          </div>
                        </div>

                        {/* Meta strip */}
                        <div className="flex items-center justify-between gap-3 pt-2 border-t border-[#30363D]/60 text-xs text-[#8B949E]">
                          <div className="flex items-center gap-3">
                            <span className="flex items-center gap-1 font-mono text-[11px]">
                              <Terminal className="w-3 h-3 text-[#C7FF65]" />
                              <span>{toolCallsCountLocal} tools</span>
                            </span>
                            <span className="flex items-center gap-1 font-mono text-[11px]">
                              <FileCode className="w-3 h-3 text-[#388BFD]" />
                              <span>{changedFilesCountLocal} files</span>
                            </span>
                            {t.durationMs && (
                              <span className="font-mono text-[11px]">
                                {(t.durationMs / 1000).toFixed(1)}s
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            {isRunning ? (
                              <button
                                type="button"
                                onClick={() => handleCancelTask(t.id)}
                                title="Cancel running task"
                                aria-label="Cancel running task"
                                className="px-2.5 py-1 rounded-lg bg-[#FF727A]/15 text-[#FF727A] hover:bg-[#FF727A]/25 font-semibold text-[11px] transition-colors cursor-pointer"
                              >
                                Cancel
                              </button>
                            ) : isFailed ? (
                              <button
                                type="button"
                                onClick={() => handleRetryTask(t.id)}
                                title="Retry failed task"
                                aria-label="Retry failed task"
                                className="px-2.5 py-1 rounded-lg bg-[#C7FF65]/15 text-[#C7FF65] hover:bg-[#C7FF65]/25 font-semibold text-[11px] flex items-center gap-1 transition-colors cursor-pointer"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>Retry</span>
                              </button>
                            ) : null}

                            <button
                              type="button"
                              onClick={() => setExpandedTaskId(isExpanded ? null : t.id)}
                              title={isExpanded ? 'Hide task details' : 'View task details'}
                              aria-label={isExpanded ? 'Hide task details' : 'View task details'}
                              className="px-2.5 py-1 rounded-lg bg-[#21262D] hover:bg-[#30363D] text-[#F0F6FC] font-medium text-[11px] flex items-center gap-1 transition-colors cursor-pointer"
                            >
                              <span>{isExpanded ? 'Hide Details' : 'View Details'}</span>
                              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleDeleteTask(t.id)}
                              className="p-1 text-[#8B949E] hover:text-[#FF727A] cursor-pointer"
                              title="Delete task record"
                              aria-label="Delete task record"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Expanded Drawer */}
                      {isExpanded && (
                        <div className="p-4 border-t border-[#30363D] bg-[#0D1117] space-y-4 text-xs">
                          {t.error && (
                            <div className="p-3 rounded-xl bg-[#FF727A]/10 border border-[#FF727A]/30 text-[#FF727A] space-y-1">
                              <div className="font-bold flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                <span>Execution Error</span>
                              </div>
                              <pre className="font-mono text-[11px] whitespace-pre-wrap">{t.error}</pre>
                            </div>
                          )}

                          {t.output && (
                            <div className="space-y-1.5">
                              <div className="text-[11px] font-bold uppercase tracking-wider text-[#8B949E]">
                                Agent Output
                              </div>
                              <div className="p-3 rounded-xl bg-[#161B22] border border-[#30363D] font-mono text-[11px] text-[#F0F6FC] max-h-60 overflow-y-auto whitespace-pre-wrap">
                                {t.output}
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
          VIEW 3: AGENTS DIRECTORY & PROFILES
          ========================================================================= */}
      {subView === 'agents' && (
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-6">
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Active Agent Card */}
            <div className="p-4 sm:p-5 rounded-2xl bg-[#161B22] border border-[#30363D] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-[#C7FF65]/15 border border-[#C7FF65]/40 flex items-center justify-center shrink-0">
                  <Layers className="w-6 h-6 text-[#C7FF65]" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[#C7FF65]">
                      Active Primary Coordinator
                    </span>
                    <span className="w-2 h-2 rounded-full bg-[#72D9A0] animate-pulse" />
                  </div>
                  <h2 className="text-base sm:text-lg font-bold text-[#F0F6FC] truncate">
                    {agents.find((a) => a.id === selectedAgentId)?.name || 'Obsidian Autonomous Coder'}
                  </h2>
                  <p className="text-xs text-[#8B949E] line-clamp-1">
                    {agents.find((a) => a.id === selectedAgentId)?.description ||
                      'Bounded ReAct software engineering agent with workspace file editing.'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowSpawnModal(true)}
                  title="Delegate task"
                  aria-label="Delegate task"
                  className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-[#21262D] border border-[#30363D] text-[#F0F6FC] hover:border-[#C7FF65] text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 text-[#C7FF65] fill-current" />
                  <span>Delegate Task</span>
                </button>
              </div>
            </div>

            {/* Profiles Grid */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-[#8B949E]">
                    Installed Agent Profiles
                  </h3>
                  <p className="text-xs text-[#8B949E]">
                    Select an active agent for session reasoning or install custom prompt configurations.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {agents.map((agent) => {
                  const isSelected = agent.id === selectedAgentId;
                  return (
                    <div
                      key={agent.id}
                      className={`rounded-2xl bg-[#161B22] border transition-all p-4 flex flex-col justify-between space-y-3 ${
                        isSelected
                          ? 'border-[#C7FF65] shadow-[0_0_12px_rgba(199,255,101,0.15)]'
                          : 'border-[#30363D] hover:border-[#8B949E]/50'
                      }`}
                    >
                      <div className="space-y-2 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: agent.accentColor || '#C7FF65' }}
                            />
                            <h4 className="font-bold text-sm text-[#F0F6FC] truncate">
                              {agent.name}
                            </h4>
                          </div>
                          {agent.isDefault && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#C7FF65]/10 text-[#C7FF65] border border-[#C7FF65]/30">
                              Default
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-[#8B949E] line-clamp-2">
                          {agent.description}
                        </p>
                      </div>

                      <div className="pt-2 border-t border-[#30363D]/60 flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono text-[11px] text-[#8B949E]">
                          Max Steps: {agent.defaultMaxSteps || 10}
                        </span>

                        <div className="flex items-center gap-1.5">
                          {isSelected ? (
                            <span className="px-3 py-1 rounded-lg bg-[#C7FF65]/20 text-[#C7FF65] font-semibold text-xs flex items-center gap-1">
                              <Check className="w-3.5 h-3.5" />
                              Active
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleSelectActiveAgent(agent.id)}
                              title={`Select ${agent.name} as active agent`}
                              aria-label={`Select ${agent.name} as active agent`}
                              className="px-3 py-1 rounded-lg bg-[#21262D] hover:bg-[#30363D] text-[#F0F6FC] font-medium text-xs transition-colors cursor-pointer"
                            >
                              Select
                            </button>
                          )}

                          {agent.isCustom && (
                            <button
                              type="button"
                              onClick={() => handleDeleteAgent(agent.id)}
                              className="p-1 text-[#8B949E] hover:text-[#FF727A] cursor-pointer"
                              title={`Uninstall custom agent: ${agent.name}`}
                              aria-label={`Uninstall custom agent: ${agent.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          VIEW 4: MEMORY BANK
          ========================================================================= */}
      {subView === 'memory' && (
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-6">
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-[#8B949E]">
                  Workspace Long-Term Memory
                </h2>
                <p className="text-xs text-[#8B949E]">
                  Context notes and architectural decisions persisted across all sessions.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={memoryQuery}
                  onChange={(e) => {
                    setMemoryQuery(e.target.value);
                    loadMemories(e.target.value);
                  }}
                  placeholder="Search memories..."
                  aria-label="Search workspace memories"
                  className="px-3 py-1.5 rounded-xl bg-[#161B22] border border-[#30363D] text-xs text-[#F0F6FC] placeholder-[#8B949E] focus:outline-none focus:border-[#C7FF65]"
                />
              </div>
            </div>

            {/* Add Memory Note Card */}
            <div className="p-4 rounded-2xl bg-[#161B22] border border-[#30363D] space-y-3">
              <h3 className="text-xs font-bold text-[#F0F6FC] uppercase tracking-wider">
                Add Knowledge Note
              </h3>
              <form onSubmit={handleSaveMemory} className="space-y-2.5">
                <input
                  type="text"
                  value={newNoteTitle}
                  onChange={(e) => setNewNoteTitle(e.target.value)}
                  placeholder="Title (e.g. SQLite Concurrency Policy)"
                  aria-label="Knowledge note title"
                  className="w-full px-3 py-1.5 rounded-xl bg-[#0D1117] border border-[#30363D] text-xs text-[#F0F6FC] focus:border-[#C7FF65] focus:outline-none"
                />
                <textarea
                  value={newNoteContent}
                  onChange={(e) => setNewNoteContent(e.target.value)}
                  placeholder="Note details, architectural rules, or constraints..."
                  aria-label="Knowledge note content"
                  rows={3}
                  className="w-full p-3 rounded-xl bg-[#0D1117] border border-[#30363D] text-xs text-[#F0F6FC] focus:border-[#C7FF65] focus:outline-none resize-none leading-relaxed"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={!newNoteTitle.trim() || !newNoteContent.trim()}
                    title="Save knowledge note"
                    aria-label="Save knowledge note"
                    className="min-h-[34px] px-3.5 rounded-xl bg-[#C7FF65] text-[#0D1117] font-semibold text-xs flex items-center gap-1.5 hover:bg-[#d6ff85] disabled:opacity-40 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Save Note</span>
                  </button>
                </div>
              </form>
            </div>

            {/* Notes List */}
            <div className="space-y-3">
              {memories.length === 0 ? (
                <div className="p-8 text-center rounded-2xl bg-[#161B22] border border-[#30363D] text-xs text-[#8B949E]">
                  No memory notes found for workspace '{activeWorkspaceId}'.
                </div>
              ) : (
                memories.map((m) => (
                  <div
                    key={m.id}
                    className="p-4 rounded-2xl bg-[#161B22] border border-[#30363D] space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-xs sm:text-sm text-[#F0F6FC]">{m.title}</h4>
                      <span className="text-[10px] font-mono text-[#8B949E]">
                        {new Date(m.updatedAtMillis || Date.now()).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-xs text-[#8B949E] whitespace-pre-wrap">{m.content}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          VIEW 5: DUET MULTI-AGENT COLLABORATION
          ========================================================================= */}
      {subView === 'duet' && (
        <DuetAgentView
          activeWorkspaceId={activeWorkspaceId}
          activeConv={activeConv}
          conversations={conversations}
          events={events}
          sending={sending}
          onSendMessage={onSendMessage}
          onStopGeneration={onStopGeneration}
          subagentTasks={subagentTasks}
          onSelectConversation={onSelectConversation}
          onNavigateToWorkspace={onNavigateToWorkspace}
          providers={providers}
        />
      )}

      {/* =========================================================================
          SPAWN SUB-AGENT TASK MODAL
          ========================================================================= */}
      {showSpawnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-sm"
            onClick={() => setShowSpawnModal(false)}
          />
          <div className="relative w-full max-w-lg bg-[#161B22] border border-[#30363D] rounded-2xl shadow-2xl p-5 space-y-4 z-10">
            <div className="flex items-center justify-between pb-3 border-b border-[#30363D]">
              <div className="flex items-center gap-2">
                <Play className="w-4 h-4 text-[#C7FF65] fill-current" />
                <h3 className="font-bold text-sm text-[#F0F6FC]">Spawn Sub-Agent Task</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSpawnModal(false)}
                title="Close modal"
                aria-label="Close modal"
                className="p-1 text-[#8B949E] hover:text-[#F0F6FC] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {spawnError && (
              <div className="p-2.5 rounded-xl bg-[#FF727A]/10 border border-[#FF727A]/30 text-xs text-[#FF727A]">
                {spawnError}
              </div>
            )}

            <form onSubmit={handleSpawnTask} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-[#8B949E] mb-1 font-medium">Sub-Agent Role</label>
                <select
                  value={spawnRole}
                  onChange={(e) => setSpawnRole(e.target.value as SubAgentRole)}
                  aria-label="Sub-Agent Role"
                  className="w-full min-h-[38px] px-3 rounded-xl bg-[#0D1117] border border-[#30363D] text-[#F0F6FC] focus:border-[#C7FF65] focus:outline-none cursor-pointer"
                >
                  {SUBAGENT_ROLES.map((r) => (
                    <option key={r.role} value={r.role}>
                      {r.title} ({r.role})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[#8B949E] mb-1 font-medium">Task Title</label>
                <input
                  type="text"
                  value={spawnTitle}
                  onChange={(e) => setSpawnTitle(e.target.value)}
                  placeholder="e.g. Audit API authentication diff"
                  aria-label="Task title"
                  className="w-full min-h-[38px] px-3 rounded-xl bg-[#0D1117] border border-[#30363D] text-[#F0F6FC] focus:border-[#C7FF65] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[#8B949E] mb-1 font-medium">Prompt &amp; Objectives</label>
                <textarea
                  value={spawnPrompt}
                  onChange={(e) => setSpawnPrompt(e.target.value)}
                  placeholder="Describe the bounded task instructions clearly..."
                  aria-label="Task prompt and objectives"
                  rows={4}
                  required
                  className="w-full p-3 rounded-xl bg-[#0D1117] border border-[#30363D] text-[#F0F6FC] focus:border-[#C7FF65] focus:outline-none resize-none leading-relaxed"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#30363D]">
                <button
                  type="button"
                  onClick={() => setShowSpawnModal(false)}
                  title="Cancel"
                  aria-label="Cancel"
                  className="min-h-[36px] px-4 rounded-xl bg-[#21262D] text-[#8B949E] hover:text-[#F0F6FC] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={spawning}
                  title="Launch autonomous task"
                  aria-label="Launch autonomous task"
                  className="min-h-[36px] px-4 rounded-xl bg-[#C7FF65] text-[#0D1117] font-semibold hover:bg-[#d6ff85] flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{spawning ? 'Spawning...' : 'Launch Task'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          INSTALL CUSTOM AGENT MODAL
          ========================================================================= */}
      {showInstallModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-sm"
            onClick={() => setShowInstallModal(false)}
          />
          <div className="relative w-full max-w-lg bg-[#161B22] border border-[#30363D] rounded-2xl shadow-2xl p-5 space-y-4 z-10">
            <div className="flex items-center justify-between pb-3 border-b border-[#30363D]">
              <div className="flex items-center gap-2">
                <Plus className="w-4 h-4 text-[#C7FF65]" />
                <h3 className="font-bold text-sm text-[#F0F6FC]">Install Custom Agent</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowInstallModal(false)}
                title="Close modal"
                aria-label="Close modal"
                className="p-1 text-[#8B949E] hover:text-[#F0F6FC] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {installError && (
              <div className="p-2.5 rounded-xl bg-[#FF727A]/10 border border-[#FF727A]/30 text-xs text-[#FF727A]">
                {installError}
              </div>
            )}

            <form onSubmit={handleInstallCustomAgent} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-[#8B949E] mb-1 font-medium">Agent Name</label>
                <input
                  type="text"
                  value={newAgentName}
                  onChange={(e) => setNewAgentName(e.target.value)}
                  placeholder="e.g. SQLite Security Auditor"
                  aria-label="Custom agent name"
                  required
                  className="w-full min-h-[38px] px-3 rounded-xl bg-[#0D1117] border border-[#30363D] text-[#F0F6FC] focus:border-[#C7FF65] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[#8B949E] mb-1 font-medium">Specialized Role</label>
                <input
                  type="text"
                  value={newAgentRole}
                  onChange={(e) => setNewAgentRole(e.target.value)}
                  placeholder="e.g. Security Specialist"
                  aria-label="Specialized agent role"
                  className="w-full min-h-[38px] px-3 rounded-xl bg-[#0D1117] border border-[#30363D] text-[#F0F6FC] focus:border-[#C7FF65] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[#8B949E] mb-1 font-medium">System Instructions</label>
                <textarea
                  value={newAgentPrompt}
                  onChange={(e) => setNewAgentPrompt(e.target.value)}
                  placeholder="System instructions for this agent's reasoning..."
                  aria-label="System instructions"
                  rows={4}
                  required
                  className="w-full p-3 rounded-xl bg-[#0D1117] border border-[#30363D] text-[#F0F6FC] focus:border-[#C7FF65] focus:outline-none resize-none leading-relaxed"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#30363D]">
                <button
                  type="button"
                  onClick={() => setShowInstallModal(false)}
                  title="Cancel"
                  aria-label="Cancel"
                  className="min-h-[36px] px-4 rounded-xl bg-[#21262D] text-[#8B949E] hover:text-[#F0F6FC] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingAgent}
                  title="Install agent profile"
                  aria-label="Install agent profile"
                  className="min-h-[36px] px-4 rounded-xl bg-[#C7FF65] text-[#0D1117] font-semibold hover:bg-[#d6ff85] flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{savingAgent ? 'Installing...' : 'Install Agent'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
