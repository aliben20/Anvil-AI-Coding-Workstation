import React, { useState, useEffect, useRef } from 'react';
import {
  Layers,
  Play,
  Square,
  RotateCcw,
  Check,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  FileCode,
  Code2,
  Terminal,
  Search,
  ChevronRight,
  ChevronDown,
  Settings,
  RefreshCw,
  Eye,
  ArrowRight,
  Shield,
  Zap,
  Cpu,
  Clock,
  Sparkles,
  ExternalLink,
  GitBranch,
} from 'lucide-react';

export interface DuetAgentViewProps {
  activeWorkspaceId: string;
  onNavigateToWorkspace?: (wsId: string) => void;
}

interface AgentConfig {
  id: string;
  name: string;
  provider: string;
  model: string;
  role: 'primary' | 'collaborator';
  status: 'idle' | 'running' | 'waiting' | 'reviewing' | 'completed' | 'failed';
  currentStep: string;
  toolCalls: Array<{
    id: string;
    tool: string;
    target: string;
    durationMs?: number;
    status: 'completed' | 'running' | 'failed' | 'warning';
    detail?: string;
  }>;
  diffSnippet?: {
    file: string;
    lines: string;
    code: Array<{ type: 'context' | 'add' | 'del'; text: string }>;
  };
}

