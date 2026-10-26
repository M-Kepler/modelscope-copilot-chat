import type * as vscode from "vscode";
import type { TransportRequestSummary } from "../core/transport";
import { fetchMagicubeBalance, type MagicubeBalance, type MagicubeBalanceResult } from "./balance";
import { formatModelScopeQuota, formatModelScopeTokens } from "./quota";

export interface StatusBarItemView {
  text: string;
  tooltip: string | vscode.MarkdownString | undefined;
  show(): void;
  hide(): void;
  dispose(): void;
}

export interface ModelScopeStatusBarDependencies {
  tokenItem: StatusBarItemView;
  quotaItem: StatusBarItemView;
  balanceItem: StatusBarItemView;
  resolveChinaApiKey(): Promise<string | undefined>;
  output: { appendLine(message: string): void };
  fetcher?: typeof fetch;
  now?(): number;
}

const BALANCE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Minimum gap between request-triggered balance refreshes. One chat turn can
 * issue many requests through the tool-call loop, so the completion hook must
 * not hit the balance endpoint once per request.
 */
export const REQUEST_BALANCE_REFRESH_GAP_MS = 60 * 1000;

export class ModelScopeStatusBarController {
  private lastBalance: MagicubeBalance | undefined;
  private lastSuccessfulAt: number | undefined;
  private refreshError: string | undefined;
  private lastAttemptAt: number | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly dependencies: ModelScopeStatusBarDependencies) {
    dependencies.tokenItem.text = "$(symbol-number) Tokens unavailable";
    dependencies.quotaItem.text = "$(dashboard) Request quota unavailable";
    dependencies.tokenItem.show();
    dependencies.quotaItem.show();
    this.renderBalance();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.refreshBalance().catch((error: unknown) => {
        this.reportUnexpectedFailure(error);
      });
    }, BALANCE_REFRESH_INTERVAL_MS);
    void this.refreshBalance().catch((error: unknown) => {
      this.reportUnexpectedFailure(error);
    });
  }

  async refreshBalance(): Promise<MagicubeBalanceResult> {
    this.lastAttemptAt = this.now();
    const apiKey = await this.dependencies.resolveChinaApiKey();
    const result = await fetchMagicubeBalance(apiKey, this.dependencies.fetcher);
    if (result.ok) {
      this.lastBalance = result.balance;
      this.lastSuccessfulAt = result.fetchedAt;
      this.refreshError = undefined;
      this.dependencies.output.appendLine(
        `[magicube] refreshed available=${String(result.balance.availableBalance)} total=${String(result.balance.totalBalance)} frozen=${String(result.balance.frozenAmount)}`,
      );
    } else {
      this.refreshError = result.message;
      this.dependencies.output.appendLine(`[magicube] refresh failed (${result.reason}): ${result.message}`);
    }
    this.renderBalance();
    return result;
  }

  recordRequest(summary: TransportRequestSummary): void {
    this.dependencies.tokenItem.text = `$(symbol-number) ${formatModelScopeTokens(summary)}`;
    this.dependencies.tokenItem.tooltip = "Token usage from the latest ModelScope chat request.";
    this.dependencies.quotaItem.text = `$(dashboard) ${formatModelScopeQuota(summary)}`;
    this.dependencies.quotaItem.tooltip = "Request quotas reported by ModelScope response headers; these are not Magicubes.";
    this.dependencies.tokenItem.show();
    this.dependencies.quotaItem.show();
    this.refreshBalanceAfterRequest();
  }

  /**
   * A completed request consumes Magicubes, so the balance is stale as soon as
   * one finishes. Refresh only when the previous attempt is older than
   * {@link REQUEST_BALANCE_REFRESH_GAP_MS} — failures are throttled too, so a
   * broken endpoint is retried at most once per gap.
   */
  private refreshBalanceAfterRequest(): void {
    if (this.lastAttemptAt !== undefined && this.now() - this.lastAttemptAt < REQUEST_BALANCE_REFRESH_GAP_MS) {
      return;
    }
    void this.refreshBalance().catch((error: unknown) => {
      this.reportUnexpectedFailure(error);
    });
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.dependencies.tokenItem.dispose();
    this.dependencies.quotaItem.dispose();
    this.dependencies.balanceItem.dispose();
  }

  private now(): number {
    return this.dependencies.now ? this.dependencies.now() : Date.now();
  }

  private renderBalance(): void {
    if (!this.lastBalance) {
      this.dependencies.balanceItem.text = this.refreshError ? "$(warning) Magicubes unavailable" : "$(server) Magicubes unavailable";
      this.dependencies.balanceItem.tooltip = this.refreshError
        ? `Magicube balance unavailable: ${this.refreshError}`
        : "No successful Magicube balance refresh yet.";
      this.dependencies.balanceItem.show();
      return;
    }

    const stale = Boolean(this.refreshError);
    this.dependencies.balanceItem.text = `${stale ? "$(warning) " : "$(server) "}${String(this.lastBalance.availableBalance)} Magicubes${stale ? " (stale)" : ""}`;
    this.dependencies.balanceItem.tooltip = [
      `Available: ${String(this.lastBalance.availableBalance)}`,
      `Total: ${String(this.lastBalance.totalBalance)}`,
      `Frozen: ${String(this.lastBalance.frozenAmount)}`,
      `Last successful update: ${this.lastSuccessfulAt ? new Date(this.lastSuccessfulAt).toLocaleString() : "unknown"}`,
      ...(this.refreshError ? [`Refresh error: ${this.refreshError}`] : []),
    ].join("\n");
    this.dependencies.balanceItem.show();
  }

  private reportUnexpectedFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.refreshError = `Could not read the ModelScope China API key: ${message}`;
    this.dependencies.output.appendLine(`[magicube] ${this.refreshError}`);
    this.renderBalance();
  }
}
