import * as vscode from "vscode";
import { registerInlineCompletions } from "./autocomplete/index";
import { showModelPickerDiagnostics } from "./commands/diagnostics";
import { showThinkingEffortPicker } from "./commands/thinkingPicker";
import {
  AGENT_MODELSCOPE_CN_VENDOR,
  AGENT_MODELSCOPE_GLOBAL_VENDOR,
  MODELSCOPE_CN_VENDOR,
  MODELSCOPE_GLOBAL_VENDOR,
  type ModelScopeProviderVendor,
} from "./providerTypes";
import { CONFIG_SECTION, MODELSCOPE_CN_SECRET_KEY, SETTING_AGENTS_WINDOW, SETTING_ENABLED } from "./config";
import { ModelScopeStatusBarController } from "./modelscope/statusBar";
import { MODELSCOPE_PROVIDERS } from "./provider/definitions";
import { ModelScopeProvider } from "./provider/ModelScopeProvider";

export function activate(context: vscode.ExtensionContext): void {
  const statusBar = startModelScopeStatusBars(context, async () => context.secrets.get(MODELSCOPE_CN_SECRET_KEY));
  const providers = {
    [MODELSCOPE_CN_VENDOR]: new ModelScopeProvider(
      context,
      MODELSCOPE_PROVIDERS[MODELSCOPE_CN_VENDOR],
      (summary) => {
        statusBar.recordRequest(summary);
      },
      () => statusBar.refreshBalance(),
    ),
    [MODELSCOPE_GLOBAL_VENDOR]: new ModelScopeProvider(
      context,
      MODELSCOPE_PROVIDERS[MODELSCOPE_GLOBAL_VENDOR],
      (summary) => {
        statusBar.recordRequest(summary);
      },
      () => statusBar.refreshBalance(),
    ),
    [AGENT_MODELSCOPE_CN_VENDOR]: new ModelScopeProvider(
      context,
      MODELSCOPE_PROVIDERS[AGENT_MODELSCOPE_CN_VENDOR],
      (summary) => {
        statusBar.recordRequest(summary);
      },
      () => statusBar.refreshBalance(),
    ),
    [AGENT_MODELSCOPE_GLOBAL_VENDOR]: new ModelScopeProvider(
      context,
      MODELSCOPE_PROVIDERS[AGENT_MODELSCOPE_GLOBAL_VENDOR],
      (summary) => {
        statusBar.recordRequest(summary);
      },
      () => statusBar.refreshBalance(),
    ),
  };

  const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const enabled = configuration.get<boolean>(SETTING_ENABLED, true);
  const agentsWindowEnabled = configuration.get<boolean>(SETTING_AGENTS_WINDOW, true);
  if (enabled) {
    context.subscriptions.push(
      vscode.lm.registerLanguageModelChatProvider(MODELSCOPE_CN_VENDOR, providers[MODELSCOPE_CN_VENDOR]),
      vscode.lm.registerLanguageModelChatProvider(MODELSCOPE_GLOBAL_VENDOR, providers[MODELSCOPE_GLOBAL_VENDOR]),
    );
    if (agentsWindowEnabled) {
      context.subscriptions.push(
        vscode.lm.registerLanguageModelChatProvider(AGENT_MODELSCOPE_CN_VENDOR, providers[AGENT_MODELSCOPE_CN_VENDOR]),
        vscode.lm.registerLanguageModelChatProvider(AGENT_MODELSCOPE_GLOBAL_VENDOR, providers[AGENT_MODELSCOPE_GLOBAL_VENDOR]),
      );
    }
  }

  // Inline completions (ghost text / FIM) — opt-in, registered for every
  // ModelScope vendor so the user can pick a region via the picker.
  const inlineVendors: ModelScopeProviderVendor[] = [
    MODELSCOPE_CN_VENDOR,
    MODELSCOPE_GLOBAL_VENDOR,
    AGENT_MODELSCOPE_CN_VENDOR,
    AGENT_MODELSCOPE_GLOBAL_VENDOR,
  ];
  context.subscriptions.push(...registerInlineCompletions(context, inlineVendors));

  context.subscriptions.push(
    vscode.commands.registerCommand("modelscope.cn.manage", () => providers[MODELSCOPE_CN_VENDOR].manage()),
    vscode.commands.registerCommand("modelscope.global.manage", () => providers[MODELSCOPE_GLOBAL_VENDOR].manage()),
    vscode.commands.registerCommand("modelscope.refreshModels", async () => {
      await Promise.all([providers[MODELSCOPE_CN_VENDOR].refreshModels(), providers[MODELSCOPE_GLOBAL_VENDOR].refreshModels()]);
    }),
    vscode.commands.registerCommand("modelscope.diagnostics", async () => {
      const provider = await vscode.window.showQuickPick(
        [
          { label: "ModelScope China", value: providers[MODELSCOPE_CN_VENDOR] },
          { label: "ModelScope Global", value: providers[MODELSCOPE_GLOBAL_VENDOR] },
        ],
        { placeHolder: "Choose a provider to diagnose" },
      );
      await provider?.value.showDiagnostics();
    }),
    vscode.commands.registerCommand("modelscope.modelPickerDiagnostics", showModelPickerDiagnostics),
    vscode.commands.registerCommand("modelscope.setThinkingEffort", showThinkingEffortPicker),
    vscode.commands.registerCommand("modelscope.refreshMagicubeBalance", async () => {
      const result = await statusBar.refreshBalance();
      if (result.ok) {
        void vscode.window.showInformationMessage(`Magicube balance: ${String(result.balance.availableBalance)} available.`);
      } else {
        void vscode.window.showErrorMessage(`Magicube balance refresh failed: ${result.message}`);
      }
    }),
  );
}

function startModelScopeStatusBars(
  context: vscode.ExtensionContext,
  resolveChinaApiKey: () => Promise<string | undefined>,
): ModelScopeStatusBarController {
  const output = vscode.window.createOutputChannel("ModelScope Magicube");
  const tokenItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 110);
  const quotaItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 109);
  const balanceItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 108);
  balanceItem.command = "modelscope.refreshMagicubeBalance";
  const controller = new ModelScopeStatusBarController({
    tokenItem,
    quotaItem,
    balanceItem,
    resolveChinaApiKey,
    output,
  });

  context.subscriptions.push(output, controller);
  controller.start();
  return controller;
}
