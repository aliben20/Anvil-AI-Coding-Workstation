import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Layers,
  Search,
  Code2,
  CheckSquare,
  Terminal,
  Bug,
  Plus,
  RefreshCw,
  Play,
  X,
  Check,
  Copy,
  Trash2,
  RotateCcw,
  Clock,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Activity,
  ArrowRight,
  Filter,
} from 'lucide-react';
import { SubAgentRole, SubAgentStatus, SubAgentTask } from '../types';

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

interface SubagentsViewProps {
  activeWorkspaceId: string;
}

export const SubagentsView: React.FC<SubagentsViewProps> = ({ activeWorkspaceId }) => {
  const [tasks, setTasks] = useState<SubAgentTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'active' | 'completed' | 'failed'>('all');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null);

  // Spawn Modal / Sheet State
  const [showSpawnModal, setShowSpawnModal] = useState(false);
  const [spawnRole, setSpawnRole] = useState<SubAgentRole>('Planner');
  const [spawnTitle, setSpawnTitle] = useState('');
  const [spawnPrompt, setSpawnPrompt] = useState('');
  const [spawnWorkspace, setSpawnWorkspace] = useState(activeWorkspaceId);
  const [spawning, setSpawning] = useState(false);
  const [spawnError, setSpawnError] = useState<string | null>(null);

  // Action states
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Fetch tasks
  const loadTasks = useCallback(async (isSilent = false) => {
    if (!isSilent) setRefreshing(true);
    try {
      const res = await fetch('/api/subagents');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.tasks)) {
          setTasks(data.tasks);
        }
      }
    } catch {
      // transient network error
    } finally {
      if (!isSilent) setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadTasks();
  }, [loadTasks]);

  // Polling when any task is actively running or queued
  const hasActiveTasks = tasks.some((t) => t.status === 'Running' || t.status === 'Queued');
  useEffect(() => {
    if (!hasActiveTasks) return;
    const interval = setInterval(() => {
      loadTasks(true);
    }, 2500);
    return () => clearInterval(interval);
  }, [hasActiveTasks, loadTasks]);

  // Quick Spawn for a specific role
  const handleOpenSpawnForRole = (role: SubAgentRole, defaultPrompt?: string) => {
    setSpawnRole(role);
    setSpawnTitle(`${role} Subtask`);
    setSpawnPrompt(defaultPrompt || '');
    setSpawnWorkspace(activeWorkspaceId);
    setSpawnError(null);
    setShowSpawnModal(true);
  };

  const handleSpawnSubmit = async (e: React.FormEvent) => {
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
          workspaceId: spawnWorkspace || activeWorkspaceId,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setSpawnError(data.error || 'Failed to spawn sub-agent task');
      } else {
        setShowSpawnModal(false);
        setSpawnPrompt('');
        setSpawnTitle('');
        if (data.task) {
          setTasks((prev) => [data.task, ...prev.filter((t) => t.id !== data.task.id)]);
          setExpandedTaskId(data.task.id);
        }
        loadTasks(true);
      }
    } catch (err) {
      setSpawnError((err as Error).message || 'Network error while spawning sub-agent');
    } finally {
      setSpawning(false);
    }
  };

  const handleCancelTask = async (taskId: string) => {
    setCancellingId(taskId);
    try {
      const res = await fetch(`/api/subagents/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' });
      if (res.ok) {
        await loadTasks(true);
      }
    } catch {
      // ignore
    } finally {
      setCancellingId(null);
    }
  };

  const handleRetryTask = async (taskId: string) => {
    setRetryingId(taskId);
    try {
      const res = await fetch(`/api/subagents/${encodeURIComponent(taskId)}/retry`, { method: 'POST' });
      if (res.ok) {
        await loadTasks(true);
        setExpandedTaskId(taskId);
      }
    } catch {
      // ignore
    } finally {
      setRetryingId(null);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    setDeletingId(taskId);
    try {
      const res = await fetch(`/api/subagents/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
      if (res.ok) {
        setTasks((prev) => prev.filter((t) => t.id !== taskId));
        if (expandedTaskId === taskId) setExpandedTaskId(null);
      }
    } catch {
      // ignore
    } finally {
      setDeletingId(null);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTaskId(id);
    setTimeout(() => setCopiedTaskId(null), 2000);
  };

  // Filter tasks
  const filteredTasks = tasks.filter((t) => {
    if (filter === 'active') return t.status === 'Running' || t.status === 'Queued';
    if (filter === 'completed') return t.status === 'Completed';
    if (filter === 'failed') return t.status === 'Failed' || t.status === 'Cancelled';
    return true;
  });

  const runningCount = tasks.filter((t) => t.status === 'Running').length;
  const queuedCount = tasks.filter((t) => t.status === 'Queued').length;
  const completedCount = tasks.filter((t) => t.status === 'Completed').length;
  const failedCount = tasks.filter((t) => t.status === 'Failed').length;

  return (
    <div className="flex-1 min-h-0 min-w-0 max-w-full overflow-y-auto p-4 sm:p-6 space-y-5 bg-[#0D1117] text-[#F0F6FC]">
      <div className="max-w-4xl mx-auto space-y-5">
        {/* =========================================================================
            HEADER & ACTIONS
            ========================================================================= */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#F0F6FC]">Sub-Agents</h1>
              <span className="px-2 py-0.5 rounded-full bg-[#C7FF65]/15 border border-[#C7FF65]/30 text-[11px] font-mono font-bold text-[#C7FF65]">
                Hierarchical
              </span>
            </div>
            <p className="text-xs text-[#8B949E] mt-0.5">
              Autonomous task delegation across 6 specialized engineering roles
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => loadTasks()}
              disabled={refreshing}
              className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#161B22] border border-[#30363D] text-[#8B949E] hover:text-[#F0F6FC] hover:border-[#8B949E] text-xs font-medium flex items-center gap-1.5 transition-colors"
              title="Refresh subagent tasks"
              aria-label="Refresh subagent tasks"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-[#C7FF65]' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            <button
              type="button"
              onClick={() => handleOpenSpawnForRole('Planner')}
              title="Delegate a new task to a specialized sub-agent"
              aria-label="Delegate task to sub-agent"
              className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-[#C7FF65] text-[#0D1117] text-xs font-semibold flex items-center gap-1.5 hover:bg-[#d6ff85] transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4 shrink-0 stroke-[2.5]" />
              <span>Delegate Task</span>
            </button>
          </div>
        </div>

        {/* =========================================================================
            STATUS OVERVIEW CARD
            ========================================================================= */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="p-3 rounded-xl bg-[#161B22] border border-[#30363D] space-y-1">
            <div className="text-[11px] font-medium text-[#8B949E] uppercase tracking-wider">Total Tasks</div>
            <div className="text-xl font-bold font-mono text-[#F0F6FC]">{tasks.length}</div>
          </div>

          <div className="p-3 rounded-xl bg-[#161B22] border border-[#30363D] space-y-1">
            <div className="text-[11px] font-medium text-[#8B949E] uppercase tracking-wider flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${runningCount > 0 ? 'bg-[#388BFD] animate-pulse' : 'bg-[#8B949E]'}`} />
              Running
            </div>
            <div className="text-xl font-bold font-mono text-[#388BFD]">
              {runningCount} <span className="text-xs text-[#8B949E] font-normal">/ 4 max</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[#161B22] border border-[#30363D] space-y-1">
            <div className="text-[11px] font-medium text-[#8B949E] uppercase tracking-wider">Completed</div>
            <div className="text-xl font-bold font-mono text-[#72D9A0]">{completedCount}</div>
          </div>

          <div className="p-3 rounded-xl bg-[#161B22] border border-[#30363D] space-y-1">
            <div className="text-[11px] font-medium text-[#8B949E] uppercase tracking-wider">Failed / Cancelled</div>
            <div className="text-xl font-bold font-mono text-[#FF727A]">{failedCount}</div>
          </div>
        </div>

        {/* =========================================================================
            BUILT-IN SPECIALIZED ROLES DIRECTORY (6 ROLES)
            ========================================================================= */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#8B949E]">
              Specialized Roles Directory
            </h2>
            <span className="text-[11px] text-[#8B949E]">Click any role to delegate</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {SUBAGENT_ROLES.map((r) => {
              const Icon = r.icon;
              return (
                <div
                  key={r.role}
                  className="p-3.5 rounded-2xl bg-[#161B22] border border-[#30363D] flex flex-col justify-between gap-3 hover:border-[#8B949E]/50 transition-all group"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`w-8 h-8 rounded-xl ${r.bgLight} border ${r.borderColor} flex items-center justify-center shrink-0`}
                        >
                          <Icon className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-[#F0F6FC]">{r.title}</div>
                          <div className="text-[10px] font-mono text-[#8B949E]">{r.role}</div>
                        </div>
                      </div>
                    </div>

                    <p className="text-[11px] text-[#8B949E] leading-relaxed line-clamp-2">
                      {r.description}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleOpenSpawnForRole(r.role, r.examplePrompt)}
                    title={`Spawn ${r.title}`}
                    aria-label={`Spawn ${r.title}`}
                    className="w-full py-1.5 px-2.5 rounded-xl bg-[#21262D] hover:bg-[#30363D] text-[#F0F6FC] text-xs font-medium flex items-center justify-center gap-1.5 transition-colors group-hover:border-[#C7FF65]/40"
                  >
                    <span>Spawn {r.role}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-[#C7FF65]" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* =========================================================================
            DELEGATED TASKS LIST & FILTER
            ========================================================================= */}
        <div className="space-y-3 pt-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#8B949E]">
              Delegated Execution Stream ({filteredTasks.length})
            </h2>

            {/* Filter Pills */}
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[#161B22] border border-[#30363D]">
              {(['all', 'active', 'completed', 'failed'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setFilter(mode)}
                  title={`Filter by ${mode} tasks`}
                  aria-label={`Filter by ${mode} tasks`}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium capitalize transition-all ${
                    filter === mode
                      ? 'bg-[#21262D] text-[#C7FF65] shadow-xs'
                      : 'text-[#8B949E] hover:text-[#F0F6FC]'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {filteredTasks.length === 0 ? (
            <div className="p-8 text-center rounded-2xl bg-[#161B22] border border-[#30363D] space-y-3 text-[#8B949E]">
              <Layers className="w-8 h-8 mx-auto opacity-40 text-[#C7FF65]" />
              <div className="text-sm font-semibold text-[#F0F6FC]">
                {filter === 'all' ? 'No Sub-Agent Tasks' : `No ${filter} tasks found`}
              </div>
              <p className="text-xs max-w-sm mx-auto">
                {filter === 'all'
                  ? 'Delegate an objective to a specialized role above, or spawn a custom sub-agent to execute autonomously in your workspace.'
                  : `There are currently no tasks matching the "${filter}" filter status.`}
              </p>
              {filter === 'all' && (
                <button
                  type="button"
                  onClick={() => handleOpenSpawnForRole('Planner')}
                  title="Spawn your first sub-agent task"
                  aria-label="Spawn first sub-agent"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#21262D] border border-[#30363D] text-xs font-medium text-[#C7FF65] hover:bg-[#30363D] transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Spawn First Sub-Agent</span>
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredTasks.map((task) => {
                const isExpanded = expandedTaskId === task.id;
                const roleMeta = SUBAGENT_ROLES.find((r) => r.role === task.role) || SUBAGENT_ROLES[0];
                const Icon = roleMeta.icon;

                // Status styling
                let statusBadge = (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-[#8B949E]/15 border border-[#8B949E]/30 text-[#8B949E]">
                    {task.status}
                  </span>
                );

                if (task.status === 'Running') {
                  statusBadge = (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-[#388BFD]/15 border border-[#388BFD]/40 text-[#388BFD] flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#388BFD] animate-pulse" />
                      Running {task.progress ? `${task.progress}%` : ''}
                    </span>
                  );
                } else if (task.status === 'Queued') {
                  statusBadge = (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-[#D29922]/15 border border-[#D29922]/30 text-[#D29922] flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Queued
                    </span>
                  );
                } else if (task.status === 'Completed') {
                  statusBadge = (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-[#72D9A0]/15 border border-[#72D9A0]/30 text-[#72D9A0] flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Completed
                    </span>
                  );
                } else if (task.status === 'Failed') {
                  statusBadge = (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-[#FF727A]/15 border border-[#FF727A]/30 text-[#FF727A] flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      Failed
                    </span>
                  );
                } else if (task.status === 'Cancelled') {
                  statusBadge = (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-[#8B949E]/15 border border-[#8B949E]/30 text-[#8B949E]">
                      Cancelled
                    </span>
                  );
                }

                return (
                  <div
                    key={task.id}
                    className="rounded-2xl bg-[#161B22] border border-[#30363D] overflow-hidden transition-all hover:border-[#8B949E]/50"
                  >
                    {/* Header Row */}
                    <div className="p-3.5 sm:p-4 flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                        title={isExpanded ? `Collapse details for ${task.title || `${task.role} Task`}` : `Expand details for ${task.title || `${task.role} Task`}`}
                        aria-label={isExpanded ? `Collapse details for ${task.title || `${task.role} Task`}` : `Expand details for ${task.title || `${task.role} Task`}`}
                        className="flex items-center gap-3 min-w-0 flex-1 text-left"
                      >
                        <div
                          className={`w-9 h-9 rounded-xl ${roleMeta.bgLight} border ${roleMeta.borderColor} flex items-center justify-center shrink-0`}
                        >
                          <Icon className="w-4 h-4" />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-xs sm:text-sm text-[#F0F6FC] truncate">
                              {task.title || `${task.role} Task`}
                            </span>
                            <span className="text-[10px] font-mono text-[#8B949E]">
                              {task.id.slice(0, 16)}
                            </span>
                          </div>
                          <div className="text-[11px] text-[#8B949E] truncate mt-0.5">
                            {task.taskPrompt}
                          </div>
                        </div>
                      </button>

                      <div className="flex items-center gap-2 shrink-0">
                        {statusBadge}

                        <button
                          type="button"
                          onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                          title={isExpanded ? "Collapse task details" : "Expand task details"}
                          aria-label={isExpanded ? "Collapse task details" : "Expand task details"}
                          className="p-1 rounded-lg text-[#8B949E] hover:text-[#F0F6FC] transition-colors"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Progress Bar for Running Tasks */}
                    {task.status === 'Running' && (
                      <div className="w-full h-1 bg-[#21262D] overflow-hidden">
                        <div
                          className="h-full bg-[#388BFD] transition-all duration-300"
                          style={{ width: `${Math.max(task.progress || 20, 15)}%` }}
                        />
                      </div>
                    )}

                    {/* Expanded Content Drawer */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-2 border-t border-[#30363D]/60 bg-[#0D1117]/60 space-y-3.5 text-xs">
                        {/* Meta Tags Bar */}
                        <div className="flex items-center gap-3 flex-wrap text-[11px] font-mono text-[#8B949E]">
                          <div>
                            Workspace: <span className="text-[#C7FF65]">{task.workspaceId}</span>
                          </div>
                          <div>
                            Model: <span className="text-[#F0F6FC]">{task.modelId}</span>
                          </div>
                          {task.durationMs !== undefined && (
                            <div>
                              Duration: <span className="text-[#F0F6FC]">{(task.durationMs / 1000).toFixed(2)}s</span>
                            </div>
                          )}
                          <div>
                            Created: <span className="text-[#8B949E]">{new Date(task.createdAtMillis).toLocaleTimeString()}</span>
                          </div>
                        </div>

                        {/* Full Task Prompt */}
                        <div className="space-y-1">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#8B949E]">
                            Task Prompt
                          </div>
                          <div className="p-2.5 rounded-xl bg-[#161B22] border border-[#30363D] text-[#F0F6FC] font-mono text-[11px] whitespace-pre-wrap leading-relaxed">
                            {task.taskPrompt}
                          </div>
                        </div>

                        {/* Error Message if Failed */}
                        {task.error && (
                          <div className="p-3 rounded-xl bg-[#FF727A]/10 border border-[#FF727A]/30 text-[#FF727A] space-y-1">
                            <div className="font-semibold text-xs flex items-center gap-1.5">
                              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                              <span>Execution Failed</span>
                            </div>
                            <div className="text-[11px] font-mono break-all">{task.error}</div>
                          </div>
                        )}

                        {/* Result Output */}
                        {task.output && (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#72D9A0]">
                                Output Artifact / Result
                              </span>
                              <button
                                type="button"
                                onClick={() => handleCopy(task.output || '', task.id)}
                                title={copiedTaskId === task.id ? "Output copied to clipboard" : "Copy task output to clipboard"}
                                aria-label="Copy task output"
                                className="text-[10px] text-[#8B949E] hover:text-[#F0F6FC] flex items-center gap-1"
                              >
                                {copiedTaskId === task.id ? (
                                  <>
                                    <Check className="w-3 h-3 text-[#72D9A0]" />
                                    <span className="text-[#72D9A0]">Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3" />
                                    <span>Copy Output</span>
                                  </>
                                )}
                              </button>
                            </div>
                            <div className="p-3 rounded-xl bg-[#161B22] border border-[#30363D] text-[#F0F6FC] font-mono text-[11px] whitespace-pre-wrap max-h-80 overflow-y-auto leading-relaxed">
                              {task.output}
                            </div>
                          </div>
                        )}

                        {/* Task Action Bar */}
                        <div className="flex items-center justify-between pt-1 gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            {(task.status === 'Running' || task.status === 'Queued') && (
                              <button
                                type="button"
                                onClick={() => handleCancelTask(task.id)}
                                disabled={cancellingId === task.id}
                                title="Cancel active sub-agent task"
                                aria-label="Cancel task"
                                className="px-3 py-1.5 rounded-lg bg-[#FF727A]/15 border border-[#FF727A]/30 text-[#FF727A] hover:bg-[#FF727A]/25 text-xs font-medium flex items-center gap-1.5 transition-colors"
                              >
                                <X className="w-3.5 h-3.5" />
                                <span>{cancellingId === task.id ? 'Cancelling...' : 'Cancel Task'}</span>
                              </button>
                            )}

                            {(task.status === 'Failed' || task.status === 'Cancelled') && (
                              <button
                                type="button"
                                onClick={() => handleRetryTask(task.id)}
                                disabled={retryingId === task.id}
                                title="Retry failed sub-agent task"
                                aria-label="Retry task"
                                className="px-3 py-1.5 rounded-lg bg-[#388BFD]/15 border border-[#388BFD]/30 text-[#388BFD] hover:bg-[#388BFD]/25 text-xs font-medium flex items-center gap-1.5 transition-colors"
                              >
                                <RotateCcw className={`w-3.5 h-3.5 ${retryingId === task.id ? 'animate-spin' : ''}`} />
                                <span>{retryingId === task.id ? 'Retrying...' : 'Retry Task'}</span>
                              </button>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => handleDeleteTask(task.id)}
                            disabled={deletingId === task.id}
                            title="Delete task record"
                            aria-label="Delete task record"
                            className="p-1.5 rounded-lg text-[#8B949E] hover:text-[#FF727A] hover:bg-[#FF727A]/10 transition-colors ml-auto"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
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

      {/* =========================================================================
          SPAWN SUB-AGENT TASK MODAL / BOTTOM SHEET
          ========================================================================= */}
      {showSpawnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => !spawning && setShowSpawnModal(false)}
          />
          <div className="relative w-full max-w-lg bg-[#161B22] border border-[#30363D] rounded-2xl shadow-2xl p-5 space-y-4 z-10 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-[#30363D]">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#C7FF65]" />
                <span className="font-semibold text-sm text-[#F0F6FC]">Delegate to Sub-Agent</span>
              </div>
              <button
                type="button"
                onClick={() => setShowSpawnModal(false)}
                disabled={spawning}
                title="Close delegate sub-agent dialog"
                aria-label="Close delegate sub-agent dialog"
                className="p-1 text-[#8B949E] hover:text-[#F0F6FC]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSpawnSubmit} className="space-y-4 text-xs">
              {/* Role Picker Pills */}
              <div className="space-y-1.5">
                <label className="block text-[#8B949E] font-medium">Select Specialized Role</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {SUBAGENT_ROLES.map((r) => {
                    const isSelected = spawnRole === r.role;
                    const Icon = r.icon;
                    return (
                      <button
                        key={r.role}
                        type="button"
                        onClick={() => {
                          setSpawnRole(r.role);
                          if (!spawnTitle || spawnTitle.endsWith('Subtask') || spawnTitle.endsWith('Task')) {
                            setSpawnTitle(`${r.role} Task`);
                          }
                          if (!spawnPrompt) {
                            setSpawnPrompt(r.examplePrompt);
                          }
                        }}
                        title={`Select ${r.title} role`}
                        aria-label={`Select ${r.title} role`}
                        className={`p-2 rounded-xl border text-left flex items-center gap-2 transition-all ${
                          isSelected
                            ? 'bg-[#21262D] border-[#C7FF65] text-[#F0F6FC] ring-1 ring-[#C7FF65]'
                            : 'bg-[#0D1117] border-[#30363D] text-[#8B949E] hover:border-[#8B949E]'
                        }`}
                      >
                        <div
                          className={`w-6 h-6 rounded-lg ${r.bgLight} flex items-center justify-center shrink-0`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-[11px] truncate">{r.role}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Title Input */}
              <div className="space-y-1">
                <label className="block text-[#8B949E] font-medium">Task Title</label>
                <input
                  type="text"
                  value={spawnTitle}
                  onChange={(e) => setSpawnTitle(e.target.value)}
                  placeholder="e.g. Architect Subtask Breakdown"
                  aria-label="Task title"
                  className="w-full min-h-[38px] px-3 rounded-xl bg-[#0D1117] border border-[#30363D] text-[#F0F6FC] focus:border-[#C7FF65] focus:outline-none"
                />
              </div>

              {/* Task Prompt Area */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="block text-[#8B949E] font-medium">Instructions & Bounded Goals</label>
                  <button
                    type="button"
                    onClick={() => {
                      const r = SUBAGENT_ROLES.find((x) => x.role === spawnRole);
                      if (r) setSpawnPrompt(r.examplePrompt);
                    }}
                    className="text-[10px] text-[#C7FF65] hover:underline"
                  >
                    Insert Role Example
                  </button>
                </div>
                <textarea
                  value={spawnPrompt}
                  onChange={(e) => setSpawnPrompt(e.target.value)}
                  placeholder="Describe precisely what this sub-agent should accomplish in the workspace..."
                  rows={4}
                  required
                  aria-label="Task instructions and bounded goals"
                  className="w-full p-3 rounded-xl bg-[#0D1117] border border-[#30363D] text-[#F0F6FC] focus:border-[#C7FF65] focus:outline-none resize-none leading-relaxed"
                />
              </div>

              {/* Target Workspace */}
              <div className="space-y-1">
                <label className="block text-[#8B949E] font-medium">Target Workspace</label>
                <input
                  type="text"
                  value={spawnWorkspace}
                  onChange={(e) => setSpawnWorkspace(e.target.value)}
                  aria-label="Target workspace ID"
                  className="w-full min-h-[38px] px-3 rounded-xl bg-[#0D1117] border border-[#30363D] text-[#F0F6FC] font-mono text-xs focus:border-[#C7FF65] focus:outline-none"
                />
              </div>

              {/* Error Callout */}
              {spawnError && (
                <div className="p-2.5 rounded-xl bg-[#FF727A]/10 border border-[#FF727A]/30 text-[#FF727A] text-[11px]">
                  {spawnError}
                </div>
              )}

              {/* Dialog Actions */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSpawnModal(false)}
                  disabled={spawning}
                  title="Cancel sub-agent delegation"
                  aria-label="Cancel"
                  className="min-h-[36px] px-4 rounded-xl bg-[#21262D] text-[#8B949E] hover:text-[#F0F6FC] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={spawning || !spawnPrompt.trim()}
                  title="Launch autonomous sub-agent with given prompt"
                  aria-label="Launch sub-agent"
                  className="min-h-[36px] px-4 rounded-xl bg-[#C7FF65] text-[#0D1117] font-semibold hover:bg-[#d6ff85] transition-colors disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
                >
                  {spawning ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Delegating...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Launch Sub-Agent</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
