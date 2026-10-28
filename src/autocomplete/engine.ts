/**
 * Chat-completions-backed inline completion engine (issue #49).
 *
 * ModelScope exposes only /chat/completions (no FIM endpoint — probed 404 on
 * /completions), so fill-in-the-middle is emulated with FIM tokens inline in
 * the prompt. The engine is stateless and cancellation-aware: the provider
 * hands it a fresh AbortSignal on every keystroke, and an aborted request
 * never renders stale ghost text.
 *
 * Every outcome carries a `status` and/or `error` so the caller can log why a
 * completion did not appear (these failures used to be silent — issue #117).
 */

import { COMPLETION_REQUEST_TIMEOUT_MS } from "../config";
import { buildModelScopeAuthHeaders } from "../modelScopeAuth";
import { getErrorMessage } from "../utils";
import { buildCompletionPrompt } from "./prompt";
import type { CompletionContext, CompletionResult, CompletionEngine } from "./types";

export interface ChatCompletionsEngineOptions {
  /** Full chat-completions endpoint, e.g. `https://api-inference.modelscope.cn/v1/chat/completions`. */
  url: string;
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
  private readonly url: string;
  private readonly apiKey: string;
  private readonly modelId: string;
  private readonly timeoutMs: number;
  private readonly fetch: typeof globalThis.fetch;

  constructor(options: ChatCompletionsEngineOptions) {
    this.id = options.id;
    this.url = options.url;
    this.apiKey = options.apiKey;
    this.modelId = options.modelId;
    this.timeoutMs = options.timeoutMs ?? COMPLETION_REQUEST_TIMEOUT_MS;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async complete(ctx: CompletionContext, signal: AbortSignal): Promise<CompletionResult> {
    const start = Date.now();
    if (signal.aborted) {
      return { text: undefined, durationMs: 0, error: "cancelled" };
    }

    const prompt = buildCompletionPrompt(ctx.prefix, ctx.suffix, this.modelId);
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
    // Distinguishes our own timeout from a superseded/cancelled request so the
    // failure log says which one happened.
    let abortReason: "timeout" | "cancelled" | undefined;
    const onAbort = (): void => {
      abortReason ??= "cancelled";
      controller.abort();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout((): void => {
      abortReason ??= "timeout";
      controller.abort();
    }, this.timeoutMs);
    try {
      const response = await this.fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        return {
          text: undefined,
          durationMs: Date.now() - start,
          status: response.status,
          error: `HTTP ${String(response.status)} ${response.statusText}`.trim(),
        };
      }
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content;
      return {
        text: text && text.length > 0 ? text : undefined,
        durationMs: Date.now() - start,
        status: response.status,
      };
    } catch (error) {
      return { text: undefined, durationMs: Date.now() - start, error: abortReason ?? getErrorMessage(error) };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }
}
