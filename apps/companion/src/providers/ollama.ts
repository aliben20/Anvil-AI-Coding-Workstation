/**
 * Obsidian Duet Agent - Ollama Provider Adapter
 * Pure HTTP implementation against Ollama API (http://127.0.0.1:11434).
 * Requires zero cloud credentials.
 */

import { ModelProvider, ModelMetadata, GenerateRequest, GenerateResponse, ProviderType } from '../../../../packages/contracts/src/types.js';

export class OllamaProvider implements ModelProvider {
  public id = 'ollama';
  public name = 'Ollama (Local Inference)';
  public type: ProviderType = 'ollama';
  public baseUrl: string;
  public defaultModelId: string;

  constructor(baseUrl = 'http://127.0.0.1:11434', defaultModelId = 'llama3.2') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.defaultModelId = defaultModelId;
  }

  public async listModels(): Promise<ModelMetadata[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { method: 'GET' });
      if (!res.ok) return this.fallbackModels();
      const data = await res.json() as { models?: Array<{ name: string; details?: { parameter_size?: string } }> };
      if (!Array.isArray(data.models) || data.models.length === 0) {
        return this.fallbackModels();
      }
      return data.models.map((m) => ({
        id: m.name,
        name: m.name,
        supportsStreaming: true,
        supportsTools: true,
        isLocal: true,
      }));
    } catch {
      return this.fallbackModels();
    }
  }

  private fallbackModels(): ModelMetadata[] {
    return [
      { id: 'llama3.2', name: 'Llama 3.2 (Local)', supportsStreaming: true, supportsTools: true, isLocal: true },
      { id: 'qwen2.5-coder', name: 'Qwen 2.5 Coder (Local)', supportsStreaming: true, supportsTools: true, isLocal: true },
      { id: 'mistral', name: 'Mistral (Local)', supportsStreaming: true, supportsTools: true, isLocal: true },
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
    const model = request.modelId || this.defaultModelId;
    const messages = request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    if (request.systemInstruction) {
      messages.unshift({ role: 'system', content: request.systemInstruction });
    }

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        options: {
          temperature: request.temperature ?? 0.2,
          num_predict: request.maxTokens ?? 1024,
        },
      }),
      signal,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => res.statusText);
      throw new Error(`Ollama API error (HTTP ${res.status}): ${errorText}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('Ollama response stream is not readable.');
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
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as {
            message?: { content?: string };
            done?: boolean;
          };
          const delta = parsed.message?.content || '';
          if (delta) {
            fullText += delta;
            onToken(delta);
          }
        } catch {}
      }
    }

    return {
      text: fullText,
    };
  }
}
