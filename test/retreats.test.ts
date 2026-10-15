import { describe, expect, it } from "vitest";
import app from "../src/index";
import { call, testEnv } from "./helpers/d1";

const NEW = { name: "Autumn", start_date: "2025-11-14", end_date: "2025-11-16", headcount: 20 };

async function setup() {
  const env = testEnv();
  const db = env.DB;
  await db.prepare("INSERT INTO recipes (title, servings) VALUES ('Shakshuka', 4), ('Dal', 4)").run();
  await db.prepare("INSERT INTO recipe_alternatives (recipe_id, label) VALUES (1, 'Vegan'), (1, 'Gluten free'), (2, 'Vegan')").run();
  const created = await call(app, env, "POST", "/api/retreats", NEW);
  return { env, retreat: created.body };
}

const meal = (retreat: any, day: number, i: number) => retreat.days[day].meals[i];

describe("create and read", () => {
  it("creates a retreat with three default meals per day", async () => {
    const { retreat } = await setup();
    expect(retreat).toMatchObject({ id: 1, name: "Autumn", headcount: 20, buffer_percent: 10 });
    expect(retreat.days.map((d: any) => d.date)).toEqual(["2025-11-14", "2025-11-15", "2025-11-16"]);
    expect(retreat.days[0].meals.map((m: any) => [m.slot, m.position, m.time_label, m.people])).toEqual([
      ["brunch", 0, "11:00", 20],
      ["snacks", 1, "16:00", 20],
      ["dinner", 2, "19:30", 20],
    ]);
  });

  it("rejects bad input", async () => {
    const env = testEnv();
    const post = (patch: object) => call(app, env, "POST", "/api/retreats", { ...NEW, ...patch });
    expect((await post({ name: " " })).status).toBe(400);
    expect((await post({ start_date: "14/11/2025" })).status).toBe(400);
    expect((await post({ start_date: "2025-02-30" })).status).toBe(400);
    expect((await post({ end_date: "2025-11-13" })).status).toBe(400);
    expect((await post({ end_date: "2025-11-28" })).status).toBe(400);
    expect((await post({ headcount: 0 })).status).toBe(400);
    expect((await post({ headcount: 201 })).status).toBe(400);
    expect((await post({ buffer_percent: -1 })).status).toBe(400);
    expect((await post({ end_date: "2025-11-27" })).status).toBe(201);
  });

  it("lists retreats newest first with day counts", async () => {
    const { env } = await setup();
    await call(app, env, "POST", "/api/retreats", { ...NEW, name: "Spring", start_date: "2026-03-01", end_date: "2026-03-02" });
    const list = await call(app, env, "GET", "/api/retreats");
    expect(list.body.map((r: any) => [r.name, r.days])).toEqual([["Spring", 2], ["Autumn", 3]]);
  });

  it("works out main servings from people minus alternatives", async () => {
    const { env } = await setup();
    const added = await call(app, env, "POST", "/api/retreats/meals/3/dishes", { recipe_id: 1 });
    const dish = meal(added.body, 0, 2).dishes[0];
    expect(dish).toMatchObject({ title: "Shakshuka", servings: null, main_servings: 20 });
    expect(dish.available_alternatives.map((a: any) => a.label)).toEqual(["Vegan", "Gluten free"]);

    const withAlts = await call(app, env, "PUT", `/api/retreats/dishes/${dish.id}`, {
      alternatives: [{ alternative_id: 1, servings: 3 }, { alternative_id: 2, servings: 2 }],
    });
    const after = meal(withAlts.body, 0, 2).dishes[0];
    expect(after.main_servings).toBe(15);
    expect(after.alternatives).toEqual([
      { alternative_id: 1, label: "Vegan", servings: 3 },
      { alternative_id: 2, label: "Gluten free", servings: 2 },
    ]);

    // A typed number wins; a meal headcount override changes the automatic one.
    const typed = await call(app, env, "PUT", `/api/retreats/dishes/${dish.id}`, { servings: 18 });
    expect(meal(typed.body, 0, 2).dishes[0]).toMatchObject({ servings: 18, main_servings: 18 });
    await call(app, env, "PUT", `/api/retreats/dishes/${dish.id}`, { servings: null });
    const smaller = await call(app, env, "PUT", "/api/retreats/meals/3", { headcount: 4 });
    expect(meal(smaller.body, 0, 2)).toMatchObject({ headcount: 4, people: 4 });
    expect(meal(smaller.body, 0, 2).dishes[0].main_servings).toBe(0);
  });

  it("returns 404 for unknown things", async () => {
    const { env } = await setup();
    for (const [method, path, body] of [
      ["GET", "/api/retreats/99", undefined],
      ["PUT", "/api/retreats/99", {}],
      ["DELETE", "/api/retreats/99", undefined],
      ["POST", "/api/retreats/99/duplicate", { name: "x", start_date: "2026-01-01" }],
      ["POST", "/api/retreats/99/meals", { date: "2025-11-14", slot: "brunch" }],
      ["PUT", "/api/retreats/meals/99", {}],
      ["DELETE", "/api/retreats/meals/99", undefined],
      ["POST", "/api/retreats/meals/99/dishes", { recipe_id: 1 }],
      ["POST", "/api/retreats/meals/1/dishes", { recipe_id: 99 }],
      ["PUT", "/api/retreats/dishes/99", {}],
      ["DELETE", "/api/retreats/dishes/99", undefined],
    ] as const) {
      expect((await call(app, env, method, path, body)).status, `${method} ${path}`).toBe(404);
    }
  });
});

