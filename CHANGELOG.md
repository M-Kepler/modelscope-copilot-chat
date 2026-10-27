# Changelog

Notable changes to ModelScope for Copilot Chat are recorded here.

## [Unreleased]

### Added

- ModelScope China and Global language-model providers, with Agents-window
  variants.
- Agents-window providers have distinct `(Agents)` labels in VS Code.
- Provider management menus can set/update and remove region-specific API keys.
- Provider connection tests use a model currently listed by both inference regions.
- Read-only ModelScope Magicube balance refresh and status-bar display.
- Separate status-bar indicators for token usage, response request quotas, and
  Magicube balance.
- Per-model ModelScope context windows, read from each model's own `config.json`
  and bundled as `MODELSCOPE_CONTEXT_WINDOWS`, so large-context models no longer
  advertise the 262K default.
- Light/dark provider icons for the Chat model picker, contributed through the
  `languageModelChatProviders` `icon` field.
- Ghost-text inline completions while typing (issue #49). Opt-in via
  `modelscope.inlineSuggestions` (default `false`); registered for all four
  ModelScope vendors; 300ms debounce, 3s timeout, 10-line prefix / 300-char
  suffix window, FIM emulation over `/chat/completions`.

### Changed

- ModelScope metadata now reads the `modelscope` provider key that models.dev
  actually publishes; the previous `modelscopecn`/`modelscopeglobal` lookups
  matched nothing.
- The packaged VSIX no longer bundles local tool directories (`.codegraph`,
  `.superpowers`).
- Rebranded the extension package, commands, settings, and documentation for
  ModelScope.
- The China and Global providers now use VS Code's native Add Models API-key
  configuration flow.
- Removed OpenCode Go/Zen providers, Go usage tracking, usage dashboard,
  profiles, and vision-proxy configuration. (Inline completions were re-added
  in this release — see the entry under **Added**.)
- Model family and thinking-strategy detection now handles ModelScope model IDs
  with owner prefixes.
- ModelScope Magicube balance now refreshes shortly after each completed chat
  request (throttled to once per minute), so the status bar no longer lags
  behind the balance until the next five-minute timer.

### Security and privacy

- Magicube balance refresh uses only the ModelScope China balance endpoint.
- Removed OpenCode-specific request headers and project cache-key generation;
  requests no longer derive cache keys from the local username, host, or
  workspace path.

### Fixed

- Fixed ModelScope providers not being addable through VS Code's **Add Models**
  menu by removing the deprecated management-command override and contributing
  native API-key configuration schemas.
- Fixed the models.dev metadata lookup, which used the non-existent
  `modelscopecn`/`modelscopeglobal` provider keys instead of `modelscope`.
  ModelScope models still show the 262K default because models.dev does not
  describe any model in the current inference catalog.
