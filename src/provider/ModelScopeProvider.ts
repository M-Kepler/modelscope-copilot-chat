import * as vscode from "vscode";
import { ModelScopeRequestError } from "../errors";
import {
  hasExplicitModelLimits,
  normalizeLiveModelMetadata,
  resolveModelMetadata,
  type CachedModelMetadataSnapshot,
  type ModelMetadataFields,
  type ResolvedModelMetadata,
} from "../models/metadata";

import { thinkingFamily, thinkingProviderFor } from "../thinking";
import { buildModelScopeAuthHeaders } from "../modelScopeAuth";
import { streamAnthropicMessages as runStreamAnthropicMessages } from "../transports/anthropic";
import { streamChatCompletions as runStreamChatCompletions } from "../transports/chatCompletions";
import { streamGoogleGenerateContent as runStreamGoogleGenerateContent } from "../transports/google";
import { streamResponsesApi as runStreamResponsesApi } from "../transports/responses";

import { resolveBaseVendor, type ModelScopeBaseVendor } from "../providerTypes";

import { ModelListEntry, ModelScopeModel, ProviderDefinition } from "./definitions";
import {
  buildAnthropicMessagesRequestBody,
  buildChatCompletionsRequestBody,
  buildGoogleGenerateContentBody,
  buildResponsesRequestBody,
} from "../request/builders";
import { buildResponsesToolNameMap } from "../request/openai";

import { runtimeDiagnosticsLines } from "../runtimeDiagnostics";
import { estimateTokenCount } from "../tokenEstimate";
import { REASONING_CACHE_LIMIT, secretKeyFor } from "../config";

import { clearModelMetadataCache, getModelMetadata } from "../models/metadataFetcher";

import { estimateChatMessageTokenCount } from "./tokens";
import { modelLimits, resolveRawModelId, shouldHideDeprecatedModel } from "./settings";

import { getErrorMessage } from "../utils";
import { modelScopeOutputChannel } from "../core/modelScopeOutput";
import type { MagicubeBalanceResult } from "../modelscope/balance";

