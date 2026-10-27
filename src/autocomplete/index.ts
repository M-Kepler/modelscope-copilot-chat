/**
 * Inline-completion registration (issue #49).
 *
 * Registers an inline-completion provider (`vscode.languages.registerInlineCompletionItemProvider`)
 * for each ModelScope vendor. Opt-in: the user must enable `modelscope.inlineSuggestions`
 * (default false) and may override the default model via `modelscope.inlineCompletionModel`.
 */

import * as vscode from "vscode";

import {
  CONFIG_SECTION,
  DEFAULT_INLINE_COMPLETION_MODEL,
  DEFAULT_INLINE_DEBOUNCE_MS,
  DEFAULT_INLINE_MAX_TOKENS,
  DEFAULT_INLINE_PREFIX_LINES,
  DEFAULT_INLINE_SUFFIX_CHARS,
  INLINE_DEBOUNCE_MS_SETTING,
  INLINE_MAX_TOKENS_SETTING,
  INLINE_SUGGESTIONS_MODEL_SETTING,
  INLINE_SUGGESTIONS_SETTING,
  secretKeyFor,
} from "../config";
import { ChatCompletionsEngine } from "./engine";
import { createInlineCompletionProvider } from "./provider";
import { resolveBaseVendor } from "../providerTypes";
import type { ModelScopeProviderVendor } from "../providerTypes";
import { MODELSCOPE_PROVIDERS } from "../provider/definitions";

const PATTERN = "**";

function getInlineConfig(): {
  enabled: boolean;
  modelId: string;
  debounceMs: number;
  maxTokens: number;
} {
  const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return {
    enabled: configuration.get<boolean>(INLINE_SUGGESTIONS_SETTING, false),
    modelId: configuration.get<string>(INLINE_SUGGESTIONS_MODEL_SETTING, DEFAULT_INLINE_COMPLETION_MODEL),
    debounceMs: configuration.get<number>(INLINE_DEBOUNCE_MS_SETTING, DEFAULT_INLINE_DEBOUNCE_MS),
    maxTokens: configuration.get<number>(INLINE_MAX_TOKENS_SETTING, DEFAULT_INLINE_MAX_TOKENS),
  };
}

/**
 * Register inline-completion providers for the given vendors.
 *
 * @returns disposables; empty when inline suggestions are disabled.
 */
export function registerInlineCompletions(
  context: vscode.ExtensionContext,
  vendors: readonly ModelScopeProviderVendor[],
): vscode.Disposable[] {
  const config = getInlineConfig();
  if (!config.enabled) {
    return [];
  }

  const disposables: vscode.Disposable[] = [];
  for (const vendor of vendors) {
    const definition = MODELSCOPE_PROVIDERS[vendor];
    const secretKey = secretKeyFor(resolveBaseVendor(vendor));
    const engine = new ChatCompletionsEngine({
      baseUrl: definition.chatCompletionsUrl,
      apiKey: "", // resolved at request time below
      modelId: config.modelId,
      id: vendor,
      timeoutMs: 3_000,
    });
    const provider = createInlineCompletionProvider({
      engine: {
        id: engine.id,
        complete: async (ctx, signal) => {
          const apiKey = await context.secrets.get(secretKey);
          if (!apiKey) {
            return { text: undefined, durationMs: 0 };
          }
          engine.setApiKey(apiKey);
          return engine.complete(ctx, signal);
        },
      },
    });
    disposables.push(vscode.languages.registerInlineCompletionItemProvider(PATTERN, provider));
  }
  return disposables;
}

export {
  DEFAULT_INLINE_COMPLETION_MODEL,
  DEFAULT_INLINE_DEBOUNCE_MS,
  DEFAULT_INLINE_MAX_TOKENS,
  DEFAULT_INLINE_PREFIX_LINES,
  DEFAULT_INLINE_SUFFIX_CHARS,
};
