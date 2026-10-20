# Hide Zen Free-Tier Models, Deprecate freeOnly, Surface the 403 Hint in Chat

**Status:** ✅ Solved
**Topic:** provider / policy / models / errors
**Updated:** 2026-10-20
**Tags:** #provider #zen #free-tier #policy #models #errors
**Related:** doc [106 — issue235/240 free-tier policy](106-20260923-issue235-240-free-tier-policy.md), [110 — issue247 api-base-url](110-20261013-issue247-api-base-url-ignored.md), upstream [anomalyco/opencode#49580](https://github.com/anomalyco/opencode/issues/49580)

---

## Problem

A Marketplace review reported the extension "suddenly stopped working" with `OpenCode's free tier can only be used from within OpenCode. Download it at https://opencode.ai and keep building`. This is the same upstream policy already handled in doc 106 (issues #235/#240), but with three extension-side defects on top:

1. **`opencodego.freeOnly` defaults to `true`**, so the Zen picker listed _only_ free-tier models — every one of which upstream now 403s for third-party clients. A default install was a guaranteed dead end.
2. **The actionable hint never reached the chat.** `buildOpenCodeRequestError()` put the hint in `userMessage` (toast only); VS Code renders `error.message`, which carried the raw gateway JSON (confirmed by the #258 screenshot).
3. **The Zen `testModelId` was dead** (410 `ModelDeprecated`) — fixed separately in #263, which also confirmed issue #258/#261's "Test Connection" failures.

## Evidence (verified live 2026-10-20)

| Probe                                                                                                                       | Result                                                                               |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Zen `POST /chat/completions` on all 10 live free models (`big-pickle`, `deepseek-v4.1-flash-free`, `glm-5.3-flash-free`, …) | HTTP 403 `FreeTierError`, message identical to the review                            |
| Zen paid model (`gpt-5.4`)                                                                                                  | HTTP 401 `AuthError` — paid models are not gated                                     |
| Go endpoint (any model incl. `beam-free`)                                                                                   | HTTP 401 "Go requires a credential" — credential check runs first, no free-tier gate |
| `GET /zen/v1/models`                                                                                                        | 85 models, 10 free still advertised in the catalog                                   |

**Key design fact: the gate is Zen (Console) only.** Go's own free models (`beam-free`, `minimax-m3.1-flash-free`, `longcat-2.5-preview-free`) are unlimited within a paid Go subscription and Go explicitly supports third-party clients — so the filter must be vendor-scoped, never global. Upstream maintainer statements in #49580 confirm the restriction is deliberate anti-abuse ("Our free tier is only meant to be used in opencode") and covers only the free tier; client-identity spoofing was tried by third parties and rejected upstream (every header combination still returns `FreeTierError`), so bypassing remains off the table.

## Changes

| File                          | Change                                                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/config.ts`               | New `isZenFreeTierModel()` with a CONTRACT comment: vendor-scoped (Zen only), lists the Go free-tier exceptions, points at upstream #49580, marked removable if upstream reopens                              |
| `src/provider/definitions.ts` | Zen `filterModel` now **excludes** free-tier models unconditionally (live, cached, and bundled paths all flow through it); `CONFIG_SECTION`/`SETTING_FREE_ONLY`/`FREE_ZEN_MODEL_IDS` imports dropped          |
| `src/errors.ts`               | `describeFreeTierRestriction()` / `describeRouterUnavailable()` hint now replaces the raw detail in **both** `message` and `userMessage`; raw body still logged via `[http-error-body]` in the output channel |
| `package.json`                | `opencodego.freeOnly` marked deprecated (kept registered so existing user settings don't error); description explains the policy and that the setting is ignored                                              |
| `README.md`                   | Setup steps no longer point free-tier users at Zen; free-tier models called out as unavailable from VS Code with the why and the workaround                                                                   |
| `src/test/config.test.ts`     | `isZenFreeTierModel` classification (suffix, `big-pickle`, Go suffix sharing, paid negatives)                                                                                                                 |
| `src/test/errors.test.ts`     | Hint asserted in `error.message` (chat surface) and raw gateway text asserted absent from user-facing messages                                                                                                |

## Decisions

- **Ignore `freeOnly` rather than flip it.** Auto-writing user configuration without permission is worse than a documented no-op; the setting description now says so.
- **Go free models stay selectable.** Verified unlimited-for-subscribers and not behind the gate.
- **Model list still fetched live** — if upstream reopens the free tier, removing the `isZenFreeTierModel` gate (one function) restores visibility everywhere.

## Verification

- `npm run lint` — all 7 checks pass (editorconfig, eslint, markdown, prettier, shellcheck, typecheck, unit tests).
- Live probes above re-run after the change to confirm the gate classification still matches the catalog.

Follow-up to doc 106 | Detected via Marketplace review, 2026-10-20
