/**
 * Anthropic-family request body builder.
 *
 * Builds the Anthropic Messages API wire payload (Claude models, plus Qwen and
 * MiniMax m2.* routed through the messages endpoint).
 *
 * CONTRACT: pure functions only — `vscode` is used as a TYPE and for the
 * `LanguageModelChatToolMode` enum value only; no extension-host side effects.
 */
import * as vscode from "vscode";
import { joinedTextContent } from "../responsesRequest";
import { thinkingProviderFor } from "../thinking";
import { sanitizeToolSchema } from "./schema";
import { messagesHaveImages } from "./shared";
import type { ResolvedModelMetadata } from "../models/metadata";
import type { ModelLimits } from "../models/modelLimits";
import type {
  ApiMessage,
  ApiSettings,
  OpenAiContentPart,
  AnthropicToolDefinition,
  AnthropicRequestMessage,
  AnthropicCacheControl,
  AnthropicContentBlock,
  AnthropicImageSource,
} from "./types";

export function buildAnthropicMessagesRequestBody(
  modelId: string,
  messages: ApiMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  settings: ApiSettings,
  metadata: ResolvedModelMetadata,
  limits: ModelLimits,
): Record<string, unknown> {
  const tools = mapAnthropicTools(options.tools);
  // The per-provider strategy picks the Anthropic-native thinking shape for
  // Qwen on this endpoint ({ type: "enabled"|"disabled" }, budget_tokens).
  const thinkingPayload = thinkingProviderFor(modelId, metadata).buildPayload(settings.thinking, {
    hasImageInput: messagesHaveImages(messages),
    endpoint: "messages",
  });
  const anthropicMessages = buildAnthropicMessages(messages);

  return {
    model: modelId,
    // Only send temperature if the model supports it (not deprecated)
    ...(metadata.temperature !== false ? { temperature: settings.temperature } : {}),
    max_tokens: limits.maxOutputTokens,
    stream: true,
    messages: anthropicMessages,
    ...thinkingPayload,
    ...(tools.length ? { tools, tool_choice: anthropicToolChoice(options.toolMode) } : {}),
  };
}

export function buildAnthropicMessages(messages: ApiMessage[]): AnthropicRequestMessage[] {
  // Cache-stable breakpoints: at most 2 marks at structural boundaries —
  // (1) end of the first (anchor/static-prefix) message and (2) end of the
  // message before the latest user turn (growing-tail checkpoint). Per-block
  // marking (first-4-blocks) shifted every later breakpoint whenever any
  // earlier turn gained a text/image part, and exhausted the 4-slot budget
  // that gateways may also inject into. Writes happen only at breakpoints and
  // reads walk back max 20 blocks, so these two positions cover both the
  // static prefix and the conversation tail without drift.
  const markTargets = new Set<number>();
  if (messages.length >= 1) markTargets.add(0);
  if (messages.length >= 3) markTargets.add(messages.length - 2);
  let messageIndex = 0;
  const nextCacheControlFor = (msgIdx: number, isLastBlockOfMessage: boolean): { cache_control?: AnthropicCacheControl } => {
    if (isLastBlockOfMessage && markTargets.has(msgIdx)) {
      return { cache_control: { type: "ephemeral" } };
    }
    return {};
  };

  const anthropicMessages: AnthropicRequestMessage[] = [];

  for (const message of messages) {
    const msgIdx = messageIndex++;
    if (message.role === "user") {
      const userBlocks = anthropicUserBlocks(message.content, (last) => nextCacheControlFor(msgIdx, last));
      if (userBlocks.length) {
        anthropicMessages.push({ role: "user", content: userBlocks });
      }
      continue;
    }

    if (message.role === "assistant") {
      const assistantBlocks = anthropicAssistantBlocks(message, (last) => nextCacheControlFor(msgIdx, last));
      if (assistantBlocks.length) {
        anthropicMessages.push({ role: "assistant", content: assistantBlocks });
      }
      continue;
    }

    // After the user/assistant continues above, role is narrowed to "tool".
    if (message.tool_call_id) {
      anthropicMessages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: message.tool_call_id,
            content: anthropicToolResultContent(message.content),
            ...nextCacheControlFor(msgIdx, true),
          },
        ],
      });
    }
  }

  if (!anthropicMessages.length) {
    anthropicMessages.push({
      role: "user",
      content: [{ type: "text", text: "Continue the conversation." }],
    });
  }

  return anthropicMessages;
}

