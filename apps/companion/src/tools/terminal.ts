/**
 * Obsidian Duet Agent - Restricted Terminal Command Runner
 * Structured execution via direct child_process.spawn (no raw shell string interpolation).
 */

import { spawn } from 'child_process';
import path from 'path';
import { PermissionPolicyEnforcer } from './policies.js';

export interface CommandExecutionResult {
  executable: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
}

export class RestrictedTerminalRunner {
  private enforcer: PermissionPolicyEnforcer;
  private static readonly MAX_OUTPUT_BYTES = 64 * 1024; // 64KB

  constructor(enforcer: PermissionPolicyEnforcer) {
    this.enforcer = enforcer;
  }

  public async executeCommand(
    executable: string,
    args: string[] = [],
    cwd: string,
    options: {
      timeoutMs?: number;
      dryRun?: boolean;
      signal?: AbortSignal;
    } = {}
  ): Promise<CommandExecutionResult> {
    const validatedExe = this.enforcer.validateTerminalExecutable(executable);
    const validatedCwd = this.enforcer.validateProjectPath(cwd);
    const timeoutMs = options.timeoutMs ?? 30000;

    if (options.dryRun) {
      return {
        executable: validatedExe,
        args,
        cwd: validatedCwd,
        exitCode: 0,
        durationMs: 0,
        stdout: `[DRY-RUN] Would execute: ${validatedExe} ${args.join(' ')} in ${validatedCwd}`,
        stderr: '',
        timedOut: false,
        cancelled: false,
      };
    }

    const start = Date.now();

    // Sanitize environment variables to prevent secret leakage to child processes
    const cleanEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v === undefined) continue;
      const lower = k.toLowerCase();
      if (lower.includes('key') || lower.includes('token') || lower.includes('secret') || lower.includes('password')) {
        continue;
      }
      cleanEnv[k] = v;
    }

    return new Promise<CommandExecutionResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let cancelled = false;

      // On Windows, resolve executable extension if needed
      const spawnCmd = process.platform === 'win32' && !validatedExe.endsWith('.exe') && !validatedExe.endsWith('.cmd')
        ? `${validatedExe}.cmd`
        : validatedExe;

      const child = spawn(spawnCmd, args, {
        cwd: validatedCwd,
        env: cleanEnv,
        shell: process.platform === 'win32', // Windows requires shell to resolve .cmd / .bat in PATH
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);

      if (options.signal) {
        options.signal.addEventListener('abort', () => {
          cancelled = true;
          child.kill('SIGINT');
        });
      }

      child.stdout.on('data', (chunk: Buffer) => {
        if (stdout.length < RestrictedTerminalRunner.MAX_OUTPUT_BYTES) {
          stdout += chunk.toString('utf-8');
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < RestrictedTerminalRunner.MAX_OUTPUT_BYTES) {
          stderr += chunk.toString('utf-8');
        }
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          executable: validatedExe,
          args,
          cwd: validatedCwd,
          exitCode: code,
          durationMs: Date.now() - start,
          stdout: stdout.slice(0, RestrictedTerminalRunner.MAX_OUTPUT_BYTES),
          stderr: stderr.slice(0, RestrictedTerminalRunner.MAX_OUTPUT_BYTES),
          timedOut,
          cancelled,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          executable: validatedExe,
          args,
          cwd: validatedCwd,
          exitCode: 1,
          durationMs: Date.now() - start,
          stdout,
          stderr: `Spawn error: ${err.message}`,
          timedOut,
          cancelled,
        });
      });
    });
  }
}
