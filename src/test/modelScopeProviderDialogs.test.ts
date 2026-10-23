import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { MODELSCOPE_CN_SECRET_KEY, MODELSCOPE_GLOBAL_SECRET_KEY } from "../config.js";
import type { ExtensionContext } from "vscode";
import type { DialogDeps } from "../provider/providerDialogs.js";

type QuickPickItem = { label: string; action: string };

const vscodeMock: {
  window: {
    showQuickPick: (items: QuickPickItem[], options?: { title?: string; placeHolder?: string }) => Promise<QuickPickItem | undefined>;
    showInputBox: (options: { password?: boolean; prompt?: string }) => Promise<string | undefined>;
    showWarningMessage: (message: string, ...items: string[]) => Promise<string | undefined>;
  };
} = {
  window: {
    showQuickPick: () => Promise.resolve(undefined),
    showInputBox: () => Promise.resolve(undefined),
    showWarningMessage: () => Promise.resolve(undefined),
  },
};

type ModuleLoad = (request: string, parent: unknown, isMain: boolean) => unknown;
const moduleLoader = Module as unknown as { _load: ModuleLoad };
const originalLoad = moduleLoader._load;
let lastQuickPickItems: QuickPickItem[] = [];
moduleLoader._load = function (request, parent, isMain) {
  if (request === "vscode") {
    return vscodeMock;
  }
  return originalLoad.call(this, request, parent, isMain);
};

let manageProvider: typeof import("../provider/providerDialogs.js").manageProvider;

before(async () => {
  ({ manageProvider } = await import("../provider/providerDialogs.js"));
});

after(() => {
  moduleLoader._load = originalLoad;
});

function createDeps(region: "china" | "global", existingKeys: Map<string, string> = new Map()) {
  const calls = { refreshModels: 0, refreshBalance: 0, onApiKeyRemoved: 0 };
  const stored = new Map(existingKeys);
  const deps = {
    context: {
      secrets: {
        get: (key: string) => Promise.resolve(stored.get(key)),
        store: (key: string, value: string) => {
          stored.set(key, value);
          return Promise.resolve();
        },
        delete: (key: string) => {
          stored.delete(key);
          return Promise.resolve();
        },
      },
    } as unknown as ExtensionContext,
    baseVendor: region === "china" ? ("modelscopecn" as const) : ("modelscopeglobal" as const),
    definition: {
      displayName: region === "china" ? "ModelScope China" : "ModelScope Global",
    },
    log: () => undefined,
    refreshModels: () => {
      calls.refreshModels += 1;
      return Promise.resolve();
    },
    refreshBalance: () => {
      calls.refreshBalance += 1;
      return Promise.resolve({ ok: true, balance: { availableBalance: 0, totalBalance: 0, frozenAmount: 0 }, fetchedAt: 0 });
    },
    onApiKeyRemoved: () => {
      calls.onApiKeyRemoved += 1;
    },
    showDiagnostics: () => Promise.resolve(),
  } as unknown as DialogDeps;
  return { deps, calls, stored };
}

function chooseAction(label: string): void {
  vscodeMock.window.showQuickPick = (items) => {
    lastQuickPickItems = items;
    return Promise.resolve(items.find((item) => item.label === label));
  };
}

