/**
 * Obsidian Duet Agent - Specialist Task View Component
 */

import { TaskRecord, SpecialistRole } from '../../../packages/contracts/src/types.js';

export class TaskViewComponent {
  private containerEl: HTMLElement;
  private tasks: Map<string, TaskRecord> = new Map();

  constructor(containerEl: HTMLElement) {
    this.containerEl = containerEl;
  }

  public updateTask(task: TaskRecord): void {
    this.tasks.set(task.id, task);
    this.render();
  }

  public clearTasks(): void {
    this.tasks.clear();
    this.render();
  }

  public render(): void {
    this.containerEl.empty();
    if (this.tasks.size === 0) return;

    const wrapper = this.containerEl.createEl('div', { cls: 'duet-tasks-panel' });
    wrapper.createEl('div', { text: 'Active Agent Tasks', cls: 'duet-tasks-panel-title' });

    for (const task of this.tasks.values()) {
      const row = wrapper.createEl('div', { cls: `duet-task-row duet-task-${task.status}` });
      const info = row.createEl('div', { cls: 'duet-task-info' });

      const roleBadge = info.createEl('span', {
        text: this.formatRole(task.agentRole),
        cls: `duet-badge duet-badge-${task.agentRole}`,
      });
      const title = info.createEl('span', { text: task.title, cls: 'duet-task-title' });

      const statusBadge = row.createEl('span', {
        text: task.status.replace(/_/g, ' '),
        cls: `duet-badge duet-status-${task.status}`,
      });

      if (task.error) {
        row.createEl('div', { text: `Error: ${task.error}`, cls: 'duet-task-error' });
      }
    }
  }

  private formatRole(role: SpecialistRole): string {
    switch (role) {
      case 'coordinator': return 'Coordinator';
      case 'researcher': return 'Researcher';
      case 'coder': return 'Coder';
      case 'reviewer': return 'Reviewer';
      case 'vault-assistant': return 'Vault Assistant';
      default: return role;
    }
  }
}
