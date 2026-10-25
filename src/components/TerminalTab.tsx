import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
  Terminal as TerminalIcon,
  Plus,
  Trash2,
  RotateCcw,
  Square,
  Copy,
  Check,
  ArrowDown,
  X,
  SlidersHorizontal,
  ClipboardPaste,
  Keyboard,
  AlertCircle,
  Layers,
  Folder,
  Cpu,
} from 'lucide-react';

interface TerminalSessionInfo {
  sessionId: string;
  title: string;
  workspaceId: string;
  workspaceRoot: string;
  cwd: string;
  shell: string;
  shellPid: number | null;
  bridgePid: number | null;
  ttyPath: string | null;
  transportMode: 'pty' | 'pipe';
  status: 'running' | 'exited' | 'error';
  exitCode: number | null;
  exitSignal: string | null;
  cols: number;
  rows: number;
  createdAtMillis: number;
  lastActivityMillis: number;
  errorMessage?: string;
  scrollback?: string;
}

interface TerminalTabProps {
  activeWorkspaceId: string;
  initialCommand?: string | null;
  onConsumeInitialCommand?: () => void;
}

const OBSIDIAN_XTERM_THEME = {
  background: '#090A0C',
  foreground: '#F4F5F6',
  cursor: '#C7FF65',
  cursorAccent: '#090A0C',
  selectionBackground: 'rgba(199, 255, 101, 0.22)',
  black: '#0E1013',
  red: '#FF727A',
  green: '#72D9A0',
  yellow: '#F4C46A',
  blue: '#8DA8FF',
  magenta: '#C59BFF',
  cyan: '#68E2E2',
  white: '#F4F5F6',
  brightBlack: '#6E7580',
  brightRed: '#FF8E94',
  brightGreen: '#C7FF65',
  brightYellow: '#FFD485',
  brightBlue: '#A6BCFF',
  brightMagenta: '#D8B9FF',
  brightCyan: '#8FF0F0',
  brightWhite: '#FFFFFF',
};

