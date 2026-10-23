import * as vscode from "vscode";
import { MODEL_METADATA_CACHE_KEY, MODEL_METADATA_FETCH_TIMEOUT_MS, MODELS_DEV_API_URL } from "../config";
import {
  bundledModelMetadataSnapshot,
  isFreshModelMetadata,
  normalizeModelsDevSnapshot,
  type CachedModelMetadataSnapshot,
  type ModelsDevResponse,
} from "./metadata";
import { getErrorMessage } from "../utils";
import { MODELSCOPE_CN_VENDOR, MODELSCOPE_GLOBAL_VENDOR } from "../providerTypes";

/**
 * In-memory models.dev metadata cache used by the ModelScope provider domain.
 */
let modelMetadataSnapshot: CachedModelMetadataSnapshot | undefined;
let modelMetadataRefreshPromise: Promise<CachedModelMetadataSnapshot> | undefined;

export function getModelMetadataSnapshot(): CachedModelMetadataSnapshot | undefined {
  return modelMetadataSnapshot;
}

export function setModelMetadataSnapshot(snapshot: CachedModelMetadataSnapshot | undefined): void {
  modelMetadataSnapshot = snapshot;
}

export function setModelMetadataRefreshPromise(promise: Promise<CachedModelMetadataSnapshot> | undefined): void {
  modelMetadataRefreshPromise = promise;
}

export async function clearModelMetadataCache(context: vscode.ExtensionContext): Promise<void> {
  modelMetadataSnapshot = undefined;
  modelMetadataRefreshPromise = undefined;
  await context.globalState.update(MODEL_METADATA_CACHE_KEY, undefined);
}

export async function getModelMetadata(
  context: vscode.ExtensionContext,
  output?: vscode.OutputChannel,
): Promise<CachedModelMetadataSnapshot> {
  const cached = modelMetadataSnapshot ?? context.globalState.get<CachedModelMetadataSnapshot>(MODEL_METADATA_CACHE_KEY);
  if (cached) {
    modelMetadataSnapshot = cached;
    if (isFreshModelMetadata(cached)) {
      return cached;
    }
    void refreshModelMetadata(context, output);
    return cached;
  }

  return refreshModelMetadata(context, output);
}

export async function refreshModelMetadata(
  context: vscode.ExtensionContext,
  output?: vscode.OutputChannel,
): Promise<CachedModelMetadataSnapshot> {
  if (modelMetadataRefreshPromise) {
    return modelMetadataRefreshPromise;
  }

  modelMetadataRefreshPromise = (async () => {
    const response = await fetch(MODELS_DEV_API_URL, {
      signal: AbortSignal.timeout(MODEL_METADATA_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`models.dev request failed (${String(response.status)}): ${response.statusText}`);
    }

    const data = (await response.json()) as ModelsDevResponse;
    const snapshot = normalizeModelsDevSnapshot(data);
    modelMetadataSnapshot = snapshot;
    await context.globalState.update(MODEL_METADATA_CACHE_KEY, snapshot);
    output?.appendLine(
      `[metadata] refreshed models.dev cache China=${Object.keys(snapshot.providers[MODELSCOPE_CN_VENDOR] ?? {}).length} Global=${Object.keys(snapshot.providers[MODELSCOPE_GLOBAL_VENDOR] ?? {}).length}`,
    );
    return snapshot;
  })()
    .catch((error: unknown) => {
      const cached = modelMetadataSnapshot ?? context.globalState.get<CachedModelMetadataSnapshot>(MODEL_METADATA_CACHE_KEY);
      if (cached) {
        const message = getErrorMessage(error);
        output?.appendLine(`[metadata] refresh failed, using cached snapshot: ${message}`);
        modelMetadataSnapshot = cached;
        return cached;
      }

      const message = getErrorMessage(error);
      const fallback = bundledModelMetadataSnapshot();
      output?.appendLine(`[metadata] refresh failed, using bundled snapshot: ${message}`);
      modelMetadataSnapshot = fallback;
      return fallback;
    })
    .finally(() => {
      modelMetadataRefreshPromise = undefined;
    });

  return modelMetadataRefreshPromise;
}
