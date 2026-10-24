/**
 * @license MIT
 * Real Persistent OS PTY & Shell Session Manager for OBSIDIAN Workstation
 *
 * Architecture:
 * - On Linux/macOS with Python3 available, allocates a genuine kernel pseudoterminal
 *   (`pty.openpty()` -> `/dev/pts/N`) with `termios`, `TIOCSWINSZ` resize support,
 *   controlling terminal job control (`setsid` + `TIOCSCTTY`), and foreground process-group
 *   signal delivery (`os.tcgetpgrp` / `os.killpg`).
 * - Falls back to persistent OS pipes (`transportMode: 'pipe'`) only if PTY allocation is
 *   unavailable on the host OS, reporting the exact transport mode honestly.
 * - Uses Node's `StringDecoder('utf8')` to guarantee multi-byte UTF-8 characters split
 *   across stream chunks are decoded without corruption.
 * - Tracks the real shell working directory via `/proc/<shellPid>/cwd` (with sentinel fallback).
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { StringDecoder } from 'string_decoder';
import { buildSanitizedProcessEnv, evaluateCommandSafety } from './sourceIntegrations';
import { SecretRedactor } from './workstationEngine';

export type TerminalTransportMode = 'pty' | 'pipe';
export type TerminalSessionState = 'running' | 'exited' | 'error';

export interface TerminalSessionSummary {
  sessionId: string;
  title: string;
  workspaceId: string;
  workspaceRoot: string;
  cwd: string;
  shell: string;
  shellPid: number | null;
  bridgePid: number | null;
  ttyPath: string | null;
  transportMode: TerminalTransportMode;
  status: TerminalSessionState;
  exitCode: number | null;
  exitSignal: string | null;
  cols: number;
  rows: number;
  createdAtMillis: number;
  lastActivityMillis: number;
  errorMessage?: string;
}

export interface SessionCommandResult {
  sessionId: string;
  command: string;
  output: string;
  exitCode: number;
  cwd: string;
  shellPid: number | null;
  ttyPath: string | null;
  transportMode: TerminalTransportMode;
  durationMs: number;
  timedOut: boolean;
  interrupted: boolean;
}

interface InternalPtySession {
  sessionId: string;
  title: string;
  workspaceId: string;
  workspaceRoot: string;
  cwd: string;
  shell: string;
  shellPid: number | null;
  bridgePid: number | null;
  ttyPath: string | null;
  transportMode: TerminalTransportMode;
  status: TerminalSessionState;
  exitCode: number | null;
  exitSignal: string | null;
  cols: number;
  rows: number;
  createdAtMillis: number;
  lastActivityMillis: number;
  errorMessage?: string;
  proc: ChildProcess | null;
  utf8Decoder: StringDecoder;
  controlBuffer: string;
  scrollback: string;
  emitter: EventEmitter;
  readyPromise: Promise<void>;
  resolveReady?: () => void;
  execMutex: Promise<unknown>;
}

const MAX_SCROLLBACK_CHARS = 128_000;

/**
 * Python 3 PTY Bridge script executed via `python3 -u -c`.
 * Allocates a real kernel PTY (`pty.openpty()`), sets `TIOCSWINSZ`, spawns the target shell
 * in its own session (`os.setsid()`) with `TIOCSCTTY`, and relays raw PTY bytes & control commands
 * (resize, signal, stdin) over JSON-lines on fd 0 / fd 1.
 */
