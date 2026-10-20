import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Issue #262 regression tests: the CLI history reader must read BOTH schemas
// (CLI 1.x `message` + CLI 2.x `session_message`) WITHOUT double-counting the
// rows the CLI 2.x migration copied into both tables. The tests build real
// SQLite databases with node:sqlite and run the exported SQL, so they verify
// the actual query behaviour (dedup, cwd join, provider filter) end-to-end
// rather than just the SQL string contents.

interface SqliteDb {
  prepare(sql: string): { all(): Record<string, unknown>[]; run(...args: unknown[]): unknown };
  close(): void;
}

function openDb(path: string): SqliteDb | undefined {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync?: new (p: string) => SqliteDb;
  };
  return typeof DatabaseSync === "function" ? new DatabaseSync(path) : undefined;
}

const MESSAGE_SCHEMA = `
  CREATE TABLE message (
    id text PRIMARY KEY,
    session_id text NOT NULL,
    time_created integer NOT NULL,
    time_updated integer NOT NULL,
    data text NOT NULL
  )`;

const SESSION_V2_SCHEMA = `
  CREATE TABLE session_v2 (
    id text PRIMARY KEY,
    directory text NOT NULL,
    model text,
    cost real DEFAULT 0 NOT NULL,
    time_created integer NOT NULL
  )`;

const SESSION_MESSAGE_SCHEMA = `
  CREATE TABLE session_message (
    id text PRIMARY KEY,
    session_id text NOT NULL,
    type text NOT NULL,
    seq integer NOT NULL,
    time_created integer NOT NULL,
    time_updated integer NOT NULL,
    data text NOT NULL
  )`;

/** A CLI 1.x assistant message row (flat JSON). */
const legacyRow = (id: string, cost: number, input: number, cwd: string, modelId: string, providerID = "opencode-go") =>
  JSON.stringify({
    role: "assistant",
    providerID,
    modelID: modelId,
    cost,
    tokens: { input, output: 10, reasoning: 0, "cache.read": 5 },
    path: { cwd },
    time: { created: 1789000000000 },
  });

/** The same message as the CLI 2.x `session_message` projection. */
const cli2Row = (id: string, cost: number, input: number, modelId: string) =>
  JSON.stringify({
    model: { providerID: "opencode-go", id: modelId, variant: "default" },
    cost,
    tokens: { input, output: 10, reasoning: 0, "cache.read": 5 },
    time: { created: 1789000000000 },
  });

describe("CLI history reader — dual schema (issue #262)", () => {
  it("probe parses which schemas exist", async () => {
    const { parseHistorySchemasProbeRow } = await import("../usage/history.js");
    assert.deepEqual(parseHistorySchemasProbeRow({ legacyPresent: 1, v2Present: 0 }), { legacy: true, cli2: false });
    assert.deepEqual(parseHistorySchemasProbeRow({ legacyPresent: 1, v2Present: 2 }), { legacy: true, cli2: true });
    assert.deepEqual(parseHistorySchemasProbeRow({ legacyPresent: 0, v2Present: 2 }), { legacy: false, cli2: true });
  });

  it("legacy-only database reads the message table and excludes non-Go providers", async () => {
    const { dbPath, dir } = withTempDb((db) => {
      db.prepare(MESSAGE_SCHEMA).run();
      insertLegacy(db, "m1", 0.5, 100, "/repo", "mimo-v2.5");
      // Zen (providerID 'opencode') and github-copilot rows must NOT count.
      insertLegacy(db, "m2", 9, 999, "/repo", "big-pickle", "opencode");
      insertLegacy(db, "m3", 9, 999, "/repo", "claude", "github-copilot");
    });
    await assertRows(dbPath, { rows: 1, cost: 0.5, cwd: "/repo", modelId: "mimo-v2.5" });
    rmSync(dir, { recursive: true, force: true });
  });

  it("CLI 2.x database deduplicates rows present in both schemas (no double count)", async () => {
    const { dbPath, dir } = withTempDb((db) => {
      db.prepare(MESSAGE_SCHEMA).run();
      db.prepare(SESSION_V2_SCHEMA).run();
      db.prepare(SESSION_MESSAGE_SCHEMA).run();
      db.prepare(`INSERT INTO session_v2 (id, directory, model, cost, time_created) VALUES ('s1', '/repo', '{}', 0, 1789000000000)`).run();
      // Same 3 Go rows in BOTH tables — exactly what the CLI 2.x migration
      // produces (it copies legacy message rows into session_message).
      for (const id of ["m1", "m2", "m3"]) {
        const cost = id === "m1" ? 0.5 : id === "m2" ? 0.25 : 1.25;
        insertLegacy(db, id, cost, 100, "/repo", "mimo-v2.5");
        insertCli2(db, id, "s1", cost, 100, "mimo-v2.5");
      }
      // Plus one CLI 2.x-ONLY row (new message written after the migration).
      insertCli2(db, "m4", "s1", 2, 400, "gpt-5.6-luna");
      // session_message also carries non-assistant rows and Zen usage — both excluded.
      db.prepare(`INSERT INTO session_message VALUES ('u1','s1','user',1,1789000000000,1789000000000,?)`).run(
        JSON.stringify({ text: "hi" }),
      );
      db.prepare(`INSERT INTO session_message VALUES ('z1','s1','assistant',2,1789000000000,1789000000000,?)`).run(
        JSON.stringify({
          model: { providerID: "opencode", id: "big-pickle" },
          cost: 9,
          tokens: { input: 999, output: 1 },
          time: { created: 1789000000000 },
        }),
      );
    });
    // 3 shared (counted once) + 1 CLI2-only = 4 rows; total 4.0 — NOT 7.75 (2× double count).
    await assertRows(dbPath, { rows: 4, cost: 4 });
    rmSync(dir, { recursive: true, force: true });
  });

  it("fresh CLI 2.x database without the legacy message table still reads history", async () => {
    const { dbPath, dir } = withTempDb((db) => {
      db.prepare(SESSION_V2_SCHEMA).run();
      db.prepare(SESSION_MESSAGE_SCHEMA).run();
      db.prepare(
        `INSERT INTO session_v2 (id, directory, model, cost, time_created) VALUES ('s9', '/workspace/project', '{}', 0, 1789000000000)`,
      ).run();
      insertCli2(db, "n1", "s9", 0.75, 50, "kimi-k3");
    });
    await assertRows(dbPath, { rows: 1, cost: 0.75, cwd: "/workspace/project", modelId: "kimi-k3" });
    rmSync(dir, { recursive: true, force: true });
  });
});