export const DuetAgentView: React.FC<DuetAgentViewProps> = ({
  activeWorkspaceId,
}) => {
  // Mobile tab state
  const [mobileTab, setMobileTab] = useState<'primary' | 'collaborator' | 'result'>('primary');

  // Duet Session States: 'empty' | 'running' | 'completed' | 'diverged'
  const [sessionStatus, setSessionStatus] = useState<'empty' | 'running' | 'completed' | 'diverged'>('running');
  const [taskPrompt, setTaskPrompt] = useState<string>(
    'Refactor Windows PTY session manager to handle SIGINT cancellation cleanly without dropping pipe buffers'
  );
  const [contextFile, setContextFile] = useState<string>('src/server/ptySessionManager.ts (+142 lines)');

  // Selected Providers/Models
  const [primaryAgent, setPrimaryAgent] = useState<AgentConfig>({
    id: 'primary-claude',
    name: 'Claude 3.5 Sonnet',
    provider: 'Anthropic Cloud',
    model: 'claude-3-5-sonnet-20241022',
    role: 'primary',
    status: 'running',
    currentStep: 'Implementing AbortController signal routing in child_process.spawn',
    toolCalls: [
      { id: 'tc-1', tool: 'READ_FILE', target: 'src/server/ptySessionManager.ts', durationMs: 24, status: 'completed' },
      { id: 'tc-2', tool: 'PROPOSE_PATCH', target: 'Added AbortSignal listener on SIGINT (38 lines)', durationMs: 140, status: 'completed' },
      { id: 'tc-3', tool: 'RUN_COMMAND', target: 'npm run test:terminal', status: 'running', detail: 'Executing PTY test suite...' },
    ],
    diffSnippet: {
      file: 'src/server/ptySessionManager.ts',
      lines: 'Lines: 82-99',
      code: [
        { type: 'context', text: "  const session = this.activeSessions.get(id);" },
        { type: 'del', text: "- process.on('SIGINT', () => this.rawKill());" },
        { type: 'add', text: "+ this.abortCtrl.signal.addEventListener('abort', () => {" },
        { type: 'add', text: "+   this.flushPtyPipeBuffer();" },
        { type: 'add', text: "+   treeKill(this.ptyProcess.pid, 'SIGKILL');" },
        { type: 'add', text: "+ });" },
      ],
    },
  });

  const [collaboratorAgent, setCollaboratorAgent] = useState<AgentConfig>({
    id: 'collab-llama',
    name: 'Llama 3.3 70B',
    provider: 'Ollama Local',
    model: 'llama3.3:70b-instruct',
    role: 'collaborator',
    status: 'reviewing',
    currentStep: 'Verifying signal propagation and writing Windows cmd.exe fallback test',
    toolCalls: [
      { id: 'tc-4', tool: 'READ_FILE', target: 'src/server/ptySessionManager.ts', durationMs: 18, status: 'completed' },
      { id: 'tc-5', tool: 'AUDIT_LOGIC', target: 'Flagged potential zombie process on Windows tree kill', status: 'warning', detail: 'PowerShell nested scripts may orphan console handles' },
      { id: 'tc-6', tool: 'WRITE_FILE', target: 'tests/ptyCancellation.test.ts', durationMs: 95, status: 'completed', detail: '+88 lines created' },
    ],
  });

  // Companion health status
  const [companionOnline, setCompanionOnline] = useState<boolean>(true);

  useEffect(() => {
    fetch('http://127.0.0.1:3842/api/health')
      .then((r) => r.json())
      .then((d) => setCompanionOnline(d.status === 'ok'))
      .catch(() => setCompanionOnline(false));
  }, []);

  const handleStartDuet = () => {
    if (!taskPrompt.trim()) return;
    setSessionStatus('running');
  };

  const handleStopDuet = () => {
    setSessionStatus('empty');
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#0D0F12] text-[#E8EAED] overflow-y-auto font-sans">
      {/* 1. Header Bar */}
      <div className="px-4 sm:px-6 py-3.5 border-b border-[#292E36] bg-[#15181D] flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-[#9299A5] mb-0.5">
            <span>OBSIDIAN</span>
            <span>/</span>
            <span>Agents</span>
            <span>/</span>
            <span className="text-[#C7FF65]">Duet Agent</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-[#E8EAED] flex items-center gap-2">
              <span className="text-[#C7FF65]">Duet Agent</span>
            </h1>
            <span className="text-xs text-[#9299A5] hidden md:inline">
              Two agents. One shared objective.
            </span>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium bg-[#C7FF65]/10 text-[#C7FF65] border border-[#C7FF65]/30">
              <span className="w-1.5 h-1.5 rounded-full bg-[#C7FF65] animate-pulse" />
              <span>{sessionStatus === 'running' ? 'Active Session (Turn #4)' : 'Ready'}</span>
            </div>
            {companionOnline && (
              <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-[#1B1F25] text-[#9299A5] border border-[#292E36]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
                Companion :3842
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-xs font-mono bg-[#1B1F25] border border-[#292E36] px-2.5 py-1.5 rounded-lg text-[#9299A5] flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5 text-[#388BFD]" />
            <span className="text-[#E8EAED] font-semibold">{activeWorkspaceId || 'android-workstation'}</span>
          </div>
          <button
            type="button"
            onClick={() => setSessionStatus('empty')}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#21262D] hover:bg-[#30363D] text-[#E8EAED] border border-[#292E36] transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>New Session</span>
          </button>
        </div>
      </div>

      {/* 2. Task Composer Panel */}
      <div className="p-4 sm:p-6 pb-2 shrink-0">
        <div className="bg-[#15181D] border border-[#292E36] rounded-xl p-4 sm:p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#292E36]/60 pb-3">
            <span className="text-xs font-mono font-semibold uppercase tracking-wider text-[#9299A5]">
              Shared Objective & Workspace Context
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono bg-[#0D0F12] border border-[#292E36] px-2 py-0.5 rounded text-[#C7FF65] flex items-center gap-1">
                <FileCode className="w-3 h-3" />
                {contextFile}
              </span>
            </div>
          </div>

          <div>
            <textarea
              rows={2}
              value={taskPrompt}
              onChange={(e) => setTaskPrompt(e.target.value)}
              placeholder="Describe what you want both agents to work on together..."
              className="w-full bg-[#0D0F12] border border-[#292E36] rounded-lg p-3 text-sm text-[#E8EAED] placeholder-[#9299A5] focus:outline-none focus:border-[#C7FF65]/60 transition-colors font-mono resize-none"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            {/* Primary Agent Selector */}
            <div className="bg-[#1B1F25] border border-[#292E36] rounded-lg p-3 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-mono uppercase text-[#388BFD] font-bold tracking-wider flex items-center gap-1.5 mb-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#388BFD]" />
                  Primary Agent
                </div>
                <div className="text-xs font-semibold text-[#E8EAED]">{primaryAgent.name}</div>
                <div className="text-[11px] text-[#9299A5] font-mono">{primaryAgent.provider}</div>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#22C55E]/10 text-[#22C55E] border border-[#22C55E]/30">
                Configured
              </span>
            </div>

            {/* Collaborating Agent Selector */}
            <div className="bg-[#1B1F25] border border-[#292E36] rounded-lg p-3 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-mono uppercase text-[#A371F7] font-bold tracking-wider flex items-center gap-1.5 mb-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#A371F7]" />
                  Collaborating Agent
                </div>
                <div className="text-xs font-semibold text-[#E8EAED]">{collaboratorAgent.name}</div>
                <div className="text-[11px] text-[#9299A5] font-mono">{collaboratorAgent.provider}</div>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#22C55E]/10 text-[#22C55E] border border-[#22C55E]/30">
                Configured
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-[#9299A5] hidden sm:inline">
              Both agents share the project workspace filesystem and coordinate turn-by-turn.
            </span>
            <div className="flex items-center gap-2 ml-auto">
              {sessionStatus === 'running' ? (
                <button
                  type="button"
                  onClick={handleStopDuet}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-[#FF727A]/10 hover:bg-[#FF727A]/20 text-[#FF727A] border border-[#FF727A]/30 transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>Stop Duet</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStartDuet}
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-[#C7FF65] hover:bg-[#b8f550] text-[#0D0F12] shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Start Duet</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Mobile View Switcher (Visible on small screens) */}
      <div className="md:hidden px-4 pt-2">
        <div className="flex items-center rounded-xl bg-[#15181D] border border-[#292E36] p-1 gap-1">
          <button
            type="button"
            onClick={() => setMobileTab('primary')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg text-center transition-all ${
              mobileTab === 'primary'
                ? 'bg-[#21262D] text-[#388BFD] border border-[#388BFD]/30 shadow-sm'
                : 'text-[#9299A5]'
            }`}
          >
            Primary (Claude)
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('collaborator')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg text-center transition-all ${
              mobileTab === 'collaborator'
                ? 'bg-[#21262D] text-[#A371F7] border border-[#A371F7]/30 shadow-sm'
                : 'text-[#9299A5]'
            }`}
          >
            Collaborator (Llama)
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('result')}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg text-center transition-all ${
              mobileTab === 'result'
                ? 'bg-[#21262D] text-[#C7FF65] border border-[#C7FF65]/30 shadow-sm'
                : 'text-[#9299A5]'
            }`}
          >
            Shared Result
          </button>
        </div>
      </div>

      {/* 4. Two-Agent Workspace Layout */}
      <div className="p-4 sm:p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
          {/* LEFT PANEL: PRIMARY AGENT */}
          <div
            className={`bg-[#15181D] border border-[#292E36] rounded-xl p-4 sm:p-5 space-y-4 ${
              mobileTab !== 'primary' ? 'hidden md:block' : ''
            }`}
          >
            <div className="flex items-center justify-between border-b border-[#292E36] pb-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#388BFD] shadow-[0_0_8px_#388BFD]" />
                <span className="font-semibold text-sm text-[#E8EAED]">{primaryAgent.name}</span>
                <span className="px-2 py-0.2 rounded text-[10px] font-mono font-bold uppercase bg-[#388BFD]/15 text-[#388BFD] border border-[#388BFD]/30">
                  Primary
                </span>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E] animate-pulse" />
                Running (Tool Call #3)
              </span>
            </div>

            <div className="text-xs text-[#9299A5] font-mono bg-[#0D0F12] border border-[#292E36] p-2.5 rounded-lg">
              <span className="text-[#388BFD] font-bold">Subtask: </span>
              {primaryAgent.currentStep}
            </div>

            {/* Execution Timeline */}
            <div className="space-y-2">
              <div className="text-[11px] font-mono uppercase text-[#9299A5] flex items-center justify-between">
                <span>Execution Timeline</span>
                <span className="text-[#388BFD]">TURN #04</span>
              </div>
              <div className="space-y-1.5">
                {primaryAgent.toolCalls.map((tc) => (
                  <div
                    key={tc.id}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#1B1F25] border border-[#292E36] text-xs font-mono"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#388BFD]/20 text-[#388BFD]">
                        {tc.tool}
                      </span>
                      <span className="text-[#E8EAED] truncate">{tc.target}</span>
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5 text-[11px] text-[#9299A5]">
                      {tc.status === 'completed' ? (
                        <>
                          <span>{tc.durationMs}ms</span>
                          <Check className="w-3.5 h-3.5 text-[#22C55E]" />
                        </>
                      ) : (
                        <span className="text-[#C7FF65] flex items-center gap-1">
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          Running...
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Diff Snippet Preview */}
            {primaryAgent.diffSnippet && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-mono text-[#9299A5]">
                  <span className="text-[#E8EAED] font-semibold">{primaryAgent.diffSnippet.file}</span>
                  <span>{primaryAgent.diffSnippet.lines}</span>
                </div>
                <div className="bg-[#0D0F12] border border-[#292E36] rounded-lg p-3 font-mono text-[11px] overflow-x-auto">
                  {primaryAgent.diffSnippet.code.map((line, idx) => (
                    <div
                      key={idx}
                      className={`leading-5 ${
                        line.type === 'del'
                          ? 'text-[#FF727A] bg-[#FF727A]/10 px-1 rounded'
                          : line.type === 'add'
                          ? 'text-[#22C55E] bg-[#22C55E]/10 px-1 rounded font-medium'
                          : 'text-[#9299A5]'
                      }`}
                    >
                      {line.text}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT PANEL: COLLABORATING AGENT */}
          <div
            className={`bg-[#15181D] border border-[#292E36] rounded-xl p-4 sm:p-5 space-y-4 ${
              mobileTab !== 'collaborator' ? 'hidden md:block' : ''
            }`}
          >
            <div className="flex items-center justify-between border-b border-[#292E36] pb-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#A371F7] shadow-[0_0_8px_#A371F7]" />
                <span className="font-semibold text-sm text-[#E8EAED]">{collaboratorAgent.name}</span>
                <span className="px-2 py-0.2 rounded text-[10px] font-mono font-bold uppercase bg-[#A371F7]/15 text-[#A371F7] border border-[#A371F7]/30">
                  Collaborator
                </span>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-[#A371F7]/15 text-[#A371F7] border border-[#A371F7]/30 flex items-center gap-1">
                Auditing & Proposing Tests
              </span>
            </div>

            <div className="text-xs text-[#9299A5] font-mono bg-[#0D0F12] border border-[#292E36] p-2.5 rounded-lg">
              <span className="text-[#A371F7] font-bold">Subtask: </span>
              {collaboratorAgent.currentStep}
            </div>

            {/* Audit & Test Activity */}
            <div className="space-y-2">
              <div className="text-[11px] font-mono uppercase text-[#9299A5] flex items-center justify-between">
                <span>Audit & Test Activity</span>
                <span className="text-[#A371F7]">TURN #04</span>
              </div>
              <div className="space-y-1.5">
                {collaboratorAgent.toolCalls.map((tc) => (
                  <div
                    key={tc.id}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#1B1F25] border border-[#292E36] text-xs font-mono"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#A371F7]/20 text-[#A371F7]">
                        {tc.tool}
                      </span>
                      <span className="text-[#E8EAED] truncate">{tc.target}</span>
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5 text-[11px] text-[#9299A5]">
                      {tc.status === 'warning' ? (
                        <span className="text-[#F59E0B] flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" />
                        </span>
                      ) : (
                        <>
                          {tc.durationMs && <span>{tc.durationMs}ms</span>}
                          <Check className="w-3.5 h-3.5 text-[#22C55E]" />
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Collaborator Review Note */}
            <div className="bg-[#1B1F25] border border-[#292E36] rounded-lg p-3 text-xs space-y-2">
              <div className="font-semibold text-[#E8EAED] flex items-center gap-1.5 text-[11px]">
                <Shield className="w-3.5 h-3.5 text-[#A371F7]" />
                Collaborator Assessment & Test Strategy
              </div>
              <p className="text-[#9299A5] text-[11px] leading-relaxed">
                Created test harness in <code className="text-[#A371F7] font-mono">tests/ptyCancellation.test.ts</code> (+88 lines) simulating rapid Ctrl+C interrupts. Recommends flushing stdout buffers before invoking process termination to avoid dropping terminal history.
              </p>
              <div className="text-[10px] font-mono text-[#22C55E] flex items-center gap-1 pt-1">
                <CheckCircle2 className="w-3 h-3" />
                Awaiting Primary patch compilation before running verification suite.
              </div>
            </div>
          </div>
        </div>

        {/* 5. Shared Result Section (Full-width) */}
        <div
          className={`bg-[#15181D] border border-[#292E36] rounded-xl p-4 sm:p-5 space-y-4 ${
            mobileTab !== 'result' ? 'hidden md:block' : ''
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#292E36] pb-3">
            <div className="flex items-center gap-2.5">
              <span className="font-bold text-sm text-[#E8EAED]">Shared Result</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#F59E0B]/15 text-[#F59E0B] border border-[#F59E0B]/30 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                1 Discrepancy / Alternative Approach Detected
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono text-[#9299A5]">
              <span>Modified:</span>
              <span className="text-[#22C55E]">src/server/ptySessionManager.ts (+42, -18)</span>
              <span className="text-[#388BFD]">tests/ptyCancellation.test.ts (+88, -0)</span>
            </div>
          </div>

          {/* Comparison Cards: Primary vs Collaborator */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <div className="bg-[#1B1F25] border border-[#388BFD]/40 rounded-lg p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-[#388BFD] flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#388BFD]" />
                  PRIMARY APPROACH (CLAUDE)
                </div>
                <span className="text-[10px] font-mono text-[#9299A5]">Tree-kill via AbortSignal</span>
              </div>
              <p className="text-[11px] text-[#9299A5] leading-relaxed">
                Triggers <code className="text-[#388BFD] font-mono">tree-kill(pid, 'SIGINT')</code> directly on signal abortion. Fast execution, but may orphan sub-child pipes if PowerShell spawns nested batch scripts.
              </p>
              <div className="flex items-center gap-2 pt-1 text-[10px] font-mono text-[#22C55E]">
                <span>✓ Clean pipe flush</span>
                <span className="text-[#9299A5]">•</span>
                <span className="text-[#F59E0B]">⚠ Windows edge case</span>
              </div>
            </div>

            <div className="bg-[#1B1F25] border border-[#A371F7]/40 rounded-lg p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-[#A371F7] flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#A371F7]" />
                  COLLABORATOR ALTERNATIVE (LLAMA)
                </div>
                <span className="text-[10px] font-mono text-[#9299A5]">Interactive \x03 Byte Injection</span>
              </div>
              <p className="text-[11px] text-[#9299A5] leading-relaxed">
                Injects raw <code className="text-[#A371F7] font-mono">\x03</code> (ETX / Ctrl+C) into the stdin stream before signal termination. Gracefully notifies cmd.exe runtime to exit sub-shells without kernel-forced termination.
              </p>
              <div className="flex items-center gap-2 pt-1 text-[10px] font-mono text-[#22C55E]">
                <span>✓ 0 Zombie Processes</span>
                <span className="text-[#9299A5]">•</span>
                <span>✓ Recommended by Tests</span>
              </div>
            </div>
          </div>

          {/* Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#21262D] hover:bg-[#30363D] text-[#E8EAED] border border-[#292E36] transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Review Changes (Diff)</span>
              </button>
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#21262D] hover:bg-[#30363D] text-[#388BFD] border border-[#292E36] transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Run Verification Tests</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#FF727A] hover:bg-[#FF727A]/10 border border-[#FF727A]/30 transition-colors cursor-pointer"
              >
                Reject / Rollback
              </button>
              <button
                type="button"
                className="px-4 py-1.5 rounded-lg text-xs font-bold bg-[#C7FF65] hover:bg-[#b8f550] text-[#0D0F12] shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Continue Turn</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 6. Footer Telemetry Bar */}
      <div className="mt-auto px-4 sm:px-6 py-2.5 border-t border-[#292E36] bg-[#11141A] text-[11px] font-mono text-[#9299A5] flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-[#E8EAED]">
            <GitBranch className="w-3 h-3 text-[#388BFD]" />
            main (3 uncommitted patches)
          </span>
          <span>•</span>
          <span className="text-[#C7FF65]">Duet Synced: 2 Active Peers</span>
        </div>
        <div className="flex items-center gap-3">
          <span>Context: 36.3k / 128k</span>
          <span>•</span>
          <span>Memory: 412 MB</span>
          <span>•</span>
          <span className="text-[#C7FF65] font-bold">OBSIDIAN v3.6.1</span>
        </div>
      </div>
    </div>
  );
};
