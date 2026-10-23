import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchMagicubeBalance } from "../modelscope/balance.js";

describe("fetchMagicubeBalance", () => {
  it("parses the three balance values from the ModelScope response", async () => {
    let requestedUrl = "";
    let authorization = "";
    const fetcher: typeof fetch = (input, init) => {
      requestedUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return Promise.resolve(
        Response.json({
          data: {
            available_balance: 12.5,
            total_balance: 25,
            frozen_amount: 2,
          },
        }),
      );
    };

    const result = await fetchMagicubeBalance("secret-key", fetcher);

    assert.equal(requestedUrl, "https://modelscope.cn/openapi/v1/magicubes/balance");
    assert.equal(authorization, "Bearer secret-key");
    assert.ok(result.ok);
    assert.deepEqual(result.balance, {
      availableBalance: 12.5,
      totalBalance: 25,
      frozenAmount: 2,
    });
    assert.equal(Number.isFinite(result.fetchedAt), true);
  });

  it("does not make a request when the API key is missing", async () => {
    let called = false;
    const fetcher: typeof fetch = () => {
      called = true;
      return Promise.resolve(Response.json({}));
    };

    const result = await fetchMagicubeBalance(undefined, fetcher);

    assert.deepEqual(result, { ok: false, reason: "no-key", message: "ModelScope China API key is not configured." });
    assert.equal(called, false);
  });

  it("classifies authorization and other HTTP failures", async () => {
    const responseFetcher =
      (status: number): typeof fetch =>
      () =>
        Promise.resolve(new Response(null, { status }));

    assert.equal((await fetchMagicubeBalance("key", responseFetcher(401))).ok, false);
    assert.deepEqual(await fetchMagicubeBalance("key", responseFetcher(403)), {
      ok: false,
      reason: "unauthorized",
      message: "ModelScope rejected the API key (HTTP 403).",
    });
    assert.deepEqual(await fetchMagicubeBalance("key", responseFetcher(503)), {
      ok: false,
      reason: "http",
      message: "Magicube balance request failed (HTTP 503).",
    });
  });

  it("classifies network errors and invalid response bodies without returning zero", async () => {
    const networkFailure: typeof fetch = () => Promise.reject(new Error("connection failed"));
    const invalidJson: typeof fetch = () => Promise.resolve(new Response("{", { status: 200 }));
    const missingFields: typeof fetch = () => Promise.resolve(Response.json({ data: { available_balance: 0 } }));
    const nonFiniteFields: typeof fetch = () =>
      Promise.resolve(Response.json({ data: { available_balance: Number.NaN, total_balance: 1, frozen_amount: 0 } }));

    assert.deepEqual(await fetchMagicubeBalance("key", networkFailure), {
      ok: false,
      reason: "network",
      message: "Magicube balance request failed: connection failed",
    });
    for (const fetcher of [invalidJson, missingFields, nonFiniteFields]) {
      const result = await fetchMagicubeBalance("key", fetcher);
      assert.equal(result.ok, false);
      assert.equal(result.reason, "invalid");
      assert.equal("balance" in result, false);
    }
  });

  it("aborts a slow request after the configured timeout", async () => {
    let timeoutFired = false;
    const slowFetcher: typeof fetch = async (_input, init) => {
      const signal = init?.signal;
      if (!(signal instanceof AbortSignal)) throw new Error("request signal missing");
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            timeoutFired = true;
            reject(signal.reason instanceof Error ? signal.reason : new Error("Request aborted"));
          },
          { once: true },
        );
      });
    };

    const result = await fetchMagicubeBalance("key", slowFetcher, 5);

    assert.equal(result.ok, false);
    assert.equal(timeoutFired, true);
    assert.equal(result.reason, "network");
  });
});
