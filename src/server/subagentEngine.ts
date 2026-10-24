/**
 * @license MIT
 * OBSIDIAN Sub-Agent Orchestration & Task Delegation Engine
 *
 * Implements real hierarchical agent coordination:
 * - Built-in specialized roles: Planner, Researcher, Coder, Reviewer, Tester, Debugger.
 * - Parent agent task decomposition and bounded delegation to specialized child agents.
 * - Concurrency limits, task lifecycle (Queued, Running, Waiting, Completed, Failed, Cancelled).
 * - Real workspace execution via existing toolchain and provider model turn generators.
 * - Persistent task records in .anvil-data/subagents.json.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { WorkspaceManager, TerminalSessionManager, PermissionManager, EncryptedCredentialVault } from './workstationEngine.js';

export type SubAgentRole =
  | 'Planner'
  | 'Researcher'
  | 'Coder'
  | 'Reviewer'
  | 'Tester'
  | 'Debugger';

export type SubAgentStatus =
  | 'Queued'
  | 'Running'
  | 'Waiting'
  | 'Completed'
  | 'Failed'
  | 'Cancelled';

export interface SubAgentToolCall {
  tool: string;
  args?: Record<string, unknown>;
  result?: string;
  durationMs?: number;
  timestampMillis: number;
}

export interface SubAgentTask {
  id: string;
  parentId?: string;
  conversationId?: string;
  role: SubAgentRole;
  agentProfileId?: string;
  agentName?: string;
  title: string;
  taskPrompt: string;
  status: SubAgentStatus;
  providerId: string;
  modelId: string;
  workspaceId: string;
  currentStep?: string;
  progress?: number;
  toolCalls?: SubAgentToolCall[];
  changedFiles?: string[];
  output?: string;
  error?: string;
  durationMs?: number;
  createdAtMillis: number;
  updatedAtMillis: number;
  completedAtMillis?: number;
}


export interface RoleDefinition {
  role: SubAgentRole;
  title: string;
  description: string;
  systemInstruction: string;
  icon: string;
}

export const BUILTIN_SUBAGENT_ROLES: Record<SubAgentRole, RoleDefinition> = {
  Planner: {
    role: 'Planner',
    title: 'Architect & Task Planner',
    description: 'Decomposes complex goals into modular, bounded subtasks and dependency orders.',
    systemInstruction:
      'You are the OBSIDIAN Task Planner sub-agent. Given a high-level development goal, analyze the architectural requirements and produce a concrete, numbered sequence of bounded, actionable tasks for Researcher, Coder, and Tester agents. Be precise, avoid redundancy, and specify exact files and dependencies.',
    icon: 'Layers',
  },
  Researcher: {
    role: 'Researcher',
    title: 'Codebase & Docs Researcher',
    description: 'Inspects project files, libraries, configuration, and documentation to extract context.',
    systemInstruction:
      'You are the OBSIDIAN Codebase Researcher sub-agent. Your role is to examine the workspace codebase, understand directory structure, inspect relevant configuration files and code patterns, and summarize essential findings for the Coder agent.',
    icon: 'Search',
  },
  Coder: {
    role: 'Coder',
    title: 'Software Engineer & Implementer',
    description: 'Implements assigned features, bugfixes, and refactors within specified workspace boundaries.',
    systemInstruction:
      'You are the OBSIDIAN Coder sub-agent. Your role is to implement clean, production-grade code modifications matching the requirements. Preserve existing architectural conventions, handle edge cases, and ensure clean formatting.',
    icon: 'Code2',
  },
  Reviewer: {
    role: 'Reviewer',
    title: 'Code Quality & Logic Reviewer',
    description: 'Audits unified diffs, verifies logic correctness, and identifies potential regressions.',
    systemInstruction:
      'You are the OBSIDIAN Reviewer sub-agent. Inspect proposed file changes and unified diffs. Check for security vulnerabilities, syntax errors, edge-case regressions, and conformance with repository patterns. Provide a clear verdict (PASS or CHANGES_REQUESTED) with rationale.',
    icon: 'CheckSquare',
  },
  Tester: {
    role: 'Tester',
    title: 'Test Runner & Verifier',
    description: 'Executes automated tests, toolchain checks, and verifies output assertions.',
    systemInstruction:
      'You are the OBSIDIAN Tester sub-agent. Run verification commands and automated test suites. Parse stdout/stderr output, detect assertion failures, and provide a structured test report with passing and failing counts.',
    icon: 'Terminal',
  },
  Debugger: {
    role: 'Debugger',
    title: 'Diagnostics & Root Cause Debugger',
    description: 'Investigates stack traces, build failures, and runtime errors to formulate fixes.',
    systemInstruction:
      'You are the OBSIDIAN Debugger sub-agent. Analyze error logs, stack traces, compiler errors, or test failures. Identify the root cause accurately and provide targeted recommendations or diffs to resolve the defect.',
    icon: 'Bug',
  },
};

export class SubAgentManager {
  private dataDir: string;
  private tasksFile: string;
  private tasks: Map<string, SubAgentTask> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();
  private workspaceManager: WorkspaceManager;
  private terminalManager: TerminalSessionManager;
  private vault: EncryptedCredentialVault;

  // Delegation bounds
  private maxConcurrentTasks = 4;
  private maxExecutionTimeMs = 60_000;

  constructor(
    dataDir: string,
    workspaceManager: WorkspaceManager,
    terminalManager: TerminalSessionManager,
    vault: EncryptedCredentialVault
  ) {
    this.dataDir = dataDir;
    this.tasksFile = path.join(dataDir, 'subagent_tasks.json');
    this.workspaceManager = workspaceManager;
    this.terminalManager = terminalManager;
    this.vault = vault;
    this.loadTasks();
  }

  private loadTasks(): void {
    if (fs.existsSync(this.tasksFile)) {
      try {
        const raw = fs.readFileSync(this.tasksFile, 'utf8');
        const parsed: SubAgentTask[] = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const t of parsed) {
            // Reset any orphaned 'Running' tasks on server restart to 'Failed'
            if (t.status === 'Running') {
              t.status = 'Failed';
              t.error = 'Process interrupted by application restart.';
            }
            this.tasks.set(t.id, t);
          }
        }
      } catch {
        // ignore parse error
      }
    }
  }

  private saveTasks(): void {
    try {
      const list = Array.from(this.tasks.values());
      fs.writeFileSync(this.tasksFile, JSON.stringify(list, null, 2), 'utf8');
    } catch {
      // ignore write error
    }
  }

  listTasks(conversationId?: string): SubAgentTask[] {
    const all = Array.from(this.tasks.values()).sort(
      (a, b) => b.createdAtMillis - a.createdAtMillis
    );
    if (conversationId) {
      return all.filter((t) => !t.conversationId || t.conversationId === conversationId);
    }
    return all;
  }

  getTask(id: string): SubAgentTask | undefined {
    return this.tasks.get(id);
  }

  updateTaskProgress(
    taskId: string,
    update: {
      progress?: number;
      currentStep?: string;
      status?: SubAgentStatus;
      toolCall?: SubAgentToolCall;
      changedFile?: string;
      error?: string;
      output?: string;
    }
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (typeof update.progress === 'number') task.progress = Math.max(0, Math.min(100, Math.round(update.progress)));
    if (update.currentStep) task.currentStep = update.currentStep;
    if (update.status) task.status = update.status;
    if (update.toolCall) {
      task.toolCalls = task.toolCalls || [];
      task.toolCalls.push(update.toolCall);
    }
    if (update.changedFile) {
      task.changedFiles = task.changedFiles || [];
      if (!task.changedFiles.includes(update.changedFile)) {
        task.changedFiles.push(update.changedFile);
      }
    }
    if (update.error) task.error = update.error;
    if (update.output) task.output = update.output;
    task.updatedAtMillis = Date.now();
    this.saveTasks();
  }

  async spawnTask(params: {
    role: SubAgentRole;
    agentProfileId?: string;
    agentName?: string;
    title: string;
    taskPrompt: string;
    workspaceId: string;
    conversationId?: string;
    parentId?: string;
    providerId: string;
    modelId: string;
    executeTurnFn: (opts: {
      role: SubAgentRole;
      systemPrompt: string;
      userPrompt: string;
      workspaceId: string;
      signal: AbortSignal;
      updateStep: (step: string, progress?: number) => void;
      recordToolCall: (call: SubAgentToolCall) => void;
      recordChangedFile: (filePath: string) => void;
    }) => Promise<string>;
  }): Promise<SubAgentTask> {
    const runningCount = Array.from(this.tasks.values()).filter((t) => t.status === 'Running').length;
    if (runningCount >= this.maxConcurrentTasks) {
      throw new Error(`Sub-agent concurrency limit reached (${this.maxConcurrentTasks} concurrent tasks).`);
    }

    const taskId = `subtask-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const roleDef = BUILTIN_SUBAGENT_ROLES[params.role];
    if (!roleDef) {
      throw new Error(`Unknown sub-agent role: ${params.role}`);
    }

    const task: SubAgentTask = {
      id: taskId,
      parentId: params.parentId,
      conversationId: params.conversationId,
      role: params.role,
      agentProfileId: params.agentProfileId,
      agentName: params.agentName || roleDef.title,
      title: params.title || `${params.role} Task`,
      taskPrompt: params.taskPrompt,
      status: 'Running',
      providerId: params.providerId,
      modelId: params.modelId,
      workspaceId: params.workspaceId,
      currentStep: 'Initializing sub-agent environment...',
      progress: 10,
      toolCalls: [],
      changedFiles: [],
      createdAtMillis: Date.now(),
      updatedAtMillis: Date.now(),
    };

    this.tasks.set(taskId, task);
    this.saveTasks();

    const controller = new AbortController();
    this.abortControllers.set(taskId, controller);

    // Run execution asynchronously
    (async () => {
      const startTime = Date.now();
      try {
        const timeout = setTimeout(() => {
          controller.abort(new Error('Sub-agent task exceeded timeout limit.'));
        }, this.maxExecutionTimeMs);

        task.currentStep = `Executing ${params.role} analysis...`;
        task.progress = 25;
        this.saveTasks();

        const result = await params.executeTurnFn({
          role: params.role,
          systemPrompt: roleDef.systemInstruction,
          userPrompt: params.taskPrompt,
          workspaceId: params.workspaceId,
          signal: controller.signal,
          updateStep: (step: string, progress?: number) => {
            task.currentStep = step;
            if (typeof progress === 'number') task.progress = progress;
            task.updatedAtMillis = Date.now();
            this.saveTasks();
          },
          recordToolCall: (call: SubAgentToolCall) => {
            task.toolCalls = task.toolCalls || [];
            task.toolCalls.push(call);
            task.updatedAtMillis = Date.now();
            this.saveTasks();
          },
          recordChangedFile: (filePath: string) => {
            task.changedFiles = task.changedFiles || [];
            if (!task.changedFiles.includes(filePath)) {
              task.changedFiles.push(filePath);
            }
            task.updatedAtMillis = Date.now();
            this.saveTasks();
          },
        });

        clearTimeout(timeout);

        task.status = 'Completed';
        task.currentStep = 'Task completed successfully.';
        task.progress = 100;
        task.output = result;
        task.durationMs = Date.now() - startTime;
        task.completedAtMillis = Date.now();
        task.updatedAtMillis = Date.now();
      } catch (err: unknown) {
        if (controller.signal.aborted) {
          task.status = 'Cancelled';
          task.currentStep = 'Cancelled by user or timeout.';
          task.error = 'Task was cancelled by operator or timeout.';
        } else {
          task.status = 'Failed';
          task.currentStep = 'Execution encountered an error.';
          task.error = err instanceof Error ? err.message : String(err);
        }
        task.durationMs = Date.now() - startTime;
        task.updatedAtMillis = Date.now();
      } finally {
        this.abortControllers.delete(taskId);
        this.saveTasks();
      }
    })();

    return task;
  }

  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(taskId);
    }

    task.status = 'Cancelled';
    task.updatedAtMillis = Date.now();
    this.saveTasks();
    return true;
  }

  deleteTask(taskId: string): boolean {
    this.cancelTask(taskId);
    const deleted = this.tasks.delete(taskId);
    if (deleted) this.saveTasks();
    return deleted;
  }
}