import { prepareChatRequest, type ChatPrepDeps } from "./chatPrep";
import { provideModelChatInformation, type ModelInfoDeps } from "./modelInfo";
import { ModelListFetcher } from "./modelList";
import { manageProvider, testConnection, type DialogDeps } from "./providerDialogs";
import { TransportSummaryLog } from "./transportLog";
import type { TransportRequestSummary } from "../core/transport";
export class ModelScopeProvider implements vscode.LanguageModelChatProvider<ModelScopeModel> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;

  /** Trigger a model-information refresh. */
  notifyModelInfoChanged(): void {
    this.changeEmitter.fire();
  }
  private readonly apiKeysByModelId = new Map<string, string>();
  private readonly refreshBalanceCallback: (() => Promise<MagicubeBalanceResult>) | undefined;

  /**
   * globalState key tracking whether this vendor has a configured BYOK group
   * (issue #106). Set when a configured-group call is served; read by the
   * groupless call to decide whether to stay silent. Scoped per vendor so the
   * China and Global configuration groups remain separate.
   */
  private get byokGroupStateKey(): string {
    return `modelscope.byokGroup.v1.${this.definition.vendor}`;
  }

  private hasByokGroupConfigured(): boolean {
    return this.context.globalState.get<boolean>(this.byokGroupStateKey, false);
  }

  private async markByokGroupConfigured(): Promise<void> {
    await this.context.globalState.update(this.byokGroupStateKey, true);
  }
  /** Capped to prevent unbounded growth across long sessions. */
  private readonly reasoningContentByToolCallId = new Map<string, string>();
  private readonly liveModelMetadataById = new Map<string, ModelMetadataFields>();

  /**
   * Cached snapshot of the most recent successful model-list fetch for this
   * provider's base vendor. Persisted to globalState so it survives window
   * reloads and can cover transient network failures at startup (issue #78).
   */
  /** Resolves agent-host variants to their base vendor for metadata/routing. */
  private get baseVendor(): ModelScopeBaseVendor {
    return resolveBaseVendor(this.definition.vendor);
  }

  /** Store reasoning content with a cap to prevent unbounded memory growth. */
  private storeReasoningContent(toolCallIds: string[], reasoningContent: string): void {
    for (const toolCallId of toolCallIds) {
      this.reasoningContentByToolCallId.set(toolCallId, reasoningContent);
    }
    // Evict oldest entries if the cache exceeds the limit.
    if (this.reasoningContentByToolCallId.size > REASONING_CACHE_LIMIT) {
      const excess = this.reasoningContentByToolCallId.size - REASONING_CACHE_LIMIT;
      const keys = this.reasoningContentByToolCallId.keys();
      for (let i = 0; i < excess; i++) {
        const key = keys.next().value;
        if (key) this.reasoningContentByToolCallId.delete(key);
      }
    }
  }

  private readonly transportLog: TransportSummaryLog;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly definition: ProviderDefinition,
    private readonly recordModelScopeRequest?: (summary: TransportRequestSummary) => void,
    refreshBalance?: () => Promise<MagicubeBalanceResult>,
  ) {
    this.refreshBalanceCallback = refreshBalance;
    this.transportLog = new TransportSummaryLog(context, definition.vendor);
    this.transportLog.restore();
  }

  private getOutputChannel(): vscode.OutputChannel {
    return modelScopeOutputChannel(this.context);
  }

  private authHeaders(_endpointKind: "messages" | "responses" | "google" | "chat-completions", apiKey: string): Record<string, string> {
    return buildModelScopeAuthHeaders("chat-completions", apiKey);
  }

  private log(message: string): void {
    this.getOutputChannel().appendLine(`[${new Date().toISOString()}] ${message}`);
  }

  private async getMetadataSnapshot(): Promise<CachedModelMetadataSnapshot> {
    return getModelMetadata(this.context, this.getOutputChannel());
  }

  private resolveModelMetadata(modelId: string, snapshot: CachedModelMetadataSnapshot): ResolvedModelMetadata {
    return resolveModelMetadata(modelId, this.baseVendor, snapshot, this.liveModelMetadataById);
  }

  private replaceLiveModelMetadata(entries: ModelListEntry[] | undefined): void {
    this.liveModelMetadataById.clear();
    for (const entry of entries ?? []) {
      if (typeof entry.id !== "string" || !entry.id) {
        continue;
      }
      const metadata = normalizeLiveModelMetadata(entry);
      if (metadata) {
        this.liveModelMetadataById.set(entry.id, metadata);
      }
    }
  }

  private async refreshMetadataAndModels(): Promise<void> {
    await clearModelMetadataCache(this.context);
    // Bypass the cache-first short-circuit so "Refresh Models" always
    // performs a real upstream fetch (issue #222).
    this.fetcher.invalidate();
    // Pass the stored API key so the gateway sees the authenticated
    // (per-key) model list, not the anonymous default.
    const apiKey = await this.context.secrets.get(secretKeyFor(this.baseVendor));
    await this.fetchModels(apiKey);
  }

  /** Refresh the provider model list and notify VS Code. */
  async refreshModels(): Promise<void> {
    const apiKey = await this.context.secrets.get(secretKeyFor(this.baseVendor));
    if (!apiKey) {
      vscode.window.showErrorMessage(
        `${this.definition.displayName}: No API key configured. Add the provider via Manage Language Models ("+ Add Models" → ${this.definition.displayName}) first.`,
      );
      return;
    }
    await this.refreshMetadataAndModels();
    this.changeEmitter.fire();
    vscode.window.showInformationMessage(`${this.definition.displayName} models refreshed.`);
  }

  async manage(): Promise<void> {
    await manageProvider(this.dialogDeps());
  }

  async testConnection(): Promise<void> {
    await testConnection(this.dialogDeps());
  }

  /** The instance-state view the extracted dialog flows need. */
  private dialogDeps(): DialogDeps {
    return {
      context: this.context,
      baseVendor: this.baseVendor,
      definition: this.definition,
      log: (message) => {
        this.log(message);
      },
      refreshModels: () => this.refreshModels(),
      refreshBalance: () => {
        if (!this.refreshBalanceCallback) {
          throw new Error("Magicube balance refresh is unavailable.");
        }
        return this.refreshBalanceCallback();
      },
      onApiKeyRemoved: () => {
        this.apiKeysByModelId.clear();
        this.changeEmitter.fire();
      },
      showDiagnostics: () => this.showDiagnostics(),
    };
  }

  async showDiagnostics(): Promise<void> {
    let models: readonly vscode.LanguageModelChat[] = [];
    let modelSelectionError: string | undefined;
    try {
      models = await vscode.lm.selectChatModels({ vendor: this.definition.vendor });
    } catch (error) {
      modelSelectionError = getErrorMessage(error);
    }

    const hasStoredApiKey = Boolean(await this.context.secrets.get(secretKeyFor(this.baseVendor)));
    const metadataSnapshot = await this.getMetadataSnapshot();
    const lines = models.map((model) => {
      const rawModelId = resolveRawModelId(model.id);
      const metadata = this.resolveModelMetadata(rawModelId, metadataSnapshot);
      const limits = modelLimits(metadata);
      return [
        `- ${rawModelId}`,
        `  rawModelId: ${rawModelId}`,
        `  name: ${model.name}`,
        `  family: ${model.family}`,
        `  vendor: ${model.vendor}`,
        `  version: ${model.version}`,
        `  maxInputTokens: ${String(model.maxInputTokens)}`,
        `  advertisedMaxOutputTokens: ${String(limits.advertisedMaxOutputTokens)}`,
        `  advertisedContextWindow: ${String(limits.advertisedContextWindow)}`,
        `  apiMaxOutputTokens: ${String(limits.maxOutputTokens)}`,
        `  metadataSource: ${metadata.source}`,
        `  supportsVision: ${String(metadata.supportsVision)}`,
        `  status: ${metadata.status ?? "active"}`,
        `  thinkingFamily: ${thinkingFamily(rawModelId) ?? "none"}`,
        `  configurationSchema: ${JSON.stringify((model as unknown as { configurationSchema?: unknown }).configurationSchema ?? null)}`,
        ...(hasExplicitModelLimits(rawModelId, this.baseVendor) ? [] : ["  limits: using bundled fallback"]),
      ].join("\n");
    });

    const content = [
      `# ${this.definition.displayName} Diagnostics`,
      "",
      "## Runtime",
      "",
      ...runtimeDiagnosticsLines(this.context),
      `- credentialInSecretStorage: ${String(hasStoredApiKey)}`,
      `- modelSelectionError: ${modelSelectionError ?? "none"}`,
      "",
      "## Recent Requests",
      "",
      ...this.transportLog.diagnosticLines(),
      `## Models`,
      "",
      `Models visible through vscode.lm.selectChatModels({ vendor: "${this.definition.vendor}" }): ${String(models.length)}`,
      "",
      ...lines,
    ].join("\n");

    const doc = await vscode.workspace.openTextDocument({ content, language: "markdown" });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
  }

  async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken,
  ): Promise<ModelScopeModel[]> {
    return provideModelChatInformation(this.modelInfoDeps(), options, token);
  }

  /** The instance-state view {@link provideModelChatInformation} needs. */
  private modelInfoDeps(): ModelInfoDeps {
    return {
      context: this.context,
      baseVendor: this.baseVendor,
      definition: this.definition,
      log: (message) => {
        this.log(message);
      },
      hasByokGroupConfigured: () => this.hasByokGroupConfigured(),
      markByokGroupConfigured: () => this.markByokGroupConfigured(),
      fetchModels: (apiKey, token) => this.fetchModels(apiKey, token),
      getMetadataSnapshot: () => this.getMetadataSnapshot(),
      resolveModelMetadata: (modelId, snapshot) => this.resolveModelMetadata(modelId, snapshot),
      apiKeysByModelId: this.apiKeysByModelId,
    };
  }

  /** The instance-state view {@link prepareChatRequest} needs. */
  private chatPrepDeps(): ChatPrepDeps {
    return {
      context: this.context,
      baseVendor: this.baseVendor,
      definition: this.definition,
      transportLog: this.transportLog,
      recordModelScopeRequest: this.recordModelScopeRequest,
      log: (message) => {
        this.log(message);
      },
      getMetadataSnapshot: () => this.getMetadataSnapshot(),
      resolveModelMetadata: (modelId, snapshot) => this.resolveModelMetadata(modelId, snapshot),
      reasoningContentByToolCallId: this.reasoningContentByToolCallId,
      apiKeysByModelId: this.apiKeysByModelId,
    };
  }

  async provideLanguageModelChatResponse(
    model: ModelScopeModel,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const prepared = await prepareChatRequest(this.chatPrepDeps(), model, messages, options, token);
    const {
      apiKey,
      rawModelId,
      apiMessages,
      settings,
      metadata,
      routing,

      limits,

      requestHeaders,
      onTransportSummary,
    } = prepared;

    // ISSUE #220: one shared channel for the provider's lifetime — the
    // prepared-request object no longer creates a fresh channel per request.
    const outputChannel = this.getOutputChannel();

    try {
      const contextWindowOutputBuffer = limits.advertisedMaxOutputTokens;
      // Subagent/tool-call requests always have tools present. Force
      // think-tag stripping for these requests to prevent <think> tags
      // in content from rendering as blank code blocks in the chat UI.
      const isToolCallRequest = Array.isArray(options.tools) && options.tools.length > 0;
      const forceStripThinkTags = isToolCallRequest || undefined;

      if (routing.endpointKind === "messages") {
        await runStreamAnthropicMessages({
          url: routing.endpointUrl,
          providerDisplayName: this.definition.displayName,
          apiKey,
          modelId: rawModelId,
          body: buildAnthropicMessagesRequestBody(rawModelId, apiMessages, options, settings, metadata, limits),
          requestHeaders,
          progress,
          token,
          output: outputChannel,
          debugReasoning: settings.debugReasoning,
          requestTimeoutMs: settings.requestTimeoutMs,
          streamIdleTimeoutMs: settings.streamIdleTimeoutMs,
          contextWindowOutputBuffer,
          authHeaders: this.authHeaders("messages", apiKey),
          onTransportSummary,
          stripThinkTags: settings.stripThinkTags,
          forceStripThinkTags,
        });
        return;
      }

      if (routing.endpointKind === "responses") {
        await runStreamResponsesApi({
          url: routing.endpointUrl,
          providerDisplayName: this.definition.displayName,
          apiKey,
          modelId: rawModelId,
          body: buildResponsesRequestBody(rawModelId, apiMessages, options, settings, metadata, limits),
          authHeaders: this.authHeaders("responses", apiKey),
          requestHeaders,
          progress,
          token,
          output: outputChannel,
          debugReasoning: settings.debugReasoning,
          requestTimeoutMs: settings.requestTimeoutMs,
          streamIdleTimeoutMs: settings.streamIdleTimeoutMs,
          contextWindowOutputBuffer,
          onTransportSummary,
          stripThinkTags: settings.stripThinkTags,
          forceStripThinkTags,
          toolNameMap: buildResponsesToolNameMap(options.tools, rawModelId),
          onReasoningContent: (toolCallIds, reasoningContent) => {
            this.storeReasoningContent(toolCallIds, reasoningContent);
          },
        });
        this.log(`Request completed: model=${model.id}`);
        return;
      }

      if (routing.endpointKind === "google") {
        await runStreamGoogleGenerateContent({
          url: routing.endpointUrl,
          providerDisplayName: this.definition.displayName,
          apiKey,
          modelId: rawModelId,
          body: buildGoogleGenerateContentBody(rawModelId, apiMessages, options, settings, metadata, limits),
          requestHeaders,
          progress,
          token,
          output: outputChannel,
          debugReasoning: settings.debugReasoning,
          requestTimeoutMs: settings.requestTimeoutMs,
          streamIdleTimeoutMs: settings.streamIdleTimeoutMs,
          contextWindowOutputBuffer,
          authHeaders: this.authHeaders("google", apiKey),
          onTransportSummary,
          stripThinkTags: settings.stripThinkTags,
          forceStripThinkTags,
          onReasoningContent: (toolCallIds, reasoningContent) => {
            this.storeReasoningContent(toolCallIds, reasoningContent);
          },
        });
        this.log(`Request completed: model=${model.id}`);
        return;
      }

      await runStreamChatCompletions({
        url: routing.endpointUrl,
        providerDisplayName: this.definition.displayName,
        apiKey,
        modelId: rawModelId,
        body: buildChatCompletionsRequestBody(rawModelId, apiMessages, options, settings, metadata, limits),
        authHeaders: this.authHeaders("chat-completions", apiKey),
        requestHeaders,
        progress,
        token,
        output: outputChannel,
        debugReasoning: settings.debugReasoning,
        requestTimeoutMs: settings.requestTimeoutMs,
        streamIdleTimeoutMs: settings.streamIdleTimeoutMs,
        contextWindowOutputBuffer,
        onTransportSummary,
        stripThinkTags: settings.stripThinkTags,
        forceStripThinkTags,
        treatReasoningAsContent: thinkingProviderFor(rawModelId).treatReasoningAsContent(routing.endpointUrl, settings.thinking),
        onReasoningContent: (toolCallIds, reasoningContent) => {
          this.storeReasoningContent(toolCallIds, reasoningContent);
        },
      });
      this.log(`Request completed: model=${model.id}`);
    } catch (error) {
      const message = getErrorMessage(error);
      this.log(`ERROR model=${model.id}: ${message}`);
      if (error instanceof ModelScopeRequestError) {
        vscode.window.showErrorMessage(error.userMessage);
      }
      throw error;
    }
  }

  provideTokenCount(
    _model: ModelScopeModel,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    return Promise.resolve(typeof text === "string" ? estimateTokenCount(text) : estimateChatMessageTokenCount(text));
  }

  /**
   * Fetch the live model list from ModelScope.
   *
   * CONTRACT:
   * - Resilient to transient network failures (DNS, TCP reset, connect
   *   timeout, 5xx, 429): retries up to {@link MODEL_LIST_FETCH_MAX_RETRIES}
   *   times with exponential backoff. See {@link isTransientFetchError}.
   * - Hard timeout of {@link MODEL_LIST_FETCH_TIMEOUT_MS} per attempt —
   *   undici's default 300s `headersTimeout` is far too long for the picker
   *   (issue #78: picker appeared stuck for minutes on hung TCP).
   * - Sends `User-Agent` ({@link getUserAgent}) so strict gateways don't
   *   silently drop the request.
   * - On final failure, prefers the last successful snapshot (cached in
   *   globalState, TTL {@link MODEL_LIST_CACHE_TTL_MS}) over the bundled
   *   `fallbackModels`, so transient failures don't make the picker "flash
   *   then disappear" when VS Code 1.129's agent host re-resolves frequently.
   * - Respects the VS Code CancellationToken: bails early on abort, never
   *   retries an aborted request.
   */
  private modelListFetcher: ModelListFetcher | undefined;

  /** Lazy — created on first use so `baseVendor` is available. */
  private get fetcher(): ModelListFetcher {
    if (!this.modelListFetcher) {
      this.modelListFetcher = new ModelListFetcher({
        context: this.context,
        definition: this.definition,
        log: (message) => {
          this.log(message);
        },
        replaceLiveModelMetadata: (models) => {
          this.replaceLiveModelMetadata(models);
        },
        filterAvailableModels: (ids, liveIds) => this.filterAvailableModels(ids, liveIds),
      });
    }
    return this.modelListFetcher;
  }

  private async fetchModels(apiKey?: string, token?: vscode.CancellationToken): Promise<string[]> {
    return this.fetcher.fetch(apiKey, token);
  }

  private async filterAvailableModels(modelIds: string[], liveModelIds?: ReadonlySet<string>): Promise<string[]> {
    const uniqueModelIds = [...new Set(modelIds)];

    try {
      const metadataSnapshot = await this.getMetadataSnapshot();
      const filteredModelIds = uniqueModelIds.filter(
        (modelId) =>
          !shouldHideDeprecatedModel(modelId, this.definition.vendor, metadataSnapshot, liveModelIds) &&
          (this.definition.filterModel?.(modelId) ?? true),
      );

      const removedModelIds = uniqueModelIds.filter((modelId) => !filteredModelIds.includes(modelId));
      if (removedModelIds.length) {
        this.log(`Filtered unavailable/deprecated models: ${removedModelIds.join(", ")}`);
      }

      return filteredModelIds;
    } catch (error) {
      const message = getErrorMessage(error);
      this.log(`Could not fetch model status metadata from models.dev. Applying local unavailable model filter only. ${message}`);
      return uniqueModelIds.filter((modelId) => this.definition.filterModel?.(modelId) ?? true);
    }
  }
}