const PYTHON_PTY_BRIDGE_SCRIPT = `
import os, sys, pty, select, termios, struct, fcntl, signal, json, base64, errno

shell_bin = sys.argv[1]
initial_cwd = sys.argv[2]
cols = int(sys.argv[3])
rows = int(sys.argv[4])

try:
    master_fd, slave_fd = pty.openpty()
    tty_path = os.ttyname(slave_fd)
except Exception as e:
    sys.stdout.write(json.dumps({"type": "error", "message": f"PTY allocation failed: {e}"}) + "\\n")
    sys.stdout.flush()
    sys.exit(1)

def set_winsize(fd, r, c):
    try:
        winsize = struct.pack("HHHH", r, c, 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
    except Exception:
        pass

set_winsize(master_fd, rows, cols)

pid = os.fork()
if pid == 0:
    try:
        os.close(master_fd)
        os.setsid()
        try:
            fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
        except Exception:
            pass
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        if slave_fd > 2:
            os.close(slave_fd)
        os.chdir(initial_cwd)
        os.environ["TERM"] = "xterm-256color"
        os.environ["COLORTERM"] = "truecolor"
        os.environ["PS1"] = "\\\\[\\\\033[38;2;199;255;101m\\\\]obsidian\\\\[\\\\033[0m\\\\]:\\\\[\\\\033[38;2;141;168;255m\\\\]\\\\w\\\\[\\\\033[0m\\\\]$ "
        if shell_bin.endswith("bash"):
            os.execv(shell_bin, [shell_bin, "--norc", "-i"])
        else:
            os.execv(shell_bin, [shell_bin, "-i"])
    except Exception as child_err:
        os.write(2, f"Shell exec error: {child_err}\\r\\n".encode("utf-8"))
        os._exit(127)

os.close(slave_fd)

# Make master_fd and stdin non-blocking
for fd in (master_fd, 0):
    fl = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)

sys.stdout.write(json.dumps({
    "type": "ready",
    "shellPid": pid,
    "ttyPath": tty_path
}) + "\\n")
sys.stdout.flush()

stdin_buf = b""
child_exited = False
exit_code = 0
exit_sig = None

while True:
    try:
        wpid, status = os.waitpid(pid, os.WNOHANG)
        if wpid == pid:
            child_exited = True
            if os.WIFEXITED(status):
                exit_code = os.WEXITSTATUS(status)
            elif os.WIFSIGNALED(status):
                exit_sig = str(os.WTERMSIG(status))
                exit_code = 128 + os.WTERMSIG(status)
    except ChildProcessError:
        child_exited = True

    rlist = [master_fd, 0] if not child_exited else [master_fd]
    try:
        readable, _, _ = select.select(rlist, [], [], 0.05)
    except Exception:
        readable = []

    if master_fd in readable:
        try:
            data = os.read(master_fd, 16384)
            if data:
                sys.stdout.write(json.dumps({
                    "type": "data",
                    "b64": base64.b64encode(data).decode("ascii")
                }) + "\\n")
                sys.stdout.flush()
            else:
                if child_exited:
                    break
        except OSError as e:
            if e.errno == errno.EIO:
                break
            elif e.errno not in (errno.EAGAIN, errno.EWOULDBLOCK):
                break

    if 0 in readable:
        try:
            chunk = os.read(0, 16384)
            if not chunk:
                break
            stdin_buf += chunk
            while b"\\n" in stdin_buf:
                line, stdin_buf = stdin_buf.split(b"\\n", 1)
                if not line.strip():
                    continue
                try:
                    msg = json.loads(line.decode("utf-8"))
                    mtype = msg.get("type")
                    if mtype == "input":
                        raw = base64.b64decode(msg.get("b64", ""))
                        if raw:
                            os.write(master_fd, raw)
                    elif mtype == "resize":
                        c = int(msg.get("cols", 80))
                        r = int(msg.get("rows", 24))
                        set_winsize(master_fd, r, c)
                        try:
                            pgrp = os.tcgetpgrp(master_fd)
                            os.killpg(pgrp, signal.SIGWINCH)
                        except Exception:
                            try:
                                os.kill(pid, signal.SIGWINCH)
                            except Exception:
                                pass
                    elif mtype == "interrupt":
                        # Send SIGINT to foreground process group on the PTY
                        try:
                            pgrp = os.tcgetpgrp(master_fd)
                            if pgrp > 0 and pgrp != pid:
                                os.killpg(pgrp, signal.SIGINT)
                            else:
                                os.write(master_fd, b"\\x03")
                        except Exception:
                            os.write(master_fd, b"\\x03")
                    elif mtype == "terminate":
                        try:
                            os.killpg(pid, signal.SIGTERM)
                        except Exception:
                            try:
                                os.kill(pid, signal.SIGTERM)
                            except Exception:
                                pass
                except Exception:
                    pass
        except OSError:
            pass

    if child_exited and master_fd not in readable:
        break

try:
    os.close(master_fd)
except Exception:
    pass

sys.stdout.write(json.dumps({
    "type": "exit",
    "exitCode": exit_code,
    "exitSignal": exit_sig
}) + "\\n")
sys.stdout.flush()
`;

