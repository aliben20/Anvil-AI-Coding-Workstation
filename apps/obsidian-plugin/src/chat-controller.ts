/**
 * Obsidian Duet Agent - Chat Controller
 * Manages active session, streaming event dispatch, vault tool invocations, and approval modals.
 */

import { App, Notice, TFile } from 'obsidian';
import { DuetPluginSettings, PluginChatMessage, PluginConversation } from './types.js';
import { CompanionClient } from './companion-client.js';
import { VaultTools } from './vault-tools.js';
import { ApprovalModal } from './approval-view.js';
import { AgentEvent, ApprovalRequest, FileDiffProposal, SpecialistRole } from '../../../packages/contracts/src/index.js';

export class ChatController {
  private app: App;
  private getSettings: () => DuetPluginSettings;
  private companionClient: CompanionClient;
  private vaultTools: VaultTools;
  private currentConversation: PluginConversation;
  private isGenerating = false;
  private onStateChange: (conv: PluginConversation, isGenerating: boolean) => void;
  private onActivityEvent: (event: AgentEvent) => void;

  constructor(
    app: App,
    getSettings: () => DuetPluginSettings,
    onStateChange: (conv: PluginConversation, isGenerating: boolean) => void,
    onActivityEvent: (event: AgentEvent) => void
  ) {
    this.app = app;
    this.getSettings = getSettings;
    this.onStateChange = onStateChange;
    this.onActivityEvent = onActivityEvent;
    this.companionClient = new CompanionClient(getSettings);
    this.vaultTools = new VaultTools(app);

    const initialSettings = getSettings();
    this.currentConversation = {
      id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: 'New Chat',
      providerId: initialSettings.defaultProviderId,
      modelId: initialSettings.defaultModelId,
      messages: [],
      createdAtMillis: Date.now(),
      updatedAtMillis: Date.now(),
    };
  }

  public getConversation(): PluginConversation {
    return this.currentConversation;
  }

  public getCompanionClient(): CompanionClient {
    return this.companionClient;
  }

  public getVaultTools(): VaultTools {
    return this.vaultTools;
  }

  public newConversation(): void {
    const settings = this.getSettings();
    this.currentConversation = {
      id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: 'New Chat',
      providerId: settings.defaultProviderId,
      modelId: settings.defaultModelId,
      messages: [],
      createdAtMillis: Date.now(),
      updatedAtMillis: Date.now(),
    };
    this.onStateChange(this.currentConversation, this.isGenerating);
  }

  public setProviderAndModel(providerId: string, modelId: string): void {
    this.currentConversation.providerId = providerId;
    this.currentConversation.modelId = modelId;
    this.onStateChange(this.currentConversation, this.isGenerating);
  }

  public stopGeneration(): void {
    if (this.isGenerating) {
      this.companionClient.cancel(this.currentConversation.id);
      this.isGenerating = false;
      const lastMsg = this.currentConversation.messages[this.currentConversation.messages.length - 1];
      if (lastMsg && lastMsg.role === 'assistant') {
        lastMsg.isStreaming = false;
        if (!lastMsg.content) {
          lastMsg.content = '[Generation stopped by user]';
        }
      }
      this.onStateChange(this.currentConversation, this.isGenerating);
    }
  }

  public async sendMessage(content: string): Promise<void> {
    const trimmed = content.trim();
    if (!trimmed || this.isGenerating) return;

    // 1. Add user message
    const userMsg: PluginChatMessage = {
      id: `msg-${Date.now()}-u`,
      role: 'user',
      content: trimmed,
      timestampMillis: Date.now(),
    };
    this.currentConversation.messages.push(userMsg);

    // Auto-title on first message
    if (this.currentConversation.messages.filter((m) => m.role === 'user').length === 1) {
      this.currentConversation.title = trimmed.split('\n')[0].slice(0, 32);
    }

    // 2. Prepare assistant placeholder
    const assistantMsgId = `msg-${Date.now()}-a`;
    const assistantMsg: PluginChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestampMillis: Date.now(),
      agentRole: this.getSettings().activeSpecialistRole,
      isStreaming: true,
      toolCalls: [],
    };
    this.currentConversation.messages.push(assistantMsg);

    this.isGenerating = true;
    this.currentConversation.updatedAtMillis = Date.now();
    this.onStateChange(this.currentConversation, this.isGenerating);

    // 3. Gather active note context if available
    let activeNotePath: string | undefined;
    let activeNoteContent: string | undefined;
    try {
      const active = await this.vaultTools.readActiveNote();
      if (active) {
        activeNotePath = active.path;
        activeNoteContent = active.content;
      }
    } catch {}

