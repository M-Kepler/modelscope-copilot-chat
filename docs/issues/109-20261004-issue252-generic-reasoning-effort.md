# Issue #252 — Reasoning Effort Picker Ignored for Models With No Known Thinking Family

**Status:** ✅ Solved (0.7.9)
**Topic:** thinking / reasoning / metadata / models.dev / registry
**Updated:** 2026-10-04
**Tags:** #thinking #bug #models-dev #fallback #metadata
**GitHub Issue:** [#252](https://github.com/ltmoerdani/opencode-copilot-chat/issues/252)
**Related:** doc [93 — #214 thinking settings scope](93-20260903-issue214-thinking-settings-scope.md), [102 — #239 reasoning echo self-heal](102-20260923-issue239-reasoning-echo-self-heal.md), issue #207 (`big-pickle` repetition penalty), issue #226 (schema-default echo stripping), issue #3 (per-model thinking modes)

---

## Problem

For any model that does not match a hardcoded thinking family in `src/core/registry.ts`, the **Thinking Effort** control appeared in the Copilot model picker — but selecting a level did nothing. The request body never carried a reasoning field, so the model always answered at its default effort.

Reproduced on `space-bunny-free` (OpenCode Go and Zen):

1. Pick a model with no dedicated thinking family (`space-bunny-free`, `big-pickle`, `hy3`, …).
2. Open the per-model configuration and set **Thinking Effort** to a non-`off` level.
3. Send a message.

**Expected** — the request carries `reasoning_effort`.
**Actual** — no reasoning field is sent; the pick is silently discarded.

The workspace settings were equally ineffective, because the fallback emitted nothing at all.

## Root Cause — two independent defects

### 1. `FallbackThinking` had no payload path

`src/thinking/fallback.ts` returned `{}` from `buildPayload()` for every unknown model, so no reasoning field could ever be emitted:

```ts
buildPayload(_thinking: ThinkingSettings, _opts?: BuildThinkingPayloadOptions): Record<string, unknown> {
  if (REPETITION_PENALIZED_MODEL_PATTERNS.some((pattern) => pattern.test(this.modelId))) {
    return { repetition_penalty: GENERIC_REPETITION_PENALTY };
  }
  return {};
}
```

Its `schema()` already used `metadata.reasoning` to decide whether to show a picker — so the UI promised a control the request ignored. `applyOverride` was the inherited base no-op, so the pick never reached `ThinkingSettings` either.

### 2. `buildPayload` was never given metadata

All four production call sites called `thinkingProviderFor(modelId)` with no metadata, so `this.metadata` was always `undefined` inside `FallbackThinking`. **Any** metadata-driven gate would therefore never have fired, even once defect 1 was fixed.

This is the deeper trap: the thinking system reads its rules from models.dev, but the payload path was the one place that never received it. It is also why patching a single model name (`space-bunny-free`) cannot work — the model was never the problem, the strategy was.

## Fix

`metadata.reasoning` from models.dev is now the source of truth, with no per-model hardcoding.

| Layer          | File                                                                         | Change                                                                                                     |
| -------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Strategy       | `src/thinking/fallback.ts`                                                   | Emits `reasoning_effort` for reasoning-capable unknown models; `applyOverride` maps the pick onto settings |
| Levels         | `src/thinking/schema.ts`                                                     | Generic ladder `off/low/medium/high/xhigh/max`; a model's own `reasoning_options` still takes priority     |
| Settings       | `src/thinking/types.ts`, `config.ts`, `provider/settings.ts`, `package.json` | New `opencodego.thinking.generic` wired through the normal per-family path                                 |
| **Root cause** | `src/provider/chatPrep.ts`, `src/request/{openai,anthropic}.ts`              | Pass `metadata` into `thinkingProviderFor(...)` at every `buildPayload` call site                          |
| Command        | `src/commands/thinkingPicker.ts`                                             | `Set Thinking Effort…` gained the `Generic` family entry                                                   |

### One predicate, so the picker can never lie

`FallbackThinking.genericEffortSupported()` gates the schema, the override mapping, the payload and `requestsThinking` alike. A model that gets no picker can never have one ignored, and vice versa.

It requires `metadata.reasoning === true` **and** `endpointKind === "chat-completions"`. The second clause is load-bearing: `FallbackThinking` also serves family-less models on other wire formats — `claude-*` (Anthropic messages), `gemini-*` (Google), `grok-*` (Responses). `reasoning_effort` is meaningless there, so those keep today's exact no-op behaviour instead of gaining a control that silently does nothing (or 400s the request). The check reads `endpointKind` from the shared registry, so it stays data-driven rather than becoming another name list.

### Levels come from metadata, not from code

`schemaFromReasoningOptions()` still wins when a model declares `reasoning_options`; the shared ladder only fills the gap. A model declaring a level this build has never seen (`none`, `ultra`, …) therefore works with no code change. `ThinkingSettings.generic` is deliberately typed `string` rather than a fixed union for the same reason.

The `big-pickle` repetition-penalty mitigation (issue #207) is preserved and composes with the effort field: `{ repetition_penalty: 1.2, reasoning_effort: "high" }`.

## Follow-up bug found while testing

Fixing the above exposed a second defect in the same feature, in the **per-model picker** path.

`prepareChatRequest` called `resolveThinkingConfig()` _before_ metadata was resolved and without passing it:

```ts
const resolvedThinking = resolveThinkingConfig({
  modelId: rawModelId,
  workspace: baseSettings.thinking,
  modelConfiguration: requestOverride, // ← no metadata
});
```

`FallbackThinking.applyOverride` gates on `metadata.reasoning`, so with `this.metadata` undefined it returned settings unchanged — **the user's per-model pick was discarded outright**. The workspace setting kept working because it flows through `buildPayload`, which _does_ receive metadata. That asymmetry produced a confusing symptom: the Copilot dropdown did nothing while the same value in settings worked.

Fixed by reordering `prepareChatRequest` so metadata is resolved first, and by making `metadata` a **required** field on `ResolveThinkingConfigInput` — the compiler now rejects that call shape, so the bug cannot silently return. Note this also restores `stripSchemaDefaultEcho` (issue #226) for generic models: without metadata the picker schema is unknown, no default is stripped, and VS Code's `"off"` baseline would clobber the user's workspace pick.

## Tests

`src/test/thinking.test.ts` — 14 new cases (495 → 509, plus 3 follow-up → 512):

1. Unknown reasoning-capable model gets the generic schema with the right enum, labels and default.
2. The generic schema default tracks `THINKING_DEFAULTS.generic`.
3. Every non-off level emits a plain `reasoning_effort`.
4. `off` — the default — emits nothing and reports no thinking request.
5. A model's own `reasoning_options` take priority over the generic ladder.
6. Overrides are accepted for the model's _own_ levels (`max`), not just the ladder.
7. Full production round trip: `modelConfiguration` → `resolveThinkingConfig` → `buildPayload`.
8. The `#226` schema-default echo is stripped so the workspace pick survives.
9. A delivered pick is ignored for a model metadata says cannot reason.
10. A model with no metadata at all stays inert (unknown ≠ capable).
11. `claude-*` / `gemini-*` / `grok-*` get neither picker nor payload.
12. `big-pickle` keeps its repetition penalty alongside the effort.
13. Every known family still builds its family-specific payload shape.
14. The generic setting never changes a known family's payload (or its override mapping).

### models.dev evidence

Probed live against `https://models.dev/api.json` to confirm which models actually take the new path:

| Model                                                                           | `reasoning_options`                 | Path exercised                           |
| ------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------- |
| `space-bunny-free`                                                              | `effort: low,medium,high,xhigh,max` | metadata levels (the reported bug)       |
| `hy4`                                                                           | `effort: none,high`                 | metadata levels                          |
| `big-pickle`, `nemotron-3-ultra-free`, `ling-3.0-tiny-free`, `ring-2.6-1t-free` | _(empty)_                           | **new generic ladder**                   |
| `longcat-2.*`, `ling-3.1-flash-free`                                            | `toggle`                            | pre-existing `off`/`on` path (unchanged) |

The empty-`reasoning_options` group previously fell through to a picker with no payload behind it; it now gets the full `off` → `max` ladder.

Verification: **512/512** unit tests, `npm run compile` clean, `lint:js` / `lint:ts` / `prettier` clean, plus manual confirmation in the Extension Development Host on `space-bunny-free` and `big-pickle`.

## Lesson Recorded

When a subsystem's behaviour is **data-driven**, audit that the data actually reaches _every_ entry point — not just the one that was reported. Here the picker path received models.dev metadata and the payload path did not, and the resulting bug looked like "the dropdown is broken" rather than "a required input is missing". Making such an input required in the type — rather than optional and documented — converts the next occurrence of this class from a silent wrong answer into a compile error.
