/**
 * Obsidian Duet Agent - Custom Compatible Endpoint Provider Adapter
 * Enforces URL boundary checks, blocking cloud metadata endpoints and internal administrative services.
 */

import { ModelProvider, ModelMetadata, GenerateRequest, GenerateResponse, ProviderType } from '../../../../packages/contracts/src/types.js';

export class CompatibleProvider implements ModelProvider {
  public id = 'compatible';
  public name = 'Custom Compatible Endpoint';
  public type: ProviderType = 'compatible';
  public baseUrl: string;
  public apiKey?: string;
  public defaultModelId: string;

  constructor(baseUrl = 'http://127.0.0.1:8000/v1', defaultModelId = 'custom-model', apiKey?: string) {
    this.validateBaseUrl(baseUrl);
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.defaultModelId = defaultModelId;
    this.apiKey = apiKey;
  }

  public validateBaseUrl(urlStr: string): void {
    let parsed: URL;
    try {
      parsed = new URL(urlStr);
    } catch {
      throw new Error(`Invalid provider URL: '${urlStr}'`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Invalid provider URL protocol: '${parsed.protocol}'. Only http and https are permitted.`);
    }

    const host = parsed.hostname.toLowerCase();

    // Block cloud metadata services
    if (
      host === '169.254.169.254' ||
      host === 'metadata.google.internal' ||
      host === 'instance-data' ||
      host.endsWith('.internal')
    ) {
      throw new Error(`Security Exception: Access to internal cloud metadata endpoints (${host}) is blocked.`);
    }
  }

  public async listModels(): Promise<ModelMetadata[]> {
    return [
      { id: this.defaultModelId, name: this.defaultModelId, supportsStreaming: true, supportsTools: true, isLocal: false },
    ];
  }

  public async generate(request: GenerateRequest): Promise<GenerateResponse> {
    let accumulated = '';
    const res = await this.generateStream(request, (chunk) => {
      accumulated += chunk;
    }, request.signal);
    return {
      text: accumulated || res.text,
      usage: res.usage,
    };
  }

  public async generateStream(
    request: GenerateRequest,
    onToken: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<GenerateResponse> {
    const messages = request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    if (request.systemInstruction) {
      messages.unshift({ role: 'system', content: request.systemInstruction });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: request.modelId || this.defaultModelId,
        messages,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 1024,
        stream: true,
      }),
      signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Compatible API error (HTTP ${res.status}): ${errText}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('Stream is unreadable.');
    }

    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const dataPart = trimmed.slice(5).trim();
        if (dataPart === '[DONE]') break;
        try {
          const parsed = JSON.parse(dataPart);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            onToken(delta);
          }
        } catch {}
      }
    }

    return { text: fullText };
  }
}
