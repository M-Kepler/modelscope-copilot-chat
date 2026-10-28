**Status:** 🟢 Active

# Commit-Message Generation & Inline Suggestions — Support Status and Logging

**Topic:** provider / autocomplete / utility-model / logging
**Updated:** 2026-10-28
**Tags:** #provider #autocomplete #byok #vscode #logging
**Related:** [`../features/15-20260813-inline-code-suggestions.md`](../features/15-20260813-inline-code-suggestions.md), [`32-20260708-vscode-128-byok-utility-model.md`](32-20260708-vscode-128-byok-utility-model.md)

---

## Question

Does ModelScope for Copilot Chat support (a) Source Control commit-message
generation and (b) ghost-text inline suggestions today — and if either fires,
does the extension print anything to its logs?

## Answer

| Capability                      | Supported today                                                               | Default                           | Extension code      |
| ------------------------------- | ----------------------------------------------------------------------------- | --------------------------------- | ------------------- |
| Inline (ghost-text) suggestions | ✅ Yes, opt-in                                                                | disabled                          | `src/autocomplete/` |
| Git commit-message generation   | ⚠️ Only via VS Code's utility-model routing; the fork adds no code of its own | routes to Copilot's utility model | none                |

Short version: inline suggestions **are** implemented here; commit-message
generation is **not an extension feature** — it is a VS Code/Copilot Chat
utility flow that can be pointed at a ModelScope model through VS Code
settings. Requests that reach the provider are logged; inline completions are
**completely silent**.

## Inline Suggestions

- Registered at activation in [`src/extension.ts`](../../src/extension.ts) for all
  four vendors, and only when `modelscope.inlineSuggestions` is `true`
  ([`src/autocomplete/index.ts`](../../src/autocomplete/index.ts)). Toggling the
  setting therefore needs a **window reload**.
- Request path: `provideInlineCompletionItems` → 10-line prefix / 300-char suffix
  window → FIM-emulated prompt (`<|fim_prefix|>…<|fim_suffix|>…<|fim_middle|>`) →
  `POST /v1/chat/completions`. ModelScope exposes no FIM endpoint, so the
  fill-in-the-middle tokens are sent inline; Qwen-family models get
  `enable_thinking: false`. 3s timeout per request.
- Documents offered completions: `file`, `untitled`, `git`, `vscode-userdata`,
  `vscode-notebook-cell`. Chat prompt boxes (`chatSessionInput`,
  `sessions-chat`) are explicitly skipped.
- Contributed settings: `modelscope.inlineSuggestions`,
  `modelscope.inlineCompletionModel` (default `Qwen/Qwen3.5-27B`),
  `modelscope.inlineCompletionDebounceMs`, `modelscope.inlineCompletionMaxTokens`.
  The opt-in switch is read at activation (reload to change it); the other three
  are re-read on every request.
- Region: one provider is registered, and each request uses the **first**
  candidate region that has a stored key (China before Global, agent variants
  collapsed into their base region). The chosen region is in the log line.
- Registration is activation-time only and deliberately ignores
  `modelscope.enabled` (that switch documents itself as "chat providers").
- **Logging:** every completed request logs one line to the **ModelScope**
  output channel:
  `[inline] vendor=… model=… status=… durationMs=… chars=…|error=… maxTokens=…`.
  Superseded/cancelled runs are intentionally not logged (they are the normal
  case while typing). A missing API key is logged once per session.

## Git Commit-Message Generation

The extension implements no commit-message code. VS Code's SCM sparkle action
runs the Copilot Chat command `github.copilot.git.generateCommitMessage`
(the workbench wires it through `scm.input.triggerSetup`), which is a **utility**
request. ModelScope only sees it if VS Code routes it to a ModelScope model.

Verified against the installed VS Code **1.143.1** workbench bundle
(`resources/app/out/vs/workbench/workbench.desktop.main.js`):