function anthropicUserBlocks(
  content: ApiMessage["content"],
  mark: (isLastBlockOfMessage: boolean) => { cache_control?: AnthropicCacheControl },
): AnthropicContentBlock[] {
  if (typeof content === "string") {
    return content.trim() ? [{ type: "text", text: content, ...mark(true) }] : [];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  const blocks: AnthropicContentBlock[] = [];
  // Collect candidate blocks first so only the LAST block of the message
  // carries the breakpoint — earlier blocks stay unmarked and stable.
  const raw: AnthropicContentBlock[] = [];
  for (const part of content) {
    if (part.type === "text" && typeof part.text === "string" && part.text.length > 0) {
      raw.push({ type: "text", text: part.text });
      continue;
    }

    if (part.type === "image_url") {
      const source = anthropicImageSource(part);
      if (source) {
        raw.push({ type: "image", source });
      }
    }
  }
  raw.forEach((block, i) => {
    blocks.push(i === raw.length - 1 ? { ...block, ...mark(true) } : block);
  });

  return blocks;
}

// RULES: Anthropic tool_result.content accepts either a plain string or a
// list of content blocks. We use the string form when the message has no
// images (the common case, smaller payload), and fall back to the array form
// (text + image blocks) only when an image_url part is present. This keeps
// text-only tool results byte-for-byte identical to the previous behavior
// while enabling vision-capable Anthropic models to consume MCP screenshots.
function anthropicToolResultContent(content: ApiMessage["content"]): string | AnthropicContentBlock[] {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const hasImage = content.some((part) => part.type === "image_url" && part.image_url?.url);
  if (!hasImage) {
    return joinedTextContent(content, "\n");
  }

  return anthropicUserBlocks(content, () => ({}));
}

function anthropicAssistantBlocks(
  message: ApiMessage,
  mark: (isLastBlockOfMessage: boolean) => { cache_control?: AnthropicCacheControl },
): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = [];

  const text = joinedTextContent(message.content);
  if (text) {
    blocks.push({ type: "text", text });
  }

  for (const toolCall of message.tool_calls ?? []) {
    blocks.push({
      type: "tool_use",
      id: toolCall.id || `toolu_${Math.random().toString(36).slice(2)}`,
      name: toolCall.function.name,
      input: anthropicToolCallInput(toolCall.function.arguments),
    });
  }
  if (blocks.length) {
    const last = blocks.length - 1;
    blocks[last] = { ...blocks[last], ...mark(true) };
  }

  return blocks;
}

function anthropicToolCallInput(argumentsText: string): unknown {
  if (!argumentsText.trim()) {
    return {};
  }

  try {
    return JSON.parse(argumentsText);
  } catch {
    return argumentsText;
  }
}

function anthropicImageSource(part: OpenAiContentPart): AnthropicImageSource | undefined {
  if (part.type !== "image_url") {
    return undefined;
  }

  const url = part.image_url?.url;
  if (typeof url !== "string" || !url) {
    return undefined;
  }

  const match = /^data:([^;]+);base64,(.*)$/i.exec(url);
  if (match) {
    return {
      type: "base64",
      media_type: match[1],
      data: match[2],
    };
  }

  return { type: "url", url };
}

function mapAnthropicTools(tools: readonly vscode.LanguageModelChatTool[] | undefined): AnthropicToolDefinition[] {
  const sorted = [...(tools ?? [])].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return sorted.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: sanitizeToolSchema(tool.inputSchema),
  }));
}

function anthropicToolChoice(mode: vscode.LanguageModelChatToolMode): { type: "auto" | "any" } {
  return { type: mode === vscode.LanguageModelChatToolMode.Required ? "any" : "auto" };
}
