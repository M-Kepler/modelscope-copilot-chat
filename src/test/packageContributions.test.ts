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
    languageModelChatProviders: {
      vendor: string;
      displayName: string;
      icon?: { light: string; dark: string };
      managementCommand?: string;
      configuration?: {
        type?: string;
        properties?: Record<string, { type?: string; secret?: boolean }>;
      };
    }[];
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

  it("keeps the native Add Models flow available for base providers", () => {
    const providers = packageJson.contributes.languageModelChatProviders;
    assert.ok(providers.every(({ managementCommand }) => managementCommand === undefined));

    for (const vendor of ["modelscopecn", "modelscopeglobal"]) {
      const provider = providers.find((entry) => entry.vendor === vendor);
      assert.ok(provider, `${vendor} provider should be contributed`);
      const configuration = provider.configuration;
      assert.ok(configuration, `${vendor} should expose native configuration`);
      assert.equal(configuration.type, "object");
      const properties = configuration.properties;
      assert.ok(properties, `${vendor} should expose configuration properties`);
      const apiKey = properties.apiKey;
      assert.ok(apiKey, `${vendor} should expose an API key field`);
      assert.equal(apiKey.type, "string");
      assert.equal(apiKey.secret, true);
    }

    assert.ok(providers.filter(({ vendor }) => vendor.endsWith("-agent")).every(({ configuration }) => configuration === undefined));
  });

  it("declares a light and dark provider icon that exists on disk", () => {
    const providers = packageJson.contributes.languageModelChatProviders;

    for (const { vendor, icon } of providers) {
      assert.ok(icon, `${vendor} should declare an icon`);
      for (const variant of [icon.light, icon.dark]) {
        // VS Code resolves these relative to the extension root and silently
        // drops the icon when the file is missing.
        assert.doesNotThrow(() => readFileSync(resolve(process.cwd(), variant)), `${vendor} icon ${variant} should exist`);
      }
    }
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