- `chat.byokUtilityModelDefault` still has the enum `none | mainAgent | copilot`,
  but its **default is now `"copilot"`** ("Use the default GitHub Copilot utility
  model") — not `"none"` as recorded for 1.128 in doc 32. So with default
  settings the utility flow is served by Copilot's utility model, **not** by
  ModelScope, and no ModelScope request/log line appears.
- `chat.utilitySmallModel` is the explicit override: "The `vendor/id` of a BYOK
  model that overrides the default model for utility flows such as title and
  pull request generation."
- ModelScope models are contributed with `isBYOK: true`
  ([`src/provider/modelInfo.ts`](../../src/provider/modelInfo.ts)), so they are
  eligible for that override.

To route commit-message generation through ModelScope:

1. `chat.utilitySmallModel` = `modelscopecn/<model id>` (or
   `modelscopeglobal/<model id>`), **or** `chat.byokUtilityModelDefault` =
   `mainAgent` while a ModelScope model is the selected chat agent.
2. Keep `modelscope.enabled` on and the region's API key stored.

This fork has no utility-model command of its own (doc 32's
`OpenCode: Configure Utility Models` was not ported — `grep -i utility src/`
returns nothing), so this is a plain VS Code user setting.

**Not verified live yet:** an actual commit-message request reaching a
ModelScope provider (needs a configured API key plus the utility-model
override). Until then this section is static-analysis evidence only.

## Does It Log?

| Trigger                                                                 | Logged?              | Where                                                                                                                         |
| ----------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Chat or utility request that reaches a provider                         | ✅ Yes               | Output → **"ModelScope"**                                                                                                     |
| Recent request history (persisted)                                      | ✅ Yes               | Command **`ModelScope: Show Diagnostics`**                                                                                    |
| Inline completion request                                               | ✅ Yes               | Output → **"ModelScope"**, `[inline] …` line per completed request                                                            |
| Missing API key                                                         | ⚠️ Partly            | chat: error thrown before the request log line, shown in the VS Code UI only; inline: one `[inline] skipped` line per session |
| Blocked by VS Code before routing (utility model gating, BYOK disabled) | ❌ No (VS Code-side) | nothing reaches the extension                                                                                                 |

What a request line looks like (one per request, before the transport starts):

```text
[2026-10-28T01:23:45.678Z] Request: initiator=<extension id|core> model=... rawModel=... endpoint=chat-completions metadataSource=... messages=... promptEstimate=... maxOutputTokens=... modelConfiguration=... thinkingSource=... thinking=... thinkingPayload=...
```

then, from the transport: `[request] url=… payloadBytes=…`,
`[http] <status> <statusText> content-type=…`,
`[response-summary] status=… durationMs=… ttfbMs=… promptTokens=… completionTokens=…`,
`[usage] prompt=… completion=…`.

`requestInitiator` is filled in by VS Code's extension host
(`requestInitiator: <extension id> ?? "core"`), so a request started by the
editor itself shows `initiator=core` and one started by a specific extension
shows that extension's id. The exact value used by the commit-message flow was
not observed live.

`ModelScope: Show Diagnostics` renders the rolling, persisted summary per
request (time, endpoint, initiator, status, durationMs, ttfbMs, bytes, events,
tokens, finishReason, requestId, sessionId, url) —
[`src/provider/transportLog.ts`](../../src/provider/transportLog.ts).

## Root Causes Found (and Fixed 2026-10-28)

1. **Inline completions never reached ModelScope.** `index.ts` passed
   `definition.chatCompletionsUrl` (`…/v1/chat/completions`) into an engine that
   appended `/v1/chat/completions` again, so every request went to
   `…/v1/chat/completions/v1/chat/completions` (404, silently dropped). The
   engine now takes the full endpoint URL.
2. **Four providers fired the same prompt per keystroke.** One provider was
   registered per vendor (China, Global, and their Agents variants, which share
   URL + secret), so each keystroke produced four identical requests — two
   regions, duplicated. One provider is registered now and resolves the region
   per request (first candidate with a stored key).
3. **Zero observability.** The engine swallowed every failure and no channel
   line existed. Results now carry `status`/`error`, `provider.ts` reports them,
   and `index.ts` logs one `[inline] …` line per completed request on the shared
   **ModelScope** channel.
4. **Dead settings.** `inlineCompletionDebounceMs` / `inlineCompletionMaxTokens`
   were read and discarded: `maxTokens: 128` was hardcoded and no debounce was
   ever applied. Tuning is now read per request and fed to the `Debouncer` and
   to `CompletionContext.maxTokens`.
5. **Duplicate output channels.** Each provider instance created its own
   `"ModelScope"` channel. `src/core/modelScopeOutput.ts` now owns the single
   channel, shared by chat and inline completions.

## Remaining Gaps

1. **Unused usage counters** — `autocomplete/usage.ts` is never wired
   (`onResult` is not connected to it), so there are no Suggested/Approved
   metrics in this fork.
2. **No cost attribution** for completion requests — the engine fetches
   directly instead of going through `transports/engine.ts`.
3. **Doc drift** — [`../features/15-20260813-inline-code-suggestions.md`](../features/15-20260813-inline-code-suggestions.md)
   still describes the OpenCode predecessor (`opencodego.*` settings, usage
   panel, "OpenCode Completions" channel).

## Verification

- Code: `extension.ts:78` (registration), `src/autocomplete/index.ts`
  (opt-in gate, per-request region + key, `[inline]` log), `provider.ts`
  (debounce, tuning, cancellation), `engine.ts` (endpoint + status/error),
  `src/core/modelScopeOutput.ts` (shared channel),
  `src/provider/chatPrep.ts:190-197` (request log + initiator),
  `src/transports/engine.ts` (`[request]`, `[response-summary]`, `[usage]`).
- New unit tests: `src/test/autocomplete-engine.test.ts` (endpoint, body,
  status/error, timeout, pre-aborted) and
  `src/test/autocomplete-provider.test.ts` (debounce, configured
  model/max-tokens, supersede, non-code surfaces, cancelled token).
- `npm run lint` — all 7 checks green (editorconfig, eslint, markdown,
  prettier, shellcheck, tsc, 477 unit tests).
- VS Code 1.143.1 bundle probe (read-only):
  `chat.byokUtilityModelDefault` enum/default, `chat.utilitySmallModel`
  description, `scm.input.triggerSetup` → `github.copilot.git.generateCommitMessage`.
- Live gateway probe (2026-10-28): `200` with the correct completion and `404`
  on the old URL — see below.
- Not run: a live commit-message request (needs the utility-model override set)
  and an in-editor ghost-text render (needs the setting on plus a window
  reload); the HTTP layer behind inline completions is live-verified.

### Live Gateway Probe (2026-10-28)

A standalone Node probe posted the real completion body (`model`, FIM-emulated
`messages`, `max_tokens`, `temperature: 0`, `stream: false`,
`enable_thinking: false`) with only `Authorization: Bearer …` and
`Content-Type: application/json` — exactly what
[`src/autocomplete/engine.ts`](../../src/autocomplete/engine.ts) sends — to both
URLs.

| URL                                                                | Result                                     | Reading                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------------- |
| `https://api-inference.modelscope.cn/v1/chat/completions`          | `200`, 843 ms, 479 B, completion `"a + b"` | **confirms the fix end to end**: the FIM middle for `return ▮;` came back     |
| `…/v1/chat/completions/v1/chat/completions` (the old doubled path) | `404` `404 page not found` (18 B)          | **confirms root cause 1**: before the fix every inline request hit a dead URL |

Both halves of root cause 1 are now observed against the real gateway. Against
the prompt `export function sum(a: number, b: number): number {\n  return ▮;\n}`
the fixed URL answered with exactly `a + b` — the correct fill-in-the-middle
completion — in 843 ms, comfortably inside the engine's 3 s timeout.

One nuance worth keeping: an earlier run on the same key returned
`429 insufficient balance` instead of `200`. That still proved routing and auth
were right (a bad path gives `404`, a bad key gives `401`), so a `429` here means
"URL and key are correct, the account is not funded" — not a regression.

This probe verifies the HTTP layer only. The in-editor path (setting toggle +
window reload + ghost text actually rendering + the `[inline] …` line) is still
the manual step below, because it needs a running VS Code host.

## Live Test Checklist

1. Store a ModelScope API key and pick a ModelScope model in the chat picker.
2. Enable `modelscope.inlineSuggestions`, reload the window, type in a `.ts`
   file, then open Output → "ModelScope" and expect
   `[inline] vendor=… status=200 durationMs=… chars=…` (or
   `status=… error=…` when the gateway rejects the request).
3. Set `chat.utilitySmallModel` = `modelscopecn/<model id>`, stage a change and
   run the SCM sparkle action, then check Output → "ModelScope" for a
   `Request: initiator=…` line plus `[response-summary]`, and run
   `ModelScope: Show Diagnostics` to see the same request in the history.
