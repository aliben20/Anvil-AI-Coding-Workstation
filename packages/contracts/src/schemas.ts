/**
 * Obsidian Duet Agent - Zod Runtime Schemas
 */

import { z } from 'zod';

export const SpecialistRoleSchema = z.enum([
  'coordinator',
  'researcher',
  'coder',
  'reviewer',
  'vault-assistant',
]);

export const ProviderTypeSchema = z.enum([
  'ollama',
  'openai',
  'anthropic',
  'compatible',
  'local-gguf',
]);

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  timestampMillis: z.number(),
  agentRole: SpecialistRoleSchema.optional(),
  toolCalls: z.array(z.any()).optional(),
  toolResult: z.any().optional(),
});

export const SendMessageRequestSchema = z.object({
  conversationId: z.string().min(1),
  content: z.string().min(1),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  stream: z.boolean().default(true),
  enableTools: z.boolean().default(true),
  activeNotePath: z.string().optional(),
  activeNoteContent: z.string().optional(),
});

export const ApprovalDecisionSchema = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().optional(),
});

export const CompanionPairingRequestSchema = z.object({
  pairingToken: z.string().min(16),
  clientName: z.string().default('Obsidian Plugin'),
});

export const RegisterProjectRootSchema = z.object({
  path: z.string().min(1),
  label: z.string().optional(),
});

export const TerminalCommandPayloadSchema = z.object({
  executable: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().min(1),
  timeoutMs: z.number().int().positive().max(300000).default(30000),
  dryRun: z.boolean().default(false),
});

export const BrowserActionPayloadSchema = z.object({
  action: z.enum(['navigate', 'scrape_text', 'capture_screenshot', 'fill_form']),
  url: z.string().url(),
  selector: z.string().optional(),
  formData: z.record(z.string(), z.string()).optional(),
});

export const PluginSettingsSchema = z.object({
  companionUrl: z.string().default('http://127.0.0.1:3842'),
  companionToken: z.string().default(''),
  defaultProviderId: z.string().default('ollama'),
  defaultModelId: z.string().default('llama3.2'),
  requireApprovalForVaultEdits: z.boolean().default(true),
  requireApprovalForExternalWrites: z.boolean().default(true),
  requireApprovalForTerminal: z.boolean().default(true),
  requireApprovalForBrowserActions: z.boolean().default(true),
  approvedProjectRoots: z.array(z.string()).default([]),
  allowedTerminalExecutables: z.array(z.string()).default(['git', 'npm', 'node', 'python', 'cargo', 'bun']),
  allowedBrowserDomains: z.array(z.string()).default(['github.com', 'obsidian.md', 'docs.anthropic.com', 'platform.openai.com']),
  maxAgentRecursionDepth: z.number().int().min(1).max(5).default(2),
  maxConcurrentSpecialists: z.number().int().min(1).max(8).default(3),
  taskTimeoutMs: z.number().int().min(5000).max(600000).default(60000),
});

export type PluginSettings = z.infer<typeof PluginSettingsSchema>;
