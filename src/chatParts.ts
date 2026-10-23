import * as vscode from "vscode";

const REASONING_DATA_MIME = "application/vnd.modelscope.reasoning+json";

export function isInternalDataPart(part: vscode.LanguageModelDataPart): boolean {
  return part.mimeType === REASONING_DATA_MIME;
}

export function createReasoningMarkerPart(reasoning: string): vscode.LanguageModelDataPart {
  const data = new TextEncoder().encode(JSON.stringify({ reasoning }));
  return new vscode.LanguageModelDataPart(data, REASONING_DATA_MIME);
}

export function isReasoningMarkerPart(part: vscode.LanguageModelDataPart): boolean {
  return part.mimeType === REASONING_DATA_MIME;
}

export function readReasoningMarker(part: vscode.LanguageModelDataPart): string | undefined {
  try {
    const payload = JSON.parse(new TextDecoder().decode(part.data)) as { reasoning?: unknown };
    return typeof payload.reasoning === "string" ? payload.reasoning : undefined;
  } catch {
    return undefined;
  }
}
