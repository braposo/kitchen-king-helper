import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import type { Env } from "../src/env";
import { call, testEnv } from "./helpers/d1";
import { seedDish, seedMeal, seedRecipe, seedRetreat } from "./helpers/fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/ai/status", () => {
  it("is not live without a key", async () => {
    expect(await call(app, testEnv(), "GET", "/api/ai/status")).toEqual({ status: 200, body: { live: false } });
  });

  it("is live when a key is set", async () => {
    const res = await call(app, testEnv({ JEV_API_KEY: "k" }), "GET", "/api/ai/status");
    expect(res.body).toEqual({ live: true });
  });
});

describe("POST /api/ai/recipes/:id/tag", () => {
  it("404s for an unknown recipe", async () => {
    const res = await call(app, testEnv(), "POST", "/api/ai/recipes/9/tag");
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });

  it("tags the recipe with the offline mock when no key is set", async () => {
    const env = testEnv();
    const recipe = await seedRecipe(env, {
      title: "Granola bowl",
      lines: [{ name: "oats" }, { name: "greek yoghurt" }],
      alternatives: [{ label: "Dairy-free", lines: [{ name: "oats" }, { name: "oat milk" }] }],
    });

    const res = await call(app, env, "POST", `/api/ai/recipes/${recipe.id}/tag`);

    expect(res.status).toBe(200);
    expect(res.body.category).toBe("brunch");
    expect(res.body.category_source).toBe("jev");
    expect(res.body.versions.map((v: { label: string }) => v.label)).toEqual(["Main version", "Dairy-free"]);
    const main = res.body.versions[0].tags.find((t: { tag: string }) => t.tag === "dairy_free");
    expect(main).toMatchObject({ value: false, source: "jev", unsure: true });
  });

  it("returns 502 with a readable message when Jev fails, and changes nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));
    const env = testEnv({ JEV_API_KEY: "k" });
    const recipe = await seedRecipe(env, { title: "Dal", lines: [{ name: "lentils" }] });

    const res = await call(app, env, "POST", `/api/ai/recipes/${recipe.id}/tag`);

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/nothing was changed/);
    const row = await env.DB.prepare("SELECT category FROM recipes WHERE id = ?").bind(recipe.id).first<{ category: string | null }>();
    expect(row?.category).toBeNull();
  });

  it("calls Jev over HTTP when a key is set", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { questions: { type: string }[] };
      return new Response(
        JSON.stringify({
          answers: body.questions.map((q) => (q.type === "choice" ? { probabilities: [0.1, 0.1, 0.1, 0.6, 0.1] } : { probability: 0.95 })),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const env = testEnv({ JEV_API_KEY: "k" });
    const recipe = await seedRecipe(env, { title: "Dal", lines: [{ name: "lentils" }] });

    const res = await call(app, env, "POST", `/api/ai/recipes/${recipe.id}/tag`);

    expect(res.status).toBe(200);
    expect(res.body.category).toBe("side");
    expect(res.body.versions[0].tags[0]).toMatchObject({ value: true, confidence: 0.95, unsure: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("GET /api/ai/recipes/:id/tags", () => {
  it("404s for an unknown recipe", async () => {
    expect((await call(app, testEnv(), "GET", "/api/ai/recipes/9/tags")).status).toBe(404);
  });

  it("returns the stored tags without calling Jev", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const env = testEnv({ JEV_API_KEY: "k" });
    const recipe = await seedRecipe(env, { title: "Dal", lines: [{ name: "lentils" }] });

    const res = await call(app, env, "GET", `/api/ai/recipes/${recipe.id}/tags`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      category: null,
      category_source: null,
      versions: [{ alternative_id: null, label: "Main version", tags: [] }],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("PUT /api/ai/recipes/:id/tags", () => {
  it("404s for an unknown recipe", async () => {
    const res = await call(app, testEnv(), "PUT", "/api/ai/recipes/9/tags", { category: "snack" });
    expect(res.status).toBe(404);
  });

  it("stores the chef's category and tags", async () => {
    const env = testEnv();
    const recipe = await seedRecipe(env, { title: "Dal", alternatives: [{ label: "Vegan", lines: [] }] });
    const altId = recipe.alternativeIds[0];

    const res = await call(app, env, "PUT", `/api/ai/recipes/${recipe.id}/tags`, {
      category: "dinner",
      tags: [
        { alternative_id: null, tag: "vegetarian", value: true },
        { alternative_id: altId, tag: "vegan", value: true },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body.category).toBe("dinner");
    expect(res.body.category_source).toBe("chef");
    expect(res.body.versions[0].tags).toEqual([{ tag: "vegetarian", value: true, confidence: null, source: "chef", unsure: false }]);
    expect(res.body.versions[1].tags[0]).toMatchObject({ tag: "vegan", value: true, source: "chef" });
  });

  it("clears the chef category with null", async () => {
    const env = testEnv();
    const recipe = await seedRecipe(env, { title: "Dal", category: "side", category_source: "chef", lines: [] });
    const res = await call(app, env, "PUT", `/api/ai/recipes/${recipe.id}/tags`, { category: null });
    expect(res.status).toBe(200);
    expect(res.body.category).toBeNull();
    expect(res.body.category_source).toBeNull();
  });

  it("makes a chef tag stick through a later Jev run", async () => {
    const env = testEnv();
    const recipe = await seedRecipe(env, { title: "Pork belly", lines: [{ name: "pork" }] });
    await call(app, env, "PUT", `/api/ai/recipes/${recipe.id}/tags`, {
      tags: [{ alternative_id: null, tag: "vegetarian", value: true }],
    });
    const res = await call(app, env, "POST", `/api/ai/recipes/${recipe.id}/tag`);
    const vegetarian = res.body.versions[0].tags.find((t: { tag: string }) => t.tag === "vegetarian");
    expect(vegetarian).toMatchObject({ value: true, source: "chef" });
  });

  it("rejects a bad category", async () => {
    const env = testEnv();
    const recipe = await seedRecipe(env, { title: "Dal" });
    const res = await call(app, env, "PUT", `/api/ai/recipes/${recipe.id}/tags`, { category: "lunch" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/brunch, snack, dinner, side, any/);
  });

  it("rejects a bad tag name, value or alternative", async () => {
    const env = testEnv();
    const recipe = await seedRecipe(env, { title: "Dal" });
    const put = (body: unknown) => call(app, env, "PUT", `/api/ai/recipes/${recipe.id}/tags`, body);

    expect((await put({ tags: [{ alternative_id: null, tag: "keto", value: true }] })).status).toBe(400);
    expect((await put({ tags: [{ alternative_id: null, tag: "vegan", value: "yes" }] })).status).toBe(400);
    expect((await put({ tags: [{ alternative_id: "x", tag: "vegan", value: true }] })).status).toBe(400);
    expect((await put({ tags: "vegan" })).status).toBe(400);
    expect((await put({ tags: [{ alternative_id: 999, tag: "vegan", value: true }] })).status).toBe(400);
  });

  it("rejects a body that is not a JSON object", async () => {
    const env = testEnv();
    const recipe = await seedRecipe(env, { title: "Dal" });
    expect((await call(app, env, "PUT", `/api/ai/recipes/${recipe.id}/tags`, ["vegan"])).status).toBe(400);
    expect((await call(app, env, "PUT", `/api/ai/recipes/${recipe.id}/tags`)).status).toBe(400);
  });
});

describe("GET /api/ai/meals/:mealId/suggestions", () => {
  it("404s for an unknown meal", async () => {
    expect((await call(app, testEnv(), "GET", "/api/ai/meals/9/suggestions")).status).toBe(404);
  });

  it("returns up to three suggestions for the meal", async () => {
    const env = testEnv();
    for (const title of ["Pancakes", "Granola", "Porridge", "Toast"]) {
      await seedRecipe(env, { title, category: "brunch", category_source: "chef" });
    }
    const retreat = await seedRetreat(env);
    const meal = await seedMeal(env, { retreatId: retreat, date: "2026-10-14", slot: "brunch" });

    const res = await call(app, env, "GET", `/api/ai/meals/${meal}/suggestions`);

    expect(res.status).toBe(200);
    expect(res.body.suggestions).toHaveLength(3);
    for (const s of res.body.suggestions) {
      expect(s).toEqual({ recipe_id: expect.any(Number), title: expect.any(String), probability: expect.any(Number) });
    }
  });

  it("returns an empty list when no recipe fits", async () => {
    const env = testEnv();
    const retreat = await seedRetreat(env);
    const meal = await seedMeal(env, { retreatId: retreat, date: "2026-10-14", slot: "dinner" });
    expect(await call(app, env, "GET", `/api/ai/meals/${meal}/suggestions`)).toEqual({ status: 200, body: { suggestions: [] } });
  });

  it("leaves out a dish already in the meal", async () => {
    const env = testEnv();
    const pancakes = await seedRecipe(env, { title: "Pancakes", category: "brunch", category_source: "chef" });
    const retreat = await seedRetreat(env);
    const meal = await seedMeal(env, { retreatId: retreat, date: "2026-10-14", slot: "brunch" });
    await seedDish(env, { mealId: meal, recipeId: pancakes.id });
    const res = await call(app, env, "GET", `/api/ai/meals/${meal}/suggestions`);
    expect(res.body.suggestions).toEqual([]);
  });

  it("returns 502 when Jev fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const env: Env = testEnv({ JEV_API_KEY: "k" });
    await seedRecipe(env, { title: "Pancakes", category: "brunch", category_source: "chef" });
    const retreat = await seedRetreat(env);
    const meal = await seedMeal(env, { retreatId: retreat, date: "2026-10-14", slot: "brunch" });
    const res = await call(app, env, "GET", `/api/ai/meals/${meal}/suggestions`);
    expect(res.status).toBe(502);
  });
});
