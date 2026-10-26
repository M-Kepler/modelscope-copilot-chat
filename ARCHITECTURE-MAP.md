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
| Activation and contributions | [src/extension.ts](./src/extension.ts), [package.json](./package.json)                                                                                                       | Register four ModelScope vendors with distinct Agents labels, commands, and `modelscope.*` settings.       |
| Provider and model discovery | [src/provider/](./src/provider), [src/providerTypes.ts](./src/providerTypes.ts)                                                                                              | China/Global endpoints, model listing, model information, key resolution and provider dialogs.             |
| Chat preparation             | [src/provider/chatPrep.ts](./src/provider/chatPrep.ts), [src/provider/messages.ts](./src/provider/messages.ts), [src/provider/historyTrim.ts](./src/provider/historyTrim.ts) | Convert input, preserve reasoning/tool history, bound image/history payloads and calculate request limits. |
| Model metadata               | [src/models/](./src/models), [src/core/registry.ts](./src/core/registry.ts)                                                                                                  | Model limits, capability metadata, family/thinking resolution and stable bundled fallbacks.                |
| HTTP and streaming           | [src/request/](./src/request), [src/transports/](./src/transports)                                                                                                           | ModelScope request headers, OpenAI-compatible payloads, retries, SSE parsing and response extraction.      |
| Magicube and request usage   | [src/modelscope/](./src/modelscope)                                                                                                                                          | Read-only Magicube balance, response-quota formatting and the three status-bar indicators.                 |
| Tests                        | [src/test/](./src/test)                                                                                                                                                      | Unit and regression tests; run with `npm test`.                                                            |

## Important contracts

- Only `modelscopecn`, `modelscopeglobal`, `modelscopecn-agent`, and
  `modelscopeglobal-agent` are contributed as language-model providers.
- Agents providers use the `ModelScope China (Agents)` and
  `ModelScope Global (Agents)` labels so they remain distinguishable from the
  standard providers in VS Code.
- Both regions use ModelScope's OpenAI-compatible chat-completions API and
  ModelScope authentication headers; no OpenCode client/session headers are
  sent.
- The extension reads the ModelScope China Magicube endpoint only. Balance
  refresh never performs sign-in, check-in, inference, earnings, transaction
  history, or a Global balance request.
- Magicube balance, response request quotas, and token usage are separate
  status-bar values. Missing or failed data is not rendered as a successful
  zero balance.
- The balance is refreshed on extension start, every five minutes, on manual
  refresh, and shortly after each completed chat request (throttled to once
  per minute so a tool-call loop does not hit the endpoint once per request).
- Model-list, metadata and balance failures remain visible in diagnostics or
  status-bar state; successful cached data may be shown as stale.
- Model-family and thinking-strategy lookup strips the owner prefix from
  `owner/model` IDs before applying registry patterns.
- Keep the provider connection-test model available in both regions' live model
  catalogs so connection checks validate credentials rather than a retired ID.
- Keep provider registration, VS Code manifest contributions and tests in
  sync when changing a vendor or command.
- Base China/Global providers must use native `configuration` schemas and must
  not declare `managementCommand`, so VS Code's Add Models flow can create BYOK
  groups. Agents variants inherit the region key and are not Add Models entries.
- Provider `when` clauses gate user-visible registration; a `false`
  `modelscope.enabled` hides the providers from Add Models and Chat.
- Every provider contribution declares `icon.light` / `icon.dark` as
  extension-relative SVG paths; VS Code resolves them against the extension root
  and silently drops the icon when a file is missing, so the packaging test
  asserts both files exist.
- models.dev publishes ModelScope under the single key `modelscope`; both
  regions map to it. ModelScope's own model APIs expose no context metadata and
  models.dev covers none of the current inference models, so the resolved limit
  comes from `MODELSCOPE_CONTEXT_WINDOWS` in `src/models/modelTables.ts` —
  values read from each model's own `config.json`. Ids absent from that table
  keep `DEFAULT_MODEL_CONTEXT_WINDOW` (262K). Bump `MODEL_METADATA_REVISION`
  only when limits actually change — a bump resets users' selected model id.

## Validation

`npm run lint` is the repository-wide gate for formatting, Markdown,
linting, type-checking and unit tests. For focused development, run
`npm run compile` and the relevant test file before the full gate.
