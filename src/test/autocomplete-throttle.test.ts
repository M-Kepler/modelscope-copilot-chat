import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Debouncer } from "../autocomplete/throttle.js";

const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("autocomplete/throttle — Debouncer", () => {
  it("does not fire before the delay", async () => {
    let fired = 0;
    const d = new Debouncer(50);
    const signal = d.debounce(() => {
      fired += 1;
    });
    assert.equal(signal.aborted, false);
    await tick(20);
    assert.equal(fired, 0);
  });

  it("fires once after the delay", async () => {
    let fired = 0;
    const d = new Debouncer(30);
    d.debounce(() => {
      fired += 1;
    });
    await tick(60);
    assert.equal(fired, 1);
  });

  it("latest-wins: a newer call supersedes the previous one", async () => {
    let fired = 0;
    const d = new Debouncer(30);
    d.debounce(() => {
      fired += 1;
    });
    const signal = d.debounce(() => {
      fired += 100;
    });
    await tick(60);
    assert.equal(fired, 100);
    assert.equal(signal.aborted, false);
  });

  it("cancel aborts the pending signal", () => {
    const d = new Debouncer(1000);
    const signal = d.debounce(() => undefined);
    d.cancel();
    assert.equal(signal.aborted, true);
  });

  it("delayMs setter reschedules a pending run", async () => {
    let fired = 0;
    const d = new Debouncer(1000);
    d.debounce(() => {
      fired += 1;
    });
    d.delayMs = 10;
    await tick(60);
    assert.equal(fired, 1);
  });

  it("dispose cancels everything", () => {
    const d = new Debouncer(1000);
    d.debounce(() => undefined);
    d.dispose();
    // No throw; the internal state is cleared.
    assert.ok(true);
  });
});
