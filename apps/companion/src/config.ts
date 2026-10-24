/**
 * Obsidian Duet Agent - Companion Configuration
 */

import dotenv from 'dotenv';
dotenv.config();

export interface CompanionConfig {
  host: string;
  port: number;
  dataDir: string;
  version: string;
  ollamaBaseUrl: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
}

export const companionConfig: CompanionConfig = {
  host: process.env.COMPANION_HOST || '127.0.0.1',
  port: parseInt(process.env.COMPANION_PORT || '3842', 10),
  dataDir: process.env.COMPANION_DATA_DIR || '.obsidian-duet',
  version: '1.0.0',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  openaiApiKey: process.env.OPENAI_API_KEY,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
};
