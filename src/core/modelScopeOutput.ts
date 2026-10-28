/**
 * The single shared "ModelScope" output channel.
 *
 * `vscode.window.createOutputChannel` appends a new entry to the Output tab on
 * every call (issue #220), so every component that logs (chat provider,
 * inline completions) must obtain this one channel instead of creating its own.
 */

import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

/** Shared "ModelScope" channel, created on first use. */
export function modelScopeOutputChannel(context?: vscode.ExtensionContext): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel("ModelScope");
    context?.subscriptions.push(channel);
  }
  return channel;
}

/** Append one timestamped line to the shared channel. */
export function logModelScope(message: string): void {
  modelScopeOutputChannel().appendLine(`[${new Date().toISOString()}] ${message}`);
}
