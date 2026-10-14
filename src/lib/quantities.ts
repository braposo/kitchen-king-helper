// The quantities engine: turns a retreat plan into order lines and scaled recipes.
// Pure functions over PlanData (see plan-data.ts for loading it from D1).

export type BaseUnit = "g" | "ml" | "each";

export type Retreat = { id: number; name: string; start_date: string; end_date: string; headcount: number; buffer_percent: number };
export type Meal = { id: number; retreat_id: number; date: string; slot: string; position: number; time_label: string | null; headcount: number | null };
export type MealDish = { id: number; meal_id: number; recipe_id: number; servings: number | null };
export type MealDishAlternative = { id: number; meal_dish_id: number; alternative_id: number; servings: number };
export type Recipe = { id: number; title: string; servings: number; method: string | null };
export type RecipeAlternative = { id: number; recipe_id: number; label: string };
export type RecipeLine = {
  recipe_id: number;
  alternative_id: number | null;
  ingredient_id: number;
  quantity_per_serving: number;
  prep_note: string | null;
  position: number;
};
export type Ingredient = {
  id: number;
  name: string;
  base_unit: BaseUnit;
  storage: "fresh" | "pantry";
  supplier_id: number | null;
  pack_size: number | null;
  pack_label: string | null;
};
export type Supplier = { id: number; name: string; kind: "supermarket" | "specialist"; lead_days: number };
export type OrderLineState = {
  retreat_id: number;
  ingredient_id: number;
  line_group: string;
  delivery_date: string | null;
  supplier_id: number | null;
  ticked: number;
};

export type PlanData = {
  retreat: Retreat;
  meals: Meal[];
  meal_dishes: MealDish[];
  meal_dish_alternatives: MealDishAlternative[];
  recipes: Recipe[];
  recipe_alternatives: RecipeAlternative[];
  recipe_lines: RecipeLine[];
  ingredients: Ingredient[];
  suppliers: Supplier[];
  order_line_state: OrderLineState[];
};

export type OrderUse = {
  date: string;
  meal_id: number;
  slot: string;
  recipe_id: number;
  recipe_title: string;
  version_label: string;
  amount: number;
};

export type OrderLine = {
  ingredient_id: number;
  name: string;
  base_unit: BaseUnit;
  storage: "fresh" | "pantry";
  line_group: string;
  delivery_date: string;
  order_by_date: string;
  supplier_id: number | null;
  supplier_name: string;
  total: number;
  display: string;
  packs: number | null;
  pack_label: string | null;
  leftover: number | null;
  ticked: boolean;
  uses: OrderUse[];
};

export type ScaledLine = { ingredient_id: number; name: string; amount: number; display: string; prep_note: string | null };
export type ScaledVersion = { alternative_id: number | null; label: string; servings: number; lines: ScaledLine[] };
export type ScaledDish = { recipe_id: number; title: string; method?: string; versions: ScaledVersion[] };
export type ScaledMeal = { meal: Meal; people: number; dishes: ScaledDish[] };

export type PrepAheadMeal = {
  meal_id: number;
  slot: string;
  dishes: { recipe_id: number; title: string; versions: { label: string; servings: number }[] }[];
};

// ---------- dates ----------

/** Adds days to a YYYY-MM-DD date (UTC, so no daylight-saving surprises). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------- formatting ----------

/** Rounds to `decimals` places and drops trailing zeros ("1.50" -> "1.5"). */
function trim(value: number, decimals: number): string {
  return String(Number(value.toFixed(decimals)));
}

/** Friendly text for a base-unit amount: "1.25 kg", "750 g", "1.5 l", "300 ml", "12". */
export function formatQuantity(value: number, baseUnit: BaseUnit): string {
  // Whole items can't be bought or cooked in hundredths: round up to the next half.
  if (baseUnit === "each") return trim(Math.ceil(value * 2 - EPSILON) / 2, 1);
  // Round first so 999.6 g reads "1 kg", not "1000 g".
  const small = value < 10 ? Number(value.toFixed(1)) : Math.round(value);
  if (small >= 1000) return `${trim(value / 1000, 2)} ${baseUnit === "g" ? "kg" : "l"}`;
  return `${trim(small, 1)} ${baseUnit}`;
}

// ---------- servings ----------

const EPSILON = 1e-6;

/** People eating a meal: the meal's own headcount, else the retreat's. */
export function mealPeople(retreat: Retreat, meal: Meal): number {
  return meal.headcount ?? retreat.headcount;
}

type Version = { alternative_id: number | null; label: string; servings: number };