function insertLegacy(db: SqliteDb, id: string, cost: number, input: number, cwd: string, modelId: string, providerID?: string): void {
  db.prepare(`INSERT INTO message VALUES (?, 's1', 1789000000000, 1789000000000, ?)`).run(
    id,
    legacyRow(id, cost, input, cwd, modelId, providerID),
  );
}

function insertCli2(db: SqliteDb, id: string, sessionId: string, cost: number, input: number, modelId: string): void {
  db.prepare(`INSERT INTO session_message VALUES (?, ?, 'assistant', 1, 1789000000000, 1789000000000, ?)`).run(
    id,
    sessionId,
    cli2Row(id, cost, input, modelId),
  );
}

/** Build a temp DB, hand it to `build`, and return its path + dir (caller deletes). */
function withTempDb(build: (db: SqliteDb) => void): { dbPath: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "oc-history-test-"));
  const dbPath = join(dir, "test.db");
  const db = openDb(dbPath);
  assert.ok(db, "node:sqlite is unavailable — cannot run this test");
  try {
    build(db);
  } finally {
    db.close();
  }
  return { dbPath, dir };
}

/** Run the reader's exported SQL against the temp DB and assert the aggregate. */
async function assertRows(dbPath: string, expected: { rows: number; cost: number; cwd?: string; modelId?: string }): Promise<void> {
  const db = openDb(dbPath);
  assert.ok(db);
  try {
    const { selectHistoryRowsSql, parseHistorySchemasProbeRow } = await import("../usage/history.js");
    const probe = db
      .prepare(
        `SELECT
          (SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'message') AS legacyPresent,
          (SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name IN ('session_message', 'session_v2')) AS v2Present`,
      )
      .all()[0];
    const sql = selectHistoryRowsSql(parseHistorySchemasProbeRow(probe));
    const rows = db.prepare(sql).all();
    assert.equal(rows.length, expected.rows, `expected ${expected.rows} rows, got ${String(rows.length)}\nsql=${sql}`);
    const totalCost = rows.reduce((sum, row) => sum + (typeof row.cost === "number" ? row.cost : 0), 0);
    assert.ok(Math.abs(totalCost - expected.cost) < 1e-9, `expected cost ${String(expected.cost)}, got ${String(totalCost)}`);
    if (expected.cwd !== undefined) {
      assert.equal(rows[0].cwd, expected.cwd);
    }
    if (expected.modelId !== undefined) {
      assert.equal(rows[0].modelId, expected.modelId);
    }
  } finally {
    db.close();
  }
}
