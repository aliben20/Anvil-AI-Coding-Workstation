import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Terminal,
  Activity,
  X,
  Minimize2,
  Play,
  RotateCcw,
  Layers,
} from 'lucide-react';
import { ObsidianCrystalLogo } from './ChatTab';

interface FloatingBubbleProps {
  enabled: boolean;
  onDismiss: () => void;
  onNavigateToChat: () => void;
  onNavigateToTerminal: () => void;
  onNavigateToTasks: () => void;
  activeTask?: {
    role: string;
    title: string;
    progress?: number;
    status: string;
    currentStep?: string;
  } | null;
  runningTasksCount: number;
}

export const FloatingBubble: React.FC<FloatingBubbleProps> = ({
  enabled,
  onDismiss,
  onNavigateToChat,
  onNavigateToTerminal,
  onNavigateToTasks,
  activeTask,
  runningTasksCount,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 180 });
  const [isDragging, setIsDragging] = useState(false);
  const [isOverDismissZone, setIsOverDismissZone] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);

  const dragStartRef = useRef<{ startX: number; startY: number; initialX: number; initialY: number; moved: boolean }>({
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
    moved: false,
  });

  // Initialize position docked on right edge and react immediately when enabled toggles
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const defaultX = Math.max(16, window.innerWidth - 68);
      setPos({ x: defaultX, y: 180 });
    }
  }, []);

  useEffect(() => {
    if (enabled) {
      setIsDismissing(false);
      setIsDragging(false);
      setIsOverDismissZone(false);
      if (typeof window !== 'undefined') {
        const defaultX = Math.max(16, window.innerWidth - 68);
        setPos({ x: defaultX, y: 180 });
      }
    }
  }, [enabled]);

  if (!enabled) return null;

  const handlePointerDown = (e: React.PointerEvent) => {
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: pos.x,
      initialY: pos.y,
      moved: false,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsDragging(true);
    setIsOverDismissZone(false);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.startX;
    const dy = e.clientY - dragStartRef.current.startY;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      dragStartRef.current.moved = true;
    }

    const minX = 8;
    const maxX = window.innerWidth - 60;
    const minY = 60;
    const maxY = window.innerHeight - 80;

    const nextX = Math.max(minX, Math.min(maxX, dragStartRef.current.initialX + dx));
    const nextY = Math.max(minY, Math.min(maxY, dragStartRef.current.initialY + dy));

    setPos({ x: nextX, y: nextY });

    // Messenger drag-down-to-X proximity check:
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    const targetCenterX = window.innerWidth / 2;
    const targetCenterY = isMobile ? window.innerHeight - 112 : window.innerHeight - 64;
    const bubbleCenterX = nextX + 24;
    const bubbleCenterY = nextY + 24;
    const dist = Math.hypot(bubbleCenterX - targetCenterX, bubbleCenterY - targetCenterY);

    const inZone = dist < 90;
    setIsOverDismissZone(inZone);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    // If dropped in the Messenger dismiss zone, dismiss overlay!
    if (isOverDismissZone) {
      setIsDismissing(true);
      setPos({
        x: window.innerWidth / 2 - 24,
        y: window.innerHeight - 76,
      });
      setTimeout(() => {
        setIsDismissing(false);
        onDismiss();
      }, 180);
      return;
    }

    // If it was a tap (not dragged), toggle expand
    if (!dragStartRef.current.moved) {
      setExpanded((prev) => !prev);
      return;
    }

    // Snap to nearest screen edge (left or right)
    const midPoint = window.innerWidth / 2;
    const targetX = pos.x < midPoint ? 12 : window.innerWidth - 64;
    setPos((prev) => ({ ...prev, x: targetX }));
    setIsOverDismissZone(false);
  };

  const isRunning = runningTasksCount > 0 || activeTask?.status === 'Running';

  return (
    <>
      {/* Messenger-style bottom X Dismiss Target Zone */}
      {isDragging && !expanded && (
        <div
          className={`fixed bottom-20 md:bottom-8 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center justify-center transition-all duration-150 pointer-events-none select-none ${
            isOverDismissZone ? 'scale-125' : 'scale-100 opacity-90'
          }`}
        >
          <div
            className={`w-16 h-16 rounded-full flex items-center justify-center border transition-all duration-150 shadow-2xl ${
              isOverDismissZone
                ? 'bg-[#DA3633] border-[#FF727A] text-white shadow-[0_0_24px_rgba(218,54,51,0.7)] animate-pulse'
                : 'bg-[#161B22]/95 backdrop-blur-md border-[#30363D] text-[#8B949E]'
            }`}
          >
            <X className={`w-7 h-7 transition-transform ${isOverDismissZone ? 'scale-110 text-white' : 'text-[#8B949E]'}`} />
          </div>
          <span
            className={`text-[11px] font-mono mt-1.5 px-2 py-0.5 rounded-full transition-colors ${
              isOverDismissZone
                ? 'bg-[#DA3633]/30 text-[#FF727A] font-bold border border-[#DA3633]/50'
                : 'bg-[#161B22]/80 text-[#8B949E]'
            }`}
          >
            {isOverDismissZone ? 'Release to remove' : 'Drag here to remove'}
          </span>
        </div>
      )}

      <div
        style={{
          transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
          touchAction: 'none',
        }}
        className={`fixed top-0 left-0 z-50 select-none ${
          isDismissing ? 'transition-all duration-200 scale-0 opacity-0' : 'transition-transform duration-75'
        }`}
      >
        {/* Expanded Quick-Control HUD Sheet */}
        {expanded ? (
          <div className="w-72 bg-[#161B22]/95 backdrop-blur-xl border border-[#30363D] shadow-2xl rounded-2xl p-4 text-[#F0F6FC] space-y-3 animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#30363D] pb-2.5">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${isRunning ? 'bg-[#C7FF65] animate-pulse shadow-[0_0_8px_#C7FF65]' : 'bg-[#8B949E]'}`} />
                <span className="text-xs font-bold tracking-tight text-[#F0F6FC]">OBSIDIAN Overlay</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="p-1 rounded-md text-[#8B949E] hover:text-[#F0F6FC] hover:bg-[#21262D]"
                  title="Minimize OBSIDIAN overlay"
                  aria-label="Minimize OBSIDIAN overlay"
                >
                  <Minimize2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={onDismiss}
                  className="p-1 rounded-md text-[#8B949E] hover:text-[#FF727A] hover:bg-[#21262D]"
                  title="Dismiss OBSIDIAN overlay"
                  aria-label="Dismiss OBSIDIAN overlay"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Active Task / Agent Status */}
            {activeTask ? (
              <div className="p-2.5 rounded-xl bg-[#0D1117] border border-[#30363D] space-y-1.5 text-xs">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-[#C7FF65] truncate">{activeTask.role} Agent</span>
                  <span className="text-[#8B949E] font-mono">{activeTask.progress ?? 0}%</span>
                </div>
                <div className="text-[11px] text-[#F0F6FC] line-clamp-1">{activeTask.title}</div>
                {activeTask.currentStep && (
                  <div className="text-[10px] text-[#8B949E] truncate">{activeTask.currentStep}</div>
                )}
                {/* Progress bar */}
                <div className="h-1.5 w-full bg-[#21262D] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#C7FF65] rounded-full transition-all duration-300"
                    style={{ width: `${Math.max(5, activeTask.progress ?? 0)}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="p-2.5 rounded-xl bg-[#0D1117] border border-[#30363D] text-[11px] text-[#8B949E]">
                {runningTasksCount > 0
                  ? `${runningTasksCount} background ${runningTasksCount === 1 ? 'task executing' : 'tasks executing'}.`
                  : 'Workstation idle. Ready for tasks.'}
              </div>
            )}

            {/* Quick Action Buttons */}
            <div className="grid grid-cols-3 gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setExpanded(false);
                  onNavigateToChat();
                }}
                title="Open Chat workspace"
                aria-label="Open Chat workspace"
                className="flex flex-col items-center justify-center p-2 rounded-xl bg-[#21262D] hover:bg-[#30363D] text-[#F0F6FC] transition-colors group"
              >
                <MessageSquare className="w-4 h-4 text-[#C7FF65] mb-1 group-hover:scale-110 transition-transform" />
                <span className="text-[10px] font-medium">Chat</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setExpanded(false);
                  onNavigateToTerminal();
                }}
                title="Open Terminal workspace"
                aria-label="Open Terminal workspace"
                className="flex flex-col items-center justify-center p-2 rounded-xl bg-[#21262D] hover:bg-[#30363D] text-[#F0F6FC] transition-colors group"
              >
                <Terminal className="w-4 h-4 text-[#388BFD] mb-1 group-hover:scale-110 transition-transform" />
                <span className="text-[10px] font-medium">Terminal</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setExpanded(false);
                  onNavigateToTasks();
                }}
                title="Open Tasks & Sub-Agents workspace"
                aria-label="Open Tasks & Sub-Agents workspace"
                className="flex flex-col items-center justify-center p-2 rounded-xl bg-[#21262D] hover:bg-[#30363D] text-[#F0F6FC] transition-colors group"
              >
                <Layers className="w-4 h-4 text-[#C7FF65] mb-1 group-hover:scale-110 transition-transform" />
                <span className="text-[10px] font-medium">Tasks</span>
              </button>
            </div>
          </div>
        ) : (
          /* Floating Draggable Bubble Icon */
          <div
            role="button"
            tabIndex={0}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setExpanded(true);
              }
            }}
            className={`relative w-12 h-12 rounded-2xl bg-[#161B22]/90 backdrop-blur-md border shadow-2xl flex items-center justify-center cursor-grab active:cursor-grabbing transition-all group focus:outline-none ${
              isOverDismissZone
                ? 'scale-75 opacity-70 border-[#DA3633] ring-4 ring-[#DA3633]/40 shadow-[0_0_20px_rgba(218,54,51,0.5)]'
                : 'border-[#30363D] hover:border-[#C7FF65] hover:shadow-[0_0_15px_rgba(199,255,101,0.25)] focus:ring-2 focus:ring-[#C7FF65]'
            }`}
            title="OBSIDIAN Quick Overlay · Tap to expand, drag to move or drag down to X to remove"
            aria-label="OBSIDIAN Quick Overlay · Tap to expand, drag to move or drag down to X to remove"
          >
            {/* Obsidian Crystal Vector Logo */}
            <ObsidianCrystalLogo className="w-6 h-6 pointer-events-none" withBadge={false} />

            {/* Running status badge */}
            {isRunning && (
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-[#C7FF65] border-2 border-[#0D1117] flex items-center justify-center shadow-[0_0_6px_#C7FF65]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#0D1117] animate-ping" />
              </span>
            )}
          </div>
        )}
      </div>
    </>
  );
};
