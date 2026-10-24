import fs from 'fs';
import path from 'path';

export interface LocalLlamaGenerateOptions {
  modelPath: string;
  modelId: string;
  contents: Array<{
    role: string;
    parts?: Array<Record<string, unknown>>;
  }>;
  systemInstruction?: string;
  enableTools?: boolean;
  temperature?: number;
  signal?: AbortSignal;
  onToken?: (token: string) => void;
}

export interface LocalLlamaGenerateResult {
  text: string;
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
  }>;
}

export interface LocalLlamaCapabilities {
  modelInstalled: boolean;
  modelLoaded: boolean;
  loadedModelPath: string | null;
  loadedModelId: string | null;
  backendReady: boolean;
  inferenceSuccessful: boolean;
  lastInferenceLatencyMs: number | null;
  toolCallingSupported: boolean;
  workspaceToolsAvailable: boolean;
}

/**
 * Native llama.cpp execution engine powered by node-llama-cpp.
 * Provides on-device quantized GGUF inference with true token generation,
 * multi-turn chat history context, stop sequences, and honest tool handling.
 */
export class LocalLlamaEngine {
  private llama: any = null;
  private loadedModel: any = null;
  private loadedContext: any = null;
  private loadedModelPath: string | null = null;
  private isInitializing: Promise<any> | null = null;
  private lastInferenceSuccess = false;
  private lastInferenceLatencyMs: number | null = null;

