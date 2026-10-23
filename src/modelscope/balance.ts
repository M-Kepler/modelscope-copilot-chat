import { MAGICUBE_BALANCE_FETCH_TIMEOUT_MS } from "../config";

const MAGICUBE_BALANCE_URL = "https://modelscope.cn/openapi/v1/magicubes/balance";

export interface MagicubeBalance {
  availableBalance: number;
  totalBalance: number;
  frozenAmount: number;
}

export type MagicubeBalanceResult =
  | { ok: true; balance: MagicubeBalance; fetchedAt: number }
  | { ok: false; reason: "no-key" | "unauthorized" | "http" | "network" | "invalid"; message: string };

export async function fetchMagicubeBalance(
  apiKey: string | undefined,
  fetcher: typeof fetch = fetch,
  timeoutMs = MAGICUBE_BALANCE_FETCH_TIMEOUT_MS,
): Promise<MagicubeBalanceResult> {
  if (!apiKey?.trim()) {
    return { ok: false, reason: "no-key", message: "ModelScope China API key is not configured." };
  }

  let response: Response;
  try {
    response = await fetcher(MAGICUBE_BALANCE_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: "network", message: `Magicube balance request failed: ${message}` };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      reason: "unauthorized",
      message: `ModelScope rejected the API key (HTTP ${String(response.status)}).`,
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      reason: "http",
      message: `Magicube balance request failed (HTTP ${String(response.status)}).`,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, reason: "invalid", message: "Magicube balance response was not valid JSON." };
  }

  if (!isRecord(payload) || !isRecord(payload.data)) {
    return { ok: false, reason: "invalid", message: "Magicube balance response did not contain balance data." };
  }

  const availableBalance = payload.data.available_balance;
  const totalBalance = payload.data.total_balance;
  const frozenAmount = payload.data.frozen_amount;
  if (!isFiniteNumber(availableBalance) || !isFiniteNumber(totalBalance) || !isFiniteNumber(frozenAmount)) {
    return { ok: false, reason: "invalid", message: "Magicube balance response contained invalid balance values." };
  }

  return {
    ok: true,
    balance: { availableBalance, totalBalance, frozenAmount },
    fetchedAt: Date.now(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
