/**
 * Obsidian Duet Agent - OpenAI Provider Adapter
 */

import { ModelProvider, ModelMetadata, GenerateRequest, GenerateResponse, ProviderType } from '../../../../packages/contracts/src/types.js';

export class OpenAIProvider implements ModelProvider {
  public id = 'openai';
  public name = 'OpenAI';
  public type: ProviderType = 'openai';
  public baseUrl: string;
  public apiKey?: string;
  public defaultModelId: string;

  constructor(apiKey?: string, baseUrl = 'https://api.openai.com/v1', defaultModelId = 'gpt-4o') {
    this.apiKey = apiKey || process.env.OPENAI_API_KEY;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.defaultModelId = defaultModelId;
  }

  public async listModels(): Promise<ModelMetadata[]> {
    return [
      { id: 'gpt-4o', name: 'GPT-4o (Omni)', supportsStreaming: true, supportsTools: true, isLocal: false },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', supportsStreaming: true, supportsTools: true, isLocal: false },
      { id: 'o3-mini', name: 'o3 Mini', supportsStreaming: true, supportsTools: false, isLocal: false },
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
    const key = this.apiKey || process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error('Authentication Required: OpenAI API key is missing. Add your key in Companion Settings or OPENAI_API_KEY environment variable.');
    }

    const messages = request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    if (request.systemInstruction) {
      messages.unshift({ role: 'system', content: request.systemInstruction });
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
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
      throw new Error(`OpenAI API error (HTTP ${res.status}): ${errText}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('OpenAI stream is unreadable.');
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
