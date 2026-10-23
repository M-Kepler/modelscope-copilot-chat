import type { TransportRequestSummary } from "../core/transport";

export function formatModelScopeTokens(summary: TransportRequestSummary): string {
  return `Prompt ${String(summary.promptTokens ?? "n/a")} · Output ${String(summary.completionTokens ?? "n/a")} tokens`;
}

export function formatModelScopeQuota(summary: TransportRequestSummary): string {
  const account = quotaPart("Requests", summary.userRequestRemaining, summary.userRequestLimit);
  const model = quotaPart("Model requests", summary.modelRequestRemaining, summary.modelRequestLimit);
  const parts = [account, model].filter((part): part is string => part !== undefined);
  return parts.length ? parts.join(" · ") : "Request quota unavailable";
}

function quotaPart(label: string, remaining: string | undefined, limit: string | undefined): string | undefined {
  if (remaining === undefined && limit === undefined) return undefined;
  return `${label} ${remaining ?? "?"}/${limit ?? "?"}`;
}
