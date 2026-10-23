# ModelScope Provider Setup Design

**Status:** Proposed
**Date:** 2026-10-23

## Intent

Make ModelScope China and Global usable after installation without requiring
users to discover an undocumented VS Code BYOK flow, and make the normal and
Agents provider entries distinguishable.

## Goals

- Add provider-specific set/update and remove API key actions to the existing
  ModelScope management menu.
- Store keys only in VS Code SecretStorage under the existing independent
  China and Global keys; never display or log their values.
- Refresh the provider model list after saving a key and refresh the Magicube
  balance after saving the China key.
- Label Agents providers explicitly so they are distinguishable from normal
  providers in the Add Models picker.

## Non-goals

- No sign-in flow or use of credentials from chat, environment files, or other
  extensions.
- No change to the read-only Magicube endpoint or to the separate CN/Global
  credential model.
- Do not remove Agents-window support.

## Approaches

1. **Selected:** Add explicit Set/Update API Key and Remove API Key actions to
   the existing provider management menu, persisting through SecretStorage;
   label Agents variants with `(Agents)`. This makes the flow discoverable,
   works with the existing storage and balance reader, and preserves Agents
   support.
2. Rely on VS Code's native BYOK configuration and adjust picker entries.
   This depends on VS Code's provider configuration UI and requires careful
   synchronization to extension SecretStorage before balance can be fetched,
   so it is easier to misconfigure and less direct for this extension.

## Implementation notes

- Keep key prompts masked and allow cancellation without changing storage.
- Saving a non-empty key updates only the selected region and triggers that
  provider's model refresh; the China key also triggers a balance refresh.
- Removing a key clears only the selected region and refreshes the model list
  without making a network request that could be mistaken for success.
- Add focused tests for menu actions, secret isolation, and unique display
  names; update the README's setup guidance.
- Validate with the full lint/test gate, package and install the VSIX, then
  verify VS Code activation and the no-key/key management paths without
  exposing the credential.
