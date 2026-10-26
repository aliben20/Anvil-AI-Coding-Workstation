import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Sparkles,
  Search,
  Plus,
  RefreshCw,
  FolderGit2,
  Globe,
  Hammer,
  Code2,
  Bug,
  Shield,
  CheckCircle2,
  Layout,
  Layers,
  Check,
  X,
  FileCode,
  Copy,
  ExternalLink,
  Trash2,
  AlertCircle,
  AlertTriangle,
  FileText,
  Wrench,
  Tag,
  ArrowRight,
  UploadCloud,
  FolderOpen,
  RotateCw,
  Terminal,
} from 'lucide-react';
import {
  SkillSummary,
  SkillDefinition,
  SkillCategory,
  SkillScope,
} from '../types';

interface SkillsTabProps {
  activeWorkspaceId?: string;
  onSelectSkillForPrompt?: (skillId: string) => void;
}

const CATEGORY_ICONS: Record<SkillCategory, React.ComponentType<{ className?: string }>> = {
  build: Hammer,
  code: Code2,
  debug: Bug,
  security: Shield,
  testing: CheckCircle2,
  ui: Layout,
  general: Layers,
};

const CATEGORY_COLORS: Record<SkillCategory, string> = {
  build: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  code: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
  debug: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
  security: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  testing: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  ui: 'text-pink-400 bg-pink-500/10 border-pink-500/20',
  general: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20',
};

