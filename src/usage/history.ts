import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { execFileSync } from "child_process";
import type { UsageTodayYesterdaySource } from "../config";
import { getErrorMessage } from "../utils";
import type { UsageLogEntry } from "./tracker";

// ─── OpenCode SQLite history reader (same source as OpenUsage) ───────────────
// Reads from ~/.local/share/opencode/opencode.db
// SQL from https://github.com/robinebers/openusage/plugins/opencode-go/plugin.js

const OPENCODE_DB_PATH = path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");

/**
 * Per-message usage rows for the OpenCode Go provider.
 *
 * Two on-disk schemas carry the same data and both must be read:
 *
 * - CLI 1.x (`message`): flat JSON — `$.providerID`, `$.role`, `$.modelID`,
 *   `$.path.cwd`.
 * - CLI 2.x (`session_message`): role moved to the `type` COLUMN, provider and
 *   model moved under `$.model` (`$.model.providerID`, `$.model.id`), and
 *   `$.path.cwd` no longer exists — the working directory lives on the parent
 *   session (`session_v2.directory`) and is reached via `session_id`.
 *
 * The two tables overlap: a CLI 2.x database keeps the migrated legacy rows in
 * `message` as well, so the same message id can exist in both. Reading them
 * with `UNION` (not `UNION ALL`) over an identical projection deduplicates on
 * the full row; reading `session_v2` instead would be WRONG because that
 * table holds one aggregated row per SESSION, so it would double-count every
 * message that belongs to a session that also has a legacy row.
 *
 * `session_message` and `session_v2` may not exist on a CLI 1.x install, so
 * the query probes for them and falls back to the legacy table alone. The
 * probe is a separate statement because a missing table is a hard error at
 * prepare time — it cannot be guarded inside the SELECT.
 */
const HISTORY_ROWS_SQL = `
  SELECT
    CAST(COALESCE(json_extract(data, '$.time.created'), time_created) AS INTEGER) AS createdMs,
    CAST(json_extract(data, '$.cost') AS REAL) AS cost,
    CAST(json_extract(data, '$.tokens.input') AS INTEGER) AS tokensInput,
    CAST(json_extract(data, '$.tokens.output') AS INTEGER) AS tokensOutput,
    CAST(json_extract(data, '$.tokens.reasoning') AS INTEGER) AS tokensReasoning,
    CAST(json_extract(data, '$.tokens.cache.read') AS INTEGER) AS tokensCacheRead,
    json_extract(data, '$.path.cwd') AS cwd,
    json_extract(data, '$.modelID') AS modelId
  FROM message
  WHERE json_valid(data)
    AND json_extract(data, '$.providerID') = 'opencode-go'
    AND json_extract(data, '$.role') = 'assistant'
    AND json_type(data, '$.cost') IN ('integer', 'real')
`;

/**
 * CLI 2.x per-message rows. Mirrors {@link HISTORY_ROWS_SQL} field for field so
 * the two can be combined with `UNION` (which deduplicates on the full row).
 * The `id` is projected so overlapping rows from the two schemas collapse.
 */
const HISTORY_ROWS_SQL_V2 = `
  SELECT
    CAST(COALESCE(json_extract(sm.data, '$.time.created'), sm.time_created) AS INTEGER) AS createdMs,
    CAST(json_extract(sm.data, '$.cost') AS REAL) AS cost,
    CAST(json_extract(sm.data, '$.tokens.input') AS INTEGER) AS tokensInput,
    CAST(json_extract(sm.data, '$.tokens.output') AS INTEGER) AS tokensOutput,
    CAST(json_extract(sm.data, '$.tokens.reasoning') AS INTEGER) AS tokensReasoning,
    CAST(json_extract(sm.data, '$.tokens.cache.read') AS INTEGER) AS tokensCacheRead,
    s.directory AS cwd,
    json_extract(sm.data, '$.model.id') AS modelId
  FROM session_message sm
  JOIN session_v2 s ON s.id = sm.session_id
  WHERE json_valid(sm.data)
    AND sm.type = 'assistant'
    AND json_extract(sm.data, '$.model.providerID') = 'opencode-go'
    AND json_type(sm.data, '$.cost') IN ('integer', 'real')
`;

/**
 * The combined query: legacy rows plus CLI 2.x rows, deduplicated.
 *
 * `UNION` (not `UNION ALL`) removes the rows the two schemas share. A message
 * that exists in both tables has the same usage numbers in both, so the
 * duplicate collapses to a single row — no double counting.
 */
const HISTORY_ROWS_SQL_COMBINED = `
  ${HISTORY_ROWS_SQL}
  UNION
  ${HISTORY_ROWS_SQL_V2}
`;

/** Probe: which history schemas exist in this database? (one row: legacy + v2 counts) */
const CLI2_TABLES_PROBE_SQL = `
  SELECT
    (SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'message') AS legacyPresent,
    (SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name IN ('session_message', 'session_v2')) AS v2Present
`;

