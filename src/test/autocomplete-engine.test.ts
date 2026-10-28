import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ChatCompletionsEngine } from "../autocomplete/engine.js";
import type { CompletionContext } from "../autocomplete/types.js";

const ENDPOINT = "https://api-inference.example.test/v1/chat/completions";
const CTX: CompletionContext = { prefix: "const value = ", suffix: "\n", maxTokens: 77, modelId: "Qwen/Qwen3.5-27B" };

function jsonResponse(body: unknown, status = 200, statusText = "OK"): Response {
  return new Response(JSON.stringify(body), { status, statusText, headers: { "content-type": "application/json" } });
}

function createEngine(fetchImpl: typeof globalThis.fetch, timeoutMs?: number): ChatCompletionsEngine {
  return new ChatCompletionsEngine({
    url: ENDPOINT,
    apiKey: "unit-test-key",
    modelId: CTX.modelId,
    id: "modelscopecn",
    timeoutMs,
    fetch: fetchImpl,
  });
}

describe("autocomplete/engine — diagnostics and request shape", () => {
  it("posts to the given endpoint with the configured model and max_tokens", async () => {
    const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
    const engine = createEngine((input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const body = typeof init?.body === "string" ? init.body : "{}";
      seen.push({ url, body: JSON.parse(body) as Record<string, unknown> });
      return Promise.resolve(jsonResponse({ choices: [{ message: { content: "42" } }] }));
    });

    const result = await engine.complete(CTX, new AbortController().signal);

    assert.equal(result.text, "42");
    assert.equal(result.status, 200);
    assert.equal(result.error, undefined);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, ENDPOINT);
    assert.equal(seen[0].body.model, CTX.modelId);
    assert.equal(seen[0].body.max_tokens, 77);
  });

  it("reports the HTTP status and reason instead of failing silently", async () => {
    const engine = createEngine(() => Promise.resolve(jsonResponse({}, 429, "Too Many Requests")));

    const result = await engine.complete(CTX, new AbortController().signal);

    assert.equal(result.text, undefined);
    assert.equal(result.status, 429);
    assert.match(result.error ?? "", /429/);
  });

  it("treats an empty completion as a status-only result", async () => {
    const engine = createEngine(() => Promise.resolve(jsonResponse({ choices: [{ message: { content: "" } }] })));

    const result = await engine.complete(CTX, new AbortController().signal);

    assert.equal(result.text, undefined);
    assert.equal(result.status, 200);
    assert.equal(result.error, undefined);
  });

  it("labels our own timeout as a timeout", async () => {
    const engine = createEngine(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
      5,
    );

    const result = await engine.complete(CTX, new AbortController().signal);

    assert.equal(result.text, undefined);
    assert.equal(result.error, "timeout");
  });

  it("returns cancelled without calling fetch when the caller already aborted", async () => {
    let calls = 0;
    const engine = createEngine(() => {
      calls += 1;
      return Promise.resolve(jsonResponse({}));
    });
    const controller = new AbortController();
    controller.abort();

    const result = await engine.complete(CTX, controller.signal);

    assert.equal(calls, 0);
    assert.equal(result.error, "cancelled");
  });
});
