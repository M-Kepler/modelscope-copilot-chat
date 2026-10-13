# Issue #247 — `apiBaseUrl` Settings Ignored (Regression From PR #149)

**Status:** 🟢 Active → ✅ Solved (this fix)
**Date:** 2026-10-13
**Issue:** ltmoerdani/opencode-copilot-chat#247
**Reporter:** NameMeLeo (Leo Choi)

## Problem

The `opencodego.apiBaseUrl` and `opencodezen.apiBaseUrl` settings (declared in `package.json`, documented in README/CHANGELOG) were accepted but **completely ignored at runtime** — every request still went to the built-in `https://opencode.ai/zen/{go/,}v1` endpoints, making a custom compatible gateway unusable in v0.7.5+.

## Root Cause — a refactor regression, not a missing feature

The feature was fully implemented and merged in **PR #149** (commit `a26ef33`, Justin Buhagiar, 2026-08-14): `configuredApiBaseUrl()` / `configuredGoUsageUrl()` in `extension.ts` read the settings and derived every route, with unit tests. Surviving remnants (`DEFAULT_GO/ZEN_API_BASE_URL`, `normalizeApiBaseUrl()`, `appendApiPath()`, `SETTING_API_BASE_URL` in `config.ts` + their tests) prove the merge happened.

Later structural refactors dropped the wiring while keeping the helpers:

- `8b1176f` (extract `provider/definitions.ts`) reverted the provider definitions to **hardcoded static URLs**.
- `e8fb6b2` / `2a3589d` (extract `OpenCodeProvider`, commands) removed `configuredApiBaseUrl()` / `configuredGoUsageUrl()` from `extension.ts` entirely.
- The Go usage tracker kept its **half-wired hook**: `GoUsageTrackerOptions.resolveUsageUrl` (`trackerTypes.ts`) and its consumer (`tracker.ts` → `fetchGoUsage(endpointUrl)`) survived, but no caller ever supplied the option, so usage sync stayed pinned to the static `GO_USAGE_API_URL`.

Reporter's observation was exact: _"The settings key and URL helper appear in the bundle, but I could not find a runtime path applying the configured setting."_

## Fix

Re-wire within the current (post-refactor) structure — minimal, single-point:

1. **`src/config.ts`** — new pure helper `apiRoutesFromBaseUrl(baseUrl)` deriving the full route set (`models`, `chat/completions`, `messages`, `responses`, `usage`). Pure (no `vscode` import) so it stays unit-testable; this is the single derivation every consumer now goes through.
2. **`src/provider/definitions.ts`** — `configuredApiBaseUrl(vendor)` reads the **root** configuration with the full key (`opencodego.apiBaseUrl` — a section-scoped read would misresolve, the same trap documented for `enabled`), normalizes via `normalizeApiBaseUrl` (rejects non-http(s), embedded credentials, query/hash → falls back to default), and `PROVIDERS` derives all URLs from it. Agent variants inherit via `providerVariant`, so chat transports (`core/routing.ts`), model discovery (`provider/modelList.ts`), connection test (`providerDialogs.ts`), Agents window, and inline completions (`extension.ts`) are covered by construction. Plus `configuredGoUsageUrl()` for the Go `/usage` route.
3. **`src/usage/dashboard/state.ts`** — `usageTrackerOptions()` now supplies `resolveUsageUrl`, reconnecting the surviving tracker hook so server usage sync also follows the configured base (Go only, as upstream serves it).

Per the documented "Reload after changing" contract, derivation happens once at module init — no live-reload semantics added.

### Test-environment note

Module-scope `PROVIDERS` derivation runs even in bare unit-test environments whose `vscode` stub exposes no `workspace`. The settings read uses a structural cast + optional access so import stays safe there; in the real extension host the setting is read normally.

## Verification

- `npm run compile` — clean.
- Unit tests — 515 pass / 0 fail, including a new `apiRoutesFromBaseUrl` test (custom base + default base).
- `npm run lint` — all 7 checks pass (strict gate, no suppressions).

## Prevention

Refactor extraction that moves URL-bearing object literals must re-check `config.ts` helpers against the moved code — the "half-wired hook" (`resolveUsageUrl` surviving without a supplier) was the telltale sign this was a regression, not a never-implemented feature.