/** Interpret the probe's result row as which schemas are available (issue #262). */
export interface HistorySchemas {
  legacy: boolean;
  cli2: boolean;
}

export function parseHistorySchemasProbeRow(row: unknown): HistorySchemas {
  const counts = row as { legacyPresent?: unknown; v2Present?: unknown } | null | undefined;
  return {
    legacy: typeof counts?.legacyPresent === "number" && counts.legacyPresent >= 1,
    cli2: typeof counts?.v2Present === "number" && counts.v2Present >= 2,
  };
}

/**
 * Pick the history query for a database from its available schemas: the
 * combined (CLI 1.x + 2.x UNION, deduplicated) query when both exist, the
 * single-schema query when only one does. A missing table is a hard error at
 * prepare time, so the choice must be made before running the history query
 * — a fresh CLI 2.x install may not carry the legacy `message` table at all.
 */
export function selectHistoryRowsSql(schemas: HistorySchemas): string {
  if (schemas.legacy && schemas.cli2) return HISTORY_ROWS_SQL_COMBINED;
  return schemas.cli2 ? HISTORY_ROWS_SQL_V2 : HISTORY_ROWS_SQL;
}

export interface HistoryRow {
  createdMs: number;
  cost: number;
  tokensInput: number;
  tokensOutput: number;
  tokensReasoning: number;
  tokensCacheRead: number;
  /** Working directory of the session the message belongs to (OpenCode CLI data). */
  cwd?: string;
  /** Model that produced the message (OpenCode CLI data). */
  modelId?: string;
  /**
   * Total tokens for the message: input + output + reasoning + cache.read.
   * The CLI's `tokens.input` EXCLUDES cached tokens — the authoritative
   * `tokens.total` matches input + output + reasoning + cache.read — so this
   * sum is what any "tokens used" display must count (parity with the
   * extension's own promptTokens, which include cached tokens).
   */
  tokensTotal: number;
}

