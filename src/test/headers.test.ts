import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildModelScopeAuthHeaders } from "../modelScopeAuth.js";
import { buildModelScopeRequestHeaders } from "../request/headers.js";

describe("ModelScope request headers", () => {
  it("sends only the ModelScope user agent", () => {
    assert.deepEqual(buildModelScopeRequestHeaders(), {
      "User-Agent": "modelscope-copilot-chat/0.7.10 VSCode",
    });
  });
});

describe("ModelScope authentication headers", () => {
  it("uses bearer authentication without echoing the key in a client header", () => {
    const headers = buildModelScopeAuthHeaders("chat-completions", "test-modelscope-key");

    assert.equal(headers.Authorization, "Bearer " + "test-modelscope-key");
    assert.equal(headers["x-modelscope-client"], undefined);
    assert.equal(headers["x-opencode-client"], undefined);
  });
});
