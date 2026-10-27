import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCompletionWindow, isChatInputDocument, isCompletionDocument } from "../autocomplete/context.js";

describe("autocomplete/context — scheme guards", () => {
  it("chat input schemes are excluded", () => {
    assert.equal(isChatInputDocument({ scheme: "chatSessionInput" }), true);
    assert.equal(isChatInputDocument({ scheme: "sessions-chat" }), true);
    assert.equal(isChatInputDocument({ scheme: "file" }), false);
  });

  it("code editor schemes are included", () => {
    assert.equal(isCompletionDocument({ scheme: "file" }), true);
    assert.equal(isCompletionDocument({ scheme: "untitled" }), true);
    assert.equal(isCompletionDocument({ scheme: "git" }), true);
    assert.equal(isCompletionDocument({ scheme: "vscode-notebook-cell" }), true);
    assert.equal(isCompletionDocument({ scheme: "chatSessionInput" }), false);
  });
});

describe("autocomplete/context — buildCompletionWindow", () => {
  it("keeps the char before the cursor in the prefix", () => {
    const text = "hello\nworld\nfoo";
    const w = buildCompletionWindow(text, text.length);
    assert.ok(w.prefix.endsWith("foo"));
    assert.equal(w.suffix, "");
  });

  it("bounds the prefix to prefixLines", () => {
    const text = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk";
    const w = buildCompletionWindow(text, text.length, { prefixLines: 3 });
    const lines = w.prefix.split("\n");
    assert.ok(lines.length <= 3, `expected <=3 prefix lines, got ${lines.length}`);
    assert.ok(w.prefix.includes("i"));
    assert.ok(w.prefix.includes("j"));
    assert.ok(w.prefix.includes("k"));
  });

  it("bounds the suffix to suffixChars and cuts at a newline", () => {
    const text = "x" + "y".repeat(50) + "\nnext";
    const w = buildCompletionWindow(text, 1, { suffixChars: 300 });
    assert.ok(w.suffix.length <= 300);
    assert.ok(w.suffix.endsWith("\n"));
  });

  it("does not cut when the newline is beyond the suffix window", () => {
    const text = "x" + "y".repeat(500) + "\nnext";
    const w = buildCompletionWindow(text, 1, { suffixChars: 300 });
    assert.equal(w.suffix.length, 300);
    assert.ok(!w.suffix.includes("\n"));
  });

  it("returns an empty suffix at end of document", () => {
    const w = buildCompletionWindow("abc", 3);
    assert.equal(w.suffix, "");
  });
});
