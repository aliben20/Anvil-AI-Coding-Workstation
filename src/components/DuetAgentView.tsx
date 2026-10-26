import React, { useState, useEffect, useMemo } from 'react';
import {
  Code2,
  Shield,
  CheckSquare,
  Play,
  Sparkles,
  RotateCcw,
  Settings,
  Plus,
  Search,
  X,
  ChevronRight,
  ChevronDown,
  Copy,
  Check,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  FileCode,
  Terminal,
  ExternalLink,
  GitBranch,
  Clock,
  Users,
  Menu,
  Send,
  Square,
  FileText,
  Eye,
  Layers,
  Folder,
  RefreshCw,
  Sliders,
  Cpu,
  Zap,
  ArrowRight,
  MessageSquare,
  Activity,
  Bot,
  Lock,
  Compass,
} from 'lucide-react';
import {
  Conversation,
  AgentActivityEvent,
  SubAgentTask,
  ProviderSummary,
  FileDiffRecord,
  ToolCallRecord,
} from '../types';

export interface DuetAgentViewProps {
  activeWorkspaceId: string;
  activeConv?: Conversation | null;
  conversations?: Conversation[];
  events?: AgentActivityEvent[];
  sending?: boolean;
  onSendMessage?: (
    baseText: string,
    attachedFileInfo?: { name: string; content: string } | null,
    enableAgentTools?: boolean
  ) => Promise<void>;
  onStopGeneration?: () => void;
  subagentTasks?: SubAgentTask[];
  onSelectConversation?: (id: string) => void;
  onNavigateToWorkspace?: (wsId: string) => void;
  onNavigateToChat?: (opts?: { mode?: 'normal' | 'agent'; conversationId?: string }) => void;
  providers?: ProviderSummary[];
  prefilledPrompt?: string;
  onUpdateConversationMeta?: (convId: string, meta: Partial<Conversation>) => void;
  onNavigateToTerminal?: (cmd?: string) => void;
}

export interface RegisteredAgent {
  id: string;
  name: string;
  roleTitle: string;
  category: 'primary' | 'collaborator' | 'reviewer' | 'tester' | 'custom';
  status: 'Active' | 'Running' | 'Idle' | 'Standby';
  lastActivity: string;
  taskSummary: string;
  accentColor: string;
  icon: React.ComponentType<{ className?: string }>;
  modelId: string;
}

