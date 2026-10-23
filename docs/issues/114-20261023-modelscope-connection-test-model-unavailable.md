**Status:** ✅ Solved

# ModelScope Connection Test Used an Unavailable Model

**Topic:** provider / models
**Updated:** 2026-10-23
**Tags:** #provider #models #connection-test

---

## Problem

The ModelScope China connection test returned HTTP 400:
`Model id : Qwen/Qwen3-8B , has no provider supported`.

## Root Cause

Both provider definitions used the retired `Qwen/Qwen3-8B` ID as their fixed
connection-test model. The live China and Global `/v1/models` catalogs no longer
listed that ID.

## Solution

Changed the shared connection-test model to `Qwen/Qwen3.5-27B`, which appeared in
both regional model catalogs. Added a regression test that exercises the
connection-test request and verifies the selected model.

## Files Changed

- `src/provider/definitions.ts`
- `src/test/modelScopeProviderDialogs.test.ts`
- `CHANGELOG.md`
- `ARCHITECTURE-MAP.md`

## Verification

- Both public regional model catalogs were checked without credentials:
  `Qwen/Qwen3-8B` was absent and `Qwen/Qwen3.5-27B` was present.
- The regression test failed before the fix because the request used
  `Qwen/Qwen3-8B`.
- No authenticated chat completion was sent; a live inference test still
  requires a user-configured API key.
