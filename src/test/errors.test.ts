import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildModelScopeRequestError, ModelScopeRequestError, readRateLimitInfo } from "../errors.js";
import { MODEL_METADATA_CACHE_KEY, MODEL_METADATA_REVISION } from "../config.js";

describe("ModelScope request errors", () => {
  it("includes request-quota headers in rate-limit feedback", () => {
    const response = new Response(null, {
      status: 429,
      headers: {
        "modelscope-ratelimit-requests-limit": "100",
        "modelscope-ratelimit-requests-remaining": "0",
      },
    });
    const error = buildModelScopeRequestError(
      "ModelScope China",
      response,
      JSON.stringify({ error: { message: "quota exceeded", type: "rate_limit" } }),
      "Qwen/Qwen3-8B",
      300,
    );

    assert.ok(error instanceof ModelScopeRequestError);
    assert.match(error.message, /request quota exceeded/i);
    assert.match(error.userMessage, /100.*0|0.*100/);
  });

  it("preserves useful upstream detail for non-quota errors", () => {
    const response = new Response(null, { status: 400, statusText: "Bad Request" });
    const error = buildModelScopeRequestError("ModelScope Global", response, "invalid request", "some-model", 200);

    assert.match(error.message, /HTTP 400/);
    assert.match(error.userMessage, /invalid request/);
  });
});

describe("metadata cache key", () => {
  it("embeds the bundled-data revision", () => {
    assert.equal(MODEL_METADATA_CACHE_KEY, `modelscope.modelMetadataCache.v1.${MODEL_METADATA_REVISION}`);
  });
});

describe("ModelScope rate-limit headers", () => {
  it("reads request and model quotas without treating them as Magicube balance", () => {
    const info = readRateLimitInfo(
      new Headers({
        "modelscope-ratelimit-requests-limit": "100",
        "modelscope-ratelimit-requests-remaining": "90",
        "modelscope-ratelimit-model-requests-limit": "20",
        "modelscope-ratelimit-model-requests-remaining": "18",
      }),
    );

    assert.equal(info.userRequestLimit, "100");
    assert.equal(info.userRequestRemaining, "90");
    assert.equal(info.modelRequestLimit, "20");
    assert.equal(info.modelRequestRemaining, "18");
    assert.equal("availableBalance" in info, false);
  });
});