export const TerminalTab: React.FC<TerminalTabProps> = ({
  activeWorkspaceId,
  initialCommand,
  onConsumeInitialCommand,
}) => {
  const [sessions, setSessions] = useState<TerminalSessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [terminalToken, setTerminalToken] = useState<string>('');
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [npmConflictNotice, setNpmConflictNotice] = useState<{
    type: 'EEXIST' | 'ENOTEMPTY';
    message: string;
  } | null>(null);
  const [agentCommandNotice, setAgentCommandNotice] = useState<{
    state: string;
    command: string;
  } | null>(null);

  // Terminal Emulator Settings
  const [showSettings, setShowSettings] = useState(false);
  const [fontSize, setFontSize] = useState<number>(13);
  const [cursorBlink, setCursorBlink] = useState<boolean>(true);
  const [assistiveInput, setAssistiveInput] = useState<string>('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [showMobileInputBar, setShowMobileInputBar] = useState<boolean>(true);
  const [fnMode, setFnMode] = useState<boolean>(false);

  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const activeSessionIdRef = useRef<string>('');
  const tokenRef = useRef<string>('');
  const assistiveInputRef = useRef<HTMLInputElement | null>(null);
  const isScrolledUpRef = useRef<boolean>(false);

  activeSessionIdRef.current = activeSessionId;
  tokenRef.current = terminalToken;
  isScrolledUpRef.current = isScrolledUp;

  const activeSession = sessions.find((s) => s.sessionId === activeSessionId) || null;

  const authHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (tokenRef.current) {
      h['x-obsidian-terminal-token'] = tokenRef.current;
    }
    return h;
  }, []);

  const sendRawInput = useCallback(
    async (sessionId: string, data: string) => {
      if (!sessionId || !data) return;
      try {
        const res = await fetch(`/api/terminal/sessions/${encodeURIComponent(sessionId)}/input`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ data }),
        });
        const payload = await res.json();
        if (!res.ok) {
          setErrorBanner(payload.error || 'Failed to write input to PTY session');
        } else if (payload.session) {
          setSessions((prev) =>
            prev.map((s) => (s.sessionId === payload.session.sessionId ? payload.session : s))
          );
        }
      } catch (err) {
        setErrorBanner(err instanceof Error ? err.message : 'Input write failed');
      }
    },
    [authHeaders]
  );

  // Initialize xterm.js emulator instance once on mount
  useEffect(() => {
    if (!terminalContainerRef.current) return;

    const term = new Terminal({
      cursorBlink,
      fontSize,
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      lineHeight: 1.38,
      scrollback: 5000,
      convertEol: true,
      allowProposedApi: true,
      theme: OBSIDIAN_XTERM_THEME,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalContainerRef.current);

    // Optimize xterm's hidden helper textarea for mobile virtual keyboards
    const helperTextarea = terminalContainerRef.current.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
    if (helperTextarea) {
      helperTextarea.setAttribute('autocapitalize', 'none');
      helperTextarea.setAttribute('autocomplete', 'off');
      helperTextarea.setAttribute('autocorrect', 'off');
      helperTextarea.setAttribute('spellcheck', 'false');
      helperTextarea.setAttribute('enterkeyhint', 'go');
    }

    try {
      fitAddon.fit();
    } catch {
      // ignore if container is hidden initially
    }

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const onDataDisposable = term.onData((data) => {
      const sid = activeSessionIdRef.current;
      if (sid) {
        sendRawInput(sid, data);
      }
    });

    const scrollDisposable = term.onScroll(() => {
      const buffer = term.buffer.active;
      const isUp = buffer.viewportY < buffer.baseY - 1;
      setIsScrolledUp(isUp);
    });

    const handleResize = () => {
      try {
        fitAddon.fit();
        const sid = activeSessionIdRef.current;
        if (sid && term.cols && term.rows) {
          fetch(`/api/terminal/sessions/${encodeURIComponent(sid)}/resize`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ cols: term.cols, rows: term.rows }),
          }).catch(() => {});
        }
      } catch {
        // ignore
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(terminalContainerRef.current);

    const handleViewportResize = () => {
      handleResize();
    };
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleViewportResize);
    }
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    // Smooth touch gesture scrolling for mobile touchscreens
    const termContainer = terminalContainerRef.current;
    let touchStartY = 0;
    let touchStartX = 0;
    let accumulatedDeltaY = 0;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        touchStartY = e.touches[0].clientY;
        touchStartX = e.touches[0].clientX;
        accumulatedDeltaY = 0;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1 && xtermRef.current) {
        const currentY = e.touches[0].clientY;
        const currentX = e.touches[0].clientX;
        const deltaY = touchStartY - currentY;
        const deltaX = touchStartX - currentX;

        if (Math.abs(deltaY) > Math.abs(deltaX)) {
          accumulatedDeltaY += deltaY;
          const lineHeight = Math.max(14, fontSize * 1.38);
          const linesToScroll = Math.trunc(accumulatedDeltaY / lineHeight);
          if (linesToScroll !== 0) {
            xtermRef.current.scrollLines(linesToScroll);
            accumulatedDeltaY -= linesToScroll * lineHeight;
            touchStartY = currentY;
          }
        }
      }
    };

    termContainer.addEventListener('touchstart', handleTouchStart, { passive: true });
    termContainer.addEventListener('touchmove', handleTouchMove, { passive: true });

    return () => {
      onDataDisposable.dispose();
      scrollDisposable.dispose();
      resizeObserver.disconnect();
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleViewportResize);
      }
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      termContainer.removeEventListener('touchstart', handleTouchStart);
      termContainer.removeEventListener('touchmove', handleTouchMove);
      eventSourceRef.current?.close();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sendRawInput, authHeaders, fontSize]);

  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.fontSize = fontSize;
      xtermRef.current.options.cursorBlink = cursorBlink;
      try {
        fitAddonRef.current?.fit();
      } catch {
        // ignore
      }
    }
  }, [fontSize, cursorBlink]);

  const loadOrCreateWorkspaceSession = useCallback(
    async (wsId: string) => {
      setErrorBanner(null);
      try {
        const res = await fetch(
          `/api/terminal/sessions?workspaceId=${encodeURIComponent(wsId)}`
        );
        const data = await res.json();
        if (data.terminalToken) {
          setTerminalToken(data.terminalToken);
          tokenRef.current = data.terminalToken;
        }
        const existing: TerminalSessionInfo[] = data.sessions || [];
        const runningList = existing.filter((s) => s.status === 'running');

        if (runningList.length > 0) {
          setSessions(existing);
          setActiveSessionId(runningList[runningList.length - 1].sessionId);
          return runningList[runningList.length - 1].sessionId;
        }

        const cols = xtermRef.current?.cols || 100;
        const rows = xtermRef.current?.rows || 30;
        const createRes = await fetch('/api/terminal/sessions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(data.terminalToken ? { 'x-obsidian-terminal-token': data.terminalToken } : {}),
          },
          body: JSON.stringify({ workspaceId: wsId, cols, rows }),
        });
        const createdData = await createRes.json();
        if (!createRes.ok) {
          setErrorBanner(createdData.error || 'Failed to create terminal session');
          return null;
        }
        const newSession: TerminalSessionInfo = createdData.session;
        setSessions([...existing, newSession]);
        setActiveSessionId(newSession.sessionId);
        return newSession.sessionId;
      } catch (err) {
        setErrorBanner(err instanceof Error ? err.message : 'Failed to connect to terminal backend');
        return null;
      }
    },
    []
  );

  useEffect(() => {
    loadOrCreateWorkspaceSession(activeWorkspaceId);
  }, [activeWorkspaceId, loadOrCreateWorkspaceSession]);

  useEffect(() => {
    if (!activeSessionId) return;

    eventSourceRef.current?.close();
    const term = xtermRef.current;
    if (term) {
      term.reset();
    }

    const tokenParam = tokenRef.current ? `?token=${encodeURIComponent(tokenRef.current)}` : '';
    const es = new EventSource(
      `/api/terminal/sessions/${encodeURIComponent(activeSessionId)}/stream${tokenParam}`
    );
    eventSourceRef.current = es;

    es.addEventListener('init', (ev: MessageEvent) => {
      try {
        const payload = JSON.parse(ev.data);
        if (payload.session) {
          setSessions((prev) => {
            const exists = prev.some((s) => s.sessionId === payload.session.sessionId);
            if (!exists) return [...prev, payload.session];
            return prev.map((s) =>
              s.sessionId === payload.session.sessionId ? payload.session : s
            );
          });
          if (xtermRef.current) {
            xtermRef.current.reset();
            if (payload.session.scrollback) {
              xtermRef.current.write(payload.session.scrollback);
            }
          }
        }
      } catch {
        // ignore
      }
    });

    es.addEventListener('output', (ev: MessageEvent) => {
      try {
        const payload = JSON.parse(ev.data) as {
          data: string;
          cwd: string;
          timestampMillis: number;
        };
        if (payload.data && xtermRef.current) {
          xtermRef.current.write(payload.data);
          if (!isScrolledUpRef.current) {
            xtermRef.current.scrollToBottom();
          }

          // Real-time detection of npm EEXIST and ENOTEMPTY error patterns
          if (/EEXIST: file already exists/i.test(payload.data) || /code EEXIST/i.test(payload.data)) {
            setNpmConflictNotice({
              type: 'EEXIST',
              message:
                'npm EEXIST collision: Target binary or symlink already exists. Verify with `opencode --version` before reinstalling.',
            });
          } else if (/ENOTEMPTY: directory not empty/i.test(payload.data) || /code ENOTEMPTY/i.test(payload.data)) {
            setNpmConflictNotice({
              type: 'ENOTEMPTY',
              message:
                'npm ENOTEMPTY collision: Stale staging folder from interrupted install detected.',
            });
          }
        }
        if (payload.cwd) {
          setSessions((prev) =>
            prev.map((s) =>
              s.sessionId === activeSessionId ? { ...s, cwd: payload.cwd } : s
            )
          );
        }
      } catch {
        // ignore
      }
    });

    es.addEventListener('status', (ev: MessageEvent) => {
      try {
        const summary = JSON.parse(ev.data) as TerminalSessionInfo;
        setSessions((prev) =>
          prev.map((s) => (s.sessionId === summary.sessionId ? { ...s, ...summary } : s))
        );
      } catch {
        // ignore
      }
    });

    es.addEventListener('clear', () => {
      xtermRef.current?.clear();
    });

    es.addEventListener('agent_event', (ev: MessageEvent) => {
      try {
        const payload = JSON.parse(ev.data) as { state: string; command: string };
        setAgentCommandNotice(payload);
        if (payload.state !== 'running') {
          setTimeout(() => setAgentCommandNotice(null), 3500);
        }
      } catch {
        // ignore
      }
    });

    es.onerror = () => {};

    return () => {
      es.close();
    };
  }, [activeSessionId]);

  useEffect(() => {
    if (initialCommand && activeSessionId) {
      const cmdToSend = initialCommand.endsWith('\n') || initialCommand.endsWith('\r')
        ? initialCommand
        : `${initialCommand}\r`;
      sendRawInput(activeSessionId, cmdToSend);
      onConsumeInitialCommand?.();
    }
  }, [initialCommand, activeSessionId, sendRawInput, onConsumeInitialCommand]);

  const handleCreateNewSession = async () => {
    setErrorBanner(null);
    try {
      const cols = xtermRef.current?.cols || 100;
      const rows = xtermRef.current?.rows || 30;
      const res = await fetch('/api/terminal/sessions', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          cols,
          rows,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorBanner(data.error || 'Failed to create new session');
        return;
      }
      setSessions((prev) => [...prev, data.session]);
      setActiveSessionId(data.session.sessionId);
      xtermRef.current?.focus();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Session creation error');
    }
  };

  const handleClearScrollback = async () => {
    if (!activeSessionId) return;
    xtermRef.current?.clear();
    await fetch(`/api/terminal/sessions/${encodeURIComponent(activeSessionId)}/clear`, {
      method: 'POST',
      headers: authHeaders(),
    });
    xtermRef.current?.focus();
  };

  const handleInterruptSession = async () => {
    if (!activeSessionId) return;
    await fetch(`/api/terminal/sessions/${encodeURIComponent(activeSessionId)}/interrupt`, {
      method: 'POST',
      headers: authHeaders(),
    });
    xtermRef.current?.focus();
  };

  const handleRestartSession = async () => {
    if (!activeSessionId) return;
    setErrorBanner(null);
    const oldId = activeSessionId;
    const res = await fetch(`/api/terminal/sessions/${encodeURIComponent(oldId)}/restart`, {
      method: 'POST',
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!res.ok) {
      setErrorBanner(data.error || 'Failed to restart session');
      return;
    }
    setSessions((prev) =>
      prev.map((s) => (s.sessionId === oldId ? data.session : s))
    );
    setActiveSessionId(data.session.sessionId);
    xtermRef.current?.focus();
  };

  const handleCloseSession = async (targetSessionId: string) => {
    setErrorBanner(null);
    await fetch(
      `/api/terminal/sessions/${encodeURIComponent(targetSessionId)}?remove=true`,
      {
        method: 'DELETE',
        headers: authHeaders(),
      }
    );
    const remaining = sessions.filter((s) => s.sessionId !== targetSessionId);
    setSessions(remaining);
    if (activeSessionId === targetSessionId) {
      if (remaining.length > 0) {
        setActiveSessionId(remaining[remaining.length - 1].sessionId);
      } else {
        setActiveSessionId('');
      }
    }
  };

  const handleCopyOutput = async () => {
    const selection = xtermRef.current?.getSelection();
    if (selection) {
      await navigator.clipboard.writeText(selection);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      return;
    }
    if (!activeSessionId) return;
    const res = await fetch(`/api/terminal/sessions/${encodeURIComponent(activeSessionId)}`, {
      headers: authHeaders(),
    });
    const data = await res.json();
    if (data.session?.scrollback) {
      const clean = String(data.session.scrollback).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
      await navigator.clipboard.writeText(clean);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const handlePasteFromClipboard = async () => {
    if (!activeSessionId) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        sendRawInput(activeSessionId, text);
        xtermRef.current?.focus();
      }
    } catch {
      setErrorBanner('Clipboard read requires browser permission; use Ctrl+V / Cmd+V directly in the terminal.');
    }
  };

  const navigateHistory = (direction: 'up' | 'down') => {
    if (commandHistory.length === 0) return;
    if (direction === 'up') {
      const nextIdx = Math.min(historyIndex + 1, commandHistory.length - 1);
      setHistoryIndex(nextIdx);
      setAssistiveInput(commandHistory[nextIdx]);
    } else {
      const nextIdx = historyIndex - 1;
      if (nextIdx < 0) {
        setHistoryIndex(-1);
        setAssistiveInput('');
      } else {
        setHistoryIndex(nextIdx);
        setAssistiveInput(commandHistory[nextIdx]);
      }
    }
  };

  const handleAssistiveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSessionId) return;
    const text = assistiveInput.trim();
    if (text) {
      sendRawInput(activeSessionId, `${text}\r\n`);
      setCommandHistory((prev) => [text, ...prev.filter((c) => c !== text)].slice(0, 50));
      setHistoryIndex(-1);
      setAssistiveInput('');
    } else {
      sendRawInput(activeSessionId, '\r\n');
    }
    // Retain focus for fast serial command execution on mobile
    assistiveInputRef.current?.focus();
  };

  return (
    <div className="flex flex-col h-full w-full max-w-full overflow-hidden bg-[#090A0C] text-[#F4F5F6]">
      {/* Organized OBSIDIAN Terminal Header */}
      <div className="border-b border-[#272C33] bg-[#0E1013] flex flex-col shrink-0 min-w-0">
        {/* Row 1: Session Tabs */}
        <div className="px-3 py-1.5 flex items-center justify-between gap-2 border-b border-[#272C33]/50">
          <div className="flex items-center gap-1.5 overflow-x-auto min-w-0 flex-1 no-scrollbar">
            <div className="flex items-center gap-1.5 pr-2 border-r border-[#272C33] shrink-0">
              <TerminalIcon className="w-4 h-4 text-[#C7FF65] shrink-0" />
              <span className="text-xs font-semibold text-[#F4F5F6] hidden sm:inline">
                Terminal
              </span>
            </div>

            {sessions.map((sess) => {
              const isActive = sess.sessionId === activeSessionId;
              return (
                <div
                  key={sess.sessionId}
                  className={`flex items-center gap-1.5 min-h-[30px] px-2.5 py-0.5 rounded-md text-xs font-mono border transition-colors shrink-0 ${
                    isActive
                      ? 'bg-[#1B1F24] text-[#F4F5F6] border-[#C7FF65]/60'
                      : 'bg-[#14171B] text-[#A0A6AF] border-[#272C33] hover:text-[#F4F5F6]'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      sess.status === 'running'
                        ? 'bg-[#72D9A0]'
                        : sess.status === 'error'
                        ? 'bg-[#FF727A]'
                        : 'bg-[#6E7580]'
                    }`}
                  />
                  <button
                    onClick={() => setActiveSessionId(sess.sessionId)}
                    title={`Switch to session: ${sess.title}`}
                    aria-label={`Switch to session: ${sess.title}`}
                    className="truncate max-w-[110px]"
                  >
                    {sess.title}
                  </button>
                  <button
                    onClick={() => handleCloseSession(sess.sessionId)}
                    title="Close session"
                    aria-label={`Close ${sess.title}`}
                    className="text-[#6E7580] hover:text-[#FF727A] ml-0.5 p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}

            <button
              onClick={handleCreateNewSession}
              title="Create new shell session"
              aria-label="Create new shell session"
              className="min-h-[30px] px-2.5 py-0.5 rounded-md bg-[#14171B] hover:bg-[#1B1F24] border border-[#272C33] text-xs font-medium text-[#C7FF65] flex items-center gap-1 shrink-0 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span>New Session</span>
            </button>
          </div>
        </div>

        {/* Row 2: Sleek Single-Row Action Bar (Never wraps, neatly aligned) */}
        <div className="px-3 py-1.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar bg-[#0B0D10]">
          <button
            onClick={handleInterruptSession}
            disabled={!activeSession || activeSession.status !== 'running'}
            title="Send SIGINT (Ctrl+C)"
            aria-label="Stop running process (SIGINT)"
            className="min-h-[30px] px-2.5 py-1 rounded-md bg-[#161B22] hover:bg-[#21262D] border border-[#D29922]/40 text-xs font-mono text-[#F4C46A] disabled:opacity-40 flex items-center gap-1.5 shrink-0 whitespace-nowrap"
          >
            <Square className="w-3 h-3 shrink-0" />
            <span>Stop</span>
          </button>

          <button
            onClick={handleClearScrollback}
            disabled={!activeSession}
            title="Clear terminal buffer"
            aria-label="Clear terminal buffer"
            className="min-h-[30px] px-2.5 py-1 rounded-md bg-[#161B22] hover:bg-[#21262D] border border-[#30363D] text-xs text-[#A0A6AF] hover:text-[#F4F5F6] disabled:opacity-40 flex items-center gap-1.5 shrink-0 whitespace-nowrap"
          >
            <Trash2 className="w-3 h-3 shrink-0" />
            <span>Clear</span>
          </button>

          <button
            onClick={handleCopyOutput}
            disabled={!activeSession}
            title={copied ? "Copied to clipboard" : "Copy output"}
            aria-label={copied ? "Copied to clipboard" : "Copy terminal output"}
            className="min-h-[30px] px-2.5 py-1 rounded-md bg-[#161B22] hover:bg-[#21262D] border border-[#30363D] text-xs text-[#A0A6AF] hover:text-[#F4F5F6] disabled:opacity-40 flex items-center gap-1.5 shrink-0 whitespace-nowrap"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-[#72D9A0] shrink-0" />
                <span className="text-[#72D9A0]">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3 shrink-0" />
                <span>Copy</span>
              </>
            )}
          </button>

          <button
            onClick={handlePasteFromClipboard}
            disabled={!activeSession || activeSession.status !== 'running'}
            title="Paste clipboard"
            aria-label="Paste from clipboard"
            className="min-h-[30px] px-2.5 py-1 rounded-md bg-[#161B22] hover:bg-[#21262D] border border-[#30363D] text-xs text-[#A0A6AF] hover:text-[#F4F5F6] disabled:opacity-40 flex items-center gap-1.5 shrink-0 whitespace-nowrap"
          >
            <ClipboardPaste className="w-3 h-3 shrink-0" />
            <span>Paste</span>
          </button>

          <button
            onClick={handleRestartSession}
            disabled={!activeSession}
            title="Restart session"
            aria-label="Restart terminal session"
            className="min-h-[30px] px-2.5 py-1 rounded-md bg-[#161B22] hover:bg-[#21262D] border border-[#30363D] text-xs text-[#A0A6AF] hover:text-[#F4F5F6] disabled:opacity-40 flex items-center gap-1.5 shrink-0 whitespace-nowrap"
          >
            <RotateCcw className="w-3 h-3 shrink-0" />
            <span>Restart</span>
          </button>

          <button
            onClick={() => xtermRef.current?.scrollToBottom()}
            disabled={!activeSession}
            title="Scroll to bottom"
            aria-label="Scroll to bottom"
            className="min-h-[30px] min-w-[32px] flex items-center justify-center rounded-md bg-[#161B22] hover:bg-[#21262D] border border-[#30363D] text-[#A0A6AF] hover:text-[#F4F5F6] disabled:opacity-40 shrink-0"
          >
            <ArrowDown className="w-3 h-3" />
          </button>

          <button
            onClick={() => setShowSettings((v) => !v)}
            title="Terminal settings"
            aria-label="Terminal settings"
            className={`min-h-[30px] min-w-[32px] flex items-center justify-center rounded-md border text-xs text-[#A0A6AF] hover:text-[#F4F5F6] shrink-0 ${
              showSettings
                ? 'bg-[#1B1F24] border-[#C7FF65]/50 text-[#C7FF65]'
                : 'bg-[#161B22] border-[#30363D]'
            }`}
          >
            <SlidersHorizontal className="w-3 h-3" />
          </button>
        </div>
      </div>


      {/* Live Metadata Status Strip */}
      {activeSession && (
        <div className="px-2.5 sm:px-3 py-1 sm:py-1.5 border-b border-[#272C33] bg-[#090A0C] flex items-center justify-between gap-2 text-[10px] sm:text-[11px] font-mono text-[#A0A6AF] shrink-0 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 flex-1 truncate">
            <span className="flex items-center gap-1 text-[#F4F5F6] shrink-0 font-semibold">
              <Cpu className="w-3 h-3 text-[#C7FF65] shrink-0" />
              <span>{activeSession.shell}</span>
            </span>
            <span className="text-[#6E7580]">·</span>
            <span className="text-[#8DA8FF] shrink-0">
              {activeSession.transportMode.toUpperCase()}
            </span>
            {activeSession.shellPid && (
              <>
                <span className="text-[#6E7580] hidden sm:inline">·</span>
                <span className="shrink-0 hidden sm:inline">PID {activeSession.shellPid}</span>
              </>
            )}
            <span className="text-[#6E7580] hidden sm:inline">·</span>
            <span
              className="hidden sm:flex items-center gap-1 text-[#C7FF65] truncate min-w-0 max-w-full"
              title={activeSession.cwd}
            >
              <Folder className="w-3 h-3 shrink-0" />
              <span className="truncate">{activeSession.cwd}</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <span className="text-[#6E7580] tabular-nums text-[10px] sm:text-[11px]">
              {activeSession.cols}×{activeSession.rows}
            </span>
            <span
              className={`px-1.5 py-0.5 rounded text-[9.5px] sm:text-[10px] font-semibold ${
                activeSession.status === 'running'
                  ? 'bg-[#72D9A0]/15 text-[#72D9A0] border border-[#72D9A0]/30'
                  : 'bg-[#FF727A]/15 text-[#FF727A] border border-[#FF727A]/30'
              }`}
            >
              {activeSession.status === 'running'
                ? 'Running'
                : `Exited (${activeSession.exitCode ?? 0})`}
            </span>
          </div>
        </div>
      )}

      {/* Optional Terminal Settings Bar */}
      {showSettings && (
        <div className="px-3.5 py-2.5 border-b border-[#272C33] bg-[#14171B] flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-[#A0A6AF]">
              <span>Font Size</span>
              <select
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="px-2 py-1 rounded bg-[#090A0C] border border-[#272C33] font-mono text-xs text-[#F4F5F6]"
              >
                {[11, 12, 13, 14, 15, 16].map((sz) => (
                  <option key={sz} value={sz}>
                    {sz}px
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 text-[#A0A6AF] cursor-pointer">
              <input
                type="checkbox"
                checked={cursorBlink}
                onChange={(e) => setCursorBlink(e.target.checked)}
                className="accent-[#C7FF65]"
              />
              <span>Cursor Blink</span>
            </label>

            <label className="flex items-center gap-2 text-[#A0A6AF] cursor-pointer">
              <input
                type="checkbox"
                checked={showMobileInputBar}
                onChange={(e) => setShowMobileInputBar(e.target.checked)}
                className="accent-[#C7FF65]"
              />
              <span>Assistive Input & Control Keys Bar</span>
            </label>
          </div>

          <div className="text-[11px] font-mono text-[#6E7580] url-wrap">
            Session ID: {activeSession?.sessionId || 'none'}
          </div>
        </div>
      )}

      {/* Visible AI Agent Command Execution Indicator */}
      {agentCommandNotice && (
        <div className="px-3.5 py-2 border-b border-[#272C33] bg-[#14171B] flex items-center justify-between gap-2 text-xs shrink-0">
          <div className="flex items-center gap-2 font-mono min-w-0">
            <Layers className="w-3.5 h-3.5 text-[#C7FF65] shrink-0" />
            <span className="text-[#F4F5F6] font-semibold shrink-0">
              AI Agent Tool ({agentCommandNotice.state}):
            </span>
            <span className="text-[#8DA8FF] truncate">{agentCommandNotice.command}</span>
          </div>
          <span className="text-[10.5px] text-[#6E7580] shrink-0 hidden sm:inline">
            Isolated from interactive PTY
          </span>
        </div>
      )}

      {/* Error Banner */}
      {errorBanner && (
        <div className="px-3.5 py-2 border-b border-[#FF727A]/40 bg-[#FF727A]/10 flex items-center justify-between gap-2 text-xs text-[#FF727A] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="url-wrap">{errorBanner}</span>
          </div>
          <button
            onClick={() => setErrorBanner(null)}
            title="Dismiss error message"
            aria-label="Dismiss error message"
            className="text-[11px] underline hover:opacity-80 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* npm Conflict Notice (EEXIST / ENOTEMPTY) */}
      {npmConflictNotice && (
        <div className="px-3.5 py-2 border-b border-[#F4C46A]/40 bg-[#F4C46A]/10 flex items-center justify-between gap-2 text-xs text-[#F4C46A] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#F4C46A]" />
            <span className="truncate">{npmConflictNotice.message}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (activeSessionId) {
                  sendRawInput(activeSessionId, 'opencode --version\r\n');
                }
              }}
              title="Verify OpenCode binary in terminal"
              aria-label="Verify OpenCode binary"
              className="px-2 py-0.5 rounded bg-[#F4C46A]/20 hover:bg-[#F4C46A]/30 text-[11px] font-mono text-[#F4C46A] border border-[#F4C46A]/40"
            >
              Verify OpenCode
            </button>
            <button
              type="button"
              onClick={() => setNpmConflictNotice(null)}
              title="Dismiss conflict notice"
              aria-label="Dismiss conflict notice"
              className="p-1 text-[#A0A6AF] hover:text-[#F4F5F6]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Primary xterm.js Interactive PTY Surface */}
      <div
        className="flex-1 min-h-0 min-w-0 max-w-full w-full bg-[#090A0C] p-1.5 sm:p-2 overflow-hidden relative"
        onClick={() => xtermRef.current?.focus()}
      >
        {sessions.length === 0 && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#090A0C]/95 p-6 text-center space-y-3">
            <TerminalIcon className="w-7 h-7 text-[#6E7580]" />
            <div className="text-sm font-semibold text-[#F4F5F6]">
              No Active Terminal Sessions
            </div>
            <p className="text-xs text-[#A0A6AF] max-w-md">
              All shell sessions for workspace <span className="font-mono text-[#C7FF65]">{activeWorkspaceId}</span> have been closed. Start a new session to launch a persistent interactive OS shell process.
            </p>
            <button
              onClick={handleCreateNewSession}
              title="Start a new shell session"
              aria-label="Start shell session"
              className="min-h-[38px] px-4 py-2 rounded-md bg-[#C7FF65] text-[#090A0C] text-xs font-semibold flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span>Start Shell Session</span>
            </button>
          </div>
        )}
        <div ref={terminalContainerRef} className="w-full h-full min-w-0 max-w-full overflow-hidden select-text" />

        {/* Floating Jump to Bottom Button */}
        {isScrolledUp && (
          <button
            type="button"
            onClick={() => {
              xtermRef.current?.scrollToBottom();
              setIsScrolledUp(false);
            }}
            title="Jump to bottom of terminal"
            aria-label="Jump to bottom of terminal"
            className="absolute bottom-3 right-3 z-20 px-3 py-1.5 rounded-full bg-[#161B22]/90 hover:bg-[#21262D] border border-[#C7FF65]/50 text-[#C7FF65] text-xs font-mono font-semibold flex items-center gap-1.5 shadow-xl backdrop-blur-sm transition-all"
          >
            <ArrowDown className="w-3.5 h-3.5" />
            <span>Jump to Bottom</span>
          </button>
        )}
      </div>

      {/* Bottom Control Keys & Assistive / Mobile Input Bar */}
      {showMobileInputBar && activeSession && activeSession.status === 'running' && (
        <div className="p-1.5 sm:p-2.5 border-t border-[#272C33] bg-[#0E1013] space-y-1.5 shrink-0 min-w-0 max-w-full">
          {/* Hardware Control Key Strip (Matching Screen 7 Virtual Keyboard) */}
          <div className="flex items-center justify-between gap-1 overflow-x-auto max-w-full pb-0.5 no-scrollbar">
            <div className="flex items-center gap-1 shrink-0">
              {(fnMode
                ? [
                    { label: 'fn', seq: '__TOGGLE_FN__', title: 'Exit Function Keys mode', aria: 'Toggle function keys' },
                    { label: 'F1', seq: '\x1bOP', title: 'Send F1 key', aria: 'F1 key' },
                    { label: 'F2', seq: '\x1bOQ', title: 'Send F2 key', aria: 'F2 key' },
                    { label: 'F3', seq: '\x1bOR', title: 'Send F3 key', aria: 'F3 key' },
                    { label: 'F5', seq: '\x1b[15~', title: 'Send F5 key', aria: 'F5 key' },
                    { label: 'Home', seq: '\x1b[H', title: 'Send Home key', aria: 'Home key' },
                    { label: 'End', seq: '\x1b[F', title: 'Send End key', aria: 'End key' },
                    { label: 'PgUp', seq: '\x1b[5~', title: 'Send Page Up key', aria: 'Page Up key' },
                    { label: 'PgDn', seq: '\x1b[6~', title: 'Send Page Down key', aria: 'Page Down key' },
                  ]
                : [
                    { label: '⏎', seq: '\r\n', title: 'Send Enter key', aria: 'Enter key' },
                    { label: 'tab', seq: '\t', title: 'Send Tab key', aria: 'Tab key' },
                    { label: 'ESC', seq: '\x1b', title: 'Send Escape (ESC)', aria: 'Escape key' },
                    { label: 'CTRL+C', seq: '\x03', title: 'Send SIGINT (Ctrl+C)', aria: 'Control-C interrupt key' },
                    { label: '^', seq: '\x1b[A', title: 'Arrow Up', aria: 'Up arrow key' },
                    { label: 'v', seq: '\x1b[B', title: 'Arrow Down', aria: 'Down arrow key' },
                    { label: '←', seq: '\x1b[D', title: 'Arrow Left', aria: 'Left arrow key' },
                    { label: '→', seq: '\x1b[C', title: 'Arrow Right', aria: 'Right arrow key' },
                    { label: 'Clear', seq: '\x0c', title: 'Clear screen (Ctrl+L)', aria: 'Clear screen key' },
                    { label: 'fn', seq: '__TOGGLE_FN__', title: 'Toggle Function Keys', aria: 'Function key' },
                  ]
              ).map((btn) => (
                <button
                  key={btn.label}
                  type="button"
                  title={btn.title}
                  aria-label={btn.aria}
                  onClick={() => {
                    if (btn.seq === '__TOGGLE_FN__') {
                      setFnMode((prev) => !prev);
                      return;
                    }
                    if (btn.seq) {
                      sendRawInput(activeSession.sessionId, btn.seq);
                    }
                  }}
                  className={`min-h-[30px] min-w-[34px] px-2 py-0.5 rounded-lg border font-mono text-[11px] shrink-0 transition-colors shadow-xs cursor-pointer ${
                    btn.seq === '__TOGGLE_FN__' && fnMode
                      ? 'bg-[#C7FF65] text-[#090A0C] border-[#C7FF65] font-bold'
                      : 'bg-[#161B22] hover:bg-[#21262D] border-[#30363D] active:border-[#C7FF65] text-[#F0F6FC]'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                assistiveInputRef.current?.blur();
                (document.activeElement as HTMLElement | null)?.blur?.();
              }}
              title="Dismiss mobile keyboard without closing session"
              aria-label="Dismiss mobile keyboard"
              className="min-h-[30px] px-2 py-0.5 rounded bg-[#14171B] hover:bg-[#1B1F24] border border-[#272C33] text-[10px] text-[#A0A6AF] hover:text-[#F4F5F6] flex items-center gap-1 shrink-0 whitespace-nowrap ml-1 cursor-pointer"
            >
              <Keyboard className="w-3 h-3 shrink-0" />
              <span className="hidden sm:inline">Dismiss Keyboard</span>
            </button>
          </div>

          {/* Direct Stdin / Command Input with History */}
          <form onSubmit={handleAssistiveSubmit} className="flex items-center gap-1.5 min-w-0">
            <div className="flex-1 relative flex items-center min-w-0">
              <input
                ref={assistiveInputRef}
                type="text"
                value={assistiveInput}
                onChange={(e) => setAssistiveInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    navigateHistory('up');
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    navigateHistory('down');
                  }
                }}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                placeholder="Type command here (Enter / Go to send, ↑/↓ for history)..."
                aria-label="Terminal command input"
                className="w-full min-h-[34px] px-2.5 py-1 rounded-lg bg-[#090A0C] border border-[#272C33] focus:border-[#C7FF65] font-mono text-xs text-[#F4F5F6] placeholder-[#6E7580] focus:outline-none"
              />
            </div>
            <button
              type="submit"
              title="Send command to active terminal session"
              aria-label="Send command to terminal"
              className="min-h-[34px] px-3.5 py-1 rounded-lg bg-[#C7FF65] text-[#090A0C] text-xs font-bold whitespace-nowrap hover:bg-[#B8F558] cursor-pointer shrink-0"
            >
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
