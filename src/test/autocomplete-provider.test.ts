import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import type * as vscode from "vscode";

import type { CompletionContext, CompletionResult } from "../autocomplete/types.js";

class MockInlineCompletionItem {
  constructor(readonly insertText: string) {}
}

const vscodeMock = { InlineCompletionItem: MockInlineCompletionItem };
type ModuleLoad = (request: string, parent: unknown, isMain: boolean) => unknown;
const moduleLoader = Module as unknown as { _load: ModuleLoad };
const originalLoad = moduleLoader._load;
moduleLoader._load = function (request, parent, isMain) {
  if (request === "vscode") {
    return vscodeMock;
  }
  return originalLoad.call(this, request, parent, isMain);
};

let createInlineCompletionProvider: typeof import("../autocomplete/provider.js").createInlineCompletionProvider;

before(async () => {
  ({ createInlineCompletionProvider } = await import("../autocomplete/provider.js"));
});

after(() => {
  moduleLoader._load = originalLoad;
});

type Provider = ReturnType<typeof createInlineCompletionProvider>;

function createDocument(scheme: string, text: string): vscode.TextDocument {
  return { uri: { scheme }, getText: () => text, offsetAt: () => text.length } as unknown as vscode.TextDocument;
}

function createToken(abort = false): vscode.CancellationToken {
  const listeners = new Set<() => void>();
  const token = {
    isCancellationRequested: abort,
    onCancellationRequested: (listener: () => void) => {
      listeners.add(listener);
      return {
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },
    cancel: () => {
      for (const listener of listeners) listener();
    },
  };
  return token as unknown as vscode.CancellationToken;
}

function request(provider: Provider, scheme: string, text: string, token: vscode.CancellationToken = createToken()) {
  return provider.provideInlineCompletionItems(
    createDocument(scheme, text),
    {} as vscode.Position,
    {} as vscode.InlineCompletionContext,
    token,
  );
}

function insertTexts(items: vscode.ProviderResult<vscode.InlineCompletionItem[] | vscode.InlineCompletionList>): string[] {
  const list = Array.isArray(items) ? items : [];
  return list.map((item) => (item as unknown as MockInlineCompletionItem).insertText);
}

describe("autocomplete/provider — debounce and configuration", () => {
  it("debounces, then uses the configured model id and max tokens", async () => {
    const contexts: CompletionContext[] = [];
    const engine = {
      id: "engine",
      complete: (ctx: CompletionContext): Promise<CompletionResult> => {
        contexts.push(ctx);
        return Promise.resolve({ text: "inserted", durationMs: 1, status: 200 });
      },
    };
    const provider = createInlineCompletionProvider({
      engine,
      getTuning: () => ({ modelId: "Qwen/unit-test", maxTokens: 77, debounceMs: 10 }),
    });

    const pending = request(provider, "file", "const value = ", createToken());

    assert.equal(contexts.length, 0, "must not call the engine before the debounce window elapses");
    assert.deepEqual(insertTexts(await pending), ["inserted"]);
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].modelId, "Qwen/unit-test");
    assert.equal(contexts[0].maxTokens, 77);
  });

  it("drops a superseded keystroke instead of running it", async () => {
    const contexts: CompletionContext[] = [];
    const engine = {
      id: "engine",
      complete: (ctx: CompletionContext): Promise<CompletionResult> => {
        contexts.push(ctx);
        return Promise.resolve({ text: "latest", durationMs: 1, status: 200 });
      },
    };
    const provider = createInlineCompletionProvider({
      engine,
      getTuning: () => ({ modelId: "Qwen/unit-test", maxTokens: 128, debounceMs: 10 }),
    });

    const first = request(provider, "file", "const a", createToken());
    const second = request(provider, "file", "const ab", createToken());

    assert.deepEqual(insertTexts(await first), []);
    assert.deepEqual(insertTexts(await second), ["latest"]);
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].prefix, "const ab");
  });

  it("skips chat prompt boxes and other non-code surfaces", () => {
    let calls = 0;
    const provider = createInlineCompletionProvider({
      engine: {
        id: "engine",
        complete: () => {
          calls += 1;
          return Promise.resolve({ text: "inserted", durationMs: 1 });
        },
      },
      getTuning: () => ({ modelId: "Qwen/unit-test", maxTokens: 128, debounceMs: 0 }),
    });

    assert.equal(request(provider, "chatSessionInput", "hello"), undefined);
    assert.equal(request(provider, "output", "hello"), undefined);
    assert.equal(calls, 0);
  });

  it("does not report results for a cancelled token", async () => {
    const reported: CompletionResult[] = [];
    const provider = createInlineCompletionProvider({
      engine: {
        id: "engine",
        complete: (): Promise<CompletionResult> => Promise.resolve({ text: "inserted", durationMs: 1 }),
      },
      getTuning: () => ({ modelId: "Qwen/unit-test", maxTokens: 128, debounceMs: 0 }),
      onResult: (result) => {
        reported.push(result);
      },
    });

    const items = await request(provider, "file", "const value = ", createToken(true));

    assert.deepEqual(items, undefined);
    assert.equal(reported.length, 0);
  });
});
