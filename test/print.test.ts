import { describe, expect, it } from "vitest";
import app from "../src/index";
import { call, testEnv } from "./helpers/d1";

async function run(db: D1Database, sql: string, ...params: unknown[]) {
  await db.prepare(sql).bind(...params).run();
}

// A three-day retreat, 20 people, no buffer so the numbers are easy to check.
// Day 1 (5 June): brunch with Shakshuka (17 main, 3 vegan) and dinner with Dahl (20).
// Day 2 (6 June): dinner with Dahl, which day 1 should prep ahead.
async function seed(env: ReturnType<typeof testEnv>) {
  const db = env.DB;
  await run(db, "INSERT INTO suppliers (id, name, kind, lead_days) VALUES (1, 'Tesco', 'supermarket', 1)");
  await run(db, "INSERT INTO ingredients (id, name, base_unit, storage, supplier_id) VALUES (1, 'Onion', 'g', 'fresh', 1), (2, 'Egg', 'each', 'fresh', 1), (3, 'Tofu', 'g', 'fresh', 1), (4, 'Lentils', 'g', 'pantry', 1)");
  await run(db, "INSERT INTO recipes (id, title, servings, method) VALUES (1, 'Shakshuka', 4, 'Fry the onions.\nAdd eggs.'), (2, 'Dahl', 4, NULL)");
  await run(db, "INSERT INTO recipe_alternatives (id, recipe_id, label) VALUES (1, 1, 'Vegan')");
  await run(
    db,
    "INSERT INTO recipe_ingredients (recipe_id, alternative_id, ingredient_id, quantity_per_serving, prep_note, position) VALUES (1, NULL, 1, 100, 'diced', 0), (1, NULL, 2, 1, NULL, 1), (1, 1, 3, 80, NULL, 0), (2, NULL, 4, 50, NULL, 0)",
  );
  await run(db, "INSERT INTO retreats (id, name, start_date, end_date, headcount, buffer_percent) VALUES (1, 'June', '2026-06-05', '2026-06-07', 20, 0)");
  await run(
    db,
    "INSERT INTO meals (id, retreat_id, date, slot, position, time_label, headcount) VALUES (1, 1, '2026-06-05', 'brunch', 0, '11:00', NULL), (2, 1, '2026-06-05', 'dinner', 1, NULL, NULL), (3, 1, '2026-06-06', 'dinner', 0, NULL, NULL)",
  );
  await run(db, "INSERT INTO meal_dishes (id, meal_id, recipe_id, servings) VALUES (1, 1, 1, NULL), (2, 2, 2, NULL), (3, 3, 2, NULL)");
  await run(db, "INSERT INTO meal_dish_alternatives (meal_dish_id, alternative_id, servings) VALUES (1, 1, 3)");
  return env;
}

describe("GET /api/print/:retreatId/day/:date", () => {
  it("returns the day's meals scaled, with alternatives and prep ahead", async () => {
    const env = await seed(testEnv());
    const res = await call(app, env, "GET", "/api/print/1/day/2026-06-05");

    expect(res.status).toBe(200);
    expect(res.body.retreat).toEqual({ id: 1, name: "June", start_date: "2026-06-05", end_date: "2026-06-07" });
    expect(res.body.date).toBe("2026-06-05");

    const [brunch, dinner] = res.body.meals;
    expect(res.body.meals).toHaveLength(2);
    expect(brunch).toMatchObject({ time_label: "11:00", people: 20, meal: { slot: "brunch" } });
    expect(dinner).toMatchObject({ time_label: null, people: 20, meal: { slot: "dinner" } });

    const shakshuka = brunch.dishes[0];
    expect(shakshuka.title).toBe("Shakshuka");
    expect(shakshuka.versions.map((v: { label: string; servings: number }) => [v.label, v.servings])).toEqual([
      ["Main", 17],
      ["Vegan", 3],
    ]);
    const [main, vegan] = shakshuka.versions;
    expect(main.lines).toEqual([
      { ingredient_id: 1, name: "Onion", amount: 1700, display: "1.7 kg", prep_note: "diced" },
      { ingredient_id: 2, name: "Egg", amount: 17, display: "17", prep_note: null },
    ]);
    expect(vegan.lines).toEqual([{ ingredient_id: 3, name: "Tofu", amount: 240, display: "240 g", prep_note: null }]);

    // Tomorrow's dinner is Dahl for everyone (main version only).
    expect(res.body.prep_ahead).toEqual([
      { meal_id: 3, slot: "dinner", dishes: [{ recipe_id: 2, title: "Dahl", versions: [{ label: "Main", servings: 20 }] }] },
    ]);
  });

  it("returns no meals and nothing to prep for an empty day", async () => {
    const env = await seed(testEnv());
    const res = await call(app, env, "GET", "/api/print/1/day/2026-06-07");
    expect(res.status).toBe(200);
    expect(res.body.meals).toEqual([]);
    expect(res.body.prep_ahead).toEqual([]);
  });

  it("returns 400 for a date outside the retreat", async () => {
    const env = await seed(testEnv());
    const res = await call(app, env, "GET", "/api/print/1/day/2026-06-08");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("outside this retreat");
  });

  it("returns 400 for a date that is not YYYY-MM-DD", async () => {
    const env = await seed(testEnv());
    const res = await call(app, env, "GET", "/api/print/1/day/2026-6-5");
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown retreat", async () => {
    const env = await seed(testEnv());
    expect((await call(app, env, "GET", "/api/print/99/day/2026-06-05")).status).toBe(404);
    expect((await call(app, env, "GET", "/api/print/abc/day/2026-06-05")).status).toBe(404);
  });
});

describe("GET /api/print/:retreatId/recipes", () => {
  it("returns one card per dish on the given date", async () => {
    const env = await seed(testEnv());
    const res = await call(app, env, "GET", "/api/print/1/recipes?date=2026-06-05");

    expect(res.status).toBe(200);
    expect(res.body.retreat.id).toBe(1);
    expect(res.body.cards).toHaveLength(2);

    const [shakshuka, dahl] = res.body.cards;
    expect(shakshuka).toMatchObject({ date: "2026-06-05", slot: "brunch", time_label: "11:00", title: "Shakshuka" });
    expect(shakshuka.versions.map((v: { label: string }) => v.label)).toEqual(["Main", "Vegan"]);
    expect(dahl).toMatchObject({ date: "2026-06-05", slot: "dinner", time_label: null, title: "Dahl", method: null });
  });

  it("keeps the method's line breaks exactly as written", async () => {
    const env = await seed(testEnv());
    const res = await call(app, env, "GET", "/api/print/1/recipes?date=2026-06-05");
    expect(res.body.cards[0].method).toBe("Fry the onions.\nAdd eggs.");
  });

  it("returns every dish across the retreat when date is omitted", async () => {
    const env = await seed(testEnv());
    const res = await call(app, env, "GET", "/api/print/1/recipes");

    expect(res.body.cards.map((c: { date: string; title: string }) => [c.date, c.title])).toEqual([
      ["2026-06-05", "Shakshuka"],
      ["2026-06-05", "Dahl"],
      ["2026-06-06", "Dahl"],
    ]);
  });

  it("returns 400 for a date outside the retreat and 404 for an unknown retreat", async () => {
    const env = await seed(testEnv());
    expect((await call(app, env, "GET", "/api/print/1/recipes?date=2026-07-01")).status).toBe(400);
    expect((await call(app, env, "GET", "/api/print/99/recipes")).status).toBe(404);
  });
});