describe("changing the date range", () => {
  it("adds default meals for new days", async () => {
    const { env } = await setup();
    const res = await call(app, env, "PUT", "/api/retreats/1", { end_date: "2025-11-18", name: "Autumn 2" });
    expect(res.body.name).toBe("Autumn 2");
    expect(res.body.days).toHaveLength(5);
    expect(res.body.days[4].meals.map((m: any) => m.slot)).toEqual(["brunch", "snacks", "dinner"]);
    const earlier = await call(app, env, "PUT", "/api/retreats/1", { start_date: "2025-11-13" });
    expect(earlier.body.days[0]).toMatchObject({ date: "2025-11-13" });
    expect(earlier.body.days[0].meals).toHaveLength(3);
  });

  it("drops empty meals when shrinking", async () => {
    const { env } = await setup();
    const res = await call(app, env, "PUT", "/api/retreats/1", { end_date: "2025-11-14" });
    expect(res.body.days).toHaveLength(1);
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM meals").first<{ n: number }>();
    expect(left?.n).toBe(3);
  });

  it("refuses to shrink over a day with dishes, naming the day", async () => {
    const { env } = await setup();
    await call(app, env, "POST", "/api/retreats/meals/9/dishes", { recipe_id: 2 });
    const res = await call(app, env, "PUT", "/api/retreats/1", { end_date: "2025-11-15" });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("2025-11-16");
    const still = await call(app, env, "GET", "/api/retreats/1");
    expect(still.body.days).toHaveLength(3);
  });

  it("validates the new range", async () => {
    const { env } = await setup();
    expect((await call(app, env, "PUT", "/api/retreats/1", { end_date: "2025-11-01" })).status).toBe(400);
    expect((await call(app, env, "PUT", "/api/retreats/1", { headcount: 500 })).status).toBe(400);
  });
});

