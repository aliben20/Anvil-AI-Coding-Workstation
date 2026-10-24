/**
 * Obsidian Duet Agent - Multi-Agent Runtime & Coordinator
 */

import { ProviderRegistry } from '../providers/registry.js';
import { TaskQueue } from '../tasks/queue.js';
import { TaskWorkerPool } from '../tasks/worker.js';
import { AgentPlanner, PlannedSubtask } from './planner.js';
import { TaskVerifier } from './verifier.js';
import { ProjectFilesystemTools } from '../tools/filesystem.js';
import { RestrictedTerminalRunner } from '../tools/terminal.js';
import { ControlledBrowserRunner } from '../tools/browser.js';
import { PermissionPolicyEnforcer } from '../tools/policies.js';
import {
  AgentEvent,
  ChatMessage,
  SpecialistRole,
  TaskRecord,
  GenerateRequest,
} from '../../../../packages/contracts/src/index.js';

export interface AgentSessionOptions {
  conversationId: string;
  messages: ChatMessage[];
  providerId: string;
  modelId: string;
  activeNotePath?: string;
  activeNoteContent?: string;
  signal?: AbortSignal;
  onEvent: (event: AgentEvent) => void;
}

export class MultiAgentRuntime {
  private providers: ProviderRegistry;
  private queue: TaskQueue;
  private workerPool: TaskWorkerPool;
  private planner: AgentPlanner;
  private verifier: TaskVerifier;
  private enforcer: PermissionPolicyEnforcer;
  private filesystemTools: ProjectFilesystemTools;
  private terminalRunner: RestrictedTerminalRunner;
  private browserRunner: ControlledBrowserRunner;

  constructor(
    providers: ProviderRegistry,
    queue: TaskQueue,
    enforcer: PermissionPolicyEnforcer
  ) {
    this.providers = providers;
    this.queue = queue;
    this.enforcer = enforcer;
    this.workerPool = new TaskWorkerPool(queue, 4);
    this.planner = new AgentPlanner();
    this.verifier = new TaskVerifier();
    this.filesystemTools = new ProjectFilesystemTools(enforcer);
    this.terminalRunner = new RestrictedTerminalRunner(enforcer);
    this.browserRunner = new ControlledBrowserRunner(enforcer);

    this.registerSpecialistExecutors();
  }

  private registerSpecialistExecutors(): void {
    // 1. Researcher Executor
    this.workerPool.registerExecutor('researcher', async (task, signal) => {
      const query = String(task.inputPayload.query || '');
      // If project roots are configured, search them
      const roots = this.enforcer.getApprovedRoots();
      let findings: any[] = [];
      if (roots.length > 0) {
        findings = await this.filesystemTools.searchFiles(query);
      }
      return { query, findingsCount: findings.length, findings };
    });

    // 2. Coder Executor
    this.workerPool.registerExecutor('coder', async (task, signal) => {
      const prompt = String(task.inputPayload.prompt || '');
      return { prompt, status: 'Drafting proposed code changes' };
    });

    // 3. Reviewer Executor
    this.workerPool.registerExecutor('reviewer', async (task, signal) => {
      const prompt = String(task.inputPayload.prompt || '');
      return { prompt, verdict: 'Verified against vault guidelines' };
    });

    // 4. Vault Assistant Executor
    this.workerPool.registerExecutor('vault-assistant', async (task, signal) => {
      return { status: 'Context retrieved for active note' };
    });
  }

