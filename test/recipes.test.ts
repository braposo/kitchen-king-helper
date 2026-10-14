import { describe, expect, it } from "vitest";
import app from "../src/index";
import { call, testEnv } from "./helpers/d1";

const shakshuka = {
  title: "Shakshuka",
  servings: 10,
  method: "Cook it.",
  ingredients: [
    { name: "Eggs", base_unit: "each", storage: "fresh", quantity_per_serving: 1 },
    { name: "Chopped tomatoes", base_unit: "g", quantity_per_serving: 80, prep_note: "tinned" },
  ],
};

async function create(env: ReturnType<typeof testEnv>, body: unknown = shakshuka) {
  const res = await call(app, env, "POST", "/api/recipes", body);
  expect(res.status).toBe(201);
  return res.body;
}

describe("recipes", () => {
  it("creates a recipe with inline ingredients and returns it in full", async () => {
    const env = testEnv();
    const r = await create(env);
    expect(r).toMatchObject({ id: 1, title: "Shakshuka", servings: 10, method: "Cook it.", notes: null, category: null, category_source: null });
    expect(r.ingredients).toEqual([
      { ingredient_id: 1, name: "Eggs", base_unit: "each", storage: "fresh", quantity_per_serving: 1, prep_note: null, position: 0 },
      { ingredient_id: 2, name: "Chopped tomatoes", base_unit: "g", storage: "pantry", quantity_per_serving: 80, prep_note: "tinned", position: 1 },
    ]);
    expect(r.alternatives).toEqual([]);
    expect((await call(app, env, "GET", "/api/recipes/1")).body).toEqual(r);
  });

  it("reuses ingredients by name ignoring case, or by id", async () => {
    const env = testEnv();
    await create(env);
    const second = await create(env, {
      title: "Eggs on toast",
      servings: 4,
      ingredients: [
        { name: "eggs", base_unit: "each", quantity_per_serving: 2 },
        { ingredient_id: 2, quantity_per_serving: 10 },
        { name: "Bread", base_unit: "each", quantity_per_serving: 2 },
      ],
    });
    expect(second.ingredients.map((l: any) => [l.ingredient_id, l.name])).toEqual([[1, "Eggs"], [2, "Chopped tomatoes"], [3, "Bread"]]);
    const all = await call(app, env, "GET", "/api/ingredients");
    expect(all.body).toHaveLength(3);
  });

  it("creates and updates alternatives, keeping ids stable and removing the rest", async () => {
    const env = testEnv();
    const r = await create(env, {
      ...shakshuka,
      alternatives: [
        { label: "Vegan", ingredients: [{ name: "Tofu", base_unit: "g", quantity_per_serving: 60 }] },
        { label: "Gluten free", notes: "No toast", ingredients: [] },
      ],
    });
    expect(r.alternatives.map((a: any) => [a.id, a.label])).toEqual([[1, "Vegan"], [2, "Gluten free"]]);
    expect(r.alternatives[0].ingredients[0]).toMatchObject({ name: "Tofu", quantity_per_serving: 60 });

    const updated = await call(app, env, "PUT", "/api/recipes/1", {
      title: "Shakshuka v2",
      servings: 12,
      ingredients: [{ ingredient_id: 1, quantity_per_serving: 2 }],
      alternatives: [
        { id: 1, label: "Vegan version", ingredients: [{ name: "Tofu", base_unit: "g", quantity_per_serving: 70 }, { name: "Eggs", base_unit: "each", quantity_per_serving: 0 }] },
        { label: "Dairy free", ingredients: [] },
      ],
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ title: "Shakshuka v2", servings: 12, method: null });
    expect(updated.body.ingredients).toHaveLength(1);
    expect(updated.body.alternatives.map((a: any) => [a.id, a.label])).toEqual([[1, "Vegan version"], [3, "Dairy free"]]);
    expect(updated.body.alternatives[0].ingredients.map((l: any) => l.quantity_per_serving)).toEqual([70, 0]);
    // Lines of the removed alternative are gone with it.
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM recipe_ingredients").first<{ n: number }>();
    expect(left?.n).toBe(1 + 2);
  });

  it("lists recipes sorted by title with category and alternative count, and filters with ?q=", async () => {
    const env = testEnv();
    await create(env, { ...shakshuka, title: "shakshuka", category: "brunch", alternatives: [{ label: "Vegan", ingredients: [] }] });
    await create(env, { title: "Apple cake", servings: 8, ingredients: [] });
    await create(env, { title: "50% off_cuts", servings: 8, ingredients: [] });
    const all = await call(app, env, "GET", "/api/recipes");
    expect(all.body).toEqual([
      { id: 3, title: "50% off_cuts", servings: 8, category: null, alternatives: 0 },
      { id: 2, title: "Apple cake", servings: 8, category: null, alternatives: 0 },
      { id: 1, title: "shakshuka", servings: 10, category: "brunch", alternatives: 1 },
    ]);
    expect((await call(app, env, "GET", "/api/recipes?q=SHAK")).body.map((r: any) => r.id)).toEqual([1]);
    expect((await call(app, env, "GET", "/api/recipes?q=%25")).body.map((r: any) => r.id)).toEqual([3]);
  });

  it("marks a given category as the chef's, and keeps a suggestion's source when sent back unchanged", async () => {
    const env = testEnv();
    const r = await create(env, { ...shakshuka, category: "brunch" });
    expect(r).toMatchObject({ category: "brunch", category_source: "chef" });

    await env.DB.prepare("UPDATE recipes SET category = 'dinner', category_source = 'jev' WHERE id = 1").run();
    const same = await call(app, env, "PUT", "/api/recipes/1", { ...shakshuka, category: "dinner" });
    expect(same.body).toMatchObject({ category: "dinner", category_source: "jev" });
    const absent = await call(app, env, "PUT", "/api/recipes/1", shakshuka);
    expect(absent.body).toMatchObject({ category: "dinner", category_source: "jev" });
    const changed = await call(app, env, "PUT", "/api/recipes/1", { ...shakshuka, category: "side" });
    expect(changed.body).toMatchObject({ category: "side", category_source: "chef" });
    const cleared = await call(app, env, "PUT", "/api/recipes/1", { ...shakshuka, category: "" });
    expect(cleared.body).toMatchObject({ category: null, category_source: null });
  });

  it("validates the body", async () => {
    const env = testEnv();
    const bad = async (body: unknown, message: RegExp) => {
      const res = await call(app, env, "POST", "/api/recipes", body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(message);
    };
    await bad({ ...shakshuka, title: " " }, /title/i);
    await bad({ ...shakshuka, servings: 0 }, /servings/i);
    await bad({ ...shakshuka, servings: 2.5 }, /servings/i);
    await bad({ ...shakshuka, category: "lunch" }, /category/i);
    await bad({ ...shakshuka, ingredients: [{ name: "Eggs", base_unit: "each", quantity_per_serving: -1 }] }, /amount/i);
    await bad({ ...shakshuka, ingredients: [{ name: "Eggs", base_unit: "pinch", quantity_per_serving: 1 }] }, /unit/i);
    await bad({ ...shakshuka, ingredients: [{ quantity_per_serving: 1 }] }, /name/i);
    await bad({ ...shakshuka, ingredients: [{ ingredient_id: 99, quantity_per_serving: 1 }] }, /no longer exists/i);
    await bad({ ...shakshuka, alternatives: [{ label: "", ingredients: [] }] }, /name/i);
    expect((await call(app, env, "GET", "/api/recipes")).body).toEqual([]);
    expect((await call(app, env, "GET", "/api/ingredients")).body).toEqual([]);
  });

  it("saves a long recipe with many new ingredients in few statements", async () => {
    const env = testEnv();
    const lines = Array.from({ length: 30 }, (_, n) => ({ name: `Thing ${n % 28}`, base_unit: "g", quantity_per_serving: n }));
    let statements = 0;
    const batch = env.DB.batch.bind(env.DB);
    env.DB.batch = (async (s: any[]) => ((statements = s.length), batch(s))) as any;
    const r = await create(env, { title: "Big", servings: 20, ingredients: lines });
    expect(r.ingredients).toHaveLength(30);
    expect(r.ingredients[29].name).toBe("Thing 1");
    expect(statements).toBeLessThan(10);
  });

  it("returns 404 for missing recipes", async () => {
    const env = testEnv();
    expect((await call(app, env, "GET", "/api/recipes/9")).status).toBe(404);
    expect((await call(app, env, "PUT", "/api/recipes/9", shakshuka)).status).toBe(404);
    expect((await call(app, env, "DELETE", "/api/recipes/9")).status).toBe(404);
  });

  it("rejects an alternative id from another recipe", async () => {
    const env = testEnv();
    await create(env, { ...shakshuka, alternatives: [{ label: "Vegan", ingredients: [] }] });
    await create(env, { title: "Other", servings: 2, ingredients: [] });
    const res = await call(app, env, "PUT", "/api/recipes/2", { title: "Other", servings: 2, ingredients: [], alternatives: [{ id: 1, label: "Stolen", ingredients: [] }] });
    expect(res.status).toBe(400);
  });

  it("deletes a recipe with its lines and alternatives", async () => {
    const env = testEnv();
    await create(env, { ...shakshuka, alternatives: [{ label: "Vegan", ingredients: [{ name: "Tofu", base_unit: "g", quantity_per_serving: 5 }] }] });
    expect((await call(app, env, "DELETE", "/api/recipes/1")).status).toBe(200);
    const left = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM recipe_ingredients) AS a, (SELECT COUNT(*) FROM recipe_alternatives) AS b").first();
    expect(left).toEqual({ a: 0, b: 0 });
  });

  describe("when menus use the recipe", () => {
    async function withMenu() {
      const env = testEnv();
      await create(env, { ...shakshuka, alternatives: [{ label: "Vegan", ingredients: [] }] });
      await env.DB.exec(`
        INSERT INTO retreats (name, start_date, end_date, headcount) VALUES ('R', '2026-01-01', '2026-01-02', 20);
        INSERT INTO meals (retreat_id, date, slot) VALUES (1, '2026-01-01', 'brunch');
        INSERT INTO meal_dishes (meal_id, recipe_id) VALUES (1, 1);
        INSERT INTO meal_dish_alternatives (meal_dish_id, alternative_id, servings) VALUES (1, 1, 5);
      `);
      return env;
    }

    it("won't delete the recipe", async () => {
      const env = await withMenu();
      const res = await call(app, env, "DELETE", "/api/recipes/1");
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/on a menu/);
    });

    it("won't remove an alternative that a meal uses, but keeps editing others", async () => {
      const env = await withMenu();
      const dropped = await call(app, env, "PUT", "/api/recipes/1", { ...shakshuka, alternatives: [] });
      expect(dropped.status).toBe(409);
      expect(dropped.body.error).toMatch(/Vegan/);
      const kept = await call(app, env, "PUT", "/api/recipes/1", { ...shakshuka, alternatives: [{ id: 1, label: "Vegan", ingredients: [] }] });
      expect(kept.status).toBe(200);
    });
  });
});