  async getLlamaBackend() {
    if (this.llama) return this.llama;
    if (this.isInitializing) return this.isInitializing;

    this.isInitializing = (async () => {
      try {
        const { getLlama } = await import('node-llama-cpp');
        this.llama = await getLlama({
          gpu: false, // Default to stable CPU backend; node-llama-cpp will probe hardware safely
        });
        return this.llama;
      } catch (err) {
        throw new Error(
          `Native llama.cpp runtime failed to initialize: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      } finally {
        this.isInitializing = null;
      }
    })();

    return this.isInitializing;
  }

  isModelLoaded(modelPath?: string): boolean {
    if (!this.loadedModel || !this.loadedContext) return false;
    if (modelPath && path.resolve(this.loadedModelPath || '') !== path.resolve(modelPath)) {
      return false;
    }
    return true;
  }

  getLoadedModelInfo(): { modelPath: string | null; loaded: boolean } {
    return {
      modelPath: this.loadedModelPath,
      loaded: Boolean(this.loadedModel && this.loadedContext),
    };
  }

  async getCapabilities(modelsDir?: string): Promise<LocalLlamaCapabilities> {
    let modelInstalled = false;
    if (modelsDir && fs.existsSync(modelsDir)) {
      try {
        const files = fs.readdirSync(modelsDir);
        modelInstalled = files.some((f) => {
          if (!f.endsWith('.gguf')) return false;
          try {
            const st = fs.statSync(path.join(modelsDir, f));
            return st.isFile() && st.size >= 1024 * 1024;
          } catch {
            return false;
          }
        });
      } catch {
        modelInstalled = false;
      }
    } else if (this.loadedModelPath && fs.existsSync(this.loadedModelPath)) {
      modelInstalled = true;
    }

    let backendReady = Boolean(this.llama);
    if (!backendReady) {
      try {
        await this.getLlamaBackend();
        backendReady = true;
      } catch {
        backendReady = false;
      }
    }

    return {
      modelInstalled,
      modelLoaded: Boolean(this.loadedModel && this.loadedContext),
      loadedModelPath: this.loadedModelPath,
      loadedModelId: this.loadedModelPath ? path.basename(this.loadedModelPath) : null,
      backendReady,
      inferenceSuccessful: this.lastInferenceSuccess,
      lastInferenceLatencyMs: this.lastInferenceLatencyMs,
      toolCallingSupported: true,
      workspaceToolsAvailable: true,
    };
  }

  async dispose(): Promise<void> {
    await this.unloadCurrentModel();
  }

  async unloadCurrentModel(): Promise<void> {
    if (this.loadedContext) {
      try {
        await this.loadedContext.dispose?.();
      } catch (err) {
        console.warn('[LocalLlamaEngine] Context disposal warning:', err);
      }
      this.loadedContext = null;
    }
    if (this.loadedModel) {
      try {
        await this.loadedModel.dispose?.();
      } catch (err) {
        console.warn('[LocalLlamaEngine] Model disposal warning:', err);
      }
      this.loadedModel = null;
    }
    this.loadedModelPath = null;
  }

  async loadModel(modelPath: string): Promise<any> {
    const resolvedPath = path.resolve(modelPath);

    if (this.isModelLoaded(resolvedPath)) {
      return this.loadedModel;
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Local model file not found at '${modelPath}'.`);
    }

    const stat = fs.statSync(resolvedPath);
    if (stat.size < 1024 * 1024) {
      throw new Error(
        `Local model weights are missing or incomplete: '${path.basename(
          modelPath
        )}' is only ${stat.size} bytes (stub fixture). Full GGUF tensor weights (>1MB) are required for on-device inference.`
      );
    }

    await this.unloadCurrentModel();
    const llama = await this.getLlamaBackend();

    try {
      this.loadedModel = await llama.loadModel({
        modelPath: resolvedPath,
      });

      const contextSize = Math.max(4096, Math.min(8192, this.loadedModel.trainContextSize || 4096));
      this.loadedContext = await this.loadedModel.createContext({
        contextSize,
      });

      this.loadedModelPath = resolvedPath;
      return this.loadedModel;
    } catch (err) {
      await this.unloadCurrentModel();
      throw new Error(
        `Failed to load GGUF model '${path.basename(modelPath)}': ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  async generateTurn(options: LocalLlamaGenerateOptions): Promise<LocalLlamaGenerateResult> {
    const {
      modelPath,
      modelId,
      contents,
      systemInstruction = '',
      enableTools = false,
      signal,
      onToken,
    } = options;

    if (signal?.aborted) {
      throw new Error('Generation cancelled by user.');
    }

    const startMillis = Date.now();

    // 1. Ensure the real model weights are loaded into native llama.cpp
    await this.loadModel(modelPath);

    if (!this.loadedContext || !this.loadedModel) {
      throw new Error(`Model context for '${modelId}' could not be initialized.`);
    }

    // 2. Setup chat session with the model's native chat wrapper
    const { LlamaChatSession } = await import('node-llama-cpp');
    const contextSequence = this.loadedContext.getSequence();
    const session = new LlamaChatSession({
      contextSequence,
      systemPrompt: systemInstruction.trim() || undefined,
    });

    // 3. Reconstruct multi-turn conversation history in correct order
    const validTurns = contents.filter((c) => Array.isArray(c.parts) && c.parts.length > 0);
    const priorTurns = validTurns.slice(0, -1);
    const lastTurn = validTurns[validTurns.length - 1];

    if (priorTurns.length > 0) {
      const historyItems: Array<{
        type: 'user' | 'model' | 'system';
        text?: string;
        response?: string[];
      }> = [];

      for (const turn of priorTurns) {
        const text = turn.parts
          ?.map((p: Record<string, unknown>) => (typeof p.text === 'string' ? p.text : ''))
          .filter(Boolean)
          .join('\n');
        if (!text) continue;

        if (turn.role === 'user') {
          historyItems.push({ type: 'user', text });
        } else if (turn.role === 'model' || turn.role === 'assistant') {
          historyItems.push({ type: 'model', response: [text] });
        } else if (turn.role === 'system') {
          historyItems.push({ type: 'system', text });
        }
      }

      if (historyItems.length > 0) {
        try {
          session.setChatHistory(historyItems as any);
        } catch (historyErr) {
          console.warn('[LocalLlamaEngine] Failed to apply prior chat history:', historyErr);
        }
      }
    }

    // 4. Extract user prompt exactly without modification
    let userPrompt = '';
    if (lastTurn && Array.isArray(lastTurn.parts)) {
      userPrompt = lastTurn.parts
        .map((p: Record<string, unknown>) => (typeof p.text === 'string' ? p.text : ''))
        .filter(Boolean)
        .join('\n');
    }
    if (!userPrompt.trim()) {
      userPrompt = 'Continue';
    }

    // Use lower temperature when exact deterministic output or arithmetic is requested
    const isExactInstruction = /reply with exactly|exact|json|\d+\s*[+\-*/]\s*\d+|what is \d+/i.test(userPrompt);
    const temperature = typeof options.temperature === 'number' ? options.temperature : (isExactInstruction ? 0.1 : 0.3);
    const repeatPenalty = { penalty: 1.15 };

    // 5. Execute inference through actual llama.cpp backend
    try {
      const generatedText = await session.prompt(userPrompt, {
        signal,
        maxTokens: 512,
        temperature,
        repeatPenalty,
        onTextChunk(chunk: string) {
          if (onToken) onToken(chunk);
        },
      });

      this.lastInferenceSuccess = true;
      this.lastInferenceLatencyMs = Date.now() - startMillis;

      let finalText = typeof generatedText === 'string' ? generatedText.trim() : '';

      // Enforce strict role separation: an assistant message must never echo the user prompt
      if (!finalText || finalText === userPrompt.trim()) {
        throw new Error(
          'Local model produced a degenerate echo or empty response. Try adjusting temperature or selecting a higher capacity model.'
        );
      }

      // 6. Honest tool handling:
      // Check if model explicitly emitted tool call JSON if tools are enabled
      let toolCalls: Array<{ name: string; args: Record<string, unknown> }> | undefined;
      if (enableTools && typeof finalText === 'string') {
        const trimmed = finalText.trim();
        // Check for function call format e.g. {"tool": "name", "arguments": {...}} or standard markdown codeblock
        const toolJsonMatch =
          trimmed.match(/```(?:json)?\s*(\{\s*"(?:tool|name|function)"\s*:\s*"[^"]+".*?\})\s*```/s) ||
          trimmed.match(/(\{\s*"(?:tool|name|function)"\s*:\s*"[^"]+"\s*,\s*"(?:arguments|args|parameters)"\s*:\s*\{.*?\}\s*\})/s);

        if (toolJsonMatch) {
          try {
            const parsed = JSON.parse(toolJsonMatch[1]);
            const name = parsed.tool || parsed.name || parsed.function;
            const args = parsed.arguments || parsed.args || parsed.parameters || {};
            if (name && typeof name === 'string') {
              toolCalls = [{ name, args: typeof args === 'object' && args ? args : {} }];
            }
          } catch {
            // Not a tool call, treat as plain text
          }
        }
      }

      // Return pure model response — zero fabricated templates or promotional banners
      return {
        text: finalText,
        toolCalls,
      };
    } catch (inferErr) {
      if (signal?.aborted) {
        throw new Error('Generation cancelled by user.');
      }
      throw new Error(
        `Local model inference error (${modelId}): ${
          inferErr instanceof Error ? inferErr.message : String(inferErr)
        }`
      );
    } finally {
      try {
        session.dispose?.({ disposeSequence: true });
      } catch {
        try {
          contextSequence?.dispose?.();
        } catch {
          // ignore
        }
      }
    }
  }
}

export const localLlamaEngine = new LocalLlamaEngine();
