# FIM Default Model Removed Upstream — Inline Suggestions Silently Dead

**Status:** ✅ Solved
**Topic:** autocomplete / models / config
**Updated:** 2026-10-20
**Tags:** #autocomplete #fim #go #models #silent-failure
**Related:** [15 — inline code suggestions](../features/15-20260813-inline-code-suggestions.md), [88 — issue204 block unavailable Zen free models](88-20260903-issue204-block-unavailable-zen-free-models.md), [100 — bundled model data sync](100-20260908-bundled-model-data-sync.md)

---

## Problem

Reported via LinkedIn (Yannick Huebner, 2026-10-13): inline suggestions stopped working entirely — "not working or suggesting anything" — with `opencodego.inlineSuggestions: true` set. First hypothesis (budget exhausted, no fallback path) was wrong: he later confirmed no suggestions even with a valid Go budget. Only settings changed were `inlineSuggestions: true` and `inlineSuggestionsDebounceMs: 150` (valid, within the 50–2000 clamp).

## Root Cause

`DEFAULT_INLINE_MODEL` was `qwen3.5-plus` (in `src/config.ts` and the `package.json` settings default). OpenCode removed that model from the **Go** gateway — the FIM path posts straight to `/chat/completions` with the configured ID, so every suggestion request returned HTTP 400 `Model is unavailable`. The completion engine treats any non-OK response as "no completion" (log to the `OpenCode Completions` output channel, return `undefined`), so the failure was invisible: no ghost text, no error surface.

Why it looked like a quota bug at first: Go's status page and the request pattern matched "budget exhausted". Why it dragged: this was a known landmine — README already filtered `qwen3.5-plus` from the picker as deprecated (registry path), and doc 100 had flagged "`DEFAULT_INLINE_MODEL` is still upstream-deprecated `qwen3.5-plus` — flagged, unchanged". The FIM path bypasses the registry filter entirely (it sends the raw setting, never a picker model), so the deprecation never touched it until upstream finally dropped the model.

## Evidence (verified live 2026-10-20)

| Probe                                                        | Result                                                                                                                                               |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET https://opencode.ai/zen/go/v1/models`                   | `qwen3.5-plus` absent; Qwen on Go: `qwen3.6-plus`, `qwen3.7-plus`, `qwen3.7-max`, `qwen3.8-flash`, `qwen3.8-max`                                     |
| `GET https://opencode.ai/zen/v1/models` (Zen)                | `qwen3.5-plus` still listed — removal is **Go-only**; irrelevant in practice since suggestions are Go-only (`chatCompletionsUrl` is the Go endpoint) |
| `POST /chat/completions` (Go) with `qwen3.5-plus`, dummy key | HTTP 400 `Upstream request failed: Model is unavailable` — **model validation runs before credential check**                                         |
| `POST /chat/completions` (Go) with `qwen3.6-plus`, dummy key | HTTP 401 `Invalid credential` — passes model validation; the workaround is live-verified                                                             |

Key discovery: the gateway validates in the order session → model → credential, which means model availability is testable without a paid key (a dummy-key probe distinguishes "model unknown" from "model known but auth failed").

## Changes

| File                                  | Change                                                                                                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/config.ts`                       | `DEFAULT_INLINE_MODEL` → `qwen3.6-plus`, with a comment naming why (`qwen3.5-plus` removed from Go)                                                                                                                                  |
| `package.json`                        | `inlineSuggestionsModel` default → `qwen3.6-plus`; enum drops `qwen3.5-plus` **and** the equally-removed `deepseek-v4-flash`, adds `deepseek-v4.1-flash`; stale latency claims (measured on the old model) removed from descriptions |
| `src/test/config.test.ts`             | Default-model assertion updated                                                                                                                                                                                                      |
| `README.md`                           | Inline-suggestions section now names `qwen3.6-plus` and notes the removal + manual-switch caveat                                                                                                                                     |
| `scripts/probe-completion-latency.ts` | Candidate list refreshed to live models; sends the required `x-opencode-session` header (added 2026-09-07 enforcement, commit `418c4c4`)                                                                                             |

## Decisions

- **`qwen3.6-plus` as default, not `qwen3.8-flash`.** It is the direct successor, passes gateway model validation, and keeps the verified `enable_thinking=false` non-thinking path. No fresh TTFB measurement yet (needs a real key run of `scripts/probe-completion-latency.ts`), so latency claims were removed from descriptions rather than copied over from the dead model.
- **No settings auto-migration.** Same call as doc 112 (freeOnly): writing user configuration without permission is worse than a documented one-time manual switch. Users on the old default must set `"opencodego.inlineSuggestionsModel": "qwen3.6-plus"` once — communicated directly to the reporter.
- **Silent-degradation design left as is.** Ghost text that half-works is worse than none, and the diagnostics output channel already logs every failure. Surfacing a toast per failed FIM request would spam on every keystroke. The real guard is keeping the default model alive (this fix) and the probe script making that cheap to re-verify.

## Verification

- Dummy-key probe table above (root cause + workaround both live-verified).
- `npm run compile` — pass.
- Follow-up before release: one real-key probe run to re-measure TTFB and confirm `reasoningChars=0` for `qwen3.6-plus` (`OPENCODE_KEY=… npx tsx scripts/probe-completion-latency.ts`).

Follow-up to doc 100 (flagged, now fixed) | Detected via LinkedIn report, 2026-10-20
