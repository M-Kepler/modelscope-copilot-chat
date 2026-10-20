# Issue #262 (+ #261) — CLI 2.x usage history unreadable; Zen/Go Test Connection dead models

**Status:** ✅ Solved (branch `fix/issue262-cli2-history-and-issue261-zen-test-model`)
**Topic:** usage / provider / models
**Updated:** 2026-10-20
**Tags:** #usage #sqlite #cli2 #zen #test-connection #byok
**GitHub Issues:** [#262](https://github.com/ltmoerdani/opencode-copilot-chat/issues/262), [#261](https://github.com/ltmoerdani/opencode-copilot-chat/issues/261)
**Related:** [88-20260903-issue204-block-unavailable-zen-free-models.md](88-20260903-issue204-block-unavailable-zen-free-models.md) · repo memory `opencode-go-usage-accuracy.md`

---

## Problem

### #262 — usage dashboard shows 0 tokens for today (opencode CLI ≥ 2.0)

`src/usage/history.ts` read Go per-message usage only from the CLI 1.x `message` table. The CLI 2.x schema moved that data to `session_message` (and stopped writing `message`), so "Today"/"Yesterday"/the charts showed 0 despite active CLI usage.

### #261 — "OpenCode Zen does not show in add models"

Reporter gave no environment/repro detail. Investigation found two **verified broken** Zen surfaces adjacent to the report (both fixed here), but could NOT reproduce the missing "+ Add Models" entry itself.

## Root Cause (evidence-based)

### #262 — two schemas, and the reporter's patch was wrong twice

Verified against a live `~/.local/share/opencode/opencode.db` that went through the 1.x → 2.x migration:

| fact                                                                           | evidence                                                                                                                                                                  |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `message` and `session_message` hold the same per-message rows after migration | 927/929 `message` ids exist in `session_message` with identical cost/tokens/modelId/`time.created` (the CLI's `v1-migration.bun.ts` copies legacy rows preserving ids)    |
| `session_v2` is a per-session **aggregate**                                    | its Go total (57 rows, $2.671938) exactly equals the per-message total (191 rows, $2.671938)                                                                              |
| reporter's `UNION ALL message + session_v2` **double-counts**                  | measured: $5.343876 = exactly 2× the true total                                                                                                                           |
| reporter's `providerID='opencode'` filter imports **Zen** usage                | `opencode` = Zen free models (243 rows, 17.1M tokens); Go is `opencode-go` — confirmed by model-id sets and the CLI's own models.dev snapshot keys                        |
| CLI 2.x column moves                                                           | role → `type` column; provider/model → `$.model.providerID`/`$.model.id`; `$.path.cwd` gone → joined from `session_v2.directory` (matches legacy cwd for all 191 Go rows) |
| fresh CLI 2.x DB may lack `message`                                            | caught by the unit tests — the reader probes `sqlite_master` and falls back to a v2-only query                                                                            |

### #261 — verified broken surfaces

1. **Zen `testModelId` was `deepseek-v4-flash-free`** — dead upstream (issue #204, listed in our own `KNOWN_UNAVAILABLE_MODEL_IDS`), so **every** Zen "Test Connection" failed with "Model is unavailable" before validating anything.
2. **Go `testModelId` was `deepseek-v4-flash`** — no longer in the live Go catalog (replaced by `deepseek-v4.1-flash`).
3. **Zen free tier is client-gated**: live probes show `403 FreeTierError "OpenCode's free tier can only be used from within OpenCode"` for free models from any non-OpenCode client, regardless of `User-Agent` / `x-opencode-client` / key presence. So a free test model can never validate a credential.
4. **Not reproducible**: the `opencodezen` vendor contribution, `when` clause (`config.opencodezen.enabled`, registered, default `true`), activation event, and registration in `extension.ts` are all symmetric with Go and correct; the live Zen `/models` returns 85 models (10 free). Most plausible remaining causes are user-side: "+ Add Models" clicked in the **Agents window** (agent vendors hidden by default via `showAgentModelsInManagePanel=false` + BYOK bridge settings) or an outdated VS Code.

## Fix

| file                                 | change                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/usage/history.ts`               | Added `HISTORY_ROWS_SQL_V2` (CLI 2.x projection incl. `session_v2.directory` cwd join) and `HISTORY_ROWS_SQL_COMBINED` (`UNION` → dedups rows shared by both schemas). A `sqlite_master` probe (`parseHistorySchemasProbeRow` / `selectHistoryRowsSql`) picks legacy-only / combined / v2-only per database — used by BOTH readers (node:sqlite and the `sqlite3` binary fallback) |
| `src/provider/definitions.ts`        | `testModelId` → `deepseek-v4.1-flash` for Go and Zen (live on both gateways, cheapest paid tier; `max_tokens: 10` ≈ negligible cost)                                                                                                                                                                                                                                               |
| `src/test/cli2HistoryReader.test.ts` | new — builds real SQLite DBs via `node:sqlite` and proves: provider filtering, dedup (3 shared + 1 v2-only → 4 rows, exact total, never 2×), cwd join, and the fresh-2.x-no-legacy-table case                                                                                                                                                                                      |

## Verification

- `npm run lint` — 7/7 (editorconfig, eslint, markdown, prettier, shell, typecheck, tests incl. the new suite).
- SQL variants validated against the real local `opencode.db` before implementation (combined UNION returns 191 rows / $2.671938 — identical to the per-message truth).
- Live gateway probes: `deepseek-v4.1-flash` present on both `/zen/go/v1/models` and `/zen/v1/models`; old ids absent.

## Lessons Learned

1. **Read the actual schema before patching a usage query** — the reporter's locally-"verified" patch double-counted every dollar because `session_v2` is an aggregate table, not a per-message one.
2. **Provider-id assumptions are dangerous**: `opencode` (Zen) vs `opencode-go` (Go) vs legacy `opencodego` alias — always verify against the model-id sets actually present per provider.
3. **A missing table is a prepare-time error** — schema-optional SQL needs a probe statement, not a guard inside the SELECT. The unit tests caught the fresh-CLI-2.x-without-`message` case that the first implementation missed.
4. **Connection-test models must be (a) live and (b) paid on Zen** — free-tier models 403 for any non-OpenCode client regardless of key validity, so they cannot validate credentials.

## Open follow-up (not in this PR)

- #261 needs reporter confirmation (VS Code version + `OpenCode: Model Picker Diagnostics` output) if Zen is still absent from "+ Add Models" after this fix.
- Zen free-tier `403 FreeTierError` on real chat requests (not just the test) deserves its own investigation — it may require OpenCode-side allowance for this client.
