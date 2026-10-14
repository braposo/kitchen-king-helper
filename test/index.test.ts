import { describe, expect, it } from "vitest";
import app from "../src/index";
import { call, testEnv } from "./helpers/d1";

describe("api", () => {
  it("reports health with the recipe count", async () => {
    const env = testEnv();
    await env.DB.prepare("INSERT INTO recipes (title, servings) VALUES (?, ?)").bind("Shakshuka", 4).run();
    const res = await call(app, env, "GET", "/api/health");
    expect(res).toEqual({ status: 200, body: { ok: true, recipes: 1 } });
  });

  it("lists recipes", async () => {
    const env = testEnv();
    await env.DB.prepare("INSERT INTO recipes (title, servings) VALUES (?, ?)").bind("Shakshuka", 4).run();
    const res = await call(app, env, "GET", "/api/recipes");
    expect(res.body).toEqual([{ id: 1, title: "Shakshuka", servings: 4 }]);
  });

  it("returns JSON 404 for unknown API routes", async () => {
    const res = await call(app, testEnv(), "GET", "/api/nope");
    expect(res.status).toBe(404);
  });

  it("applies every migration", async () => {
    const env = testEnv();
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'order_line_state'").first<{ n: number }>();
    expect(row?.n).toBe(1);
  });
});
