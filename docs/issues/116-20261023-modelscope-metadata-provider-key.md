**Status:** 🟢 Active

# Every ModelScope Model Reported the 262K Default Context

**Topic:** metadata / models.dev / context-window
**Updated:** 2026-10-23
**Tags:** #metadata #models-dev #context-window #models

---

## Problem

All 37 models registered for `modelscopecn` displayed a `262K` context size in
the VS Code model table and picker.

## Root Cause

`MODELS_DEV_PROVIDER_BY_VENDOR` looked up the provider keys `modelscopecn` and
`modelscopeglobal`, but models.dev publishes ModelScope under a single key:
`modelscope` (`api: https://api-inference.modelscope.cn/v1`). The lookup always
returned `undefined`, so `normalizeModelsDevSnapshot` stored empty provider
records and `resolveModelMetadata` fell through to
`DEFAULT_MODEL_CONTEXT_WINDOW` (`262144`) for every model.

ModelScope's own `GET /v1/models` cannot compensate: it returns only `id`,
`object`, `owned_by`, and `created` — no context or capability fields — so the
live path never contributed metadata either. Diagnostics confirmed the shape:

```text
metadataSource: default      (32 models)
metadataSource: fallback     (5 models — reasoning/vision only, no limits)
advertisedContextWindow: 262144  (all 37)
```

## Solution

- Mapped `MODELSCOPE_CN_VENDOR` and `MODELSCOPE_GLOBAL_VENDOR` to the real
  `modelscope` provider key. Context/output limits describe the model itself, so
  the Global region correctly reuses the same data.
- Added regression tests that normalize a real-shaped models.dev payload and
  assert both vendors resolve non-default limits.

## Why the Mapping Alone Was Not Enough

The mapping fix is correct but yields **zero** real limits for the current
catalog. Verified against live data:

```text
models.dev modelscope entries: 7
live ModelScope models: 37
covered by real limits: 0
```

models.dev describes only older models (`Qwen/Qwen3-*-2507`, `ZhipuAI/GLM-4.5`,
`ZhipuAI/GLM-4.6`), none of which appear in the current inference catalog
(DeepSeek-V4.x, MiniMax-M3, Kimi-K2.x, GLM-5.x). ModelScope's own APIs expose no
runtime limit either:

| Source                                      | Context limits?                                 |
| ------------------------------------------- | ----------------------------------------------- |
| `GET /v1/models`                            | No — only `id`, `object`, `owned_by`, `created` |
| `GET /api/v1/models/{owner}/{name}`         | No — no context field in the detail payload     |
| repository `config.json` (`max_position_…`) | Yes — readable for 34 of 37 models              |

## Solution, Part 2 — Bundled Per-Model Windows

Added `MODELSCOPE_CONTEXT_WINDOWS` in `src/models/modelTables.ts`, populated from
each model's own `config.json` (`max_position_embeddings`, plus
`model_max_length` / `max_seq_len` / `n_positions` and nested `text_config` /
`llm_config` fallbacks). 33 ids are listed; both regions share them because the
same weights back both endpoints.

`fallbackModelMetadata` treats a bundled window as the declared limit, so
`resolveModelMetadata` returns it for every model regardless of whether the
models.dev snapshot or the persisted cache is empty — a stale empty snapshot can
no longer mask the value.

Two deliberate exclusions:

- Models with no readable config (image-edit endpoints, early-access previews)
  keep `DEFAULT_MODEL_CONTEXT_WINDOW`. Advertising a guessed window would let
  prompts grow past what the endpoint accepts.
- `MiniMax/MiniMax-M1-80k` declares `max_position_embeddings: 10240000` with no
  `rope_scaling`, contradicting its published 80K-output / 1M-context spec. The
  value is unreliable, so the id is omitted rather than copied.

`MODEL_METADATA_REVISION` was deliberately **not** bumped. The bundled table is
read by the fallback tier, which outranks nothing that already holds a value but
is consulted whenever live and cached data have no limits — i.e. immediately. The
effective model id already embeds the resolved limits, so the picker refreshes
without a revision reset.

## Files Changed

- `src/models/metadata.ts`
- `src/models/modelTables.ts`
- `src/test/metadata.test.ts`

## Verification

- `npx tsx --test src/test/metadata.test.ts` — mapping test failed before the
  fix and passed after; the three bundled-window tests cover a 1M model, the
  default-retaining path, and the MiniMax exclusion. Result: `pass 34 / fail 0`.
- `npm run lint` — passed (all 7 checks).
- Installed VSIX inspected: `out/models/modelTables.js` contains
  `"deepseek-ai/DeepSeek-V4.1-Flash-1017": 1048576` and `metadata.js` reads
  `MODELSCOPE_CONTEXT_WINDOWS`.
