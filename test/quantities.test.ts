import { describe, expect, it } from "vitest";
import {
  addDays, computeOrderLines, dayPrepAhead, formatQuantity, groupByDelivery, groupBySupplier, scaleMeal, type Ingredient, type PlanData,
} from "../src/lib/quantities";

const tesco = { id: 1, name: "Tesco", kind: "supermarket" as const, lead_days: 1 };
const spice = { id: 2, name: "Spice Shop", kind: "specialist" as const, lead_days: 5 };

function ing(id: number, name: string, extra: Partial<Ingredient> = {}): Ingredient {
  return { id, name, base_unit: "g", storage: "fresh", supplier_id: null, pack_size: null, pack_label: null, ...extra };
}

/** A one-meal plan: 20 people, no buffer, one dish with a single recipe line (100 g of rice). Override any part. */
function plan(over: Partial<PlanData> = {}): PlanData {
  return {
    retreat: { id: 1, name: "Test", start_date: "2026-06-05", end_date: "2026-06-07", headcount: 20, buffer_percent: 0 },
    meals: [{ id: 1, retreat_id: 1, date: "2026-06-05", slot: "dinner", position: 0, time_label: null, headcount: null }],
    meal_dishes: [{ id: 1, meal_id: 1, recipe_id: 1, servings: null }],
    meal_dish_alternatives: [],
    recipes: [{ id: 1, title: "Dahl", servings: 4, method: null }],
    recipe_alternatives: [],
    recipe_lines: [{ recipe_id: 1, alternative_id: null, ingredient_id: 1, quantity_per_serving: 100, prep_note: null, position: 0 }],
    ingredients: [ing(1, "Rice")],
    suppliers: [tesco, spice],
    order_line_state: [],
    ...over,
  };
}

const totalOf = (data: PlanData, id = 1) => computeOrderLines(data).find((l) => l.ingredient_id === id)?.total;

describe("servings and scaling", () => {
  it("uses the retreat headcount by default", () => {
    expect(totalOf(plan())).toBe(2000);
  });

  it("lets a meal override the headcount", () => {
    const data = plan();
    data.meals[0].headcount = 12;
    expect(totalOf(data)).toBe(1200);
  });

  it("main servings are people minus the alternatives", () => {
    const data = plan({
      recipe_alternatives: [{ id: 5, recipe_id: 1, label: "Vegan" }],
      meal_dish_alternatives: [{ id: 1, meal_dish_id: 1, alternative_id: 5, servings: 3 }],
      recipe_lines: [
        { recipe_id: 1, alternative_id: null, ingredient_id: 1, quantity_per_serving: 100, prep_note: null, position: 0 },
        { recipe_id: 1, alternative_id: 5, ingredient_id: 2, quantity_per_serving: 80, prep_note: null, position: 0 },
      ],
      ingredients: [ing(1, "Rice"), ing(2, "Tofu")],
    });
    const lines = computeOrderLines(data);
    // Main version: 17 people. The vegan version has its own list, so it adds tofu, not rice.
    expect(lines.find((l) => l.ingredient_id === 1)?.total).toBe(1700);
    expect(lines.find((l) => l.ingredient_id === 2)?.total).toBe(240);
    expect(lines.find((l) => l.ingredient_id === 2)?.uses[0].version_label).toBe("Vegan");
    expect(lines.find((l) => l.ingredient_id === 1)?.uses[0].version_label).toBe("Main");
  });

  it("never lets main servings go below zero", () => {
    const data = plan({
      recipe_alternatives: [{ id: 5, recipe_id: 1, label: "Vegan" }],
      meal_dish_alternatives: [{ id: 1, meal_dish_id: 1, alternative_id: 5, servings: 25 }],
    });
    expect(computeOrderLines(data)).toEqual([]);
  });

  it("uses explicit main servings when set", () => {
    const data = plan();
    data.meal_dishes[0].servings = 8;
    expect(totalOf(data)).toBe(800);
  });

  it("adds the buffer", () => {
    const data = plan();
    data.retreat.buffer_percent = 10;
    expect(totalOf(data)).toBeCloseTo(2200, 6);
  });

  it("adds the same ingredient across dishes and meals", () => {
    const data = plan();
    data.meals.push({ id: 2, retreat_id: 1, date: "2026-06-05", slot: "snacks", position: 1, time_label: null, headcount: 10 });
    data.meal_dishes.push({ id: 2, meal_id: 2, recipe_id: 1, servings: null }, { id: 3, meal_id: 2, recipe_id: 2, servings: null });
    data.recipes.push({ id: 2, title: "Pilaf", servings: 4, method: null });
    data.recipe_lines.push({ recipe_id: 2, alternative_id: null, ingredient_id: 1, quantity_per_serving: 50, prep_note: null, position: 0 });
    const line = computeOrderLines(data)[0];
    expect(line.total).toBe(2000 + 1000 + 500);
    expect(line.uses.map((u) => u.recipe_title)).toEqual(["Dahl", "Dahl", "Pilaf"]);
    expect(line.uses.map((u) => u.slot)).toEqual(["dinner", "snacks", "snacks"]);
  });
});

