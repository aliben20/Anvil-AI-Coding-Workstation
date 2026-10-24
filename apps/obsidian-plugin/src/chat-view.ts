/**
 * Obsidian Duet Agent - Chat View (Sidebar ItemView)
 */

import { ItemView, WorkspaceLeaf, MarkdownRenderer } from 'obsidian';
import { DuetPluginSettings, PluginChatMessage, PluginConversation } from './types.js';
import { ChatController } from './chat-controller.js';
import { TaskViewComponent } from './task-view.js';
import { AgentEvent, SpecialistRole } from '../../../packages/contracts/src/index.js';

export const DUET_CHAT_VIEW_TYPE = 'duet-agent-chat-view';

export class DuetChatView extends ItemView {
  private getSettings: () => DuetPluginSettings;
  private controller: ChatController;
  private taskView!: TaskViewComponent;

  // DOM Elements
  private statusBadge!: HTMLElement;
  private messagesContainer!: HTMLElement;
  private composerTextarea!: HTMLTextAreaElement;
  private sendStopBtn!: HTMLButtonElement;
  private activeNotePill!: HTMLElement;
  private providerSelect!: HTMLSelectElement;
  private roleSelect!: HTMLSelectElement;

  private isGenerating = false;

  constructor(leaf: WorkspaceLeaf, getSettings: () => DuetPluginSettings) {
    super(leaf);
    this.getSettings = getSettings;
    this.controller = new ChatController(
      this.app,
      getSettings,
      (conv, generating) => this.onConversationUpdated(conv, generating),
      (event) => this.onActivityEvent(event)
    );
  }

  public getViewType(): string {
    return DUET_CHAT_VIEW_TYPE;
  }

  public getDisplayText(): string {
    return 'Duet Agent';
  }

  public getIcon(): string {
    return 'bot';
  }

