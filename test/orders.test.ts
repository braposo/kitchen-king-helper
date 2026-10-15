import { beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { call, testEnv } from "./helpers/d1";

async function run(db: D1Database, sql: string, ...params: unknown[]) {
  await db.prepare(sql).bind(...params).run();
}

let env: ReturnType<typeof testEnv>;

// 10 people, no buffer. Dinner on 14 and 15 Nov uses rice (pantry) and onions (fresh).
beforeEach(async () => {
  env = testEnv();
  const { DB } = env;
  await run(DB, "INSERT INTO suppliers (id, name, kind, lead_days) VALUES (1, 'Tesco', 'supermarket', 1), (2, 'Spice Shop', 'specialist', 3)");
  await run(DB, "INSERT INTO ingredients (id, name, base_unit, storage, supplier_id, pack_size, pack_label) VALUES (1, 'Rice', 'g', 'pantry', NULL, 1000, '1 kg bag'), (2, 'Onions', 'g', 'fresh', NULL, NULL, NULL)");
  await run(DB, "INSERT INTO recipes (id, title, servings) VALUES (1, 'Dahl', 4)");
  await run(DB, "INSERT INTO recipe_ingredients (recipe_id, alternative_id, ingredient_id, quantity_per_serving, position) VALUES (1, NULL, 1, 150, 0), (1, NULL, 2, 100, 1)");
  await run(DB, "INSERT INTO retreats (id, name, start_date, end_date, headcount, buffer_percent) VALUES (1, 'November', '2026-11-14', '2026-11-16', 10, 0)");
  await run(DB, "INSERT INTO meals (id, retreat_id, date, slot, position) VALUES (1, 1, '2026-11-14', 'dinner', 0), (2, 1, '2026-11-15', 'dinner', 0)");
  await run(DB, "INSERT INTO meal_dishes (id, meal_id, recipe_id) VALUES (1, 1, 1), (2, 2, 1)");
});

const get = () => call(app, env, "GET", "/api/orders/1");
const line = (body: any, name: string, group?: string) =>
  body.lines.find((l: any) => l.name === name && (group === undefined || l.line_group === group));

describe("GET /api/orders/:retreatId", () => {
  it("returns lines, both groupings and suppliers", async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.retreat.name).toBe("November");
    expect(body.suppliers).toEqual([{ id: 1, name: "Tesco" }, { id: 2, name: "Spice Shop" }]);
    // Pantry rice once (3000 g over two dinners), fresh onions per day.
    expect(body.lines).toHaveLength(3);
    expect(line(body, "Rice")).toMatchObject({ line_group: "pantry", delivery_date: "2026-11-13", total: 3000, packs: 3, supplier_name: "Tesco" });
    expect(line(body, "Onions", "2026-11-15")).toMatchObject({ delivery_date: "2026-11-14", display: "1 kg", ticked: false });
    expect(body.by_delivery.map((g: any) => [g.delivery_date, g.pantry])).toEqual([["2026-11-13", true], ["2026-11-14", false]]);
    expect(body.by_delivery[0].lines.map((l: any) => l.line_group).sort()).toEqual(["2026-11-14", "pantry"]);
    expect(body.by_supplier).toHaveLength(1);
    expect(body.by_supplier[0].supplier_name).toBe("Tesco");
  });

  it("uses the ingredient's own supplier when it has one", async () => {
    await run(env.DB, "UPDATE ingredients SET supplier_id = 2 WHERE id = 1");
    const { body } = await get();
    expect(line(body, "Rice").supplier_name).toBe("Spice Shop");
    expect(body.by_supplier.map((g: any) => g.supplier_name).sort()).toEqual(["Spice Shop", "Tesco"]);
  });

  it("returns empty lists for a plan with no dishes", async () => {
    await run(env.DB, "DELETE FROM meal_dishes");
    const { body } = await get();
    expect(body.lines).toEqual([]);
    expect(body.by_delivery).toEqual([]);
  });

  it("404s for an unknown retreat", async () => {
    expect((await call(app, env, "GET", "/api/orders/99")).status).toBe(404);
  });
});