/** Non-negative finite integer (tokens can legitimately be 0). */
function positiveNumberish(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/**
 * Sum one day window across the OpenCode CLI history rows and the extension's
 * tracked entries. The CLI records terminal usage and the extension records
 * VS Code usage — they never overlap, so the sum is the user's real combined
 * usage for the window. `source` selects which inputs participate.
 */
export function sumDailyUsage(
  rows: HistoryRow[],
  entries: UsageLogEntry[],
  dayStartMs: number,
  source: UsageTodayYesterdaySource = "auto",
): UsageDaily {
  let cost = 0;
  let requests = 0;
  let tokens = 0;

  if (source !== "extension") {
    for (const row of rows) {
      if (row.createdMs < dayStartMs) continue;
      cost += row.cost;
      requests += 1;
      tokens += row.tokensTotal;
    }
  }

  if (source !== "cli") {
    for (const entry of entries) {
      if (entry.timestamp < dayStartMs) continue;
      cost += entry.cost;
      requests += 1;
      tokens += entry.promptTokens + entry.completionTokens;
    }
  }

  return { cost, requests, tokens };
}

/** Per-day / per-workspace usage totals (from CLI history and/or extension tracking). */
export interface UsageDaily {
  cost: number;
  requests: number;
  tokens: number;
}

/** One day bucket of the usage chart. */
export interface UsageDayPoint {
  /** Unix ms at the START of the day (UTC or local, per the day-boundary setting). */
  dayStart: number;
  cost: number;
  tokens: number;
  requests: number;
}

/** Per-model usage for a single day (model bar chart). */
export interface ModelDayUsage {
  model: string;
  dayStart: number;
  cost: number;
  tokens: number;
  requests: number;
}

/** Time-series data for the usage panel charts. */
export interface UsageSeries {
  /** Daily totals, oldest → newest. */
  days: UsageDayPoint[];
  /** Per-model-per-day rows (only days with usage are present). */
  byModel: ModelDayUsage[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Bucket CLI rows + extension entries into per-day totals and per-model
 * per-day rows over the last `days` days (the oldest bucket starts at
 * `dayStartMs - (days - 1) * DAY_MS`). Pure so it can be unit-tested.
 */
export function buildUsageSeries(
  rows: HistoryRow[],
  entries: UsageLogEntry[],
  days: number,
  dayStartMs: number,
  source: UsageTodayYesterdaySource = "auto",
): UsageSeries {
  // days > 0: the last `days` days ending at dayStartMs; days <= 0: lifetime
  // from the earliest recorded usage to today (aligned to the day grid).
  let firstDay: number;
  if (days > 0) {
    firstDay = dayStartMs - (Math.max(1, Math.floor(days)) - 1) * DAY_MS;
  } else {
    let earliest = dayStartMs;
    if (source !== "extension") {
      for (const row of rows) if (row.createdMs < earliest) earliest = row.createdMs;
    }
    if (source !== "cli") {
      for (const entry of entries) if (entry.timestamp < earliest) earliest = entry.timestamp;
    }
    firstDay = dayStartMs - Math.ceil((dayStartMs - earliest) / DAY_MS) * DAY_MS;
  }
  const bucketCount = Math.round((dayStartMs - firstDay) / DAY_MS) + 1;
  const buckets: UsageDayPoint[] = Array.from({ length: bucketCount }, (_, i) => ({
    dayStart: firstDay + i * DAY_MS,
    cost: 0,
    tokens: 0,
    requests: 0,
  }));
  const byModel = new Map<string, Map<number, ModelDayUsage>>();

  const add = (model: string | undefined, timestamp: number, cost: number, tokens: number): void => {
    // Bucket by the day whose [start, start+DAY) range contains the event.
    // floor (not round) keeps mid-day events in the correct day — round could
    // push an afternoon event into the next day's bucket.
    const index = Math.floor((timestamp - firstDay) / DAY_MS);
    if (index < 0 || index >= bucketCount) return;
    const day = buckets[index];
    day.cost += cost;
    day.tokens += tokens;
    day.requests += 1;

    const modelName = model ?? "unknown";
    let byDay = byModel.get(modelName);
    if (!byDay) {
      byDay = new Map();
      byModel.set(modelName, byDay);
    }
    const point = byDay.get(index) ?? { model: modelName, dayStart: day.dayStart, cost: 0, tokens: 0, requests: 0 };
    point.cost += cost;
    point.tokens += tokens;
    point.requests += 1;
    byDay.set(index, point);
  };

  if (source !== "extension") {
    for (const row of rows) {
      add(row.modelId, row.createdMs, row.cost, row.tokensTotal);
    }
  }
  if (source !== "cli") {
    for (const entry of entries) {
      add(entry.modelId, entry.timestamp, entry.cost, entry.promptTokens + entry.completionTokens);
    }
  }

  return {
    days: buckets,
    byModel: [...byModel.entries()].flatMap(([, byDay]) =>
      [...byDay.entries()].sort((left, right) => left[0] - right[0]).map(([, point]) => point),
    ),
  };
}

/**
 * The CLI database can be gigabytes large and spawning `sqlite3` is a
 * synchronous, blocking call — but the usage UI (status bar, tooltip, panel,
 * quick-pick) re-reads it on every refresh. Memoize the result for a short
 * window so a burst of refreshes pays the query cost once.
 */
const HISTORY_READ_TTL_MS = 3_000;
let historyCache: { rows: HistoryRow[] | null; fetchedAt: number } | undefined;
/** Surfaces CLI-history read failures in the usage output channel. */
let historyReadDiagnostic: ((message: string) => void) | undefined;

/** Wire the diagnostic sink (called once per tracker, last one wins). */
export function setHistoryReadDiagnostic(log: (message: string) => void): void {
  historyReadDiagnostic = log;
}

export function readOpenCodeHistory(): HistoryRow[] | null {
  const now = Date.now();
  if (historyCache && now - historyCache.fetchedAt < HISTORY_READ_TTL_MS) {
    return historyCache.rows;
  }
  const rows = readOpenCodeHistoryUncached();
  historyCache = { rows, fetchedAt: now };
  return rows;
}

function readOpenCodeHistoryUncached(): HistoryRow[] | null {
  if (!fs.existsSync(OPENCODE_DB_PATH)) {
    historyReadDiagnostic?.(`[go-usage] CLI history: database not found at ${OPENCODE_DB_PATH}`);
    return null;
  }

  // The `sqlite3` binary may be missing from the extension host's PATH (it is
  // often only available from the Android SDK, e.g. launched from a terminal),
  // so Node's built-in reader is tried first — zero external dependencies.
  const viaNode = readHistoryViaNodeSqlite();
  if (viaNode !== undefined) {
    return viaNode;
  }

  return readHistoryViaSqliteCli();
}

/** Normalize raw rows (shared by both readers). */
function normalizeHistoryRows(rows: unknown): HistoryRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row): row is HistoryRow => {
      if (!row || typeof row !== "object") return false;
      const candidate = row as Partial<HistoryRow>;
      return (
        typeof candidate.createdMs === "number" && candidate.createdMs > 0 && typeof candidate.cost === "number" && candidate.cost >= 0
      );
    })
    .map((row) => {
      const tokensInput = positiveNumberish(row.tokensInput);
      const tokensOutput = positiveNumberish(row.tokensOutput);
      const tokensReasoning = positiveNumberish(row.tokensReasoning);
      const tokensCacheRead = positiveNumberish(row.tokensCacheRead);
      return {
        createdMs: row.createdMs,
        cost: row.cost,
        tokensInput,
        tokensOutput,
        tokensReasoning,
        tokensCacheRead,
        tokensTotal: tokensInput + tokensOutput + tokensReasoning + tokensCacheRead,
        cwd: typeof row.cwd === "string" && row.cwd.trim() ? row.cwd : undefined,
        modelId: typeof row.modelId === "string" && row.modelId.trim() ? row.modelId : undefined,
      };
    });
}

