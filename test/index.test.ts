import { describe, expect, it } from "vitest";
import app, { type Env } from "../src/index";

function fakeDb(rows: Record<string, unknown>[]): D1Database {
  const statement = {
    first: async () => ({ recipes: rows.length }),
    all: async () => ({ results: rows }),
  };
  return { prepare: () => statement } as unknown as D1Database;
}

function env(rows: Record<string, unknown>[] = []): Env {
  return { DB: fakeDb(rows), ASSETS: {} as Fetcher };
}

describe("api", () => {
  it("reports health with the recipe count", async () => {
    const res = await app.request("/api/health", {}, env([{ id: 1 }]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, recipes: 1 });
  });

  it("lists recipes", async () => {
    const rows = [{ id: 1, title: "Shakshuka", servings: 4 }];
    const res = await app.request("/api/recipes", {}, env(rows));
    expect(await res.json()).toEqual(rows);
  });

  it("returns JSON 404 for unknown API routes", async () => {
    const res = await app.request("/api/nope", {}, env());
    expect(res.status).toBe(404);
  });
});
