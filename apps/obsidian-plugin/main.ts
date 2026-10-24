/**
 * Obsidian Duet Agent - Main Plugin Entry Point
 */

import { Plugin, WorkspaceLeaf } from 'obsidian';
import { DuetPluginSettings, DEFAULT_SETTINGS } from './src/types.js';
import { DuetChatView, DUET_CHAT_VIEW_TYPE } from './src/chat-view.js';
import { DuetSettingTab } from './src/settings.js';

export default class ObsidianDuetPlugin extends Plugin {
  settings: DuetPluginSettings = DEFAULT_SETTINGS;

  async onload() {
    console.log('[ObsidianDuetPlugin] Loading Obsidian Duet Agent plugin...');

    await this.loadSettings();

    // Register Chat View
    this.registerView(
      DUET_CHAT_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new DuetChatView(leaf, () => this.settings)
    );

    // Add Ribbon Icon to left sidebar
    this.addRibbonIcon('bot', 'Open Duet Agent Chat', () => {
      this.activateChatView();
    });

    // Add Command Palette Commands
    this.addCommand({
      id: 'open-duet-chat',
      name: 'Open Chat View',
      callback: () => {
        this.activateChatView();
      },
    });

    this.addCommand({
      id: 'ask-duet-active-note',
      name: 'Ask Duet About Active Note',
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (file) {
          if (!checking) {
            this.activateChatView();
          }
          return true;
        }
        return false;
      },
    });

    // Register Settings Tab
    this.addSettingTab(new DuetSettingTab(this.app, this));
  }

  async activateChatView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(DUET_CHAT_VIEW_TYPE);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({
          type: DUET_CHAT_VIEW_TYPE,
          active: true,
        });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  onunload() {
    console.log('[ObsidianDuetPlugin] Unloading Obsidian Duet Agent plugin.');
    this.app.workspace.detachLeavesOfType(DUET_CHAT_VIEW_TYPE);
  }
}
