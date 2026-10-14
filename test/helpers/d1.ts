// A small D1 stand-in backed by Node's built-in SQLite, with every migration
// applied, so route tests run real SQL without Wrangler or Miniflare.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { Env } from "../../src/env";

const MIGRATIONS = join(import.meta.dirname, "../../migrations");

type Value = null | number | bigint | string | Uint8Array;

function toSqlite(value: unknown): Value {
  if (value === undefined) throw new Error("D1_TYPE_ERROR: undefined is not a supported bind value");
  if (typeof value === "boolean") return value ? 1 : 0;
  return value as Value;
}

class Statement {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private params: Value[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new Statement(this.db, this.sql, values.map(toSqlite));
  }

  private stmt(): StatementSync {
    return this.db.prepare(this.sql);
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.stmt().get(...this.params) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : { ...row }) as T;
  }

  async all<T = Record<string, unknown>>() {
    const results = this.stmt().all(...this.params).map((r) => ({ ...r })) as T[];
    return { results, success: true, meta: {} };
  }

  async raw<T = unknown[]>() {
    const stmt = this.stmt();
    stmt.setReturnArrays(true);
    return stmt.all(...this.params) as T[];
  }

  async run() {
    const sql = this.sql.trim().toUpperCase();
    if (sql.includes("RETURNING")) {
      const { results } = await this.all();
      return { results, success: true, meta: {} };
    }
    const info = this.stmt().run(...this.params);
    return {
      results: [],
      success: true,
      meta: { last_row_id: Number(info.lastInsertRowid), changes: Number(info.changes) },
    };
  }

  /** Used by batch(): run and return the D1-shaped result. */
  async exec() {
    return /^\s*(SELECT|WITH)/i.test(this.sql) || /RETURNING/i.test(this.sql) ? this.all() : this.run();
  }
}

export function createTestDb(): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  const d1 = {
    prepare: (sql: string) => new Statement(db, sql),
    // D1 runs a batch as one transaction.
    batch: async (statements: Statement[]) => {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of statements) out.push(await s.exec());
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    exec: async (sql: string) => {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
  };
  return d1 as unknown as D1Database;
}

export function testEnv(overrides: Partial<Env> = {}): Env {
  return { DB: createTestDb(), ASSETS: {} as Fetcher, ...overrides };
}

/** Calls the app with a JSON body and returns status plus parsed JSON. */
export async function call(
  app: { request: (path: string, init: RequestInit, env: Env) => Response | Promise<Response> },
  env: Env,
  method: string,
  path: string,
  body?: unknown,
) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  const res = await app.request(path, init, env);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
