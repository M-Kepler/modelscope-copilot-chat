import * as vscode from "vscode";
import { TEST_CONNECTION_TIMEOUT_MS, secretKeyFor } from "../config";
import { buildModelScopeAuthHeaders } from "../modelScopeAuth";
import { getErrorMessage } from "../utils";
import type { ModelScopeBaseVendor } from "../providerTypes";
import type { ProviderDefinition } from "./definitions";

export interface DialogDeps {
  context: vscode.ExtensionContext;
  baseVendor: ModelScopeBaseVendor;
  definition: ProviderDefinition;
  log(message: string): void;
  refreshModels(): Promise<void>;
  showDiagnostics(): Promise<void>;
}

export async function manageProvider(deps: DialogDeps): Promise<void> {
  const choice = await vscode.window.showQuickPick(
    [
      { label: "Test Connection", action: "test" as const },
      { label: "Refresh Models", action: "refresh" as const },
      { label: "Open Diagnostics", action: "diagnostics" as const },
    ],
    {
      title: `Manage ${deps.definition.displayName}`,
      placeHolder: "Choose an action",
    },
  );

  if (choice?.action === "test") {
    await testConnection(deps);
  } else if (choice?.action === "refresh") {
    await deps.refreshModels();
  } else if (choice?.action === "diagnostics") {
    await deps.showDiagnostics();
  }
}

export async function testConnection(deps: DialogDeps): Promise<void> {
  const apiKey = await deps.context.secrets.get(secretKeyFor(deps.baseVendor));
  if (!apiKey) {
    void vscode.window.showErrorMessage(
      `${deps.definition.displayName}: No API key configured. Add the provider via Manage Language Models ("+ Add Models" → ${deps.definition.displayName}) first.`,
    );
    return;
  }

  const statusBar = vscode.window.setStatusBarMessage(`$(loading~spin) Testing ${deps.definition.displayName} connection...`);
  deps.log(`Testing connection to ${deps.definition.chatCompletionsUrl}`);
  try {
    const response = await fetch(deps.definition.chatCompletionsUrl, {
      method: "POST",
      headers: {
        ...buildModelScopeAuthHeaders("chat-completions", apiKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: deps.definition.testModelId,
        messages: [{ role: "user", content: "reply with just: ok" }],
        max_tokens: 10,
        stream: false,
      }),
      signal: AbortSignal.timeout(TEST_CONNECTION_TIMEOUT_MS),
    });

    const responseText = await response.text();
    deps.log(`Test response (${String(response.status)}): ${responseText}`);
    if (response.ok) {
      void vscode.window.showInformationMessage(
        `${deps.definition.displayName}: Connection OK (HTTP ${String(response.status)}). Check Output panel for details.`,
      );
    } else {
      void vscode.window.showErrorMessage(
        `${deps.definition.displayName}: Connection failed (HTTP ${String(response.status)}). Check Output panel for details.`,
      );
    }
  } catch (error) {
    const message = getErrorMessage(error);
    deps.log(`Test connection error: ${message}`);
    void vscode.window.showErrorMessage(`${deps.definition.displayName}: Connection error - ${message}`);
  } finally {
    statusBar.dispose();
  }
}
