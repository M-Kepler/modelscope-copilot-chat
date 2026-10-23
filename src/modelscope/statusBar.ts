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
}

const BALANCE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export class ModelScopeStatusBarController {
  private lastBalance: MagicubeBalance | undefined;
  private lastSuccessfulAt: number | undefined;
  private refreshError: string | undefined;
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
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.dependencies.tokenItem.dispose();
    this.dependencies.quotaItem.dispose();
    this.dependencies.balanceItem.dispose();
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