describe("ModelScope provider key management", () => {
  it("stores a trimmed China key in the China secret and refreshes models and balance with a masked prompt", async () => {
    const { deps, calls, stored } = createDeps("china", new Map([[MODELSCOPE_GLOBAL_SECRET_KEY, "global-secret"]]));
    let passwordPrompt = false;
    chooseAction("Set/Update API Key");
    vscodeMock.window.showInputBox = (options) => {
      passwordPrompt = options.password === true;
      return Promise.resolve("  unit-test-api-key  ");
    };

    await manageProvider(deps);

    assert.equal(passwordPrompt, true);
    assert.equal(stored.get(MODELSCOPE_CN_SECRET_KEY), "unit-test-api-key");
    assert.equal(stored.get(MODELSCOPE_GLOBAL_SECRET_KEY), "global-secret");
    assert.deepEqual(calls, { refreshModels: 1, refreshBalance: 1, onApiKeyRemoved: 0 });
  });

  it("leaves secrets unchanged when key entry is cancelled or blank", async () => {
    for (const input of [undefined, " \t "]) {
      const { deps, calls, stored } = createDeps("china", new Map([[MODELSCOPE_CN_SECRET_KEY, "existing-secret"]]));
      chooseAction("Set/Update API Key");
      vscodeMock.window.showInputBox = () => Promise.resolve(input);

      await manageProvider(deps);

      assert.equal(stored.get(MODELSCOPE_CN_SECRET_KEY), "existing-secret");
      assert.equal(
        lastQuickPickItems.some((item) => item.label === "Remove API Key"),
        true,
      );
      assert.deepEqual(calls, { refreshModels: 0, refreshBalance: 0, onApiKeyRemoved: 0 });
    }
  });

  it("omits Remove API Key when no key is stored", async () => {
    const { deps } = createDeps("global");
    chooseAction("Set/Update API Key");
    vscodeMock.window.showInputBox = () => Promise.resolve(undefined);

    await manageProvider(deps);

    assert.equal(
      lastQuickPickItems.some((item) => item.label === "Remove API Key"),
      false,
    );
  });

  it("stores a Global key independently without refreshing China balance", async () => {
    const { deps, calls, stored } = createDeps("global", new Map([[MODELSCOPE_CN_SECRET_KEY, "china-secret"]]));
    chooseAction("Set/Update API Key");
    vscodeMock.window.showInputBox = () => Promise.resolve("global-test-key");

    await manageProvider(deps);

    assert.equal(stored.get(MODELSCOPE_GLOBAL_SECRET_KEY), "global-test-key");
    assert.equal(stored.get(MODELSCOPE_CN_SECRET_KEY), "china-secret");
    assert.deepEqual(calls, { refreshModels: 1, refreshBalance: 0, onApiKeyRemoved: 0 });
  });

  it("removes a selected key only after confirmation and refreshes China balance without fetching models", async () => {
    const { deps, calls, stored } = createDeps(
      "china",
      new Map([
        [MODELSCOPE_CN_SECRET_KEY, "china-secret"],
        [MODELSCOPE_GLOBAL_SECRET_KEY, "global-secret"],
      ]),
    );
    chooseAction("Remove API Key");
    vscodeMock.window.showWarningMessage = () => Promise.resolve("Remove API Key");

    await manageProvider(deps);

    assert.equal(stored.has(MODELSCOPE_CN_SECRET_KEY), false);
    assert.equal(stored.get(MODELSCOPE_GLOBAL_SECRET_KEY), "global-secret");
    assert.deepEqual(calls, { refreshModels: 0, refreshBalance: 1, onApiKeyRemoved: 1 });
  });

  it("preserves the selected key when removal is declined", async () => {
    const { deps, calls, stored } = createDeps("global", new Map([[MODELSCOPE_GLOBAL_SECRET_KEY, "global-secret"]]));
    chooseAction("Remove API Key");
    vscodeMock.window.showWarningMessage = () => Promise.resolve("Cancel");

    await manageProvider(deps);

    assert.equal(stored.get(MODELSCOPE_GLOBAL_SECRET_KEY), "global-secret");
    assert.deepEqual(calls, { refreshModels: 0, refreshBalance: 0, onApiKeyRemoved: 0 });
  });

  it("propagates SecretStorage failures without continuing refresh actions", async () => {
    const { deps, calls } = createDeps("global");
    const storageError = new Error("SecretStorage unavailable");
    deps.context.secrets.store = () => Promise.reject(storageError);
    chooseAction("Set/Update API Key");
    vscodeMock.window.showInputBox = () => Promise.resolve("unit-test-api-key");

    await assert.rejects(manageProvider(deps), (error: unknown) => error === storageError);
    assert.deepEqual(calls, { refreshModels: 0, refreshBalance: 0, onApiKeyRemoved: 0 });
  });
});
