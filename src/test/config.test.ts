import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIG_SECTION,
  DEFAULT_MODEL_CONTEXT_WINDOW,
  DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
  FALLBACK_USER_AGENT,
  MAGICUBE_BALANCE_FETCH_TIMEOUT_MS,
  MODEL_LIST_CACHE_KEY_PREFIX,
  MODEL_LIST_CACHE_TTL_MS,
  MODEL_LIST_FETCH_TIMEOUT_MS,
  MODEL_METADATA_CACHE_KEY,
  MODEL_METADATA_CACHE_TTL_MS,
  MODELSCOPE_USER_AGENT,
  secretKeyFor,
  TEST_CONNECTION_TIMEOUT_MS,
} from "../config.js";

describe("config — ModelScope identity", () => {
  it("uses ModelScope branding and settings", () => {
    assert.equal(CONFIG_SECTION, "modelscope");
    assert.equal(secretKeyFor("modelscopecn"), "modelscope.cn.apiKey");
    assert.equal(secretKeyFor("modelscopeglobal"), "modelscope.global.apiKey");
    assert.notEqual(secretKeyFor("modelscopecn"), secretKeyFor("modelscopeglobal"));
    assert.match(MODELSCOPE_USER_AGENT, /^modelscope-copilot-chat\//);
    assert.match(FALLBACK_USER_AGENT, /^modelscope-copilot-chat\//);
  });
});

describe("config — ModelScope endpoint settings", () => {
  it("keeps read-only balance and provider requests bounded", () => {
    assert.equal(MAGICUBE_BALANCE_FETCH_TIMEOUT_MS, 10_000);
    assert.equal(TEST_CONNECTION_TIMEOUT_MS, 30_000);
    assert.equal(MODEL_LIST_FETCH_TIMEOUT_MS, 15_000);
  });

  it("names persisted ModelScope metadata caches", () => {
    assert.match(MODEL_LIST_CACHE_KEY_PREFIX, /^modelscope\./);
    assert.match(MODEL_METADATA_CACHE_KEY, /^modelscope\./);
    assert.ok(MODEL_LIST_CACHE_TTL_MS > 0);
    assert.ok(MODEL_METADATA_CACHE_TTL_MS > 0);
  });
});

describe("config — model limits", () => {
  it("keeps finite defaults", () => {
    assert.equal(DEFAULT_MODEL_CONTEXT_WINDOW, 262_144);
    assert.equal(DEFAULT_MODEL_MAX_OUTPUT_TOKENS, 65_536);
  });
});
