**Status:** 🟢 Active

# ModelScope Add Models Does Not Create a Provider Group

**Topic:** provider / vscode / byok
**Updated:** 2026-10-23
**Tags:** #provider #vscode #byok #models

---

## Problem

Selecting ModelScope China under **Manage Language Models → Add Models** did
nothing: no configuration prompt appeared, and after the prompt was restored the
provider still could not be selected in Chat.

## Root Causes

Two independent defects stacked on top of each other.

1. **Deprecated override short-circuited the native flow.** All four
   contributed providers declared `managementCommand` without a provider
   `configuration` schema. VS Code resolves the provider's management command
   instead of creating a BYOK group, so clicking the entry produced no prompt.
2. **The provider was disabled in user settings.** `modelscope.enabled` was
   `false`, and every provider contribution carries
   `when: config.modelscope.enabled`. VS Code therefore hid the provider from
   the model surfaces even after a key was saved.

## Solution

- Removed `managementCommand` from all ModelScope provider contributions.
- Added a secret `apiKey` configuration schema to the China and Global base
  providers. These are the providers users add for normal Chat.
- Left Agents variants without a configuration schema; they reuse the saved key
  for their region and are not listed as separate **Add Models** choices.
- Documented that a disabled `modelscope.enabled` setting hides the providers,
  so troubleshooting starts by checking that setting before the manifest.

## Files Changed

- `package.json`
- `src/test/packageContributions.test.ts`
- `README.md`, `CHANGELOG.md`, `ARCHITECTURE-MAP.md`

## Verification

- `npx tsx --test src/test/packageContributions.test.ts` — failed before the
  manifest change, passed after.
- `npm run lint` — passed.
- Confirmed in VS Code 1.143.1: after reinstalling the VSIX, reloading the
  window and setting `modelscope.enabled` to `true`, **Add Models → ModelScope
  China** prompts for a key and the model becomes selectable in Chat as
  `modelscopecn:<model>::<revision>`.

## Prevention Notes

- Do not re-add `managementCommand` to a provider that has a `configuration`
  schema; the two mechanisms conflict.
- Manifest `when` clauses are gates on user-visible registration. When a
  provider "disappears", check the corresponding `modelscope.*` setting before
  assuming the contribution is broken.
