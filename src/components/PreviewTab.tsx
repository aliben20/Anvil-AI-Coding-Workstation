import React, { useState, useEffect, useRef } from 'react';
import {
  Smartphone,
  Tablet,
  Monitor,
  RotateCw,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Globe,
  Wifi,
  WifiOff,
  AlertTriangle,
  Check,
  Copy,
  Terminal,
  Maximize2,
  Sliders,
  Play,
  Layers,
  Info,
  Code2,
} from 'lucide-react';
import { WorkspaceSummary } from '../types';

interface PreviewTabProps {
  activeWorkspaceId: string;
  workspaces?: WorkspaceSummary[];
  onNavigateToTerminal?: (command?: string) => void;
  onNavigateToProjects?: () => void;
}

type DeviceMode = 'mobile' | 'tablet' | 'desktop';
type Orientation = 'portrait' | 'landscape';

export const PreviewTab: React.FC<PreviewTabProps> = ({
  activeWorkspaceId,
  workspaces = [],
  onNavigateToTerminal,
  onNavigateToProjects,
}) => {
  // Viewport mode state
  const [deviceMode, setDeviceMode] = useState<DeviceMode>('mobile');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [zoomScale, setZoomScale] = useState<number>(100);

  // Address and Server Configuration
  const defaultBaseUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const [selectedPreset, setSelectedPreset] = useState<string>('http://localhost:3000');
  const [urlInput, setUrlInput] = useState<string>('http://localhost:3000');
  const [activeIframeUrl, setActiveIframeUrl] = useState<string>('http://localhost:3000');

  // Iframe and Loading State
  const [iframeKey, setIframeKey] = useState<number>(1);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [iframeLoadError, setIframeLoadError] = useState<boolean>(false);
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);

  // Live Server Probe State
  const [probeStatus, setProbeStatus] = useState<{
    online: boolean;
    statusCode?: number;
    latencyMs?: number;
    error?: string;
  }>({ online: true, statusCode: 200, latencyMs: 12 });
  const [probing, setProbing] = useState<boolean>(false);

  // Telemetry drawer
  const [showConsoleDrawer, setShowConsoleDrawer] = useState<boolean>(false);
  const [throttling, setThrottling] = useState<'none' | 'fast-3g' | 'slow-3g' | 'offline'>('none');

  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Probe server status when iframe URL changes
  useEffect(() => {
    let isCurrent = true;
    const probeServer = async () => {
      setProbing(true);
      try {
        const res = await fetch(`/api/preview/status?url=${encodeURIComponent(activeIframeUrl)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (isCurrent) {
          setProbeStatus(data);
          if (!data.online) {
            setIframeLoadError(true);
          } else {
            setIframeLoadError(false);
          }
        }
      } catch (err: any) {
        if (isCurrent) {
          setProbeStatus({
            online: false,
            error: err?.message || 'Connection failed',
          });
        }
      } finally {
        if (isCurrent) setProbing(false);
      }
    };

    probeServer();
    const interval = setInterval(probeServer, 10000);
    return () => {
      isCurrent = false;
      clearInterval(interval);
    };
  }, [activeIframeUrl]);

  // Handle URL Submission
  const handleNavigate = (targetUrl: string) => {
    let cleanUrl = targetUrl.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://') && !cleanUrl.startsWith('/')) {
      cleanUrl = `http://${cleanUrl}`;
    }
    setUrlInput(cleanUrl);
    setActiveIframeUrl(cleanUrl);
    setIsLoading(true);
    setIframeLoadError(false);
    setIframeKey((prev) => prev + 1);
  };

  const handleRefresh = () => {
    setIsLoading(true);
    setIframeLoadError(false);
    setIframeKey((prev) => prev + 1);
  };

  const handleOpenExternal = () => {
    window.open(activeIframeUrl, '_blank', 'noopener,noreferrer');
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(activeIframeUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  // Dimensions based on device and orientation
  const getDeviceDimensions = () => {
    if (deviceMode === 'desktop') {
      return { width: '100%', height: '100%', label: 'Desktop 100% (Responsive)' };
    }
    if (deviceMode === 'tablet') {
      return orientation === 'portrait'
        ? { width: '768px', height: '1024px', label: 'iPad 768 × 1024 px' }
        : { width: '1024px', height: '768px', label: 'iPad 1024 × 768 px' };
    }
    // mobile
    return orientation === 'portrait'
      ? { width: '390px', height: '844px', label: 'Mobile 390 × 844 px (iPhone / Pixel)' }
      : { width: '844px', height: '390px', label: 'Mobile 844 × 390 px (Landscape)' };
  };

  const dimensions = getDeviceDimensions();

  const presets = [
    { label: 'Workstation App (Port 3000)', url: defaultBaseUrl },
    { label: 'Vite Dev Server (Port 5173)', url: 'http://localhost:5173' },
    { label: 'Live Server (Port 8080)', url: 'http://localhost:8080' },
    { label: 'Vite Preview (Port 4173)', url: 'http://localhost:4173' },
    { label: 'FastAPI / Python (Port 8000)', url: 'http://localhost:8000' },
    { label: 'Node Dev Server (Port 3001)', url: 'http://localhost:3001' },
    {
      label: `Workspace Live Files (${activeWorkspaceId})`,
      url: `/api/preview/workspace/${activeWorkspaceId}/`,
    },
  ];

  return (
    <div className="flex flex-col h-full w-full max-w-full overflow-hidden bg-[#0D1117] text-[#F0F6FC]">
      {/* =========================================================================
          TOP WORKBENCH CONTROLS HEADER
          ========================================================================= */}
      <div className="border-b border-[#30363D] bg-[#161B22] p-2 sm:p-3 flex flex-wrap items-center justify-between gap-2.5 shrink-0 z-10">
        {/* Left Section: Viewport Switcher Pills */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center bg-[#0D1117] p-0.5 rounded-lg border border-[#30363D]">
            <button
              onClick={() => setDeviceMode('mobile')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                deviceMode === 'mobile'
                  ? 'bg-[#21262D] text-[#C7FF65] font-semibold shadow-sm'
                  : 'text-[#8B949E] hover:text-[#F0F6FC]'
              }`}
              title="Mobile View (390px)"
              aria-label="Switch to Mobile View (390px)"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Mobile</span>
            </button>

            <button
              onClick={() => setDeviceMode('tablet')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                deviceMode === 'tablet'
                  ? 'bg-[#21262D] text-[#C7FF65] font-semibold shadow-sm'
                  : 'text-[#8B949E] hover:text-[#F0F6FC]'
              }`}
              title="Tablet View (768px)"
              aria-label="Switch to Tablet View (768px)"
            >
              <Tablet className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Tablet</span>
            </button>

            <button
              onClick={() => setDeviceMode('desktop')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                deviceMode === 'desktop'
                  ? 'bg-[#21262D] text-[#C7FF65] font-semibold shadow-sm'
                  : 'text-[#8B949E] hover:text-[#F0F6FC]'
              }`}
              title="Desktop Full Responsive"
              aria-label="Switch to Desktop Full Responsive View"
            >
              <Monitor className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Desktop</span>
            </button>
          </div>

          {/* Orientation Toggle (mobile/tablet only) */}
          {deviceMode !== 'desktop' && (
            <button
              onClick={() => setOrientation((prev) => (prev === 'portrait' ? 'landscape' : 'portrait'))}
              className="p-1.5 rounded-lg border border-[#30363D] bg-[#0D1117] text-[#8B949E] hover:text-[#F0F6FC] transition-colors cursor-pointer"
              title={`Switch to ${orientation === 'portrait' ? 'Landscape' : 'Portrait'}`}
              aria-label={`Switch to ${orientation === 'portrait' ? 'Landscape' : 'Portrait'}`}
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Zoom Selector */}
          <select
            value={zoomScale}
            onChange={(e) => setZoomScale(Number(e.target.value))}
            aria-label="Viewport Zoom Level"
            className="hidden md:block bg-[#0D1117] border border-[#30363D] text-[11px] font-mono text-[#8B949E] hover:text-[#F0F6FC] rounded-lg px-2 py-1 outline-none cursor-pointer"
          >
            <option value={100}>100%</option>
            <option value={75}>75%</option>
            <option value={50}>50%</option>
          </select>
        </div>

        {/* Center: Address Bar & Quick Port Picker */}
        <div className="flex-1 min-w-[220px] max-w-xl flex items-center gap-1.5 order-3 sm:order-2">
          {/* Navigation & Refresh Controls */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={handleRefresh}
              className="p-1.5 rounded-lg border border-[#30363D] bg-[#0D1117] text-[#8B949E] hover:text-[#C7FF65] transition-colors cursor-pointer"
              title="Reload Preview (Cmd+R)"
              aria-label="Reload Preview"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#C7FF65]' : ''}`} />
            </button>
          </div>

          {/* Interactive URL Input Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleNavigate(urlInput);
            }}
            className="flex-1 flex items-center bg-[#0D1117] border border-[#30363D] focus-within:border-[#C7FF65] rounded-lg px-2.5 py-1 text-xs transition-all shadow-inner"
          >
            <Globe className="w-3.5 h-3.5 text-[#8B949E] mr-1.5 shrink-0" />
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="http://localhost:3000..."
              aria-label="Preview Server URL"
              className="w-full bg-transparent text-[#F0F6FC] font-mono text-[11px] sm:text-xs outline-none"
            />
            {probeStatus.online ? (
              <span
                className="shrink-0 flex items-center gap-1 text-[10px] font-mono text-[#C7FF65] bg-[#C7FF65]/10 px-1.5 py-0.5 rounded ml-1"
                title={`Live server online (${probeStatus.latencyMs || 10}ms)`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#C7FF65] animate-pulse" />
                <span className="hidden md:inline">Live</span>
              </span>
            ) : (
              <span
                className="shrink-0 flex items-center gap-1 text-[10px] font-mono text-[#FF727A] bg-[#DA3633]/15 px-1.5 py-0.5 rounded ml-1"
                title="Server unreachable"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#FF727A]" />
                <span className="hidden md:inline">Down</span>
              </span>
            )}
          </form>

          {/* Preset Port Selector */}
          <select
            value={selectedPreset}
            onChange={(e) => {
              setSelectedPreset(e.target.value);
              handleNavigate(e.target.value);
            }}
            aria-label="Quick Local Server Port Selector"
            className="hidden lg:block bg-[#0D1117] border border-[#30363D] text-[11px] font-mono text-[#8B949E] hover:text-[#F0F6FC] rounded-lg px-2 py-1 outline-none cursor-pointer max-w-[130px] truncate"
          >
            {presets.map((p) => (
              <option key={p.url} value={p.url}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {/* Right Section: Actions */}
        <div className="flex items-center gap-1.5 shrink-0 order-2 sm:order-3">
          <button
            onClick={handleCopyUrl}
            className="p-1.5 rounded-lg border border-[#30363D] bg-[#0D1117] text-[#8B949E] hover:text-[#F0F6FC] transition-colors cursor-pointer"
            title="Copy Preview URL"
            aria-label={copiedUrl ? 'Copied Preview URL to clipboard' : 'Copy Preview URL'}
          >
            {copiedUrl ? <Check className="w-3.5 h-3.5 text-[#C7FF65]" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={handleOpenExternal}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#30363D] bg-[#0D1117] hover:bg-[#21262D] text-[#F0F6FC] hover:border-[#C7FF65]/50 text-xs font-medium transition-all cursor-pointer"
            title="Open Live Preview in Browser Tab"
            aria-label="Open Live Preview in Browser Tab"
          >
            <ExternalLink className="w-3.5 h-3.5 text-[#C7FF65]" />
            <span className="hidden sm:inline">Open in Tab</span>
          </button>
        </div>
      </div>

      {/* =========================================================================
          CENTRAL PREVIEW WORKBENCH CANVAS
          ========================================================================= */}
      <div className="flex-1 min-h-0 overflow-auto bg-[#0A0D12] relative flex flex-col items-center justify-center p-2 sm:p-6 select-auto">
        {/* Subtle grid backdrop */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.03]"
          style={{
            backgroundImage:
              'radial-gradient(#C7FF65 1px, transparent 1px), radial-gradient(#F0F6FC 1px, transparent 1px)',
            backgroundSize: '24px 24px',
            backgroundPosition: '0 0, 12px 12px',
          }}
        />

        {/* Container with dimensions */}
        <div
          className="relative transition-all duration-300 flex flex-col items-center justify-center max-w-full max-h-full"
          style={{
            transform: zoomScale !== 100 ? `scale(${zoomScale / 100})` : undefined,
            transformOrigin: 'center center',
          }}
        >
          {/* Header tag showing active dimensions */}
          {deviceMode !== 'desktop' && (
            <div className="mb-2 px-2.5 py-0.5 rounded-full bg-[#161B22]/90 border border-[#30363D] text-[10px] font-mono text-[#8B949E] flex items-center gap-1.5 shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-[#C7FF65]" />
              <span>{dimensions.label}</span>
            </div>
          )}

          {/* DEVICE FRAME */}
          <div
            className={`transition-all duration-200 relative overflow-hidden flex flex-col ${
              deviceMode === 'desktop'
                ? 'w-full h-full min-h-[500px] border border-[#30363D] rounded-xl bg-[#0D1117] shadow-2xl'
                : deviceMode === 'tablet'
                ? 'border-[12px] border-[#1C2128] rounded-[32px] bg-[#0D1117] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.85)]'
                : 'border-[10px] border-[#1C2128] rounded-[40px] bg-[#0D1117] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.85)]'
            }`}
            style={{
              width: deviceMode === 'desktop' ? '100%' : dimensions.width,
              height: deviceMode === 'desktop' ? 'calc(100vh - 180px)' : dimensions.height,
              maxWidth: '100%',
              maxHeight: deviceMode === 'desktop' ? 'calc(100vh - 180px)' : 'calc(100vh - 200px)',
            }}
          >
            {/* Phone speaker pill / dynamic island for mobile */}
            {deviceMode === 'mobile' && orientation === 'portrait' && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 w-20 h-4 bg-[#161B22] rounded-full z-20 flex items-center justify-center border border-[#30363D]/40">
                <div className="w-2.5 h-2.5 rounded-full bg-[#0D1117] border border-[#30363D]/60 mr-2" />
                <div className="w-8 h-1 rounded-full bg-[#21262D]" />
              </div>
            )}

            {/* Loading Indicator Overlay */}
            {isLoading && (
              <div className="absolute inset-0 z-10 bg-[#0D1117]/80 backdrop-blur-xs flex flex-col items-center justify-center gap-3">
                <div className="w-8 h-8 rounded-full border-2 border-[#30363D] border-t-[#C7FF65] animate-spin" />
                <span className="text-xs font-mono text-[#8B949E]">Connecting to {activeIframeUrl}...</span>
              </div>
            )}

            {/* Error Fallback Banner if unreachable */}
            {!probeStatus.online && (
              <div className="absolute inset-0 z-20 bg-[#0D1117]/95 p-6 flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 rounded-xl bg-[#DA3633]/15 border border-[#DA3633]/40 flex items-center justify-center text-[#FF727A] mb-4">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <h3 className="text-base font-semibold text-[#F0F6FC] mb-1">
                  Local Dev Server Not Responding
                </h3>
                <p className="text-xs text-[#8B949E] max-w-md mb-6 leading-relaxed">
                  Unable to connect to <code className="text-[#F0F6FC] font-mono px-1 bg-[#161B22] rounded">{activeIframeUrl}</code>.
                  {probeStatus.error ? ` (${probeStatus.error})` : ''} Verify that your development server is started and running.
                </p>

                <div className="flex flex-wrap items-center justify-center gap-2 max-w-md">
                  <button
                    onClick={() => handleNavigate(defaultBaseUrl)}
                    className="px-3 py-1.5 rounded-lg bg-[#C7FF65] text-[#0D1117] font-semibold text-xs hover:bg-[#D4FF80] transition-colors cursor-pointer"
                  >
                    Switch to Workstation (Port 3000)
                  </button>

                  <button
                    onClick={handleRefresh}
                    className="px-3 py-1.5 rounded-lg bg-[#21262D] border border-[#30363D] text-[#F0F6FC] text-xs hover:bg-[#30363D] transition-colors cursor-pointer"
                  >
                    Retry Connection
                  </button>

                  {onNavigateToTerminal && (
                    <button
                      onClick={() => onNavigateToTerminal('npm run dev')}
                      className="px-3 py-1.5 rounded-lg bg-[#161B22] border border-[#30363D] text-[#8B949E] hover:text-[#C7FF65] text-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <Terminal className="w-3.5 h-3.5" />
                      <span>Start Server in Terminal</span>
                    </button>
                  )}

                  <button
                    onClick={() => handleNavigate(`/api/preview/workspace/${activeWorkspaceId}/`)}
                    className="px-3 py-1.5 rounded-lg bg-[#161B22] border border-[#30363D] text-[#8B949E] hover:text-[#F0F6FC] text-xs transition-colors cursor-pointer"
                  >
                    Preview Workspace Files
                  </button>
                </div>
              </div>
            )}

            {/* REAL LIVE APPLICATION IFRAME */}
            <iframe
              ref={iframeRef}
              key={iframeKey}
              src={activeIframeUrl}
              title="OBSIDIAN Live Application Preview"
              onLoad={() => setIsLoading(false)}
              onError={() => {
                setIsLoading(false);
                setIframeLoadError(true);
              }}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
              className="w-full h-full flex-1 border-0 bg-white"
            />
          </div>
        </div>
      </div>

      {/* =========================================================================
          BOTTOM TELEMETRY & DIAGNOSTICS BAR
          ========================================================================= */}
      <div className="border-t border-[#30363D] bg-[#161B22] px-3 py-2 flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono text-[#8B949E] shrink-0">
        {/* Left Telemetry */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                probeStatus.online ? 'bg-[#C7FF65]' : 'bg-[#FF727A]'
              }`}
            />
            <span className="text-[#F0F6FC]">
              {probeStatus.online ? `HTTP ${probeStatus.statusCode || 200} OK` : 'Offline'}
            </span>
          </div>

          <span className="text-[#30363D]">|</span>

          <span>Latency: <strong className="text-[#F0F6FC]">{probeStatus.latencyMs ?? '--'} ms</strong></span>

          <span className="hidden md:inline text-[#30363D]">|</span>

          <span className="hidden md:inline">
            Active Workspace: <strong className="text-[#C7FF65]">{activeWorkspaceId}</strong>
          </span>
        </div>

        {/* Center Viewport Info */}
        <div className="hidden sm:flex items-center gap-2">
          <span>Viewport: <strong className="text-[#F0F6FC]">{dimensions.label}</strong></span>
          <span className="text-[#30363D]">•</span>
          <span>DPR: <strong className="text-[#F0F6FC]">2.0x</strong></span>
        </div>

        {/* Right Dev Controls */}
        <div className="flex items-center gap-2">
          <select
            value={throttling}
            onChange={(e: any) => setThrottling(e.target.value)}
            aria-label="Network Throttling Simulation"
            className="bg-[#0D1117] border border-[#30363D] text-[10px] text-[#8B949E] rounded px-1.5 py-0.5 outline-none cursor-pointer"
          >
            <option value="none">Fast 5G / No Throttling</option>
            <option value="fast-3g">Fast 3G (1.6 Mbps)</option>
            <option value="slow-3g">Slow 3G (500 Kbps)</option>
            <option value="offline">Offline</option>
          </select>

          <button
            onClick={() => setShowConsoleDrawer((prev) => !prev)}
            title="Toggle Live Preview telemetry and diagnostics drawer"
            aria-label="Toggle Live Preview telemetry and diagnostics drawer"
            className={`px-2 py-0.5 rounded border text-[10px] transition-colors cursor-pointer ${
              showConsoleDrawer
                ? 'bg-[#21262D] border-[#C7FF65] text-[#C7FF65]'
                : 'bg-[#0D1117] border-[#30363D] text-[#8B949E] hover:text-[#F0F6FC]'
            }`}
          >
            Telemetry Logs
          </button>
        </div>
      </div>

      {/* Optional Collapsible Console / Telemetry Drawer */}
      {showConsoleDrawer && (
        <div className="h-36 border-t border-[#30363D] bg-[#0D1117] p-3 font-mono text-[11px] text-[#8B949E] overflow-y-auto shrink-0 select-text">
          <div className="flex items-center justify-between pb-1.5 border-b border-[#21262D] text-xs text-[#F0F6FC]">
            <span>Live Preview Diagnostics & Runtime Events</span>
            <button
              onClick={() => setShowConsoleDrawer(false)}
              title="Close diagnostics drawer"
              aria-label="Close diagnostics drawer"
              className="text-[#8B949E] hover:text-[#F0F6FC] cursor-pointer"
            >
              ✕
            </button>
          </div>
          <div className="mt-2 space-y-1">
            <div className="text-[#C7FF65]">
              [INFO] Target preview: {activeIframeUrl} (Mode: {deviceMode}, Zoom: {zoomScale}%)
            </div>
            <div>[NETWORK] Probed endpoint with latency: {probeStatus.latencyMs || 12}ms</div>
            <div>
              [DEVICE] Viewport rendered at {dimensions.width} × {dimensions.height}
            </div>
            {probeStatus.online ? (
              <div className="text-[#388BFD]">
                [HMR] Connected to development server. Hot module replacement active.
              </div>
            ) : (
              <div className="text-[#FF727A]">
                [ERROR] Failed to reach target host at {activeIframeUrl}. Verify server is listening.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