/** The versions of one dish with their servings. Main = explicit servings, else people minus alternatives. */
function dishVersions(data: PlanData, dish: MealDish, people: number): Version[] {
  const alts = data.meal_dish_alternatives.filter((a) => a.meal_dish_id === dish.id);
  const altTotal = alts.reduce((sum, a) => sum + a.servings, 0);
  const main = dish.servings ?? Math.max(0, people - altTotal);
  const versions: Version[] = [{ alternative_id: null, label: "Main", servings: main }];
  for (const a of alts) {
    const label = data.recipe_alternatives.find((r) => r.id === a.alternative_id)?.label ?? "Alternative";
    versions.push({ alternative_id: a.alternative_id, label, servings: a.servings });
  }
  return versions.filter((v) => v.servings > 0);
}

function sortedMeals(data: PlanData): Meal[] {
  return [...data.meals].sort((a, b) => a.date.localeCompare(b.date) || a.position - b.position || a.id - b.id);
}

function dishesOf(data: PlanData, mealId: number): MealDish[] {
  return data.meal_dishes.filter((d) => d.meal_id === mealId).sort((a, b) => a.id - b.id);
}

function linesOf(data: PlanData, recipeId: number, alternativeId: number | null): RecipeLine[] {
  return data.recipe_lines
    .filter((l) => l.recipe_id === recipeId && l.alternative_id === alternativeId)
    .sort((a, b) => a.position - b.position);
}

const bufferFactor = (retreat: Retreat) => 1 + retreat.buffer_percent / 100;

// ---------- order lines ----------

type Draft = { ingredient: Ingredient; line_group: string; total: number; uses: OrderUse[] };

/** Rounds up, ignoring floating point noise (2.0000001 -> 2). */
function ceilTolerant(x: number): number {
  return Math.ceil(x - EPSILON);
}

export function computeOrderLines(data: PlanData): OrderLine[] {
  const factor = bufferFactor(data.retreat);
  const ingredients = new Map(data.ingredients.map((i) => [i.id, i]));
  const recipes = new Map(data.recipes.map((r) => [r.id, r]));
  const drafts = new Map<string, Draft>();

  for (const meal of sortedMeals(data)) {
    const people = mealPeople(data.retreat, meal);
    for (const dish of dishesOf(data, meal.id)) {
      const recipe = recipes.get(dish.recipe_id);
      if (!recipe) continue;
      for (const version of dishVersions(data, dish, people)) {
        // Lines of the same ingredient within one version are one "use".
        const perIngredient = new Map<number, number>();
        for (const line of linesOf(data, dish.recipe_id, version.alternative_id)) {
          const amount = line.quantity_per_serving * version.servings * factor;
          perIngredient.set(line.ingredient_id, (perIngredient.get(line.ingredient_id) ?? 0) + amount);
        }
        for (const [ingredientId, amount] of perIngredient) {
          const ingredient = ingredients.get(ingredientId);
          if (!ingredient) continue;
          const group = ingredient.storage === "pantry" ? "pantry" : meal.date;
          const key = `${ingredientId}|${group}`;
          let draft = drafts.get(key);
          if (!draft) drafts.set(key, (draft = { ingredient, line_group: group, total: 0, uses: [] }));
          draft.total += amount;
          draft.uses.push({
            date: meal.date,
            meal_id: meal.id,
            slot: meal.slot,
            recipe_id: recipe.id,
            recipe_title: recipe.title,
            version_label: version.label,
            amount,
          });
        }
      }
    }
  }

  const suppliers = new Map(data.suppliers.map((s) => [s.id, s]));
  const fallback = data.suppliers.find((s) => s.kind === "supermarket") ?? null;
  const states = new Map(data.order_line_state.map((s) => [`${s.ingredient_id}|${s.line_group}`, s]));

  const lines: OrderLine[] = [];
  for (const [key, d] of drafts) {
    if (d.total <= EPSILON) continue;
    const { ingredient } = d;
    const state = states.get(key);
    const supplierId = state?.supplier_id ?? ingredient.supplier_id ?? fallback?.id ?? null;
    const supplier = supplierId == null ? null : (suppliers.get(supplierId) ?? null);
    const delivery = state?.delivery_date ?? addDays(d.line_group === "pantry" ? data.retreat.start_date : d.line_group, -1);

    // Whole items are ordered whole, packed or not (41.8 eggs is 42 eggs).
    const total = ingredient.base_unit === "each" ? ceilTolerant(d.total) : d.total;
    let packs: number | null = null;
    let leftover: number | null = null;
    if (ingredient.pack_size && ingredient.pack_size > 0) {
      packs = ceilTolerant(total / ingredient.pack_size);
      leftover = Math.max(0, Number((packs * ingredient.pack_size - total).toFixed(6)));
    }

    lines.push({
      ingredient_id: ingredient.id,
      name: ingredient.name,
      base_unit: ingredient.base_unit,
      storage: ingredient.storage,
      line_group: d.line_group,
      delivery_date: delivery,
      order_by_date: addDays(delivery, -(supplier?.lead_days ?? 0)),
      supplier_id: supplier?.id ?? null,
      supplier_name: supplier?.name ?? "Supermarket",
      total,
      display: formatQuantity(total, ingredient.base_unit),
      packs,
      pack_label: ingredient.pack_label,
      leftover,
      ticked: !!state?.ticked,
      uses: d.uses,
    });
  }
  return lines.sort((a, b) => a.delivery_date.localeCompare(b.delivery_date) || a.name.localeCompare(b.name));
}

