import * as vscode from "vscode";
import { createHash, randomUUID } from "node:crypto";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { OPEN_CODE_CLIENT } from "../config";
import { getUserAgent } from "../provider/definitions";
import { messageText } from "../provider/tokens";
import { isRecord } from "../utils";

// OpenCode Go gateway enforcement (docs/go, updated 2026-09-07): every request
// to the gateway should carry a stable `x-opencode-session`. The main chat
// path builds a per-conversation id in buildOpenCodeRequestHeaders(); the
// auxiliary requests below (/models, /usage, test-connection, inline
// completions) have no conversation, so they share one persisted
// per-installation id instead.

/** globalState key for the persisted auxiliary session id. */
const AUX_SESSION_STATE_KEY = "opencode.auxSessionId";

/**
 * Stable per-installation session id for auxiliary gateway requests that have
 * no conversation context (/models, /usage, test connection, inline
 * completions). Generated once and persisted in globalState.
 */
export function auxiliarySessionId(context: vscode.ExtensionContext): string {
  const existing = context.globalState.get<string>(AUX_SESSION_STATE_KEY);
  if (existing && existing.trim()) {
    return cleanHeaderValue(existing);
  }
  const id = cleanHeaderValue(`vscode-aux-${randomUUID()}`);
  void context.globalState.update(AUX_SESSION_STATE_KEY, id);
  return id;
}

// --- Context-cache parity (mirrors ~/.config/opencode/plugins/opencode-context-cache.mjs) ---
// NOTE (PR #212 review): the legacy model headers x-session-id /
// conversation_id / session_id were dropped — no evidence they do anything
// beyond x-opencode-session + prompt_cache_key, and they are not in any
// public Zen docs. The project cache key now flows only via prompt_cache_key
// (chat-completions/responses bodies); x-opencode-session stays the routing
// affinity header.
const CONTEXT_CACHE_DEBUG_ENV_VAR = "OPENCODE_CONTEXT_CACHE_DEBUG";

function appendContextCacheLog(message: string): void {
  const flag = process.env[CONTEXT_CACHE_DEBUG_ENV_VAR] ?? "";
  if (flag !== "1" && flag !== "true") return;
  try {
    const logPath = path.join(os.homedir(), ".config", "opencode", "plugins", "context-cache-vscode.log");
    const safe = message.replace(/\n/g, "\\n").replace(/\r/g, "\\r");
    const line = `[${new Date().toISOString()}] [pid:${String(process.pid)}] [context-cache-vscode] ${safe}\n`;
    fs.appendFileSync(logPath, line, "utf8");
  } catch {
    /* best-effort */
  }
}

