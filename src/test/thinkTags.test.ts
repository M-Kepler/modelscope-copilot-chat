import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ThinkTagFilter, shouldStripThinkTags, createThinkTagFilter } from "../transports/thinkTags.js";

describe("ThinkTagFilter — text preservation and boundary buffering", () => {
  it("does not buffer or delay ordinary text ending in words like 'summary.'", () => {
    const filter = new ThinkTagFilter();
    const result = filter.process("follow up with a summary.");
    assert.equal(result.visible, "follow up with a summary.");
    assert.equal(result.thinking, "");

    const finish = filter.finish();
    assert.equal(finish.visible, "");
    assert.equal(finish.thinking, "");
  });

  it("does not buffer ordinary text with length smaller than max tag length", () => {
    const filter = new ThinkTagFilter();
    const result = filter.process("hello");
    assert.equal(result.visible, "hello");
    assert.equal(result.thinking, "");
  });

  it("does not buffer text containing non-tag '<' comparison operators", () => {
    const filter = new ThinkTagFilter();
    const result = filter.process("is 5 < 10 in mathematics?");
    assert.equal(result.visible, "is 5 < 10 in mathematics?");
    assert.equal(result.thinking, "");
  });

  it("buffers a partial opening tag at chunk boundary and resolves it in next chunk", () => {
    const filter = new ThinkTagFilter();
    const chunk1 = filter.process("here is the result <thi");
    assert.equal(chunk1.visible, "here is the result ");
    assert.equal(chunk1.thinking, "");

    const chunk2 = filter.process("nk>internal thoughts</think>done.");
    assert.equal(chunk2.visible, "done.");
    assert.equal(chunk2.thinking, "internal thoughts");
  });

  it("buffers a single '<' at chunk boundary and resolves as normal text when not a think tag", () => {
    const filter = new ThinkTagFilter();
    const chunk1 = filter.process("5 <");
    assert.equal(chunk1.visible, "5 ");
    assert.equal(chunk1.thinking, "");

    const chunk2 = filter.process(" 10 is true.");
    assert.equal(chunk2.visible, "< 10 is true.");
    assert.equal(chunk2.thinking, "");
  });

  it("buffers a partial closing tag at chunk boundary inside a think block", () => {
    const filter = new ThinkTagFilter();
    const chunk1 = filter.process("<think>calculating the answer </th");
    assert.equal(chunk1.visible, "");
    assert.equal(chunk1.thinking, "calculating the answer ");

    const chunk2 = filter.process("ink>The answer is 42.");
    assert.equal(chunk2.visible, "The answer is 42.");
    assert.equal(chunk2.thinking, "");
  });

  it("does not buffer non-tag '<' inside a think block", () => {
    const filter = new ThinkTagFilter();
    const chunk1 = filter.process("<think>checking if 3 < 5 then proceed</think>Done");
    assert.equal(chunk1.visible, "Done");
    assert.equal(chunk1.thinking, "checking if 3 < 5 then proceed");
  });

  it("flushes partial tag carry on finish() when stream ends outside think block", () => {
    const filter = new ThinkTagFilter();
    const chunk1 = filter.process("incomplete tag <thi");
    assert.equal(chunk1.visible, "incomplete tag ");

    const finish = filter.finish();
    assert.equal(finish.visible, "<thi");
    assert.equal(finish.thinking, "");
  });

  it("flushes carry as thinking on finish() when stream ends inside an unclosed think block", () => {
    const filter = new ThinkTagFilter();
    const chunk1 = filter.process("<think>still thinking </th");
    assert.equal(chunk1.visible, "");
    assert.equal(chunk1.thinking, "still thinking ");

    const finish = filter.finish();
    assert.equal(finish.visible, "");
    assert.equal(finish.thinking, "</th");
  });

  it("handles repeated finish() calls idempotently", () => {
    const filter = new ThinkTagFilter();
    filter.process("test <t");
    const first = filter.finish();
    assert.equal(first.visible, "<t");
    const second = filter.finish();
    assert.equal(second.visible, "");
    assert.equal(second.thinking, "");
  });
});

describe("shouldStripThinkTags and createThinkTagFilter", () => {
  it("strips for minimax-m models in auto mode", () => {
    assert.equal(shouldStripThinkTags("auto", "minimax-m2.5"), true);
    assert.equal(shouldStripThinkTags("auto", "minimax-m3"), true);
    assert.equal(shouldStripThinkTags("auto", "deepseek-chat"), false);
  });

  it("respects always and never modes", () => {
    assert.equal(shouldStripThinkTags("always", "deepseek-chat"), true);
    assert.equal(shouldStripThinkTags("never", "minimax-m2.5"), false);
    assert.equal(shouldStripThinkTags(undefined, "minimax-m2.5"), false);
  });

  it("creates filter instance when enabled or force-overridden", () => {
    assert.ok(createThinkTagFilter("always", "any-model") instanceof ThinkTagFilter);
    assert.equal(createThinkTagFilter("never", "minimax-m2.5"), undefined);
    assert.ok(createThinkTagFilter("never", "minimax-m2.5", true) instanceof ThinkTagFilter);
  });
});
