import * as vscode from "vscode";
import { FALLBACK_USER_AGENT } from "../config";
import type { ModelEndpointKind } from "../core/registry";
import type { ApiMessage } from "../request/types";
import {
  AGENT_MODELSCOPE_CN_VENDOR,
  AGENT_MODELSCOPE_GLOBAL_VENDOR,
  MODELSCOPE_CN_VENDOR,
  MODELSCOPE_GLOBAL_VENDOR,
  type ModelScopeBaseVendor,
  type ModelScopeProviderVendor,
} from "../providerTypes";

export interface ProviderDefinition<Vendor extends ModelScopeProviderVendor = ModelScopeProviderVendor> {
  vendor: Vendor;
  displayName: string;
  modelNamePrefix: string;
  modelsUrl: string;
  chatCompletionsUrl: string;
  messagesUrl: string;
  testModelId: string;
  fallbackModels: string[];
  filterModel?: (modelId: string) => boolean;
  isAgentVariant?: boolean;
  baseVendor?: ModelScopeBaseVendor;
}

export interface ModelScopeModel extends vscode.LanguageModelChatInformation {
  endpointKind: ModelEndpointKind;
  provider: ProviderDefinition;
  rawModelId?: string;
  isUserSelectable?: boolean;
  configurationSchema?: vscode.LanguageModelConfigurationSchema;
}

export interface ModelListEntry {
  id?: string;
  owned_by?: string;
  status?: string;
  deprecated?: boolean;
  limit?: {
    context?: number;
    output?: number;
  };
  context_window?: number;
  contextWindow?: number;
  max_output_tokens?: number;
  maxOutputTokens?: number;
  attachment?: boolean;
  image_input?: boolean;
  imageInput?: boolean;
  reasoning?: boolean;
  modalities?: {
    input?: string[];
    output?: string[];
  };
}

export interface ModelListResponse {
  data?: ModelListEntry[];
}

export interface ConvertedMessageResult {
  messages: ApiMessage[];
  normalizedImageCount: number;
}

export interface LanguageModelConfiguration {
  apiKey?: unknown;
}

export type ConfiguredLanguageModelInfoOptions = vscode.PrepareLanguageModelChatModelOptions & {
  configuration?: LanguageModelConfiguration;
};

export type ConfiguredLanguageModelResponseOptions = vscode.ProvideLanguageModelChatResponseOptions & {
  configuration?: LanguageModelConfiguration;
};

const FALLBACK_MODELS = [
  "Qwen/Qwen3-4B",
  "Qwen/Qwen3-8B",
  "Qwen/Qwen3-14B",
  "Qwen/Qwen3-32B",
  "Qwen/Qwen3-235B-A22B-Instruct-2507",
  "Qwen/Qwen3-Coder-30B-A3B-Instruct",
  "Qwen/Qwen3.5-27B",
  "deepseek-ai/DeepSeek-V3.2",
  "deepseek-ai/DeepSeek-V4-Flash",
  "ZhipuAI/GLM-5",
  "ZhipuAI/GLM-5.2",
  "MiniMax/MiniMax-M2.7",
  "MiniMax/MiniMax-M3",
  "moonshotai/Kimi-K2.5",
];

function createProviderDefinition(
  vendor: ModelScopeBaseVendor,
  displayName: string,
  host: "modelscope.cn" | "modelscope.ai",
): ProviderDefinition<ModelScopeBaseVendor> {
  const endpoint = `https://api-inference.${host}/v1`;
  return {
    vendor,
    displayName,
    modelNamePrefix: "",
    modelsUrl: `${endpoint}/models`,
    chatCompletionsUrl: `${endpoint}/chat/completions`,
    messagesUrl: `${endpoint}/chat/completions`,
    testModelId: "Qwen/Qwen3-8B",
    fallbackModels: [...FALLBACK_MODELS],
  };
}

const chinaProvider = createProviderDefinition(MODELSCOPE_CN_VENDOR, "ModelScope China", "modelscope.cn");
const globalProvider = createProviderDefinition(MODELSCOPE_GLOBAL_VENDOR, "ModelScope Global", "modelscope.ai");

function createAgentProvider(
  base: ProviderDefinition<ModelScopeBaseVendor>,
  vendor: typeof AGENT_MODELSCOPE_CN_VENDOR | typeof AGENT_MODELSCOPE_GLOBAL_VENDOR,
  displayName: string,
): ProviderDefinition<typeof AGENT_MODELSCOPE_CN_VENDOR | typeof AGENT_MODELSCOPE_GLOBAL_VENDOR> {
  return {
    ...base,
    vendor,
    displayName,
    isAgentVariant: true,
    baseVendor: base.vendor,
  };
}

export const MODELSCOPE_PROVIDERS: Record<ModelScopeProviderVendor, ProviderDefinition> = {
  [MODELSCOPE_CN_VENDOR]: chinaProvider,
  [MODELSCOPE_GLOBAL_VENDOR]: globalProvider,
  [AGENT_MODELSCOPE_CN_VENDOR]: createAgentProvider(chinaProvider, AGENT_MODELSCOPE_CN_VENDOR, "ModelScope China (Agents)"),
  [AGENT_MODELSCOPE_GLOBAL_VENDOR]: createAgentProvider(globalProvider, AGENT_MODELSCOPE_GLOBAL_VENDOR, "ModelScope Global (Agents)"),
};

let cachedUserAgent: string | undefined;

export function getUserAgent(): string {
  if (cachedUserAgent) return cachedUserAgent;
  const packageJSON = vscode.extensions.getExtension("ltmoerdani.modelscope-copilot-chat")?.packageJSON as
    { version?: unknown } | undefined;
  const version = typeof packageJSON?.version === "string" ? packageJSON.version : undefined;
  cachedUserAgent = version ? `modelscope-copilot-chat/${version} VSCode` : FALLBACK_USER_AGENT;
  return cachedUserAgent;
}

export { isTransientFetchError } from "../retry";
