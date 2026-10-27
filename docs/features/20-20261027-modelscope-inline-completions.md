**Status:** 🟢 Active

# ModelScope Inline Code Suggestions (Ghost Text) — Experimental (#49)

**Topic:** autocomplete / inline-completions / ghost-text / fim / qwen / provider
**Updated:** 2026-10-27
**Tags:** #autocomplete #inline-completions #ghost-text #fim #qwen #provider #feature
**Related:** Issue doc [`25-20260617-inline-completions-fim-research.md`](../issues/25-20260617-inline-completions-fim-research.md)

---

## Overview

Ghost-text inline completions (Copilot-style) while typing, powered by the ModelScope gateway with **thinking forced off**. The feature is **opt-in** (`modelscope.inlineSuggestions`, default `false`) and **experimental**.

This is a port of the upstream `opencode-copilot-chat` inline-completions feature (PR #136 / #138) to the ModelScope-only branch. The `src/autocomplete/` module was copied from upstream and minimally adapted: the OpenCode-specific session header was dropped, the config section changed from `opencodego.` to `modelscope.`, the API key resolved from the ModelScope secret store, and the default model set to a ModelScope-hosted Qwen model.

## Engine Decision (live-measured, not assumed)

ModelScope exposes **no FIM endpoint** (`/completions` probed 404 on `api-inference.modelscope.cn`), so fill-in-the-middle is emulated with FIM tokens inline over `/chat/completions`. The Qwen family genuinely supports non-thinking mode (`enable_thinking: false` produces zero hidden reasoning), so it is the recommended family for inline completions.

## How It Works

Because the gateway exposes no FIM endpoint, completions **emulate fill-in-the-middle** with FIM tokens (`<|fim_prefix|>…<|fim_suffix|>…<|fim_middle|>`) sent inline over `/chat/completions`.

### Module Layout (`src/autocomplete/`, 8 files)

| File          | Role                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| `context.ts`  | bounded prefix/suffix window (10 lines before cursor, short suffix), pure + unit-tested                   |
| `prompt.ts`   | fill-in-the-middle emulation with FIM tokens; Qwen family sends `enable_thinking: false`                  |
| `throttle.ts` | 300ms debounce, latest-wins, superseded runs aborted (`Debouncer`), live `delayMs` resync                 |
| `engine.ts`   | chat-completions engine, 3s timeout, cancellation (AbortSignal), failure logging                          |
| `provider.ts` | `InlineCompletionItemProvider` (single insert at cursor), all timing/size knobs config-driven             |
| `index.ts`    | registration; API key resolved per request from the ModelScope secret store; registered for all 4 vendors |
| `types.ts`    | `CompletionContext` / `CompletionResult` / `CompletionEngine` contract                                    |
| `usage.ts`    | per-day Suggested / Accepted counters — persisted in globalState, chartable in the usage panel            |

## Cancellation & Timing

- **Debounce:** 300ms after the last keystroke (`modelscope.inlineCompletionDebounceMs`). Live — a pending run reschedules when the setting changes.
- **Cancellation:** latest keystroke aborts the in-flight request via `AbortSignal`; stale ghost text never renders.
- **Timeout:** 3s (`COMPLETION_REQUEST_TIMEOUT_MS`); the ghost text simply does not appear.
- **Context window:** tiny by design (10 lines before cursor + short suffix) to keep payloads fast.

## Settings (all under `modelscope.`)

| Setting                      | Default            | Notes                                           |
| ---------------------------- | ------------------ | ----------------------------------------------- |
| `inlineSuggestions`          | `false`            | Opt-in master switch; requires a window reload  |
| `inlineCompletionModel`      | `Qwen/Qwen3.5-27B` | ModelScope model id used for inline completions |
| `inlineCompletionDebounceMs` | `300`              | 0–2000                                          |
| `inlineCompletionMaxTokens`  | `128`              | 1–1024                                          |

## Registration

`registerInlineCompletions` is called once in `activate()` for all four ModelScope vendors (`modelscopecn`, `modelscopeglobal`, `modelscopecn-agent`, `modelscopeglobal-agent`). The API key is resolved per request from the secret store (`MODELSCOPE_CN_SECRET_KEY` / `MODELSCOPE_GLOBAL_SECRET_KEY`) so the engine never holds a key in memory across requests.

## Known Limits

- Acceptance detection is heuristic (VS Code has no stable acceptance event): an insert starting at the suggestion position with matching multi-character text counts as approved.
- Inline-completion request cost is not yet attributed in the usage tracker (the engine uses a raw fetch today).
- If GitHub Copilot's ghost text is active it can win the same slot; users can disable Copilot's via `editor.inlineSuggestions.enabled` / `github.copilot.nextEditSuggestions.enabled`.

## Verification

- `npm run compile` — strict tsc green.
- `npm test` — unit tests for the pure modules (`context`, `prompt`, `throttle`, `usage`).
- `npm run lint` — strict (ESLint + tsc + prettier + markdownlint) green.