export function hashRawCacheKey(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function normalizeDirForCacheKey(dir: string): string {
  // Canonicalize separators so C:\a\b and C:/a/b hash identically.
  // Drive-letter upper-casing keeps c:\ vs C:\ stable on Windows.
  let out = dir.replace(/\\/g, "/");
  if (out.length >= 2 && out[1] === ":" && out[0] !== out[0].toUpperCase()) out = out[0].toUpperCase() + out.slice(1);
  return out;
}

function resolveRawProjectCacheKey(modelId: string): string | null {
  const env = process.env as Record<string, string | undefined>;
  const override = (env.OPENCODE_PROMPT_CACHE_KEY ?? env.OPENCODE_STICKY_SESSION_ID ?? "").trim();
  if (override) return override;
  try {
    const user = env.USERNAME ?? env.USER ?? env.LOGNAME ?? "unknown";
    const host = os.hostname();
    let dir = "";
    try {
      dir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    } catch {
      dir = "";
    }
    if (dir) dir = normalizeDirForCacheKey(dir);
    if (!dir) dir = modelId || "no-workspace";
    return `${user}@${host}:${dir}`;
  } catch {
    return null;
  }
}

export function resolveProjectCacheKey(modelId: string): string | null {
  const raw = resolveRawProjectCacheKey(modelId);
  if (!raw) return null;
  return hashRawCacheKey(raw);
}

// The official OpenCode client sends these headers on every request. The Zen
// gateway reads x-opencode-session first, then converts that sticky identifier
// into provider-specific affinity headers such as x-session-affinity upstream.
//
// VS Code's provider API does not expose a stable chat-session identity
// (microsoft/vscode#305853 — `chatSessionResource` proposed, not shipped), so
// we probe known internal option fields and fall back to a memoized anchor
// hash. The anchor covers ONLY the first message + sorted tool names + model:
// history trimming rewrites messages[1..N] by design, so hashing the first 3
// messages would shift the session id on every trim and break sticky routing
// + prefix-cache affinity. Memoization keeps the id constant for the life of
// the conversation even as the tail grows.
const sessionMemo = new Map<string, string>();

export function buildOpenCodeRequestHeaders(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  modelId: string,
): Record<string, string> {
  const explicit = findStringOption(options, [
    "sessionId",
    "sessionID",
    "chatSessionId",
    "chatSessionID",
    "conversationId",
    "conversationID",
    "threadId",
    "threadID",
    "session.id",
    "chatSession.id",
  ]);
  let sessionId: string;
  if (explicit) {
    sessionId = cleanHeaderValue(explicit);
  } else {
    const anchorKey = stableConversationAnchorKey(messages, options, modelId);
    const memoKey = `${modelId}:${anchorKey}`;
    const memoized = sessionMemo.get(memoKey);
    if (memoized) {
      sessionId = memoized;
    } else {
      sessionId = cleanHeaderValue(`vscode-${anchorKey}`);
      sessionMemo.set(memoKey, sessionId);
      if (sessionMemo.size > 500) {
        const oldest = sessionMemo.keys().next().value;
        if (oldest) sessionMemo.delete(oldest);
      }
    }
  }
  const requestId = cleanHeaderValue(
    findStringOption(options, ["requestId", "requestID", "messageId", "messageID"]) ??
      `req-${stableHash(`${String(Date.now())}-${String(Math.random())}-${sessionId}-${modelId}`)}`,
  );

  const projectCacheKey = resolveProjectCacheKey(modelId);
  const headers: Record<string, string> = {
    "x-opencode-session": sessionId,
    "x-opencode-request": requestId,
    "x-opencode-client": OPEN_CODE_CLIENT,
    "User-Agent": getUserAgent(),
  };
  if (projectCacheKey) {
    appendContextCacheLog(`model=${modelId} raw=${resolveRawProjectCacheKey(modelId) ?? ""} hash=${projectCacheKey}`);
  } else {
    appendContextCacheLog(`model=${modelId} no stable cache key resolved`);
  }
  return headers;
}

/**
 * Stringify an arbitrary transport-layer initiator value for diagnostics.
 * Objects and functions are JSON-serialized, nullish values are dropped, and
 * primitives are converted directly so logs never show "[object Object]".
 */
export function stringifyInitiator(initiator: unknown): string | undefined {
  if (initiator === undefined || initiator === null) {
    return undefined;
  }
  if (typeof initiator === "string") {
    return initiator;
  }
  if (typeof initiator === "object" || typeof initiator === "function") {
    return JSON.stringify(initiator);
  }
  if (typeof initiator === "symbol" || typeof initiator === "bigint") {
    return initiator.toString();
  }
  if (typeof initiator === "number" || typeof initiator === "boolean") {
    return String(initiator);
  }
  // No known primitive type left; nothing useful to stringify.
  return undefined;
}

export function findStringOption(options: unknown, paths: string[]): string | undefined {
  for (const path of paths) {
    const value = readPath(options, path.split("."));
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

export function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

export function conversationAnchor(messages: readonly vscode.LanguageModelChatRequestMessage[], modelId: string): string {
  // Legacy anchor (first-3-messages) kept for compatibility; new code should
  // use stableConversationAnchorKey which is trim-stable.
  const anchorMessages = messages.slice(0, 3).map((message) => `${String(message.role)}:${messageText(message).slice(0, 2048)}`);
  return anchorMessages.length ? anchorMessages.join("\n") : modelId;
}

/**
 * Trim-stable conversation key: first message text + sorted tool names +
 * model id. Messages[1..] shift on every history trim by design and must not
 * feed the session hash (see buildOpenCodeRequestHeaders).
 */
export function stableConversationAnchorKey(
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  modelId: string,
): string {
  const first = messages.length ? `${String(messages[0].role)}:${messageText(messages[0]).slice(0, 2048)}` : modelId;
  const toolNames = [...(options.tools ?? [])]
    .map((t) => t.name)
    .sort()
    .join(",");
  return stableHash(`${first}\ntools:${toolNames}\nmodel:${modelId}`);
}

export function cleanHeaderValue(value: string): string {
  const cleaned = value.replace(/[\r\n]/g, " ").trim();
  return cleaned ? cleaned.slice(0, 256) : "unknown";
}

export function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