/**
 * Read the CLI history with Node's built-in `node:sqlite` (no binary on the
 * host PATH needed). Returns `undefined` when the module is unavailable on
 * this host so the caller can fall back to the `sqlite3` binary.
 */
function readHistoryViaNodeSqlite(): HistoryRow[] | null | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync?: new (
        path: string,
        options?: { readOnly?: boolean },
      ) => {
        prepare(sql: string): { all(): Record<string, unknown>[] };
        close(): void;
      };
    };
    if (typeof DatabaseSync !== "function") {
      return undefined;
    }
    // Transient busy/lock states (CLI checkpointing the WAL) resolve quickly.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const db = new DatabaseSync(OPENCODE_DB_PATH, { readOnly: true });
        try {
          // Issue #262: CLI >= 2.0 moved per-message usage into session_message
          // (with the cwd on the parent session_v2 row). Probe which schema
          // exists, then run the matching query.
          const probe = db.prepare(CLI2_TABLES_PROBE_SQL).all()[0];
          const rows = db.prepare(selectHistoryRowsSql(parseHistorySchemasProbeRow(probe))).all();
          return rows.length > 0 ? normalizeHistoryRows(rows) : null;
        } finally {
          db.close();
        }
      } catch (error) {
        const message = getErrorMessage(error);
        if (attempt === 0) {
          historyReadDiagnostic?.(`[go-usage] node:sqlite read failed (attempt 1): ${message}. Retrying…`);
        } else {
          historyReadDiagnostic?.(`[go-usage] node:sqlite read failed: ${message}`);
        }
      }
    }
    return null;
  } catch (error) {
    historyReadDiagnostic?.(`[go-usage] node:sqlite unavailable (${getErrorMessage(error)}); falling back to the sqlite3 binary.`);
    return undefined;
  }
}

/**
 * Candidate `sqlite3` binaries: the PATH-resolved name first, then absolute
 * paths from common installs (system, Homebrew, Android SDK) — the Android
 * SDK binary is what most dev machines actually have, and it is frequently
 * missing from the extension host's PATH.
 */
function sqliteCliCandidates(): string[] {
  const home = os.homedir();
  return [
    "sqlite3",
    "/usr/bin/sqlite3",
    "/usr/local/bin/sqlite3",
    "/opt/homebrew/bin/sqlite3",
    path.join(home, "Android", "Sdk", "platform-tools", "sqlite3"),
    path.join(home, "Library", "Android", "sdk", "platform-tools", "sqlite3"),
  ];
}

function readHistoryViaSqliteCli(): HistoryRow[] | null {
  for (const binary of sqliteCliCandidates()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // Issue #262: probe the schema first (see readHistoryViaNodeSqlite).
        const probeResult = execFileSync(binary, ["-readonly", "-cmd", ".timeout 5000", "-json", OPENCODE_DB_PATH, CLI2_TABLES_PROBE_SQL], {
          timeout: 10_000,
          maxBuffer: 1024 * 1024,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        const probeRows: unknown = JSON.parse(probeResult);
        const schemas = Array.isArray(probeRows) ? parseHistorySchemasProbeRow(probeRows[0]) : { legacy: true, cli2: false };
        const result = execFileSync(
          binary,
          ["-readonly", "-cmd", ".timeout 5000", "-json", OPENCODE_DB_PATH, selectHistoryRowsSql(schemas)],
          {
            timeout: 10_000,
            // 256MB: a power user's full CLI history JSON can exceed 64MB; a too-
            // small cap silently makes the usage panel show no history at all.
            maxBuffer: 256 * 1024 * 1024,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
        const rows: unknown = JSON.parse(result);
        return Array.isArray(rows) ? normalizeHistoryRows(rows) : null;
      } catch (error) {
        const message = getErrorMessage(error);
        // ENOENT just means this candidate isn't present — try the next one.
        if (attempt === 0 && message.includes("ENOENT")) {
          break;
        }
        if (attempt === 0) {
          historyReadDiagnostic?.(`[go-usage] sqlite3 read failed (attempt 1): ${message}. Retrying…`);
        } else {
          historyReadDiagnostic?.(`[go-usage] sqlite3 read failed (${binary}): ${message}`);
        }
      }
    }
  }
  historyReadDiagnostic?.(
    "[go-usage] CLI history unavailable: no SQLite reader found (node:sqlite missing and no sqlite3 binary on PATH).",
  );
  return null;
}