  async onOpen() {
    const root = this.containerEl.children[1] as HTMLElement;
    root.empty();
    root.addClass('duet-chat-container');

    // 1. Header
    const header = root.createEl('div', { cls: 'duet-header' });
    const titleArea = header.createEl('div', { cls: 'duet-header-title' });
    titleArea.createEl('span', { text: 'Duet Agent' });
    this.statusBadge = titleArea.createEl('span', { text: 'Checking…', cls: 'duet-badge disconnected' });

    const actions = header.createEl('div', { cls: 'duet-header-actions' });
    const newChatBtn = actions.createEl('button', { text: 'New Chat', cls: 'mod-muted' });
    newChatBtn.addEventListener('click', () => {
      this.controller.newConversation();
      this.taskView.clearTasks();
    });

    // 2. Selectors (Role & Provider)
    const selectors = root.createEl('div', { cls: 'duet-selectors' });
    this.roleSelect = selectors.createEl('select', { cls: 'duet-dropdown' });
    const roles: Array<{ id: SpecialistRole; name: string }> = [
      { id: 'coordinator', name: 'Coordinator' },
      { id: 'researcher', name: 'Researcher' },
      { id: 'coder', name: 'Coder' },
      { id: 'reviewer', name: 'Reviewer' },
      { id: 'vault-assistant', name: 'Vault Assistant' },
    ];
    for (const r of roles) {
      const opt = this.roleSelect.createEl('option', { value: r.id, text: r.name });
      if (r.id === this.getSettings().activeSpecialistRole) {
        opt.selected = true;
      }
    }
    this.roleSelect.addEventListener('change', () => {
      this.getSettings().activeSpecialistRole = this.roleSelect.value as SpecialistRole;
    });

    this.providerSelect = selectors.createEl('select', { cls: 'duet-dropdown' });
    const providerOptions = [
      { id: 'ollama:llama3.2', text: 'Ollama · llama3.2' },
      { id: 'ollama:qwen2.5', text: 'Ollama · qwen2.5' },
      { id: 'local-gguf:smollm2', text: 'Local GGUF · SmolLM2' },
      { id: 'anthropic:claude-3-5-sonnet', text: 'Anthropic · Claude 3.5' },
      { id: 'openai:gpt-4o', text: 'OpenAI · GPT-4o' },
      { id: 'compatible:custom', text: 'Custom Endpoint' },
    ];
    for (const p of providerOptions) {
      const opt = this.providerSelect.createEl('option', { value: p.id, text: p.text });
      if (p.id.startsWith(this.getSettings().defaultProviderId)) {
        opt.selected = true;
      }
    }
    this.providerSelect.addEventListener('change', () => {
      const [pId, mId] = this.providerSelect.value.split(':');
      this.controller.setProviderAndModel(pId, mId || 'default');
    });

    // 3. Task Panel
    const taskContainer = root.createEl('div');
    this.taskView = new TaskViewComponent(taskContainer);

    // 4. Messages Area
    this.messagesContainer = root.createEl('div', { cls: 'duet-messages-area' });

    // 5. Composer Area
    const composer = root.createEl('div', { cls: 'duet-composer-area' });

    this.activeNotePill = composer.createEl('div', { cls: 'duet-context-pill' });
    this.updateActiveNotePill();

    const textRow = composer.createEl('div', { cls: 'duet-textarea-row' });
    this.composerTextarea = textRow.createEl('textarea', {
      cls: 'duet-composer-textarea',
      placeholder: 'Message Duet Agent… (Enter to send, Shift+Enter for newline)',
    });
    this.composerTextarea.rows = 2;

    this.sendStopBtn = textRow.createEl('button', { text: 'Send', cls: 'duet-btn-send' });

    this.composerTextarea.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.submitMessage();
      }
    });

    this.sendStopBtn.addEventListener('click', () => {
      if (this.isGenerating) {
        this.controller.stopGeneration();
      } else {
        this.submitMessage();
      }
    });

    // Listen to workspace active leaf changes to update note pill
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this.updateActiveNotePill();
      })
    );

    // Check companion connectivity
    this.checkCompanionStatus();

    // Initial render
    this.onConversationUpdated(this.controller.getConversation(), false);
  }

  private async updateActiveNotePill(): Promise<void> {
    const active = await this.controller.getVaultTools().readActiveNote();
    if (active && this.activeNotePill) {
      this.activeNotePill.style.display = 'inline-flex';
      this.activeNotePill.setText(`📄 Context: ${active.path}`);
    } else if (this.activeNotePill) {
      this.activeNotePill.style.display = 'none';
    }
  }

  private async checkCompanionStatus(): Promise<void> {
    try {
      const health = await this.controller.getCompanionClient().checkHealth();
      if (health.status === 'ok') {
        this.statusBadge.setText('Companion Connected');
        this.statusBadge.className = 'duet-badge connected';
      } else {
        this.statusBadge.setText('Companion Error');
        this.statusBadge.className = 'duet-badge disconnected';
      }
    } catch {
      this.statusBadge.setText('Companion Offline (Local Mode)');
      this.statusBadge.className = 'duet-badge disconnected';
    }
  }

  private submitMessage(): void {
    const val = this.composerTextarea.value.trim();
    if (!val || this.isGenerating) return;
    this.composerTextarea.value = '';
    this.controller.sendMessage(val);
  }

  private onConversationUpdated(conv: PluginConversation, isGenerating: boolean): void {
    this.isGenerating = isGenerating;
    if (this.sendStopBtn) {
      if (isGenerating) {
        this.sendStopBtn.setText('Stop');
        this.sendStopBtn.className = 'duet-btn-stop';
      } else {
        this.sendStopBtn.setText('Send');
        this.sendStopBtn.className = 'duet-btn-send';
      }
    }

    if (!this.messagesContainer) return;
    this.messagesContainer.empty();

    for (const msg of conv.messages) {
      this.renderMessage(msg);
    }

    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  private renderMessage(msg: PluginChatMessage): void {
    const card = this.messagesContainer.createEl('div', { cls: `duet-message ${msg.role}` });

    if (msg.role === 'assistant') {
      const header = card.createEl('div', { cls: 'duet-message-header' });
      header.createEl('span', {
        text: msg.agentRole ? msg.agentRole.toUpperCase() : 'DUET',
        cls: 'duet-agent-role',
      });
      header.createEl('span', {
        text: new Date(msg.timestampMillis).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    }

    // Render tool calls if any
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tc of msg.toolCalls) {
        const toolEl = card.createEl('div', { cls: 'duet-tool-card' });
        const tHeader = toolEl.createEl('div', { cls: 'duet-tool-header' });
        tHeader.createEl('span', { text: `⚙ ${tc.toolName}`, cls: 'duet-tool-name' });
        tHeader.createEl('span', { text: tc.status, cls: 'duet-badge' });

        const tBody = toolEl.createEl('div', { cls: 'duet-tool-body' });
        tBody.setText(JSON.stringify(tc.args, null, 2));
      }
    }

    const contentEl = card.createEl('div', { cls: 'duet-message-content' });
    if (msg.content) {
      MarkdownRenderer.render(this.app, msg.content, contentEl, '', this);
    }

    // If streaming and waiting for tokens
    if (msg.isStreaming && !msg.content) {
      const pulse = card.createEl('div', { cls: 'duet-activity-pulse' });
      pulse.createEl('div', { cls: 'duet-dot' });
      pulse.createEl('div', { cls: 'duet-dot' });
      pulse.createEl('div', { cls: 'duet-dot' });
      pulse.createEl('span', { text: 'Thinking…' });
    }
  }

  private onActivityEvent(event: AgentEvent): void {
    if (event.topic === 'task.created' || event.topic === 'task.started' || event.topic === 'task.completed' || event.topic === 'task.failed') {
      if ('task' in event.payload) {
        this.taskView.updateTask(event.payload.task);
      }
    }
  }

  async onClose() {
    // Cleanup
    this.controller.stopGeneration();
  }
}
