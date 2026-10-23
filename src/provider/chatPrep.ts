import * as vscode from "vscode";
import { HISTORY_TRIM_SAFETY_MARGIN_TOKENS, HISTORY_TRIM_TARGET_RATIO, MAX_HISTORY_IMAGES_KEPT, secretKeyFor } from "../config";
import type { ConfiguredLanguageModelResponseOptions } from "./definitions";
import type { TransportRequestSummary } from "../core/transport";
import { resolveModelRouting } from "../core/routing";
import { extractThinkingOverride, resolveThinkingConfig, thinkingProviderFor } from "../thinking";
import type { CachedModelMetadataSnapshot, ResolvedModelMetadata } from "../models/metadata";
import { resolveResponseApiKey } from "../apiKeyResolution";
import { convertMessage, normalizeMessages, trimOldImagesFromHistoryInPlace } from "./messages";
import { historyByteCapForBudget, trimOldMessagesToFitContext } from "./historyTrim";
import { getConfiguredApiKey, getRequestModelConfiguration, getSettings, modelLimits, resolveRawModelId } from "./settings";
import { messagesHaveImages } from "../request/builders";
import { buildModelScopeRequestHeaders } from "../request/headers";
import type { ApiSettings } from "../request/types";
import type { ModelScopeBaseVendor } from "../providerTypes";
import type { ModelScopeModel, ProviderDefinition } from "./definitions";
import type { TransportSummaryLog } from "./transportLog";

/**
 * Everything the chat-response dispatch needs, resolved once per request:
 * message conversion, history trimming, budgets, thinking payload and headers.
 * Pure with respect to the provider class — all state
 * arrives via {@link ChatPrepDeps}.
 */
export interface ChatPrepDeps {
  context: vscode.ExtensionContext;
  baseVendor: ModelScopeBaseVendor;
  definition: ProviderDefinition;
  transportLog: TransportSummaryLog;
  recordModelScopeRequest?(summary: TransportRequestSummary): void;
  log(message: string): void;
  getMetadataSnapshot(): Promise<CachedModelMetadataSnapshot>;
  resolveModelMetadata(modelId: string, snapshot: CachedModelMetadataSnapshot): ResolvedModelMetadata;
  reasoningContentByToolCallId: Map<string, string>;
  apiKeysByModelId: Map<string, string>;
}

