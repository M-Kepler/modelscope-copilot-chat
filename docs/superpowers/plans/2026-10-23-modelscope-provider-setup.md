# ModelScope Provider Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users set or remove each region's API key from its provider management menu and distinguish Agents entries in VS Code's Add Models list.

**Architecture:** Extend the existing `manageProvider` dialog flow to write region-scoped keys to VS Code SecretStorage, refresh the affected provider, and refresh China balance when relevant. Keep Agents vendors registered while labeling their manifest and runtime provider names with `(Agents)`.

**Tech Stack:** TypeScript, VS Code Extension API, Node.js built-in test runner, VS Code SecretStorage.

**Spec:** `docs/superpowers/specs/2026-10-23-modelscope-provider-setup-design.md`

## Global Constraints

- Store China and Global keys independently in existing SecretStorage entries `modelscope.cn.apiKey` and `modelscope.global.apiKey`.
- Never display, log, migrate, or send credentials from chat or environment files.
- Preserve read-only Magicube balance behavior and Agents-window support.
- Do not add dependencies.

## Review Focus

- Cancelled or whitespace-only key input must leave the stored key unchanged; test in Task 1.
- Updating one region must not affect the other region's key; test in Task 1.
- Removing a key must clear runtime cached keys and trigger model-info refresh without a model-list HTTP request; test in Task 1.
- Saving the China key must refresh balance, while saving/removing the Global key must not; test in Task 1.
- Normal and Agents provider labels must be unique in both VS Code contributions and runtime model details; test in Task 2.

---

### Task 1: Provider API Key Management

**Files:**

- Modify: `src/provider/providerDialogs.ts`
- Modify: `src/provider/ModelScopeProvider.ts`
- Modify: `src/extension.ts`
- Create: `src/test/modelScopeProviderDialogs.test.ts`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

**Interfaces:**

- `DialogDeps` receives a `refreshBalance(): Promise<MagicubeBalanceResult>` callback and an `onApiKeyRemoved(): void` callback.
- `ModelScopeProvider` supplies `refreshModels`, balance refresh, and a callback that clears `apiKeysByModelId` and fires the model-information change emitter.

- [ ] **Step 1: Write failing tests** for `manageProvider` that assert: a masked Set/Update API Key prompt stores a trimmed key under only the selected region's SecretStorage key; cancellation/blank input does not store; a saved China key refreshes models and balance; Global does not refresh China balance; confirmed removal deletes the selected key and invokes the cache-clear callback; declined removal preserves it.

- [ ] **Step 2: Run the focused test and verify it fails** because the manage menu currently has no key-entry or removal actions.

Run: `npm run compile && node --test --test-name-pattern="ModelScope provider key management" out/test/modelScopeProviderDialogs.test.js`
Expected: FAIL on missing menu actions/behavior.

- [ ] **Step 3: Implement key management** in `src/provider/providerDialogs.ts`: add Set/Update API Key and conditional Remove API Key menu items; collect the new value with `showInputBox({ password: true })`; ignore cancellation and blank input; store trimmed values via `secretKeyFor(baseVendor)`; on save refresh models and refresh balance only for China; on confirmed removal delete only that region's key and invoke `onApiKeyRemoved`, refreshing China balance without a network request.

- [ ] **Step 4: Wire callbacks and stale-key cleanup** in `src/provider/ModelScopeProvider.ts` and `src/extension.ts`. Clear `apiKeysByModelId` and fire `onDidChangeLanguageModelChatInformation` after removal. Preserve explicit errors from storage/refresh failures.

- [ ] **Step 5: Run the focused test and verify it passes.**

Run: `npm run compile && node --test --test-name-pattern="ModelScope provider key management" out/test/modelScopeProviderDialogs.test.js`
Expected: PASS, with cancellation, region isolation, removal, and region-specific refresh assertions.

- [ ] **Step 6: Update README setup guidance** to say users can configure keys from **ModelScope China: Manage** / **ModelScope Global: Manage**, and update the Unreleased changelog.

- [ ] **Step 7: Run validation for this task.**

Run: `npm run lint`
Expected: all seven repository checks pass.

### Task 2: Distinguishable Agents Provider Labels

**Files:**

- Modify: `src/provider/definitions.ts`
- Modify: `package.json`
- Modify: `src/test/packageContributions.test.ts`
- Modify: `src/test/modelScopeProvider.test.ts`

**Interfaces:**

- Keep the same four provider vendor IDs and management commands.
- Use the exact labels `ModelScope China (Agents)` and `ModelScope Global (Agents)` for Agent variants in both the manifest and runtime definitions.

- [ ] **Step 1: Write failing tests** asserting that all four contributed provider labels are unique, Agent contribution labels include `(Agents)`, and Agent runtime provider definitions use the matching labels.

- [ ] **Step 2: Run the focused tests and verify they fail** because normal and Agent labels currently match.

Run: `npm run compile && node --test --test-name-pattern="ModelScope package contributions|ModelScope provider definitions" out/test/packageContributions.test.js out/test/modelScopeProvider.test.js`
Expected: FAIL on duplicate labels.

- [ ] **Step 3: Update the Agent display names** in `src/provider/definitions.ts` and `package.json`, preserving vendor IDs and commands.

- [ ] **Step 4: Run the focused tests and verify they pass.**

Run: `npm run compile && node --test --test-name-pattern="ModelScope package contributions|ModelScope provider definitions" out/test/packageContributions.test.js out/test/modelScopeProvider.test.js`
Expected: PASS with four distinct provider labels and unchanged provider IDs.

- [ ] **Step 5: Run the complete validation and package the extension.**

Run: `npm run lint`
Expected: all seven repository checks pass.

Run: `npm run package`
Expected: `modelscope-copilot-chat-0.7.10.vsix` is produced successfully.

- [ ] **Step 6: Install the VSIX in VS Code and verify** that the Add Models list shows distinct normal/Agents entries and that provider management exposes the masked key actions; do not use any key supplied through chat or files.
