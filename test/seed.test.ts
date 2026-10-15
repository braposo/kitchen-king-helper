import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import app from "../src/index";
import { call, testEnv } from "./helpers/d1";

const SEED = join(import.meta.dirname, "../seed");
const sql = (file: string) => readFileSync(join(SEED, file), "utf8");

describe("sample recipes seed", () => {
  it("loads ten recipes the API can read, and can be run twice", async () => {
    const env = testEnv();
    await env.DB.exec(sql("sample-recipes.sql"));
    await env.DB.exec(sql("sample-recipes.sql"));

    const list = await call(app, env, "GET", "/api/recipes");
    expect(list.status).toBe(200);
    const recipes = Array.isArray(list.body) ? list.body : list.body.recipes;
    expect(recipes).toHaveLength(10);
    expect(recipes.every((r: { title: string }) => r.title.endsWith(" (sample)"))).toBe(true);

    const stew = recipes.find((r: { title: string }) => r.title.startsWith("Beef and ale stew"));
    const full = await call(app, env, "GET", `/api/recipes/${stew.id}`);
    expect(full.body.category).toBe("dinner");
    expect(full.body.ingredients.length).toBeGreaterThan(5);
    expect(full.body.alternatives).toHaveLength(1);
    expect(full.body.alternatives[0].ingredients.length).toBeGreaterThan(5);
  });

  it("removes the samples but keeps ingredients real recipes use", async () => {
    const env = testEnv();
    await env.DB.exec(sql("sample-recipes.sql"));
    const own = await call(app, env, "POST", "/api/recipes", {
      title: "Chef's eggs",
      servings: 4,
      ingredients: [{ name: "Eggs", base_unit: "each", quantity_per_serving: 2 }],
    });
    expect(own.status).toBe(201);

    await env.DB.exec(sql("remove-samples.sql"));
    const left = await env.DB.prepare("SELECT (SELECT count(*) FROM recipes) r, (SELECT group_concat(name) FROM ingredients) i, (SELECT count(*) FROM suppliers) s").first();
    expect(left).toEqual({ r: 1, i: "Eggs", s: 0 });
  });
});
