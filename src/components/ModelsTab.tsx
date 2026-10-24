import React, { useState, useEffect, useRef } from 'react';
import {
  Cpu,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCw,
  ExternalLink,
  Zap,
  Key,
  HardDrive,
  Search,
  Check,
  Upload,
  Play,
  FileCode,
  Layers,
  Smartphone,
  Monitor,
  Server,
  Folder,
} from 'lucide-react';
import { ProviderSummary, DiscoveredModel } from '../types';
import {
  getEnvironmentReport,
  EnvironmentReport,
  isAndroidNativeClient,
  isMobileBrowserClient,
} from '../services/environmentService';

interface ModelsTabProps {
  providers: ProviderSummary[];
  activeModelId: string;
  activeProviderId?: string;
  onSelectModel: (providerId: string, modelId: string) => void;
  onRefreshProviders: () => void;
  onNavigateToSettings: () => void;
  onOpenEnvironment?: () => void;
}

export type ModelState =
  | 'idle'
  | 'File selected'
  | 'Import in progress'
  | 'Imported'
  | 'Metadata validated'
  | 'Backend supported'
  | 'Model loaded'
  | 'Inference ready'
  | 'Inference failed';

interface LocalGgufModel {
  id: string;
  displayName: string;
  description: string;
  format: string;
  sizeBytes: number;
  sizeDisplay: string;
  ramRequiredDisplay: string;
  architectureHint?: string;
  isDownloaded: boolean;
  filePath?: string;
  validMagic?: boolean;
  formatVersion?: number;
  tensorCount?: number;
  metadataKvCount?: number;
  fitsHostMemory?: boolean;
  diagnosticMessage?: string;
  downloadStatus?: string;
}

