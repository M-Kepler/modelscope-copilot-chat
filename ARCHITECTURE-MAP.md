**Status:** Active

# Architecture Map

**Topic:** ModelScope providers, chat transport, model metadata, balance and quota
**Updated:** 2026-10-22

This file is the navigation map for the ModelScope-only VS Code extension. The
extension is derived from `opencode-copilot-chat`, but OpenCode Go/Zen is not
registered or exposed as a product feature here.

## Runtime flow

1. [src/extension.ts](./src/extension.ts) starts the ModelScope status-bar
   controller, creates China/Global providers and registers the provider and
   Command Palette contributions.
2. [src/provider/ModelScopeProvider.ts](./src/provider/ModelScopeProvider.ts)
   implements VS Code model discovery, chat responses, diagnostics and
   provider-management actions.
3. [src/provider/modelList.ts](./src/provider/modelList.ts) fetches
   `/v1/models`, applies cancellation/retry behavior, and uses cached or
   bundled models when needed.
4. [src/provider/modelInfo.ts](./src/provider/modelInfo.ts) resolves metadata,
   limits, capabilities, thinking configuration and model display fields.
5. [src/provider/chatPrep.ts](./src/provider/chatPrep.ts) resolves the key,
   converts messages, trims history, computes token budgets and prepares the
   ModelScope request.
6. [src/transports/chatCompletions.ts](./src/transports/chatCompletions.ts)
   and [src/transports/engine.ts](./src/transports/engine.ts) stream
   chat-completions responses and report request summaries.

## Domain ownership

| Area                         | Files                                                                                                                                                                        | Responsibility                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Activation and contributions | [src/extension.ts](./src/extension.ts), [package.json](./package.json)                                                                                                       | Register four ModelScope vendors, commands, and `modelscope.*` settings.                                   |
| Provider and model discovery | [src/provider/](./src/provider), [src/providerTypes.ts](./src/providerTypes.ts)                                                                                              | China/Global endpoints, model listing, model information, key resolution and provider dialogs.             |
| Chat preparation             | [src/provider/chatPrep.ts](./src/provider/chatPrep.ts), [src/provider/messages.ts](./src/provider/messages.ts), [src/provider/historyTrim.ts](./src/provider/historyTrim.ts) | Convert input, preserve reasoning/tool history, bound image/history payloads and calculate request limits. |
| Model metadata               | [src/models/](./src/models), [src/core/registry.ts](./src/core/registry.ts)                                                                                                  | Model limits, capability metadata, family/thinking resolution and stable bundled fallbacks.                |
| HTTP and streaming           | [src/request/](./src/request), [src/transports/](./src/transports)                                                                                                           | ModelScope request headers, OpenAI-compatible payloads, retries, SSE parsing and response extraction.      |
| Magicube and request usage   | [src/modelscope/](./src/modelscope)                                                                                                                                          | Read-only Magicube balance, response-quota formatting and the three status-bar indicators.                 |
| Tests                        | [src/test/](./src/test)                                                                                                                                                      | Unit and regression tests; run with `npm test`.                                                            |

## Important contracts

- Only `modelscopecn`, `modelscopeglobal`, `modelscopecn-agent`, and
  `modelscopeglobal-agent` are contributed as language-model providers.
- Both regions use ModelScope's OpenAI-compatible chat-completions API and
  ModelScope authentication headers; no OpenCode client/session headers are
  sent.
- The extension reads the ModelScope China Magicube endpoint only. Balance
  refresh never performs sign-in, check-in, inference, earnings, transaction
  history, or a Global balance request.
- Magicube balance, response request quotas, and token usage are separate
  status-bar values. Missing or failed data is not rendered as a successful
  zero balance.
- Model-list, metadata and balance failures remain visible in diagnostics or
  status-bar state; successful cached data may be shown as stale.
- Model-family and thinking-strategy lookup strips the owner prefix from
  `owner/model` IDs before applying registry patterns.
- Keep provider registration, VS Code manifest contributions and tests in
  sync when changing a vendor or command.

## Validation

`npm run lint` is the repository-wide gate for formatting, Markdown,
linting, type-checking and unit tests. For focused development, run
`npm run compile` and the relevant test file before the full gate.
