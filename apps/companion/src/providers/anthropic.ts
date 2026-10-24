/**
 * Obsidian Duet Agent - Anthropic Provider Adapter
 */

import { ModelProvider, ModelMetadata, GenerateRequest, GenerateResponse, ProviderType } from '../../../../packages/contracts/src/types.js';

export class AnthropicProvider implements ModelProvider {
  public id = 'anthropic';
  public name = 'Anthropic Claude';
  public type: ProviderType = 'anthropic';
  public baseUrl: string;
  public apiKey?: string;
  public defaultModelId: string;

  constructor(apiKey?: string, baseUrl = 'https://api.anthropic.com/v1', defaultModelId = 'claude-3-5-sonnet-20241022') {
    this.apiKey = apiKey || process.env.ANTHROPIC_API_KEY;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.defaultModelId = defaultModelId;
  }

  public async listModels(): Promise<ModelMetadata[]> {
    return [
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', supportsStreaming: true, supportsTools: true, isLocal: false },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', supportsStreaming: true, supportsTools: true, isLocal: false },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', supportsStreaming: true, supportsTools: true, isLocal: false },
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
    const key = this.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error('Authentication Required: Anthropic API key is missing. Add your key in Companion Settings or ANTHROPIC_API_KEY environment variable.');
    }

    const messages = request.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));

    const bodyPayload: Record<string, unknown> = {
      model: request.modelId || this.defaultModelId,
      messages,
      max_tokens: request.maxTokens ?? 1024,
      stream: true,
      temperature: request.temperature ?? 0.2,
    };

    if (request.systemInstruction) {
      bodyPayload.system = request.systemInstruction;
    }

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(bodyPayload),
      signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText);
      throw new Error(`Anthropic API error (HTTP ${res.status}): ${errText}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('Anthropic stream is unreadable.');
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
        const dataStr = trimmed.slice(5).trim();
        try {
          const evt = JSON.parse(dataStr);
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            const token = evt.delta.text || '';
            fullText += token;
            onToken(token);
          }
        } catch {}
      }
    }

    return { text: fullText };
  }
}
