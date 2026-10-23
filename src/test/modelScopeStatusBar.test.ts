import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatModelScopeQuota, formatModelScopeTokens } from "../modelscope/quota.js";
import type { TransportRequestSummary } from "../core/transport.js";

const summary: TransportRequestSummary = {
  providerDisplayName: "ModelScope (China)",
  modelId: "Qwen/Qwen3-8B",
  url: "https://api-inference.modelscope.cn/v1/chat/completions",
  payloadBytes: 100,
  totalBytes: 200,
  totalEvents: 4,
  durationMs: 500,
  promptTokens: 120,
  completionTokens: 45,
  userRequestLimit: "100",
  userRequestRemaining: "90",
  modelRequestLimit: "20",
  modelRequestRemaining: "18",
};

describe("ModelScope request status formatting", () => {
  it("renders latest prompt and output token counts", () => {
    assert.equal(formatModelScopeTokens(summary), "Prompt 120 · Output 45 tokens");
  });

  it("renders request quotas separately from Magicube balance", () => {
    assert.equal(formatModelScopeQuota(summary), "Requests 90/100 · Model requests 18/20");
    assert.equal(
      formatModelScopeQuota({ ...summary, userRequestLimit: undefined, userRequestRemaining: undefined }),
      "Model requests 18/20",
    );
  });

  it("reports missing request quotas as unavailable", () => {
    assert.equal(
      formatModelScopeQuota({
        ...summary,
        userRequestLimit: undefined,
        userRequestRemaining: undefined,
        modelRequestLimit: undefined,
        modelRequestRemaining: undefined,
      }),
      "Request quota unavailable",
    );
  });
});
