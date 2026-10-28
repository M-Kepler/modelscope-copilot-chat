/**
 * Inline-completion registration (issue #49).
 *
 * Registers ONE inline-completion provider. VS Code asks every registered
 * provider on every keystroke, so registering one per vendor would send the
 * same prompt to every region; instead the provider resolves the region per
 * request (first candidate with a stored key wins).
 *
 * Opt-in: the user must enable `modelscope.inlineSuggestions` (default false),
 * which needs a window reload; the model, debounce and max-token settings are
 * re-read on every request and need no reload.
 */

import * as vscode from "vscode";

import {
  CONFIG_SECTION,
  DEFAULT_INLINE_COMPLETION_MODEL,
  DEFAULT_INLINE_DEBOUNCE_MS,
  DEFAULT_INLINE_MAX_TOKENS,
  INLINE_DEBOUNCE_MS_SETTING,
  INLINE_MAX_TOKENS_SETTING,
  INLINE_SUGGESTIONS_MODEL_SETTING,
  INLINE_SUGGESTIONS_SETTING,
  secretKeyFor,
} from "../config";
import { logModelScope } from "../core/modelScopeOutput";
import { ChatCompletionsEngine } from "./engine";
import { createInlineCompletionProvider, type InlineCompletionTuning } from "./provider";
import { resolveBaseVendor } from "../providerTypes";
import type { ModelScopeBaseVendor, ModelScopeProviderVendor } from "../providerTypes";
import { MODELSCOPE_PROVIDERS } from "../provider/definitions";
import type { CompletionContext, CompletionEngine, CompletionResult } from "./types";

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

/** First candidate region that has a stored API key. */
async function resolveVendorApiKey(
  context: vscode.ExtensionContext,
  candidates: readonly ModelScopeBaseVendor[],
): Promise<{ vendor: ModelScopeBaseVendor; apiKey: string } | undefined> {
  for (const vendor of candidates) {
    const apiKey = await context.secrets.get(secretKeyFor(vendor));
    if (apiKey) {
      return { vendor, apiKey };
    }
  }
  return undefined;
}

/**
 * Register the inline-completion provider for the given vendors.
 *
 * @returns disposables; empty when inline suggestions are disabled.
 */
export function registerInlineCompletions(
  context: vscode.ExtensionContext,
  vendors: readonly ModelScopeProviderVendor[],
): vscode.Disposable[] {
  if (!getInlineConfig().enabled) {
    return [];
  }

  // Agent variants reuse their base region's URL and secret, so collapse them:
  // one region must never be queried twice for the same keystroke.
  const candidates: ModelScopeBaseVendor[] = [];
  for (const vendor of vendors) {
    const base = resolveBaseVendor(vendor);
    if (!candidates.includes(base)) {
      candidates.push(base);
    }
  }

  let warnedMissingKey = false;
  const engine: CompletionEngine = {
    id: "modelscope",
    async complete(ctx: CompletionContext, signal: AbortSignal): Promise<CompletionResult> {
      const resolved = await resolveVendorApiKey(context, candidates);
      if (!resolved) {
        if (!warnedMissingKey) {
          warnedMissingKey = true;
          logModelScope("[inline] skipped: no ModelScope API key stored. Add one from Language Models → Manage Models.");
        }
        return { text: undefined, durationMs: 0, error: "no-api-key" };
      }
      warnedMissingKey = false;

      const result = await new ChatCompletionsEngine({
        url: MODELSCOPE_PROVIDERS[resolved.vendor].chatCompletionsUrl,
        apiKey: resolved.apiKey,
        modelId: ctx.modelId,
        id: resolved.vendor,
      }).complete(ctx, signal);

      // Superseded/cancelled runs are the normal case while typing; logging
      // them would bury the runs that actually rendered ghost text.
      if (!signal.aborted) {
        const outcome = result.error ? `error=${result.error}` : `chars=${String(result.text?.length ?? 0)}`;
        logModelScope(
          `[inline] vendor=${resolved.vendor} model=${ctx.modelId} status=${String(result.status ?? "n/a")} durationMs=${String(result.durationMs)} ${outcome} maxTokens=${String(ctx.maxTokens)}`,
        );
      }
      return result;
    },
  };

  const provider = createInlineCompletionProvider({
    engine,
    getTuning: (): InlineCompletionTuning => {
      const config = getInlineConfig();
      return { modelId: config.modelId, maxTokens: config.maxTokens, debounceMs: config.debounceMs };
    },
  });

  return [
    vscode.languages.registerInlineCompletionItemProvider(PATTERN, provider),
    {
      dispose: (): void => {
        provider.dispose();
      },
    },
  ];
}

export {
  DEFAULT_INLINE_COMPLETION_MODEL,
  DEFAULT_INLINE_DEBOUNCE_MS,
  DEFAULT_INLINE_MAX_TOKENS,
  DEFAULT_INLINE_PREFIX_LINES,
  DEFAULT_INLINE_SUFFIX_CHARS,
} from "../config";
