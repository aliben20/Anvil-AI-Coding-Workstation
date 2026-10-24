/**
 * Obsidian Duet Agent - Approval & Diff Review Modal
 */

import { App, Modal, Setting } from 'obsidian';
import { ApprovalRequest } from '../../../packages/contracts/src/types.js';

export class ApprovalModal extends Modal {
  private request: ApprovalRequest;
  private resolveDecision?: (decision: boolean) => void;

  constructor(app: App, request: ApprovalRequest) {
    super(app);
    this.request = request;
  }

  public async waitForDecision(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.resolveDecision = resolve;
      this.open();
    });
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('duet-approval-modal');

    contentEl.createEl('h2', {
      text: `Approval Required: ${this.request.title}`,
      cls: 'duet-approval-title',
    });

    contentEl.createEl('p', {
      text: this.request.description,
      cls: 'duet-approval-desc',
    });

    if (this.request.diffProposal) {
      const diffEl = contentEl.createEl('div', { cls: 'duet-diff-preview' });
      const lines = this.request.diffProposal.unifiedDiff.split('\n');
      for (const line of lines) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          diffEl.createEl('span', { text: line, cls: 'duet-diff-add' });
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          diffEl.createEl('span', { text: line, cls: 'duet-diff-del' });
        } else {
          diffEl.createEl('span', { text: line });
        }
      }
    } else if (this.request.commandDetails) {
      const cmdBox = contentEl.createEl('pre', { cls: 'duet-cmd-box' });
      cmdBox.createEl('code', {
        text: `$ ${this.request.commandDetails.executable} ${this.request.commandDetails.args.join(' ')}\n(Working Directory: ${this.request.commandDetails.cwd})`,
      });
    }

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText('Reject')
          .setWarning()
          .onClick(() => {
            this.resolveDecision?.(false);
            this.close();
          })
      )
      .addButton((btn) =>
        btn
          .setButtonText('Approve & Apply')
          .setCta()
          .onClick(() => {
            this.resolveDecision?.(true);
            this.close();
          })
      );
  }

  onClose() {
    this.contentEl.empty();
    if (this.resolveDecision) {
      this.resolveDecision(false);
    }
  }
}
