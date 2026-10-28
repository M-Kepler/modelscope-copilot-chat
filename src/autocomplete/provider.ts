/**
 * Inline-completion provider wrapping a CompletionEngine.
 *
 * Two concerns live here: the document/context gate (only real code surfaces,
 * never chat prompt boxes) and keystroke pacing — a configurable debounce plus
 * latest-wins cancellation, so a superseded request never renders stale ghost
 * text.
 */

import * as vscode from "vscode";

import { DEFAULT_INLINE_DEBOUNCE_MS, DEFAULT_INLINE_MAX_TOKENS } from "../config";
import { buildCompletionWindow, isChatInputDocument, isCompletionDocument } from "./context";
import { Debouncer } from "./throttle";
import type { CompletionContext, CompletionResult, CompletionEngine } from "./types";

/** Per-request knobs, read on every keystroke so setting changes apply live. */
export interface InlineCompletionTuning {
  /** Model id to ask the engine for. */
  modelId: string;
  /** Maximum output tokens for one completion. */
  maxTokens: number;
  /** Keystroke debounce window in ms; 0 fires immediately. */
  debounceMs: number;
}

export interface InlineCompletionProviderOptions {
  engine: CompletionEngine;
  /** Read per request (cheap) so edited settings apply without a reload. */
  getTuning?: () => InlineCompletionTuning;
  /** Called for every run that completed without being superseded/cancelled. */
  onResult?: (result: CompletionResult) => void;
}

export interface InlineCompletionProvider extends vscode.InlineCompletionItemProvider {
  dispose(): void;
}

/**
 * Provider that returns a single inline-completion item (ghost text) per
 * request. Returns `undefined` when the document is not a code surface or
 * the engine produced no text.
 */
export function createInlineCompletionProvider(options: InlineCompletionProviderOptions): InlineCompletionProvider {
  const { engine, getTuning, onResult } = options;
  const debouncer = new Debouncer(getTuning?.().debounceMs ?? DEFAULT_INLINE_DEBOUNCE_MS);

  const provideInlineCompletionItems = (
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> | undefined => {
    if (!isCompletionDocument(document.uri) || isChatInputDocument(document.uri)) {
      return undefined;
    }

    const tuning = getTuning?.();
    // Assigning delayMs reschedules an already-pending run, so a settings
    // change takes effect on the very next keystroke.
    debouncer.delayMs = tuning?.debounceMs ?? DEFAULT_INLINE_DEBOUNCE_MS;

    const offset = document.offsetAt(position);
    const { prefix, suffix } = buildCompletionWindow(document.getText(), offset);
    const ctx: CompletionContext = {
      prefix,
      suffix,
      maxTokens: tuning?.maxTokens ?? DEFAULT_INLINE_MAX_TOKENS,
      modelId: tuning?.modelId ?? engine.id,
    };

    const pending = new Promise<CompletionResult | undefined>((resolve) => {
      let settled = false;
      // Holder object: `settle` may run from the token listener registered
      // immediately below, before a `const` binding would be initialised.
      const state: { cancellation?: vscode.Disposable } = {};
      const settle = (result?: CompletionResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        state.cancellation?.dispose();
        resolve(result);
      };
      state.cancellation = token.onCancellationRequested((): void => {
        settle(undefined);
      });
      if (token.isCancellationRequested) {
        settle(undefined);
        return;
      }

      const runSignal = debouncer.debounce(async (signal): Promise<void> => {
        if (settled) {
          // The token was cancelled while this run waited in the debounce
          // window: settle already happened, so do not spend a request.
          return;
        }
        // The engine gets a signal that aborts on either supersede (debounce
        // signal) or VS Code cancellation, so an abandoned fetch stops instead
        // of running to its timeout.
        const controller = new AbortController();
        const abort = (): void => {
          controller.abort();
        };
        signal.addEventListener("abort", abort, { once: true });
        const runCancellation = token.onCancellationRequested(abort);
        try {
          const result = await engine.complete(ctx, controller.signal);
          if (controller.signal.aborted) {
            settle(undefined);
            return;
          }
          onResult?.(result);
          settle(result);
        } finally {
          runCancellation.dispose();
          signal.removeEventListener("abort", abort);
        }
      });
      // A superseded call whose debounce timer never fired has no run to
      // report back, so it must settle here — otherwise VS Code would wait on
      // a promise that can never resolve.
      runSignal.addEventListener(
        "abort",
        (): void => {
          settle(undefined);
        },
        { once: true },
      );
    });

    return pending.then((result) => (result?.text ? [new vscode.InlineCompletionItem(result.text)] : undefined));
  };

  return {
    provideInlineCompletionItems,
    dispose: (): void => {
      debouncer.dispose();
    },
  };
}
