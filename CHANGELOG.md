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

### Changed

- Rebranded the extension package, commands, settings, and documentation for
  ModelScope.
- Removed OpenCode Go/Zen providers, Go usage tracking, usage dashboard,
  profiles, inline completions, and vision-proxy configuration.
- Model family and thinking-strategy detection now handles ModelScope model IDs
  with owner prefixes.

### Security and privacy

- Magicube balance refresh uses only the ModelScope China balance endpoint.
- Removed OpenCode-specific request headers and project cache-key generation;
  requests no longer derive cache keys from the local username, host, or
  workspace path.
