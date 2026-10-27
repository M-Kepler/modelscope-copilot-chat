/**
 * Chat-completions-backed inline completion engine (issue #49).
 *
 * ModelScope exposes only /chat/completions (no FIM endpoint — probed 404 on
 * /completions), so fill-in-the-middle is emulated with FIM tokens inline in
 * the prompt. The engine is stateless and cancellation-aware: the provider
 * hands it a fresh AbortSignal on every keystroke, and an aborted request
 * never renders stale ghost text.
 */

import { COMPLETION_REQUEST_TIMEOUT_MS } from "../config";
import { buildModelScopeAuthHeaders } from "../modelScopeAuth";
import { buildCompletionPrompt } from "./prompt";
import type { CompletionContext, CompletionResult, CompletionEngine } from "./types";

const COMPLETION_PATH = "/v1/chat/completions";

export interface ChatCompletionsEngineOptions {
  /** ModelScope gateway base URL (e.g. https://api-inference.modelscope.cn). */
  baseUrl: string;
  /** Resolved API key for the vendor. */
  apiKey: string;
  /** Model id to query. */
  modelId: string;
  /** Unique engine id (used in diagnostics/log lines). */
  id: string;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
  /** Fetch implementation (injectable for tests). */
  fetch?: typeof globalThis.fetch;
}

/**
 * Engine that turns a completion context into a suggested insertion by calling
 * the ModelScope chat-completions endpoint with an inline FIM prompt.
 */
export class ChatCompletionsEngine implements CompletionEngine {
  readonly id: string;
  private readonly baseUrl: string;
  private apiKey: string;
  private readonly modelId: string;
  private readonly timeoutMs: number;
  private readonly fetch: typeof globalThis.fetch;

  constructor(options: ChatCompletionsEngineOptions) {
    this.id = options.id;
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.modelId = options.modelId;
    this.timeoutMs = options.timeoutMs ?? COMPLETION_REQUEST_TIMEOUT_MS;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  /** Updates the resolved API key (used for lazy secret-store resolution). */
  setApiKey(key: string): void {
    this.apiKey = key;
  }

  async complete(ctx: CompletionContext, signal: AbortSignal): Promise<CompletionResult> {
    const start = Date.now();
    const prompt = buildCompletionPrompt(ctx.prefix, ctx.suffix, this.modelId);

    const url = `${this.baseUrl.replace(/\/$/, "")}${COMPLETION_PATH}`;
    const headers = buildModelScopeAuthHeaders("chat-completions", this.apiKey);
    headers["Content-Type"] = "application/json";
    const body: Record<string, unknown> = {
      model: this.modelId,
      messages: prompt.messages,
      max_tokens: ctx.maxTokens,
      temperature: 0,
      stream: false,
    };
    // Qwen3 hybrid: enable_thinking=false is a genuine no-reasoning mode.
    Object.assign(body, prompt.extra);

    const controller = new AbortController();
    const onAbort = (): void => {
      controller.abort();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout((): void => {
      controller.abort();
    }, this.timeoutMs);
    try {
      const response = await this.fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        return { text: undefined, durationMs: Date.now() - start };
      }
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content;
      return { text: text && text.length > 0 ? text : undefined, durationMs: Date.now() - start };
    } catch {
      return { text: undefined, durationMs: Date.now() - start };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }
}
