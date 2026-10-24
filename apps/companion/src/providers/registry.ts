/**
 * Obsidian Duet Agent - Provider Registry
 */

import fs from 'fs';
import path from 'path';
import { ModelProvider, ModelMetadata, GenerateRequest, GenerateResponse, ProviderType } from '../../../../packages/contracts/src/types.js';
import { OllamaProvider } from './ollama.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { CompatibleProvider } from './compatible.js';
import { LocalLlamaEngine } from '../../../../src/server/localLlamaEngine.js';

export class LocalGgufProvider implements ModelProvider {
  public id = 'local-gguf';
  public name = 'Local GGUF (node-llama-cpp)';
  public type: ProviderType = 'local-gguf';
  public baseUrl = 'local://node-llama-cpp';
  public defaultModelId = 'smollm2';
  private engine: LocalLlamaEngine;
  private defaultModelPath: string;

  constructor() {
    this.engine = new LocalLlamaEngine();
    this.defaultModelPath = path.resolve('.anvil-data/local-models/smollm2-135m-instruct-q4_k_m.gguf');
  }

  public async listModels(): Promise<ModelMetadata[]> {
    return [
      { id: 'smollm2', name: 'SmolLM2 135M Instruct (GGUF)', supportsStreaming: true, supportsTools: true, isLocal: true },
    ];
  }

  public async generate(request: GenerateRequest): Promise<GenerateResponse> {
    let accumulated = '';
    const res = await this.generateStream(request, (chunk) => {
      accumulated += chunk;
    }, request.signal);
    return {
      text: accumulated || res.text,
    };
  }

  public async generateStream(
    request: GenerateRequest,
    onToken: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<GenerateResponse> {
    if (!fs.existsSync(this.defaultModelPath)) {
      throw new Error(`Local GGUF model file not found at '${this.defaultModelPath}'. Download or place a model before chatting.`);
    }

    const contents = request.messages.map((m) => ({
      role: m.role,
      parts: [{ text: m.content }],
    }));

    const result = await this.engine.generateTurn({
      modelPath: this.defaultModelPath,
      modelId: request.modelId || 'smollm2',
      contents,
      systemInstruction: request.systemInstruction || 'You are Obsidian Duet Agent. Provide helpful, accurate, and concise technical responses.',
      enableTools: false,
      signal,
      onToken,
    });

    return {
      text: result.text,
    };
  }
}

export class ProviderRegistry {
  private providers: Map<string, ModelProvider> = new Map();

  constructor() {
    this.register(new OllamaProvider());
    this.register(new OpenAIProvider());
    this.register(new AnthropicProvider());
    this.register(new CompatibleProvider());
    this.register(new LocalGgufProvider());
  }

  public register(provider: ModelProvider): void {
    this.providers.set(provider.id, provider);
  }

  public getProvider(id: string): ModelProvider {
    const p = this.providers.get(id);
    if (!p) {
      throw new Error(`Unknown model provider: '${id}'. Available providers: ${Array.from(this.providers.keys()).join(', ')}`);
    }
    return p;
  }

  public listProviders(): Array<{ id: string; name: string; type: ProviderType; isLocal: boolean }> {
    return Array.from(this.providers.values()).map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      isLocal: p.type === 'ollama' || p.type === 'local-gguf',
    }));
  }
}
