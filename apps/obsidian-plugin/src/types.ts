/**
 * Obsidian Duet Agent - Plugin Local Types & Settings
 */

import { SpecialistRole, TaskStatus, ToolCallRecord, FileDiffProposal, ApprovalRequest } from '../../../packages/contracts/src/types.js';

export interface DuetPluginSettings {
  companionUrl: string;
  companionToken: string;
  defaultProviderId: string;
  defaultModelId: string;
  autoConnectCompanion: boolean;
  activeSpecialistRole: SpecialistRole;
  requireApprovalForVaultEdits: boolean;
  requireApprovalForExternalWrites: boolean;
  requireApprovalForTerminal: boolean;
  requireApprovalForBrowserActions: boolean;
  approvedProjectRoots: string[];
  conversationsFolder: string;
}

export const DEFAULT_SETTINGS: DuetPluginSettings = {
  companionUrl: 'http://127.0.0.1:3842',
  companionToken: '',
  defaultProviderId: 'ollama',
  defaultModelId: 'llama3.2',
  autoConnectCompanion: true,
  activeSpecialistRole: 'coordinator',
  requireApprovalForVaultEdits: true,
  requireApprovalForExternalWrites: true,
  requireApprovalForTerminal: true,
  requireApprovalForBrowserActions: true,
  approvedProjectRoots: [],
  conversationsFolder: 'Duet Chats',
};

export interface PluginChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestampMillis: number;
  agentRole?: SpecialistRole;
  toolCalls?: ToolCallRecord[];
  isStreaming?: boolean;
}

export interface PluginConversation {
  id: string;
  title: string;
  providerId: string;
  modelId: string;
  messages: PluginChatMessage[];
  createdAtMillis: number;
  updatedAtMillis: number;
}