export function detectAvailableHostShell(preferredShell?: string): {
  shellPath: string;
  python3Available: boolean;
  platform: NodeJS.Platform;
} {
  const platform = os.platform();
  if (preferredShell) {
    if (!fs.existsSync(preferredShell)) {
      throw new Error(`Requested shell executable not found: ${preferredShell}`);
    }
    try {
      fs.accessSync(preferredShell, fs.constants.X_OK);
    } catch {
      throw new Error(`Permission denied: shell executable is not runnable: ${preferredShell}`);
    }
  }

  let shellPath = preferredShell || '';
  if (!shellPath) {
    if (platform === 'win32') {
      shellPath = process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe';
    } else {
      const candidates = ['/bin/bash', '/usr/bin/bash', '/bin/sh', '/usr/bin/sh'];
      shellPath = candidates.find((c) => fs.existsSync(c)) || '/bin/sh';
    }
  }

  const pythonCandidates = ['/usr/bin/python3', '/bin/python3', '/usr/local/bin/python3'];
  const python3Available =
    platform !== 'win32' && pythonCandidates.some((p) => fs.existsSync(p));

  return { shellPath, python3Available, platform };
}

export class PersistentPtySessionManager {
  private sessions = new Map<string, InternalPtySession>();
  private getWorkspaceRootFn: (workspaceId: string) => string;
  private getKnownSecretsFn: () => string[];

  constructor(
    getWorkspaceRootFn: (workspaceId: string) => string,
    getKnownSecretsFn: () => string[] = () => []
  ) {
    this.getWorkspaceRootFn = getWorkspaceRootFn;
    this.getKnownSecretsFn = getKnownSecretsFn;
  }