/** Delivery days in date order; the pantry delivery is flagged. */
export function groupByDelivery(lines: OrderLine[]): { delivery_date: string; pantry: boolean; lines: OrderLine[] }[] {
  const groups = new Map<string, { delivery_date: string; pantry: boolean; lines: OrderLine[] }>();
  for (const line of lines) {
    let g = groups.get(line.delivery_date);
    if (!g) groups.set(line.delivery_date, (g = { delivery_date: line.delivery_date, pantry: false, lines: [] }));
    g.lines.push(line);
    if (line.line_group === "pantry") g.pantry = true;
  }
  return [...groups.values()].sort((a, b) => a.delivery_date.localeCompare(b.delivery_date));
}

/** One group per supplier, in order of first appearance. */
export function groupBySupplier(lines: OrderLine[]): { supplier_id: number | null; supplier_name: string; lines: OrderLine[] }[] {
  const groups = new Map<number | null, { supplier_id: number | null; supplier_name: string; lines: OrderLine[] }>();
  for (const line of lines) {
    let g = groups.get(line.supplier_id);
    if (!g) groups.set(line.supplier_id, (g = { supplier_id: line.supplier_id, supplier_name: line.supplier_name, lines: [] }));
    g.lines.push(line);
  }
  return [...groups.values()];
}

// ---------- daily sheet and recipe cards ----------

/** One meal with every dish scaled to the people eating each version, buffer included. */
export function scaleMeal(data: PlanData, mealId: number): ScaledMeal | null {
  const meal = data.meals.find((m) => m.id === mealId);
  if (!meal) return null;
  const factor = bufferFactor(data.retreat);
  const ingredients = new Map(data.ingredients.map((i) => [i.id, i]));
  const people = mealPeople(data.retreat, meal);

  const dishes: ScaledDish[] = [];
  for (const dish of dishesOf(data, meal.id)) {
    const recipe = data.recipes.find((r) => r.id === dish.recipe_id);
    if (!recipe) continue;
    const versions: ScaledVersion[] = dishVersions(data, dish, people).map((v) => ({
      ...v,
      lines: linesOf(data, recipe.id, v.alternative_id).flatMap((l) => {
        const ingredient = ingredients.get(l.ingredient_id);
        if (!ingredient) return [];
        const amount = l.quantity_per_serving * v.servings * factor;
        return [{ ingredient_id: ingredient.id, name: ingredient.name, amount, display: formatQuantity(amount, ingredient.base_unit), prep_note: l.prep_note }];
      }),
    }));
    const scaled: ScaledDish = { recipe_id: recipe.id, title: recipe.title, versions };
    if (recipe.method) scaled.method = recipe.method;
    dishes.push(scaled);
  }
  return { meal, people, dishes };
}

/** Meals on the day after `date`, so today's sheet can say what to prep ahead. */
export function dayPrepAhead(data: PlanData, date: string): PrepAheadMeal[] {
  const tomorrow = addDays(date, 1);
  return sortedMeals(data)
    .filter((m) => m.date === tomorrow)
    .map((meal) => {
      const people = mealPeople(data.retreat, meal);
      const dishes = dishesOf(data, meal.id).flatMap((dish) => {
        const recipe = data.recipes.find((r) => r.id === dish.recipe_id);
        if (!recipe) return [];
        return [{ recipe_id: recipe.id, title: recipe.title, versions: dishVersions(data, dish, people).map((v) => ({ label: v.label, servings: v.servings })) }];
      });
      return { meal_id: meal.id, slot: meal.slot, dishes };
    });
}
