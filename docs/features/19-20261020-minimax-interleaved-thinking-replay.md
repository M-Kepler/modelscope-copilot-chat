**Status:** 🟢 Active

# MiniMax Interleaved Thinking Replay — Reasoning Preamble Repetition in Agent Loops

**Topic:** provider / thinking / models
**Updated:** 2026-10-20
**Tags:** #streaming #models #provider #minimax #thinking #tool-calling

**Related:** [55 — PR123 DeepSeek reasoning_content echo](../issues/55-20260811-pr123-deepseek-reasoning-content-echo.md), [85 — DeepSeek reasoning leak regression analysis](../issues/85-20260826-discussion118-deepseek-reasoning-leak-regression-analysis.md), [21 — MiniMax M3 think-tag leak](../issues/21-20260613-minimax-m3-think-tag-leak-reimplementation.md), [36 — MiMo thinking infinite loop](../issues/36-20260723-mimo-thinking-infinite-loop.md)

---

## Overview

MiniMax models (`minimax-m2.*`, `minimax-m3.x`) with thinking enabled repeated an identical reasoning preamble before almost every tool call in long agent loops (15+ consecutive terminal commands, each preceded by the same "definitive evidence secured…" sentence). This document records the root cause, the fix, and the per-family reasoning-replay contract.

## Problem

MiniMax is an **interleaved thinking model**. Its official contract (MiniMax-AI/MiniMax-M2 README, "Inference Parameters") requires assistant thinking to be replayed **inline as `<think>...</think>` inside `content`, in its original format** — "Do not remove the `<think>...</think>` part, otherwise, the model's performance will be negatively affected."

The extension previously replayed MiniMax reasoning history as a separate `reasoning_content` field (`shouldEchoThinkingHistory()` returned `true` for the family). The upstream **silently ignores that field** on replay, so prior thinking effectively vanished from context. As a result the model re-derived the same conclusion from scratch at every tool call, producing the visibly identical reasoning preamble each time.

This is **not** an echo-loop (the class of issues #38 / #244): the model neither rejects the field nor traps in one response — it loses thinking continuity across the tool loop.

## Solution

Per-family gates keep the blast radius isolated — no code path changes for DeepSeek / Kimi / GLM / Qwen / Gemini / MiMo / GPT / Claude:

1. `src/reasoningHistory.ts`
   - `shouldEchoThinkingHistory()` now returns `false` for `/^minimax-/i`.
   - New helpers `isMiniMaxModel()` and `inlineThinkingForHistory()` — wrap thinking text as a `"<think>…</think>\n"` prefix.
2. `src/provider/messages.ts` (`convertMessage`)
   - Plain assistant messages: `content = inlinePrefix + textContent` for MiniMax; `reasoning_content` omitted.
   - Assistant messages with `tool_calls`: per-tool reasoning (`reasoningForToolCalls`) is wrapped inline at the front of `content`; `reasoning_content` omitted.
3. `src/test/reasoningHistory.test.ts` — MiniMax moved from the "requires the echo" group to its own; two new tests for `inlineThinkingForHistory`.

## Contracts (reasoning replay per family)

| Family        | Replay format                                               | Reason                                                                              |
| ------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| DeepSeek      | `reasoning_content` field (required)                        | Upstream 400s without it (upstream issue #36354, PR #123)                           |
| Kimi/GLM/Qwen | `reasoning_content` field                                   | Tolerate and benefit from cross-turn continuity                                     |
| Gemini        | `reasoning_content` field (maps to `thought: true` parts)   | Needs the echo for thought parts                                                    |
| MiMo          | none (omitted)                                              | Strict validator rejects the field with tool_calls (issue #38)                      |
| GPT / Claude  | n/a                                                         | Wire formats carry no `reasoning_content`                                           |
| MiniMax       | **inline `<think>...</think>` inside `content`** (this fix) | Interleaved thinking model; upstream drops the field, degrading tool-loop reasoning |

Receive-side note: incoming `<think>` tags in streams are already filtered by `src/transports/thinkTags.ts` (no UI leak) — that path is unchanged.

## Open Risk

Not yet verified empirically whether the OpenCode gateway relays assistant `content` containing `<think>` tags without distortion. Live validation (a multi-tool-call chat with `minimax-m3.1`, thinking on, confirming the preamble no longer repeats) is required before this moves to ✅ Solved.

## Verification

- `npm run lint` (editorconfig, eslint, markdown, prettier, shellcheck, typecheck, unit tests): **Passed** on branch `fix/minimax-interleaved-thinking-replay`.
- Live E2E: **pending**.
