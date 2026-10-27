/**
 * Inline-completion provider wrapping a CompletionEngine. State is held in
 * closures so the provider is cheap to construct and cheap to dispose.
 */

import * as vscode from "vscode";

import { buildCompletionWindow, isChatInputDocument, isCompletionDocument } from "./context";
import type { CompletionContext, CompletionResult, CompletionEngine } from "./types";

export interface InlineCompletionProviderOptions {
  engine: CompletionEngine;
  onSuggestion?: (result: CompletionResult) => void;
}

/**
 * Provider that returns a single inline-completion item (ghost text) per
 * request. Returns `undefined` when the document is not a code surface or
 * the engine produced no text.
 */
export function createInlineCompletionProvider(options: InlineCompletionProviderOptions) {
  const { engine, onSuggestion } = options;

  return {
    provideInlineCompletionItems(
      document: vscode.TextDocument,
      _position: vscode.Position,
      _context: vscode.InlineCompletionContext,
      token: vscode.CancellationToken,
    ): vscode.InlineCompletionItem[] | undefined | Thenable<vscode.InlineCompletionItem[] | undefined> {
      if (!isCompletionDocument(document.uri) || isChatInputDocument(document.uri)) {
        return undefined;
      }

      const offset = document.offsetAt(_position);
      const { prefix, suffix } = buildCompletionWindow(document.getText(), offset);
      const ctx: CompletionContext = { prefix, suffix, maxTokens: 128, modelId: engine.id };

      let cancelled = false;
      token.onCancellationRequested(() => {
        cancelled = true;
      });

      return new Promise<CompletionResult | undefined>((resolve) => {
        if (cancelled) {
          resolve(undefined);
          return;
        }
        const controller = new AbortController();
        const cancelToken = token;
        const onAbort = (): void => {
          controller.abort();
        };
        cancelToken.onCancellationRequested((): void => {
          onAbort();
        });
        engine
          .complete(ctx, controller.signal)
          .then((result) => {
            if (cancelled) {
              resolve(undefined);
              return;
            }
            onSuggestion?.(result);
            resolve(result);
          })
          .catch(() => {
            resolve(undefined);
          });
      }).then((result) => {
        if (!result?.text) {
          return undefined;
        }
        const item = new vscode.InlineCompletionItem(result.text);
        return [item];
      });
    },
  };
}
