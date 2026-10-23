export const GO_VENDOR = "opencodego" as const;
export const ZEN_VENDOR = "opencodezen" as const;
export const AGENT_GO_VENDOR = "opencodego-agent" as const;
export const AGENT_ZEN_VENDOR = "opencodezen-agent" as const;
export const MODELSCOPE_CN_VENDOR = "modelscopecn" as const;
export const MODELSCOPE_GLOBAL_VENDOR = "modelscopeglobal" as const;
export const AGENT_MODELSCOPE_CN_VENDOR = "modelscopecn-agent" as const;
export const AGENT_MODELSCOPE_GLOBAL_VENDOR = "modelscopeglobal-agent" as const;

export type ModelScopeBaseVendor = typeof MODELSCOPE_CN_VENDOR | typeof MODELSCOPE_GLOBAL_VENDOR;
export type ModelScopeProviderVendor = ModelScopeBaseVendor | typeof AGENT_MODELSCOPE_CN_VENDOR | typeof AGENT_MODELSCOPE_GLOBAL_VENDOR;
export type OpenCodeBaseVendor = typeof GO_VENDOR | typeof ZEN_VENDOR;
export type OpenCodeProviderVendor = OpenCodeBaseVendor | typeof AGENT_GO_VENDOR | typeof AGENT_ZEN_VENDOR;
export type MetadataVendor = OpenCodeBaseVendor | ModelScopeBaseVendor;
export type ProviderVendor = OpenCodeBaseVendor;
export type AllProviderVendor = OpenCodeProviderVendor | ModelScopeProviderVendor;

export function resolveBaseVendor(vendor: OpenCodeProviderVendor): OpenCodeBaseVendor;
export function resolveBaseVendor(vendor: ModelScopeProviderVendor): ModelScopeBaseVendor;
export function resolveBaseVendor(vendor: AllProviderVendor): ProviderVendor | ModelScopeBaseVendor;
export function resolveBaseVendor(vendor: AllProviderVendor): ProviderVendor | ModelScopeBaseVendor {
  switch (vendor) {
    case AGENT_GO_VENDOR:
      return GO_VENDOR;
    case AGENT_ZEN_VENDOR:
      return ZEN_VENDOR;
    case AGENT_MODELSCOPE_CN_VENDOR:
      return MODELSCOPE_CN_VENDOR;
    case AGENT_MODELSCOPE_GLOBAL_VENDOR:
      return MODELSCOPE_GLOBAL_VENDOR;
    default:
      return vendor;
  }
}

export interface ProviderRoutingDefinition {
  vendor: AllProviderVendor;
  chatCompletionsUrl: string;
  messagesUrl: string;
  modelsUrl: string;
  googleModelsUrl?: string;
  responsesUrl?: string;
}