export async function prepareChatRequest(
  deps: ChatPrepDeps,
  model: ModelScopeModel,
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  _token: vscode.CancellationToken,
): Promise<{
  apiKey: string;
  rawModelId: string;
  apiMessages: ReturnType<typeof normalizeMessages>;
  settings: ApiSettings;
  requestOverride: ReturnType<typeof getRequestModelConfiguration>;
  resolvedThinking: ReturnType<typeof resolveThinkingConfig>;
  metadata: ResolvedModelMetadata;
  routing: ReturnType<typeof resolveModelRouting>;
  promptTokens: number;
  limits: ReturnType<typeof modelLimits>;
  thinkingPayload: unknown;
  requestHeaders: Record<string, string>;
  onTransportSummary: (summary: TransportRequestSummary) => void;
}> {
  // VS Code can invoke a cached selected model immediately after the
  // extension host restarts, before model discovery repopulates the in-memory
  // ID map. Keep SecretStorage as the cold-start fallback for that request.
  const apiKey = resolveResponseApiKey(
    getConfiguredApiKey(options as ConfiguredLanguageModelResponseOptions),
    deps.apiKeysByModelId.get(model.id),
    await deps.context.secrets.get(secretKeyFor(deps.baseVendor)),
  );

  if (!apiKey) {
    throw new Error(
      `${deps.definition.displayName} API key is required. Use the ${deps.definition.displayName} gear icon in Language Models to configure it, then reload the window.`,
    );
  }

  const rawModelId = model.rawModelId ?? resolveRawModelId(model.id);
  const convertedMessages = await Promise.all(
    messages.map((message) => convertMessage(message, deps.reasoningContentByToolCallId, rawModelId)),
  );
  const normalizedImageCount = convertedMessages.map((result) => result.normalizedImageCount).reduce((total, count) => total + count, 0);
  if (normalizedImageCount > 0) {
    deps.log(`[vision] Normalized ${String(normalizedImageCount)} image attachment(s) to provider-safe dimensions/encoding.`);
  }

  // Flatten the converted messages, tracking which original message produced
  // each apiMessage. The vision proxy returns per-message descriptions keyed
  // by the original message index, so this mapping lets us apply the correct
  // description to the right apiMessage (convertMessage can emit several
  // messages per input — e.g. tool results — which shifts indices).
  const flatMessages = convertedMessages.flatMap((result) => result.messages);

  const baseSettings = getSettings();
  const requestOverride = getRequestModelConfiguration(options);
  // Extract the context-size tier selected by the user (if any)
  const contextSizeOverride = typeof requestOverride?.contextSize === "number" ? requestOverride.contextSize : undefined;
  const metadataSnapshot = await deps.getMetadataSnapshot();
  const metadata = deps.resolveModelMetadata(rawModelId, metadataSnapshot);
  // Resolve the effective thinking config: VS Code's per-model configuration
  // (options.modelConfiguration, chatLanguageModels.json) is the SINGLE
  // authority for per-model thinking; the workspace setting is the default;
  // THINKING_DEFAULTS is the final fallback. No extension-side persisted
  // shadow state (removed — it fought the VS Code authority and could pin a
  // stale non-off value over the user's Off).
  //
  // `metadata` is REQUIRED here, not optional: the generic (no-known-family)
  // strategy decides whether a model takes a reasoning effort purely from
  // `metadata.reasoning`, so resolving without it silently discards the user's
  // per-model pick and falls back to the workspace setting.
  const resolvedThinking = resolveThinkingConfig({
    modelId: rawModelId,
    metadata,
    workspace: baseSettings.thinking,
    modelConfiguration: requestOverride,
  });
  const settings: ApiSettings = {
    ...baseSettings,
    thinking: resolvedThinking.settings,
  };
  const routing = resolveModelRouting(rawModelId, deps.definition);

  // `hasImageInput` is computed from the flattened (pre-normalize) messages:
  // normalization never creates or drops image parts, so this matches the
  // previous `messagesHaveImages(apiMessages)` result.
  const hasImageInput = messagesHaveImages(flatMessages);
  const apiMessages = normalizeMessages(flatMessages);

  // Trim old images from conversation history to bound cumulative payload
  // weight. MCP screenshot loops can accumulate multi-MB base64 data URIs in
  // history and trigger upstream `400 Upstream request failed` rejections (issue #38
  // follow-up, documented in docs/issues/34 line 264+). Only the most recent
  // MAX_HISTORY_IMAGES_KEPT images are kept; older ones are replaced with a
  // short placeholder text note so the model retains conversation structure
  // without incurring the payload cost.
  //
  // Applied BEFORE promptTokens estimation so the output budget reflects the
  // trimmed payload.
  const trimmedCount = trimOldImagesFromHistoryInPlace(apiMessages);
  if (trimmedCount > 0) {
    deps.log(
      `[history-trim] Replaced ${String(trimmedCount)} old image(s) with placeholder text to bound payload (kept most recent ${String(MAX_HISTORY_IMAGES_KEPT)}).`,
    );
  }

  // Bound the text conversation history to the model's input context window.
  // Long multi-turn conversations (or repeated turns without Compact
  // Conversation) can exceed the context limit, causing the upstream to reject
  // the oversized request (HTTP 400/503) or return an empty stream — surfaced
  // by VS Code as "No response came" / "Sorry, no response was returned" — and
  // a huge payload also makes the upstream hang (10-minute request timeout)
  // and slows the extension session. Drop the oldest messages (preserving the
  // anchor and the current prompt, never splitting a tool-call group) until
  // the payload fits BOTH the input token budget AND a hard byte ceiling.
  const effectiveContextWindow = contextSizeOverride ?? metadata.contextWindow;
  const outputReserve = Math.min(metadata.maxOutputTokens, effectiveContextWindow);
  // Stay safely below the window: the upstream rejects near the full limit
  // (the reporter saw failures at ~70% context), so cap at a target ratio and
  // also leave room for the output reserve + a fixed safety margin.
  const ratioBudget = Math.floor(effectiveContextWindow * HISTORY_TRIM_TARGET_RATIO);
  const maxBudget = Math.max(1, effectiveContextWindow - outputReserve - HISTORY_TRIM_SAFETY_MARGIN_TOKENS);
  const inputBudget = Math.min(ratioBudget, maxBudget);
  const historyMaxBytes = historyByteCapForBudget(inputBudget);
  const historyTrim = trimOldMessagesToFitContext(apiMessages, inputBudget, historyMaxBytes, options.tools);
  if (historyTrim.removed > 0) {
    deps.log(
      `[history-trim] Dropped ${String(historyTrim.removed)} old message(s) to fit context window (budget=${String(inputBudget)} tokens, maxBytes=${String(historyMaxBytes)}); estimated payload now ~${String(historyTrim.finalTokens)} tokens / ${String(historyTrim.finalBytes)} bytes.`,
    );
  }

  // Use the estimate computed during trimming (no second full re-estimation)
  // so the output budget reflects the payload that is actually sent upstream.
  const promptTokens = historyTrim.finalTokens;
  const limits = modelLimits(metadata, settings, contextSizeOverride, promptTokens);

  const thinkingPayload = thinkingProviderFor(rawModelId, metadata).buildPayload(settings.thinking, {
    hasImageInput: hasImageInput && metadata.supportsVision,
    endpoint:
      routing.endpointKind === "messages"
        ? "messages"
        : routing.endpointKind === "responses"
          ? "responses"
          : routing.endpointKind === "google"
            ? "google"
            : "chat",
  });
  const requestHeaders = buildModelScopeRequestHeaders();
  // NOTE: no output channel is created here. Channels are process-wide singletons
  // (vscode.window.createOutputChannel registers a new Output-tab entry every
  // call), so creating one per request flooded the Output tab with dozens of
  // duplicate "ModelScope" channels (issue #220). Transports receive the
  // provider's shared channel instead.
  const onTransportSummary = (summary: TransportRequestSummary) => {
    deps.transportLog.record(summary, routing.endpointKind, metadata.source, options.requestInitiator);
    deps.recordModelScopeRequest?.(summary);
  };

  deps.log(
    `Request: initiator=${options.requestInitiator} model=${model.id} rawModel=${rawModelId} endpoint=${routing.endpointKind} metadataSource=${metadata.source} messages=${String(apiMessages.length)} promptEstimate=${String(promptTokens)} maxOutputTokens=${String(limits.maxOutputTokens)} modelConfiguration=${JSON.stringify(extractThinkingOverride(requestOverride))} thinkingSource=${resolvedThinking.source} thinking=${JSON.stringify(settings.thinking)} thinkingPayload=${JSON.stringify(thinkingPayload)}`,
  );
  if (settings.debugReasoning) {
    deps.log("Reasoning debug is enabled. Provider reasoning_content will be written to this output channel when available.");
  }
  return {
    apiKey,
    rawModelId,
    apiMessages,
    settings,
    requestOverride,
    resolvedThinking,
    metadata,
    routing,
    promptTokens,
    limits,
    thinkingPayload,
    requestHeaders,
    onTransportSummary,
  };
}