    // 4. Stream response from companion or execute fallback
    try {
      await this.companionClient.streamChat(
        {
          conversationId: this.currentConversation.id,
          content: trimmed,
          providerId: this.currentConversation.providerId,
          modelId: this.currentConversation.modelId,
          activeNotePath,
          activeNoteContent,
        },
        (event: AgentEvent) => {
          this.handleAgentEvent(event, assistantMsg);
        }
      );
    } catch (err) {
      const rawError = err instanceof Error ? err.message : String(err);
      assistantMsg.content += `\n\n**Error:** ${rawError}`;
      new Notice(`Duet Agent: ${rawError}`);
    } finally {
      this.isGenerating = false;
      assistantMsg.isStreaming = false;
      this.currentConversation.updatedAtMillis = Date.now();
      this.onStateChange(this.currentConversation, this.isGenerating);
      this.persistConversationToVault();
    }
  }

  private handleAgentEvent(event: AgentEvent, assistantMsg: PluginChatMessage): void {
    this.onActivityEvent(event);

    switch (event.topic) {
      case 'message.delta': {
        assistantMsg.content = event.payload.accumulatedText;
        this.onStateChange(this.currentConversation, this.isGenerating);
        break;
      }
      case 'agent.started': {
        assistantMsg.agentRole = event.payload.agentRole;
        this.onStateChange(this.currentConversation, this.isGenerating);
        break;
      }
      case 'tool.started': {
        if (!assistantMsg.toolCalls) assistantMsg.toolCalls = [];
        assistantMsg.toolCalls.push(event.payload.toolCall);
        this.onStateChange(this.currentConversation, this.isGenerating);
        break;
      }
      case 'tool.completed': {
        if (assistantMsg.toolCalls) {
          const tc = assistantMsg.toolCalls.find((t) => t.id === event.payload.toolCall.id);
          if (tc) {
            tc.status = event.payload.success ? 'succeeded' : 'failed';
          }
        }
        this.onStateChange(this.currentConversation, this.isGenerating);
        break;
      }
      case 'approval.required': {
        this.promptUserApproval(event.payload.request);
        break;
      }
      case 'turn.interrupted': {
        assistantMsg.content += '\n\n*[Task interrupted]*';
        this.isGenerating = false;
        this.onStateChange(this.currentConversation, this.isGenerating);
        break;
      }
      case 'turn.completed': {
        assistantMsg.isStreaming = false;
        this.isGenerating = false;
        this.onStateChange(this.currentConversation, this.isGenerating);
        break;
      }
    }
  }

  private async promptUserApproval(request: ApprovalRequest): Promise<void> {
    const modal = new ApprovalModal(this.app, request);
    const approved = await modal.waitForDecision();

    try {
      await this.companionClient.decideApproval(request.id, approved ? 'approved' : 'rejected');
      if (approved && request.diffProposal && request.diffProposal.isVaultFile) {
        // Execute the approved vault patch
        const res = await this.vaultTools.applyPatch(request.diffProposal);
        if (res.success) {
          new Notice(`Duet Agent: Applied changes to ${request.diffProposal.filePath}`);
        } else {
          new Notice(`Duet Agent: ${res.error}`);
        }
      }
    } catch (err) {
      new Notice(`Failed to submit approval: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Persists conversation history as a Markdown file in the configured vault directory.
   */
  public async persistConversationToVault(): Promise<void> {
    const folder = this.getSettings().conversationsFolder || 'Duet Chats';
    const safeTitle = (this.currentConversation.title || 'Chat')
      .replace(/[\\/:*?"<>|]/g, '-')
      .trim();
    const filePath = `${folder}/${safeTitle}-${this.currentConversation.id.slice(-6)}.md`;

    try {
      const abstractFolder = this.app.vault.getAbstractFileByPath(folder);
      if (!abstractFolder) {
        await this.app.vault.createFolder(folder);
      }

      let markdown = `# ${this.currentConversation.title}\n\n`;
      markdown += `*Provider: ${this.currentConversation.providerId} | Model: ${this.currentConversation.modelId}*\n\n---\n\n`;

      for (const msg of this.currentConversation.messages) {
        const roleHeader = msg.role === 'user' ? '### User' : `### Assistant (${msg.agentRole || 'Duet'})`;
        markdown += `${roleHeader}\n${msg.content}\n\n`;
      }

      const existingFile = this.app.vault.getAbstractFileByPath(filePath);
      if (existingFile instanceof TFile) {
        await this.app.vault.modify(existingFile, markdown);
      } else {
        await this.app.vault.create(filePath, markdown);
      }
    } catch (err) {
      console.warn('[ChatController] Could not persist conversation to vault:', err);
    }
  }
}
