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
} from 'lucide-react';
import {
  Conversation,
  AgentActivityEvent,
  SubAgentTask,
  ProviderSummary,
  FileDiffRecord,
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
  subagentTasks = [],
  onSelectConversation,
  onNavigateToWorkspace,
  onNavigateToChat,
  providers = [],
}) => {
  const [selectedAgentId, setSelectedAgentId] = useState<string>('primary-agent');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showDiffModal, setShowDiffModal] = useState<boolean>(false);
  const [showAddAgentModal, setShowAddAgentModal] = useState<boolean>(false);
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);

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

  // Registry of agents (filtered to exclude local AI for agent roles)
  const registeredAgents: RegisteredAgent[] = useMemo(() => {
    const list: RegisteredAgent[] = [
      {
        id: 'primary-agent',
        name: 'Primary Agent',
        roleTitle: 'Autonomous Coder',
        category: 'primary',
        status: sending ? 'Running' : 'Active',
        lastActivity: activeConv ? 'Active in Chat' : 'Standby',
        taskSummary: 'Full-stack code generation, refactoring, and patch creation via API.',
        accentColor: '#388BFD',
        icon: Code2,
        modelId: activeConv?.modelId || 'gemini-3.8-flash',
      },
      {
        id: 'collaborator-agent',
        name: 'Collaborator',
        roleTitle: 'Architecture Reviewer',
        category: 'collaborator',
        status: 'Active',
        lastActivity: activeConv?.collaboratorModelId ? 'Active in Chat' : 'Standby',
        taskSummary: 'Architecture validation, concurrency review, and edge case audit.',
        accentColor: '#A371F7',
        icon: Shield,
        modelId: activeConv?.collaboratorModelId || 'gemini-3.1-flash-lite',
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
        taskSummary: 'Unit test execution, regression suites, and APK validation.',
        accentColor: '#22C55E',
        icon: Play,
        modelId: 'test-runner-api',
      },
    ];

    // Dynamic sub-agent tasks
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
  }, [sending, activeConv, subagentTasks, customAgents]);

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

  const handleOpenChatInAgentMode = () => {
    if (onNavigateToChat) {
      onNavigateToChat({ mode: 'agent', conversationId: activeConv?.id });
    }
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

  return (
    <div className="flex h-full w-full bg-[#0D0F12] text-[#E8EAED] overflow-hidden select-text font-sans">
      {/* =========================================================================
          LEFT AGENT DIRECTORY & SEARCH
          ========================================================================= */}
      <aside className="w-80 bg-[#15181D] border-r border-[#292E36] flex flex-col shrink-0">
        <div className="p-3.5 border-b border-[#292E36] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-[#C7FF65]/10 border border-[#C7FF65]/30 flex items-center justify-center shrink-0">
              <Layers className="w-4 h-4 text-[#C7FF65]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-semibold text-[#E8EAED] tracking-tight truncate">Duet Agents</h2>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-[#1B1F25] border border-[#292E36] text-[#9299A5]">
                  {registeredAgents.length}
                </span>
              </div>
              <p className="text-[11px] text-[#9299A5] truncate">Agent Registry & Roles</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowAddAgentModal(true)}
            title="Register Specialized Agent Role"
            className="p-1.5 rounded-md hover:bg-[#1B1F25] text-[#9299A5] hover:text-[#C7FF65] border border-transparent hover:border-[#292E36] transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Search Input */}
        <div className="p-3 border-b border-[#292E36]/60">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-[#9299A5] absolute left-2.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter agents by role or task…"
              className="w-full bg-[#0D0F12] border border-[#292E36] rounded-md pl-8 pr-7 py-1.5 text-xs text-[#E8EAED] placeholder-[#9299A5]/70 focus:outline-none focus:border-[#C7FF65]/50 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 text-[#9299A5] hover:text-[#E8EAED]"
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
                onClick={() => setSelectedAgentId(agent.id)}
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
        <div className="p-3 border-t border-[#292E36] bg-[#0D0F12]/60 space-y-2">
          <div
            onClick={() => onNavigateToWorkspace && onNavigateToWorkspace(activeWorkspaceId)}
            className="flex items-center justify-between p-2 rounded-md bg-[#1B1F25] border border-[#292E36] hover:border-[#9299A5]/40 transition-colors cursor-pointer group"
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
              className="hover:text-[#E8EAED]"
            >
              <RefreshCw className={`w-3 h-3 ${loadingCheckpoints ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </aside>

      {/* =========================================================================
          MAIN MONITORING & TELEMETRY HUB
          ========================================================================= */}
      <main className="flex-1 flex flex-col min-w-0 h-full overflow-y-auto custom-scrollbar p-4 sm:p-6 space-y-6">
        {/* Top Notification: Unified Chat System */}
        <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-[#161B22] via-[#1B1F25] to-[#161B22] border border-[#C7FF65]/30 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#C7FF65]/15 border border-[#C7FF65]/40 flex items-center justify-center text-[#C7FF65] shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#C7FF65]/20 text-[#C7FF65] border border-[#C7FF65]/30">
                  UNIFIED ARCHITECTURE
                </span>
                <span className="text-xs text-[#9299A5]">Single Chat Engine</span>
              </div>
              <h2 className="text-base sm:text-lg font-bold text-[#E8EAED] tracking-tight">
                Duet Agent is now integrated directly into Chat
              </h2>
              <p className="text-xs text-[#9299A5] max-w-xl leading-relaxed mt-0.5">
                Toggle <span className="font-semibold text-[#E8EAED]">[ Agent Mode ]</span> on the Chat page to collaborate with
                Primary and Collaborating models, inspect real tool execution, and review unified diffs in one shared conversation.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 w-full md:w-auto">
            <button
              type="button"
              onClick={handleOpenChatInAgentMode}
              className="flex-1 md:flex-initial px-4 py-2.5 rounded-xl bg-[#C7FF65] hover:bg-[#b8f54c] text-black font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md shadow-[#C7FF65]/10"
            >
              <MessageSquare className="w-4 h-4" />
              <span>Open Chat in Agent Mode</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setShowSettingsModal(true)}
              className="p-2.5 rounded-xl bg-[#1B1F25] border border-[#292E36] hover:border-[#9299A5] text-[#9299A5] hover:text-[#E8EAED] cursor-pointer"
              title="Duet Orchestration Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Active Conversation Status Card */}
        <div className="p-4 rounded-xl bg-[#15181D] border border-[#292E36] space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#292E36]/60">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-[#388BFD]" />
              <h3 className="text-xs font-bold text-[#E8EAED] uppercase tracking-wider">
                Shared Conversation Status
              </h3>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-[#9299A5]">Current Mode:</span>
              <span
                className={`px-2 py-0.5 rounded font-mono font-semibold text-[11px] ${
                  activeConv?.chatMode === 'agent'
                    ? 'bg-[#C7FF65]/15 text-[#C7FF65] border border-[#C7FF65]/30'
                    : 'bg-[#21262D] text-[#E8EAED] border border-[#30363D]'
                }`}
              >
                {activeConv?.chatMode === 'agent' ? 'Agent Mode' : 'Normal Chat'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-2.5 rounded-lg bg-[#0D0F12] border border-[#292E36]">
              <span className="text-[10px] text-[#9299A5] uppercase font-mono">Session Title</span>
              <div className="font-semibold text-[#E8EAED] truncate mt-0.5">
                {activeConv?.title || 'OBSIDIAN Workstation'}
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-[#0D0F12] border border-[#292E36]">
              <span className="text-[10px] text-[#9299A5] uppercase font-mono">Primary Model</span>
              <div className="font-semibold text-[#388BFD] font-mono truncate mt-0.5">
                {activeConv?.modelId || 'gemini-3.8-flash'}
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-[#0D0F12] border border-[#292E36]">
              <span className="text-[10px] text-[#9299A5] uppercase font-mono">Collaborator Model</span>
              <div className="font-semibold text-[#A371F7] font-mono truncate mt-0.5">
                {activeConv?.collaboratorModelId || 'gemini-3.1-flash-lite'}
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-[#0D0F12] border border-[#292E36]">
              <span className="text-[10px] text-[#9299A5] uppercase font-mono">Execution State</span>
              <div className="font-semibold text-[#22C55E] font-mono truncate mt-0.5">
                {sending ? 'Running Generation…' : activeConv?.taskState || 'Idle / Ready'}
              </div>
            </div>
          </div>
        </div>

        {/* Real Workspace Diff Checkpoints & Telemetry */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: Workspace Checkpoints */}
          <div className="p-4 rounded-xl bg-[#15181D] border border-[#292E36] flex flex-col space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-[#292E36]/60">
              <div className="flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-[#C7FF65]" />
                <h3 className="text-xs font-bold text-[#E8EAED] uppercase tracking-wider">
                  Workspace Diffs ({workspaceCheckpoints.length})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowDiffModal(true)}
                className="text-[11px] text-[#C7FF65] hover:underline font-mono cursor-pointer"
              >
                Inspect All
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 max-h-64 custom-scrollbar">
              {workspaceCheckpoints.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#9299A5]">
                  No file diff checkpoints recorded in this workspace yet.
                </div>
              ) : (
                workspaceCheckpoints.slice(0, 5).map((cp) => (
                  <div
                    key={cp.id}
                    className="p-2 rounded-lg bg-[#0D0F12] border border-[#292E36] flex items-center justify-between text-xs font-mono"
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

          {/* Right: Real-Time Activity Events */}
          <div className="p-4 rounded-xl bg-[#15181D] border border-[#292E36] flex flex-col space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-[#292E36]/60">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-[#388BFD]" />
                <h3 className="text-xs font-bold text-[#E8EAED] uppercase tracking-wider">
                  Recent Activity Stream ({events.length})
                </h3>
              </div>
              <span className="text-[10px] font-mono text-[#9299A5]">Live Telemetry</span>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 max-h-64 custom-scrollbar">
              {events.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#9299A5]">
                  No tool activity recorded yet. Run a coding task in Agent Mode.
                </div>
              ) : (
                events.slice(0, 6).map((ev) => (
                  <div
                    key={ev.id}
                    className="p-2 rounded-lg bg-[#0D0F12] border border-[#292E36] flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E] shrink-0" />
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
      </main>

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
                className="px-4 py-1.5 rounded-lg bg-[#1B1F25] border border-[#292E36] hover:bg-[#292E36] text-xs font-medium text-[#E8EAED] cursor-pointer"
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
                <h3 className="font-bold text-sm text-[#E8EAED]">Register Duet Agent Role</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddAgentModal(false)}
                className="text-[#9299A5] hover:text-[#E8EAED]"
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
                  className="w-full bg-[#0D0F12] border border-[#292E36] rounded-lg px-3 py-2 text-xs text-[#E8EAED] focus:outline-none focus:border-[#C7FF65]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#9299A5] mb-1">Specialist Role</label>
                <select
                  value={newAgentRole}
                  onChange={(e) => setNewAgentRole(e.target.value)}
                  className="w-full bg-[#0D0F12] border border-[#292E36] rounded-lg px-3 py-2 text-xs text-[#E8EAED] focus:outline-none focus:border-[#C7FF65]"
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
                className="px-3 py-1.5 rounded-lg bg-[#1B1F25] text-xs font-medium text-[#9299A5] hover:text-[#E8EAED]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg bg-[#C7FF65] hover:bg-[#b8f54c] text-xs font-bold text-black"
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
                className="text-[#9299A5] hover:text-[#E8EAED]"
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
                  className="w-full bg-[#0D0F12] border border-[#292E36] rounded-lg px-3 py-2 text-xs text-[#E8EAED] focus:outline-none focus:border-[#C7FF65]"
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
                className="px-4 py-1.5 rounded-lg bg-[#C7FF65] text-xs font-bold text-black"
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