describe("PUT /api/orders/:retreatId/lines", () => {
  const put = (body: unknown, id = 1) => call(app, env, "PUT", `/api/orders/${id}/lines`, body);

  it("ticks and unticks a line", async () => {
    let res = await put({ ingredient_id: 1, line_group: "pantry", ticked: true });
    expect(res.status).toBe(200);
    expect(line(res.body, "Rice").ticked).toBe(true);
    res = await put({ ingredient_id: 1, line_group: "pantry", ticked: false });
    expect(line(res.body, "Rice").ticked).toBe(false);
  });

  it("moves a line into another delivery group", async () => {
    const res = await put({ ingredient_id: 2, line_group: "2026-11-15", delivery_date: "2026-11-12" });
    expect(line(res.body, "Onions", "2026-11-15")).toMatchObject({ delivery_date: "2026-11-12", order_by_date: "2026-11-11" });
    expect(res.body.by_delivery.map((g: any) => g.delivery_date)).toEqual(["2026-11-12", "2026-11-13"]);
    expect(res.body.by_delivery[0].lines.map((l: any) => l.name)).toEqual(["Onions"]);
  });

  it("overrides the supplier", async () => {
    const res = await put({ ingredient_id: 1, line_group: "pantry", supplier_id: 2 });
    expect(line(res.body, "Rice")).toMatchObject({ supplier_id: 2, supplier_name: "Spice Shop", order_by_date: "2026-11-10" });
  });

  it("only changes the fields in the body and null resets one", async () => {
    await put({ ingredient_id: 1, line_group: "pantry", supplier_id: 2, delivery_date: "2026-11-10", ticked: true });
    let res = await put({ ingredient_id: 1, line_group: "pantry", ticked: false });
    expect(line(res.body, "Rice")).toMatchObject({ supplier_id: 2, delivery_date: "2026-11-10", ticked: false });
    res = await put({ ingredient_id: 1, line_group: "pantry", delivery_date: null });
    expect(line(res.body, "Rice")).toMatchObject({ supplier_id: 2, delivery_date: "2026-11-13" });
    res = await put({ ingredient_id: 1, line_group: "pantry", supplier_id: null });
    expect(line(res.body, "Rice")).toMatchObject({ supplier_id: 1, supplier_name: "Tesco" });
  });

  it("rejects bad input with 400", async () => {
    const bad = [
      { line_group: "pantry" },
      { ingredient_id: 1 },
      { ingredient_id: 1, line_group: "tomorrow" },
      { ingredient_id: 99, line_group: "pantry", ticked: true },
      { ingredient_id: 1, line_group: "pantry", delivery_date: "13/11/2026" },
      { ingredient_id: 1, line_group: "pantry", delivery_date: "2026-02-31" },
      { ingredient_id: 1, line_group: "pantry", supplier_id: 99 },
      { ingredient_id: 1, line_group: "pantry", supplier_id: "x" },
      { ingredient_id: 1, line_group: "pantry", ticked: "yes" },
    ];
    for (const body of bad) {
      const res = await put(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(typeof res.body.error).toBe("string");
    }
    expect((await call(app, env, "PUT", "/api/orders/1/lines", [1])).status).toBe(400);
    const stored = await env.DB.prepare("SELECT COUNT(*) AS n FROM order_line_state").first<{ n: number }>();
    expect(stored?.n).toBe(0);
  });

  it("404s for an unknown retreat", async () => {
    expect((await put({ ingredient_id: 1, line_group: "pantry", ticked: true }, 99)).status).toBe(404);
  });
});

describe("DELETE /api/orders/:retreatId/lines", () => {
  it("puts a line back to automatic", async () => {
    await call(app, env, "PUT", "/api/orders/1/lines", { ingredient_id: 1, line_group: "pantry", supplier_id: 2, ticked: true, delivery_date: "2026-11-01" });
    const res = await call(app, env, "DELETE", "/api/orders/1/lines", { ingredient_id: 1, line_group: "pantry" });
    expect(res.status).toBe(200);
    expect(line(res.body, "Rice")).toMatchObject({ supplier_id: 1, delivery_date: "2026-11-13", ticked: false });
    const stored = await env.DB.prepare("SELECT COUNT(*) AS n FROM order_line_state").first<{ n: number }>();
    expect(stored?.n).toBe(0);
  });

  it("validates and 404s", async () => {
    expect((await call(app, env, "DELETE", "/api/orders/1/lines", { line_group: "pantry" })).status).toBe(400);
    expect((await call(app, env, "DELETE", "/api/orders/99/lines", { ingredient_id: 1, line_group: "pantry" })).status).toBe(404);
  });
});

describe("dietary list", () => {
  it("orders the alternative's ingredients for people on the list", async () => {
    const { DB } = env;
    await run(DB, "INSERT INTO ingredients (id, name, base_unit, storage) VALUES (3, 'Tofu', 'g', 'fresh')");
    await run(DB, "INSERT INTO recipe_alternatives (id, recipe_id, label) VALUES (1, 1, 'Vegan')");
    await run(DB, "INSERT INTO recipe_ingredients (recipe_id, alternative_id, ingredient_id, quantity_per_serving, position) VALUES (1, 1, 3, 100, 0)");
    await run(DB, "INSERT INTO retreat_guests (retreat_id, name, count, diets) VALUES (1, NULL, 2, 'vegan')");
    const { body } = await get();
    // Two dinners: 8 people eat the main version, 2 the vegan one.
    expect(line(body, "Rice").total).toBe(2400);
    expect(line(body, "Tofu", "2026-11-14").total).toBe(200);
  });
});