  private resolveLiveCwd(session: InternalPtySession): string {
    if (session.shellPid && session.status === 'running') {
      if (process.platform === 'win32') {
        // Parse the latest Windows prompt path (e.g. "PS C:\Users\...>" or "C:\Users\...>") from scrollback
        const tail = session.scrollback.slice(-2048);
        const lines = tail.split(/\r?\n/);
        for (let i = lines.length - 1; i >= 0; i--) {
          const clean = lines[i].replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
          const match = clean.match(/^(?:PS\s+)?([A-Za-z]:\\[^>]*?)>\s*$/);
          if (match && match[1]) {
            const candidate = match[1].trim();
            try {
              if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
                session.cwd = candidate;
                break;
              }
            } catch {
              // ignore
            }
          }
        }
      } else {
        const procCwdLink = `/proc/${session.shellPid}/cwd`;
        try {
          if (fs.existsSync(procCwdLink)) {
            const real = fs.readlinkSync(procCwdLink);
            if (real) {
              session.cwd = real;
            }
          }
        } catch {
          // Fallback to last known session.cwd if /proc/<pid>/cwd is unreadable
        }
      }
    }
    return session.cwd;
  }

  private toSummary(session: InternalPtySession): TerminalSessionSummary {
    return {
      sessionId: session.sessionId,
      title: session.title,
      workspaceId: session.workspaceId,
      workspaceRoot: session.workspaceRoot,
      cwd: this.resolveLiveCwd(session),
      shell: session.shell,
      shellPid: session.shellPid,
      bridgePid: session.bridgePid,
      ttyPath: session.ttyPath,
      transportMode: session.transportMode,
      status: session.status,
      exitCode: session.exitCode,
      exitSignal: session.exitSignal,
      cols: session.cols,
      rows: session.rows,
      createdAtMillis: session.createdAtMillis,
      lastActivityMillis: session.lastActivityMillis,
      errorMessage: session.errorMessage,
    };
  }

  listSessions(workspaceId?: string): TerminalSessionSummary[] {
    const all = Array.from(this.sessions.values())
      .filter((s) => !workspaceId || s.workspaceId === workspaceId)
      .sort((a, b) => a.createdAtMillis - b.createdAtMillis);
    return all.map((s) => this.toSummary(s));
  }

  getSession(sessionId: string): (TerminalSessionSummary & { scrollback: string }) | null {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    return {
      ...this.toSummary(s),
      scrollback: s.scrollback,
    };
  }

  /**
   * Creates a new persistent interactive shell session backed by a real OS PTY (or pipe fallback).
   */
  async createSession(options: {
    workspaceId: string;
    cwd?: string;
    shell?: string;
    cols?: number;
    rows?: number;
    title?: string;
  }): Promise<TerminalSessionSummary & { scrollback: string }> {
    const workspaceId = options.workspaceId || 'android-workstation';
    const workspaceRoot = this.getWorkspaceRootFn(workspaceId);

    if (!fs.existsSync(workspaceRoot) || !fs.statSync(workspaceRoot).isDirectory()) {
      throw new Error(`Workspace root directory does not exist: ${workspaceRoot}`);
    }

    let initialCwd = workspaceRoot;
    if (options.cwd && options.cwd.trim()) {
      const candidate = path.resolve(workspaceRoot, options.cwd.trim());
      if (candidate !== workspaceRoot && !candidate.startsWith(workspaceRoot + path.sep)) {
        throw new Error(
          `Security Policy: Initial working directory '${options.cwd}' escapes workspace root (${workspaceRoot}).`
        );
      }
      if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
        throw new Error(`Working directory does not exist: ${options.cwd}`);
      }
      try {
        fs.accessSync(candidate, fs.constants.R_OK | fs.constants.X_OK);
      } catch {
        throw new Error(`Permission denied accessing working directory: ${options.cwd}`);
      }
      initialCwd = candidate;
    }

    const { shellPath, python3Available } = detectAvailableHostShell(options.shell);
    const cols = Math.max(20, Math.min(400, Number(options.cols) || 100));
    const rows = Math.max(8, Math.min(200, Number(options.rows) || 30));
    const sessionId = `pty-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const existingForWs = this.listSessions(workspaceId);
    const shellBaseName = path.basename(shellPath).replace(/\.exe$/i, '').toLowerCase() || 'shell';
    const title = options.title || `${shellBaseName} #${existingForWs.length + 1}`;

    const emitter = new EventEmitter();
    emitter.setMaxListeners(50);

    let resolveReadyFn: (() => void) | undefined;
    const readyPromise = new Promise<void>((resolve) => {
      resolveReadyFn = resolve;
    });

    const sanitizedEnv = buildSanitizedProcessEnv(process.env, this.getKnownSecretsFn());

    const session: InternalPtySession = {
      sessionId,
      title,
      workspaceId,
      workspaceRoot,
      cwd: initialCwd,
      shell: shellPath,
      shellPid: null,
      bridgePid: null,
      ttyPath: null,
      transportMode: python3Available ? 'pty' : 'pipe',
      status: 'running',
      exitCode: null,
      exitSignal: null,
      cols,
      rows,
      createdAtMillis: Date.now(),
      lastActivityMillis: Date.now(),
      proc: null,
      utf8Decoder: new StringDecoder('utf8'),
      controlBuffer: '',
      scrollback: '',
      emitter,
      readyPromise,
      resolveReady: resolveReadyFn,
      execMutex: Promise.resolve(),
    };

    this.sessions.set(sessionId, session);

    if (python3Available) {
      const proc = spawn(
        'python3',
        ['-u', '-c', PYTHON_PTY_BRIDGE_SCRIPT, shellPath, initialCwd, String(cols), String(rows)],
        {
          cwd: initialCwd,
          env: sanitizedEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );

      session.proc = proc;
      session.bridgePid = proc.pid ?? null;

      proc.stdout.on('data', (chunk: Buffer) => {
        session.controlBuffer += chunk.toString('utf8');
        while (session.controlBuffer.includes('\n')) {
          const idx = session.controlBuffer.indexOf('\n');
          const line = session.controlBuffer.slice(0, idx).trim();
          session.controlBuffer = session.controlBuffer.slice(idx + 1);
          if (!line) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === 'ready') {
              session.shellPid = typeof msg.shellPid === 'number' ? msg.shellPid : null;
              session.ttyPath = typeof msg.ttyPath === 'string' ? msg.ttyPath : null;
              session.resolveReady?.();
              session.emitter.emit('status', this.toSummary(session));
            } else if (msg.type === 'data') {
              const rawBytes = Buffer.from(msg.b64 || '', 'base64');
              const decoded = session.utf8Decoder.write(rawBytes);
              if (decoded) {
                this.appendOutput(session, decoded);
              }
            } else if (msg.type === 'error') {
              session.status = 'error';
              session.errorMessage = String(msg.message || 'PTY bridge error');
              session.resolveReady?.();
              session.emitter.emit('status', this.toSummary(session));
            } else if (msg.type === 'exit') {
              const trailing = session.utf8Decoder.end();
              if (trailing) this.appendOutput(session, trailing);
              session.status = 'exited';
              session.exitCode = typeof msg.exitCode === 'number' ? msg.exitCode : 0;
              session.exitSignal = msg.exitSignal || null;
              session.resolveReady?.();
              session.emitter.emit('status', this.toSummary(session));
            }
          } catch {
            // Ignore malformed line
          }
        }
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        const errText = chunk.toString('utf8');
        this.appendOutput(session, errText);
      });

      proc.on('close', (code, sig) => {
        if (session.status === 'running') {
          session.status = 'exited';
          session.exitCode = code ?? 0;
          session.exitSignal = sig || null;
        }
        session.resolveReady?.();
        session.emitter.emit('status', this.toSummary(session));
      });

      proc.on('error', (err) => {
        session.status = 'error';
        session.errorMessage = err.message;
        session.resolveReady?.();
        session.emitter.emit('status', this.toSummary(session));
      });
    } else {
      // Honest pipe fallback when Python PTY bridge is unavailable
      const isWindows = process.platform === 'win32';
      const lowerShell = shellPath.toLowerCase();
      const isPowerShell = lowerShell.endsWith('powershell.exe') || lowerShell.endsWith('pwsh.exe');
      const shellArgs = isWindows
        ? isPowerShell
          ? ['-NoLogo', '-NoExit']
          : []
        : ['-i'];
      const proc = spawn(shellPath, shellArgs, {
        cwd: initialCwd,
        env: sanitizedEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      session.proc = proc;
      session.shellPid = proc.pid ?? null;
      session.bridgePid = proc.pid ?? null;

      proc.stdout.on('data', (chunk: Buffer) => {
        const text = session.utf8Decoder.write(chunk);
        if (text) this.appendOutput(session, text);
        session.resolveReady?.();
      });
      proc.stderr.on('data', (chunk: Buffer) => {
        this.appendOutput(session, chunk.toString('utf8'));
        session.resolveReady?.();
      });
      proc.on('close', (code, sig) => {
        session.status = 'exited';
        session.exitCode = code ?? 0;
        session.exitSignal = sig || null;
        session.resolveReady?.();
        session.emitter.emit('status', this.toSummary(session));
      });
      // Fallback resolve after 250ms if shell does not emit an initial banner
      setTimeout(() => session.resolveReady?.(), 250);
    }

    // Wait up to 1.5s for PTY ready event
    await Promise.race([
      session.readyPromise,
      new Promise<void>((r) => setTimeout(r, 1500)),
    ]);

    if (session.status === 'error') {
      throw new Error(session.errorMessage || 'Failed to initialize PTY session');
    }

    return {
      ...this.toSummary(session),
      scrollback: session.scrollback,
    };
  }

  private appendOutput(session: InternalPtySession, rawText: string): void {
    const redacted = SecretRedactor.redact(rawText, this.getKnownSecretsFn());
    session.lastActivityMillis = Date.now();
    session.scrollback += redacted;
    if (session.scrollback.length > MAX_SCROLLBACK_CHARS) {
      session.scrollback = session.scrollback.slice(
        session.scrollback.length - MAX_SCROLLBACK_CHARS
      );
    }
    this.resolveLiveCwd(session);
    session.emitter.emit('output', {
      data: redacted,
      cwd: session.cwd,
      timestampMillis: session.lastActivityMillis,
    });
  }

  /**
   * Sends raw keystrokes or text input directly into the persistent PTY session.
   */
  writeInput(sessionId: string, data: string): TerminalSessionSummary {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Terminal session not found: ${sessionId}`);
    }
    if (session.status !== 'running' || !session.proc || !session.proc.stdin) {
      throw new Error(`Terminal session ${sessionId} is not running (status: ${session.status}).`);
    }

    session.lastActivityMillis = Date.now();
    if (session.transportMode === 'pty') {
      const payload = JSON.stringify({
        type: 'input',
        b64: Buffer.from(data, 'utf8').toString('base64'),
      });
      session.proc.stdin.write(payload + '\n');
    } else {
      // In pipe mode (e.g. Windows cmd/powershell or Linux without python pty bridge),
      // carriage returns must include \n so the shell buffer flushes and executes commands.
      let normalized = data;
      if (normalized === '\r') {
        normalized = '\r\n';
      } else {
        normalized = normalized.replace(/\r(?!\n)/g, '\r\n');
      }
      session.proc.stdin.write(normalized);
    }


    // Schedule a quick cwd refresh on Enter key
    if (data.includes('\r') || data.includes('\n')) {
      setTimeout(() => {
        if (session.status === 'running') {
          this.resolveLiveCwd(session);
          session.emitter.emit('status', this.toSummary(session));
        }
      }, 90);
    }

    return this.toSummary(session);
  }

  /**
   * Resizes the real PTY window (`TIOCSWINSZ`) and delivers `SIGWINCH` to the foreground process group.
   */
  resizeSession(sessionId: string, cols: number, rows: number): TerminalSessionSummary {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Terminal session not found: ${sessionId}`);
    }
    const safeCols = Math.max(20, Math.min(400, Math.floor(cols)));
    const safeRows = Math.max(5, Math.min(200, Math.floor(rows)));
    session.cols = safeCols;
    session.rows = safeRows;

    if (session.status === 'running' && session.proc?.stdin && session.transportMode === 'pty') {
      session.proc.stdin.write(
        JSON.stringify({ type: 'resize', cols: safeCols, rows: safeRows }) + '\n'
      );
    }
    session.emitter.emit('status', this.toSummary(session));
    return this.toSummary(session);
  }

  /**
   * Interrupts the currently running foreground process (`SIGINT` / Ctrl+C) inside the PTY
   * WITHOUT killing the persistent shell session itself.
   */
  interruptSession(sessionId: string): TerminalSessionSummary {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Terminal session not found: ${sessionId}`);
    }
    if (session.status === 'running' && session.proc?.stdin) {
      if (session.transportMode === 'pty') {
        // Send interrupt command to PTY bridge (which signals foreground process group or writes \x03)
        session.proc.stdin.write(JSON.stringify({ type: 'interrupt' }) + '\n');
      } else if (session.shellPid) {
        try {
          process.kill(session.shellPid, 'SIGINT');
        } catch {
          // ignore
        }
      }
    }
    return this.toSummary(session);
  }

  /**
   * Clears only the visible scrollback buffer without resetting the shell process,
   * working directory, or environment variables.
   */
  clearScrollback(sessionId: string): TerminalSessionSummary {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Terminal session not found: ${sessionId}`);
    }
    session.scrollback = '';
    session.emitter.emit('clear', { sessionId });
    return this.toSummary(session);
  }

  /**
   * Terminates the old shell session cleanly and spawns a fresh session in the same workspace.
   */
  async restartSession(
    sessionId: string
  ): Promise<TerminalSessionSummary & { scrollback: string }> {
    const existing = this.sessions.get(sessionId);
    if (!existing) {
      throw new Error(`Terminal session not found: ${sessionId}`);
    }
    const { workspaceId, shell, cols, rows, title } = existing;
    await this.closeSession(sessionId, true);
    return this.createSession({
      workspaceId,
      shell,
      cols,
      rows,
      title,
    });
  }

  /**
   * Terminates the PTY bridge and shell process group and cleans up listeners.
   */
  async closeSession(sessionId: string, removeFromMap = false): Promise<TerminalSessionSummary> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Terminal session not found: ${sessionId}`);
    }

    if (session.status === 'running' && session.proc) {
      try {
        if (session.transportMode === 'pty' && session.proc.stdin) {
          session.proc.stdin.write(JSON.stringify({ type: 'terminate' }) + '\n');
        }
      } catch {
        // ignore
      }

      if (session.shellPid) {
        try {
          process.kill(-session.shellPid, 'SIGTERM');
        } catch {
          try {
            process.kill(session.shellPid, 'SIGTERM');
          } catch {
            // already exited
          }
        }
      }

      try {
        session.proc.kill('SIGTERM');
      } catch {
        // ignore
      }

      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (session.shellPid) {
            try {
              process.kill(-session.shellPid, 'SIGKILL');
            } catch {
              try {
                process.kill(session.shellPid, 'SIGKILL');
              } catch {
                // ignore
              }
            }
          }
          try {
            session.proc?.kill('SIGKILL');
          } catch {
            // ignore
          }
          resolve();
        }, 250);

        session.proc?.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    session.status = 'exited';
    const summary = this.toSummary(session);
    session.emitter.emit('status', summary);
    session.emitter.removeAllListeners();

    if (removeFromMap) {
      this.sessions.delete(sessionId);
    }
    return summary;
  }

  /**
   * Subscribes to live output, status, clear, and agent activity events for a session (used by SSE).
   */
  subscribe(
    sessionId: string,
    handlers: {
      onOutput: (payload: { data: string; cwd: string; timestampMillis: number }) => void;
      onStatus: (summary: TerminalSessionSummary) => void;
      onClear?: () => void;
      onAgentEvent?: (payload: { state: string; command: string }) => void;
    }
  ): () => void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Terminal session not found: ${sessionId}`);
    }
    session.emitter.on('output', handlers.onOutput);
    session.emitter.on('status', handlers.onStatus);
    if (handlers.onClear) session.emitter.on('clear', handlers.onClear);
    if (handlers.onAgentEvent) session.emitter.on('agent_event', handlers.onAgentEvent);

    return () => {
      session.emitter.off('output', handlers.onOutput);
      session.emitter.off('status', handlers.onStatus);
      if (handlers.onClear) session.emitter.off('clear', handlers.onClear);
      if (handlers.onAgentEvent) session.emitter.off('agent_event', handlers.onAgentEvent);
    };
  }

  /**
   * Emits a visible notification on all active sessions in a workspace when the AI agent
   * is running a tool command, without hijacking or corrupting the user's interactive PTY state.
   */
  notifyAgentCommandActivity(workspaceId: string, state: 'running' | 'completed' | 'failed', command: string): void {
    for (const session of this.sessions.values()) {
      if (session.workspaceId === workspaceId && session.status === 'running') {
        session.emitter.emit('agent_event', { state, command });
      }
    }
  }

  /**
   * Executes a command inside the persistent interactive shell session using a unique
   * completion sentinel so `cd`, `export VAR=val`, shell functions, and aliases persist
   * across invocations while still returning deterministic output, real exitCode, and real cwd.
   */
  async executeInSession(
    sessionId: string,
    command: string,
    timeoutMs = 20_000,
    signal?: AbortSignal
  ): Promise<SessionCommandResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Terminal session not found: ${sessionId}`);
    }
    if (session.status !== 'running') {
      throw new Error(`Terminal session ${sessionId} is not running (status: ${session.status}).`);
    }

    const safety = evaluateCommandSafety(command);
    if (safety.riskLevel === 'FORBIDDEN') {
      return {
        sessionId,
        command,
        output: `Security Policy Blocked: ${safety.reason}`,
        exitCode: 126,
        cwd: this.resolveLiveCwd(session),
        shellPid: session.shellPid,
        ttyPath: session.ttyPath,
        transportMode: session.transportMode,
        durationMs: 0,
        timedOut: false,
        interrupted: false,
      };
    }

    // Serialize sentinel executions per session so concurrent calls don't interleave
    const runTask = async (): Promise<SessionCommandResult> => {
      await session.readyPromise;
      const start = Date.now();
      const token = crypto.randomBytes(6).toString('hex');
      const startMarker = `__OBS_BEGIN_${token}__`;
      const endPrefix = `__OBS_END_${token}_`;

      let collected = '';
      let timedOut = false;
      let interrupted = false;

      return new Promise<SessionCommandResult>((resolve) => {
        const cleanup = () => {
          clearTimeout(timer);
          session.emitter.off('output', onOutput);
          if (signal) signal.removeEventListener('abort', onAbort);
        };

        const finish = (exitCode: number, rawCaptured: string, pwdFromMarker?: string) => {
          cleanup();
          if (pwdFromMarker && pwdFromMarker.trim()) {
            session.cwd = pwdFromMarker.trim();
          } else {
            this.resolveLiveCwd(session);
          }

          // Enforce workspace boundary if user attempted `cd` outside workspaceRoot
          const wsRoot = session.workspaceRoot;
          let boundaryWarning = '';
          const normCwd = process.platform === 'win32' ? session.cwd.toLowerCase() : session.cwd;
          const normRoot = process.platform === 'win32' ? wsRoot.toLowerCase() : wsRoot;
          if (
            normCwd !== normRoot &&
            !normCwd.startsWith(normRoot + path.sep)
          ) {
            boundaryWarning = `\n[Security Policy: Directory '${session.cwd}' is outside workspace root '${wsRoot}'. Restoring working directory to '${wsRoot}'.]`;
            const restoreCmd = session.shell.toLowerCase().endsWith('cmd.exe')
              ? `cd /d "${wsRoot}"\r\n`
              : `cd "${wsRoot}"\r`;
            this.writeInput(sessionId, restoreCmd);
            session.cwd = wsRoot;
            exitCode = 1;
          }

          session.emitter.emit('status', this.toSummary(session));

          resolve({
            sessionId,
            command,
            output: (rawCaptured + boundaryWarning).trim(),
            exitCode,
            cwd: session.cwd,
            shellPid: session.shellPid,
            ttyPath: session.ttyPath,
            transportMode: session.transportMode,
            durationMs: Date.now() - start,
            timedOut,
            interrupted,
          });
        };

        const onOutput = (payload: { data: string }) => {
          collected += payload.data;
          const endRegex = new RegExp(`(?:^|\\r?\\n)\\s*${endPrefix}(-?\\d+)_([^\\r\\n]*)__`);
          const match = collected.match(endRegex);
          if (match) {
            const code = parseInt(match[1], 10);
            const markerPwd = match[2];
            // Extract output between the actual startMarker output line and endPrefix
            let body = collected;
            const startLines = body.split(/\r?\n/);
            // Find the line that equals startMarker (not the echoed command line containing `printf` or `echo`)
            let startLineIdx = -1;
            for (let i = 0; i < startLines.length; i++) {
              const stripped = startLines[i].replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
              if (stripped === startMarker || stripped.endsWith(`>${startMarker}`)) {
                startLineIdx = i;
                break;
              }
            }
            if (startLineIdx >= 0) {
              body = startLines.slice(startLineIdx + 1).join('\n');
            }
            const endIdx = body.indexOf(endPrefix);
            if (endIdx >= 0) {
              body = body.slice(0, endIdx);
            }
            // Strip trailing prompt or sentinel echo lines
            const cleanedLines = body
              .split(/\r?\n/)
              .filter((ln) => {
                const trimmed = ln.trim();
                if (!trimmed) return true;
                if (
                  ln.includes(startMarker) ||
                  ln.includes(endPrefix) ||
                  ln.includes('__OBS_EC=') ||
                  ln.includes('$LASTEXITCODE')
                ) {
                  return false;
                }
                // Filter out cmd.exe echoed prompt lines (e.g. "C:\Users\...>command")
                if (process.platform === 'win32' && /^[A-Za-z]:\\[^>]*>/.test(trimmed)) {
                  return false;
                }
                return true;
              });
            finish(Number.isNaN(code) ? 0 : code, cleanedLines.join('\n'), markerPwd);
          }
        };

        const onAbort = () => {
          interrupted = true;
          this.interruptSession(sessionId);
          setTimeout(() => {
            finish(130, collected);
          }, 120);
        };

        if (signal) {
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener('abort', onAbort, { once: true });
        }

        const timer = setTimeout(() => {
          timedOut = true;
          this.interruptSession(sessionId);
          setTimeout(() => {
            finish(124, `${collected}\n[Command timed out after ${timeoutMs}ms]`);
          }, 120);
        }, Math.max(100, timeoutMs));

        session.emitter.on('output', onOutput);

        // Dispatch command wrapped with start and end sentinels inside the persistent shell
        const lowerShell = session.shell.toLowerCase();
        const isWindowsCmd = lowerShell.endsWith('cmd.exe');
        const isPowerShell = lowerShell.endsWith('powershell.exe') || lowerShell.endsWith('pwsh.exe');

        let wrappedCmd: string;
        if (isWindowsCmd) {
          const trimmedCmd = command.trim();
          const cmdForShell =
            trimmedCmd === 'pwd'
              ? 'cd'
              : trimmedCmd === 'ls'
              ? 'dir /b'
              : command.replace(/(^|[&\s|;])pwd(?=$|[&\s|;])/g, '$1cd');
          wrappedCmd = `@echo ${startMarker}\r\n${cmdForShell}\r\n@echo ${endPrefix}%ERRORLEVEL%_%CD%__\r\n`;
        } else if (isPowerShell) {
          wrappedCmd = `Write-Output "${startMarker}"; ${command}; $__OBS_EC = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } elseif ($?) { 0 } else { 1 }; Write-Output "${endPrefix}\${$__OBS_EC}_$((Get-Location).Path)__"\r\n`;
        } else {
          wrappedCmd = `printf "\\n${startMarker}\\n"; ${command}\n__OBS_EC=$?; printf "\\n${endPrefix}%d_%s__\\n" "$__OBS_EC" "$PWD"\r`;
        }
        this.writeInput(sessionId, wrappedCmd);
      });
    };

    const nextPromise = session.execMutex.then(runTask, runTask);
    session.execMutex = nextPromise.catch(() => {});
    return nextPromise;
  }
}
