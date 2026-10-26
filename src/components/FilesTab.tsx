import React, { useState, useEffect, useRef } from 'react';
import {
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  File,
  Search,
  RefreshCw,
  Plus,
  Save,
  Trash2,
  Edit2,
  Terminal,
  MessageSquare,
  ChevronRight,
  ChevronDown,
  Check,
  AlertCircle,
  FileDiff,
  Eye,
  FolderPlus,
  ExternalLink,
  Code2,
  Layers,
  Sparkles,
} from 'lucide-react';
import { WorkspaceSummary, FileDiffRecord } from '../types';
import { formatBytes } from '../design/tokens';

interface FilesTabProps {
  activeWorkspaceId: string;
  workspaces: WorkspaceSummary[];
  onSelectWorkspace?: (workspaceId: string) => void;
  onNavigateToChat?: (fileContext?: string) => void;
  onNavigateToTerminal?: (initialCommand?: string) => void;
  onNavigateToAgents?: (fileContext?: string) => void;
}

interface WorkspaceFileItem {
  relativePath: string;
  sizeBytes: number;
  updatedAtMillis: number;
}

export const FilesTab: React.FC<FilesTabProps> = ({
  activeWorkspaceId,
  workspaces,
  onSelectWorkspace,
  onNavigateToChat,
  onNavigateToTerminal,
  onNavigateToAgents,
}) => {
  const [files, setFiles] = useState<WorkspaceFileItem[]>([]);
  const [checkpoints, setCheckpoints] = useState<FileDiffRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Selected file & editor state
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [editorContent, setEditorContent] = useState<string>('');
  const [savedContent, setSavedContent] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saveToast, setSaveToast] = useState<string | null>(null);

  // Modals & form states
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderPath, setNewFolderPath] = useState('');
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameNewPath, setRenameNewPath] = useState('');
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [selectedDiff, setSelectedDiff] = useState<FileDiffRecord | null>(null);

  // Mobile view toggle ('list' | 'editor')
  const [mobileView, setMobileView] = useState<'list' | 'editor'>('list');

  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId);
  const isDirty = editorContent !== savedContent;

  const fetchFiles = async (preferredSelectPath?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(activeWorkspaceId)}/files`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const fileList: WorkspaceFileItem[] = data.files || [];
      setFiles(fileList);
      setCheckpoints(data.checkpoints || []);

      const targetPath =
        preferredSelectPath ||
        (fileList.some((f) => f.relativePath === selectedPath)
          ? selectedPath
          : fileList[0]?.relativePath || '');

      if (targetPath) {
        loadFileContent(targetPath);
      } else {
        setSelectedPath('');
        setEditorContent('');
        setSavedContent('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadFileContent = async (relPath: string) => {
    try {
      setSelectedPath(relPath);
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(activeWorkspaceId)}/file?path=${encodeURIComponent(relPath)}`
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Failed to read ${relPath}`);
      }
      const data = await res.json();
      setEditorContent(data.content || '');
      setSavedContent(data.content || '');
      setMobileView('editor');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    fetchFiles();
  }, [activeWorkspaceId]);

  const handleSave = async () => {
    if (!selectedPath) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(activeWorkspaceId)}/file`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: selectedPath,
            content: editorContent,
          }),
        }
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Failed to save file`);
      }
      setSavedContent(editorContent);
      setSaveToast('Saved successfully');
      setTimeout(() => setSaveToast(null), 3000);
      fetchFiles(selectedPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newFilePath.trim().replace(/^[\/\\]+/, '');
    if (!clean) return;
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(activeWorkspaceId)}/file`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: clean,
            content: '',
          }),
        }
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to create file');
      }
      setNewFilePath('');
      setShowNewFileModal(false);
      await fetchFiles(clean);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newFolderPath.trim().replace(/^[\/\\]+/, '');
    if (!clean) return;
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(activeWorkspaceId)}/mkdir`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: clean }),
        }
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to create folder');
      }
      setNewFolderPath('');
      setShowNewFolderModal(false);
      await fetchFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingPath || !renameNewPath.trim()) return;
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(activeWorkspaceId)}/rename`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            oldPath: renamingPath,
            newPath: renameNewPath.trim(),
          }),
        }
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to rename');
      }
      const target = renameNewPath.trim();
      setRenamingPath(null);
      setRenameNewPath('');
      await fetchFiles(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async (relPath: string) => {
    if (!confirm(`Are you sure you want to delete '${relPath}' from ${activeWorkspaceId}?`)) {
      return;
    }
    try {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(activeWorkspaceId)}/file?path=${encodeURIComponent(relPath)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to delete');
      }
      await fetchFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const filteredFiles = files.filter((f) =>
    f.relativePath.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getFileIcon = (relPath: string) => {
    const ext = relPath.split('.').pop()?.toLowerCase();
    if (['kt', 'java', 'ts', 'js', 'jsx', 'tsx', 'py'].includes(ext || '')) {
      return <FileCode className="w-4 h-4 text-[#C7FF65] shrink-0" />;
    }
    if (['md', 'txt', 'json', 'xml', 'gradle', 'kts'].includes(ext || '')) {
      return <FileText className="w-4 h-4 text-[#58A6FF] shrink-0" />;
    }
    return <File className="w-4 h-4 text-[#8B949E] shrink-0" />;
  };

  const fileCheckpoints = checkpoints.filter((cp) => cp.relativePath === selectedPath);

  return (
    <div className="flex flex-col h-full w-full bg-[#0D1117] text-[#F0F6FC] overflow-hidden">
      {/* Top Header Bar */}
      <div className="px-4 py-3 border-b border-[#30363D] bg-[#161B22] flex items-center justify-between gap-3 shrink-0 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <Folder className="w-4 h-4 text-[#C7FF65] shrink-0" />
            <h1 className="text-sm sm:text-base font-bold text-[#F0F6FC] truncate">
              {activeWs?.name || activeWorkspaceId}
            </h1>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#21262D] text-[#8B949E] border border-[#30363D] shrink-0">
              {activeWs?.projectType || 'project'}
            </span>
          </div>
          <span className="text-xs text-[#8B949E] hidden lg:inline font-mono truncate max-w-sm" title={activeWs?.path}>
            {activeWs?.path}
          </span>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => fetchFiles(selectedPath)}
            disabled={loading}
            className="p-1.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-xs text-[#8B949E] hover:text-[#F0F6FC] transition-colors cursor-pointer"
            title="Refresh Files"
            aria-label="Refresh Files"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => setShowNewFileModal(true)}
            className="px-2.5 py-1.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-xs text-[#C7FF65] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Create New File"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New File</span>
          </button>

          <button
            type="button"
            onClick={() => setShowNewFolderModal(true)}
            className="px-2.5 py-1.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-xs text-[#8B949E] hover:text-[#F0F6FC] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Create New Directory"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New Folder</span>
          </button>

          {onNavigateToTerminal && (
            <button
              type="button"
              onClick={() => onNavigateToTerminal()}
              className="p-1.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-xs text-[#8B949E] hover:text-[#C7FF65] transition-colors cursor-pointer"
              title="Open Terminal in this Workspace"
            >
              <Terminal className="w-3.5 h-3.5" />
            </button>
          )}

          {onNavigateToAgents && (
            <button
              type="button"
              onClick={() => onNavigateToAgents(selectedPath ? `Inspect file: ${selectedPath}` : undefined)}
              className="px-2.5 py-1.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] hover:border-[#C7FF65]/60 text-xs text-[#F0F6FC] hover:text-[#C7FF65] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Open in Agents Workstation"
              aria-label="Open in Agents Workstation"
            >
              <Layers className="w-3.5 h-3.5 text-[#C7FF65]" />
              <span className="hidden sm:inline">Agents</span>
            </button>
          )}

          {onNavigateToChat && (
            <button
              type="button"
              onClick={() => onNavigateToChat(selectedPath ? `Inspect file: ${selectedPath}` : undefined)}
              className="p-1.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-xs text-[#8B949E] hover:text-[#C7FF65] transition-colors cursor-pointer"
              title="Ask Chat about this workspace or file"
            >
              <MessageSquare className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Error / Toast Banner */}
      {error && (
        <div className="px-4 py-2 bg-[#DA3633]/20 border-b border-[#DA3633]/40 text-xs text-[#FF727A] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => setError(null)} className="text-[#FF727A] hover:text-white">
            Dismiss
          </button>
        </div>
      )}

      {saveToast && (
        <div className="px-4 py-2 bg-[#238636]/20 border-b border-[#238636]/40 text-xs text-[#3FB950] flex items-center gap-2">
          <Check className="w-3.5 h-3.5 shrink-0" />
          <span>{saveToast}</span>
        </div>
      )}

      {/* Mobile Sub-view Switcher */}
      <div className="md:hidden flex items-center border-b border-[#30363D] bg-[#161B22] p-1 gap-1">
        <button
          type="button"
          onClick={() => setMobileView('list')}
          className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
            mobileView === 'list'
              ? 'bg-[#21262D] text-[#C7FF65]'
              : 'text-[#8B949E] hover:text-[#F0F6FC]'
          }`}
        >
          Files List ({files.length})
        </button>
        <button
          type="button"
          onClick={() => setMobileView('editor')}
          className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${
            mobileView === 'editor'
              ? 'bg-[#21262D] text-[#C7FF65]'
              : 'text-[#8B949E] hover:text-[#F0F6FC]'
          }`}
        >
          Editor {isDirty && '•'}
        </button>
        {onNavigateToAgents && (
          <button
            type="button"
            onClick={() => onNavigateToAgents(selectedPath ? `Inspect file: ${selectedPath}` : undefined)}
            className="px-2.5 py-1.5 text-xs font-semibold rounded-md text-[#C7FF65] bg-[#21262D]/60 hover:bg-[#21262D] border border-[#C7FF65]/30 flex items-center gap-1 shrink-0"
            title="Open in Agents Workstation"
          >
            <Layers className="w-3 h-3 text-[#C7FF65]" />
            <span>Agents</span>
          </button>
        )}
      </div>

      {/* Main Body: Two Columns on Desktop, Single View on Mobile */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left Column: File Explorer Tree / List */}
        <div
          className={`w-full md:w-72 lg:w-80 border-r border-[#30363D] bg-[#0D1117] flex flex-col shrink-0 ${
            mobileView === 'editor' ? 'hidden md:flex' : 'flex'
          }`}
        >
          {/* File Search */}
          <div className="p-2.5 border-b border-[#30363D]">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#8B949E] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search files..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#161B22] border border-[#30363D] text-xs text-[#F0F6FC] placeholder-[#8B949E] focus:outline-none focus:border-[#C7FF65]"
              />
            </div>
          </div>

          {/* Files List Items */}
          <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-0.5">
            {filteredFiles.length === 0 ? (
              <div className="p-4 text-center text-xs text-[#8B949E]">
                {loading ? 'Loading workspace files...' : 'No files found in workspace.'}
              </div>
            ) : (
              filteredFiles.map((f) => {
                const isSelected = f.relativePath === selectedPath;
                return (
                  <div
                    key={f.relativePath}
                    className={`group flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#1C2128] text-[#F0F6FC] font-medium'
                        : 'text-[#8B949E] hover:text-[#F0F6FC] hover:bg-[#161B22]'
                    }`}
                    onClick={() => loadFileContent(f.relativePath)}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {getFileIcon(f.relativePath)}
                      <span className="truncate" title={f.relativePath}>
                        {f.relativePath}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[10px] text-[#8B949E] font-mono mr-1">
                        {formatBytes(f.sizeBytes)}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingPath(f.relativePath);
                          setRenameNewPath(f.relativePath);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[#30363D] text-[#8B949E] hover:text-[#F0F6FC]"
                        title="Rename"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(f.relativePath);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[#30363D] text-[#8B949E] hover:text-[#FF727A]"
                        title="Delete"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Code Editor & Viewer */}
        <div
          className={`flex-1 min-h-0 flex flex-col bg-[#090D13] ${
            mobileView === 'list' ? 'hidden md:flex' : 'flex'
          }`}
        >
          {selectedPath ? (
            <>
              {/* Editor Sub-Header */}
              <div className="px-4 py-2 border-b border-[#30363D] bg-[#161B22] flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-xs text-[#F0F6FC] font-semibold truncate">
                    {selectedPath}
                  </span>
                  {isDirty && (
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-[#D29922]/20 text-[#D29922] border border-[#D29922]/40">
                      Unsaved
                    </span>
                  )}
                  {fileCheckpoints.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDiff(fileCheckpoints[0]);
                        setShowDiffModal(true);
                      }}
                      className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#58A6FF]/20 text-[#58A6FF] border border-[#58A6FF]/40 flex items-center gap-1 hover:bg-[#58A6FF]/30 cursor-pointer"
                      title="View agent change diffs"
                    >
                      <FileDiff className="w-3 h-3" />
                      <span>{fileCheckpoints.length} Diffs</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || !isDirty}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                      isDirty
                        ? 'bg-[#C7FF65] text-[#0D1117] hover:bg-[#B8F558]'
                        : 'bg-[#21262D] text-[#8B949E] cursor-not-allowed opacity-60'
                    }`}
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{saving ? 'Saving...' : 'Save'}</span>
                  </button>

                  {onNavigateToAgents && (
                    <button
                      type="button"
                      onClick={() =>
                        onNavigateToAgents(
                          `Autonomous Agent Task for file \`${selectedPath}\` in workspace \`${activeWorkspaceId}\`:\n\n\`\`\`\n${editorContent.slice(
                            0,
                            3000
                          )}\n\`\`\`\nPlease inspect this file, identify any issues or opportunities for improvement, and generate concrete changes.`
                        )
                      }
                      className="px-2.5 py-1.5 rounded-lg bg-[#C7FF65]/10 hover:bg-[#C7FF65]/20 border border-[#C7FF65]/40 text-xs text-[#C7FF65] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                      title="Send file content to Autonomous Agent"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-[#C7FF65]" />
                      <span className="hidden sm:inline">Ask Agent</span>
                    </button>
                  )}

                  {onNavigateToChat && (
                    <button
                      type="button"
                      onClick={() =>
                        onNavigateToChat(
                          `Here is file \`${selectedPath}\` from workspace \`${activeWorkspaceId}\`:\n\n\`\`\`\n${editorContent.slice(
                            0,
                            2000
                          )}\n\`\`\`\nPlease inspect or refactor this code.`
                        )
                      }
                      className="px-2.5 py-1.5 rounded-lg bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-xs text-[#8B949E] hover:text-[#C7FF65] flex items-center gap-1 transition-colors cursor-pointer"
                      title="Send file content to Chat"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Ask Chat</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Editor Textarea with Line Numbers */}
              <div className="flex-1 min-h-0 flex relative font-mono text-xs overflow-hidden">
                {/* Line number gutter */}
                <div className="w-10 py-3 bg-[#0D1117] text-[#484F58] text-right pr-2 select-none shrink-0 border-r border-[#30363D]/40 font-mono text-[11px] leading-5">
                  {editorContent.split('\n').map((_, idx) => (
                    <div key={idx}>{idx + 1}</div>
                  ))}
                </div>

                {/* Main Code Textarea */}
                <textarea
                  value={editorContent}
                  onChange={(e) => setEditorContent(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                      e.preventDefault();
                      handleSave();
                    }
                  }}
                  className="flex-1 h-full w-full bg-[#090D13] text-[#F0F6FC] p-3 focus:outline-none resize-none leading-5 font-mono text-xs overflow-auto"
                  spellCheck={false}
                />
              </div>

              {/* Editor Footer Status */}
              <div className="px-4 py-1.5 border-t border-[#30363D]/60 bg-[#161B22] flex items-center justify-between text-[11px] text-[#8B949E] shrink-0 font-mono">
                <div>
                  <span>Lines: {editorContent.split('\n').length}</span>
                  <span className="mx-2">·</span>
                  <span>Characters: {editorContent.length}</span>
                </div>
                <div>
                  <span>UTF-8</span>
                  <span className="mx-2">·</span>
                  <span>{isDirty ? 'Unsaved edits' : 'Synced'}</span>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-[#8B949E]">
              <FileCode className="w-12 h-12 text-[#30363D] mb-3" />
              <p className="text-sm font-semibold text-[#F0F6FC]">No File Selected</p>
              <p className="text-xs text-[#8B949E] mt-1 max-w-sm">
                Pick a file from the explorer on the left or create a new file to start viewing and editing.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* New File Modal */}
      {showNewFileModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#161B22] border border-[#30363D] rounded-2xl w-full max-w-md p-5 space-y-4 shadow-xl">
            <h3 className="text-sm font-bold text-[#F0F6FC] flex items-center gap-2">
              <Plus className="w-4 h-4 text-[#C7FF65]" />
              <span>Create New File</span>
            </h3>
            <form onSubmit={handleCreateFile} className="space-y-3">
              <div>
                <label className="text-xs text-[#8B949E] block mb-1">
                  Relative File Path:
                </label>
                <input
                  type="text"
                  value={newFilePath}
                  onChange={(e) => setNewFilePath(e.target.value)}
                  placeholder="e.g. app/src/main/java/io/anvil/Main.kt"
                  autoFocus
                  className="w-full px-3 py-2 rounded-lg bg-[#0D1117] border border-[#30363D] text-xs text-[#F0F6FC] font-mono focus:border-[#C7FF65] outline-none"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewFileModal(false)}
                  className="px-3 py-1.5 rounded-lg text-xs text-[#8B949E] hover:text-[#F0F6FC]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newFilePath.trim()}
                  className="px-3 py-1.5 rounded-lg bg-[#C7FF65] text-[#0D1117] font-bold text-xs hover:bg-[#B8F558] disabled:opacity-50"
                >
                  Create File
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Folder Modal */}
      {showNewFolderModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#161B22] border border-[#30363D] rounded-2xl w-full max-w-md p-5 space-y-4 shadow-xl">
            <h3 className="text-sm font-bold text-[#F0F6FC] flex items-center gap-2">
              <FolderPlus className="w-4 h-4 text-[#C7FF65]" />
              <span>Create New Directory</span>
            </h3>
            <form onSubmit={handleCreateFolder} className="space-y-3">
              <div>
                <label className="text-xs text-[#8B949E] block mb-1">
                  Relative Directory Path:
                </label>
                <input
                  type="text"
                  value={newFolderPath}
                  onChange={(e) => setNewFolderPath(e.target.value)}
                  placeholder="e.g. app/src/main/res/values"
                  autoFocus
                  className="w-full px-3 py-2 rounded-lg bg-[#0D1117] border border-[#30363D] text-xs text-[#F0F6FC] font-mono focus:border-[#C7FF65] outline-none"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewFolderModal(false)}
                  className="px-3 py-1.5 rounded-lg text-xs text-[#8B949E] hover:text-[#F0F6FC]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newFolderPath.trim()}
                  className="px-3 py-1.5 rounded-lg bg-[#C7FF65] text-[#0D1117] font-bold text-xs hover:bg-[#B8F558] disabled:opacity-50"
                >
                  Create Directory
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename File Modal */}
      {renamingPath && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#161B22] border border-[#30363D] rounded-2xl w-full max-w-md p-5 space-y-4 shadow-xl">
            <h3 className="text-sm font-bold text-[#F0F6FC] flex items-center gap-2">
              <Edit2 className="w-4 h-4 text-[#C7FF65]" />
              <span>Rename File</span>
            </h3>
            <form onSubmit={handleRename} className="space-y-3">
              <div>
                <label className="text-xs text-[#8B949E] block mb-1">
                  New Relative Path:
                </label>
                <input
                  type="text"
                  value={renameNewPath}
                  onChange={(e) => setRenameNewPath(e.target.value)}
                  autoFocus
                  className="w-full px-3 py-2 rounded-lg bg-[#0D1117] border border-[#30363D] text-xs text-[#F0F6FC] font-mono focus:border-[#C7FF65] outline-none"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRenamingPath(null)}
                  className="px-3 py-1.5 rounded-lg text-xs text-[#8B949E] hover:text-[#F0F6FC]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!renameNewPath.trim() || renameNewPath === renamingPath}
                  className="px-3 py-1.5 rounded-lg bg-[#C7FF65] text-[#0D1117] font-bold text-xs hover:bg-[#B8F558] disabled:opacity-50"
                >
                  Apply Rename
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Diff Checkpoint Modal */}
      {showDiffModal && selectedDiff && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#161B22] border border-[#30363D] rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col p-5 space-y-3 shadow-xl">
            <div className="flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <FileDiff className="w-4 h-4 text-[#58A6FF]" />
                <span className="text-xs font-bold text-[#F0F6FC]">
                  Unified Diff Checkpoint: {selectedDiff.relativePath}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowDiffModal(false)}
                className="text-xs text-[#8B949E] hover:text-[#F0F6FC]"
              >
                Close
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto bg-[#090D13] p-3 rounded-xl font-mono text-xs space-y-0.5 border border-[#30363D]">
              {selectedDiff.lines?.map((l, idx) => {
                let colorClass = 'text-[#8B949E]';
                if (l.type === '+') colorClass = 'text-[#3FB950] bg-[#238636]/10';
                else if (l.type === '-') colorClass = 'text-[#FF727A] bg-[#DA3633]/10';
                return (
                  <div key={idx} className={`${colorClass} px-1.5 py-0.5 rounded whitespace-pre`}>
                    {l.type === '+' ? '+ ' : l.type === '-' ? '- ' : '  '}
                    {l.content}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