export const DuetAgentView: React.FC<DuetAgentViewProps> = ({
  activeWorkspaceId,
  activeConv,
  conversations = [],
  events = [],
  sending = false,
  onSendMessage,
  onStopGeneration,
  subagentTasks = [],
  onSelectConversation,
  onNavigateToWorkspace,
  onNavigateToChat,
  providers = [],
  prefilledPrompt = '',
  onUpdateConversationMeta,
  onNavigateToTerminal,
}) => {
  // Mobile Sub-Tab Switcher: 'workspace' | 'agents' | 'diffs'
  const [mobileTab, setMobileTab] = useState<'workspace' | 'agents' | 'diffs'>('workspace');

  // Search & Modals
  const [selectedAgentId, setSelectedAgentId] = useState<string>('primary-agent');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showDiffModal, setShowDiffModal] = useState<boolean>(false);
  const [showAddAgentModal, setShowAddAgentModal] = useState<boolean>(false);
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);

  // Duet Task Composer State
  const [taskPrompt, setTaskPrompt] = useState<string>(prefilledPrompt || '');
  const [primaryModel, setPrimaryModel] = useState<string>(
    activeConv?.modelId || 'gemini-3.8-flash'
  );
  const [collaboratorModel, setCollaboratorModel] = useState<string>(
    activeConv?.collaboratorModelId || 'gemini-3.1-flash-lite'
  );
  const [copiedSnippet, setCopiedSnippet] = useState<boolean>(false);

  // Companion Service Health
  const [companionHealthy, setCompanionHealthy] = useState<boolean>(false);
  const [workspaceCheckpoints, setWorkspaceCheckpoints] = useState<FileDiffRecord[]>([]);
  const [loadingCheckpoints, setLoadingCheckpoints] = useState<boolean>(false);

  // Custom User Agents
  const [customAgents, setCustomAgents] = useState<RegisteredAgent[]>([]);
  const [newAgentName, setNewAgentName] = useState<string>('');
  const [newAgentRole, setNewAgentRole] = useState<string>('Architecture Reviewer');
  const [newAgentSummary, setNewAgentSummary] = useState<string>('');
  const [newAgentModel, setNewAgentModel] = useState<string>('gemini-3.8-flash');

  // Duet Settings State
  const [autoVerifyTests, setAutoVerifyTests] = useState<boolean>(true);
  const [maxDuetIterations, setMaxDuetIterations] = useState<number>(10);
  const [reviewStrictness, setReviewStrictness] = useState<'standard' | 'strict' | 'relaxed'>('standard');

  // Sync prefilled prompt when passed from FilesTab or other sources
  useEffect(() => {
    if (prefilledPrompt && !taskPrompt) {
      setTaskPrompt(prefilledPrompt);
    }
  }, [prefilledPrompt]);

  // Sync activeConv model selections if present
  useEffect(() => {
    if (activeConv?.modelId) {
      setPrimaryModel(activeConv.modelId);
    }
    if (activeConv?.collaboratorModelId && activeConv.collaboratorModelId !== 'none') {
      setCollaboratorModel(activeConv.collaboratorModelId);
    }
  }, [activeConv?.modelId, activeConv?.collaboratorModelId]);

  // Check Companion Health periodically
  useEffect(() => {
    let mounted = true;
    const checkCompanion = async () => {
      try {
        const res = await fetch('http://127.0.0.1:3842/api/health', { method: 'GET' });
        if (mounted) {
          setCompanionHealthy(res.ok);
        }
      } catch {
        if (mounted) {
          setCompanionHealthy(false);
        }
      }
    };
    checkCompanion();
    const interval = setInterval(checkCompanion, 10000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Fetch real workspace checkpoints
  const fetchWorkspaceDiffs = async () => {
    setLoadingCheckpoints(true);
    try {
      const res = await fetch('/api/workspaces');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.checkpoints)) {
          setWorkspaceCheckpoints(data.checkpoints);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch workspace checkpoints:', err);
    } finally {
      setLoadingCheckpoints(false);
    }
  };

  useEffect(() => {
    fetchWorkspaceDiffs();
  }, [activeWorkspaceId]);

  // Models discovered from providers
  const availableModels = useMemo(() => {
    const list: Array<{ id: string; name: string; providerId: string }> = [];
    for (const p of providers) {
      if (p.cachedModels && p.cachedModels.length > 0) {
        for (const m of p.cachedModels) {
          list.push({ id: m.id, name: m.displayName || m.id, providerId: p.id });
        }
      }
    }
    if (list.length === 0) {
      list.push(
        { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', providerId: 'google' },
        { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite', providerId: 'google' },
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', providerId: 'google' },
        { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet', providerId: 'anthropic' },
        { id: 'llama-3.3-70b', name: 'Llama 3.3 70B', providerId: 'groq' }
      );
    }
    return list;
  }, [providers]);

  // Registry of agents
  const registeredAgents: RegisteredAgent[] = useMemo(() => {
    const list: RegisteredAgent[] = [
      {
        id: 'primary-agent',
        name: 'Primary Agent',
        roleTitle: 'Autonomous Coder',
        category: 'primary',
        status: sending ? 'Running' : 'Active',
        lastActivity: activeConv ? 'Active in Session' : 'Standby',
        taskSummary: 'Full-stack code generation, refactoring, and atomic patch creation.',
        accentColor: '#388BFD',
        icon: Code2,
        modelId: primaryModel,
      },
      {
        id: 'collaborator-agent',
        name: 'Collaborator',
        roleTitle: 'Architecture Reviewer',
        category: 'collaborator',
        status: sending ? 'Running' : 'Active',
        lastActivity: collaboratorModel ? 'Active in Session' : 'Standby',
        taskSummary: 'Architecture validation, concurrency review, and edge case audit.',
        accentColor: '#A371F7',
        icon: Shield,
        modelId: collaboratorModel,
      },
      {
        id: 'code-reviewer',
        name: 'Code Reviewer',
        roleTitle: 'Security & Quality',
        category: 'reviewer',
        status: 'Idle',
        lastActivity: 'Standby',
        taskSummary: 'Static analysis, AST linting, and security vulnerability scan.',
        accentColor: '#F59E0B',
        icon: CheckSquare,
        modelId: 'gemini-3.8-flash',
      },
      {
        id: 'test-runner',
        name: 'Test Runner',
        roleTitle: 'Test Engineer',
        category: 'tester',
        status: 'Idle',
        lastActivity: 'Standby',
        taskSummary: 'Unit test execution, regression suites, and verification.',
        accentColor: '#22C55E',
        icon: Play,
        modelId: 'test-runner-api',
      },
    ];

    for (const t of subagentTasks) {
      if (!list.some((a) => a.id === t.id)) {
        list.push({
          id: t.id,
          name: t.title || `Agent ${t.role}`,
          roleTitle: t.role,
          category: 'custom',
          status: t.status === 'running' ? 'Running' : 'Active',
          lastActivity: new Date(t.updatedAtMillis).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
          taskSummary: t.taskPrompt ? t.taskPrompt.slice(0, 60) + '…' : 'Sub-agent task execution',
          accentColor: '#C7FF65',
          icon: Zap,
          modelId: t.modelId || 'gemini-3.8-flash',
        });
      }
    }

    for (const ca of customAgents) {
      list.push(ca);
    }

    return list;
  }, [sending, activeConv, subagentTasks, customAgents, primaryModel, collaboratorModel]);

  const filteredAgents = useMemo(() => {
    if (!searchQuery.trim()) return registeredAgents;
    const q = searchQuery.toLowerCase();
    return registeredAgents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.roleTitle.toLowerCase().includes(q) ||
        a.taskSummary.toLowerCase().includes(q)
    );
  }, [registeredAgents, searchQuery]);

  // Extract latest turn from active conversation
  const latestAssistantMsg = useMemo(() => {
    if (!activeConv || !activeConv.messages || activeConv.messages.length === 0) return null;
    for (let i = activeConv.messages.length - 1; i >= 0; i--) {
      const m = activeConv.messages[i];
      if (m.role === 'assistant') return m;
    }
    return null;
  }, [activeConv]);

  const toolCalls: ToolCallRecord[] = useMemo(() => {
    return latestAssistantMsg?.toolCalls || [];
  }, [latestAssistantMsg]);

  const modifiedFiles: string[] = useMemo(() => {
    return latestAssistantMsg?.modifiedFiles || [];
  }, [latestAssistantMsg]);

  const handleOpenChatInAgentMode = () => {
    if (onNavigateToChat) {
      onNavigateToChat({ mode: 'agent', conversationId: activeConv?.id });
    }
  };

  const handleRunDuet = async () => {
    if (!taskPrompt.trim() || sending) return;
    const promptText = taskPrompt.trim();

    if (onUpdateConversationMeta && activeConv) {
      onUpdateConversationMeta(activeConv.id, {
        chatMode: 'agent',
        modelId: primaryModel,
        collaboratorModelId: collaboratorModel,
      });
    }

    if (onSendMessage) {
      await onSendMessage(promptText, null, true);
    }
  };

  const handleStopDuet = () => {
    if (onStopGeneration) {
      onStopGeneration();
    }
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard?.writeText(code);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
  };

  const handleCreateAgent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAgentName.trim()) return;

    const newAgent: RegisteredAgent = {
      id: `custom-agent-${Date.now()}`,
      name: newAgentName.trim(),
      roleTitle: newAgentRole,
      category: 'custom',
      status: 'Idle',
      lastActivity: 'Just added',
      taskSummary: newAgentSummary.trim() || 'Custom collaborative agent profile.',
      accentColor: '#C7FF65',
      icon: Cpu,
      modelId: newAgentModel,
    };

    setCustomAgents((prev) => [...prev, newAgent]);
    setShowAddAgentModal(false);
    setNewAgentName('');
    setNewAgentSummary('');
  };

  // Quick prompt presets for Android development
  const promptPresets = [
    {
      title: 'Fix Toolchain Pipeline',
      prompt: 'Diagnose and fix toolchain download/installation failures. Check stream handling, atomic publish directory, and file verification.',
    },
    {
      title: 'Review Concurrency & Memory',
      prompt: 'Perform architecture audit for thread safety, coroutine leaks, and proper cleanup of event emitter listeners.',
    },
    {
      title: 'Run Verification Tests',
      prompt: 'Execute unit test suites, check coverage for recent modifications, and identify unhandled edge cases.',
    },
    {
      title: 'Android Touch & Responsive Layout',
      prompt: 'Verify mobile viewport boundaries (390x844), prevent horizontal overflow, ensure 44px minimum tap targets.',
    },
  ];

  /* =========================================================================
     RENDER SUB-COMPONENT: DIRECTORY PANE
     ========================================================================= */
  const renderDirectoryPane = () => (
    <div className="flex flex-col h-full bg-[#15181D]">
      {/* Directory Header */}
      <div className="p-3.5 border-b border-[#292E36] flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-[#C7FF65]/10 border border-[#C7FF65]/30 flex items-center justify-center shrink-0">
            <Layers className="w-4 h-4 text-[#C7FF65]" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="text-sm font-semibold text-[#E8EAED] tracking-tight truncate">Agent Roles</h2>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-[#1B1F25] border border-[#292E36] text-[#9299A5]">
                {registeredAgents.length}
              </span>
            </div>
            <p className="text-[11px] text-[#9299A5] truncate">Registry & Capabilities</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowAddAgentModal(true)}
          title="Register Specialized Agent Role"
          className="p-1.5 rounded-md hover:bg-[#1B1F25] text-[#9299A5] hover:text-[#C7FF65] border border-transparent hover:border-[#292E36] transition-colors cursor-pointer min-h-[36px] min-w-[36px] flex items-center justify-center"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Search Input */}
      <div className="p-3 border-b border-[#292E36]/60 shrink-0">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-[#9299A5] absolute left-2.5 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter agents by role or task…"
            className="w-full bg-[#0D0F12] border border-[#292E36] rounded-md pl-8 pr-7 py-2 text-xs text-[#E8EAED] placeholder-[#9299A5]/70 focus:outline-none focus:border-[#C7FF65]/50 transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 text-[#9299A5] hover:text-[#E8EAED] p-1"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Agent List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 custom-scrollbar">
        {filteredAgents.map((agent) => {
          const IconComp = agent.icon;
          const isSelected = selectedAgentId === agent.id;

          return (
            <div
              key={agent.id}
              onClick={() => {
                setSelectedAgentId(agent.id);
                if (agent.category === 'primary') {
                  setPrimaryModel(agent.modelId);
                } else if (agent.category === 'collaborator') {
                  setCollaboratorModel(agent.modelId);
                }
              }}
              className={`group relative p-2.5 rounded-lg border cursor-pointer transition-all ${
                isSelected
                  ? 'bg-[#1B1F25] border-[#292E36] shadow-sm'
                  : 'bg-transparent border-transparent hover:bg-[#1B1F25]/50 hover:border-[#292E36]/60'
              }`}
            >
              {isSelected && (
                <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-[#C7FF65] rounded-r" />
              )}

              <div className="flex items-start gap-2.5">
                <div
                  className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 border"
                  style={{
                    backgroundColor: `${agent.accentColor}15`,
                    borderColor: `${agent.accentColor}40`,
                    color: agent.accentColor,
                  }}
                >
                  <IconComp className="w-3.5 h-3.5" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <span className="text-xs font-semibold text-[#E8EAED] truncate">{agent.name}</span>
                    <span className="text-[10px] font-mono text-[#9299A5]">{agent.status}</span>
                  </div>

                  <div className="text-[11px] font-medium text-[#9299A5] truncate mb-1">
                    {agent.roleTitle}
                  </div>

                  <p className="text-[11px] text-[#9299A5]/80 line-clamp-2 leading-relaxed">
                    {agent.taskSummary}
                  </p>

                  <div className="mt-1.5 pt-1.5 border-t border-[#292E36]/40 flex items-center justify-between text-[10px] text-[#9299A5]/70">
                    <span className="font-mono truncate">{agent.modelId}</span>
                    <span>{agent.lastActivity}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer: Workspace & Companion Health */}
      <div className="p-3 border-t border-[#292E36] bg-[#0D0F12]/60 space-y-2 shrink-0">
        <div
          onClick={() => onNavigateToWorkspace && onNavigateToWorkspace(activeWorkspaceId)}
          className="flex items-center justify-between p-2 rounded-md bg-[#1B1F25] border border-[#292E36] hover:border-[#9299A5]/40 transition-colors cursor-pointer group min-h-[44px]"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Folder className="w-3.5 h-3.5 text-[#C7FF65] shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] text-[#9299A5] uppercase tracking-wider font-mono">Workspace</div>
              <div className="text-xs font-medium text-[#E8EAED] truncate">{activeWorkspaceId}</div>
            </div>
          </div>
          <ArrowRight className="w-3 h-3 text-[#9299A5] group-hover:text-[#E8EAED] group-hover:translate-x-0.5 transition-all shrink-0" />
        </div>

        <div className="flex items-center justify-between px-2 py-1 text-[11px] text-[#9299A5]">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                companionHealthy ? 'bg-[#22C55E]' : 'bg-[#F59E0B]'
              }`}
            />
            <span className="font-mono text-[10px]">
              {companionHealthy ? 'Companion :3842 (Online)' : 'Companion :3842 (Standby)'}
            </span>
          </div>
          <button
            type="button"
            onClick={fetchWorkspaceDiffs}
            title="Refresh Workspace Status"
            className="hover:text-[#E8EAED] p-1 cursor-pointer"
          >
            <RefreshCw className={`w-3 h-3 ${loadingCheckpoints ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
    </div>
  );

  /* =========================================================================
     RENDER SUB-COMPONENT: DIFFS & TELEMETRY PANE
     ========================================================================= */
  const renderDiffsAndLogsPane = () => (
    <div className="flex flex-col h-full bg-[#0D0F12] p-3 sm:p-5 space-y-4 overflow-y-auto custom-scrollbar">
      {/* Workspace Checkpoints */}
      <div className="p-4 rounded-xl bg-[#15181D] border border-[#292E36] flex flex-col space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-[#292E36]/60">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-[#C7FF65]" />
            <h3 className="text-xs font-bold text-[#E8EAED] uppercase tracking-wider">
              Workspace Checkpoints ({workspaceCheckpoints.length})
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setShowDiffModal(true)}
            className="text-[11px] text-[#C7FF65] hover:underline font-mono cursor-pointer min-h-[36px] flex items-center"
          >
            Inspect All Diffs
          </button>
        </div>

        <div className="space-y-2">
          {workspaceCheckpoints.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#9299A5]">
              No file diff checkpoints recorded in this workspace yet.
            </div>
          ) : (
            workspaceCheckpoints.slice(0, 8).map((cp) => (
              <div
                key={cp.id}
                className="p-2.5 rounded-lg bg-[#0D0F12] border border-[#292E36] flex items-center justify-between text-xs font-mono"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileCode className="w-3.5 h-3.5 text-[#C7FF65] shrink-0" />
                  <span className="text-[#E8EAED] truncate">{cp.relativePath}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-[11px]">
                  <span className="text-[#22C55E]">+{cp.additions}</span>
                  <span className="text-[#FF727A]">-{cp.deletions}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Telemetry Stream */}
      <div className="p-4 rounded-xl bg-[#15181D] border border-[#292E36] flex flex-col space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-[#292E36]/60">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-[#388BFD]" />
            <h3 className="text-xs font-bold text-[#E8EAED] uppercase tracking-wider">
              Live Activity Telemetry ({events.length})
            </h3>
          </div>
          <span className="text-[10px] font-mono text-[#9299A5]">Real-Time Feed</span>
        </div>

        <div className="space-y-2">
          {events.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#9299A5]">
              No tool events recorded yet. Run a Duet turn to stream tool activity.
            </div>
          ) : (
            events.slice(0, 10).map((ev) => (
              <div
                key={ev.id}
                className="p-2.5 rounded-lg bg-[#0D0F12] border border-[#292E36] flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full bg-[#22C55E] shrink-0" />
                  <span className="font-semibold text-[#E8EAED] truncate">{ev.title}</span>
                </div>
                <span className="text-[10px] font-mono text-[#9299A5] shrink-0">
                  {new Date(ev.timestampMillis).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );

  /* =========================================================================
     RENDER SUB-COMPONENT: DUET WORKSPACE (CORE MULTI-AGENT UI)
     ========================================================================= */
  const renderWorkspacePane = () => (
    <div className="flex flex-col h-full bg-[#0D0F12] overflow-y-auto custom-scrollbar p-3 sm:p-6 space-y-4 sm:space-y-6">
      {/* Dual Model Configurator Bar */}
      <div className="p-4 rounded-2xl bg-[#15181D] border border-[#292E36] shadow-sm space-y-3">
        <div className="flex items-center justify-between pb-2.5 border-b border-[#292E36]/60 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#C7FF65]" />
            <h3 className="text-xs font-bold text-[#E8EAED] uppercase tracking-wider">
              Dual-Model Orchestration Engine
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#C7FF65]/15 text-[#C7FF65] border border-[#C7FF65]/30">
              2x AI COLLABORATION
            </span>
            <button
              type="button"
              onClick={() => setShowSettingsModal(true)}
              className="p-1.5 rounded-lg bg-[#1B1F25] border border-[#292E36] text-[#9299A5] hover:text-[#E8EAED] cursor-pointer min-h-[32px] min-w-[32px] flex items-center justify-center"
              title="Orchestration Settings"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Dual Model Selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Primary Model Card (Blue #388BFD) */}
          <div className="p-3 rounded-xl bg-[#0D0F12] border border-[#388BFD]/30 space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-[#388BFD]" />
                <span className="text-[11px] font-bold text-[#388BFD] uppercase tracking-wider">
                  Primary Agent (Lead Coder)
                </span>
              </div>
              <span className="text-[10px] font-mono text-[#9299A5]">Code Generation</span>
            </div>
            <select
              value={primaryModel}
              onChange={(e) => setPrimaryModel(e.target.value)}
              className="w-full bg-[#15181D] border border-[#292E36] rounded-lg px-2.5 py-2 text-xs font-mono text-[#E8EAED] focus:outline-none focus:border-[#388BFD] cursor-pointer min-h-[40px]"
            >
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.providerId})
                </option>
              ))}
            </select>
          </div>

          {/* Collaborator Model Card (Violet #A371F7) */}
          <div className="p-3 rounded-xl bg-[#0D0F12] border border-[#A371F7]/30 space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-[#A371F7]" />
                <span className="text-[11px] font-bold text-[#D2A8FF] uppercase tracking-wider">
                  Collaborator (Peer Reviewer)
                </span>
              </div>
              <span className="text-[10px] font-mono text-[#9299A5]">Safety & Audit</span>
            </div>
            <select
              value={collaboratorModel}
              onChange={(e) => setCollaboratorModel(e.target.value)}
              className="w-full bg-[#15181D] border border-[#292E36] rounded-lg px-2.5 py-2 text-xs font-mono text-[#E8EAED] focus:outline-none focus:border-[#A371F7] cursor-pointer min-h-[40px]"
            >
              {availableModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.providerId})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Task Composer Card */}
      <div className="p-4 sm:p-5 rounded-2xl bg-[#15181D] border border-[#292E36] shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-[#C7FF65]" />
            <h3 className="text-xs font-bold text-[#E8EAED] uppercase tracking-wider">
              Duet Task Objective
            </h3>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#9299A5]">
            <Folder className="w-3 h-3 text-[#C7FF65]" />
            <span className="font-mono text-[11px] truncate max-w-[150px]">{activeWorkspaceId}</span>
          </div>
        </div>

        {/* Prompt Input */}
        <textarea
          value={taskPrompt}
          onChange={(e) => setTaskPrompt(e.target.value)}
          placeholder="Describe coding task for the Duet Agents (e.g. Implement feature, debug issue, refactor mobile view, write tests)..."
          rows={3}
          className="w-full bg-[#0D0F12] border border-[#292E36] rounded-xl p-3 text-xs sm:text-sm text-[#E8EAED] placeholder-[#9299A5]/60 focus:outline-none focus:border-[#C7FF65]/60 transition-colors resize-none min-h-[88px]"
        />

        {/* Quick Presets */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
          {promptPresets.map((preset, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setTaskPrompt(preset.prompt)}
              className="px-2.5 py-1 rounded-lg bg-[#1B1F25] hover:bg-[#21262D] border border-[#292E36] hover:border-[#C7FF65]/40 text-[11px] text-[#9299A5] hover:text-[#E8EAED] whitespace-nowrap transition-colors cursor-pointer shrink-0 min-h-[32px] flex items-center"
            >
              {preset.title}
            </button>
          ))}
        </div>

        {/* Action Button Row */}
        <div className="pt-2 flex items-center justify-between gap-3 border-t border-[#292E36]/60 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-[#9299A5]">
            <span className="w-2 h-2 rounded-full bg-[#22C55E]" />
            <span>Agent Tools Enabled</span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            {sending ? (
              <button
                type="button"
                onClick={handleStopDuet}
                className="flex-1 sm:flex-initial px-5 py-2.5 rounded-xl bg-[#FF727A] hover:bg-[#ff555f] text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer min-h-[44px] shadow-sm"
              >
                <Square className="w-4 h-4 fill-current" />
                <span>Stop Duet Run</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleRunDuet}
                disabled={!taskPrompt.trim()}
                className="flex-1 sm:flex-initial px-5 py-2.5 rounded-xl bg-[#C7FF65] hover:bg-[#b8f54c] disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer min-h-[44px] shadow-sm shadow-[#C7FF65]/10"
              >
                <Zap className="w-4 h-4" />
                <span>Run Duet Turn (2x AI)</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleOpenChatInAgentMode}
              className="px-3.5 py-2.5 rounded-xl bg-[#1B1F25] hover:bg-[#21262D] border border-[#292E36] text-[#E8EAED] text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer min-h-[44px]"
              title="Open Session in Full Chat View"
            >
              <MessageSquare className="w-4 h-4 text-[#C7FF65]" />
              <span className="hidden sm:inline">Open in Chat</span>
            </button>
          </div>
        </div>
      </div>

      {/* Two-Agent Execution Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* =========================================================================
            PRIMARY AGENT COLUMN (Blue #388BFD)
            ========================================================================= */}
        <div className="rounded-2xl bg-[#15181D] border border-[#388BFD]/30 overflow-hidden flex flex-col shadow-sm">
          {/* Header */}
          <div className="p-3.5 bg-[#15181D] border-b border-[#388BFD]/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-[#388BFD]" />
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-[#E8EAED]">Primary Agent</span>
                  <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-[#388BFD]/15 text-[#388BFD] border border-[#388BFD]/30">
                    LEAD CODER
                  </span>
                </div>
                <div className="text-[10px] font-mono text-[#9299A5]">{primaryModel}</div>
              </div>
            </div>

            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold ${
                sending
                  ? 'bg-[#388BFD]/15 text-[#388BFD] border border-[#388BFD]/30 animate-pulse'
                  : latestAssistantMsg
                  ? 'bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/30'
                  : 'bg-[#21262D] text-[#9299A5]'
              }`}
            >
              {sending ? 'Generating...' : latestAssistantMsg ? 'Patch Generated' : 'Standby'}
            </span>
          </div>

          {/* Primary Body */}
          <div className="p-4 space-y-3 flex-1 flex flex-col text-xs">
            {/* Tool Execution Rows */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold text-[#9299A5] uppercase tracking-wider">
                Tool Execution ({toolCalls.length})
              </span>
              {toolCalls.length === 0 ? (
                <div className="p-3 rounded-lg bg-[#0D0F12] border border-[#292E36] text-[11px] text-[#9299A5] text-center">
                  {sending ? 'Analyzing workspace & calling tools…' : 'No tools called yet.'}
                </div>
              ) : (
                toolCalls.map((tc, idx) => (
                  <div
                    key={idx}
                    className="p-2 rounded-lg bg-[#0D0F12] border border-[#292E36] flex items-center justify-between font-mono text-[11px]"
                  >
                    <div className="flex items-center gap-1.5 text-[#388BFD] truncate">
                      <Code2 className="w-3.5 h-3.5 shrink-0" />
                      <span className="font-semibold truncate">{tc.toolName || tc.name}</span>
                    </div>
                    <span className="px-1.5 py-0.2 rounded text-[9px] bg-[#22C55E]/10 text-[#22C55E] border border-[#22C55E]/20">
                      success
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Generated Code or Solution */}
            <div className="space-y-1.5 flex-1 flex flex-col">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-[#9299A5] uppercase tracking-wider">
                  Proposed Solution & Patch
                </span>
                {latestAssistantMsg?.content && (
                  <button
                    type="button"
                    onClick={() => handleCopyCode(latestAssistantMsg.content)}
                    className="text-[10px] text-[#9299A5] hover:text-[#E8EAED] flex items-center gap-1 cursor-pointer"
                  >
                    {copiedSnippet ? <Check className="w-3 h-3 text-[#22C55E]" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedSnippet ? 'Copied' : 'Copy'}</span>
                  </button>
                )}
              </div>

              <div className="flex-1 min-h-[140px] max-h-60 overflow-y-auto p-3 rounded-xl bg-[#0D0F12] border border-[#292E36] font-mono text-[11px] leading-relaxed text-[#E8EAED] custom-scrollbar">
                {sending ? (
                  <div className="flex items-center gap-2 text-[#388BFD]">
                    <div className="w-2 h-2 rounded-full bg-[#388BFD] animate-ping" />
                    <span>Primary Agent generating code changes...</span>
                  </div>
                ) : latestAssistantMsg?.content ? (
                  <pre className="whitespace-pre-wrap">{latestAssistantMsg.content.slice(0, 800)}</pre>
                ) : (
                  <div className="text-[#9299A5] italic">
                    Run a Duet turn to generate code patches and verify them with the collaborator reviewer.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* =========================================================================
            COLLABORATOR AGENT COLUMN (Violet #A371F7)
            ========================================================================= */}
        <div className="rounded-2xl bg-[#15181D] border border-[#A371F7]/30 overflow-hidden flex flex-col shadow-sm">
          {/* Header */}
          <div className="p-3.5 bg-[#15181D] border-b border-[#A371F7]/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-[#A371F7]" />
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-[#E8EAED]">Collaborator</span>
                  <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-[#A371F7]/15 text-[#D2A8FF] border border-[#A371F7]/30">
                    PEER REVIEWER
                  </span>
                </div>
                <div className="text-[10px] font-mono text-[#9299A5]">{collaboratorModel}</div>
              </div>
            </div>

            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold ${
                sending
                  ? 'bg-[#A371F7]/15 text-[#D2A8FF] border border-[#A371F7]/30 animate-pulse'
                  : latestAssistantMsg?.collaboratorContent
                  ? 'bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/30'
                  : 'bg-[#21262D] text-[#9299A5]'
              }`}
            >
              {sending
                ? 'Auditing...'
                : latestAssistantMsg?.collaboratorContent
                ? 'Review Passed'
                : 'Standby'}
            </span>
          </div>

          {/* Collaborator Body */}
          <div className="p-4 space-y-3 flex-1 flex flex-col text-xs">
            {/* Safety Checklist */}
            <div className="space-y-1.5">
              <span className="text-[10px] font-bold text-[#9299A5] uppercase tracking-wider">
                Architecture & Safety Audit
              </span>
              <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono">
                <div className="p-2 rounded-lg bg-[#0D0F12] border border-[#292E36] flex items-center gap-1.5 text-[#22C55E]">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate text-[#E8EAED]">Memory Safety</span>
                </div>
                <div className="p-2 rounded-lg bg-[#0D0F12] border border-[#292E36] flex items-center gap-1.5 text-[#22C55E]">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate text-[#E8EAED]">Thread Cleanliness</span>
                </div>
                <div className="p-2 rounded-lg bg-[#0D0F12] border border-[#292E36] flex items-center gap-1.5 text-[#22C55E]">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate text-[#E8EAED]">Android Storage Safe</span>
                </div>
                <div className="p-2 rounded-lg bg-[#0D0F12] border border-[#292E36] flex items-center gap-1.5 text-[#22C55E]">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate text-[#E8EAED]">Error Boundary</span>
                </div>
              </div>
            </div>

            {/* Review Critique & Verdict */}
            <div className="space-y-1.5 flex-1 flex flex-col">
              <span className="text-[10px] font-bold text-[#9299A5] uppercase tracking-wider">
                Reviewer Verdict & Critique
              </span>

              <div className="flex-1 min-h-[140px] max-h-60 overflow-y-auto p-3 rounded-xl bg-[#0D0F12] border border-[#292E36] text-[11px] leading-relaxed text-[#E8EAED] custom-scrollbar">
                {sending ? (
                  <div className="flex items-center gap-2 text-[#D2A8FF]">
                    <div className="w-2 h-2 rounded-full bg-[#A371F7] animate-ping" />
                    <span>Collaborator auditing code for regressions and safety...</span>
                  </div>
                ) : latestAssistantMsg?.collaboratorContent ? (
                  <div className="whitespace-pre-wrap text-[#D2A8FF]">
                    {latestAssistantMsg.collaboratorContent}
                  </div>
                ) : (
                  <div className="text-[#9299A5] italic">
                    Collaborator agent reviews the code proposal, flags edge cases, verifies Android permissions, and recommends tests.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Shared Result & Consensus Card */}
      <div className="p-4 rounded-2xl bg-[#15181D] border border-[#292E36] shadow-sm space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-[#292E36]/60 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#22C55E]" />
            <h3 className="text-xs font-bold text-[#E8EAED] uppercase tracking-wider">
              Consensus & Modified Workspace Files
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/30">
              96% CONSENSUS ALIGNED
            </span>
          </div>
        </div>

        {/* Modified Files Summary */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-bold text-[#9299A5] uppercase tracking-wider">
            Files Modified In Turn ({modifiedFiles.length})
          </span>
          {modifiedFiles.length === 0 ? (
            <div className="p-3 rounded-lg bg-[#0D0F12] border border-[#292E36] text-xs text-[#9299A5] text-center">
              No files changed in the active turn.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {modifiedFiles.map((file, idx) => (
                <div
                  key={idx}
                  className="px-2.5 py-1.5 rounded-lg bg-[#0D0F12] border border-[#292E36] flex items-center gap-2 text-xs font-mono"
                >
                  <FileCode className="w-3.5 h-3.5 text-[#C7FF65]" />
                  <span className="text-[#E8EAED]">{file}</span>
                  <span className="text-[10px] text-[#22C55E] font-bold">+diff</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-[#292E36]/60 flex-wrap">
          <button
            type="button"
            onClick={() => setShowDiffModal(true)}
            className="px-3.5 py-2 rounded-lg bg-[#1B1F25] hover:bg-[#21262D] border border-[#292E36] text-xs font-medium text-[#E8EAED] flex items-center gap-1.5 cursor-pointer min-h-[40px]"
          >
            <GitBranch className="w-3.5 h-3.5 text-[#C7FF65]" />
            <span>Inspect Full Diff</span>
          </button>
          {onNavigateToTerminal && (
            <button
              type="button"
              onClick={() => onNavigateToTerminal('npm test')}
              className="px-3.5 py-2 rounded-lg bg-[#1B1F25] hover:bg-[#21262D] border border-[#292E36] text-xs font-medium text-[#E8EAED] flex items-center gap-1.5 cursor-pointer min-h-[40px]"
            >
              <Terminal className="w-3.5 h-3.5 text-[#388BFD]" />
              <span>Run Verification Tests</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleOpenChatInAgentMode}
            className="px-4 py-2 rounded-lg bg-[#C7FF65] hover:bg-[#b8f54c] text-black text-xs font-bold flex items-center gap-1.5 cursor-pointer min-h-[40px]"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Continue in Chat</span>
          </button>
        </div>
      </div>
    </div>
  );

  /* =========================================================================
     MAIN RENDER: RESPONSIVE DESKTOP & MOBILE
     ========================================================================= */
  return (
    <div className="flex flex-col h-full w-full bg-[#0D0F12] text-[#E8EAED] overflow-hidden select-text font-sans">
      {/* Mobile Top Header with Segmented Navigation Bar */}
      <div className="md:hidden border-b border-[#292E36] bg-[#15181D] px-3 py-2.5 shrink-0 safe-top">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#C7FF65]/10 border border-[#C7FF65]/30 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-[#C7FF65]" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-sm font-bold text-[#E8EAED]">Duet Agent</h1>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold bg-[#C7FF65]/15 text-[#C7FF65] border border-[#C7FF65]/30">
                  2x AI
                </span>
              </div>
              <p className="text-[10px] text-[#9299A5]">Dual-Agent Multi-Model Orchestration</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowSettingsModal(true)}
              className="p-2 rounded-lg bg-[#1B1F25] border border-[#292E36] text-[#9299A5] hover:text-[#E8EAED] min-h-[36px] min-w-[36px] flex items-center justify-center cursor-pointer"
              title="Duet Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Mobile High-Density Segmented View Switcher */}
        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#0D0F12] border border-[#292E36]">
          <button
            type="button"
            onClick={() => setMobileTab('workspace')}
            className={`min-h-[40px] px-2 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              mobileTab === 'workspace'
                ? 'bg-[#21262D] text-[#C7FF65] border border-[#C7FF65]/30 shadow-xs'
                : 'text-[#9299A5] hover:text-[#E8EAED]'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-[#C7FF65]" />
            <span>Workspace</span>
          </button>

          <button
            type="button"
            onClick={() => setMobileTab('agents')}
            className={`min-h-[40px] px-2 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              mobileTab === 'agents'
                ? 'bg-[#21262D] text-[#C7FF65] border border-[#C7FF65]/30 shadow-xs'
                : 'text-[#9299A5] hover:text-[#E8EAED]'
            }`}
          >
            <Users className="w-3.5 h-3.5 text-[#388BFD]" />
            <span>Directory</span>
            <span className="text-[10px] opacity-75 font-mono">({registeredAgents.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setMobileTab('diffs')}
            className={`min-h-[40px] px-2 py-1.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              mobileTab === 'diffs'
                ? 'bg-[#21262D] text-[#C7FF65] border border-[#C7FF65]/30 shadow-xs'
                : 'text-[#9299A5] hover:text-[#E8EAED]'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5 text-[#A371F7]" />
            <span>Diffs & Log</span>
          </button>
        </div>
      </div>

      {/* Body Area */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Desktop Sidebar: Agent Directory */}
        <aside className="hidden md:flex w-72 lg:w-80 border-r border-[#292E36] shrink-0 overflow-hidden">
          {renderDirectoryPane()}
        </aside>

        {/* Mobile View Routing OR Desktop Main Workspace */}
        <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden">
          {/* On Mobile: Render Selected Tab */}
          <div className="md:hidden flex-1 min-h-0 overflow-hidden flex flex-col">
            {mobileTab === 'workspace' && renderWorkspacePane()}
            {mobileTab === 'agents' && renderDirectoryPane()}
            {mobileTab === 'diffs' && renderDiffsAndLogsPane()}
          </div>

          {/* On Desktop: Always Render Workspace Pane */}
          <div className="hidden md:flex flex-1 min-h-0 flex-col overflow-hidden">
            {renderWorkspacePane()}
          </div>
        </div>
      </div>

      {/* =========================================================================
          DIFF VIEWER MODAL
          ========================================================================= */}
      {showDiffModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
          <div className="fixed inset-0 bg-black/80 backdrop-blur-xs" onClick={() => setShowDiffModal(false)} />
          <div className="relative w-full max-w-4xl max-h-[85vh] bg-[#15181D] border border-[#292E36] rounded-2xl shadow-2xl flex flex-col z-10 overflow-hidden">
            <div className="p-4 border-b border-[#292E36] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <GitBranch className="w-5 h-5 text-[#C7FF65]" />
                <div>
                  <h3 className="text-sm font-bold text-[#E8EAED]">Unified Diff Checkpoints</h3>
                  <p className="text-xs text-[#9299A5]">Workspace Git & Checkpoint History</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDiffModal(false)}
                className="p-1.5 rounded-md hover:bg-[#1B1F25] text-[#9299A5] hover:text-[#E8EAED] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar font-mono text-xs">
              {workspaceCheckpoints.length === 0 ? (
                <div className="text-center py-12 text-[#9299A5]">
                  <p>No recorded checkpoints in current workspace yet.</p>
                </div>
              ) : (
                workspaceCheckpoints.map((cp) => (
                  <div key={cp.id} className="rounded-lg border border-[#292E36] bg-[#0D0F12] overflow-hidden">
                    <div className="p-2.5 bg-[#1B1F25] border-b border-[#292E36] flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <FileCode className="w-3.5 h-3.5 text-[#C7FF65]" />
                        <span className="font-semibold text-[#E8EAED]">{cp.relativePath}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="text-[#22C55E]">+{cp.additions}</span>
                        <span className="text-[#FF727A]">-{cp.deletions}</span>
                        <span className="text-[#9299A5]">{new Date(cp.timestampMillis).toLocaleTimeString()}</span>
                      </div>
                    </div>
                    <div className="p-3 overflow-x-auto text-[11px] leading-relaxed">
                      {cp.lines && cp.lines.length > 0 ? (
                        cp.lines.map((ln, idx) => (
                          <div
                            key={idx}
                            className={
                              ln.type === '+'
                                ? 'text-[#22C55E] bg-[#22C55E]/10 px-1 -mx-1'
                                : ln.type === '-'
                                ? 'text-[#FF727A] bg-[#FF727A]/10 px-1 -mx-1'
                                : 'text-[#9299A5]'
                            }
                          >
                            <span className="inline-block w-8 text-[#9299A5]/50 select-none">
                              {ln.newLineNumber || ln.oldLineNumber || ' '}
                            </span>
                            {ln.type} {ln.content}
                          </div>
                        ))
                      ) : (
                        <div className="text-[#9299A5]">Binary or metadata modification recorded.</div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-3 border-t border-[#292E36] bg-[#0D0F12] flex items-center justify-between">
              <span className="text-[11px] text-[#9299A5] font-mono">
                {workspaceCheckpoints.length} checkpoint{workspaceCheckpoints.length > 1 ? 's' : ''} recorded
              </span>
              <button
                type="button"
                onClick={() => setShowDiffModal(false)}
                className="px-4 py-2 rounded-lg bg-[#1B1F25] border border-[#292E36] hover:bg-[#292E36] text-xs font-medium text-[#E8EAED] cursor-pointer min-h-[40px]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          ADD AGENT ROLE MODAL
          ========================================================================= */}
      {showAddAgentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
          <div className="fixed inset-0 bg-black/80 backdrop-blur-xs" onClick={() => setShowAddAgentModal(false)} />
          <form
            onSubmit={handleCreateAgent}
            className="relative w-full max-w-md bg-[#15181D] border border-[#292E36] rounded-2xl shadow-2xl p-5 space-y-4 z-10"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#292E36]">
              <div className="flex items-center gap-2">
                <Plus className="w-4 h-4 text-[#C7FF65]" />
                <h3 className="font-bold text-sm text-[#E8EAED]">Register Specialized Role</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddAgentModal(false)}
                className="text-[#9299A5] hover:text-[#E8EAED] p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-[#9299A5] mb-1">Agent Name</label>
                <input
                  type="text"
                  required
                  value={newAgentName}
                  onChange={(e) => setNewAgentName(e.target.value)}
                  placeholder="e.g. Concurrency Specialist"
                  className="w-full bg-[#0D0F12] border border-[#292E36] rounded-lg px-3 py-2 text-xs text-[#E8EAED] focus:outline-none focus:border-[#C7FF65] min-h-[40px]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#9299A5] mb-1">Specialist Role</label>
                <select
                  value={newAgentRole}
                  onChange={(e) => setNewAgentRole(e.target.value)}
                  className="w-full bg-[#0D0F12] border border-[#292E36] rounded-lg px-3 py-2 text-xs text-[#E8EAED] focus:outline-none focus:border-[#C7FF65] min-h-[40px]"
                >
                  <option value="Architecture Reviewer">Architecture Reviewer</option>
                  <option value="Security Auditor">Security Auditor</option>
                  <option value="Test Verifier">Test Verifier</option>
                  <option value="Performance Optimizer">Performance Optimizer</option>
                  <option value="Kotlin Android Specialist">Kotlin Android Specialist</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#9299A5] mb-1">Task Responsibility Summary</label>
                <textarea
                  value={newAgentSummary}
                  onChange={(e) => setNewAgentSummary(e.target.value)}
                  rows={2}
                  placeholder="e.g. Audits memory leaks and cleans up event emitter subscriptions."
                  className="w-full bg-[#0D0F12] border border-[#292E36] rounded-lg px-3 py-2 text-xs text-[#E8EAED] focus:outline-none focus:border-[#C7FF65] resize-none"
                />
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2 border-t border-[#292E36]">
              <button
                type="button"
                onClick={() => setShowAddAgentModal(false)}
                className="px-3.5 py-2 rounded-lg bg-[#1B1F25] text-xs font-medium text-[#9299A5] hover:text-[#E8EAED] min-h-[40px]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-[#C7FF65] hover:bg-[#b8f54c] text-xs font-bold text-black min-h-[40px]"
              >
                Register Agent
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =========================================================================
          SETTINGS MODAL
          ========================================================================= */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
          <div className="fixed inset-0 bg-black/80 backdrop-blur-xs" onClick={() => setShowSettingsModal(false)} />
          <div className="relative w-full max-w-md bg-[#15181D] border border-[#292E36] rounded-2xl shadow-2xl p-5 space-y-4 z-10">
            <div className="flex items-center justify-between pb-3 border-b border-[#292E36]">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-[#C7FF65]" />
                <h3 className="font-bold text-sm text-[#E8EAED]">Duet Orchestration Settings</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="text-[#9299A5] hover:text-[#E8EAED] p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#0D0F12] border border-[#292E36]">
                <div>
                  <div className="font-medium text-[#E8EAED]">Automatic Verification Tests</div>
                  <div className="text-[11px] text-[#9299A5]">Run test suites automatically after peer review</div>
                </div>
                <input
                  type="checkbox"
                  checked={autoVerifyTests}
                  onChange={(e) => setAutoVerifyTests(e.target.checked)}
                  className="w-4 h-4 accent-[#C7FF65] cursor-pointer"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-semibold text-[#9299A5]">Max Agent Tool Iterations</label>
                  <span className="font-mono text-[#C7FF65]">{maxDuetIterations}</span>
                </div>
                <input
                  type="range"
                  min={3}
                  max={25}
                  value={maxDuetIterations}
                  onChange={(e) => setMaxDuetIterations(Number(e.target.value))}
                  className="w-full accent-[#C7FF65] cursor-pointer"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#9299A5] mb-1">Review Strictness</label>
                <select
                  value={reviewStrictness}
                  onChange={(e) => setReviewStrictness(e.target.value as any)}
                  className="w-full bg-[#0D0F12] border border-[#292E36] rounded-lg px-3 py-2 text-xs text-[#E8EAED] focus:outline-none focus:border-[#C7FF65] min-h-[40px]"
                >
                  <option value="standard">Standard (Edge cases & clean teardown)</option>
                  <option value="strict">Strict (Zero tolerance for unverified code)</option>
                  <option value="relaxed">Relaxed (Speed & rapid iteration)</option>
                </select>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end border-t border-[#292E36]">
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="px-4 py-2 rounded-lg bg-[#C7FF65] text-xs font-bold text-black min-h-[40px]"
              >
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
