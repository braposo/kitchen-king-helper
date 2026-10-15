// Loads everything the quantities engine needs for one retreat.
import { dietsFromColumn, guestAlternatives, type TagRow } from "./diets";
import type {
  Ingredient, Meal, MealDish, MealDishAlternative, OrderLineState, PlanData, Recipe, RecipeAlternative, RecipeLine, Retreat, Supplier,
} from "./quantities";

// D1 allows about 100 bound values per statement.
const CHUNK = 80;

/** Selects rows whose `column` is in `ids`, in chunks. */
async function selectIn<T>(db: D1Database, select: string, column: string, ids: number[], tail = ""): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    const marks = part.map(() => "?").join(",");
    const { results } = await db.prepare(`${select} WHERE ${column} IN (${marks}) ${tail}`).bind(...part).all<T>();
    out.push(...results);
  }
  return out;
}

const unique = (xs: number[]) => [...new Set(xs)];

export async function loadPlanData(db: D1Database, retreatId: number): Promise<PlanData | null> {
  const retreat = await db
    .prepare("SELECT id, name, start_date, end_date, headcount, buffer_percent FROM retreats WHERE id = ?")
    .bind(retreatId)
    .first<Retreat>();
  if (!retreat) return null;

  const { results: meals } = await db
    .prepare("SELECT id, retreat_id, date, slot, position, time_label, headcount FROM meals WHERE retreat_id = ? ORDER BY date, position, id")
    .bind(retreatId)
    .all<Meal>();
  const mealIds = meals.map((m) => m.id);

  const dishRows = await selectIn<MealDish & { versions_from_guests: number }>(
    db,
    "SELECT id, meal_id, recipe_id, servings, versions_from_guests FROM meal_dishes",
    "meal_id",
    mealIds,
    "ORDER BY id",
  );
  const meal_dishes: MealDish[] = dishRows.map(({ versions_from_guests: _, ...d }) => d);
  const chefAlternatives = await selectIn<MealDishAlternative>(
    db,
    "SELECT id, meal_dish_id, alternative_id, servings FROM meal_dish_alternatives",
    "meal_dish_id",
    dishRows.filter((d) => !d.versions_from_guests).map((d) => d.id),
    "ORDER BY id",
  );

  const recipeIds = unique(meal_dishes.map((d) => d.recipe_id));
  const recipes = await selectIn<Recipe>(db, "SELECT id, title, servings, method FROM recipes", "id", recipeIds);
  const recipe_alternatives = await selectIn<RecipeAlternative>(db, "SELECT id, recipe_id, label FROM recipe_alternatives", "recipe_id", recipeIds);
  const tags = await selectIn<TagRow>(db, "SELECT recipe_id, alternative_id, tag, value FROM recipe_diet_tags", "recipe_id", recipeIds);
  const { results: guestRows } = await db
    .prepare("SELECT name, count, diets, note FROM retreat_guests WHERE retreat_id = ?")
    .bind(retreatId)
    .all<{ name: string | null; count: number; diets: string; note: string | null }>();
  // Dishes that follow the dietary list get their version servings from it.
  const guests = guestRows.map((g) => ({ ...g, diets: dietsFromColumn(g.diets) }));
  const fromGuests = guestAlternatives(guests, dishRows, recipe_alternatives, tags).rows.map((r, i) => ({ id: -(i + 1), ...r }));
  const meal_dish_alternatives = [...chefAlternatives, ...fromGuests];

  const recipe_lines = await selectIn<RecipeLine>(
    db,
    "SELECT recipe_id, alternative_id, ingredient_id, quantity_per_serving, prep_note, position FROM recipe_ingredients",
    "recipe_id",
    recipeIds,
    "ORDER BY position, id",
  );

  const ingredients = await selectIn<Ingredient>(
    db,
    "SELECT id, name, base_unit, storage, supplier_id, pack_size, pack_label FROM ingredients",
    "id",
    unique(recipe_lines.map((l) => l.ingredient_id)),
  );
  const { results: suppliers } = await db.prepare("SELECT id, name, kind, lead_days FROM suppliers ORDER BY id").all<Supplier>();
  const { results: order_line_state } = await db
    .prepare("SELECT retreat_id, ingredient_id, line_group, delivery_date, supplier_id, ticked FROM order_line_state WHERE retreat_id = ?")
    .bind(retreatId)
    .all<OrderLineState>();

  return {
    retreat, meals, meal_dishes, meal_dish_alternatives, recipes, recipe_alternatives, recipe_lines, ingredients, suppliers, order_line_state,
  };
}
