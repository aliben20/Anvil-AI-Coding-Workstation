import React, { useState } from 'react';
import {
  FolderGit2,
  Folder,
  Plus,
  RefreshCw,
  Edit2,
  Trash2,
  Terminal,
  MessageSquare,
  FileCode,
  Check,
  AlertTriangle,
  Copy,
  ExternalLink,
  ShieldAlert,
  Search,
  HardDrive,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { WorkspaceSummary } from '../types';

interface ProjectsTabProps {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string;
  onSelectWorkspace: (id: string) => void;
  onRefreshWorkspaces: () => void;
  onNavigateToChat?: () => void;
  onNavigateToFiles?: () => void;
  onNavigateToTerminal?: (initialCommand?: string) => void;
}

export const ProjectsTab: React.FC<ProjectsTabProps> = ({
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  onRefreshWorkspaces,
  onNavigateToChat,
  onNavigateToFiles,
  onNavigateToTerminal,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Create Workspace Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspaceTemplate, setNewWorkspaceTemplate] = useState('empty');

  // Rename Workspace Modal
  const [renamingWorkspace, setRenamingWorkspace] = useState<WorkspaceSummary | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Remove Workspace Modal
  const [removingWorkspace, setRemovingWorkspace] = useState<WorkspaceSummary | null>(null);
  const [deleteFilesPermanent, setDeleteFilesPermanent] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

  const handleCopyPath = (filePath: string) => {
    navigator.clipboard?.writeText(filePath);
    setCopiedPath(filePath);
    setTimeout(() => setCopiedPath(null), 2500);
  };

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newWorkspaceName.trim();
    if (!cleanName) return;
    setLoading(true);
    setActionError(null);
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cleanName,
          templateId: newWorkspaceTemplate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create workspace.');
      }
      setNewWorkspaceName('');
      setNewWorkspaceTemplate('empty');
      setShowCreateModal(false);
      onRefreshWorkspaces();
      if (data.workspace?.id) {
        onSelectWorkspace(data.workspace.id);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRenameWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingWorkspace || !renameValue.trim()) return;
    setLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(renamingWorkspace.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to rename workspace.');
      }
      const targetId = data.workspace?.id || renamingWorkspace.id;
      setRenamingWorkspace(null);
      setRenameValue('');
      onRefreshWorkspaces();
      onSelectWorkspace(targetId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveWorkspace = async () => {
    if (!removingWorkspace) return;
    if (deleteFilesPermanent && deleteConfirmText !== removingWorkspace.id) {
      setActionError(`Please type '${removingWorkspace.id}' to confirm permanent deletion.`);
      return;
    }
    setLoading(true);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(removingWorkspace.id)}?deleteFiles=${deleteFilesPermanent}`,
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to remove workspace.');
      }
      const wasActive = removingWorkspace.id === activeWorkspaceId;
      setRemovingWorkspace(null);
      setDeleteFilesPermanent(false);
      setDeleteConfirmText('');
      onRefreshWorkspaces();
      if (wasActive) {
        onSelectWorkspace('android-workstation');
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const filteredWorkspaces = workspaces.filter(
    (w) =>
      w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      w.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      w.path.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full w-full bg-[#0D1117] text-[#F0F6FC] overflow-y-auto">
      {/* Top Header */}
      <div className="px-4 sm:px-8 py-4 sm:py-5 border-b border-[#30363D] bg-[#161B22] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shrink-0">
        <div>
          <div className="flex items-center gap-2.5">
            <FolderGit2 className="w-5 h-5 text-[#C7FF65]" />
            <h1 className="text-base sm:text-lg font-bold text-[#F0F6FC]">
              Workspaces & Project Directories
            </h1>
          </div>
          <p className="text-xs text-[#8B949E] mt-0.5">
            Lightweight project directory manager shared by Chat, Files, and Terminal.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={onRefreshWorkspaces}
            disabled={loading}
            className="flex-1 sm:flex-none min-h-[36px] px-3 py-1.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-xs text-[#F0F6FC] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            title="Refresh Workspaces"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="flex-1 sm:flex-none min-h-[36px] px-3.5 py-1.5 rounded-lg bg-[#C7FF65] hover:bg-[#B8F558] text-[#0D1117] text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-sm"
          >
            <Plus className="w-3.5 h-3.5 stroke-[3]" />
            <span>New Workspace</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="p-4 sm:p-8 max-w-6xl mx-auto w-full space-y-6">
        {/* Error Alert */}
        {actionError && (
          <div className="p-3.5 rounded-xl bg-[#DA3633]/20 border border-[#DA3633]/40 text-xs text-[#FF727A] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{actionError}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-xs hover:text-white cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Active Workspace Spotlight Card */}
        {activeWorkspace && (
          <div className="p-5 rounded-2xl bg-[#161B22] border border-[#C7FF65]/50 ring-1 ring-[#C7FF65]/20 shadow-md space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-[#C7FF65]/10 border border-[#C7FF65]/30 flex items-center justify-center shrink-0">
                  <Folder className="w-5 h-5 text-[#C7FF65]" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm sm:text-base text-[#F0F6FC] truncate">
                      {activeWorkspace.name}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#C7FF65]/20 text-[#C7FF65] border border-[#C7FF65]/40 flex items-center gap-1">
                      <Check className="w-3 h-3 stroke-[3]" /> Active Workspace
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#21262D] text-[#8B949E] border border-[#30363D]">
                      {activeWorkspace.projectType}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-[#8B949E]">
                    <span className="font-mono truncate" title={activeWorkspace.path}>
                      {activeWorkspace.path}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyPath(activeWorkspace.path)}
                      className="hover:text-[#F0F6FC] cursor-pointer"
                      title="Copy path"
                    >
                      {copiedPath === activeWorkspace.path ? (
                        <Check className="w-3 h-3 text-[#3FB950]" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Quick Launch Actions */}
              <div className="flex items-center gap-2 w-full sm:w-auto">
                {onNavigateToChat && (
                  <button
                    type="button"
                    onClick={onNavigateToChat}
                    className="flex-1 sm:flex-none px-3 py-1.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-xs font-semibold text-[#F0F6FC] hover:text-[#C7FF65] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-[#58A6FF]" />
                    <span>Open in Chat</span>
                  </button>
                )}

                {onNavigateToFiles && (
                  <button
                    type="button"
                    onClick={onNavigateToFiles}
                    className="flex-1 sm:flex-none px-3 py-1.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-xs font-semibold text-[#F0F6FC] hover:text-[#C7FF65] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <FileCode className="w-3.5 h-3.5 text-[#C7FF65]" />
                    <span>Browse Files</span>
                  </button>
                )}

                {onNavigateToTerminal && (
                  <button
                    type="button"
                    onClick={() => onNavigateToTerminal()}
                    className="flex-1 sm:flex-none px-3 py-1.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-xs font-semibold text-[#F0F6FC] hover:text-[#C7FF65] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Terminal className="w-3.5 h-3.5 text-[#3FB950]" />
                    <span>Open Terminal</span>
                  </button>
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-[#30363D]/60 flex items-center justify-between text-xs text-[#8B949E]">
              <div className="flex items-center gap-4">
                <span>Files in Workspace: <strong className="text-[#F0F6FC] font-mono">{activeWorkspace.fileCount}</strong></span>
                <span>Last Updated: <span className="text-[#F0F6FC]">{new Date(activeWorkspace.updatedAtMillis).toLocaleString()}</span></span>
              </div>
              <span className="text-[11px] text-[#8B949E] hidden md:inline">
                Both Chat and Terminal execute within this directory root.
              </span>
            </div>
          </div>
        )}

        {/* Workspaces List / Explorer */}
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-[#F0F6FC] flex items-center gap-2">
              <span>All Registered Project Directories</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#21262D] text-[#8B949E]">
                {workspaces.length}
              </span>
            </h2>

            {/* Search Input */}
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-[#8B949E] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter workspaces..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#161B22] border border-[#30363D] text-xs text-[#F0F6FC] placeholder-[#8B949E] focus:outline-none focus:border-[#C7FF65]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {filteredWorkspaces.map((ws) => {
              const isActive = ws.id === activeWorkspaceId;
              const isCoreNative = ws.id === 'android-workstation';

              return (
                <div
                  key={ws.id}
                  className={`p-4 rounded-xl border transition-all ${
                    isActive
                      ? 'bg-[#161B22] border-[#C7FF65]/50 ring-1 ring-[#C7FF65]/20'
                      : 'bg-[#0D1117] border-[#30363D] hover:border-[#8B949E]/40'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Folder className={`w-4 h-4 ${isActive ? 'text-[#C7FF65]' : 'text-[#8B949E]'}`} />
                        <span className="font-bold text-xs sm:text-sm text-[#F0F6FC] truncate">
                          {ws.name}
                        </span>
                        {isActive && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-[#C7FF65]/20 text-[#C7FF65]">
                            Active
                          </span>
                        )}
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-[#21262D] text-[#8B949E]">
                          {ws.projectType}
                        </span>
                        <span className="text-[11px] text-[#8B949E]">
                          · {ws.fileCount} files
                        </span>
                      </div>

                      <div className="flex items-center gap-2 mt-1.5 text-xs text-[#8B949E]">
                        <span className="font-mono text-[11px] truncate" title={ws.path}>
                          {ws.path}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyPath(ws.path)}
                          className="hover:text-[#F0F6FC] cursor-pointer"
                          title="Copy path"
                        >
                          {copiedPath === ws.path ? (
                            <Check className="w-3 h-3 text-[#3FB950]" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                      {!isActive ? (
                        <button
                          type="button"
                          onClick={() => onSelectWorkspace(ws.id)}
                          className="px-3 py-1.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] text-[#F0F6FC] hover:text-[#C7FF65] border border-[#30363D] font-semibold text-xs transition-colors cursor-pointer"
                        >
                          Select Workspace
                        </button>
                      ) : (
                        <span className="px-2.5 py-1 text-xs text-[#C7FF65] font-semibold">
                          Selected
                        </span>
                      )}

                      {!isCoreNative && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingWorkspace(ws);
                              setRenameValue(ws.name);
                            }}
                            className="p-1.5 rounded-lg hover:bg-[#21262D] text-[#8B949E] hover:text-[#F0F6FC] transition-colors cursor-pointer"
                            title="Rename workspace"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setRemovingWorkspace(ws);
                              setDeleteFilesPermanent(false);
                              setDeleteConfirmText('');
                            }}
                            className="p-1.5 rounded-lg hover:bg-[#21262D] text-[#8B949E] hover:text-[#FF727A] transition-colors cursor-pointer"
                            title="Remove workspace"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Create Workspace Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#161B22] border border-[#30363D] rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl">
            <h3 className="text-sm font-bold text-[#F0F6FC] flex items-center gap-2">
              <Plus className="w-4 h-4 text-[#C7FF65]" />
              <span>Create New Project Workspace</span>
            </h3>
            <p className="text-xs text-[#8B949E]">
              A project workspace is a real host directory where Chat and Terminal run their operations.
            </p>

            <form onSubmit={handleCreateWorkspace} className="space-y-4">
              <div>
                <label className="text-xs text-[#8B949E] block mb-1 font-medium">
                  Project Workspace Name:
                </label>
                <input
                  type="text"
                  value={newWorkspaceName}
                  onChange={(e) => setNewWorkspaceName(e.target.value)}
                  placeholder="e.g. android-health-tracker or web-service"
                  autoFocus
                  className="w-full px-3 py-2 rounded-lg bg-[#0D1117] border border-[#30363D] text-xs text-[#F0F6FC] focus:border-[#C7FF65] outline-none"
                />
              </div>

              <div>
                <label className="text-xs text-[#8B949E] block mb-1 font-medium">
                  Directory Template:
                </label>
                <select
                  value={newWorkspaceTemplate}
                  onChange={(e) => setNewWorkspaceTemplate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0D1117] border border-[#30363D] text-xs text-[#F0F6FC] focus:border-[#C7FF65] outline-none"
                >
                  <option value="empty">Empty Workspace (Directory only, zero dummy files)</option>
                  <option value="kotlin-android">Android Project (Kotlin + Gradle scaffold)</option>
                  <option value="web-node">Web / Node (package.json + index.js scaffold)</option>
                  <option value="python">Python (main.py + test scaffold)</option>
                </select>
                <p className="text-[11px] text-[#8B949E] mt-1">
                  {newWorkspaceTemplate === 'empty'
                    ? 'Recommended: Creates a clean project directory without generic README or sample files.'
                    : 'Initializes base build configuration and source files.'}
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#30363D]">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 rounded-lg text-xs text-[#8B949E] hover:text-[#F0F6FC] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newWorkspaceName.trim() || loading}
                  className="px-4 py-1.5 rounded-lg bg-[#C7FF65] text-[#0D1117] font-bold text-xs hover:bg-[#B8F558] disabled:opacity-50 cursor-pointer"
                >
                  {loading ? 'Creating...' : 'Create Workspace'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Workspace Modal */}
      {renamingWorkspace && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#161B22] border border-[#30363D] rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl">
            <h3 className="text-sm font-bold text-[#F0F6FC] flex items-center gap-2">
              <Edit2 className="w-4 h-4 text-[#C7FF65]" />
              <span>Rename Workspace: {renamingWorkspace.name}</span>
            </h3>
            <form onSubmit={handleRenameWorkspace} className="space-y-4">
              <div>
                <label className="text-xs text-[#8B949E] block mb-1">
                  New Workspace Name:
                </label>
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  autoFocus
                  className="w-full px-3 py-2 rounded-lg bg-[#0D1117] border border-[#30363D] text-xs text-[#F0F6FC] focus:border-[#C7FF65] outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#30363D]">
                <button
                  type="button"
                  onClick={() => setRenamingWorkspace(null)}
                  className="px-3 py-1.5 rounded-lg text-xs text-[#8B949E] hover:text-[#F0F6FC] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!renameValue.trim() || renameValue === renamingWorkspace.name || loading}
                  className="px-4 py-1.5 rounded-lg bg-[#C7FF65] text-[#0D1117] font-bold text-xs hover:bg-[#B8F558] disabled:opacity-50 cursor-pointer"
                >
                  {loading ? 'Renaming...' : 'Apply Rename'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Remove Workspace Modal */}
      {removingWorkspace && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#161B22] border border-[#30363D] rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl">
            <h3 className="text-sm font-bold text-[#FF727A] flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-[#FF727A]" />
              <span>Remove Workspace: {removingWorkspace.name}</span>
            </h3>
            <p className="text-xs text-[#8B949E]">
              Choose whether to remove the workspace reference from OBSIDIAN while keeping your files, or permanently delete the directory from disk.
            </p>

            <div className="space-y-2.5">
              <label className="flex items-start gap-3 p-3 rounded-xl border border-[#30363D] bg-[#0D1117] cursor-pointer">
                <input
                  type="radio"
                  name="deleteType"
                  checked={!deleteFilesPermanent}
                  onChange={() => setDeleteFilesPermanent(false)}
                  className="mt-0.5"
                />
                <div className="text-xs">
                  <div className="font-semibold text-[#F0F6FC]">
                    Remove Reference Only (Safe)
                  </div>
                  <div className="text-[#8B949E] mt-0.5">
                    Unregisters the workspace from the active list. All files and source code remain preserved on disk.
                  </div>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 rounded-xl border border-[#DA3633]/40 bg-[#DA3633]/10 cursor-pointer">
                <input
                  type="radio"
                  name="deleteType"
                  checked={deleteFilesPermanent}
                  onChange={() => setDeleteFilesPermanent(true)}
                  className="mt-0.5"
                />
                <div className="text-xs">
                  <div className="font-semibold text-[#FF727A]">
                    Delete Directory & Files Permanently
                  </div>
                  <div className="text-[#8B949E] mt-0.5">
                    Permanently deletes <code className="text-[#F0F6FC]">{removingWorkspace.path}</code> and all contents inside it.
                  </div>
                </div>
              </label>
            </div>

            {deleteFilesPermanent && (
              <div className="space-y-1.5 pt-1">
                <label className="text-[11px] text-[#FF727A] block">
                  To confirm permanent file deletion, type <strong>{removingWorkspace.id}</strong> below:
                </label>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={removingWorkspace.id}
                  className="w-full px-3 py-2 rounded-lg bg-[#0D1117] border border-[#DA3633] text-xs text-[#F0F6FC] font-mono focus:border-[#FF727A] outline-none"
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#30363D]">
              <button
                type="button"
                onClick={() => setRemovingWorkspace(null)}
                className="px-3 py-1.5 rounded-lg text-xs text-[#8B949E] hover:text-[#F0F6FC] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRemoveWorkspace}
                disabled={loading || (deleteFilesPermanent && deleteConfirmText !== removingWorkspace.id)}
                className={`px-4 py-1.5 rounded-lg font-bold text-xs cursor-pointer disabled:opacity-50 ${
                  deleteFilesPermanent
                    ? 'bg-[#DA3633] hover:bg-[#C92A28] text-white'
                    : 'bg-[#C7FF65] hover:bg-[#B8F558] text-[#0D1117]'
                }`}
              >
                {loading ? 'Removing...' : deleteFilesPermanent ? 'Delete Permanently' : 'Remove Reference'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
