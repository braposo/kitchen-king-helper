import { describe, expect, it } from "vitest";
import { loadPlanData } from "../src/lib/plan-data";
import { computeOrderLines } from "../src/lib/quantities";
import { testEnv } from "./helpers/d1";

async function run(db: D1Database, sql: string, ...params: unknown[]) {
  await db.prepare(sql).bind(...params).run();
}

describe("loadPlanData", () => {
  it("returns null for an unknown retreat", async () => {
    expect(await loadPlanData(testEnv().DB, 99)).toBeNull();
  });

  it("loads only what the retreat uses, plus all suppliers", async () => {
    const { DB } = testEnv();
    await run(DB, "INSERT INTO suppliers (id, name, kind, lead_days) VALUES (1, 'Tesco', 'supermarket', 1), (2, 'Spice Shop', 'specialist', 5)");
    await run(DB, "INSERT INTO ingredients (id, name, base_unit, storage, supplier_id, pack_size, pack_label) VALUES (1, 'Rice', 'g', 'pantry', NULL, 1000, '1 kg bag'), (2, 'Tofu', 'g', 'fresh', 2, NULL, NULL), (3, 'Unused', 'g', 'fresh', NULL, NULL, NULL)");
    await run(DB, "INSERT INTO recipes (id, title, servings, method) VALUES (1, 'Dahl', 4, 'Simmer.'), (2, 'Not planned', 4, NULL)");
    await run(DB, "INSERT INTO recipe_alternatives (id, recipe_id, label) VALUES (1, 1, 'Vegan'), (2, 2, 'Other')");
    await run(DB, "INSERT INTO recipe_ingredients (recipe_id, alternative_id, ingredient_id, quantity_per_serving, prep_note, position) VALUES (1, NULL, 1, 100, 'rinsed', 0), (1, 1, 2, 80, NULL, 0), (2, NULL, 3, 10, NULL, 0)");
    await run(DB, "INSERT INTO retreats (id, name, start_date, end_date, headcount, buffer_percent) VALUES (1, 'June', '2026-06-05', '2026-06-07', 20, 0), (2, 'Other', '2026-07-01', '2026-07-02', 10, 0)");
    await run(DB, "INSERT INTO meals (id, retreat_id, date, slot, position) VALUES (1, 1, '2026-06-05', 'dinner', 0), (2, 2, '2026-07-01', 'dinner', 0)");
    await run(DB, "INSERT INTO meal_dishes (id, meal_id, recipe_id, servings) VALUES (1, 1, 1, NULL), (2, 2, 2, NULL)");
    await run(DB, "INSERT INTO meal_dish_alternatives (meal_dish_id, alternative_id, servings) VALUES (1, 1, 3)");
    await run(DB, "UPDATE meal_dishes SET versions_from_guests = 0 WHERE id = 1");
    await run(DB, "INSERT INTO order_line_state (retreat_id, ingredient_id, line_group, supplier_id, ticked) VALUES (1, 1, 'pantry', 2, 1), (2, 3, '2026-07-01', NULL, 1)");

    const data = (await loadPlanData(DB, 1))!;
    expect(data.retreat).toMatchObject({ id: 1, name: "June", headcount: 20 });
    expect(data.meals.map((m) => m.id)).toEqual([1]);
    expect(data.meal_dishes).toHaveLength(1);
    expect(data.meal_dish_alternatives).toHaveLength(1);
    expect(data.recipes.map((r) => r.title)).toEqual(["Dahl"]);
    expect(data.recipes[0].method).toBe("Simmer.");
    expect(data.recipe_alternatives.map((a) => a.label)).toEqual(["Vegan"]);
    expect(data.recipe_lines).toHaveLength(2);
    expect(data.recipe_lines[0].prep_note).toBe("rinsed");
    expect(data.ingredients.map((i) => i.name).sort()).toEqual(["Rice", "Tofu"]);
    expect(data.suppliers.map((s) => s.name)).toEqual(["Tesco", "Spice Shop"]);
    expect(data.order_line_state).toHaveLength(1);

    // And the engine runs on it: 17 rice portions and 3 vegan tofu portions.
    const lines = computeOrderLines(data);
    expect(lines.find((l) => l.name === "Rice")).toMatchObject({ total: 1700, packs: 2, supplier_id: 2, ticked: true });
    expect(lines.find((l) => l.name === "Tofu")).toMatchObject({ total: 240, supplier_name: "Spice Shop" });
  });

  it("loads a retreat with no meals", async () => {
    const { DB } = testEnv();
    await run(DB, "INSERT INTO retreats (id, name, start_date, end_date, headcount) VALUES (1, 'Empty', '2026-06-05', '2026-06-07', 20)");
    const data = (await loadPlanData(DB, 1))!;
    expect(data.meals).toEqual([]);
    expect(computeOrderLines(data)).toEqual([]);
  });
});