describe("duplicate and delete", () => {
  it("copies the plan shifted to new dates, with alternatives", async () => {
    const { env } = await setup();
    await call(app, env, "POST", "/api/retreats/meals/3/dishes", { recipe_id: 1 });
    await call(app, env, "PUT", "/api/retreats/dishes/1", { servings: 17, alternatives: [{ alternative_id: 1, servings: 3 }] });
    await call(app, env, "PUT", "/api/retreats/meals/3", { headcount: 12, time_label: "around 8" });

    const res = await call(app, env, "POST", "/api/retreats/1/duplicate", { name: "Winter", start_date: "2026-01-09" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 2, name: "Winter", start_date: "2026-01-09", end_date: "2026-01-11", headcount: 20 });
    const dinner = meal(res.body, 0, 2);
    expect(dinner).toMatchObject({ date: "2026-01-09", slot: "dinner", time_label: "around 8", headcount: 12 });
    expect(dinner.dishes[0]).toMatchObject({ title: "Shakshuka", servings: 17 });
    expect(dinner.dishes[0].alternatives).toEqual([{ alternative_id: 1, label: "Vegan", servings: 3 }]);

    // The original is untouched.
    const original = await call(app, env, "GET", "/api/retreats/1");
    expect(meal(original.body, 0, 2).dishes[0].id).toBe(1);
    expect((await call(app, env, "POST", "/api/retreats/1/duplicate", { name: "", start_date: "2026-01-09" })).status).toBe(400);
  });

  it("keeps each dish on the right meal when copying many, including to earlier dates", async () => {
    const { env } = await setup();
    await call(app, env, "POST", "/api/retreats/meals/5/dishes", { recipe_id: 1 });
    await call(app, env, "POST", "/api/retreats/meals/1/dishes", { recipe_id: 1 });
    await call(app, env, "POST", "/api/retreats/meals/9/dishes", { recipe_id: 1 });
    await call(app, env, "PUT", "/api/retreats/dishes/3", { alternatives: [{ alternative_id: 1, servings: 4 }] });

    const res = await call(app, env, "POST", "/api/retreats/1/duplicate", { name: "Earlier", start_date: "2025-12-01" });
    expect(res.body.start_date).toBe("2025-12-01");
    const withDishes = res.body.days.flatMap((d: any) => d.meals).filter((m: any) => m.dishes.length);
    const original = (await call(app, env, "GET", "/api/retreats/1")).body.days.flatMap((d: any) => d.meals).filter((m: any) => m.dishes.length);
    expect(withDishes.map((m: any) => [m.slot, m.position, m.dishes[0].alternatives])).toEqual(
      original.map((m: any) => [m.slot, m.position, m.dishes[0].alternatives]),
    );
  });

  it("deletes a retreat and everything in it", async () => {
    const { env } = await setup();
    await call(app, env, "POST", "/api/retreats/meals/1/dishes", { recipe_id: 1 });
    expect((await call(app, env, "DELETE", "/api/retreats/1")).status).toBe(200);
    expect((await call(app, env, "GET", "/api/retreats/1")).status).toBe(404);
    const left = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM meals) + (SELECT COUNT(*) FROM meal_dishes) AS n").first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});

describe("meals", () => {
  it("adds a meal at the end of the day", async () => {
    const { env } = await setup();
    const res = await call(app, env, "POST", "/api/retreats/1/meals", { date: "2025-11-15", slot: "late supper", time_label: "22:00" });
    expect(res.status).toBe(201);
    expect(res.body.days[1].meals.at(-1)).toMatchObject({ slot: "late supper", position: 3, time_label: "22:00" });
    expect((await call(app, env, "POST", "/api/retreats/1/meals", { date: "2025-12-25", slot: "dinner" })).status).toBe(400);
    expect((await call(app, env, "POST", "/api/retreats/1/meals", { date: "2025-11-15", slot: "" })).status).toBe(400);
  });

  it("moves a meal to the end of another day and can reorder", async () => {
    const { env } = await setup();
    const moved = await call(app, env, "PUT", "/api/retreats/meals/1", { date: "2025-11-15" });
    expect(moved.body.days[0].meals.map((m: any) => m.slot)).toEqual(["snacks", "dinner"]);
    expect(moved.body.days[1].meals.map((m: any) => m.slot)).toEqual(["brunch", "snacks", "dinner", "brunch"]);

    const reordered = await call(app, env, "PUT", "/api/retreats/meals/1", { position: 0 });
    expect(reordered.body.days[1].meals.map((m: any) => [m.id, m.position])).toEqual([[1, 0], [4, 1], [5, 2], [6, 3]]);
  });

  it("sets and clears a headcount override and validates", async () => {
    const { env } = await setup();
    const set = await call(app, env, "PUT", "/api/retreats/meals/1", { headcount: 8, slot: "lunch" });
    expect(meal(set.body, 0, 0)).toMatchObject({ slot: "lunch", headcount: 8, people: 8 });
    const cleared = await call(app, env, "PUT", "/api/retreats/meals/1", { headcount: null });
    expect(meal(cleared.body, 0, 0)).toMatchObject({ headcount: null, people: 20 });
    expect((await call(app, env, "PUT", "/api/retreats/meals/1", { headcount: 0 })).status).toBe(400);
    expect((await call(app, env, "PUT", "/api/retreats/meals/1", { date: "2030-01-01" })).status).toBe(400);
  });

  it("deletes a meal with its dishes", async () => {
    const { env } = await setup();
    await call(app, env, "POST", "/api/retreats/meals/1/dishes", { recipe_id: 1 });
    const res = await call(app, env, "DELETE", "/api/retreats/meals/1");
    expect(res.body.days[0].meals).toHaveLength(2);
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM meal_dishes").first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});

describe("dishes", () => {
  it("adds, updates and deletes a dish", async () => {
    const { env } = await setup();
    const added = await call(app, env, "POST", "/api/retreats/meals/1/dishes", { recipe_id: 2 });
    expect(added.status).toBe(201);
    expect(meal(added.body, 0, 0).dishes).toHaveLength(1);
    const res = await call(app, env, "DELETE", "/api/retreats/dishes/1");
    expect(meal(res.body, 0, 0).dishes).toEqual([]);
  });

  it("replaces the alternatives, removing those set to 0", async () => {
    const { env } = await setup();
    await call(app, env, "POST", "/api/retreats/meals/1/dishes", { recipe_id: 1 });
    await call(app, env, "PUT", "/api/retreats/dishes/1", { alternatives: [{ alternative_id: 1, servings: 3 }, { alternative_id: 2, servings: 1 }] });
    const res = await call(app, env, "PUT", "/api/retreats/dishes/1", { alternatives: [{ alternative_id: 1, servings: 0 }, { alternative_id: 2, servings: 4 }] });
    expect(meal(res.body, 0, 0).dishes[0].alternatives).toEqual([{ alternative_id: 2, label: "Gluten free", servings: 4 }]);
    const cleared = await call(app, env, "PUT", "/api/retreats/dishes/1", { alternatives: [] });
    expect(meal(cleared.body, 0, 0).dishes[0].alternatives).toEqual([]);
  });

  it("rejects alternatives from another recipe and bad numbers", async () => {
    const { env } = await setup();
    await call(app, env, "POST", "/api/retreats/meals/1/dishes", { recipe_id: 1 });
    const wrong = await call(app, env, "PUT", "/api/retreats/dishes/1", { alternatives: [{ alternative_id: 3, servings: 2 }] });
    expect(wrong.status).toBe(400);
    expect((await call(app, env, "PUT", "/api/retreats/dishes/1", { servings: -2 })).status).toBe(400);
    expect((await call(app, env, "PUT", "/api/retreats/dishes/1", { alternatives: "x" })).status).toBe(400);
    expect((await call(app, env, "POST", "/api/retreats/meals/1/dishes", {})).status).toBe(400);
  });
});

describe("dietary list", () => {
  it("adds, edits and removes people and counts each diet", async () => {
    const { env } = await setup();
    const added = await call(app, env, "POST", "/api/retreats/1/guests", { name: "Tom", diets: ["vegan"], note: "no mushrooms" });
    expect(added.status).toBe(201);
    await call(app, env, "POST", "/api/retreats/1/guests", { count: 2, diets: ["gluten_free", "vegan"] });
    const res = await call(app, env, "GET", "/api/retreats/1");
    expect(res.body.guests).toEqual([
      { id: 1, name: "Tom", count: 1, diets: ["vegan"], note: "no mushrooms" },
      { id: 2, name: null, count: 2, diets: ["vegan", "gluten_free"], note: null },
    ]);
    expect(res.body.guest_total).toBe(3);
    expect(res.body.diet_counts.map((d: any) => [d.diet, d.count])).toEqual([["vegan", 3], ["gluten_free", 2]]);

    const edited = await call(app, env, "PUT", "/api/retreats/guests/1", { diets: ["dairy_free"] });
    expect(edited.body.guests[0]).toMatchObject({ name: "Tom", diets: ["dairy_free"], note: "no mushrooms" });
    const removed = await call(app, env, "DELETE", "/api/retreats/guests/2");
    expect(removed.body.guests).toHaveLength(1);
  });

  it("rejects bad people", async () => {
    const { env } = await setup();
    const post = (body: object) => call(app, env, "POST", "/api/retreats/1/guests", body);
    expect((await post({ name: "Tom", diets: [] })).status).toBe(400);
    expect((await post({ diets: ["keto"] })).status).toBe(400);
    expect((await post({ name: "Tom", count: 2, diets: ["vegan"] })).status).toBe(400);
    expect((await post({ count: 0, diets: ["vegan"] })).status).toBe(400);
    expect((await call(app, env, "PUT", "/api/retreats/guests/9", { diets: ["vegan"] })).status).toBe(404);
  });

  it("previews, adds and replaces a pasted list", async () => {
    const { env } = await setup();
    const text = "Tom - vegan\nSam: gluten free\nBernardo\n2 dairy free";
    const preview = await call(app, env, "POST", "/api/retreats/1/guests/import", { text, preview: true });
    expect(preview.body.guests).toHaveLength(3);
    expect(preview.body.skipped).toEqual(["Bernardo"]);
    expect((await call(app, env, "GET", "/api/retreats/1")).body.guests).toEqual([]);

    const added = await call(app, env, "POST", "/api/retreats/1/guests/import", { text });
    expect(added.status).toBe(201);
    expect(added.body.guest_total).toBe(4);
    const again = await call(app, env, "POST", "/api/retreats/1/guests/import", { text });
    expect(again.body.guests).toHaveLength(6);
    const replaced = await call(app, env, "POST", "/api/retreats/1/guests/import", { text: "3 vegan", replace: true });
    expect(replaced.body.guests).toMatchObject([{ name: null, count: 3, diets: ["vegan"], note: null }]);

    expect((await call(app, env, "POST", "/api/retreats/1/guests/import", { text: "Bernardo" })).status).toBe(400);
  });

  it("fills dish versions from the list until the chef types their own", async () => {
    const { env } = await setup();
    await call(app, env, "POST", "/api/retreats/1/guests/import", { text: "3 vegan\nJo - coeliac\nLuis - nut allergy" });
    const added = await call(app, env, "POST", "/api/retreats/meals/3/dishes", { recipe_id: 1 });
    let dish = meal(added.body, 0, 2).dishes[0];
    expect(dish).toMatchObject({ versions_from_guests: true, main_servings: 16 });
    expect(dish.alternatives).toEqual([
      { alternative_id: 1, label: "Vegan", servings: 3 },
      { alternative_id: 2, label: "Gluten free", servings: 1 },
    ]);
    expect(dish.unmatched).toEqual([{ name: "Luis", count: 1, diets: ["nut_free"] }]);

    const typed = await call(app, env, "PUT", `/api/retreats/dishes/${dish.id}`, { alternatives: [{ alternative_id: 1, servings: 5 }] });
    dish = meal(typed.body, 0, 2).dishes[0];
    expect(dish).toMatchObject({ versions_from_guests: false, main_servings: 15, unmatched: [] });

    // More people on the list don't change a dish the chef has set.
    await call(app, env, "POST", "/api/retreats/1/guests", { count: 2, diets: ["vegan"] });
    const back = await call(app, env, "PUT", `/api/retreats/dishes/${dish.id}`, { versions_from_guests: true });
    dish = meal(back.body, 0, 2).dishes[0];
    expect(dish).toMatchObject({ versions_from_guests: true, main_servings: 14 });
    expect(dish.alternatives[0]).toMatchObject({ label: "Vegan", servings: 5 });
  });

  it("keeps a duplicated retreat's dishes following the list, without copying the people", async () => {
    const { env } = await setup();
    await call(app, env, "POST", "/api/retreats/1/guests", { count: 2, diets: ["vegan"] });
    await call(app, env, "POST", "/api/retreats/meals/3/dishes", { recipe_id: 1 });
    const copy = await call(app, env, "POST", "/api/retreats/1/duplicate", { name: "Winter", start_date: "2026-01-09" });
    expect(copy.body.guests).toEqual([]);
    expect(meal(copy.body, 0, 2).dishes[0]).toMatchObject({ versions_from_guests: true, main_servings: 20 });
  });
});
