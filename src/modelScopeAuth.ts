export type ModelScopeEndpointKind = "chat-completions" | "models";

export function buildModelScopeAuthHeaders(_endpointKind: ModelScopeEndpointKind, apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
  };
}
