# Fix Streaming Text Truncation Before Tool Calls in ThinkTagFilter and Extractors

**Status:** ✅ Solved
**Topic:** streaming / think-tags / tool-calls / truncation
**Updated:** 2026-10-13
**Tags:** #streaming #think-tags #tool-calls #truncation #extractors
**Related:** docs [21 — minimax-m3-think-tag-leak-reimplementation](21-20260613-minimax-m3-think-tag-leak-reimplementation.md), [50 — pr100-tool-call-flush-review-merge](50-20260803-pr100-tool-call-flush-review-merge.md), [72 — pr164-force-think-tag-stripping-subagents](72-20260821-pr164-force-think-tag-stripping-subagents.md)

---

## Problem

When streaming tool calls with reasoning models (e.g. MiniMax Mimo, DeepSeek, or other models via OpenCode Go), text preceding a tool call was truncated by exactly 8 characters (e.g., `"follow up with a "` -> `[tool invocation]` -> `"summary."`). In VS Code's Copilot Agent Host, this caused sentences to be split across the tool card widget because the trailing 8 characters were emitted as a new markdown block after the tool call started.

## Root Cause

1. In `src/transports/thinkTags.ts`, `ThinkTagFilter.process()` unconditionally sliced off the last `maxScan` (8) characters of the buffer into `this.carry` across every text chunk (because `OPEN_THINK_TAG` is 7 chars and `CLOSE_THINK_TAG` is 8 chars), even when the buffer ended in ordinary prose with no `<` character.
2. In `src/transports/extractors.ts`, `OpenAiResponseExtractor` flushed accumulated `LanguageModelToolCallPart`s upon receiving `finish_reason: "tool_calls"` without first flushing `this.thinkFilter.finish()`. This stranded any carry in `thinkFilter` until the end-of-stream `finally` block, emitting it _after_ the tool call.

## Changes

| File                           | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/transports/thinkTags.ts`  | In `ThinkTagFilter.process()`, eliminated unconditional 8-character tail buffering. Inside `<think>` blocks without a closing tag, only buffer into `this.carry` if `lastLt >= pos` and `CLOSE_THINK_TAG.startsWith(buffer.slice(lastLt))`. Outside `<think>` blocks without an opening tag, only buffer into `this.carry` if `lastLt >= pos` and `OPEN_THINK_TAG.startsWith(buffer.slice(lastLt))`. Otherwise, append all characters directly and clear `this.carry`. `finish()` continues to flush remaining carry.           |
| `src/transports/extractors.ts` | In `BaseResponseExtractor`, introduced shared `flushThinkFilterToParts` and `flushThinkFilterToProgress` helpers to cleanly flush think filter carry. In `OpenAiResponseExtractor.extractStreamParts()`, flush think filter carry before flushing tool calls when `shouldFlushOnFinishReason` fires. In `flushRemainingToolCalls()`, flush think filter carry before flushing remaining tool calls. In `AnthropicResponseExtractor`, flush think filter carry before emitting tool calls on `message_delta` and `message_stop`. |
| `src/test/thinkTags.test.ts`   | Added unit tests covering ordinary prose preservation (e.g. "summary."), boundary tag matching across chunks, non-tag `<` comparisons, and unclosed tag flushing.                                                                                                                                                                                                                                                                                                                                                               |
| `src/test/extractors.test.ts`  | Added tests verifying think filter carry is flushed as visible text before tool call parts in both OpenAI and Anthropic extractors.                                                                                                                                                                                                                                                                                                                                                                                             |

## Verification

- `npm run lint` passes all 7 checks (Editorconfig, ESLint, Markdown, Prettier, Shell, TypeScript, Tests).
- Unit tests verify that text is emitted without delay or truncation before tool invocations.
