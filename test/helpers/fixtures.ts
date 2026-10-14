// Seed helpers for the AI tests: recipes with versions, retreats, meals and dishes.
import type { Env } from "../../src/env";
import { jevFromAsk, mockJev, type Answer, type Question } from "../../src/lib/jev";

type Line = { name: string; prep?: string };

export async function seedRecipe(
  env: Env,
  opts: {
    title: string;
    method?: string | null;
    category?: string | null;
    category_source?: "jev" | "chef" | null;
    lines?: Line[];
    alternatives?: { label: string; lines: Line[] }[];
  },
) {
  const db = env.DB;
  const recipe = await db
    .prepare("INSERT INTO recipes (title, servings, method, category, category_source) VALUES (?, 4, ?, ?, ?) RETURNING id")
    .bind(opts.title, opts.method ?? null, opts.category ?? null, opts.category_source ?? null)
    .first<{ id: number }>();
  const recipeId = recipe!.id;

  const addLines = async (alternativeId: number | null, lines: Line[]) => {
    for (const [position, line] of lines.entries()) {
      await db.prepare("INSERT OR IGNORE INTO ingredients (name, base_unit) VALUES (?, 'g')").bind(line.name).run();
      const ing = await db.prepare("SELECT id FROM ingredients WHERE name = ?").bind(line.name).first<{ id: number }>();
      await db
        .prepare(
          "INSERT INTO recipe_ingredients (recipe_id, alternative_id, ingredient_id, quantity_per_serving, prep_note, position) VALUES (?, ?, ?, 10, ?, ?)",
        )
        .bind(recipeId, alternativeId, ing!.id, line.prep ?? null, position)
        .run();
    }
  };

  await addLines(null, opts.lines ?? []);
  const alternativeIds: number[] = [];
  for (const alt of opts.alternatives ?? []) {
    const row = await db
      .prepare("INSERT INTO recipe_alternatives (recipe_id, label) VALUES (?, ?) RETURNING id")
      .bind(recipeId, alt.label)
      .first<{ id: number }>();
    alternativeIds.push(row!.id);
    await addLines(row!.id, alt.lines);
  }
  return { id: recipeId, alternativeIds };
}

export async function seedRetreat(env: Env, opts: { name?: string; headcount?: number; start?: string; end?: string } = {}) {
  const row = await env.DB.prepare(
    "INSERT INTO retreats (name, start_date, end_date, headcount) VALUES (?, ?, ?, ?) RETURNING id",
  )
    .bind(opts.name ?? "Men's retreat", opts.start ?? "2026-10-14", opts.end ?? "2026-10-16", opts.headcount ?? 20)
    .first<{ id: number }>();
  return row!.id;
}

export async function seedMeal(
  env: Env,
  opts: { retreatId: number; date: string; slot: string; position?: number; time_label?: string | null; headcount?: number | null },
) {
  const row = await env.DB.prepare(
    "INSERT INTO meals (retreat_id, date, slot, position, time_label, headcount) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
  )
    .bind(opts.retreatId, opts.date, opts.slot, opts.position ?? 0, opts.time_label ?? null, opts.headcount ?? null)
    .first<{ id: number }>();
  return row!.id;
}

/** Adds a dish to a meal. `alternatives` maps alternative ids to the servings that eat them. */
export async function seedDish(
  env: Env,
  opts: { mealId: number; recipeId: number; alternatives?: { alternativeId: number; servings: number }[] },
) {
  const row = await env.DB.prepare("INSERT INTO meal_dishes (meal_id, recipe_id) VALUES (?, ?) RETURNING id")
    .bind(opts.mealId, opts.recipeId)
    .first<{ id: number }>();
  for (const a of opts.alternatives ?? []) {
    await env.DB.prepare("INSERT INTO meal_dish_alternatives (meal_dish_id, alternative_id, servings) VALUES (?, ?, ?)")
      .bind(row!.id, a.alternativeId, a.servings)
      .run();
  }
  return row!.id;
}

/**
 * A Jev stand-in that records every call. By default it answers with the offline
 * mock; pass `respond` to force specific answers.
 */
export function recordingJev(respond?: (state: string, questions: Question[]) => Answer[]) {
  const calls: { state: string; questions: Question[] }[] = [];
  const jev = jevFromAsk(async (state, questions) => {
    calls.push({ state, questions });
    return respond ? respond(state, questions) : mockJev.ask(state, questions);
  });
  return { jev, calls };
}