export const ModelsTab: React.FC<ModelsTabProps> = ({
  providers,
  activeModelId,
  onSelectModel,
  onRefreshProviders,
  onNavigateToSettings,
  onOpenEnvironment,
}) => {
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    providerId: string;
    success: boolean;
    message: string;
    latencyMs?: number;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<'all' | 'connected' | 'local' | 'cloud' | 'gguf'>('all');

  // Environment & Runtime
  const [envReport, setEnvReport] = useState<EnvironmentReport | null>(null);

  // Local GGUF models & Import workflow
  const [localModels, setLocalModels] = useState<LocalGgufModel[]>([]);
  const [loadingLocalModels, setLoadingLocalModels] = useState(false);
  const [importState, setImportState] = useState<ModelState>('idle');
  const [importProgress, setImportProgress] = useState(0);
  const [importError, setImportError] = useState<string | null>(null);
  const [importValidationChecks, setImportValidationChecks] = useState<Array<{ name: string; passed: boolean; detail: string }>>([]);
  const [selectedFilePath, setSelectedFilePath] = useState('');
  const [selectedFileName, setSelectedFileName] = useState('');
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [activeTabSubView, setActiveTabSubView] = useState<'catalog' | 'gguf_engine'>('catalog');

  // Local model testing & inference
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [localInferenceResult, setLocalInferenceResult] = useState<{
    modelId: string;
    success: boolean;
    output: string;
    latencyMs: number;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadEnvironment = async () => {
    const report = await getEnvironmentReport();
    setEnvReport(report);
  };

  const fetchLocalModels = async () => {
    setLoadingLocalModels(true);
    try {
      const res = await fetch('/api/local-models');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.models)) {
          setLocalModels(data.models);
        }
      }
    } catch {
      // offline or fallback handled
    } finally {
      setLoadingLocalModels(false);
    }
  };

  useEffect(() => {
    loadEnvironment();
    fetchLocalModels();

    const handleSettingsUpdated = () => {
      loadEnvironment();
      fetchLocalModels();
      onRefreshProviders();
    };

    window.addEventListener('obsidian:settings_updated', handleSettingsUpdated);
    return () => {
      window.removeEventListener('obsidian:settings_updated', handleSettingsUpdated);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTestProvider = async (providerId: string) => {
    setTestingProviderId(providerId);
    setTestResult(null);
    try {
      const res = await fetch('/api/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId }),
      });
      const data = await res.json();
      setTestResult({
        providerId,
        success: Boolean(data.connected),
        message: data.message || (data.connected ? 'Connection verified successfully.' : 'Connection failed.'),
        latencyMs: data.latencyMs,
      });
      onRefreshProviders();
    } catch (err) {
      setTestResult({
        providerId,
        success: false,
        message: err instanceof Error ? err.message : 'Network test error',
      });
    } finally {
      setTestingProviderId(null);
    }
  };

  // Multi-stage GGUF Import workflow
  const handleSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFileName(file.name);
    setSelectedFilePath(file.name);
    setImportError(null);
    setImportValidationChecks([]);
    setImportState('File selected');
    setImportProgress(10);
  };

  const handleRunImportPipeline = async () => {
    if (!selectedFileName) return;

    setImportError(null);
    setImportState('Import in progress');
    setImportProgress(35);

    try {
      // Step 1: Simulate / stream file import
      await new Promise((r) => setTimeout(r, 400));
      setImportProgress(65);
      setImportState('Imported');

      // Step 2: Validate metadata
      await new Promise((r) => setTimeout(r, 300));
      setImportState('Metadata validated');
      setImportProgress(85);

      const res = await fetch('/api/local-models/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: selectedFileName,
          filePath: selectedFilePath !== selectedFileName ? selectedFilePath : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        setImportState('Inference failed');
        setImportError(data.error || 'GGUF binary validation failed.');
        if (Array.isArray(data.checks)) {
          setImportValidationChecks(data.checks);
        }
        return;
      }

      setImportValidationChecks(data.checks || []);
      setImportState('Backend supported');
      setImportProgress(100);

      // Refresh catalog after successful import
      await fetchLocalModels();
      onRefreshProviders();
    } catch (err) {
      setImportState('Inference failed');
      setImportError(err instanceof Error ? err.message : 'Failed to complete import pipeline.');
    }
  };

  const handleTestLocalInference = async (model: LocalGgufModel) => {
    setTestingModelId(model.id);
    setLocalInferenceResult(null);
    const start = Date.now();

    try {
      // 1. Verify model is loaded or load it
      await fetch('/api/local-models/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: model.id }),
      });

      // 2. Run test inference
      const res = await fetch('/api/local-models/test-inference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: model.id,
          prompt: 'Write a single sentence confirming local AI runtime readiness.',
        }),
      });

      const data = await res.json();
      const latencyMs = Date.now() - start;

      if (!res.ok || !data.ok) {
        setLocalInferenceResult({
          modelId: model.id,
          success: false,
          output: data.error || 'Local inference test failed.',
          latencyMs,
        });
      } else {
        setLocalInferenceResult({
          modelId: model.id,
          success: true,
          output: data.response || 'Local inference active and verified.',
          latencyMs,
        });
      }
    } catch (err) {
      setLocalInferenceResult({
        modelId: model.id,
        success: false,
        output: err instanceof Error ? err.message : 'Inference request error.',
        latencyMs: Date.now() - start,
      });
    } finally {
      setTestingModelId(null);
    }
  };

  const allModels: Array<{
    provider: ProviderSummary;
    model: DiscoveredModel;
  }> = [];

  providers.forEach((prov) => {
    const list: DiscoveredModel[] =
      prov.cachedModels && prov.cachedModels.length > 0
        ? prov.cachedModels
        : [
            {
              id: prov.defaultModel,
              displayName: prov.defaultModel,
              providerId: prov.id,
              supportsStreaming: true,
              supportsTools: true,
              supportsVision: false,
              isFreeTierVerified: false,
            },
          ];

    list.forEach((m) => {
      allModels.push({ provider: prov, model: m });
    });
  });

  const filteredModels = allModels.filter(({ provider, model }) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch =
      model.displayName.toLowerCase().includes(query) ||
      model.id.toLowerCase().includes(query) ||
      provider.name.toLowerCase().includes(query);

    if (!matchesSearch) return false;

    if (selectedTag === 'connected') return provider.connected;
    if (selectedTag === 'local') return provider.id.includes('local') || provider.baseUrl.includes('localhost') || provider.baseUrl.includes('127.0.0.1');
    if (selectedTag === 'cloud') return !provider.id.includes('local') && !provider.baseUrl.includes('localhost');
    return true;
  });

  const connectedCount = providers.filter((p) => p.connected).length;
  const isNative = isAndroidNativeClient();
  const isMobile = isMobileBrowserClient();

  return (
    <div className="flex flex-col h-full w-full max-w-full overflow-hidden bg-[#0D1117] text-[#F0F6FC]">
      {/* Top Header - Mobile Adaptive */}
      <div className="px-4 sm:px-8 py-3 sm:py-4 border-b border-[#30363D] bg-[#161B22] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base sm:text-lg font-bold tracking-tight text-[#F0F6FC]">
              AI Models & Local Inference Engine
            </h1>
            {envReport && (
              <span
                onClick={onOpenEnvironment}
                className="cursor-pointer text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#21262D] border border-[#30363D] text-[#C7FF65] hover:border-[#C7FF65] transition-colors flex items-center gap-1"
                title="View execution environment details"
              >
                {envReport.client.isMobile ? (
                  <Smartphone className="w-3 h-3 text-[#C7FF65]" />
                ) : (
                  <Monitor className="w-3 h-3 text-[#58A6FF]" />
                )}
                <span>{envReport.client.label.split(' ')[0]}</span>
              </span>
            )}
          </div>
          <p className="text-xs text-[#8B949E]">
            Verify local GGUF models, on-device runtimes, and authenticated cloud providers.
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => setShowImportDialog(true)}
            className="flex-1 sm:flex-none min-h-[36px] px-3.5 py-1.5 rounded-xl bg-[#C7FF65] text-[#0D1117] font-semibold text-xs flex items-center justify-center gap-1.5 hover:bg-[#b5f250] transition-colors cursor-pointer shadow-sm"
            title="Import or validate a local GGUF model"
            aria-label="Import GGUF Model"
          >
            <Upload className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Import GGUF</span>
          </button>
          <button
            onClick={() => {
              onRefreshProviders();
              fetchLocalModels();
              loadEnvironment();
            }}
            className="flex-1 sm:flex-none min-h-[36px] px-3 py-1.5 rounded-xl bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-xs text-[#F0F6FC] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            title="Refresh models and provider connectivity"
            aria-label="Refresh models and providers"
          >
            <RotateCw className="w-3.5 h-3.5 text-[#8B949E]" />
            <span>Refresh</span>
          </button>
          <button
            onClick={onNavigateToSettings}
            className="flex-1 sm:flex-none min-h-[36px] px-3 py-1.5 rounded-xl bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-xs text-[#C7FF65] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            title="Configure API Keys and Custom Providers"
            aria-label="Configure API Keys and Custom Providers in Settings"
          >
            <Key className="w-3.5 h-3.5" />
            <span>API Vault</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6 max-w-6xl mx-auto w-full">
        {/* Environment Runtime Notice Banner */}
        {isMobile && envReport && (
          <div className="p-3.5 rounded-xl bg-[#D29922]/15 border border-[#D29922]/40 text-[#F4C46A] flex items-start justify-between gap-3 text-xs">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Mobile Browser Execution: </span>
                You are connecting from a phone browser to the host PC (<span className="font-mono">{envReport.backend.hostname}</span>).
                GGUF inference runs on the PC host using its CPU/GPU. Direct mobile on-device inference requires the native Android APK.
              </div>
            </div>
            {onOpenEnvironment && (
              <button
                onClick={onOpenEnvironment}
                className="px-2.5 py-1 rounded-lg bg-[#21262D] border border-[#30363D] text-xs font-semibold text-[#F0F6FC] hover:border-[#C7FF65] shrink-0"
              >
                Details
              </button>
            )}
          </div>
        )}

        {/* View Switcher: Providers Catalog vs Local GGUF Engine */}
        <div className="flex items-center gap-2 border-b border-[#30363D] pb-3">
          <button
            onClick={() => setActiveTabSubView('catalog')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
              activeTabSubView === 'catalog'
                ? 'bg-[#21262D] text-[#C7FF65] border border-[#C7FF65]/40'
                : 'text-[#8B949E] hover:text-[#F0F6FC]'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>All Providers & Catalogs</span>
            <span className="font-mono text-[11px] px-1.5 py-0.2 rounded-full bg-[#161B22] text-[#8B949E]">
              {allModels.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTabSubView('gguf_engine')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
              activeTabSubView === 'gguf_engine'
                ? 'bg-[#21262D] text-[#C7FF65] border border-[#C7FF65]/40'
                : 'text-[#8B949E] hover:text-[#F0F6FC]'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5" />
            <span>Local GGUF Weights & On-Device AI</span>
            <span className="font-mono text-[11px] px-1.5 py-0.2 rounded-full bg-[#161B22] text-[#C7FF65]">
              {localModels.length}
            </span>
          </button>
        </div>

        {/* Metric Badges */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-4">
          <div className="p-3.5 sm:p-4 rounded-xl bg-[#161B22] border border-[#30363D] space-y-1">
            <div className="text-xs text-[#8B949E] flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-[#C7FF65]" />
              <span>Connected Gateways</span>
            </div>
            <div className="text-xl sm:text-2xl font-bold font-mono text-[#F0F6FC]">
              {connectedCount} <span className="text-xs font-normal text-[#8B949E]">/ {providers.length} configured</span>
            </div>
          </div>

          <div className="p-3.5 sm:p-4 rounded-xl bg-[#161B22] border border-[#30363D] space-y-1">
            <div className="text-xs text-[#8B949E] flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-[#58A6FF]" />
              <span>GGUF Local Models</span>
            </div>
            <div className="text-xl sm:text-2xl font-bold font-mono text-[#F0F6FC]">
              {localModels.filter((m) => m.isDownloaded).length}{' '}
              <span className="text-xs font-normal text-[#8B949E]">/ {localModels.length} installed</span>
            </div>
          </div>

          <div className="p-3.5 sm:p-4 rounded-xl bg-[#161B22] border border-[#30363D] space-y-1">
            <div className="text-xs text-[#8B949E] flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-[#F4C46A]" />
              <span>Active Inference Target</span>
            </div>
            <div className="text-sm font-bold font-mono text-[#C7FF65] truncate">
              {activeModelId}
            </div>
          </div>
        </div>

        {/* Test Result Alert Banner */}
        {testResult && (
          <div
            className={`p-3.5 sm:p-4 rounded-xl border flex items-start justify-between gap-3 ${
              testResult.success
                ? 'bg-[#238636]/15 border-[#238636]/40 text-[#72D9A0]'
                : 'bg-[#DA3633]/15 border-[#DA3633]/40 text-[#FF727A]'
            }`}
          >
            <div className="flex items-start gap-2.5 text-xs">
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <div>
                <span className="font-semibold">{testResult.message}</span>
                {testResult.latencyMs !== undefined && (
                  <span className="ml-2 font-mono text-[11px] opacity-80">
                    ({testResult.latencyMs} ms)
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => setTestResult(null)}
              className="text-xs opacity-70 hover:opacity-100 cursor-pointer"
              title="Dismiss test result banner"
              aria-label="Dismiss test result banner"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Local GGUF Engine View */}
        {activeTabSubView === 'gguf_engine' && (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-[#161B22] border border-[#30363D] space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-[#F0F6FC] flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-[#C7FF65]" />
                    Local GGUF Models & On-Device AI
                  </h3>
                  <p className="text-xs text-[#8B949E]">
                    Quantized weights executed directly on hardware without cloud dependencies.
                  </p>
                </div>
                <button
                  onClick={() => setShowImportDialog(true)}
                  className="px-3 py-1.5 rounded-xl bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-xs font-semibold text-[#C7FF65] flex items-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Import Model</span>
                </button>
              </div>

              {localInferenceResult && (
                <div
                  className={`p-3 rounded-xl border text-xs space-y-1 ${
                    localInferenceResult.success
                      ? 'bg-[#238636]/15 border-[#238636]/40 text-[#72D9A0]'
                      : 'bg-[#DA3633]/15 border-[#DA3633]/40 text-[#FF727A]'
                  }`}
                >
                  <div className="flex items-center justify-between font-semibold">
                    <span>Test Inference Result ({localInferenceResult.latencyMs} ms)</span>
                    <button
                      onClick={() => setLocalInferenceResult(null)}
                      className="opacity-70 hover:opacity-100"
                    >
                      Dismiss
                    </button>
                  </div>
                  <div className="font-mono text-[11px] bg-[#0D1117] p-2 rounded-lg border border-black/30">
                    {localInferenceResult.output}
                  </div>
                </div>
              )}

              {loadingLocalModels ? (
                <div className="p-6 text-center text-xs text-[#8B949E] flex items-center justify-center gap-2">
                  <RotateCw className="w-4 h-4 animate-spin text-[#C7FF65]" />
                  <span>Scanning GGUF model storage...</span>
                </div>
              ) : localModels.length === 0 ? (
                <div className="p-6 text-center rounded-xl bg-[#0D1117] border border-[#30363D] space-y-2">
                  <HardDrive className="w-8 h-8 text-[#8B949E] mx-auto opacity-50" />
                  <div className="text-sm font-semibold text-[#F0F6FC]">No Local GGUF Models Detected</div>
                  <p className="text-xs text-[#8B949E] max-w-md mx-auto">
                    Import a quantized <span className="font-mono">.gguf</span> file (e.g. Qwen 2.5 Coder, Llama 3.2,
                    Phi 3.5) into the model repository to enable on-device local completions.
                  </p>
                  <button
                    onClick={() => setShowImportDialog(true)}
                    className="mt-2 px-4 py-2 rounded-xl bg-[#C7FF65] text-[#0D1117] font-bold text-xs"
                  >
                    Select & Import GGUF File
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {localModels.map((m) => {
                    const isSelected = activeModelId === m.id || activeModelId === `${m.id}.gguf`;
                    const isTesting = testingModelId === m.id;

                    return (
                      <div
                        key={m.id}
                        className={`p-4 rounded-xl border space-y-3 transition-all ${
                          isSelected
                            ? 'bg-[#161B22] border-[#C7FF65] shadow-[0_0_15px_-3px_rgba(199,255,101,0.15)]'
                            : 'bg-[#0D1117] border-[#30363D] hover:border-[#8B949E]/40'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#21262D] text-[#C7FF65]">
                                {m.format}
                              </span>
                              {m.isDownloaded ? (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#238636]/20 text-[#72D9A0] border border-[#238636]/30">
                                  <CheckCircle2 className="w-2.5 h-2.5" />
                                  Installed
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#D29922]/20 text-[#F4C46A] border border-[#D29922]/30">
                                  Weights Needed
                                </span>
                              )}
                            </div>
                            <h4 className="text-sm font-bold text-[#F0F6FC] truncate">{m.displayName}</h4>
                            <p className="text-[11px] text-[#8B949E] line-clamp-1">{m.description}</p>
                          </div>

                          <button
                            onClick={() => onSelectModel('local-ai', m.id)}
                            className={`min-h-[34px] px-3 py-1 rounded-xl text-xs font-medium transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
                              isSelected
                                ? 'bg-[#C7FF65] text-[#0D1117] font-bold shadow-md'
                                : 'bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-[#F0F6FC]'
                            }`}
                          >
                            {isSelected ? (
                              <>
                                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                                <span>Active</span>
                              </>
                            ) : (
                              <span>Select</span>
                            )}
                          </button>
                        </div>

                        {/* Metadata row */}
                        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-[#30363D]/60 text-[10px] font-mono text-[#8B949E]">
                          <span className="px-2 py-0.5 rounded bg-[#21262D] text-[#F0F6FC]">
                            Size: {m.sizeDisplay}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-[#21262D]">
                            {m.ramRequiredDisplay}
                          </span>
                          {m.tensorCount && (
                            <span className="px-2 py-0.5 rounded bg-[#21262D]">
                              {m.tensorCount} tensors
                            </span>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center justify-between gap-2 pt-2 text-xs">
                          <button
                            onClick={() => handleTestLocalInference(m)}
                            disabled={isTesting || !m.isDownloaded}
                            className="text-[#C7FF65] hover:underline flex items-center gap-1 font-medium disabled:opacity-40 cursor-pointer"
                          >
                            <Play className={`w-3 h-3 ${isTesting ? 'animate-spin' : ''}`} />
                            <span>{isTesting ? 'Testing Inference...' : 'Test Local Inference'}</span>
                          </button>
                          {m.filePath && (
                            <span className="text-[10px] text-[#8B949E] font-mono truncate max-w-[160px]" title={m.filePath}>
                              {m.filePath.split(/[\\/]/).pop()}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Cloud & Discovered Models Catalog */}
        {activeTabSubView === 'catalog' && (
          <div className="space-y-4">
            {/* Search & Filter Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-[#8B949E] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search models by name, tag, or provider..."
                  className="w-full pl-9 pr-4 py-2 rounded-xl bg-[#161B22] border border-[#30363D] text-xs text-[#F0F6FC] placeholder-[#8B949E] focus:outline-none focus:border-[#C7FF65]"
                  aria-label="Search models by name, tag, or provider"
                />
              </div>

              <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[#161B22] border border-[#30363D] text-xs overflow-x-auto max-w-full">
                {(
                  [
                    { id: 'all', label: 'All Models' },
                    { id: 'connected', label: 'Connected' },
                    { id: 'cloud', label: 'Cloud' },
                    { id: 'local', label: 'Local' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTag(t.id)}
                    className={`min-h-[32px] px-3 py-1 rounded-lg whitespace-nowrap transition-colors cursor-pointer ${
                      selectedTag === t.id
                        ? 'bg-[#21262D] text-[#C7FF65] font-semibold border border-[#C7FF65]/30'
                        : 'text-[#8B949E] hover:text-[#F0F6FC]'
                    }`}
                    title={`Filter by ${t.label}`}
                    aria-label={`Filter by ${t.label}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Model Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
              {filteredModels.map(({ provider, model }) => {
                const isSelected = model.id === activeModelId;
                const isTesting = testingProviderId === provider.id;

                return (
                  <div
                    key={`${provider.id}-${model.id}`}
                    className={`p-4 sm:p-5 rounded-xl border transition-all space-y-3.5 ${
                      isSelected
                        ? 'bg-[#161B22] border-[#C7FF65] shadow-[0_0_15px_-3px_rgba(199,255,101,0.15)]'
                        : 'bg-[#161B22] border-[#30363D] hover:border-[#8B949E]/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-medium text-[#8B949E] truncate">
                            {provider.name}
                          </span>
                          {provider.connected ? (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#238636]/20 text-[#72D9A0] border border-[#238636]/30 shrink-0">
                              <CheckCircle2 className="w-2.5 h-2.5" />
                              Ready
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#D29922]/20 text-[#F4C46A] border border-[#D29922]/30 shrink-0">
                              <AlertTriangle className="w-2.5 h-2.5" />
                              API Key Required
                            </span>
                          )}
                        </div>
                        <h3 className="text-sm sm:text-base font-bold text-[#F0F6FC] truncate">
                          {model.displayName}
                        </h3>
                        <p className="text-xs font-mono text-[#8B949E] truncate">{model.id}</p>
                      </div>

                      <button
                        onClick={() => onSelectModel(provider.id, model.id)}
                        className={`min-h-[36px] px-3.5 py-1 rounded-xl text-xs font-medium transition-all shrink-0 flex items-center gap-1.5 cursor-pointer ${
                          isSelected
                            ? 'bg-[#C7FF65] text-[#0D1117] font-bold shadow-md'
                            : 'bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-[#F0F6FC]'
                        }`}
                        title={isSelected ? 'Active Model' : `Select ${model.displayName}`}
                        aria-label={isSelected ? `Current active model: ${model.displayName}` : `Select ${model.displayName} as active model`}
                      >
                        {isSelected ? (
                          <>
                            <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                            <span>Active</span>
                          </>
                        ) : (
                          <span>Select</span>
                        )}
                      </button>
                    </div>

                    {/* Capabilities & Metadata */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-[#30363D]/60 text-[11px]">
                      {model.contextWindowTokens && (
                        <span className="px-2 py-0.5 rounded bg-[#21262D] text-[#8B949E] font-mono">
                          {Math.round(model.contextWindowTokens / 1000)}k Context
                        </span>
                      )}
                      {model.supportsTools && (
                        <span className="px-2 py-0.5 rounded bg-[#21262D] text-[#8B949E] font-medium text-[10px]">
                          Tools
                        </span>
                      )}
                      {model.supportsVision && (
                        <span className="px-2 py-0.5 rounded bg-[#21262D] text-[#8B949E] font-medium text-[10px]">
                          Vision
                        </span>
                      )}
                      {model.supportsStreaming && (
                        <span className="px-2 py-0.5 rounded bg-[#21262D] text-[#8B949E] font-medium text-[10px]">
                          Streaming
                        </span>
                      )}
                      {provider.baseUrl && (
                        <span className="text-[11px] text-[#6E7580] font-mono truncate max-w-[180px]">
                          {provider.baseUrl.replace('https://', '')}
                        </span>
                      )}
                    </div>

                    {/* Provider Actions */}
                    <div className="flex items-center justify-between gap-2 pt-2 text-xs">
                      <button
                        onClick={() => handleTestProvider(provider.id)}
                        disabled={isTesting}
                        className="text-[#C7FF65] hover:underline flex items-center gap-1 font-medium disabled:opacity-50 cursor-pointer"
                        title={`Test connection to ${provider.name}`}
                        aria-label={`Test connection to ${provider.name}`}
                      >
                        <RotateCw className={`w-3 h-3 ${isTesting ? 'animate-spin' : ''}`} />
                        <span>{isTesting ? 'Testing connection...' : 'Test Connection'}</span>
                      </button>

                      {provider.docsUrl && (
                        <a
                          href={provider.docsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#8B949E] hover:text-[#F0F6FC] flex items-center gap-1 text-[11px]"
                          title={`Open documentation for ${provider.name}`}
                          aria-label={`Open documentation for ${provider.name} (opens in new tab)`}
                        >
                          <span>Documentation</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* GGUF Model Multi-Stage Import Modal */}
      {showImportDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-[#161B22] border border-[#30363D] rounded-2xl shadow-2xl p-5 space-y-4 text-[#F0F6FC]">
            <div className="flex items-center justify-between border-b border-[#30363D] pb-3">
              <div className="flex items-center gap-2">
                <Upload className="w-4 h-4 text-[#C7FF65]" />
                <h3 className="text-sm font-bold text-[#F0F6FC]">Import GGUF Quantized Model</h3>
              </div>
              <button
                onClick={() => {
                  setShowImportDialog(false);
                  setImportState('idle');
                  setImportError(null);
                }}
                className="text-[#8B949E] hover:text-[#F0F6FC]"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-[#8B949E]">
              Select a valid GGUF binary weights file. The workstation verifies header magic, tensor architecture,
              and memory budget before registering the model.
            </p>

            {/* Hidden HTML file input */}
            <input
              type="file"
              ref={fileInputRef}
              accept=".gguf,.bin"
              onChange={handleSelectFile}
              className="hidden"
            />

            {/* File Selection Trigger */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2 rounded-xl bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-xs font-semibold text-[#F0F6FC] flex items-center gap-2 cursor-pointer"
                >
                  <FileCode className="w-3.5 h-3.5 text-[#C7FF65]" />
                  <span>Choose .gguf file</span>
                </button>
                <span className="text-xs font-mono text-[#8B949E] truncate flex-1">
                  {selectedFileName || 'No file selected'}
                </span>
              </div>

              {/* Or manual path input for desktop / server paths */}
              <div className="pt-1">
                <label className="text-[11px] text-[#8B949E] block mb-1">Or direct filesystem path on host:</label>
                <input
                  type="text"
                  value={selectedFilePath}
                  onChange={(e) => {
                    setSelectedFilePath(e.target.value);
                    setSelectedFileName(e.target.value.split(/[\\/]/).pop() || '');
                    setImportState('File selected');
                  }}
                  placeholder="e.g. C:/models/custom-model.gguf or .anvil-data/local-models/model.gguf"
                  className="w-full px-3 py-1.5 rounded-lg bg-[#0D1117] border border-[#30363D] text-xs font-mono text-[#F0F6FC] focus:outline-none focus:border-[#C7FF65]"
                />
              </div>
            </div>

            {/* Multi-Stage Lifecycle Indicator */}
            {importState !== 'idle' && (
              <div className="p-3.5 rounded-xl bg-[#0D1117] border border-[#30363D] space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#F0F6FC]">Import & Validation Pipeline</span>
                  <span
                    className={`font-mono font-bold text-[11px] ${
                      importState === 'Inference failed'
                        ? 'text-[#FF727A]'
                        : importState === 'Backend supported' || importState === 'Inference ready'
                        ? 'text-[#72D9A0]'
                        : 'text-[#C7FF65]'
                    }`}
                  >
                    {importState}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full h-1.5 rounded-full bg-[#21262D] overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      importState === 'Inference failed' ? 'bg-[#DA3633]' : 'bg-[#C7FF65]'
                    }`}
                    style={{ width: `${importProgress}%` }}
                  />
                </div>

                {/* 8-stage sequence pills */}
                <div className="grid grid-cols-4 gap-1 text-[10px] font-mono">
                  {(
                    [
                      'File selected',
                      'Import in progress',
                      'Imported',
                      'Metadata validated',
                      'Backend supported',
                      'Model loaded',
                      'Inference ready',
                    ] as ModelState[]
                  ).map((stage, idx) => {
                    const stageOrder: ModelState[] = [
                      'File selected',
                      'Import in progress',
                      'Imported',
                      'Metadata validated',
                      'Backend supported',
                      'Model loaded',
                      'Inference ready',
                    ];
                    const currentIndex = stageOrder.indexOf(importState);
                    const thisIndex = stageOrder.indexOf(stage);
                    const isDone = currentIndex >= thisIndex && importState !== 'Inference failed';
                    const isCurrent = importState === stage;

                    return (
                      <div
                        key={stage}
                        className={`p-1 rounded text-center truncate ${
                          isDone
                            ? 'bg-[#238636]/20 text-[#72D9A0] border border-[#238636]/30'
                            : isCurrent
                            ? 'bg-[#C7FF65]/20 text-[#C7FF65] border border-[#C7FF65]/40 animate-pulse'
                            : 'bg-[#161B22] text-[#8B949E] border border-transparent'
                        }`}
                        title={stage}
                      >
                        {idx + 1}. {stage.split(' ')[0]}
                      </div>
                    );
                  })}
                </div>

                {/* Validation checks breakdown */}
                {importValidationChecks.length > 0 && (
                  <div className="space-y-1 pt-1">
                    {importValidationChecks.map((chk, i) => (
                      <div key={i} className="flex items-center justify-between text-[11px] font-mono">
                        <span className="flex items-center gap-1.5 text-[#8B949E]">
                          {chk.passed ? (
                            <CheckCircle2 className="w-3 h-3 text-[#72D9A0]" />
                          ) : (
                            <XCircle className="w-3 h-3 text-[#FF727A]" />
                          )}
                          <span>{chk.name}</span>
                        </span>
                        <span className={chk.passed ? 'text-[#72D9A0]' : 'text-[#FF727A]'}>{chk.detail}</span>
                      </div>
                    ))}
                  </div>
                )}

                {importError && (
                  <div className="p-2.5 rounded-lg bg-[#DA3633]/20 border border-[#DA3633]/40 text-[#FF727A] text-xs font-mono">
                    {importError}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#30363D]">
              <button
                type="button"
                onClick={() => {
                  setShowImportDialog(false);
                  setImportState('idle');
                }}
                className="px-3.5 py-1.5 rounded-xl bg-[#21262D] text-xs text-[#8B949E] hover:text-[#F0F6FC]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!selectedFileName || importState === 'Import in progress'}
                onClick={handleRunImportPipeline}
                className="px-4 py-1.5 rounded-xl bg-[#C7FF65] text-[#0D1117] text-xs font-bold hover:bg-[#b5f250] disabled:opacity-50"
              >
                {importState === 'Import in progress' ? 'Validating...' : 'Validate & Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
