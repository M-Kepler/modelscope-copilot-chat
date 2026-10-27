import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { completionFamily, buildCompletionPrompt, COMPLETION_SYSTEM_PROMPT } from "../autocomplete/prompt.js";

describe("autocomplete/prompt — completionFamily", () => {
  it("classifies qwen", () => {
    assert.equal(completionFamily("Qwen/Qwen3.5-27B"), "qwen");
    assert.equal(completionFamily("qwen3.6-plus"), "qwen");
  });

  it("classifies deepseek", () => {
    assert.equal(completionFamily("deepseek/deepseek-chat"), "deepseek");
  });

  it("defaults to unknown", () => {
    assert.equal(completionFamily("some/other-model"), "unknown");
  });
});

describe("autocomplete/prompt — buildCompletionPrompt", () => {
  it("builds a FIM prompt with qwen tokens", () => {
    const p = buildCompletionPrompt("pre", "suf", "Qwen/Qwen3.5-27B");
    assert.equal(p.messages[0].content, COMPLETION_SYSTEM_PROMPT);
    assert.match(p.messages[1].content, /<\|fim_prefix\|>pre<\|fim_suffix\|>suf<\|fim_middle\|>/);
    assert.equal(p.extra.enable_thinking, false);
  });

  it("does not force enable_thinking for unknown family", () => {
    const p = buildCompletionPrompt("pre", "suf", "other/model");
    assert.equal(p.extra.enable_thinking, undefined);
  });

  it("uses deepseek fim tokens and no enable_thinking", () => {
    const p = buildCompletionPrompt("pre", "suf", "deepseek-chat");
    assert.match(p.messages[1].content, /EDMFuncpreEDMFuncsufEDMFunc/);
    assert.equal(p.extra.enable_thinking, undefined);
  });
});
