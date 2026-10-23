import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
  name: string;
  displayName: string;
  repository: { url: string };
  homepage?: string;
  bugs?: { url: string };
  contributes: {
    commands: { command: string }[];
    configuration: { properties: Record<string, unknown> };
    languageModelChatProviders: { vendor: string; displayName: string }[];
  };
};

describe("ModelScope package contributions", () => {
  it("uses ModelScope identity and contributes only ModelScope providers", () => {
    assert.equal(packageJson.name, "modelscope-copilot-chat");
    assert.equal(packageJson.displayName, "ModelScope for Copilot Chat");
    assert.equal(packageJson.repository.url, "https://github.com/M-Kepler/modelscope-copilot-chat");
    assert.equal(packageJson.homepage, "https://github.com/M-Kepler/modelscope-copilot-chat#readme");
    assert.equal(packageJson.bugs?.url, "https://github.com/M-Kepler/modelscope-copilot-chat/issues");
    assert.deepEqual(
      packageJson.contributes.languageModelChatProviders.map(({ vendor }) => vendor).sort(),
      ["modelscopeglobal", "modelscopeglobal-agent", "modelscopecn", "modelscopecn-agent"].sort(),
    );
  });

  it("uses distinct labels for the normal and Agents providers", () => {
    const providers = packageJson.contributes.languageModelChatProviders;
    const labels = providers.map(({ displayName }) => displayName);

    assert.equal(new Set(labels).size, providers.length);
    assert.deepEqual(Object.fromEntries(providers.map(({ vendor, displayName }) => [vendor, displayName])), {
      modelscopecn: "ModelScope China",
      "modelscopecn-agent": "ModelScope China (Agents)",
      modelscopeglobal: "ModelScope Global",
      "modelscopeglobal-agent": "ModelScope Global (Agents)",
    });
    assert.ok(providers.filter(({ vendor }) => vendor.endsWith("-agent")).every(({ displayName }) => displayName.includes("(Agents)")));
  });

  it("does not contribute OpenCode vendors, commands, or settings", () => {
    const serialized = JSON.stringify({
      commands: packageJson.contributes.commands,
      settings: packageJson.contributes.configuration.properties,
      providers: packageJson.contributes.languageModelChatProviders,
    });

    assert.doesNotMatch(serialized, /opencode(go|zen)/i);
  });
});