export const SkillsTab: React.FC<SkillsTabProps> = ({
  activeWorkspaceId,
  onSelectSkillForPrompt,
}) => {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedScope, setSelectedScope] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  // Inspection drawer state
  const [inspectedSkillId, setInspectedSkillId] = useState<string | null>(null);
  const [inspectedSkill, setInspectedSkill] = useState<SkillDefinition | null>(null);
  const [loadingInspected, setLoadingInspected] = useState(false);
  const [copiedInstructions, setCopiedInstructions] = useState(false);

  // Create Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    id: '',
    name: '',
    description: '',
    category: 'general' as SkillCategory,
    scope: 'global' as SkillScope,
    tools: '',
    keywords: '',
    prerequisites: '',
    instructions: '',
  });
  const [createError, setCreateError] = useState<string | null>(null);
  const [submittingCreate, setSubmittingCreate] = useState(false);

  // Import Modal state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importMode, setImportMode] = useState<'markdown' | 'directory'>('markdown');
  const [importMarkdown, setImportMarkdown] = useState('');
  const [importDirectoryPath, setImportDirectoryPath] = useState('');
  const [importScope, setImportScope] = useState<SkillScope>('global');
  const [importError, setImportError] = useState<string | null>(null);
  const [submittingImport, setSubmittingImport] = useState(false);

  // ---------------------------------------------------------------------------
  // Load Skills
  // ---------------------------------------------------------------------------
  const fetchSkills = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const url = activeWorkspaceId
        ? `/api/skills?workspaceId=${encodeURIComponent(activeWorkspaceId)}`
        : '/api/skills';
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch skills.`);
      const data = await res.json();
      setSkills(data.skills || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  // Live real-time synchronization via SSE stream
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/agent/events/stream');
      es.addEventListener('skills_updated', () => {
        fetchSkills();
        if (inspectedSkillId) {
          loadSkillDetails(inspectedSkillId);
        }
      });
    } catch {}
    return () => {
      es?.close();
    };
  }, [fetchSkills, inspectedSkillId]);

  const [rescanning, setRescanning] = useState(false);
  const [reloadingSkill, setReloadingSkill] = useState(false);

  const handleRescanSkills = async () => {
    try {
      setRescanning(true);
      const url = activeWorkspaceId
        ? `/api/skills/rescan?workspaceId=${encodeURIComponent(activeWorkspaceId)}`
        : '/api/skills/rescan';
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) throw new Error('Rescan request failed');
      await fetchSkills();
    } catch (err) {
      console.error('Failed to rescan skills:', err);
    } finally {
      setRescanning(false);
    }
  };

  const handleReloadSkill = async (skillId: string) => {
    try {
      setReloadingSkill(true);
      const url = activeWorkspaceId
        ? `/api/skills/${encodeURIComponent(skillId)}/reload?workspaceId=${encodeURIComponent(activeWorkspaceId)}`
        : `/api/skills/${encodeURIComponent(skillId)}/reload`;
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) throw new Error('Reload request failed');
      const data = await res.json();
      if (data.skill) {
        setInspectedSkill(data.skill);
      }
      await fetchSkills();
    } catch (err) {
      console.error('Failed to reload skill:', err);
    } finally {
      setReloadingSkill(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Load Full Skill Details for Inspection
  // ---------------------------------------------------------------------------
  const loadSkillDetails = useCallback(
    async (skillId: string) => {
      try {
        setLoadingInspected(true);
        setInspectedSkillId(skillId);
        const url = activeWorkspaceId
          ? `/api/skills/${encodeURIComponent(skillId)}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`
          : `/api/skills/${encodeURIComponent(skillId)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}: Could not load skill details.`);
        const data = await res.json();
        setInspectedSkill(data.skill || null);
      } catch (err) {
        console.error('Failed to load skill details:', err);
      } finally {
        setLoadingInspected(false);
      }
    },
    [activeWorkspaceId]
  );

  // ---------------------------------------------------------------------------
  // Toggle Skill
  // ---------------------------------------------------------------------------
  const handleToggleSkill = async (skillId: string, currentEnabled: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(skillId)}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !currentEnabled }),
      });
      if (!res.ok) throw new Error('Toggle request failed');
      const data = await res.json();

      setSkills((prev) =>
        prev.map((s) => (s.id === skillId ? { ...s, enabled: data.enabled } : s))
      );
      if (inspectedSkill?.id === skillId) {
        setInspectedSkill((prev) => (prev ? { ...prev, enabled: data.enabled } : null));
      }
    } catch (err) {
      console.error('Failed to toggle skill:', err);
    }
  };

  // ---------------------------------------------------------------------------
  // Delete Skill
  // ---------------------------------------------------------------------------
  const handleDeleteSkill = async (skillId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Are you sure you want to remove skill "${skillId}"?`)) return;

    try {
      const url = activeWorkspaceId
        ? `/api/skills/${encodeURIComponent(skillId)}?workspaceId=${encodeURIComponent(activeWorkspaceId)}`
        : `/api/skills/${encodeURIComponent(skillId)}`;
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete request failed');

      setSkills((prev) => prev.filter((s) => s.id !== skillId));
      if (inspectedSkillId === skillId) {
        setInspectedSkillId(null);
        setInspectedSkill(null);
      }
    } catch (err) {
      alert(`Error deleting skill: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // ---------------------------------------------------------------------------
  // Create Skill
  // ---------------------------------------------------------------------------
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setSubmittingCreate(true);

    try {
      const tools = createForm.tools
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const keywords = createForm.keywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
      const prerequisites = createForm.prerequisites
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);

      const res = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: createForm.id || createForm.name,
          name: createForm.name,
          description: createForm.description,
          category: createForm.category,
          scope: createForm.scope,
          workspaceId: createForm.scope === 'workspace' ? activeWorkspaceId : undefined,
          requiredTools: tools,
          keywords,
          prerequisites,
          instructions: createForm.instructions,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create skill');

      setShowCreateModal(false);
      setCreateForm({
        id: '',
        name: '',
        description: '',
        category: 'general',
        scope: 'global',
        tools: '',
        keywords: '',
        prerequisites: '',
        instructions: '',
      });
      await fetchSkills();
      if (data.skill?.id) {
        loadSkillDetails(data.skill.id);
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmittingCreate(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Import Skill
  // ---------------------------------------------------------------------------
  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setImportError(null);
    setSubmittingImport(true);

    try {
      const payload: Record<string, unknown> = {
        scope: importScope,
        workspaceId: importScope === 'workspace' ? activeWorkspaceId : undefined,
      };

      if (importMode === 'markdown') {
        if (!importMarkdown.trim()) throw new Error('Markdown content is required');
        payload.markdown = importMarkdown;
      } else {
        if (!importDirectoryPath.trim()) throw new Error('Directory path is required');
        payload.directoryPath = importDirectoryPath;
      }

      const res = await fetch('/api/skills/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to import skill');

      setShowImportModal(false);
      setImportMarkdown('');
      setImportDirectoryPath('');
      await fetchSkills();
      if (data.skill?.id) {
        loadSkillDetails(data.skill.id);
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmittingImport(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Copy Instructions
  // ---------------------------------------------------------------------------
  const handleCopyInstructions = (instructions: string) => {
    navigator.clipboard.writeText(instructions);
    setCopiedInstructions(true);
    setTimeout(() => setCopiedInstructions(false), 2000);
  };

  // ---------------------------------------------------------------------------
  // Filtered Skills Calculation
  // ---------------------------------------------------------------------------
  const normalizedSkills = useMemo(() => {
    return (skills || []).map((s) => ({
      ...s,
      id: s.id || 'unknown-skill',
      name: s.name || s.id || 'Unnamed Skill',
      description: s.description || 'No description provided.',
      category: (s.category || 'general').toLowerCase() as SkillCategory,
      scope: (s.scope || 'global') as SkillScope,
      enabled: !!s.enabled,
      requiredTools: Array.isArray(s.requiredTools)
        ? s.requiredTools
        : Array.isArray((s as any).tools)
        ? (s as any).tools
        : [],
      keywords: Array.isArray(s.keywords)
        ? s.keywords
        : Array.isArray((s as any).tags)
        ? (s as any).tags
        : [],
      validationStatus: s.validationStatus || 'valid',
      canonicalPath: s.canonicalPath || s.path || '',
      path: s.path || s.canonicalPath || '',
    }));
  }, [skills]);

  const filteredSkills = useMemo(() => {
    return normalizedSkills.filter((s) => {
      // Scope filter
      if (selectedScope !== 'all' && s.scope !== selectedScope) return false;

      // Category filter
      if (selectedCategory !== 'all' && s.category !== selectedCategory) return false;

      // Status filter
      if (selectedStatus === 'enabled' && !s.enabled) return false;
      if (selectedStatus === 'disabled' && s.enabled) return false;
      if (
        selectedStatus === 'attention' &&
        (!s.validationStatus || s.validationStatus === 'valid')
      ) {
        return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = (s.name || '').toLowerCase().includes(q);
        const matchesDesc = (s.description || '').toLowerCase().includes(q);
        const matchesId = (s.id || '').toLowerCase().includes(q);
        const matchesTools = (s.requiredTools || []).some((t: string) => (t || '').toLowerCase().includes(q));
        const matchesKeywords = (s.keywords || []).some((k: string) => (k || '').toLowerCase().includes(q));
        const matchesPath = ((s.canonicalPath || s.path || '') as string).toLowerCase().includes(q);
        if (!matchesName && !matchesDesc && !matchesId && !matchesTools && !matchesKeywords && !matchesPath) {
          return false;
        }
      }

      return true;
    });
  }, [normalizedSkills, selectedScope, selectedCategory, selectedStatus, searchQuery]);

  // Statistics counts
  const totalCount = normalizedSkills.length;
  const enabledCount = normalizedSkills.filter((s) => s.enabled).length;
  const invalidCount = normalizedSkills.filter(
    (s) => s.validationStatus && s.validationStatus !== 'valid'
  ).length;
  const globalCount = normalizedSkills.filter((s) => s.scope === 'global').length;
  const workspaceCount = normalizedSkills.filter((s) => s.scope === 'workspace').length;

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0D1117] text-[#C9D1D9] overflow-hidden">
      {/* =====================================================================
          TOP HEADER
          ===================================================================== */}
      <div className="px-5 py-4 border-b border-[#30363D] bg-[#161B22] flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[#C7FF65]/10 border border-[#C7FF65]/20 flex items-center justify-center text-[#C7FF65]">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold text-white tracking-tight">Skills Library</h1>
              <span className="text-xs px-2 py-0.5 rounded-full bg-[#21262D] border border-[#30363D] text-[#8B949E] font-mono">
                {enabledCount}/{totalCount} Active
              </span>
            </div>
            <p className="text-xs text-[#8B949E] mt-0.5">
              Standardized <code className="text-[#C7FF65]">SKILL.md</code> playbooks selectively
              matched and injected into agent turns.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleRescanSkills}
            disabled={rescanning}
            title="Rescan skill directories across workspace and global paths"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-[#21262D] hover:bg-[#30363D] text-[#C9D1D9] border border-[#30363D] transition-colors"
          >
            <RotateCw className={`w-3.5 h-3.5 text-[#C7FF65] ${rescanning ? 'animate-spin' : ''}`} />
            <span>{rescanning ? 'Rescanning...' : 'Rescan'}</span>
          </button>
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-[#21262D] hover:bg-[#30363D] text-[#C9D1D9] border border-[#30363D] transition-colors"
          >
            <UploadCloud className="w-3.5 h-3.5 text-[#8B949E]" />
            <span>Import</span>
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-[#C7FF65] hover:bg-[#b8f553] text-[#0D1117] font-semibold transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Skill</span>
          </button>
          <button
            onClick={fetchSkills}
            title="Refresh skills"
            className="p-1.5 text-[#8B949E] hover:text-white rounded-md hover:bg-[#21262D] border border-transparent hover:border-[#30363D] transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* =====================================================================
          FILTER & STATS BAR
          ===================================================================== */}
      <div className="px-5 py-3 border-b border-[#30363D] bg-[#0D1117] flex flex-wrap items-center justify-between gap-3 shrink-0">
        {/* Search */}
        <div className="relative min-w-[220px] max-w-sm flex-1">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#8B949E]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search skills, tools, keywords..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#161B22] border border-[#30363D] rounded-md text-white placeholder-[#6E7681] focus:outline-none focus:border-[#C7FF65]/50 focus:ring-1 focus:ring-[#C7FF65]/30 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8B949E] hover:text-white"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Scope Filter */}
          <div className="flex rounded-md bg-[#161B22] border border-[#30363D] p-0.5">
            {[
              { id: 'all', label: 'All Scopes' },
              { id: 'global', label: 'Global', icon: Globe },
              { id: 'workspace', label: 'Workspace', icon: FolderGit2 },
            ].map((sc) => (
              <button
                key={sc.id}
                onClick={() => setSelectedScope(sc.id)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors flex items-center gap-1.5 ${
                  selectedScope === sc.id
                    ? 'bg-[#30363D] text-white shadow-xs'
                    : 'text-[#8B949E] hover:text-[#C9D1D9]'
                }`}
              >
                {sc.icon && <sc.icon className="w-3 h-3" />}
                {sc.label}
              </button>
            ))}
          </div>

          {/* Status Filter */}
          <div className="flex rounded-md bg-[#161B22] border border-[#30363D] p-0.5">
            {[
              { id: 'all', label: 'All' },
              { id: 'enabled', label: 'Enabled' },
              { id: 'disabled', label: 'Disabled' },
              {
                id: 'attention',
                label: invalidCount > 0 ? `Attention (${invalidCount})` : 'Attention',
              },
            ].map((st) => (
              <button
                key={st.id}
                onClick={() => setSelectedStatus(st.id)}
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors flex items-center gap-1 ${
                  selectedStatus === st.id
                    ? 'bg-[#30363D] text-white shadow-xs'
                    : 'text-[#8B949E] hover:text-[#C9D1D9]'
                }`}
              >
                <span>{st.label}</span>
                {st.id === 'attention' && invalidCount > 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                )}
              </button>
            ))}
          </div>

          {/* Category Dropdown */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-2.5 py-1 text-[11px] bg-[#161B22] border border-[#30363D] rounded-md text-[#C9D1D9] focus:outline-none focus:border-[#C7FF65]/50"
          >
            <option value="all">All Categories</option>
            <option value="build">Build</option>
            <option value="code">Code</option>
            <option value="debug">Debug</option>
            <option value="security">Security</option>
            <option value="testing">Testing</option>
            <option value="ui">UI & Design</option>
            <option value="general">General</option>
          </select>
        </div>
      </div>

      {/* =====================================================================
          MAIN BODY: SKILLS GRID + INSPECTION DRAWER
          ===================================================================== */}
      <div className="flex-1 flex overflow-hidden">
        {/* Skills Grid */}
        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {/* Terminal Integration & Watcher Status Banner */}
          <div className="mb-4 p-3 rounded-xl bg-[#161B22] border border-[#30363D] flex flex-wrap items-center justify-between gap-3 text-xs text-[#8B949E]">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-md bg-[#C7FF65]/10 border border-[#C7FF65]/20 flex items-center justify-center text-[#C7FF65] shrink-0">
                <Terminal className="w-3.5 h-3.5" />
              </div>
              <div>
                <span className="text-white font-medium">Live Terminal Discovery:</span>{' '}
                Skills installed via CLI in <code className="text-[#C7FF65]">.agents/skills/</code>, <code className="text-[#C7FF65]">.skills/</code>, or global <code className="text-[#C7FF65]">~/.agents/skills/</code> are synced automatically via real-time watchers.
              </div>
            </div>
            <button
              onClick={handleRescanSkills}
              disabled={rescanning}
              className="px-2.5 py-1 text-[11px] font-medium rounded bg-[#21262D] hover:bg-[#30363D] text-[#C9D1D9] border border-[#30363D] flex items-center gap-1 shrink-0 transition-colors"
            >
              <RotateCw className={`w-3 h-3 text-[#C7FF65] ${rescanning ? 'animate-spin' : ''}`} />
              <span>{rescanning ? 'Scanning...' : 'Rescan Disk'}</span>
            </button>
          </div>

          {filteredSkills.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-center p-6 border border-dashed border-[#30363D] rounded-xl bg-[#161B22]/40">
              <Sparkles className="w-8 h-8 text-[#6E7681] mb-2" />
              <h3 className="text-sm font-medium text-white mb-1">No matching skills found</h3>
              <p className="text-xs text-[#8B949E] max-w-sm">
                Try adjusting your search query, scope, or category filters. You can also create or
                import a new skill playbook.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {filteredSkills.map((skill) => {
                const CatIcon = CATEGORY_ICONS[skill.category] || Layers;
                const catClass = CATEGORY_COLORS[skill.category] || CATEGORY_COLORS.general;
                const isSelected = inspectedSkillId === skill.id;

                return (
                  <div
                    key={skill.id}
                    onClick={() => loadSkillDetails(skill.id)}
                    className={`group flex flex-col justify-between p-4 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#161B22] border-[#C7FF65]/50 ring-1 ring-[#C7FF65]/30'
                        : 'bg-[#161B22]/80 hover:bg-[#161B22] border-[#30363D] hover:border-[#8B949E]/40'
                    }`}
                  >
                    <div>
                      {/* Top Meta Row */}
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border ${catClass}`}
                          >
                            <CatIcon className="w-3 h-3" />
                            {(skill.category || 'general').toUpperCase()}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                              skill.scope === 'workspace'
                                ? 'text-amber-300 bg-amber-500/10 border-amber-500/20'
                                : 'text-zinc-400 bg-zinc-800 border-zinc-700'
                            }`}
                          >
                            {skill.scope === 'workspace' ? (
                              <FolderGit2 className="w-2.5 h-2.5" />
                            ) : (
                              <Globe className="w-2.5 h-2.5" />
                            )}
                            {skill.scope}
                          </span>
                          {skill.version && (
                            <span className="text-[10px] text-[#8B949E] font-mono">
                              v{skill.version}
                            </span>
                          )}
                          {skill.validationStatus && skill.validationStatus !== 'valid' && (
                            <span
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                                skill.validationStatus === 'missing'
                                ? 'text-amber-300 bg-amber-500/10 border-amber-500/20'
                                : 'text-rose-300 bg-rose-500/10 border-rose-500/20'
                              }`}
                            >
                              <AlertTriangle className="w-2.5 h-2.5" />
                              {skill.validationStatus === 'missing'
                                ? 'Missing SKILL.md'
                                : skill.validationStatus === 'invalid'
                                ? 'Invalid Spec'
                                : 'Load Error'}
                            </span>
                          )}
                        </div>

                        {/* Enable/Disable Toggle */}
                        <button
                          type="button"
                          onClick={(e) => handleToggleSkill(skill.id, skill.enabled, e)}
                          title={skill.enabled ? 'Disable Skill' : 'Enable Skill'}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            skill.enabled ? 'bg-[#C7FF65]' : 'bg-[#30363D]'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-[#0D1117] shadow-lg ring-0 transition duration-200 ease-in-out ${
                              skill.enabled ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>

                      {/* Title & Description */}
                      <h3 className="text-sm font-semibold text-white tracking-tight mb-1 group-hover:text-[#C7FF65] transition-colors">
                        {skill.name}
                      </h3>
                      <p className="text-xs text-[#8B949E] line-clamp-2 leading-relaxed mb-3">
                        {skill.description}
                      </p>

                      {/* Validation Error Banner */}
                      {skill.validationError && (
                        <div className="mb-2.5 p-2 rounded bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[11px] flex items-start gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                          <span className="leading-snug">{skill.validationError}</span>
                        </div>
                      )}

                      {/* Tools badges */}
                      {(skill.requiredTools || []).length > 0 && (
                        <div className="mb-2.5">
                          <div className="text-[10px] text-[#6E7681] font-mono mb-1 flex items-center gap-1">
                            <Wrench className="w-2.5 h-2.5" />
                            DECLARED TOOLS
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {(skill.requiredTools || []).slice(0, 3).map((tool: string) => (
                              <span
                                key={tool}
                                className="px-1.5 py-0.5 rounded bg-[#0D1117] border border-[#30363D] text-[10px] font-mono text-[#C9D1D9]"
                              >
                                {tool}
                              </span>
                            ))}
                            {(skill.requiredTools || []).length > 3 && (
                              <span className="px-1 py-0.5 text-[10px] font-mono text-[#8B949E]">
                                +{(skill.requiredTools || []).length - 3}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Footer Actions */}
                    <div className="pt-2.5 border-t border-[#30363D]/60 flex items-center justify-between text-xs text-[#8B949E] gap-2">
                      <div className="flex items-center gap-1.5 truncate max-w-[190px]">
                        <FolderOpen className="w-3 h-3 shrink-0 text-[#6E7681]" />
                        <span
                          className="text-[10px] font-mono text-[#6E7681] truncate"
                          title={skill.canonicalPath || skill.path || ''}
                        >
                          {skill.canonicalPath
                            ? String(skill.canonicalPath).split(/[/\\]/).slice(-3).join('/')
                            : skill.path || 'built-in'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {skill.source !== 'built-in' && (
                          <button
                            type="button"
                            onClick={(e) => handleDeleteSkill(skill.id, e)}
                            title="Delete custom skill"
                            className="p-1 hover:text-rose-400 text-[#8B949E] rounded transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <span className="text-[#C7FF65] text-xs font-medium flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
                          Inspect <ArrowRight className="w-3 h-3" />
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ===================================================================
            INSPECTION SIDE DRAWER
            =================================================================== */}
        {inspectedSkillId && (
          <div className="w-96 border-l border-[#30363D] bg-[#161B22] flex flex-col shrink-0 h-full overflow-hidden">
            {/* Drawer Header */}
            <div className="px-4 py-3.5 border-b border-[#30363D] flex items-center justify-between gap-2 bg-[#0D1117]">
              <div className="flex items-center gap-2 truncate">
                <FileCode className="w-4 h-4 text-[#C7FF65] shrink-0" />
                <span className="text-xs font-semibold text-white truncate">
                  {inspectedSkill?.name || inspectedSkillId}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {inspectedSkill && (
                  <button
                    onClick={() => handleReloadSkill(inspectedSkill.id)}
                    disabled={reloadingSkill}
                    title="Reload from disk"
                    className="p-1 text-[#8B949E] hover:text-[#C7FF65] rounded hover:bg-[#21262D] transition-colors"
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${reloadingSkill ? 'animate-spin' : ''}`} />
                  </button>
                )}
                <button
                  onClick={() => {
                    setInspectedSkillId(null);
                    setInspectedSkill(null);
                  }}
                  className="text-[#8B949E] hover:text-white p-1 rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Drawer Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {loadingInspected ? (
                <div className="h-48 flex items-center justify-center text-xs text-[#8B949E]">
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                  Loading instructions...
                </div>
              ) : inspectedSkill ? (
                <>
                  {/* Status & Scope Pill */}
                  <div className="p-2.5 rounded-lg bg-[#0D1117] border border-[#30363D] space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            inspectedSkill.enabled ? 'bg-[#C7FF65]' : 'bg-[#6E7681]'
                          }`}
                        />
                        <span className="text-xs font-medium text-white">
                          {inspectedSkill.enabled ? 'Skill Enabled' : 'Skill Disabled'}
                        </span>
                      </div>
                      <button
                        onClick={(e) =>
                          handleToggleSkill(inspectedSkill.id, inspectedSkill.enabled, e)
                        }
                        className={`px-2 py-1 text-[11px] font-semibold rounded transition-colors ${
                          inspectedSkill.enabled
                            ? 'bg-[#30363D] hover:bg-[#3d444d] text-white'
                            : 'bg-[#C7FF65] hover:bg-[#b8f553] text-[#0D1117]'
                        }`}
                      >
                        {inspectedSkill.enabled ? 'Disable' : 'Enable'}
                      </button>
                    </div>

                    {/* Spec Validation Badge */}
                    <div className="pt-2 border-t border-[#21262D] flex items-center justify-between text-[11px]">
                      <span className="text-[#8B949E] font-mono">SPEC STATUS</span>
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                          !inspectedSkill.validationStatus || inspectedSkill.validationStatus === 'valid'
                            ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                            : inspectedSkill.validationStatus === 'missing'
                            ? 'text-amber-300 bg-amber-500/10 border-amber-500/20'
                            : 'text-rose-300 bg-rose-500/10 border-rose-500/20'
                        }`}
                      >
                        {!inspectedSkill.validationStatus || inspectedSkill.validationStatus === 'valid' ? (
                          <>
                            <Check className="w-2.5 h-2.5" /> Valid Specification
                          </>
                        ) : (
                          <>
                            <AlertTriangle className="w-2.5 h-2.5" />
                            {inspectedSkill.validationStatus === 'missing'
                              ? 'Missing SKILL.md'
                              : inspectedSkill.validationStatus === 'invalid'
                              ? 'Invalid Spec'
                              : 'Load Error'}
                          </>
                        )}
                      </span>
                    </div>

                    {inspectedSkill.validationError && (
                      <div className="p-2 rounded bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[11px] flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                        <span className="leading-snug">{inspectedSkill.validationError}</span>
                      </div>
                    )}
                  </div>

                  {/* Metadata Card */}
                  <div className="space-y-2 text-xs">
                    <div>
                      <div className="text-[10px] font-mono text-[#8B949E] uppercase mb-0.5">
                        Skill ID
                      </div>
                      <div className="font-mono text-white text-[11px] bg-[#0D1117] p-1.5 rounded border border-[#30363D]">
                        {inspectedSkill.id}
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] font-mono text-[#8B949E] uppercase mb-0.5">
                        Description
                      </div>
                      <div className="text-[#C9D1D9] text-xs leading-relaxed bg-[#0D1117] p-2 rounded border border-[#30363D]">
                        {inspectedSkill.description}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="text-[10px] font-mono text-[#8B949E] uppercase mb-0.5">
                          Scope
                        </div>
                        <div className="text-xs font-mono text-white bg-[#0D1117] p-1.5 rounded border border-[#30363D] capitalize">
                          {inspectedSkill.scope}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-mono text-[#8B949E] uppercase mb-0.5">
                          Category
                        </div>
                        <div className="text-xs font-mono text-white bg-[#0D1117] p-1.5 rounded border border-[#30363D] capitalize">
                          {inspectedSkill.category}
                        </div>
                      </div>
                    </div>

                    {inspectedSkill.author && (
                      <div>
                        <div className="text-[10px] font-mono text-[#8B949E] uppercase mb-0.5">
                          Author
                        </div>
                        <div className="text-xs text-white bg-[#0D1117] p-1.5 rounded border border-[#30363D]">
                          {inspectedSkill.author}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Prerequisites */}
                  {inspectedSkill.prerequisites && inspectedSkill.prerequisites.length > 0 && (
                    <div>
                      <div className="text-[10px] font-mono text-[#8B949E] uppercase mb-1">
                        Prerequisites
                      </div>
                      <div className="space-y-1">
                        {inspectedSkill.prerequisites.map((p, idx) => (
                          <div
                            key={idx}
                            className="flex items-start gap-1.5 text-xs text-[#C9D1D9] bg-[#0D1117] p-1.5 rounded border border-[#30363D]"
                          >
                            <Check className="w-3.5 h-3.5 text-[#C7FF65] shrink-0 mt-0.5" />
                            <span>{p}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Declared Tools */}
                  {(inspectedSkill.requiredTools || (inspectedSkill as any).tools || []).length > 0 && (
                    <div>
                      <div className="text-[10px] font-mono text-[#8B949E] uppercase mb-1">
                        Declared Tool Requirements
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {(inspectedSkill.requiredTools || (inspectedSkill as any).tools || []).map((t: string) => (
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

                  {/* Keywords */}
                  {inspectedSkill.keywords && inspectedSkill.keywords.length > 0 && (
                    <div>
                      <div className="text-[10px] font-mono text-[#8B949E] uppercase mb-1">
                        Trigger Keywords
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {inspectedSkill.keywords.map((k) => (
                          <span
                            key={k}
                            className="px-1.5 py-0.5 rounded bg-[#0D1117] border border-[#30363D] text-[10px] font-mono text-[#8B949E]"
                          >
                            #{k}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Full Instructions */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[10px] font-mono text-[#8B949E] uppercase">
                        Playbook Instructions
                      </div>
                      <button
                        onClick={() => handleCopyInstructions(inspectedSkill.instructions)}
                        className="text-[10px] text-[#C7FF65] hover:underline flex items-center gap-1"
                      >
                        {copiedInstructions ? (
                          <>
                            <Check className="w-3 h-3" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" /> Copy Markdown
                          </>
                        )}
                      </button>
                    </div>
                    <pre className="text-[11px] font-mono text-[#C9D1D9] bg-[#0D1117] p-3 rounded-lg border border-[#30363D] overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-72">
                      {inspectedSkill.instructions}
                    </pre>
                  </div>

                  {/* Canonical Path & Location */}
                  <div className="space-y-1.5 pt-2 border-t border-[#30363D]/60 text-[10px] font-mono">
                    <div className="flex items-center justify-between text-[#8B949E]">
                      <span>CANONICAL STORAGE PATH</span>
                      <button
                        onClick={() => {
                          const target = inspectedSkill.canonicalPath || inspectedSkill.path;
                          if (target) navigator.clipboard.writeText(target);
                        }}
                        className="text-[#C7FF65] hover:underline flex items-center gap-1"
                      >
                        <Copy className="w-2.5 h-2.5" /> Copy Path
                      </button>
                    </div>
                    <div className="text-[#8B949E] bg-[#0D1117] p-2 rounded border border-[#30363D] break-all select-all">
                      {inspectedSkill.canonicalPath || inspectedSkill.path}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* =====================================================================
          MODAL: CREATE NEW SKILL
          ===================================================================== */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-[#161B22] border border-[#30363D] rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-4 border-b border-[#30363D] flex items-center justify-between bg-[#0D1117]">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#C7FF65]" />
                <h2 className="text-sm font-semibold text-white">Create Agent Skill</h2>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-[#8B949E] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
              {createError && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
                  {createError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#C9D1D9] mb-1">
                    Skill ID <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. android-ci-auditor"
                    value={createForm.id}
                    onChange={(e) => setCreateForm({ ...createForm, id: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-[#0D1117] border border-[#30363D] rounded-md text-white font-mono placeholder-[#6E7681] focus:outline-none focus:border-[#C7FF65]/50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#C9D1D9] mb-1">
                    Skill Name <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Android CI Auditor"
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                    className="w-full px-3 py-1.5 text-xs bg-[#0D1117] border border-[#30363D] rounded-md text-white placeholder-[#6E7681] focus:outline-none focus:border-[#C7FF65]/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#C9D1D9] mb-1">
                  Description <span className="text-rose-400">*</span>
                </label>
                <textarea
                  required
                  rows={2}
                  placeholder="Concise overview of domain capability..."
                  value={createForm.description}
                  onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-[#0D1117] border border-[#30363D] rounded-md text-white placeholder-[#6E7681] focus:outline-none focus:border-[#C7FF65]/50"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#C9D1D9] mb-1">Category</label>
                  <select
                    value={createForm.category}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, category: e.target.value as SkillCategory })
                    }
                    className="w-full px-3 py-1.5 text-xs bg-[#0D1117] border border-[#30363D] rounded-md text-white focus:outline-none focus:border-[#C7FF65]/50"
                  >
                    <option value="build">Build</option>
                    <option value="code">Code</option>
                    <option value="debug">Debug</option>
                    <option value="security">Security</option>
                    <option value="testing">Testing</option>
                    <option value="ui">UI</option>
                    <option value="general">General</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#C9D1D9] mb-1">Scope</label>
                  <select
                    value={createForm.scope}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, scope: e.target.value as SkillScope })
                    }
                    className="w-full px-3 py-1.5 text-xs bg-[#0D1117] border border-[#30363D] rounded-md text-white focus:outline-none focus:border-[#C7FF65]/50"
                  >
                    <option value="global">Global (All Workspaces)</option>
                    <option value="workspace">Workspace Specific</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#C9D1D9] mb-1">
                  Declared Tools (comma-separated)
                </label>
                <input
                  type="text"
                  placeholder="e.g. build_apk, verify_apk, read_file"
                  value={createForm.tools}
                  onChange={(e) => setCreateForm({ ...createForm, tools: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-[#0D1117] border border-[#30363D] rounded-md text-white font-mono placeholder-[#6E7681] focus:outline-none focus:border-[#C7FF65]/50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#C9D1D9] mb-1">
                  Trigger Keywords (comma-separated)
                </label>
                <input
                  type="text"
                  placeholder="e.g. apk, audit, security, gradle"
                  value={createForm.keywords}
                  onChange={(e) => setCreateForm({ ...createForm, keywords: e.target.value })}
                  className="w-full px-3 py-1.5 text-xs bg-[#0D1117] border border-[#30363D] rounded-md text-white font-mono placeholder-[#6E7681] focus:outline-none focus:border-[#C7FF65]/50"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#C9D1D9] mb-1">
                  Instructions / Playbook (Markdown) <span className="text-rose-400">*</span>
                </label>
                <textarea
                  required
                  rows={6}
                  placeholder="# Playbook Instructions&#10;Step-by-step directives for the agent loop..."
                  value={createForm.instructions}
                  onChange={(e) => setCreateForm({ ...createForm, instructions: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-[#0D1117] border border-[#30363D] rounded-md text-white font-mono placeholder-[#6E7681] focus:outline-none focus:border-[#C7FF65]/50"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-[#30363D]">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 text-xs rounded-md border border-[#30363D] text-[#8B949E] hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingCreate}
                  className="px-4 py-1.5 text-xs font-semibold rounded-md bg-[#C7FF65] hover:bg-[#b8f553] text-[#0D1117] transition-colors"
                >
                  {submittingCreate ? 'Saving...' : 'Create Skill'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL: IMPORT SKILL
          ===================================================================== */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-[#161B22] border border-[#30363D] rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-4 border-b border-[#30363D] flex items-center justify-between bg-[#0D1117]">
              <div className="flex items-center gap-2">
                <UploadCloud className="w-4 h-4 text-[#C7FF65]" />
                <h2 className="text-sm font-semibold text-white">Import Skill Playbook</h2>
              </div>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-[#8B949E] hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleImportSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
              {importError && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
                  {importError}
                </div>
              )}

              {/* Import Mode Tabs */}
              <div className="flex rounded-md bg-[#0D1117] border border-[#30363D] p-0.5">
                <button
                  type="button"
                  onClick={() => setImportMode('markdown')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${
                    importMode === 'markdown'
                      ? 'bg-[#21262D] text-white shadow-xs'
                      : 'text-[#8B949E] hover:text-[#C9D1D9]'
                  }`}
                >
                  Paste SKILL.md Content
                </button>
                <button
                  type="button"
                  onClick={() => setImportMode('directory')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded transition-colors ${
                    importMode === 'directory'
                      ? 'bg-[#21262D] text-white shadow-xs'
                      : 'text-[#8B949E] hover:text-[#C9D1D9]'
                  }`}
                >
                  From Local Directory
                </button>
              </div>

              {/* Scope Selector */}
              <div>
                <label className="block text-xs font-medium text-[#C9D1D9] mb-1">
                  Destination Scope
                </label>
                <select
                  value={importScope}
                  onChange={(e) => setImportScope(e.target.value as SkillScope)}
                  className="w-full px-3 py-1.5 text-xs bg-[#0D1117] border border-[#30363D] rounded-md text-white focus:outline-none focus:border-[#C7FF65]/50"
                >
                  <option value="global">Global (Installed for all workspaces)</option>
                  <option value="workspace">Workspace Specific ({activeWorkspaceId})</option>
                </select>
              </div>

              {importMode === 'markdown' ? (
                <div>
                  <label className="block text-xs font-medium text-[#C9D1D9] mb-1">
                    Paste SKILL.md with YAML Frontmatter
                  </label>
                  <textarea
                    required
                    rows={10}
                    placeholder={`---
name: "My Custom Skill"
description: "Detailed description of capabilities."
category: build
tools: [build_apk]
keywords: [apk, custom]
---

# Instructions
Detailed playbook steps...`}
                    value={importMarkdown}
                    onChange={(e) => setImportMarkdown(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-[#0D1117] border border-[#30363D] rounded-md text-white font-mono placeholder-[#6E7681] focus:outline-none focus:border-[#C7FF65]/50"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-[#C9D1D9] mb-1">
                    Local Skill Directory Path
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. /path/to/my-skill-dir (must contain SKILL.md)"
                    value={importDirectoryPath}
                    onChange={(e) => setImportDirectoryPath(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-[#0D1117] border border-[#30363D] rounded-md text-white font-mono placeholder-[#6E7681] focus:outline-none focus:border-[#C7FF65]/50"
                  />
                  <p className="text-[11px] text-[#8B949E] mt-1">
                    The folder must contain a valid <code className="text-[#C7FF65]">SKILL.md</code>{' '}
                    file. Any auxiliary resource files will also be copied safely.
                  </p>
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-[#30363D]">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-3 py-1.5 text-xs rounded-md border border-[#30363D] text-[#8B949E] hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingImport}
                  className="px-4 py-1.5 text-xs font-semibold rounded-md bg-[#C7FF65] hover:bg-[#b8f553] text-[#0D1117] transition-colors"
                >
                  {submittingImport ? 'Importing...' : 'Import Skill'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
