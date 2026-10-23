import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ModelScopeStatusBarController } from "../modelscope/statusBar.js";

function createItem() {
  return {
    text: "",
    tooltip: "",
    show() {},
    hide() {},
    dispose() {},
  };
}

describe("ModelScope balance status", () => {
  it("shows total and frozen balance and marks retained values stale after failure", async () => {
    const balanceItem = createItem();
    let attempt = 0;
    const controller = new ModelScopeStatusBarController({
      tokenItem: createItem(),
      quotaItem: createItem(),
      balanceItem,
      resolveChinaApiKey: () => Promise.resolve("key"),
      output: { appendLine() {} },
      fetcher: () => {
        attempt += 1;
        if (attempt > 1) return Promise.resolve(new Response(null, { status: 503 }));
        return Promise.resolve(Response.json({ data: { available_balance: 10, total_balance: 12, frozen_amount: 2 } }));
      },
    });

    await controller.refreshBalance();
    assert.equal(balanceItem.text, "$(server) 10 Magicubes");
    assert.match(balanceItem.tooltip, /Total: 12/);
    assert.match(balanceItem.tooltip, /Frozen: 2/);

    await controller.refreshBalance();
    assert.match(balanceItem.text, /stale/i);
    assert.match(balanceItem.tooltip, /HTTP 503/);
    assert.match(balanceItem.tooltip, /Last successful update:/);
  });

  it("does not fetch or show zero when the China key is empty", async () => {
    const balanceItem = createItem();
    let fetchCount = 0;
    const controller = new ModelScopeStatusBarController({
      tokenItem: createItem(),
      quotaItem: createItem(),
      balanceItem,
      resolveChinaApiKey: () => Promise.resolve(undefined),
      output: { appendLine() {} },
      fetcher: () => {
        fetchCount += 1;
        return Promise.resolve(Response.json({}));
      },
    });

    await controller.refreshBalance();

    assert.equal(fetchCount, 0);
    assert.match(balanceItem.text, /unavailable/i);
    assert.doesNotMatch(balanceItem.text, /0 Magicubes/);
  });
});