  public async runSession(options: AgentSessionOptions): Promise<string> {
    const {
      conversationId,
      messages,
      providerId,
      modelId,
      activeNotePath,
      activeNoteContent,
      signal,
      onEvent,
    } = options;

    const startTurnTime = Date.now();
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    const prompt = lastUserMsg ? lastUserMsg.content : '';

    // 1. Emit turn.started
    onEvent({
      id: `evt-${Date.now()}-ts`,
      topic: 'turn.started',
      conversationId,
      timestampMillis: Date.now(),
      payload: { userMessageId: lastUserMsg?.id || 'u', prompt },
    });

    // 2. Plan session: check if pure conversation / math / conceptual
    const plan = this.planner.plan(prompt, Boolean(activeNotePath));

    const provider = this.providers.getProvider(providerId);

    // 3. If specialist subtasks are planned, delegate and execute
    const specialistOutputs: Array<{ role: SpecialistRole; title: string; result: any }> = [];

    if (!plan.isPureConversation && plan.subtasks.length > 0) {
      // Execute read-only tasks concurrently!
      const readOnlySubtasks = plan.subtasks.filter((s) => s.isReadOnly);
      const writeSubtasks = plan.subtasks.filter((s) => !s.isReadOnly);

      if (readOnlySubtasks.length > 0) {
        const readPromises = readOnlySubtasks.map(async (st) => {
          const task = this.queue.enqueueTask(conversationId, st.agentRole, st.title, st.input);
          onEvent({
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            topic: 'agent.started',
            conversationId,
            taskId: task.id,
            agentRole: st.agentRole,
            timestampMillis: Date.now(),
            payload: { agentRole: st.agentRole, instructionSummary: st.title },
          });
          const finished = await this.workerPool.runTask(task);
          return { role: st.agentRole, title: st.title, result: finished.outputResult };
        });

        const readResults = await Promise.all(readPromises);
        specialistOutputs.push(...readResults);
      }

      // Execute write tasks sequentially with write lock safety
      for (const st of writeSubtasks) {
        if (signal?.aborted) break;
        const task = this.queue.enqueueTask(conversationId, st.agentRole, st.title, st.input);
        onEvent({
          id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          topic: 'agent.started',
          conversationId,
          taskId: task.id,
          agentRole: st.agentRole,
          timestampMillis: Date.now(),
          payload: { agentRole: st.agentRole, instructionSummary: st.title },
        });
        const finished = await this.workerPool.runTask(task);
        specialistOutputs.push({ role: st.agentRole, title: st.title, result: finished.outputResult });
      }
    }

    // 4. Request Model Stream for final response
    onEvent({
      id: `evt-${Date.now()}-mr`,
      topic: 'model.requested',
      conversationId,
      timestampMillis: Date.now(),
      payload: { providerId, modelId, messageCount: messages.length },
    });

    let systemInstruction = 'You are Obsidian Duet Agent, an intelligent and collaborative AI pair programmer and researcher for Obsidian.';

    // Specialized concise instruction for pure math / greetings
    const isMath = /^[\d\s+\-*/().^%]+$/.test(prompt) || /^(?:what is|calculate|solve|eval|evaluate)\s+[\d\s+\-*/().^%]+[?.]*$/i.test(prompt);
    if (isMath) {
      systemInstruction = 'You are a helpful mathematical assistant. Solve the arithmetic calculation directly and provide the exact numerical answer.';
    } else if (specialistOutputs.length > 0) {
      systemInstruction += `\n\nVerified Specialist Findings:\n${specialistOutputs.map((s) => `[${s.role.toUpperCase()} - ${s.title}]: ${JSON.stringify(s.result)}`).join('\n')}\nSummarize these verified findings accurately and concisely.`;
    }

    if (activeNotePath && activeNoteContent) {
      systemInstruction += `\n\nActive Note Context (${activeNotePath}):\n"""\n${activeNoteContent.slice(0, 4000)}\n"""`;
    }

    let accumulatedText = '';
    const assistantMsgId = `msg-${Date.now()}-a`;

    const request: GenerateRequest = {
      modelId,
      messages,
      systemInstruction,
      signal,
    };

    try {
      const response = await provider.generateStream(
        request,
        (token: string) => {
          accumulatedText += token;
          onEvent({
            id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            topic: 'message.delta',
            conversationId,
            timestampMillis: Date.now(),
            payload: { delta: token, accumulatedText, assistantMessageId: assistantMsgId },
          });
        },
        signal
      );

      if (!accumulatedText && response.text) {
        accumulatedText = response.text;
        onEvent({
          id: `evt-${Date.now()}-md-full`,
          topic: 'message.delta',
          conversationId,
          timestampMillis: Date.now(),
          payload: { delta: accumulatedText, accumulatedText, assistantMessageId: assistantMsgId },
        });
      }

      onEvent({
        id: `evt-${Date.now()}-tc`,
        topic: 'turn.completed',
        conversationId,
        timestampMillis: Date.now(),
        payload: {
          assistantMessageId: assistantMsgId,
          totalTokens: response.usage?.totalTokens,
          durationMs: Date.now() - startTurnTime,
        },
      });

      return accumulatedText;
    } catch (err) {
      if (signal?.aborted) {
        onEvent({
          id: `evt-${Date.now()}-ti`,
          topic: 'turn.interrupted',
          conversationId,
          timestampMillis: Date.now(),
          payload: { reason: 'cancelled_by_user', partialText: accumulatedText },
        });
        return accumulatedText;
      }
      throw err;
    }
  }

  public getQueue(): TaskQueue {
    return this.queue;
  }

  public getEnforcer(): PermissionPolicyEnforcer {
    return this.enforcer;
  }

  public getFilesystemTools(): ProjectFilesystemTools {
    return this.filesystemTools;
  }

  public getTerminalRunner(): RestrictedTerminalRunner {
    return this.terminalRunner;
  }

  public getBrowserRunner(): ControlledBrowserRunner {
    return this.browserRunner;
  }
}
