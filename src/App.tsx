import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Cpu,
  Image as ImageIcon,
  FolderGit2,
  Code2,
  Settings as SettingsIcon,
  Lock,
  Sun,
  User,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Trash2,
  X,
  Clock,
  Layers,
  ChevronRight,
  ChevronDown,
  ShieldAlert,
  Terminal,
  Eye,
  Sparkles,
  Activity,
  Folder,
  FileCode,
  Check,
} from 'lucide-react';
import {
  TabDestination,
  Conversation,
  ProviderSummary,
  WorkspaceSummary,
  AgentActivityEvent,
  PendingApproval,
  PermissionCategory,
  PermissionPolicy,
  WorkstationSettings,
  FileDiffRecord,
  SubAgentTask,
} from './types';
import { ChatTab, ObsidianCrystalLogo } from './components/ChatTab';
import { ModelsTab } from './components/ModelsTab';
import { ImagesTab } from './components/ImagesTab';
import { ProjectsTab } from './components/ProjectsTab';
import { FilesTab } from './components/FilesTab';
import { PreviewTab } from './components/PreviewTab';
import { ToolsTab } from './components/ToolsTab';
import { AgentsTab } from './components/AgentsTab';
import { SkillsTab } from './components/SkillsTab';
import { TerminalTab } from './components/TerminalTab';
import { SettingsTab } from './components/SettingsTab';
import { RightInspector } from './components/RightInspector';
import { FloatingBubble } from './components/FloatingBubble';
import { EnvironmentModal } from './components/EnvironmentModal';
import {
  getEnvironmentReport,
  EnvironmentReport,
} from './services/environmentService';
import {
  notifyTaskStarted,
  notifyTaskProgress,
  notifyTaskCompleted,
  notifyTaskFailed,
  notifyApprovalNeeded,
} from './utils/notificationEngine';

class TabErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('CAUGHT IN TAB ERROR BOUNDARY:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="p-6 text-red-400 bg-red-950/20 font-mono text-xs overflow-auto h-full">
          <div className="font-bold text-sm mb-2">Tab Render Error:</div>
          <div>{this.state.error.message}</div>
          <pre className="mt-2 text-[11px] opacity-80">{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const defaultSettingsState: WorkstationSettings = {
  accentColor: '#C7FF65',
  fontSize: 'normal',
  reducedMotion: false,
  defaultProviderId: 'antigravity',
  defaultModelId: 'gemini-3.8-flash',
  requestTimeoutMs: 30000,
  maxRetries: 1,
  streamingEnabled: true,
  maxAgentIterations: 10,
  maxToolCalls: 16,
  commandTimeoutMs: 25000,
  localAiThreads: 4,
  localAiContextLength: 2048,
  memoryRetentionDays: 90,
};

export function App() {
  const [activeTab, setActiveTab] = useState<TabDestination>(() => {
    if (typeof window !== 'undefined') {
      const param = new URLSearchParams(window.location.search).get('tab');
      if (param && param !== 'diagnostics') return param as TabDestination;
    }
    return 'chat';
  });
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string>('');
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const param = new URLSearchParams(window.location.search).get('workspaceId');
      if (param) return param;
    }
    return 'android-workstation';
  });
  const [events, setEvents] = useState<AgentActivityEvent[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [checkpoints, setCheckpoints] = useState<FileDiffRecord[]>([]);
  const [permissions, setPermissions] = useState<Record<PermissionCategory, PermissionPolicy>>({
    READ_WORKSPACE: 'ALLOW',
    CREATE_FILES: 'ALLOW',
    MODIFY_FILES: 'ALLOW',
    DELETE_FILES: 'ASK',
    EXECUTE_COMMANDS: 'ASK',
    NETWORK_ACCESS: 'ALLOW',
    INSTALL_DEPENDENCIES: 'ASK',
    BUILD_PROJECTS: 'ALLOW',
    INSTALL_APKS: 'ASK',
    EXTERNAL_DIRECTORIES: 'DENY',
  });
  const [settings, setSettings] = useState<WorkstationSettings>(defaultSettingsState);
  const [sendingConvIds, setSendingConvIds] = useState<Record<string, boolean>>({});
  const [chatErrorsByConv, setChatErrorsByConv] = useState<Record<string, string | null>>({});
  const streamAbortRefs = useRef<Map<string, AbortController>>(new Map());
  const cancelledConvRefs = useRef<Set<string>>(new Set());

  // Reference Layout State: Context sidebar is closed by default for maximum focus
  const [rightInspectorOpen, setRightInspectorOpen] = useState(false);
  const [sessionsDrawerOpen, setSessionsDrawerOpen] = useState(false);
  const [showWorkspaceHeaderDropdown, setShowWorkspaceHeaderDropdown] = useState(false);
  const [queuedTerminalCommand, setQueuedTerminalCommand] = useState<string | null>(null);

  // Authoritative Environment & Runtime State
  const [envReport, setEnvReport] = useState<EnvironmentReport | null>(null);
  const [showEnvironmentModal, setShowEnvironmentModal] = useState(false);
  const [loadingEnv, setLoadingEnv] = useState(false);

  const fetchEnvironment = async (wsId?: string) => {
    setLoadingEnv(true);
    try {
      const rep = await getEnvironmentReport(wsId || activeWorkspaceId);
      setEnvReport(rep);
    } catch (e) {
      console.warn('Failed to load environment report:', e);
    } finally {
      setLoadingEnv(false);
    }
  };

  const [floatingBubbleEnabled, setFloatingBubbleEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('obsidian_floating_bubble');
      return stored !== null ? stored === 'true' : true;
    }
    return true;
  });
  const [subagentTasks, setSubagentTasks] = useState<SubAgentTask[]>([]);
  const prevTasksRef = useRef<Map<string, SubAgentTask>>(new Map());
  const prevApprovalsCountRef = useRef(0);

  const nativeOverlaySupported =
    typeof window !== 'undefined' && !!(window as any).AndroidOverlay?.isSupported?.();

  const handleToggleFloatingBubble = (enabled: boolean) => {
    setFloatingBubbleEnabled(enabled);
    if (typeof window !== 'undefined') {
      localStorage.setItem('obsidian_floating_bubble', String(enabled));
      const bridge = (window as any).AndroidOverlay;
      if (bridge?.sync) {
        bridge.sync(enabled);
      } else if (bridge?.setEnabled) {
        bridge.setEnabled(enabled);
      }
      window.dispatchEvent(new CustomEvent('obsidian:bubble_toggle', { detail: { enabled } }));
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (nativeOverlaySupported) {
      const bridge = (window as any).AndroidOverlay;
      bridge?.sync?.(floatingBubbleEnabled);
    }

    const handleOverlayPermission = (event: Event) => {
      const granted = (event as CustomEvent<{ granted?: boolean }>).detail?.granted;
      if (granted === false) {
        setFloatingBubbleEnabled(false);
        localStorage.setItem('obsidian_floating_bubble', 'false');
      }
    };

    const handleOverlayDismissed = () => {
      setFloatingBubbleEnabled(false);
      localStorage.setItem('obsidian_floating_bubble', 'false');
    };

    window.addEventListener('obsidian-overlay-permission', handleOverlayPermission);
    window.addEventListener('obsidian-overlay-dismissed', handleOverlayDismissed);
    return () => {
      window.removeEventListener('obsidian-overlay-permission', handleOverlayPermission);
      window.removeEventListener('obsidian-overlay-dismissed', handleOverlayDismissed);
    };
  }, [floatingBubbleEnabled, nativeOverlaySupported]);

  useEffect(() => {
    let mounted = true;
    const fetchTasks = async () => {
      try {
        const res = await fetch('/api/subagents');
        if (!res.ok) return;
        const data = await res.json();
        if (mounted && Array.isArray(data.tasks)) {
          setSubagentTasks(data.tasks);

          const prevMap = prevTasksRef.current;
          data.tasks.forEach((task: SubAgentTask) => {
            const prev = prevMap.get(task.id);
            if (!prev) {
              if (task.status === 'running') {
                notifyTaskStarted(task.id, task.role, task.title);
              }
            } else {
              if (prev.status !== 'running' && task.status === 'running') {
                notifyTaskStarted(task.id, task.role, task.title);
              } else if (
                task.status === 'running' &&
                (task.progress !== prev.progress || task.currentStep !== prev.currentStep)
              ) {
                notifyTaskProgress(task.id, task.title, task.progress || 0, task.currentStep || '');
              } else if (prev.status !== 'completed' && task.status === 'completed') {
                notifyTaskCompleted(
                  task.id,
                  task.role,
                  task.title,
                  task.summary || 'Task completed successfully.'
                );
              } else if (prev.status !== 'failed' && task.status === 'failed') {
                notifyTaskFailed(task.id, task.role, task.title, task.error || 'Execution failed.');
              }
            }
          });

          const newMap = new Map<string, SubAgentTask>();
          data.tasks.forEach((t: SubAgentTask) => newMap.set(t.id, t));
          prevTasksRef.current = newMap;
        }
      } catch {
        // ignore
      }
    };

    fetchTasks();
    const interval = setInterval(fetchTasks, 3000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (pendingApprovals.length > prevApprovalsCountRef.current) {
      const latest = pendingApprovals[pendingApprovals.length - 1];
      notifyApprovalNeeded(latest.id, latest.toolName, latest.reason || 'Approval required');
    }
    prevApprovalsCountRef.current = pendingApprovals.length;
  }, [pendingApprovals]);

  const refreshWorkspacesAndCheckpoints = async (wsId: string) => {
    try {
      fetchEnvironment(wsId);
      const [wsRes, filesRes] = await Promise.all([
        fetch('/api/workspaces').then((r) => r.json()),
        fetch(`/api/workspaces/${encodeURIComponent(wsId)}/files`).then((r) => r.json()),
      ]);
      if (wsRes.workspaces) setWorkspaces(wsRes.workspaces);
      if (filesRes.checkpoints) setCheckpoints(filesRes.checkpoints);
    } catch {
      // ignore transient errors
    }
  };

  const loadInitialState = async () => {
    try {
      fetchEnvironment();
      const [convRes, provRes, wsRes, setRes, evRes] = await Promise.all([
        fetch('/api/conversations').then((r) => r.json()),
        fetch('/api/providers').then((r) => r.json()),
        fetch('/api/workspaces').then((r) => r.json()),
        fetch('/api/settings').then((r) => r.json()),
        fetch('/api/agent/events').then((r) => r.json()),
      ]);
      if (convRes.conversations) {
        setConversations(convRes.conversations);
        if (convRes.conversations.length > 0 && !activeConvId) {
          const initialWs = convRes.conversations[0].workspaceId || 'android-workstation';
          setActiveConvId(convRes.conversations[0].id);
          setActiveWorkspaceId(initialWs);
          refreshWorkspacesAndCheckpoints(initialWs);
        }
      }
      if (provRes.providers) setProviders(provRes.providers);
      if (wsRes.workspaces) setWorkspaces(wsRes.workspaces);
      if (setRes.settings) setSettings(setRes.settings);
      if (setRes.permissions) setPermissions(setRes.permissions);
      if (evRes.events) setEvents(evRes.events);
      if (evRes.pendingApprovals) setPendingApprovals(evRes.pendingApprovals);
    } catch {
      // handled gracefully
    }
  };

  useEffect(() => {
    loadInitialState();
  }, []);

  useEffect(() => {
    refreshWorkspacesAndCheckpoints(activeWorkspaceId);
  }, [activeWorkspaceId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSessionsDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Real-time EventSource listener for streaming agent events and approvals
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/agent/events/stream');
      es.addEventListener('snapshot', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          if (Array.isArray(data.events)) setEvents(data.events);
          if (Array.isArray(data.pendingApprovals)) setPendingApprovals(data.pendingApprovals);
        } catch {}
      });
      es.addEventListener('activity', (e: MessageEvent) => {
        try {
          const act = JSON.parse(e.data);
          setEvents((prev) => [act, ...prev.filter((p) => p.id !== act.id)].slice(0, 200));
        } catch {}
      });
      es.addEventListener('approvals', (e: MessageEvent) => {
        try {
          const apprs = JSON.parse(e.data);
          if (Array.isArray(apprs)) setPendingApprovals(apprs);
        } catch {}
      });
      es.addEventListener('settings_updated', (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload.settings) {
            setSettings(payload.settings);
            window.dispatchEvent(
              new CustomEvent('obsidian:settings_updated', { detail: payload.settings })
            );
          }
          if (payload.permissions) {
            setPermissions(payload.permissions);
          }
        } catch {}
      });
    } catch {
      // EventSource fallback handled by polling below
    }

    return () => {
      if (es) {
        es.close();
      }
    };
  }, []);

  const activeConv = conversations.find((c) => c.id === activeConvId) || conversations[0];
  const activeProvider =
    providers.find((p) => p.id === (activeConv?.providerId || settings.defaultProviderId)) ||
    providers[0];
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

  const sending = Boolean(activeConv && sendingConvIds[activeConv.id]);
  const chatError = activeConv ? chatErrorsByConv[activeConv.id] || null : null;
  const setChatError = (err: string | null, convId?: string) => {
    const targetId = convId || activeConv?.id;
    if (!targetId) return;
    setChatErrorsByConv((prev) => ({ ...prev, [targetId]: err }));
  };

  // Poll agent events while any conversation is generating as resilient fallback
  const anyConvSending = Object.values(sendingConvIds).some(Boolean);
  useEffect(() => {
    if (!anyConvSending) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/agent/events');
        const data = await res.json();
        if (data.events) setEvents(data.events);
        if (data.pendingApprovals) setPendingApprovals(data.pendingApprovals);
      } catch {
        // ignore
      }
    }, 650);
    return () => clearInterval(interval);
  }, [anyConvSending]);

  const handleNavigateToChat = (opts?: { mode?: 'normal' | 'agent'; conversationId?: string }) => {
    if (opts?.conversationId) {
      setActiveConvId(opts.conversationId);
      const target = conversations.find((c) => c.id === opts.conversationId);
      if (target?.workspaceId) {
        setActiveWorkspaceId(target.workspaceId);
      }
    }
    if (opts?.mode && activeConv) {
      handleUpdateConversationMeta(activeConv.id, { chatMode: opts.mode });
    }
    setActiveTab('chat');
  };

  const handleNewConversation = async () => {
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `Session ${conversations.length + 1}`,
        workspaceId: activeWorkspaceId,
        providerId: activeProvider?.id || settings.defaultProviderId || 'local-ai',
        modelId: activeProvider?.defaultModel || settings.defaultModelId || 'smollm2-135m-instruct-q4_k_m.gguf',
        agentId: 'coder',
      }),
    });
    const data = await res.json();
    if (data.conversations) {
      setConversations(data.conversations);
      setActiveConvId(data.conversation.id);
      setActiveTab('chat');
      setSessionsDrawerOpen(false);
    }
  };

  const handleUpdateConversationMeta = async (
    convId: string,
    patch: {
      title?: string;
      workspaceId?: string;
      providerId?: string;
      modelId?: string;
      agentId?: string;
      chatMode?: 'normal' | 'agent';
      collaboratorModelId?: string;
      collaboratorProviderId?: string;
    }
  ) => {
    const res = await fetch(`/api/conversations/${encodeURIComponent(convId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (data.conversations) {
      setConversations(data.conversations);
      if (patch.workspaceId) setActiveWorkspaceId(patch.workspaceId);
    }
  };

  const handleDeleteConversation = async (convId: string) => {
    const res = await fetch(`/api/conversations/${encodeURIComponent(convId)}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (data.conversations) {
      if (data.conversations.length === 0) {
        await handleNewConversation();
      } else {
        setConversations(data.conversations);
        if (activeConvId === convId && data.conversations.length > 0) {
          setActiveConvId(data.conversations[0].id);
          if (data.conversations[0].workspaceId) {
            setActiveWorkspaceId(data.conversations[0].workspaceId);
          }
        }
      }
    }
  };

  const syncAfterAgentTurn = async () => {
    await refreshWorkspacesAndCheckpoints(activeWorkspaceId);
    try {
      const evRes = await fetch('/api/agent/events').then((r) => r.json());
      if (evRes.events) setEvents(evRes.events);
      if (evRes.pendingApprovals) setPendingApprovals(evRes.pendingApprovals);
    } catch {
      // ignore
    }
  };

  const applyStreamEventToConversation = (
    targetConvId: string,
    assistantPlaceholderId: string,
    evt: Record<string, any>,
    fullPrompt: string
  ) => {
    if (cancelledConvRefs.current.has(targetConvId) && evt.type !== 'cancelled') {
      return;
    }

    if (evt.type === 'activity' && evt.event) {
      setEvents((prev) => [evt.event, ...prev.filter((p) => p.id !== evt.event.id)].slice(0, 200));
      return;
    }

    if (evt.type === 'collaborator_status') {
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== targetConvId) return c;
          return {
            ...c,
            messages: c.messages.map((m) =>
              m.id === assistantPlaceholderId
                ? {
                    ...m,
                    collaboratorStreamingStatus: String(evt.statusText || 'Collaborator reviewing…'),
                    isCollaboratorStreaming: true,
                  }
                : m
            ),
          };
        })
      );
      return;
    }

    if (evt.type === 'collaborator_token') {
      const nextCollabText = typeof evt.accumulatedText === 'string' ? evt.accumulatedText : '';
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== targetConvId) return c;
          return {
            ...c,
            messages: c.messages.map((m) =>
              m.id === assistantPlaceholderId
                ? {
                    ...m,
                    collaboratorContent: nextCollabText,
                    isCollaboratorStreaming: true,
                    collaboratorStreamingStatus: 'Reviewing implementation…',
                  }
                : m
            ),
          };
        })
      );
      return;
    }

    if (evt.type === 'collaborator_done') {
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== targetConvId) return c;
          return {
            ...c,
            messages: c.messages.map((m) =>
              m.id === assistantPlaceholderId
                ? {
                    ...m,
                    collaboratorContent: String(evt.content || m.collaboratorContent || ''),
                    resultSummary: typeof evt.resultSummary === 'string' ? evt.resultSummary : m.resultSummary,
                    testStatus: evt.testStatus || m.testStatus,
                    isCollaboratorStreaming: false,
                    collaboratorStreamingStatus: undefined,
                  }
                : m
            ),
          };
        })
      );
      return;
    }

    if (evt.type === 'status') {
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== targetConvId) return c;
          return {
            ...c,
            messages: c.messages.map((m) =>
              m.id === assistantPlaceholderId
                ? {
                    ...m,
                    streamingStatus: String(evt.statusText || m.streamingStatus || 'Generating response…'),
                    skillsUsed: Array.isArray(evt.skillsUsed) ? evt.skillsUsed : m.skillsUsed,
                  }
                : m
            ),
          };
        })
      );
      return;
    }

    if (evt.type === 'token') {
      const nextText = typeof evt.accumulatedText === 'string' ? evt.accumulatedText : '';
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== targetConvId) return c;
          return {
            ...c,
            messages: c.messages.map((m) =>
              m.id === assistantPlaceholderId
                ? {
                    ...m,
                    content: nextText,
                    stepsUsed: typeof evt.iteration === 'number' ? evt.iteration : m.stepsUsed,
                    streamingStatus: String(evt.statusText || 'Generating response…'),
                    isStreaming: true,
                  }
                : m
            ),
          };
        })
      );
      return;
    }

    if (evt.type === 'tool_call') {
      const allToolCalls = Array.isArray(evt.toolCalls) ? evt.toolCalls : [];
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== targetConvId) return c;
          return {
            ...c,
            messages: c.messages.map((m) =>
              m.id === assistantPlaceholderId
                ? {
                    ...m,
                    toolCalls: allToolCalls,
                    streamingStatus: String(evt.statusText || 'Running tool…'),
                    isStreaming: true,
                  }
                : m
            ),
          };
        })
      );
      return;
    }

    if (evt.type === 'done') {
      if (evt.conversation) {
        setConversations((prev) =>
          prev.map((c) => (c.id === targetConvId ? evt.conversation : c))
        );
      }
      if (Array.isArray(evt.events)) {
        setEvents(evt.events);
      }
      if (Array.isArray(evt.checkpoints)) {
        setCheckpoints(evt.checkpoints);
      }
      return;
    }

    if (evt.type === 'error') {
      const errorMsg = String(evt.error || 'Provider request failed');
      setChatError(errorMsg, targetConvId);
      if (Array.isArray(evt.events)) {
        setEvents(evt.events);
      }
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== targetConvId) return c;
          return {
            ...c,
            taskState: 'failed',
            messages: c.messages.map((m) =>
              m.id === assistantPlaceholderId
                ? {
                    ...m,
                    taskState: 'failed',
                    stoppedReason: 'error',
                    isStreaming: false,
                    streamingStatus: undefined,
                    errorExplanation: errorMsg,
                    failedPrompt: fullPrompt,
                  }
                : m
            ),
          };
        })
      );
    }
  };

  const handleSendMessage = async (
    baseText: string,
    attachedFileInfo?: { name: string; content: string } | null,
    enableAgentTools = true,
    options?: {
      retryLastUserMessage?: boolean;
      chatMode?: 'normal' | 'agent';
      collaboratorModelId?: string;
      collaboratorProviderId?: string;
    }
  ) => {
    if (!baseText.trim() && !attachedFileInfo) return;
    if (!activeConv) return;
    const targetConvId = activeConv.id;
    if (sendingConvIds[targetConvId]) return;

    const fullPrompt = attachedFileInfo
      ? `${baseText.trim()}\n\n[Attached Context File: ${attachedFileInfo.name}]\n\`\`\`\n${attachedFileInfo.content.slice(0, 12000)}\n\`\`\``
      : baseText.trim();

    const isRetry = Boolean(options?.retryLastUserMessage);
    const now = Date.now();
    const optimisticUserId = `msg-${now}-u`;
    const assistantPlaceholderId = `msg-${now}-a`;

    cancelledConvRefs.current.delete(targetConvId);
    setChatError(null, targetConvId);
    setSendingConvIds((prev) => ({ ...prev, [targetConvId]: true }));

    // Immediately insert the user message and inline assistant placeholder
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== targetConvId) return c;
        let nextMessages = [...c.messages];
        if (isRetry) {
          // Strip trailing failed/cancelled assistant message before retrying
          while (
            nextMessages.length > 0 &&
            nextMessages[nextMessages.length - 1].role === 'assistant' &&
            (nextMessages[nextMessages.length - 1].taskState === 'failed' ||
              nextMessages[nextMessages.length - 1].taskState === 'cancelled')
          ) {
            nextMessages.pop();
          }
          const lastUser = [...nextMessages].reverse().find((m) => m.role === 'user');
          if (!lastUser || lastUser.content !== fullPrompt) {
            nextMessages.push({
              id: optimisticUserId,
              role: 'user',
              content: fullPrompt,
              timestampMillis: now,
            });
          }
        } else {
          nextMessages.push({
            id: optimisticUserId,
            role: 'user',
            content: fullPrompt,
            timestampMillis: now,
          });
        }

        // Auto-title initial session immediately
        let nextTitle = c.title;
        const userCount = nextMessages.filter((m) => m.role === 'user').length;
        if (userCount === 1 && (/^Session \d+$/i.test(c.title) || c.title === 'New Chat')) {
          const summary = fullPrompt.split('\n')[0].replace(/[`#*_]/g, '').trim().slice(0, 36);
          if (summary) nextTitle = summary;
        }

        nextMessages.push({
          id: assistantPlaceholderId,
          role: 'assistant',
          content: '',
          timestampMillis: now + 1,
          providerId: c.providerId,
          modelId: c.modelId,
          agentId: c.agentId || 'coder',
          taskState: 'running',
          isStreaming: true,
          streamingStatus: `Connecting to ${c.modelId || 'model'}…`,
        });

        return {
          ...c,
          title: nextTitle,
          taskState: 'running',
          updatedAtMillis: now,
          messages: nextMessages,
        };
      })
    );

    const abortController = new AbortController();
    streamAbortRefs.current.set(targetConvId, abortController);

    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        signal: abortController.signal,
        body: JSON.stringify({
          conversationId: targetConvId,
          content: fullPrompt,
          enableAgentTools,
          maxIterations: settings.maxAgentIterations || 10,
          stream: true,
          retryLastUserMessage: isRetry,
          assistantMessageId: assistantPlaceholderId,
          chatMode: options?.chatMode || (enableAgentTools ? 'agent' : 'normal'),
          collaboratorModelId: options?.collaboratorModelId,
          collaboratorProviderId: options?.collaboratorProviderId,
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/x-ndjson') && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (abortController.signal.aborted || cancelledConvRefs.current.has(targetConvId)) {
            await reader.cancel().catch(() => {});
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const rawLine of lines) {
            const trimmedLine = rawLine.trim();
            if (!trimmedLine) continue;
            try {
              const evt = JSON.parse(trimmedLine);
              applyStreamEventToConversation(targetConvId, assistantPlaceholderId, evt, fullPrompt);
            } catch {
              // ignore malformed line
            }
          }
        }

        if (buffer.trim() && !abortController.signal.aborted && !cancelledConvRefs.current.has(targetConvId)) {
          try {
            const evt = JSON.parse(buffer.trim());
            applyStreamEventToConversation(targetConvId, assistantPlaceholderId, evt, fullPrompt);
          } catch {
            // ignore
          }
        }
      } else {
        const data = await res.json();
        if (!res.ok) {
          applyStreamEventToConversation(
            targetConvId,
            assistantPlaceholderId,
            { type: 'error', error: data.error || 'Request failed', events: data.events },
            fullPrompt
          );
          return;
        }
        if (data.conversation) {
          setConversations((prev) =>
            prev.map((c) => (c.id === data.conversation.id ? data.conversation : c))
          );
        }
        if (data.events) setEvents(data.events);
      }
    } catch (err) {
      if (abortController.signal.aborted || cancelledConvRefs.current.has(targetConvId)) {
        return;
      }
      const errMessage = err instanceof Error ? err.message : 'Network error';
      applyStreamEventToConversation(
        targetConvId,
        assistantPlaceholderId,
        { type: 'error', error: errMessage },
        fullPrompt
      );
    } finally {
      streamAbortRefs.current.delete(targetConvId);
      setSendingConvIds((prev) => ({ ...prev, [targetConvId]: false }));
      await syncAfterAgentTurn();
    }
  };

  const handleContinueTask = async () => {
    if (!activeConv) return;
    const targetConvId = activeConv.id;
    if (sendingConvIds[targetConvId]) return;
    setChatError(null, targetConvId);
    setSendingConvIds((prev) => ({ ...prev, [targetConvId]: true }));
    try {
      const res = await fetch('/api/chat/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: targetConvId,
          additionalSteps: settings.maxAgentIterations || 10,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChatError(data.error || 'Continue failed', targetConvId);
        if (data.events) setEvents(data.events);
        return;
      }
      if (data.conversation) {
        setConversations((prev) =>
          prev.map((c) => (c.id === data.conversation.id ? data.conversation : c))
        );
      }
      if (data.events) setEvents(data.events);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Network error', targetConvId);
    } finally {
      setSendingConvIds((prev) => ({ ...prev, [targetConvId]: false }));
      await syncAfterAgentTurn();
    }
  };

  const handleRetryToolCall = async (
    toolName: string,
    args: Record<string, unknown>
  ): Promise<void> => {
    if (!activeConv) return;
    const targetConvId = activeConv.id;
    setChatError(null, targetConvId);
    try {
      const res = await fetch('/api/chat/retry-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: targetConvId,
          toolName,
          args,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChatError(data.error || 'Retry failed', targetConvId);
        return;
      }
      if (data.conversation) {
        setConversations((prev) =>
          prev.map((c) => (c.id === data.conversation.id ? data.conversation : c))
        );
      }
      if (data.events) setEvents(data.events);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Retry error', targetConvId);
    } finally {
      await syncAfterAgentTurn();
    }
  };

  const handleStopGeneration = async () => {
    if (!activeConv) return;
    const targetConvId = activeConv.id;
    cancelledConvRefs.current.add(targetConvId);

    const controller = streamAbortRefs.current.get(targetConvId);
    if (controller) {
      controller.abort();
      streamAbortRefs.current.delete(targetConvId);
    }

    setSendingConvIds((prev) => ({ ...prev, [targetConvId]: false }));

    // Immediately finalize the in-progress assistant message in-place as cancelled, preserving partial output
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== targetConvId) return c;
        return {
          ...c,
          taskState: 'cancelled',
          messages: c.messages.map((m) =>
            m.role === 'assistant' && (m.isStreaming || m.taskState === 'running' || m.taskState === 'awaiting_approval')
              ? {
                  ...m,
                  taskState: 'cancelled',
                  stoppedReason: 'user_cancelled',
                  isStreaming: false,
                  streamingStatus: undefined,
                }
              : m
          ),
        };
      })
    );

    try {
      const res = await fetch('/api/chat/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: targetConvId }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.conversation) {
        // Merge server conversation while ensuring any client-streamed partial text is preserved
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== targetConvId) return c;
            return {
              ...data.conversation,
              messages: c.messages,
            };
          })
        );
      }
    } catch {
      // ignore network error on cancel
    }
    await syncAfterAgentTurn();
  };

  const handleApproveTool = async (approvalId: string, approved: boolean) => {
    await fetch('/api/agent/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalId, approved }),
    });
    const res = await fetch('/api/agent/events');
    const data = await res.json();
    if (data.events) setEvents(data.events);
    if (data.pendingApprovals) setPendingApprovals(data.pendingApprovals);
  };

  const handleUpdatePermission = async (category: PermissionCategory, policy: PermissionPolicy) => {
    const next = { ...permissions, [category]: policy };
    setPermissions(next);
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: { [category]: policy } }),
    });
  };

  const handleUpdateSettings = async (partial: Partial<WorkstationSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: partial }),
      });
      const data = await res.json();
      if (data.settings) {
        setSettings(data.settings);
        window.dispatchEvent(
          new CustomEvent('obsidian:settings_updated', { detail: data.settings })
        );
      }
    } catch (err) {
      console.error('Failed to update settings:', err);
    }
  };

  // Desktop Reference Navigation Items (Chat, Files, Terminal front and center)
  const navTabs: Array<{
    id: TabDestination;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'files', label: 'Files', icon: FileCode },
    { id: 'terminal', label: 'Terminal', icon: Terminal },
    { id: 'projects', label: 'Workspaces', icon: FolderGit2 },
    { id: 'tools', label: 'Tools', icon: Code2 },
    { id: 'skills', label: 'Skills', icon: Sparkles },
    { id: 'agents', label: 'Agents', icon: Layers },
    { id: 'models', label: 'Models', icon: Cpu },
    { id: 'images', label: 'Images', icon: ImageIcon },
    { id: 'preview', label: 'Preview', icon: Eye },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  // Mobile Bottom Navigation Tabs (5 primary items: Chat, Files, Terminal, Tools, Settings)
  const mobileNavTabs: Array<{
    id: TabDestination;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'files', label: 'Files', icon: FileCode },
    { id: 'terminal', label: 'Terminal', icon: Terminal },
    { id: 'tools', label: 'Tools', icon: Code2 },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ];

  const runningTasks = subagentTasks.filter((t) => t.status === 'running');
  const runningTask = runningTasks[0] || null;
  const runningTasksCount = runningTasks.length;

  return (
    <div className="h-[100dvh] w-full max-w-full overflow-hidden bg-[#0D1117] text-[#F0F6FC] flex flex-col select-none">
      {/* =========================================================================
          TOP NAVIGATION BAR (Clean, ~60px tall, matching reference design exactly)
          ========================================================================= */}
      <header className="h-14 px-4 sm:px-6 border-b border-[#30363D] bg-[#0D1117] flex items-center justify-between gap-4 shrink-0 z-30">
        {/* Left: OBSIDIAN Logo & Identity */}
        <div className="flex items-center gap-2 sm:gap-6 shrink-0 min-w-0">
          <button
            onClick={() => setActiveTab('chat')}
            className="flex items-center gap-2.5 text-left focus:outline-none group shrink-0 cursor-pointer"
            title="OBSIDIAN AI Workstation"
            aria-label="OBSIDIAN AI Workstation Home"
          >
            <ObsidianCrystalLogo className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg shadow-sm group-hover:scale-105 transition-transform duration-150" />
            <span className="font-bold tracking-wider text-sm text-[#F0F6FC] group-hover:text-white transition-colors">
              OBSIDIAN
            </span>
          </button>
          {activeTab !== 'chat' && (
            <div className="flex items-center gap-1.5 md:hidden text-xs text-[#8B949E] font-medium truncate">
              <span className="text-[#30363D]">/</span>
              <span className="text-[#C7FF65] font-semibold capitalize truncate max-w-[110px]">
                {activeTab === 'projects' ? 'Workspaces' : activeTab}
              </span>
            </div>
          )}

          {/* Primary Navigation Tabs */}
          <nav aria-label="Main Navigation" className="hidden md:flex items-center gap-1 sm:gap-2">
            {navTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive =
                activeTab === tab.id ||
                (tab.id === 'settings' && activeTab === 'providers');

              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  title={tab.label}
                  aria-label={tab.label}
                  className={`relative flex items-center gap-2 px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-all cursor-pointer ${
                    isActive
                      ? 'text-[#F0F6FC] font-semibold'
                      : 'text-[#8B949E] hover:text-[#F0F6FC] hover:bg-[#161B22]'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-[#C7FF65]' : 'text-[#8B949E]'}`} />
                  <span>{tab.label}</span>
                  {/* Active Indicator Underline */}
                  {isActive && (
                    <span className="absolute bottom-[-10px] left-3 right-3 h-[2px] bg-[#C7FF65] rounded-full" />
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right Header Area: Compact Workspace Selector & Safety Alerts */}
        <div className="flex items-center gap-2.5 shrink-0">
          {pendingApprovals.length > 0 && (
            <button
              onClick={() => setActiveTab('tools')}
              title="Review Pending Tool Approvals"
              aria-label="Review Pending Tool Approvals"
              className="px-2.5 py-1 rounded-md bg-[#D29922]/20 border border-[#D29922]/50 text-[#D29922] text-xs font-medium flex items-center gap-1.5 cursor-pointer hover:bg-[#D29922]/30 transition-colors"
            >
              <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
              <span>
                {pendingApprovals.length === 1
                  ? '1 Pending Approval'
                  : `${pendingApprovals.length} Pending Approvals`}
              </span>
            </button>
          )}

          {/* Authoritative Environment / Runtime Indicator Badge */}
          {envReport && (
            <button
              type="button"
              onClick={() => setShowEnvironmentModal(true)}
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#161B22] hover:bg-[#21262D] border border-[#30363D] hover:border-[#C7FF65]/50 text-xs font-mono text-[#F0F6FC] transition-colors cursor-pointer shrink-0"
              title={`Client: ${envReport.client.label} | Backend: ${envReport.backend.label} | Storage: ${envReport.filesystem.ownerLabel} (${envReport.filesystem.workspaceRoot})`}
              aria-label="Inspect Runtime Environment"
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  envReport.client.isAndroidNative
                    ? 'bg-[#C7FF65]'
                    : envReport.client.isMobile
                    ? 'bg-[#F4C46A]'
                    : 'bg-[#58A6FF]'
                }`}
              />
              <span className="text-[11px] text-[#8B949E]">
                {envReport.client.isAndroidNative
                  ? 'Android'
                  : envReport.client.isMobile
                  ? 'Mobile Web'
                  : 'Desktop PC'}
              </span>
              <span className="text-[10px] text-[#C7FF65] font-semibold">
                {envReport.backend.osName}
              </span>
            </button>
          )}

          {/* Compact Workspace Selector */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowWorkspaceHeaderDropdown((v) => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#161B22] hover:bg-[#21262D] border border-[#30363D] text-xs font-medium text-[#F0F6FC] transition-colors cursor-pointer max-w-[170px] sm:max-w-[240px]"
              title={`Active Workspace: ${activeWorkspace?.name || activeWorkspaceId} (${activeWorkspace?.path || ''})`}
              aria-label={`Current Workspace: ${activeWorkspace?.name || activeWorkspaceId}`}
            >
              <Folder className="w-3.5 h-3.5 text-[#C7FF65] shrink-0" />
              <span className="truncate">{activeWorkspace?.name || activeWorkspaceId}</span>
              <ChevronDown className="w-3 h-3 text-[#8B949E] shrink-0" />
            </button>

            {showWorkspaceHeaderDropdown && (
              <div className="absolute right-0 top-full mt-1.5 w-64 rounded-xl bg-[#161B22] border border-[#30363D] shadow-2xl p-2 z-50 space-y-1">
                <div className="px-2 py-1 text-[10px] font-bold text-[#8B949E] tracking-wider uppercase flex items-center justify-between">
                  <span>Switch Workspace</span>
                  <span className="font-mono">{workspaces.length}</span>
                </div>
                <div className="max-h-60 overflow-y-auto space-y-0.5">
                  {workspaces.map((ws) => {
                    const isCurrent = ws.id === activeWorkspaceId;
                    return (
                      <button
                        key={ws.id}
                        type="button"
                        onClick={() => {
                          setActiveWorkspaceId(ws.id);
                          if (activeConv) handleUpdateConversationMeta(activeConv.id, { workspaceId: ws.id });
                          setShowWorkspaceHeaderDropdown(false);
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer text-left ${
                          isCurrent
                            ? 'bg-[#1C2128] text-[#C7FF65] font-semibold'
                            : 'text-[#F0F6FC] hover:bg-[#21262D]'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <Folder className={`w-3.5 h-3.5 shrink-0 ${isCurrent ? 'text-[#C7FF65]' : 'text-[#8B949E]'}`} />
                            <span className="truncate">{ws.name}</span>
                          </div>
                          <div className="text-[10px] text-[#8B949E] font-mono truncate pl-5">
                            {ws.id} · {ws.fileCount} files
                          </div>
                        </div>
                        {isCurrent && <Check className="w-3.5 h-3.5 text-[#C7FF65] shrink-0 ml-1" />}
                      </button>
                    );
                  })}
                </div>
                <div className="pt-1.5 border-t border-[#30363D] px-1 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('projects');
                      setShowWorkspaceHeaderDropdown(false);
                    }}
                    className="text-xs text-[#C7FF65] hover:underline font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <FolderGit2 className="w-3 h-3" />
                    <span>Manage Workspaces</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

      </header>

      {/* =========================================================================
          MAIN WORKSPACE LAYOUT (Primary Content + Right Optional Context)
          ========================================================================= */}
      <div className="flex-1 min-h-0 flex overflow-hidden relative">
        {/* Primary Viewport Area (Takes 100% space when Context is collapsed) */}
        <main className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden bg-[#0D1117]">
          {/* Unified Tools Hub Sub-Navigation (Tools, Skills, Workspaces, Images, Models, Preview) */}
          {(activeTab === 'tools' ||
            activeTab === 'skills' ||
            activeTab === 'projects' ||
            activeTab === 'images' ||
            activeTab === 'models' ||
            activeTab === 'preview') && (
            <div className="px-3 sm:px-5 py-2 border-b border-[#30363D] bg-[#161B22] flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
              {[
                { id: 'tools' as TabDestination, label: 'Tools', icon: Code2 },
                { id: 'skills' as TabDestination, label: 'Skills', icon: Sparkles },
                { id: 'projects' as TabDestination, label: 'Workspaces', icon: FolderGit2 },
                { id: 'images' as TabDestination, label: 'Images', icon: ImageIcon },
                { id: 'models' as TabDestination, label: 'Models', icon: Cpu },
                { id: 'preview' as TabDestination, label: 'Preview', icon: Eye },
              ].map((hubItem) => {
                const HubIcon = hubItem.icon;
                const isHubActive = activeTab === hubItem.id;
                return (
                  <button
                    key={hubItem.id}
                    type="button"
                    onClick={() => setActiveTab(hubItem.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
                      isHubActive
                        ? 'bg-[#C7FF65] text-[#0D1117] font-semibold shadow-xs'
                        : 'bg-[#0D1117] text-[#8B949E] hover:text-[#F0F6FC] border border-[#30363D]'
                    }`}
                  >
                    <HubIcon
                      className={`w-3.5 h-3.5 ${
                        isHubActive ? 'text-[#0D1117]' : 'text-[#C7FF65]'
                      }`}
                    />
                    <span>{hubItem.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {activeTab === 'chat' && (
            <ChatTab
              activeConv={activeConv}
              conversations={conversations}
              onSelectConversation={(id) => {
                setActiveConvId(id);
                const target = conversations.find((c) => c.id === id);
                if (target?.workspaceId) {
                  setActiveWorkspaceId(target.workspaceId);
                }
              }}
              onNewConversation={handleNewConversation}
              onDeleteConversation={handleDeleteConversation}
              onUpdateConversationMeta={handleUpdateConversationMeta}
              providers={providers}
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              events={events}
              pendingApprovals={pendingApprovals}
              onApproveTool={handleApproveTool}
              sending={sending}
              chatError={chatError}
              onDismissError={() => setChatError(null)}
              onSendMessage={handleSendMessage}
              onContinueTask={handleContinueTask}
              onRetryToolCall={handleRetryToolCall}
              onStopGeneration={handleStopGeneration}
              maxAgentIterations={settings.maxAgentIterations || 10}
              onChangeMaxIterations={(nextMax) =>
                handleUpdateSettings({ maxAgentIterations: nextMax })
              }
              onNavigateToProjects={() => setActiveTab('projects')}
              onNavigateToTerminal={(cmd?: string) => {
                if (typeof cmd === 'string' && cmd.trim()) {
                  setQueuedTerminalCommand(cmd);
                }
                setActiveTab('terminal');
              }}
              onNavigateToProviders={() => setActiveTab('models')}
              onNavigateToSettings={() => setActiveTab('settings')}
              onNavigateToImages={() => setActiveTab('images')}
              onNavigateToPreview={() => setActiveTab('preview')}
              onNavigateToAgents={() => setActiveTab('agents')}
              onNavigateToSkills={() => setActiveTab('skills')}
              subagentTasks={subagentTasks}
              onRefreshTasks={() => {
                fetch('/api/subagents')
                  .then((r) => r.json())
                  .then((d) => {
                    if (d.tasks) setSubagentTasks(d.tasks);
                  });
              }}
            />
          )}

          {activeTab === 'models' && (
            <ModelsTab
              providers={providers}
              activeModelId={activeConv?.modelId || settings.defaultModelId}
              activeProviderId={activeConv?.providerId || settings.defaultProviderId}
              onSelectModel={(provId, modelId) => {
                if (activeConv) {
                  handleUpdateConversationMeta(activeConv.id, {
                    providerId: provId,
                    modelId: modelId,
                  });
                }
                handleUpdateSettings({
                  defaultProviderId: provId,
                  defaultModelId: modelId,
                });
              }}
              onRefreshProviders={() => {
                fetch('/api/providers')
                  .then((r) => r.json())
                  .then((d) => {
                    if (d.providers) setProviders(d.providers);
                  });
              }}
              onNavigateToSettings={() => setActiveTab('settings')}
              onOpenEnvironment={() => setShowEnvironmentModal(true)}
            />
          )}

          {activeTab === 'images' && (
            <ImagesTab
              providers={providers}
              onNavigateToSettings={() => setActiveTab('settings')}
            />
          )}

          {activeTab === 'files' && (
            <TabErrorBoundary>
              <FilesTab
                activeWorkspaceId={activeWorkspaceId}
                workspaces={workspaces}
                onSelectWorkspace={(id) => {
                  setActiveWorkspaceId(id);
                  if (activeConv) handleUpdateConversationMeta(activeConv.id, { workspaceId: id });
                }}
                onNavigateToChat={() => setActiveTab('chat')}
                onNavigateToTerminal={(cmd?: string) => {
                  if (typeof cmd === 'string' && cmd.trim()) {
                    setQueuedTerminalCommand(cmd);
                  }
                  setActiveTab('terminal');
                }}
              />
            </TabErrorBoundary>
          )}

          {activeTab === 'projects' && (
            <ProjectsTab
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              onSelectWorkspace={(id) => {
                setActiveWorkspaceId(id);
                if (activeConv) handleUpdateConversationMeta(activeConv.id, { workspaceId: id });
              }}
              onRefreshWorkspaces={() => refreshWorkspacesAndCheckpoints(activeWorkspaceId)}
              onNavigateToChat={() => setActiveTab('chat')}
              onNavigateToFiles={() => setActiveTab('files')}
              onNavigateToTerminal={(cmd?: string) => {
                if (typeof cmd === 'string' && cmd.trim()) {
                  setQueuedTerminalCommand(cmd);
                }
                setActiveTab('terminal');
              }}
            />
          )}

          {activeTab === 'preview' && (
            <TabErrorBoundary>
              <PreviewTab
                activeWorkspaceId={activeWorkspaceId}
                workspaces={workspaces}
                onNavigateToTerminal={(cmd?: string) => {
                  if (typeof cmd === 'string' && cmd.trim()) {
                    setQueuedTerminalCommand(cmd);
                  }
                  setActiveTab('terminal');
                }}
                onNavigateToProjects={() => setActiveTab('projects')}
              />
            </TabErrorBoundary>
          )}

          {activeTab === 'terminal' && (
            <TerminalTab
              activeWorkspaceId={activeWorkspaceId}
              initialCommand={queuedTerminalCommand}
              onConsumeInitialCommand={() => setQueuedTerminalCommand(null)}
            />
          )}

          {activeTab === 'tools' && (
            <TabErrorBoundary>
              <ToolsTab
                events={events}
                pendingApprovals={pendingApprovals}
                onApprove={handleApproveTool}
                permissions={permissions}
                onUpdatePermission={handleUpdatePermission}
                activeWorkspaceId={activeWorkspaceId}
                defaultSubView="tools"
              />
            </TabErrorBoundary>
          )}

          {activeTab === 'agents' && (
            <TabErrorBoundary>
              <AgentsTab
                activeWorkspaceId={activeWorkspaceId}
                conversationId={activeConv?.id}
                onSelectConversation={(id) => setActiveConvId(id)}
                events={events}
                pendingApprovals={pendingApprovals}
                onApprove={handleApproveTool}
                permissions={permissions}
                onUpdatePermission={handleUpdatePermission}
                activeConv={activeConv}
                conversations={conversations}
                sending={sending}
                onStopGeneration={handleStopGeneration}
                onContinueTask={handleContinueTask}
                onSendMessage={handleSendMessage}
                maxAgentIterations={settings.maxAgentIterations || 10}
                onChangeMaxIterations={(nextMax) =>
                  handleUpdateSettings({ maxAgentIterations: nextMax })
                }
                subagentTasks={subagentTasks}
                onRefreshSubagentTasks={() => {
                  fetch('/api/subagents')
                    .then((r) => r.json())
                    .then((d) => {
                      if (d.tasks) setSubagentTasks(d.tasks);
                    })
                    .catch(() => {});
                }}
                providers={providers}
                onNavigateToWorkspace={(id) => setActiveWorkspaceId(id)}
                onNavigateToChat={handleNavigateToChat}
              />
            </TabErrorBoundary>
          )}

          {activeTab === 'skills' && (
            <TabErrorBoundary>
              <SkillsTab
                activeWorkspaceId={activeWorkspaceId}
                onSelectSkillForPrompt={(skillId) => {
                  setActiveTab('chat');
                }}
              />
            </TabErrorBoundary>
          )}

          {(activeTab === 'settings' || activeTab === 'providers') && (
            <SettingsTab
              providers={providers}
              onRefreshProviders={() => {
                fetch('/api/providers')
                  .then((r) => r.json())
                  .then((d) => {
                    if (d.providers) setProviders(d.providers);
                  });
              }}
              settings={settings}
              onUpdateSettings={handleUpdateSettings}
              focusSection={activeTab === 'providers' ? 'providers' : 'settings'}
              activeWorkspace={activeWorkspace}
              onSelectWorkspace={(wsId) => setActiveWorkspaceId(wsId)}
              workspaces={workspaces}
              floatingBubbleEnabled={floatingBubbleEnabled}
              onToggleFloatingBubble={handleToggleFloatingBubble}
              onOpenEnvironment={() => setShowEnvironmentModal(true)}
            />
          )}

        </main>

        {/* Right Collapsible Context Drawer (Slide-over drawer on mobile, docked panel on desktop) */}
        {rightInspectorOpen && (
          <div className="fixed inset-0 z-50 lg:relative lg:inset-auto lg:z-20 flex justify-end">
            {/* Mobile backdrop */}
            <div
              className="fixed inset-0 bg-black/60 backdrop-blur-sm lg:hidden"
              onClick={() => setRightInspectorOpen(false)}
            />
            <div className="relative w-80 max-w-[85vw] h-full border-l border-[#30363D] bg-[#161B22] shadow-2xl flex flex-col z-10">
              <RightInspector
                activeTab={activeTab}
                activeWorkspace={activeWorkspace}
                activeProvider={activeProvider}
                activeModelId={activeConv?.modelId || settings.defaultModelId}
                events={events}
                pendingApprovals={pendingApprovals}
                checkpoints={checkpoints}
                onApproveTool={handleApproveTool}
                onNavigate={(dest) => {
                  setActiveTab(dest);
                  setRightInspectorOpen(false);
                }}
                onClose={() => setRightInspectorOpen(false)}
              />
            </div>
          </div>
        )}

        {/* Right-Hand Slim Icon Rail (As depicted on far-right edge of reference) */}
        {!rightInspectorOpen && (
          <aside className="hidden lg:flex flex-col items-center justify-between py-4 w-12 border-l border-[#30363D]/60 bg-[#0D1117] shrink-0 text-[#8B949E]">
            <div className="flex flex-col items-center gap-4">
              <button
                type="button"
                onClick={() => setActiveTab('projects')}
                className="p-2 rounded-lg hover:text-[#F0F6FC] hover:bg-[#161B22] transition-colors cursor-pointer"
                title="Workspaces & Files"
                aria-label="Workspaces & Files"
              >
                <FolderGit2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('tools')}
                className="p-2 rounded-lg hover:text-[#F0F6FC] hover:bg-[#161B22] transition-colors cursor-pointer"
                title="Agents & MCP Tools"
                aria-label="Agents & MCP Tools"
              >
                <Layers className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setRightInspectorOpen(true)}
                className="p-2 rounded-lg hover:text-[#F0F6FC] hover:bg-[#161B22] transition-colors cursor-pointer"
                title="Execution Timeline"
                aria-label="Execution Timeline"
              >
                <Clock className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                className="p-2 rounded-lg hover:text-[#F0F6FC] hover:bg-[#161B22] transition-colors cursor-pointer"
                title="Workstation Settings"
                aria-label="Workstation Settings"
              >
                <SettingsIcon className="w-4 h-4" />
              </button>
            </div>

            {/* Bottom Expand Chevron */}
            <button
              type="button"
              onClick={() => setRightInspectorOpen(true)}
              className="p-2 rounded-lg hover:text-[#F0F6FC] hover:bg-[#161B22] transition-colors cursor-pointer"
              title="Expand Context Inspector"
              aria-label="Expand Context Inspector"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </aside>
        )}
      </div>

      {/* =========================================================================
          SLIDE-OVER SESSION HISTORY & CONVERSATION DRAWER
          ========================================================================= */}
      {sessionsDrawerOpen && (
        <div
          className="fixed inset-0 z-50 flex"
          role="dialog"
          aria-modal="true"
          aria-label="Conversation Sessions"
        >
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setSessionsDrawerOpen(false)}
          />
          <div className="relative w-80 max-w-[85vw] h-full bg-[#161B22] border-r border-[#30363D] shadow-2xl flex flex-col z-10">
            <div className="h-14 px-4 border-b border-[#30363D] flex items-center justify-between">
              <span className="text-sm font-semibold text-[#F0F6FC]">Chat Sessions</span>
              <button
                type="button"
                onClick={() => setSessionsDrawerOpen(false)}
                title="Close Sessions Drawer"
                aria-label="Close Sessions Drawer"
                className="p-1.5 rounded-md text-[#8B949E] hover:text-[#F0F6FC] hover:bg-[#21262D] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 border-b border-[#30363D]">
              <button
                type="button"
                onClick={handleNewConversation}
                title="Start New Chat Session"
                aria-label="Start New Chat Session"
                className="w-full py-2 px-3 rounded-lg bg-[#C7FF65] text-[#0D1117] font-semibold text-xs flex items-center justify-center gap-2 hover:bg-[#B8F558] transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>New Session</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {conversations.map((c) => {
                const isSelected = c.id === activeConv?.id;
                return (
                  <div
                    key={c.id}
                    className={`group flex items-center justify-between gap-2 p-2.5 rounded-lg border transition-all ${
                      isSelected
                        ? 'bg-[#21262D] border-[#388BFD] text-[#F0F6FC]'
                        : 'border-transparent hover:bg-[#21262D] text-[#8B949E] hover:text-[#F0F6FC]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveConvId(c.id);
                        setActiveWorkspaceId(c.workspaceId || 'android-workstation');
                        setActiveTab('chat');
                        setSessionsDrawerOpen(false);
                      }}
                      title={`Open session: ${c.title}`}
                      aria-label={`Open session: ${c.title}`}
                      className="flex-1 text-left min-w-0 cursor-pointer"
                    >
                      <div className="text-xs font-medium truncate" title={c.title}>
                        {c.title}
                      </div>
                      <div className="text-[10px] font-mono text-[#8B949E] truncate">
                        {c.workspaceId} · {c.messages.length === 1 ? '1 message' : `${c.messages.length} messages`}
                      </div>
                    </button>
                    {conversations.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleDeleteConversation(c.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-[#8B949E] hover:text-[#DA3633] transition-opacity cursor-pointer"
                        title="Delete Session"
                        aria-label={`Delete session: ${c.title}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MOBILE BOTTOM NAVIGATION (5-Tab Bar Strictly Matching Reference Screenshot)
          ========================================================================= */}
      <nav
        aria-label="Mobile Navigation"
        className="md:hidden border-t border-[#30363D] bg-[#161B22] grid grid-cols-5 items-center h-14 sm:h-16 shrink-0 safe-bottom z-40"
      >
        {mobileNavTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive =
            tab.id === 'chat'
              ? activeTab === 'chat'
              : tab.id === 'tools'
              ? activeTab === 'tools' ||
                activeTab === 'skills' ||
                activeTab === 'projects' ||
                activeTab === 'preview' ||
                activeTab === 'images' ||
                activeTab === 'models'
              : tab.id === 'agents'
              ? activeTab === 'agents'
              : tab.id === 'terminal'
              ? activeTab === 'terminal'
              : tab.id === 'settings'
              ? activeTab === 'settings' || activeTab === 'providers'
              : false;

          return (
            <button
              key={tab.id}
              type="button"
              data-tab-id={tab.id}
              title={tab.label}
              aria-label={tab.label}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (tab.id === 'terminal') {
                  setActiveTab('terminal');
                } else if (tab.id === 'agents') {
                  setActiveTab('agents');
                } else {
                  setActiveTab(tab.id);
                }
              }}
              className={`relative flex flex-col items-center justify-center h-full min-h-[44px] transition-colors cursor-pointer ${
                isActive ? 'text-[#C7FF65]' : 'text-[#8B949E] hover:text-[#F0F6FC]'
              }`}
            >
              {isActive && (
                <span className="absolute top-0 w-8 h-[2px] bg-[#C7FF65] rounded-full shadow-[0_0_8px_#C7FF65]" />
              )}
              <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-[#C7FF65]' : 'text-[#8B949E]'}`} />
              <span
                className={`text-[10px] font-medium mt-0.5 tracking-tight truncate max-w-full px-0.5 ${
                  isActive ? 'text-[#C7FF65] font-semibold' : 'text-[#8B949E]'
                }`}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Draggable Floating HUD Bubble with edge snapping (web fallback) */}
      {!nativeOverlaySupported && (
        <FloatingBubble
          enabled={floatingBubbleEnabled}
          onDismiss={() => handleToggleFloatingBubble(false)}
          onNavigateToChat={() => setActiveTab('chat')}
          onNavigateToTerminal={() => setActiveTab('terminal')}
          onNavigateToTasks={() => setActiveTab('agents')}
          activeTask={runningTask}
          runningTasksCount={runningTasksCount}
        />
      )}

      {/* Authoritative Environment & Diagnostics Modal */}
      <EnvironmentModal
        isOpen={showEnvironmentModal}
        onClose={() => setShowEnvironmentModal(false)}
        report={envReport}
        onRefresh={() => fetchEnvironment(activeWorkspaceId)}
        loading={loadingEnv}
      />
    </div>
  );
}

export default App;