describe("POST /api/recipes/parse", () => {
  it("returns a draft matched to existing ingredients and saves nothing", async () => {
    const env = testEnv();
    await call(app, env, "POST", "/api/ingredients", { name: "Onion", base_unit: "each" });
    await call(app, env, "POST", "/api/ingredients", { name: "Olive oil", base_unit: "ml" });
    const text = "Onion soup\nServes 4\nIngredients\n2 onions, sliced\n2 tbsp olive oil\n1 l stock\na pinch of salt";
    const res = await call(app, env, "POST", "/api/recipes/parse", { text });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: "Onion soup", servings: 4, problems: [] });
    expect(res.body.lines[0]).toMatchObject({
      name: "onions",
      prep_note: "sliced",
      quantity_per_serving: 0.5,
      base_unit: "each",
      match: { ingredient_id: 1, name: "Onion", base_unit: "each" },
      problem: null,
    });
    expect(res.body.lines[1]).toMatchObject({ quantity_per_serving: 7.5, base_unit: "ml", match: { ingredient_id: 2 } });
    expect(res.body.lines[2]).toMatchObject({ quantity_per_serving: 250, base_unit: "ml", match: null });
    expect(res.body.lines[3]).toMatchObject({ quantity_per_serving: null, problem: "No quantity" });
    expect((await call(app, env, "GET", "/api/recipes")).body).toEqual([]);
  });

  it("asks for some text", async () => {
    expect((await call(app, testEnv(), "POST", "/api/recipes/parse", { text: "  " })).status).toBe(400);
    expect((await call(app, testEnv(), "POST", "/api/recipes/parse", {})).status).toBe(400);
  });
});
