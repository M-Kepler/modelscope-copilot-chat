import { MODELSCOPE_USER_AGENT } from "../config";

export function buildModelScopeRequestHeaders(): Record<string, string> {
  return {
    "User-Agent": MODELSCOPE_USER_AGENT,
  };
}

export function stringifyInitiator(initiator: unknown): string | undefined {
  if (initiator === undefined || initiator === null) {
    return undefined;
  }
  if (typeof initiator === "string") {
    return initiator;
  }
  if (typeof initiator === "object" || typeof initiator === "function") {
    return JSON.stringify(initiator);
  }
  if (typeof initiator === "number" || typeof initiator === "boolean" || typeof initiator === "bigint") {
    return String(initiator);
  }
  if (typeof initiator === "symbol") {
    return initiator.description;
  }
  return undefined;
}
