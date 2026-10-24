import React from 'react';
import {
  ShieldAlert,
  Check,
  X,
  FileDiff,
  FolderGit2,
  Terminal as TerminalIcon,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react';
import {
  AgentActivityEvent,
  PendingApproval,
  FileDiffRecord,
  ProviderSummary,
  WorkspaceSummary,
  TabDestination,
} from '../types';
import { formatRelativeTime } from '../design/tokens';

interface RightInspectorProps {
  activeTab: TabDestination;
  activeWorkspace: WorkspaceSummary | undefined;
  activeProvider: ProviderSummary | undefined;
  activeModelId: string;
  events: AgentActivityEvent[];
  pendingApprovals: PendingApproval[];
  checkpoints: FileDiffRecord[];
  onApproveTool: (approvalId: string, approved: boolean) => void;
  onNavigate: (tab: TabDestination) => void;
  onClose?: () => void;
}

export const RightInspector: React.FC<RightInspectorProps> = ({
  activeWorkspace,
  activeProvider,
  activeModelId,
  events,
  pendingApprovals,
  checkpoints,
  onApproveTool,
  onNavigate,
  onClose,
}) => {
  const workspaceEvents = events.filter(
    (ev) => !activeWorkspace || ev.workspaceId === activeWorkspace.id
  );
  const workspaceCheckpoints = checkpoints.filter(
    (cp) => !activeWorkspace || cp.workspaceId === activeWorkspace.id
  );

  const getStateIcon = (state: string) => {
    switch (state) {
      case 'COMPLETED':
        return <CheckCircle2 className="w-3.5 h-3.5 text-[#72D9A0] shrink-0" />;
      case 'FAILED':
      case 'CANCELLED':
        return <XCircle className="w-3.5 h-3.5 text-[#FF727A] shrink-0" />;
      case 'WAITING_FOR_PERMISSION':
        return <AlertTriangle className="w-3.5 h-3.5 text-[#F4C46A] shrink-0" />;
      default:
        return <Clock className="w-3.5 h-3.5 text-[#C7FF65] shrink-0" />;
    }
  };

  return (
    <aside className="w-full xl:w-80 max-w-full shrink-0 bg-[#161B22] border-l border-[#30363D] flex flex-col h-full select-none safe-top safe-bottom">
      {/* Inspector Header */}
      <div className="h-14 px-4 border-b border-[#30363D] flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-[#F0F6FC] tracking-tight truncate">
            Contextual Inspector
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close inspector"
            title="Close inspector"
            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-md text-[#A0A6AF] hover:text-[#F4F5F6] hover:bg-[#1B1F24] shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-[#30363D]">
        {/* 1. Active Context Summary */}
        <div className="p-4 space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[#8B949E]">Active Environment</div>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#8B949E] shrink-0">Workspace</span>
              <button
                onClick={() => onNavigate('projects')}
                title="Open Workspaces file tree"
                aria-label={`Open workspace: ${activeWorkspace?.id || 'android-workstation'}`}
                className="font-mono text-[#F0F6FC] hover:text-[#388BFD] flex items-center gap-1 min-w-0 truncate"
              >
                <span className="truncate">{activeWorkspace?.id || 'android-workstation'}</span>
                <ChevronRight className="w-3 h-3 shrink-0" />
              </button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#8B949E] shrink-0">Project Type</span>
              <span className="font-mono text-[#8B949E] truncate">
                {activeWorkspace?.projectType || 'kotlin-android'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#8B949E] shrink-0">Provider</span>
              <button
                onClick={() => onNavigate('models')}
                title="Open Models & Providers settings"
                aria-label={`Open provider: ${activeProvider?.name || 'Gemini API'}`}
                className="text-[#F0F6FC] hover:text-[#388BFD] truncate min-w-0"
              >
                {activeProvider?.name || 'Gemini API'}
              </button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#8B949E] shrink-0">Active Model</span>
              <span className="font-mono text-[11px] text-[#F0F6FC] truncate min-w-0">
                {activeModelId}
              </span>
            </div>
          </div>
        </div>

        {/* 2. Pending Tool Approvals (High Priority) */}
        {pendingApprovals.length > 0 && (
          <div className="p-4 bg-[#21262D]/60 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#D29922]">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>Approval Required</span>
              </div>
              <span className="text-[11px] font-mono text-[#D29922] tabular-nums shrink-0">
                {pendingApprovals.length} {pendingApprovals.length === 1 ? 'pending' : 'pending'}
              </span>
            </div>

            <div className="space-y-2.5">
              {pendingApprovals.map((pa) => (
                <div
                  key={pa.id}
                  className="p-3 rounded-lg bg-[#161B22] border border-[#D29922]/50 space-y-2 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="font-mono font-semibold text-[#F0F6FC] id-wrap">
                      {pa.toolName}
                    </span>
                    <span className="text-[10px] font-mono text-[#D29922]">{pa.category}</span>
                  </div>
                  <pre className="p-2 rounded bg-[#0D1117] border border-[#30363D] text-[10.5px] font-mono text-[#8B949E] overflow-x-auto max-h-28">
                    {JSON.stringify(pa.arguments, null, 2)}
                  </pre>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      onClick={() => onApproveTool(pa.id, true)}
                      title={`Approve execution of ${pa.toolName}`}
                      aria-label={`Approve ${pa.toolName}`}
                      className="min-h-[34px] py-1.5 px-2.5 rounded bg-[#238636] text-white font-semibold text-xs flex items-center justify-center gap-1 hover:opacity-90"
                    >
                      <Check className="w-3.5 h-3.5 shrink-0" />
                      <span>Approve</span>
                    </button>
                    <button
                      onClick={() => onApproveTool(pa.id, false)}
                      title={`Deny execution of ${pa.toolName}`}
                      aria-label={`Deny ${pa.toolName}`}
                      className="min-h-[34px] py-1.5 px-2.5 rounded bg-[#21262D] border border-[#30363D] text-[#DA3633] font-medium text-xs flex items-center justify-center gap-1 hover:bg-[#30363D]"
                    >
                      <X className="w-3.5 h-3.5 shrink-0" />
                      <span>Deny</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. Changed Files & Diff Checkpoints */}
        <div className="p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B949E]">
              Workspace Diffs ({workspaceCheckpoints.length})
            </span>
            <button
              onClick={() => onNavigate('projects')}
              title="Review all modified files in Workspaces"
              aria-label="Review all workspace file diffs"
              className="text-[11px] text-[#388BFD] hover:underline shrink-0"
            >
              Review All
            </button>
          </div>

          {workspaceCheckpoints.length === 0 ? (
            <div className="text-xs text-[#8B949E] py-2">
              No modified files in current session.
            </div>
          ) : (
            <div className="space-y-1.5">
              {workspaceCheckpoints.slice(0, 5).map((cp) => (
                <button
                  key={cp.id}
                  onClick={() => onNavigate('projects')}
                  title={`Inspect diff for ${cp.relativePath}`}
                  aria-label={`Inspect diff for ${cp.relativePath}`}
                  className="w-full text-left px-2.5 py-2 rounded-md bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] flex items-center justify-between gap-2 text-xs transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileDiff className="w-3.5 h-3.5 text-[#388BFD] shrink-0" />
                    <span className="font-mono text-[#F0F6FC] truncate">{cp.relativePath}</span>
                  </div>
                  <div className="font-mono text-[11px] shrink-0 tabular-nums">
                    <span className="text-[#238636]">+{cp.additions}</span>{' '}
                    <span className="text-[#DA3633]">-{cp.deletions}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 4. Vertical Execution Timeline */}
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8B949E]">Execution Timeline</span>
            <span className="text-[11px] font-mono text-[#8B949E] tabular-nums">
              {workspaceEvents.length} {workspaceEvents.length === 1 ? 'step' : 'steps'}
            </span>
          </div>

          {workspaceEvents.length === 0 ? (
            <div className="text-xs text-[#8B949E] py-3">
              Task steps and tool verification events will stream here during execution.
            </div>
          ) : (
            <div className="relative pl-3 border-l border-[#30363D] space-y-4">
              {workspaceEvents.slice(0, 20).map((ev) => (
                <div key={ev.id} className="relative space-y-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {getStateIcon(ev.state)}
                      <span className="text-xs font-medium text-[#F0F6FC] truncate">
                        {ev.title}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-[#8B949E] shrink-0 tabular-nums">
                      {formatRelativeTime(ev.timestampMillis)}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#8B949E] leading-relaxed pl-5 id-wrap">
                    {ev.description}
                  </p>
                  {ev.toolInput && (
                    <div className="pl-5 pt-1">
                      <pre className="p-2 rounded bg-[#0D1117] border border-[#30363D] text-[10.5px] font-mono text-[#8B949E] overflow-x-auto max-h-24">
                        {ev.toolInput}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quick Action Footer */}
      <div className="p-3 border-t border-[#30363D] bg-[#161B22] grid grid-cols-2 gap-2 shrink-0">
        <button
          onClick={() => onNavigate('projects')}
          title="Open Workspaces Explorer"
          aria-label="Open Workspaces Explorer"
          className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-xs text-[#F0F6FC] flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
        >
          <FolderGit2 className="w-3.5 h-3.5 text-[#388BFD] shrink-0" />
          <span>Workspaces</span>
        </button>
        <button
          onClick={() => onNavigate('terminal')}
          title="Open Interactive Shell Terminal"
          aria-label="Open Interactive Shell Terminal"
          className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-xs text-[#F0F6FC] flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
        >
          <TerminalIcon className="w-3.5 h-3.5 text-[#8B949E] shrink-0" />
          <span>Terminal</span>
        </button>
      </div>
    </aside>
  );
};
