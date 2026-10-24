/**
 * Obsidian Duet Agent - Companion Client (HTTP & SSE Protocol)
 */

import { AgentEvent, SendMessageRequestSchema } from '../../../packages/contracts/src/index.js';
import { DuetPluginSettings } from './types.js';

export interface CompanionHealth {
  status: 'ok' | 'error';
  paired: boolean;
  version: string;
  uptimeSeconds: number;
  availableProviders: string[];
}

export class CompanionClient {
  private getSettings: () => DuetPluginSettings;
  private activeAbortControllers: Map<string, AbortController> = new Map();

  constructor(getSettings: () => DuetPluginSettings) {
    this.getSettings = getSettings;
  }

  private getBaseUrl(): string {
    return this.getSettings().companionUrl.replace(/\/+$/, '');
  }

  private getAuthHeaders(): Record<string, string> {
    const token = this.getSettings().companionToken;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  public async checkHealth(): Promise<CompanionHealth> {
    const url = `${this.getBaseUrl()}/api/health`;
    const res = await fetch(url, {
      method: 'GET',
      headers: this.getAuthHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Companion health check failed with HTTP ${res.status}: ${res.statusText}`);
    }
    return res.json();
  }

  public async pair(pairingToken: string): Promise<{ success: boolean; token: string }> {
    const url = `${this.getBaseUrl()}/api/pair`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingToken, clientName: 'Obsidian Desktop Plugin' }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`Pairing failed: ${err.error || res.statusText}`);
    }
    return res.json();
  }

  public async streamChat(
    payload: {
      conversationId: string;
      content: string;
      providerId?: string;
      modelId?: string;
      activeNotePath?: string;
      activeNoteContent?: string;
    },
    onEvent: (event: AgentEvent) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const url = `${this.getBaseUrl()}/api/chat/stream`;
    const abortController = new AbortController();
    this.activeAbortControllers.set(payload.conversationId, abortController);

    if (signal) {
      signal.addEventListener('abort', () => abortController.abort());
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          ...this.getAuthHeaders(),
          Accept: 'application/x-ndjson',
        },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => res.statusText);
        throw new Error(`Companion request failed (${res.status}): ${errorText}`);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error('Response body stream is not readable.');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const event = JSON.parse(trimmed) as AgentEvent;
            onEvent(event);
          } catch (err) {
            console.warn('[CompanionClient] Malformed event stream line:', trimmed, err);
          }
        }
      }

      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim()) as AgentEvent;
          onEvent(event);
        } catch {}
      }
    } finally {
      this.activeAbortControllers.delete(payload.conversationId);
    }
  }

  public cancel(conversationId: string): void {
    const controller = this.activeAbortControllers.get(conversationId);
    if (controller) {
      controller.abort();
      this.activeAbortControllers.delete(conversationId);
    }
    // Also notify companion backend to abort active task
    fetch(`${this.getBaseUrl()}/api/chat/cancel`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ conversationId }),
    }).catch(() => {});
  }

  public async decideApproval(approvalId: string, decision: 'approved' | 'rejected', reason?: string): Promise<void> {
    const url = `${this.getBaseUrl()}/api/approvals/decide`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ approvalId, decision, reason }),
    });
    if (!res.ok) {
      throw new Error(`Failed to submit approval decision: HTTP ${res.status}`);
    }
  }
}
