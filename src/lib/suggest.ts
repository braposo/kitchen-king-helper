import type { Jev } from "./jev";

// Suggests up to three recipes for one meal, using Jev to rank the candidates.

export type Suggestion = { recipe_id: number; title: string; probability: number };

const SUGGESTION_COUNT = 3;
const CANDIDATE_CAP = 255;
const QUESTION = "Which of these dishes fits this meal best, given what is already planned?";

/** Recipe categories that fit each meal slot. NULL (no category) always fits. Custom slots accept everything. */
const SLOT_CATEGORIES: Record<string, string[]> = {
  brunch: ["brunch", "any"],
  snacks: ["snack", "any"],
  dinner: ["dinner", "side", "any"],
};

type MealRow = {
  id: number;
  retreat_id: number;
  date: string;
  slot: string;
  time_label: string | null;
  headcount: number | null;
  retreat_name: string;
  retreat_headcount: number;
};

type DishRow = { meal_id: number; slot: string; title: string };

/** The day before a YYYY-MM-DD date. */
export function previousDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** Recipes that fit this meal, newest first, capped at 255. Same-day dishes are left out when that leaves any. */
async function candidates(db: D1Database, meal: MealRow): Promise<{ id: number; title: string }[]> {
  const allowed = SLOT_CATEGORIES[meal.slot];
  const categoryClause = allowed
    ? `(r.category IS NULL OR r.category IN (${allowed.map(() => "?").join(", ")}))`
    : "1 = 1";
  const categoryBinds = allowed ?? [];
  const sameDay = `SELECT md.recipe_id FROM meal_dishes md
    JOIN meals m2 ON m2.id = md.meal_id
    WHERE m2.retreat_id = ? AND m2.date = ? AND m2.id <> ?`;
  const query = (excludeSameDay: boolean) =>
    db
      .prepare(
        `SELECT r.id, r.title FROM recipes r
         WHERE ${categoryClause}
           AND r.id NOT IN (SELECT recipe_id FROM meal_dishes WHERE meal_id = ?)
           ${excludeSameDay ? `AND r.id NOT IN (${sameDay})` : ""}
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT ${CANDIDATE_CAP}`,
      )
      .bind(
        ...categoryBinds,
        meal.id,
        ...(excludeSameDay ? [meal.retreat_id, meal.date, meal.id] : []),
      );

  const { results: fresh } = await query(true).all<{ id: number; title: string }>();
  if (fresh.length > 0) return fresh;
  const { results: all } = await query(false).all<{ id: number; title: string }>();
  return all;
}

async function dishesOn(db: D1Database, retreatId: number, date: string): Promise<DishRow[]> {
  const { results } = await db
    .prepare(
      `SELECT md.meal_id, m.slot, r.title FROM meal_dishes md
       JOIN meals m ON m.id = md.meal_id
       JOIN recipes r ON r.id = md.recipe_id
       WHERE m.retreat_id = ? AND m.date = ?
       ORDER BY m.position, md.id`,
    )
    .bind(retreatId, date)
    .all<DishRow>();
  return results;
}

/** Plain-text summary of the plan for Jev. */
function buildState(
  meal: MealRow,
  people: number,
  thisMeal: string[],
  otherMeals: DishRow[],
  yesterday: DishRow[],
  diet: { label: string; servings: number }[],
): string {
  const list = (titles: string[]) => (titles.length ? titles.join(", ") : "none yet");
  const dayDishes = otherMeals.map((d) => `${d.title} (${d.slot})`);
  const dietLine = diet.length
    ? diet.map((d) => `${d.label}: ${d.servings}`).join(", ")
    : "no alternatives on other meals today";
  return [
    `Retreat: ${meal.retreat_name}`,
    `Day: ${meal.date}`,
    `Meal: ${meal.slot}, ${meal.time_label ?? "no time set"}`,
    `People at this meal: ${people}`,
    `Dishes already in this meal: ${list(thisMeal)}`,
    `Other meals today eat these alternatives: ${dietLine}`,
    `Dishes already planned today: ${list(dayDishes)}`,
    `Dishes planned the day before: ${list(yesterday.map((d) => d.title))}`,
  ].join("\n");
}

/** Top three recipes for a meal, most likely first. Returns null for an unknown meal. */
export async function suggestForMeal(db: D1Database, jev: Jev, mealId: number): Promise<Suggestion[] | null> {
  const meal = await db
    .prepare(
      `SELECT m.id, m.retreat_id, m.date, m.slot, m.time_label, m.headcount,
              r.name AS retreat_name, r.headcount AS retreat_headcount
       FROM meals m JOIN retreats r ON r.id = m.retreat_id
       WHERE m.id = ?`,
    )
    .bind(mealId)
    .first<MealRow>();
  if (!meal) return null;

  const pool = await candidates(db, meal);
  if (pool.length === 0) return [];

  // Titles must be unique so the answer maps back to one recipe.
  const used = new Set<string>();
  const byOption = new Map<string, { id: number; title: string }>();
  const options = pool.map((r) => {
    let label = r.title;
    if (used.has(label)) label = `${r.title} (#${r.id})`;
    used.add(label);
    byOption.set(label, r);
    return label;
  });

  const day = await dishesOn(db, meal.retreat_id, meal.date);
  const otherMeals = day.filter((d) => d.meal_id !== meal.id);
  const yesterday = await dishesOn(db, meal.retreat_id, previousDate(meal.date));
  const thisMeal = day.filter((d) => d.meal_id === meal.id).map((d) => d.title);

  const { results: diet } = await db
    .prepare(
      `SELECT ra.label AS label, SUM(mda.servings) AS servings
       FROM meal_dish_alternatives mda
       JOIN meal_dishes md ON md.id = mda.meal_dish_id
       JOIN meals m ON m.id = md.meal_id
       JOIN recipe_alternatives ra ON ra.id = mda.alternative_id
       WHERE m.retreat_id = ? AND m.date = ? AND m.id <> ?
       GROUP BY ra.label ORDER BY ra.label`,
    )
    .bind(meal.retreat_id, meal.date, meal.id)
    .all<{ label: string; servings: number }>();

  const people = meal.headcount ?? meal.retreat_headcount;
  const state = buildState(meal, people, thisMeal, otherMeals, yesterday, diet);
  const ranked = await jev.choose(state, QUESTION, options);

  return ranked.slice(0, SUGGESTION_COUNT).flatMap((r) => {
    const recipe = byOption.get(r.option);
    return recipe ? [{ recipe_id: recipe.id, title: recipe.title, probability: r.probability }] : [];
  });
}
