import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  AGENT_MODELSCOPE_CN_VENDOR,
  AGENT_MODELSCOPE_GLOBAL_VENDOR,
  MODELSCOPE_CN_VENDOR,
  MODELSCOPE_GLOBAL_VENDOR,
  resolveBaseVendor,
} from "../providerTypes.js";
import type { ProviderRoutingDefinition } from "../providerTypes.js";
import { modelPricingFields } from "../models/pricing.js";
import { lookupModelRegistryEntry } from "../core/registry.js";
import { thinkingFamily } from "../thinking/provider.js";

const vscodeMockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vscode-mock-modelscope-provider-")), "index.js");
fs.writeFileSync(vscodeMockPath, '"use strict"; module.exports = {};', "utf-8");

type ResolveFilename = (request: string, parent: unknown, ...args: unknown[]) => string;
const moduleResolver = Module as unknown as { _resolveFilename: ResolveFilename };
const originalResolveFilename = moduleResolver._resolveFilename;
moduleResolver._resolveFilename = function (request: string, parent: unknown, ...args: unknown[]): string {
  if (request === "vscode") {
    return vscodeMockPath;
  }
  return originalResolveFilename.call(this, request, parent, ...args);
};

let providers: typeof import("../provider/definitions.js").MODELSCOPE_PROVIDERS;
let resolveModelRouting: typeof import("../core/routing.js").resolveModelRouting;

before(async () => {
  ({ MODELSCOPE_PROVIDERS: providers } = await import("../provider/definitions.js"));
  ({ resolveModelRouting } = await import("../core/routing.js"));
});

describe("ModelScope provider identity", () => {
  it("defines base and Agents vendors and resolves Agents to the correct base", () => {
    assert.equal(MODELSCOPE_CN_VENDOR, "modelscopecn");
    assert.equal(MODELSCOPE_GLOBAL_VENDOR, "modelscopeglobal");
    assert.equal(AGENT_MODELSCOPE_CN_VENDOR, "modelscopecn-agent");
    assert.equal(AGENT_MODELSCOPE_GLOBAL_VENDOR, "modelscopeglobal-agent");
    assert.equal(resolveBaseVendor(AGENT_MODELSCOPE_CN_VENDOR), MODELSCOPE_CN_VENDOR);
    assert.equal(resolveBaseVendor(AGENT_MODELSCOPE_GLOBAL_VENDOR), MODELSCOPE_GLOBAL_VENDOR);
  });

  it("recognizes model and thinking families from owner-prefixed ModelScope ids", () => {
    const models = [
      ["Qwen/Qwen3.5-27B", "qwen"],
      ["deepseek-ai/DeepSeek-V4-Flash", "deepseek"],
      ["ZhipuAI/GLM-5.2", "glm"],
      ["moonshotai/Kimi-K2.5", "kimi"],
      ["MiniMax/MiniMax-M3", "minimax"],
    ] as const;

    for (const [modelId, family] of models) {
      assert.equal(lookupModelRegistryEntry(modelId).family, family);
      assert.equal(thinkingFamily(modelId), family);
    }
  });
});

describe("ModelScope provider definitions", () => {
  it("uses the ModelScope CN and Global API Inference endpoints", () => {
    assert.ok(providers, "ModelScope provider definitions should be exported");
    assert.equal(providers[MODELSCOPE_CN_VENDOR].modelsUrl, "https://api-inference.modelscope.cn/v1/models");
    assert.equal(providers[MODELSCOPE_CN_VENDOR].chatCompletionsUrl, "https://api-inference.modelscope.cn/v1/chat/completions");
    assert.equal(providers[MODELSCOPE_GLOBAL_VENDOR].modelsUrl, "https://api-inference.modelscope.ai/v1/models");
    assert.equal(providers[MODELSCOPE_GLOBAL_VENDOR].chatCompletionsUrl, "https://api-inference.modelscope.ai/v1/chat/completions");
    assert.equal(providers[AGENT_MODELSCOPE_CN_VENDOR].baseVendor, MODELSCOPE_CN_VENDOR);
    assert.equal(providers[AGENT_MODELSCOPE_GLOBAL_VENDOR].baseVendor, MODELSCOPE_GLOBAL_VENDOR);
    assert.ok(providers[MODELSCOPE_CN_VENDOR].fallbackModels.includes("Qwen/Qwen3.5-27B"));
    assert.ok(providers[MODELSCOPE_GLOBAL_VENDOR].fallbackModels.includes("Qwen/Qwen3.5-27B"));
  });

  describe("ModelScope model presentation", () => {
    it("does not label API models as OpenCode Zen subscription models", () => {
      const pricing = modelPricingFields("unknown/model", MODELSCOPE_CN_VENDOR, {
        contextWindow: 1000,
        maxOutputTokens: 500,
        supportsVision: false,
        supportsAudio: false,
        supportsVideo: false,
        supportsPdf: false,
        reasoning: false,
        source: "default",
      });

      assert.equal(pricing.pricing, "ModelScope API");
    });
  });

  it("routes the reference model families through ModelScope chat completions", () => {
    assert.ok(providers, "ModelScope provider definitions should be exported");
    const provider: ProviderRoutingDefinition = providers[MODELSCOPE_CN_VENDOR];
    for (const modelId of [
      "Qwen/Qwen3.5-27B",
      "deepseek-ai/DeepSeek-V4-Flash",
      "ZhipuAI/GLM-5.2",
      "moonshotai/Kimi-K2.5",
      "MiniMax/MiniMax-M3",
      "unknown/model",
    ]) {
      const route = resolveModelRouting(modelId, provider);
      assert.equal(route.endpointKind, "chat-completions", modelId);
      assert.equal(route.endpointUrl, provider.chatCompletionsUrl, modelId);
    }
  });
});
