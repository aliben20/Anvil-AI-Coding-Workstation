import React, { useEffect, useState, useCallback } from 'react';
import {
  DiagnosticCategoryId,
  DiagnosticSuiteReport,
  DiagnosticTestResult,
  DiagnosticTestStatus,
  LocalAiCapabilityMatrix,
  LocalAiModel,
} from '../types';
import {
  Play,
  RefreshCw,
  Download,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Clock,
  Cpu,
  Sparkles,
  FileCode2,
  Activity,
  ChevronDown,
  ChevronRight,
  Wrench,
  Layers,
  Filter,
} from 'lucide-react';

interface CategoryMeta {
  id: DiagnosticCategoryId;
  label: string;
  description: string;
}

interface TestCenterTabProps {
  activeWorkspaceId: string;
  onNavigateTab?: (tab: string) => void;
}

export const TestCenterTab: React.FC<TestCenterTabProps> = ({ activeWorkspaceId }) => {
  const [categories, setCategories] = useState<CategoryMeta[]>([]);
  const [report, setReport] = useState<DiagnosticSuiteReport | null>(null);
  const [capabilities, setCapabilities] = useState<LocalAiCapabilityMatrix | null>(null);
  const [localModels, setLocalModels] = useState<LocalAiModel[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<DiagnosticCategoryId | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<DiagnosticTestStatus | 'all'>('all');
  const [runningAll, setRunningAll] = useState(false);
  const [runningCategory, setRunningCategory] = useState<string | null>(null);
  const [runningTestId, setRunningTestId] = useState<string | null>(null);
  const [expandedStackIds, setExpandedStackIds] = useState<Record<string, boolean>>({});
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Interactive Local GGUF Quick Probe state
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [probePrompt, setProbePrompt] = useState<string>('Reply with exactly: LOCAL_INFERENCE_OK');
  const [probeRunning, setProbeRunning] = useState(false);
  const [loadingModel, setLoadingModel] = useState(false);
  const [downloadingModelId, setDownloadingModelId] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<{
    ok: boolean;
    reply?: string;
    durationMs?: number;
    loadedModelName?: string | null;
    error?: string;
  } | null>(null);

  const fetchInitialData = useCallback(async () => {
    try {
      const [catRes, modelsRes] = await Promise.all([
        fetch('/api/diagnostics/categories'),
        fetch('/api/local-models'),
      ]);
      if (catRes.ok) {
        const data = await catRes.json();
        if (Array.isArray(data.categories)) setCategories(data.categories);
        if (data.lastReport) setReport(data.lastReport);
        if (data.localCapabilities) setCapabilities(data.localCapabilities);
      }
      if (modelsRes.ok) {
        const mData = await modelsRes.json();
        if (Array.isArray(mData.models)) {
          setLocalModels(mData.models);
          const downloaded = mData.models.find((m: LocalAiModel) => m.isDownloaded && m.validMagic);
          if (downloaded) {
            setSelectedModelId((prev) => prev || downloaded.id);
          } else if (mData.models[0]) {
            setSelectedModelId((prev) => prev || mData.models[0].id);
          }
        }
        if (mData.capabilities) {
          setCapabilities(mData.capabilities);
        }
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  const mergePartialReport = (incoming: DiagnosticSuiteReport, isPartial: boolean) => {
    setCapabilities(incoming.localAiCapabilities);
    if (!isPartial || !report) {
      setReport(incoming);
      return;
    }
    const incomingMap = new Map(incoming.results.map((r) => [r.id, r]));
    const mergedResults = report.results.map((existing) => incomingMap.get(existing.id) || existing);
    for (const r of incoming.results) {
      if (!report.results.some((ex) => ex.id === r.id)) {
        mergedResults.push(r);
      }
    }
    const passed = mergedResults.filter((r) => r.status === 'pass').length;
    const failed = mergedResults.filter((r) => r.status === 'fail').length;
    const skipped = mergedResults.filter((r) => r.status === 'skipped').length;
    const blocked = mergedResults.filter((r) => r.status === 'blocked').length;

    setReport({
      ...incoming,
      results: mergedResults,
      summary: {
        total: mergedResults.length,
        passed,
        failed,
        skipped,
        blocked,
      },
    });
  };

  const handleRunAll = async () => {
    setRunningAll(true);
    setErrorBanner(null);
    try {
      const res = await fetch('/api/diagnostics/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeWorkspaceId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to run diagnostic suite.');
      }
      mergePartialReport(data.report, false);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningAll(false);
    }
  };

  const handleRunCategory = async (categoryId: DiagnosticCategoryId) => {
    setRunningCategory(categoryId);
    setErrorBanner(null);
    try {
      const res = await fetch('/api/diagnostics/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categories: [categoryId],
          activeWorkspaceId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Failed to run category ${categoryId}.`);
      }
      mergePartialReport(data.report, true);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningCategory(null);
    }
  };

  const handleRetestSingle = async (testId: string) => {
    setRunningTestId(testId);
    setErrorBanner(null);
    try {
      const res = await fetch('/api/diagnostics/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testIds: [testId],
          activeWorkspaceId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `Failed to retest ${testId}.`);
      }
      mergePartialReport(data.report, true);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningTestId(null);
    }
  };

  const handleRetestFailed = async () => {
    if (!report) return;
    const failedIds = report.results.filter((r) => r.status === 'fail').map((r) => r.id);
    if (failedIds.length === 0) return;

    setRunningAll(true);
    setErrorBanner(null);
    try {
      const res = await fetch('/api/diagnostics/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testIds: failedIds,
          activeWorkspaceId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to retest failed checks.');
      }
      mergePartialReport(data.report, true);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningAll(false);
    }
  };

  const handleLoadModel = async () => {
    if (!selectedModelId) return;
    setLoadingModel(true);
    setErrorBanner(null);
    try {
      const res = await fetch('/api/local-models/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: selectedModelId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to load GGUF model.');
      }
      if (data.capabilities) setCapabilities(data.capabilities);
      await fetchInitialData();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingModel(false);
    }
  };

  const handleUnloadModel = async () => {
    setLoadingModel(true);
    setErrorBanner(null);
    try {
      const res = await fetch('/api/local-models/unload', { method: 'POST' });
      const data = await res.json();
      if (data.capabilities) setCapabilities(data.capabilities);
      await fetchInitialData();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingModel(false);
    }
  };

  const handleDownloadModel = async (modelId: string) => {
    setDownloadingModelId(modelId);
    setErrorBanner(null);
    try {
      const res = await fetch('/api/local-models/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Failed to download GGUF model.');
      }
      await fetchInitialData();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloadingModelId(null);
    }
  };

  const handleRunQuickProbe = async (customPrompt?: string) => {
    const promptToUse = customPrompt ?? probePrompt;
    if (!promptToUse.trim()) return;
    if (customPrompt) setProbePrompt(customPrompt);

    setProbeRunning(true);
    setProbeResult(null);
    try {
      const res = await fetch('/api/local-models/test-inference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: selectedModelId || undefined,
          prompt: promptToUse,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setProbeResult({
          ok: false,
          error: data.error || 'Local GGUF inference failed.',
        });
      } else {
        setProbeResult({
          ok: true,
          reply: data.reply,
          durationMs: data.durationMs,
          loadedModelName: data.loadedModelName,
        });
        if (data.capabilities) setCapabilities(data.capabilities);
      }
    } catch (err) {
      setProbeResult({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setProbeRunning(false);
    }
  };

  const statusBadge = (status: DiagnosticTestStatus) => {
    switch (status) {
      case 'pass':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            <CheckCircle2 className="w-3 h-3" /> PASS
          </span>
        );
      case 'fail':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-red-500/15 text-red-300 border border-red-500/30">
            <ShieldAlert className="w-3 h-3" /> FAIL
          </span>
        );
      case 'skipped':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-amber-500/15 text-amber-300 border border-amber-500/30">
            <Clock className="w-3 h-3" /> SKIPPED
          </span>
        );
      case 'blocked':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-purple-500/15 text-purple-300 border border-purple-500/30">
            <AlertTriangle className="w-3 h-3" /> BLOCKED
          </span>
        );
    }
  };

  const filteredResults: DiagnosticTestResult[] = (report?.results || []).filter((r) => {
    if (selectedCategory !== 'all' && r.category !== selectedCategory) return false;
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    return true;
  });

  const failedCount = report?.summary.failed || 0;

  return (
    <div className="h-full overflow-y-auto bg-[#07080B] text-zinc-100 p-4 md:p-6 space-y-6">
      {/* Header & Top Action Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-white/[0.08]">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#D4FF33]/15 border border-[#D4FF33]/30 flex items-center justify-center">
              <Activity className="w-4 h-4 text-[#D4FF33]" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-white">
                OBSIDIAN Test Center &amp; Real-Time QA Diagnostics
              </h1>
              <p className="text-xs text-zinc-400">
                End-to-end automated verification of routes, interactive controls, Windows terminal paths, agent tools, and native GGUF inference
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleRunAll}
            disabled={runningAll}
            aria-label="Run All Diagnostic Checks"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono font-semibold bg-[#D4FF33] text-black hover:bg-[#e0ff66] disabled:opacity-50 transition-all cursor-pointer"
          >
            {runningAll ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Running Full QA Suite...
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                Run All (12 Categories)
              </>
            )}
          </button>

          <button
            onClick={handleRetestFailed}
            disabled={runningAll || failedCount === 0}
            aria-label="Retest Failed Checks"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-mono bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-40 transition-all cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retest Failed ({failedCount})
          </button>

          <a
            href="/api/diagnostics/export/json"
            download
            aria-label="Export Diagnostic Report as JSON"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-mono bg-[#11131A] text-zinc-200 border border-white/[0.1] hover:border-white/[0.25] transition-all"
          >
            <Download className="w-3.5 h-3.5 text-[#D4FF33]" />
            Export JSON
          </a>

          <a
            href="/api/diagnostics/export/html"
            download
            aria-label="Export Diagnostic Report as HTML"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-mono bg-[#11131A] text-zinc-200 border border-white/[0.1] hover:border-white/[0.25] transition-all"
          >
            <FileCode2 className="w-3.5 h-3.5 text-cyan-400" />
            Export HTML
          </a>
        </div>
      </div>

      {errorBanner && (
        <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-200 flex items-center justify-between">
          <span>{errorBanner}</span>
          <button
            onClick={() => setErrorBanner(null)}
            className="text-red-300 hover:text-white font-mono text-[11px] underline ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Summary Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3.5 rounded-xl bg-[#0D0F14] border border-white/[0.07]">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">Total Checks</div>
          <div className="text-2xl font-bold text-white mt-1">{report ? report.summary.total : '—'}</div>
          <div className="text-[11px] text-zinc-500 mt-0.5">
            {report ? `${report.totalDurationMs} ms total` : 'Ready to execute'}
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/20">
          <div className="text-[10px] font-mono uppercase tracking-wider text-emerald-400">Passed</div>
          <div className="text-2xl font-bold text-emerald-300 mt-1">
            {report ? report.summary.passed : '—'}
          </div>
          <div className="text-[11px] text-emerald-400/70 mt-0.5">Verified runtime state</div>
        </div>

        <div className="p-3.5 rounded-xl bg-red-500/[0.06] border border-red-500/20">
          <div className="text-[10px] font-mono uppercase tracking-wider text-red-400">Failed</div>
          <div className="text-2xl font-bold text-red-300 mt-1">
            {report ? report.summary.failed : '—'}
          </div>
          <div className="text-[11px] text-red-400/70 mt-0.5">Actionable regressions</div>
        </div>

        <div className="p-3.5 rounded-xl bg-amber-500/[0.06] border border-amber-500/20">
          <div className="text-[10px] font-mono uppercase tracking-wider text-amber-400">Skipped</div>
          <div className="text-2xl font-bold text-amber-300 mt-1">
            {report ? report.summary.skipped : '—'}
          </div>
          <div className="text-[11px] text-amber-400/70 mt-0.5">Conditional checks</div>
        </div>

        <div className="p-3.5 rounded-xl bg-purple-500/[0.06] border border-purple-500/20">
          <div className="text-[10px] font-mono uppercase tracking-wider text-purple-400">Blocked</div>
          <div className="text-2xl font-bold text-purple-300 mt-1">
            {report ? report.summary.blocked : '—'}
          </div>
          <div className="text-[11px] text-purple-400/70 mt-0.5">External dependency</div>
        </div>

        <div className="p-3.5 rounded-xl bg-[#0D0F14] border border-white/[0.07]">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">Host Platform</div>
          <div className="text-sm font-mono font-semibold text-[#D4FF33] mt-1.5 truncate">
            {report ? report.platform : 'win32 / node-llama-cpp'}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1 truncate">
            Workspace: {activeWorkspaceId}
          </div>
        </div>
      </div>

      {/* Local AI & GGUF 6-Capability Matrix + Live Inference Workbench */}
      <div className="p-4 rounded-xl bg-[#0D0F14] border border-white/[0.08] space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-[#D4FF33]" />
            <h2 className="text-xs font-mono uppercase tracking-wider text-white font-semibold">
              Local AI &amp; Native GGUF Capability Matrix (node-llama-cpp)
            </h2>
          </div>
          <span className="text-[11px] font-mono text-zinc-400">
            Active Engine Model:{' '}
            <strong className="text-[#D4FF33]">
              {capabilities?.loadedModelName || capabilities?.loadedModelId || 'Not currently loaded in memory'}
            </strong>
          </span>
        </div>

        {/* 6 Distinct Capability Flags */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {[
            {
              label: 'Model Installed',
              flag: capabilities?.modelInstalled ?? false,
              desc: 'Valid .gguf on disk (>1MB)',
            },
            {
              label: 'Model Loaded',
              flag: capabilities?.modelLoaded ?? false,
              desc: 'Loaded in LlamaContext',
            },
            {
              label: 'Backend Ready',
              flag: capabilities?.backendReady ?? false,
              desc: 'node-llama-cpp native C++',
            },
            {
              label: 'Inference Successful',
              flag: capabilities?.inferenceSuccessful ?? false,
              desc: 'Verified token generation',
            },
            {
              label: 'Tool Calling Supported',
              flag: capabilities?.toolCallingSupported ?? true,
              desc: 'ReAct JSON tool bridge',
            },
            {
              label: 'Workspace Tools Ready',
              flag: capabilities?.workspaceToolsAvailable ?? true,
              desc: 'File, shell & APK tools',
            },
          ].map((item) => (
            <div
              key={item.label}
              className={`p-2.5 rounded-lg border ${
                item.flag
                  ? 'bg-emerald-500/[0.06] border-emerald-500/25'
                  : 'bg-zinc-900/70 border-white/[0.06]'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-medium text-zinc-200">{item.label}</span>
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                    item.flag
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  {item.flag ? 'READY' : 'INACTIVE'}
                </span>
              </div>
              <div className="text-[10px] text-zinc-500 mt-1">{item.desc}</div>
            </div>
          ))}
        </div>

        {/* Interactive GGUF Load / Unload / Prompt Verification Bar */}
        <div className="pt-3 border-t border-white/[0.06] flex flex-col lg:flex-row gap-3 items-stretch lg:items-center">
          <div className="flex items-center gap-2">
            <select
              aria-label="Select Local GGUF Model"
              value={selectedModelId}
              onChange={(e) => setSelectedModelId(e.target.value)}
              className="bg-[#12151E] border border-white/[0.12] rounded-lg px-3 py-1.5 text-xs text-zinc-200 font-mono focus:outline-none focus:border-[#D4FF33]"
            >
              {localModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} ({m.sizeDisplay}) {m.isDownloaded ? '• Installed' : '• Not Downloaded'}
                </option>
              ))}
            </select>

            <button
              onClick={handleLoadModel}
              disabled={loadingModel || !selectedModelId}
              className="px-3 py-1.5 rounded-lg text-xs font-mono bg-[#D4FF33]/15 text-[#D4FF33] border border-[#D4FF33]/30 hover:bg-[#D4FF33]/25 disabled:opacity-40 cursor-pointer"
            >
              {loadingModel ? 'Loading...' : 'Load GGUF'}
            </button>

            <button
              onClick={handleUnloadModel}
              disabled={loadingModel || !capabilities?.modelLoaded}
              className="px-2.5 py-1.5 rounded-lg text-xs font-mono bg-zinc-800/80 text-zinc-300 border border-white/[0.08] hover:text-white disabled:opacity-40 cursor-pointer"
            >
              Unload
            </button>

            {!localModels.some((m) => m.isDownloaded && m.validMagic) && (
              <button
                onClick={() => handleDownloadModel('smollm2-135m-instruct-q4_k_m')}
                disabled={Boolean(downloadingModelId)}
                className="px-3 py-1.5 rounded-lg text-xs font-mono bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-40 cursor-pointer"
              >
                {downloadingModelId ? 'Downloading SmolLM2...' : 'Download SmolLM2 135M (100MB)'}
              </button>
            )}
          </div>

          <div className="flex-1 flex flex-wrap sm:flex-nowrap items-center gap-2">
            <input
              type="text"
              aria-label="Local GGUF Test Prompt"
              value={probePrompt}
              onChange={(e) => setProbePrompt(e.target.value)}
              placeholder="Enter prompt to test local GGUF inference..."
              className="flex-1 bg-[#12151E] border border-white/[0.12] rounded-lg px-3 py-1.5 text-xs text-zinc-100 font-mono focus:outline-none focus:border-[#D4FF33]"
            />
            <button
              onClick={() => handleRunQuickProbe()}
              disabled={probeRunning}
              className="px-3 py-1.5 rounded-lg text-xs font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 disabled:opacity-40 cursor-pointer whitespace-nowrap"
            >
              {probeRunning ? 'Generating...' : 'Test Prompt'}
            </button>
          </div>
        </div>

        {/* Preset Quick Prompts */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-zinc-500 font-mono mr-1">Presets:</span>
          {[
            'Hi',
            'What is 2 + 2?',
            'Reply with exactly: LOCAL_INFERENCE_OK',
          ].map((preset) => (
            <button
              key={preset}
              onClick={() => handleRunQuickProbe(preset)}
              disabled={probeRunning}
              className="px-2 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.07] text-zinc-300 font-mono cursor-pointer"
            >
              &ldquo;{preset}&rdquo;
            </button>
          ))}
        </div>

        {probeResult && (
          <div
            className={`p-3 rounded-lg border text-xs font-mono ${
              probeResult.ok
                ? 'bg-emerald-500/[0.07] border-emerald-500/30 text-emerald-200'
                : 'bg-red-500/[0.08] border-red-500/30 text-red-200'
            }`}
          >
            {probeResult.ok ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-emerald-400">
                  <span>
                    Model: {probeResult.loadedModelName} • Verified Native Token Generation
                  </span>
                  <span>{probeResult.durationMs} ms</span>
                </div>
                <div className="text-white whitespace-pre-wrap">{probeResult.reply}</div>
              </div>
            ) : (
              <div>Error: {probeResult.error}</div>
            )}
          </div>
        )}
      </div>

      {/* Category & Status Filters */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setSelectedCategory('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all cursor-pointer ${
                selectedCategory === 'all'
                  ? 'bg-[#D4FF33] text-black font-semibold'
                  : 'bg-[#101219] text-zinc-400 border border-white/[0.07] hover:text-white'
              }`}
            >
              All Categories ({report?.results.length || 0})
            </button>
            {categories.map((cat) => {
              const catResults = (report?.results || []).filter((r) => r.category === cat.id);
              const hasFail = catResults.some((r) => r.status === 'fail');
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-mono transition-all cursor-pointer flex items-center gap-1.5 ${
                    selectedCategory === cat.id
                      ? 'bg-[#D4FF33] text-black font-semibold'
                      : hasFail
                      ? 'bg-red-500/10 text-red-300 border border-red-500/30'
                      : 'bg-[#101219] text-zinc-300 border border-white/[0.07] hover:border-white/[0.2]'
                  }`}
                >
                  <span>{cat.label}</span>
                  {catResults.length > 0 && (
                    <span className="text-[10px] opacity-75">({catResults.length})</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-zinc-500" />
            {(['all', 'pass', 'fail', 'skipped', 'blocked'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 rounded text-[11px] font-mono uppercase cursor-pointer ${
                  statusFilter === st
                    ? 'bg-white/15 text-white font-semibold border border-white/25'
                    : 'bg-[#101219] text-zinc-400 border border-white/[0.06] hover:text-zinc-200'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Category Sections & Detailed Test Results */}
      {!report && !runningAll ? (
        <div className="p-10 rounded-2xl bg-[#0D0F14] border border-white/[0.07] text-center space-y-3">
          <Sparkles className="w-8 h-8 text-[#D4FF33] mx-auto" />
          <div className="text-sm font-semibold text-white">
            No Diagnostic Suite Report Generated Yet
          </div>
          <p className="text-xs text-zinc-400 max-w-xl mx-auto">
            Click <strong>Run All (12 Categories)</strong> above or run an individual category below to execute live runtime checks across routes, interactive controls, Windows terminal sessions, workspace tools, and native GGUF model inference.
          </p>
          <div className="pt-2">
            <button
              onClick={handleRunAll}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono font-semibold bg-[#D4FF33] text-black hover:bg-[#e0ff66] cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              Run All Diagnostic Tests Now
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-5">
        {categories
          .filter((cat) => selectedCategory === 'all' || cat.id === selectedCategory)
          .map((cat) => {
            const catTests = filteredResults.filter((r) => r.category === cat.id);
            const isCatRunning = runningCategory === cat.id;

            return (
              <div
                key={cat.id}
                className="rounded-xl bg-[#0C0E14] border border-white/[0.08] overflow-hidden"
              >
                <div className="px-4 py-3 bg-[#10131C] border-b border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-[#D4FF33]" />
                      <h3 className="text-xs font-mono uppercase tracking-wider font-semibold text-white">
                        {cat.label}
                      </h3>
                      <span className="text-[11px] font-mono text-zinc-400">
                        ({catTests.length} {catTests.length === 1 ? 'test' : 'tests'})
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-0.5">{cat.description}</p>
                  </div>

                  <button
                    onClick={() => handleRunCategory(cat.id)}
                    disabled={isCatRunning || runningAll}
                    aria-label={`Run Category ${cat.label}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 border border-white/[0.1] disabled:opacity-40 cursor-pointer self-start sm:self-auto"
                  >
                    {isCatRunning ? (
                      <>
                        <RefreshCw className="w-3 h-3 animate-spin text-[#D4FF33]" />
                        Running...
                      </>
                    ) : (
                      <>
                        <Play className="w-3 h-3 text-[#D4FF33]" />
                        Run Category
                      </>
                    )}
                  </button>
                </div>

                {catTests.length === 0 ? (
                  <div className="p-4 text-xs text-zinc-500 font-mono">
                    No test results currently match the filter for this category. Click &ldquo;Run Category&rdquo; to execute.
                  </div>
                ) : (
                  <div className="divide-y divide-white/[0.06]">
                    {catTests.map((test) => {
                      const isStackExpanded = Boolean(expandedStackIds[test.id]);
                      const isRetesting = runningTestId === test.id;

                      return (
                        <div key={test.id} className="p-4 space-y-2 hover:bg-white/[0.01] transition-colors">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="flex items-center gap-2.5 flex-wrap">
                              {statusBadge(test.status)}
                              <span className="text-xs font-semibold text-white">{test.name}</span>
                              <span className="text-[11px] font-mono text-zinc-500">
                                ({test.id})
                              </span>
                            </div>

                            <div className="flex items-center gap-2 self-start sm:self-auto">
                              <span className="text-[11px] font-mono text-zinc-400">
                                {test.durationMs} ms
                              </span>
                              <button
                                onClick={() => handleRetestSingle(test.id)}
                                disabled={isRetesting || runningAll}
                                aria-label={`Retest ${test.name}`}
                                className="px-2 py-1 rounded text-[11px] font-mono bg-white/[0.05] hover:bg-white/[0.1] text-zinc-300 border border-white/[0.08] disabled:opacity-40 cursor-pointer inline-flex items-center gap-1"
                              >
                                <RefreshCw
                                  className={`w-2.5 h-2.5 ${isRetesting ? 'animate-spin text-[#D4FF33]' : ''}`}
                                />
                                Retest
                              </button>
                            </div>
                          </div>

                          <div className="text-[11px] text-zinc-400">
                            <span className="text-zinc-500 font-mono">Feature Tested:</span>{' '}
                            {test.featureTested}
                          </div>

                          <div className="p-2.5 rounded-lg bg-[#080A0F] border border-white/[0.05] text-xs font-mono text-zinc-200 whitespace-pre-wrap">
                            {test.observedResult}
                          </div>

                          {test.suggestedFix && (
                            <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-xs text-amber-200 flex items-start gap-2">
                              <Wrench className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                              <div>
                                <span className="font-mono font-semibold text-amber-300">
                                  Suggested Fix:{' '}
                                </span>
                                {test.suggestedFix}
                              </div>
                            </div>
                          )}

                          {(test.errorMessage || test.stackTrace) && (
                            <div className="space-y-1.5">
                              {test.errorMessage && (
                                <div className="text-xs font-mono text-red-400">
                                  Error: {test.errorMessage}
                                </div>
                              )}
                              {test.stackTrace && (
                                <div>
                                  <button
                                    onClick={() =>
                                      setExpandedStackIds((prev) => ({
                                        ...prev,
                                        [test.id]: !prev[test.id],
                                      }))
                                    }
                                    className="inline-flex items-center gap-1 text-[11px] font-mono text-zinc-400 hover:text-white cursor-pointer"
                                  >
                                    {isStackExpanded ? (
                                      <ChevronDown className="w-3 h-3" />
                                    ) : (
                                      <ChevronRight className="w-3 h-3" />
                                    )}
                                    {isStackExpanded ? 'Hide Stack Trace' : 'Show Stack Trace'}
                                  </button>
                                  {isStackExpanded && (
                                    <pre className="mt-1.5 p-2.5 rounded bg-black/70 border border-red-500/20 text-[11px] font-mono text-red-300 overflow-x-auto">
                                      {test.stackTrace}
                                    </pre>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
};
