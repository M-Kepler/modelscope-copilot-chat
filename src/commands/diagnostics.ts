import * as vscode from "vscode";
import { CONFIG_SECTION, SETTING_AGENTS_WINDOW } from "../config";
import {
  AGENT_MODELSCOPE_CN_VENDOR,
  AGENT_MODELSCOPE_GLOBAL_VENDOR,
  MODELSCOPE_CN_VENDOR,
  MODELSCOPE_GLOBAL_VENDOR,
} from "../providerTypes";

export async function showModelPickerDiagnostics(): Promise<void> {
  const vendors: string[] = [MODELSCOPE_CN_VENDOR, MODELSCOPE_GLOBAL_VENDOR];
  if (vscode.workspace.getConfiguration(CONFIG_SECTION).get<boolean>(SETTING_AGENTS_WINDOW, true)) {
    vendors.push(AGENT_MODELSCOPE_CN_VENDOR, AGENT_MODELSCOPE_GLOBAL_VENDOR);
  }

  const sections: string[] = [];
  for (const vendor of vendors) {
    let models: readonly vscode.LanguageModelChat[];
    try {
      models = await vscode.lm.selectChatModels({ vendor });
    } catch (error) {
      sections.push(`## vendor: ${vendor}`, "", `selection error: ${error instanceof Error ? error.message : String(error)}`, "");
      continue;
    }
    sections.push(`## vendor: ${vendor}`, "", `models: ${String(models.length)}`, "");
    for (const model of models) {
      const internalModel = model as unknown as { configurationSchema?: unknown; detail?: unknown };
      sections.push(
        `### ${model.name}`,
        "",
        `- id: \`${model.id}\``,
        `- family: \`${model.family}\``,
        `- version: \`${model.version}\``,
        `- vendor: \`${model.vendor}\``,
        `- detail: \`${typeof internalModel.detail === "string" ? internalModel.detail : ""}\``,
        "- configuration schema:",
        "```json",
        JSON.stringify(internalModel.configurationSchema ?? null, null, 2),
        "```",
        "",
      );
    }
  }

  const document = await vscode.workspace.openTextDocument({
    content: ["# ModelScope Model Picker Diagnostics", "", ...sections].join("\n"),
    language: "markdown",
  });
  await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside);
}