describe("grouping and dates", () => {
  const mixed = () => {
    const data = plan({ ingredients: [ing(1, "Rice", { storage: "pantry" }), ing(2, "Spinach")] });
    data.recipe_lines.push({ recipe_id: 1, alternative_id: null, ingredient_id: 2, quantity_per_serving: 50, prep_note: null, position: 1 });
    data.meals.push({ id: 2, retreat_id: 1, date: "2026-06-06", slot: "dinner", position: 0, time_label: null, headcount: null });
    data.meal_dishes.push({ id: 2, meal_id: 2, recipe_id: 1, servings: null });
    return data;
  };

  it("puts pantry goods in one group for the whole retreat and fresh goods per day", () => {
    const lines = computeOrderLines(mixed());
    const rice = lines.filter((l) => l.ingredient_id === 1);
    expect(rice).toHaveLength(1);
    expect(rice[0]).toMatchObject({ line_group: "pantry", delivery_date: "2026-06-04", total: 4000 });
    const spinach = lines.filter((l) => l.ingredient_id === 2);
    expect(spinach.map((l) => [l.line_group, l.delivery_date, l.total])).toEqual([
      ["2026-06-05", "2026-06-04", 1000],
      ["2026-06-06", "2026-06-05", 1000],
    ]);
  });

  it("sets the order-by date from the supplier lead time, across a month boundary", () => {
    const data = plan({ ingredients: [ing(1, "Saffron", { supplier_id: 2 })] });
    data.meals[0].date = "2026-07-02";
    const line = computeOrderLines(data)[0];
    expect(line.delivery_date).toBe("2026-07-01");
    expect(line.order_by_date).toBe("2026-06-26");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("groups by delivery date with the pantry flagged", () => {
    const groups = groupByDelivery(computeOrderLines(mixed()));
    expect(groups.map((g) => [g.delivery_date, g.pantry, g.lines.length])).toEqual([
      ["2026-06-04", true, 2],
      ["2026-06-05", false, 1],
    ]);
  });

  it("groups by supplier", () => {
    const data = plan({ ingredients: [ing(1, "Rice", { supplier_id: 2 }), ing(2, "Spinach")] });
    data.recipe_lines.push({ recipe_id: 1, alternative_id: null, ingredient_id: 2, quantity_per_serving: 50, prep_note: null, position: 1 });
    const groups = groupBySupplier(computeOrderLines(data));
    expect(groups.map((g) => [g.supplier_name, g.lines.map((l) => l.name)])).toEqual([
      ["Spice Shop", ["Rice"]],
      ["Tesco", ["Spinach"]],
    ]);
  });
});

describe("suppliers and overrides", () => {
  it("falls back from ingredient supplier to the first supermarket to null", () => {
    expect(computeOrderLines(plan({ ingredients: [ing(1, "Rice", { supplier_id: 2 })] }))[0].supplier_name).toBe("Spice Shop");
    expect(computeOrderLines(plan())[0]).toMatchObject({ supplier_id: 1, supplier_name: "Tesco" });
    const none = computeOrderLines(plan({ suppliers: [spice] }))[0];
    expect(none).toMatchObject({ supplier_id: null, supplier_name: "Supermarket" });
    expect(none.order_by_date).toBe(none.delivery_date);
  });

  it("applies the chef's overrides for delivery, supplier and tick", () => {
    const data = plan({
      order_line_state: [{ retreat_id: 1, ingredient_id: 1, line_group: "2026-06-05", delivery_date: "2026-06-01", supplier_id: 2, ticked: 1 }],
    });
    expect(computeOrderLines(data)[0]).toMatchObject({
      delivery_date: "2026-06-01",
      order_by_date: "2026-05-27",
      supplier_id: 2,
      ticked: true,
    });
  });

  it("only applies an override to its own group", () => {
    const data = plan({
      order_line_state: [{ retreat_id: 1, ingredient_id: 1, line_group: "pantry", delivery_date: "2026-06-01", supplier_id: 2, ticked: 1 }],
    });
    expect(computeOrderLines(data)[0]).toMatchObject({ delivery_date: "2026-06-04", supplier_id: 1, ticked: false });
  });
});

describe("packs and rounding", () => {
  it("rounds up to whole packs and reports the leftover", () => {
    const data = plan({ ingredients: [ing(1, "Rice", { pack_size: 1500, pack_label: "1.5 kg bag" })] });
    expect(computeOrderLines(data)[0]).toMatchObject({ total: 2000, packs: 2, leftover: 1000, pack_label: "1.5 kg bag" });
  });

  it("tolerates floating point noise at an exact pack boundary", () => {
    const data = plan({ ingredients: [ing(1, "Rice", { pack_size: 1000 })] });
    data.recipe_lines[0].quantity_per_serving = 100.000000001;
    expect(computeOrderLines(data)[0]).toMatchObject({ packs: 2, leftover: 0 });
  });

  it("rounds each items up to a whole number when there is no pack size", () => {
    const data = plan({ ingredients: [ing(1, "Lemon", { base_unit: "each" })] });
    data.recipe_lines[0].quantity_per_serving = 0.33;
    const line = computeOrderLines(data)[0];
    expect(line).toMatchObject({ total: 7, display: "7", packs: null });
  });

  it("drops zero totals", () => {
    const data = plan();
    data.recipe_lines[0].quantity_per_serving = 0;
    expect(computeOrderLines(data)).toEqual([]);
  });
});

describe("formatQuantity", () => {
  it("formats friendly units", () => {
    expect(formatQuantity(1250, "g")).toBe("1.25 kg");
    expect(formatQuantity(750, "g")).toBe("750 g");
    expect(formatQuantity(1500, "ml")).toBe("1.5 l");
    expect(formatQuantity(300, "ml")).toBe("300 ml");
    expect(formatQuantity(12, "each")).toBe("12");
    expect(formatQuantity(2000, "g")).toBe("2 kg");
  });

  it("keeps one decimal for small g and ml", () => {
    expect(formatQuantity(7.25, "g")).toBe("7.3 g");
    expect(formatQuantity(5, "ml")).toBe("5 ml");
    expect(formatQuantity(333.333, "g")).toBe("333 g");
  });

  it("rolls 999.6 g over to kg", () => {
    expect(formatQuantity(999.6, "g")).toBe("1 kg");
  });

  it("allows at most 2 decimals for each", () => {
    expect(formatQuantity(1.5, "each")).toBe("1.5");
    expect(formatQuantity(0.3333, "each")).toBe("0.33");
  });
});

describe("scaleMeal and dayPrepAhead", () => {
  const withAlt = () => {
    const data = plan({
      recipes: [{ id: 1, title: "Dahl", servings: 4, method: "Simmer it." }],
      recipe_alternatives: [{ id: 5, recipe_id: 1, label: "Vegan" }],
      meal_dish_alternatives: [{ id: 1, meal_dish_id: 1, alternative_id: 5, servings: 3 }],
      recipe_lines: [
        { recipe_id: 1, alternative_id: null, ingredient_id: 1, quantity_per_serving: 100, prep_note: "rinsed", position: 0 },
        { recipe_id: 1, alternative_id: 5, ingredient_id: 2, quantity_per_serving: 80, prep_note: null, position: 0 },
      ],
      ingredients: [ing(1, "Rice"), ing(2, "Tofu")],
    });
    data.retreat.buffer_percent = 10;
    return data;
  };

  it("scales each version with the buffer", () => {
    const scaled = scaleMeal(withAlt(), 1)!;
    expect(scaled.people).toBe(20);
    expect(scaled.dishes).toHaveLength(1);
    const [dish] = scaled.dishes;
    expect(dish.method).toBe("Simmer it.");
    expect(dish.versions.map((v) => [v.label, v.alternative_id, v.servings])).toEqual([["Main", null, 17], ["Vegan", 5, 3]]);
    expect(dish.versions[0].lines[0]).toMatchObject({ name: "Rice", display: "1.87 kg", prep_note: "rinsed" });
    expect(dish.versions[0].lines[0].amount).toBeCloseTo(1870, 6);
    expect(dish.versions[1].lines[0]).toMatchObject({ name: "Tofu", display: "264 g" });
  });

  it("returns null for an unknown meal and omits a missing method", () => {
    expect(scaleMeal(plan(), 99)).toBeNull();
    expect(scaleMeal(plan(), 1)!.dishes[0]).not.toHaveProperty("method");
  });

  it("lists tomorrow's dishes to prep ahead", () => {
    const data = withAlt();
    expect(dayPrepAhead(data, "2026-06-04")).toEqual([
      {
        meal_id: 1,
        slot: "dinner",
        dishes: [{ recipe_id: 1, title: "Dahl", versions: [{ label: "Main", servings: 17 }, { label: "Vegan", servings: 3 }] }],
      },
    ]);
    expect(dayPrepAhead(data, "2026-06-05")).toEqual([]);
  });
});

describe("a realistic three-day retreat", () => {
  // 22 people, 3 vegans, 10% buffer. Brunch and dinner each day.
  function retreat(): PlanData {
    const meals = [];
    const dishes = [];
    const alts = [];
    let dishId = 0;
    for (const [i, date] of ["2026-09-11", "2026-09-12", "2026-09-13"].entries()) {
      for (const [j, slot] of ["brunch", "dinner"].entries()) {
        const id = i * 2 + j + 1;
        meals.push({ id, retreat_id: 1, date, slot, position: j, time_label: null, headcount: null });
        // Brunch is a frittata (vegan alternative), dinner is a curry (vegan alternative).
        dishes.push({ id: ++dishId, meal_id: id, recipe_id: j + 1, servings: null });
        alts.push({ id: dishId, meal_dish_id: dishId, alternative_id: j + 10, servings: 3 });
      }
    }
    return {
      retreat: { id: 1, name: "September", start_date: "2026-09-11", end_date: "2026-09-13", headcount: 22, buffer_percent: 10 },
      meals,
      meal_dishes: dishes,
      meal_dish_alternatives: alts,
      recipes: [
        { id: 1, title: "Frittata", servings: 6, method: null },
        { id: 2, title: "Curry", servings: 6, method: null },
      ],
      recipe_alternatives: [
        { id: 10, recipe_id: 1, label: "Vegan" },
        { id: 11, recipe_id: 2, label: "Vegan" },
      ],
      recipe_lines: [
        { recipe_id: 1, alternative_id: null, ingredient_id: 1, quantity_per_serving: 2, prep_note: null, position: 0 }, // eggs
        { recipe_id: 1, alternative_id: 10, ingredient_id: 2, quantity_per_serving: 100, prep_note: null, position: 0 }, // tofu
        { recipe_id: 2, alternative_id: null, ingredient_id: 3, quantity_per_serving: 150, prep_note: null, position: 0 }, // chicken
        { recipe_id: 2, alternative_id: 11, ingredient_id: 4, quantity_per_serving: 150, prep_note: null, position: 0 }, // chickpeas
        { recipe_id: 2, alternative_id: null, ingredient_id: 5, quantity_per_serving: 20, prep_note: null, position: 1 }, // curry paste
        { recipe_id: 2, alternative_id: 11, ingredient_id: 5, quantity_per_serving: 20, prep_note: null, position: 1 },
      ],
      ingredients: [
        ing(1, "Eggs", { base_unit: "each", pack_size: 12, pack_label: "box of 12" }),
        ing(2, "Tofu"),
        ing(3, "Chicken"),
        ing(4, "Chickpeas", { storage: "pantry", pack_size: 400, pack_label: "400 g tin" }),
        ing(5, "Curry paste", { storage: "pantry", supplier_id: 2 }),
      ],
      suppliers: [tesco, spice],
      order_line_state: [],
    };
  }

  it("computes the whole order", () => {
    const lines = computeOrderLines(retreat());
    const get = (name: string, group?: string) => lines.filter((l) => l.name === name && (!group || l.line_group === group));

    // Eggs: 19 non-vegans x 2 x 1.1 = 41.8, rounded up per pack of 12 -> 4 boxes, each day.
    expect(get("Eggs")).toHaveLength(3);
    expect(get("Eggs", "2026-09-12")[0]).toMatchObject({ delivery_date: "2026-09-11", packs: 4 });
    expect(get("Eggs", "2026-09-12")[0].total).toBeCloseTo(41.8, 6);

    // Tofu for 3 vegans: 3 x 100 x 1.1 = 330 g per day.
    expect(get("Tofu", "2026-09-13")[0]).toMatchObject({ total: expect.closeTo(330, 6), display: "330 g" });

    // Chicken: 19 x 150 x 1.1 = 3135 g per day.
    expect(get("Chicken", "2026-09-11")[0]).toMatchObject({ display: "3.14 kg", delivery_date: "2026-09-10" });

    // Chickpeas are pantry: 3 dinners x 3 vegans x 150 x 1.1 = 1485 g -> 4 tins of 400 g.
    expect(get("Chickpeas")).toHaveLength(1);
    expect(get("Chickpeas")[0]).toMatchObject({ line_group: "pantry", delivery_date: "2026-09-10", packs: 4 });
    expect(get("Chickpeas")[0].total).toBeCloseTo(1485, 6);
    expect(get("Chickpeas")[0].leftover).toBeCloseTo(115, 6);

    // Curry paste is used by both versions: 22 x 20 x 1.1 x 3 dinners = 1452 g, from the specialist 5 days ahead.
    expect(get("Curry paste")[0].total).toBeCloseTo(1452, 6);
    expect(get("Curry paste")[0]).toMatchObject({ supplier_name: "Spice Shop", order_by_date: "2026-09-05" });
    expect(get("Curry paste")[0].uses).toHaveLength(6);

    const days = groupByDelivery(lines);
    expect(days.map((d) => [d.delivery_date, d.pantry])).toEqual([
      ["2026-09-10", true],
      ["2026-09-11", false],
      ["2026-09-12", false],
    ]);
    expect(groupBySupplier(lines).map((g) => g.supplier_name).sort()).toEqual(["Spice Shop", "Tesco"]);
  });
});
