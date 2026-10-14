import { describe, expect, it } from "vitest";
import { previousDate, suggestForMeal } from "../src/lib/suggest";
import { recordingJev, seedDish, seedMeal, seedRecipe, seedRetreat } from "./helpers/fixtures";
import { testEnv } from "./helpers/d1";

/** Options the chef's candidates were offered in, from the recorded Jev call. */
const offered = (call: { questions: { kind: string; options?: string[] }[] }) =>
  call.questions[0].options ?? [];

describe("previousDate", () => {
  it("steps back one day across months", () => {
    expect(previousDate("2026-10-01")).toBe("2026-09-30");
    expect(previousDate("2026-10-14")).toBe("2026-10-13");
  });
});

describe("suggestForMeal", () => {
  it("returns null for an unknown meal", async () => {
    const { jev } = recordingJev();
    expect(await suggestForMeal(testEnv().DB, jev, 99)).toBeNull();
  });

  it("returns an empty list without calling Jev when nothing fits", async () => {
    const env = testEnv();
    const retreat = await seedRetreat(env);
    const meal = await seedMeal(env, { retreatId: retreat, date: "2026-10-14", slot: "brunch" });
    const { jev, calls } = recordingJev();
    expect(await suggestForMeal(env.DB, jev, meal)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("only offers recipes whose category fits the slot, plus uncategorised ones", async () => {
    const env = testEnv();
    const brunch = await seedRecipe(env, { title: "Pancakes", category: "brunch", category_source: "chef" });
    const anyDish = await seedRecipe(env, { title: "Soup", category: "any", category_source: "chef" });
    const plain = await seedRecipe(env, { title: "Plain oats" });
    await seedRecipe(env, { title: "Lamb stew", category: "dinner", category_source: "chef" });
    const retreat = await seedRetreat(env);
    const meal = await seedMeal(env, { retreatId: retreat, date: "2026-10-14", slot: "brunch" });
    const { jev, calls } = recordingJev();

    await suggestForMeal(env.DB, jev, meal);

    expect(offered(calls[0]).sort()).toEqual(["Pancakes", "Plain oats", "Soup"].sort());
    expect(brunch.id).toBeGreaterThan(0);
    expect(anyDish.id).toBeGreaterThan(0);
    expect(plain.id).toBeGreaterThan(0);
  });

  it("uses the dinner rule (dinner, side, any, none) for dinner and snacks for snacks", async () => {
    const env = testEnv();
    await seedRecipe(env, { title: "Lamb stew", category: "dinner", category_source: "chef" });
    await seedRecipe(env, { title: "Rice", category: "side", category_source: "chef" });
    await seedRecipe(env, { title: "Flapjacks", category: "snack", category_source: "chef" });
    const retreat = await seedRetreat(env);
    const dinner = await seedMeal(env, { retreatId: retreat, date: "2026-10-14", slot: "dinner" });
    const snacks = await seedMeal(env, { retreatId: retreat, date: "2026-10-14", slot: "snacks" });
    const { jev, calls } = recordingJev();

    await suggestForMeal(env.DB, jev, dinner);
    await suggestForMeal(env.DB, jev, snacks);

    expect(offered(calls[0]).sort()).toEqual(["Lamb stew", "Rice"]);
    expect(offered(calls[1])).toEqual(["Flapjacks"]);
  });

  it("offers every category in a custom slot", async () => {
    const env = testEnv();
    await seedRecipe(env, { title: "Pancakes", category: "brunch", category_source: "chef" });
    await seedRecipe(env, { title: "Flapjacks", category: "snack", category_source: "chef" });
    const retreat = await seedRetreat(env);
    const meal = await seedMeal(env, { retreatId: retreat, date: "2026-10-14", slot: "late night" });
    const { jev, calls } = recordingJev();
    await suggestForMeal(env.DB, jev, meal);
    expect(offered(calls[0]).sort()).toEqual(["Flapjacks", "Pancakes"]);
  });

  it("leaves out dishes already in this meal", async () => {
    const env = testEnv();
    const inMeal = await seedRecipe(env, { title: "Pancakes", category: "brunch", category_source: "chef" });
    await seedRecipe(env, { title: "Granola", category: "brunch", category_source: "chef" });
    const retreat = await seedRetreat(env);
    const meal = await seedMeal(env, { retreatId: retreat, date: "2026-10-14", slot: "brunch" });
    await seedDish(env, { mealId: meal, recipeId: inMeal.id });
    const { jev, calls } = recordingJev();
    await suggestForMeal(env.DB, jev, meal);
    expect(offered(calls[0])).toEqual(["Granola"]);
  });

  it("prefers dishes not used elsewhere that day, and falls back when that leaves nothing", async () => {
    const env = testEnv();
    const pancakes = await seedRecipe(env, { title: "Pancakes", category: "brunch", category_source: "chef" });
    const granola = await seedRecipe(env, { title: "Granola", category: "brunch", category_source: "chef" });
    const retreat = await seedRetreat(env);
    const brunch = await seedMeal(env, { retreatId: retreat, date: "2026-10-14", slot: "brunch", position: 0 });
    const other = await seedMeal(env, { retreatId: retreat, date: "2026-10-14", slot: "snacks", position: 1 });
    await seedDish(env, { mealId: other, recipeId: pancakes.id });
    const { jev, calls } = recordingJev();

    await suggestForMeal(env.DB, jev, brunch);
    expect(offered(calls[0])).toEqual(["Granola"]);

    // Granola is also used on the same day: nothing is left fresh, so both come back.
    await seedDish(env, { mealId: other, recipeId: granola.id });
    await suggestForMeal(env.DB, jev, brunch);
    expect(offered(calls[1]).sort()).toEqual(["Granola", "Pancakes"]);
  });

  it("does not treat dishes on other days or other retreats as used", async () => {
    const env = testEnv();
    const pancakes = await seedRecipe(env, { title: "Pancakes", category: "brunch", category_source: "chef" });
    const retreat = await seedRetreat(env);
    const otherRetreat = await seedRetreat(env, { name: "Other" });
    const brunch = await seedMeal(env, { retreatId: retreat, date: "2026-10-14", slot: "brunch" });
    const nextDay = await seedMeal(env, { retreatId: retreat, date: "2026-10-15", slot: "brunch" });
    const elsewhere = await seedMeal(env, { retreatId: otherRetreat, date: "2026-10-14", slot: "brunch" });
    await seedDish(env, { mealId: nextDay, recipeId: pancakes.id });
    await seedDish(env, { mealId: elsewhere, recipeId: pancakes.id });
    const { jev, calls } = recordingJev();
    await suggestForMeal(env.DB, jev, brunch);
    expect(offered(calls[0])).toEqual(["Pancakes"]);
  });

  it("gives Jev the plan: retreat, day, slot, people, alternative counts, and dishes today and the day before", async () => {
    const env = testEnv();
    const shakshuka = await seedRecipe(env, {
      title: "Shakshuka",
      category: "brunch",
      category_source: "chef",
      alternatives: [{ label: "Vegan", lines: [] }],
    });
    const granola = await seedRecipe(env, { title: "Granola", category: "brunch", category_source: "chef" });
    await seedRecipe(env, { title: "Pancakes", category: "brunch", category_source: "chef" });
    const retreat = await seedRetreat(env, { name: "Autumn men's retreat", headcount: 24 });
    const yesterday = await seedMeal(env, { retreatId: retreat, date: "2026-10-13", slot: "dinner" });
    const today1 = await seedMeal(env, { retreatId: retreat, date: "2026-10-14", slot: "brunch", position: 0, time_label: "around 11" });
    const today2 = await seedMeal(env, { retreatId: retreat, date: "2026-10-14", slot: "snacks", position: 1, headcount: 18 });
    const target = await seedMeal(env, { retreatId: retreat, date: "2026-10-14", slot: "brunch", position: 2, time_label: "around 11", headcount: 20 });
    await seedDish(env, { mealId: yesterday, recipeId: granola.id });
    await seedDish(env, {
      mealId: today1,
      recipeId: shakshuka.id,
      alternatives: [{ alternativeId: shakshuka.alternativeIds[0], servings: 3 }],
    });
    await seedDish(env, { mealId: today2, recipeId: granola.id });
    const { jev, calls } = recordingJev();

    await suggestForMeal(env.DB, jev, target);

    const state = calls[0].state;
    expect(state).toContain("Retreat: Autumn men's retreat");
    expect(state).toContain("Day: 2026-10-14");
    expect(state).toContain("Meal: brunch, around 11");
    expect(state).toContain("People at this meal: 20");
    expect(state).toContain("Vegan: 3");
    expect(state).toContain("Dishes already planned today:");
    expect(state).toContain("Shakshuka (brunch)");
    expect(state).toContain("Granola (snacks)");
    expect(state).toContain("Dishes planned the day before: Granola");
  });

  it("uses the retreat headcount when the meal has none", async () => {
    const env = testEnv();
    await seedRecipe(env, { title: "Pancakes", category: "brunch", category_source: "chef" });
    const retreat = await seedRetreat(env, { headcount: 33 });
    const meal = await seedMeal(env, { retreatId: retreat, date: "2026-10-14", slot: "brunch" });
    const { jev, calls } = recordingJev();
    await suggestForMeal(env.DB, jev, meal);
    expect(calls[0].state).toContain("People at this meal: 33");
  });

  it("returns the top three, most likely first, with the real titles", async () => {
    const env = testEnv();
    for (const title of ["Pancakes", "Granola", "Porridge", "Toast", "Frittata"]) {
      await seedRecipe(env, { title, category: "brunch", category_source: "chef" });
    }
    const retreat = await seedRetreat(env);
    const meal = await seedMeal(env, { retreatId: retreat, date: "2026-10-14", slot: "brunch" });
    const odds: Record<string, number> = { Pancakes: 0.5, Granola: 0.6, Porridge: 0.3, Toast: 0.8, Frittata: 0.1 };
    const { jev } = recordingJev((_s, qs) => [
      { kind: "choose", probabilities: qs[0].kind === "choose" ? qs[0].options.map((o) => odds[o]) : [] },
    ]);

    const result = await suggestForMeal(env.DB, jev, meal);

    expect(result?.map((r) => r.title)).toEqual(["Toast", "Granola", "Pancakes"]);
    expect(result?.map((r) => r.probability)).toEqual([0.8, 0.6, 0.5]);
    expect(result?.every((r) => typeof r.recipe_id === "number")).toBe(true);
  });

  it("returns what there is when there are fewer than three candidates", async () => {
    const env = testEnv();
    await seedRecipe(env, { title: "Pancakes", category: "brunch", category_source: "chef" });
    const retreat = await seedRetreat(env);
    const meal = await seedMeal(env, { retreatId: retreat, date: "2026-10-14", slot: "brunch" });
    const { jev } = recordingJev();
    const result = await suggestForMeal(env.DB, jev, meal);
    expect(result).toHaveLength(1);
    expect(result?.[0].title).toBe("Pancakes");
  });

  it("keeps duplicate titles apart and maps each back to its own recipe", async () => {
    const env = testEnv();
    const first = await seedRecipe(env, { title: "Pancakes", category: "brunch", category_source: "chef" });
    const second = await seedRecipe(env, { title: "Pancakes", category: "brunch", category_source: "chef" });
    const retreat = await seedRetreat(env);
    const meal = await seedMeal(env, { retreatId: retreat, date: "2026-10-14", slot: "brunch" });
    const { jev, calls } = recordingJev((_s, qs) => [
      { kind: "choose", probabilities: qs[0].kind === "choose" ? qs[0].options.map((o) => (o.includes("#") ? 0.9 : 0.5)) : [] },
    ]);

    const result = await suggestForMeal(env.DB, jev, meal);

    expect(offered(calls[0])).toHaveLength(2);
    expect(new Set(offered(calls[0])).size).toBe(2);
    // The suffixed label is the first candidate in the list, so it gets the higher odds here.
    expect(result?.map((r) => r.recipe_id)).toEqual([first.id, second.id]);
    expect(result?.map((r) => r.title)).toEqual(["Pancakes", "Pancakes"]);
  });

  it("offers at most 255 candidates, newest first", async () => {
    const env = testEnv();
    const insert = env.DB.prepare("INSERT INTO recipes (title, servings, category, category_source, created_at) VALUES (?, 1, 'brunch', 'chef', ?)");
    const batch = [];
    for (let i = 1; i <= 260; i++) {
      batch.push(insert.bind(`Dish ${String(i).padStart(3, "0")}`, `2026-01-${String((i % 28) + 1).padStart(2, "0")} 00:00:${String(i % 60).padStart(2, "0")}`));
    }
    await env.DB.batch(batch);
    const retreat = await seedRetreat(env);
    const meal = await seedMeal(env, { retreatId: retreat, date: "2026-10-14", slot: "brunch" });
    const { jev, calls } = recordingJev();

    await suggestForMeal(env.DB, jev, meal);

    expect(offered(calls[0])).toHaveLength(255);
  });
});
