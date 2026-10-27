import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bumpCompletionUsage, matchesAcceptance, utcDayStart, completionUsageToSeries } from "../autocomplete/usage.js";

const DAY = 86400000;

describe("autocomplete/usage — bumpCompletionUsage", () => {
  it("creates a day entry on first bump", () => {
    const days = bumpCompletionUsage([], 1000, "suggested");
    assert.deepEqual(days, [{ dayStart: 1000, suggested: 1, approved: 0 }]);
  });

  it("increments an existing day", () => {
    const days = [{ dayStart: 1000, suggested: 1, approved: 0 }];
    const next = bumpCompletionUsage(days, 1000, "approved");
    assert.equal(next[0].suggested, 1);
    assert.equal(next[0].approved, 1);
  });

  it("mutates and returns the same array (in-place counter)", () => {
    const input = [{ dayStart: 1000, suggested: 0, approved: 0 }];
    const next = bumpCompletionUsage(input, 1000, "suggested");
    assert.equal(input[0].suggested, 1);
    assert.equal(next[0].suggested, 1);
    assert.strictEqual(next, input);
  });

  it("trims old days beyond maxDays", () => {
    let days: ReturnType<typeof bumpCompletionUsage> = [];
    for (let i = 0; i < 372; i++) {
      days = bumpCompletionUsage(days, i * DAY, "suggested");
    }
    assert.ok(days.length <= 370, `expected <=370 days, got ${days.length}`);
  });
});

describe("autocomplete/usage — matchesAcceptance", () => {
  it("counts a multi-character insert that matches the suggestion", () => {
    assert.equal(matchesAcceptance("hello", "hello world"), true);
  });

  it("counts when the pending text is a prefix of the change", () => {
    assert.equal(matchesAcceptance("hello world", "hello"), true);
  });

  it("rejects single-character keystrokes", () => {
    assert.equal(matchesAcceptance("a", "abc"), false);
  });

  it("rejects empty pending text", () => {
    assert.equal(matchesAcceptance("ab", ""), false);
  });
});

describe("autocomplete/usage — utcDayStart", () => {
  it("aligns to UTC midnight", () => {
    assert.equal(utcDayStart(Date.UTC(2026, 0, 1, 12, 30, 0)), Date.UTC(2026, 0, 1, 0, 0, 0));
  });

  it("handles end-of-day rollover", () => {
    assert.equal(utcDayStart(Date.UTC(2026, 11, 31, 23, 59, 59, 999)), Date.UTC(2026, 11, 31, 0, 0, 0));
  });
});

describe("autocomplete/usage — completionUsageToSeries", () => {
  it("emits zero-filled buckets across the window", () => {
    const dayStart = utcDayStart(Date.UTC(2026, 0, 3, 0, 0, 0));
    const days = [{ dayStart: dayStart - 2 * DAY, suggested: 2, approved: 1 }];
    const series = completionUsageToSeries(days, dayStart, 3);
    assert.equal(series.length, 3);
    assert.equal(series[0].suggested, 2);
    assert.equal(series[0].approved, 1);
    assert.equal(series[1].suggested, 0);
    assert.equal(series[2].suggested, 0);
  });

  it("aligns to a shared first-day override", () => {
    const dayStart = utcDayStart(Date.UTC(2026, 0, 5, 0, 0, 0));
    const firstDay = utcDayStart(Date.UTC(2026, 0, 1, 0, 0, 0));
    const series = completionUsageToSeries([], dayStart, 0, firstDay);
    assert.equal(series.length, 5);
  });
});
