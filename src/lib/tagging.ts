import type { Jev, Question } from "./jev";

// Recipe categories and diet tags, suggested by Jev or set by the chef.
// Chef values always win: Jev never overwrites a row whose source is 'chef'.

export const CATEGORIES = ["brunch", "snack", "dinner", "side", "any"] as const;
export const DIET_TAGS = ["vegetarian", "vegan", "gluten_free", "dairy_free", "contains_nuts"] as const;
export type Category = (typeof CATEGORIES)[number];
export type DietTag = (typeof DIET_TAGS)[number];

/** A tag below this confidence is shown as "check this". */
export const UNSURE_BELOW = 0.9;

const METHOD_LIMIT = 2000;
const MAIN_LABEL = "Main version";

const CATEGORY_PROMPT = "Which meal is this dish mainly for?";
const DIET_PROMPTS: Record<DietTag, string> = {
  vegetarian: "Is this dish vegetarian (no meat or fish)?",
  vegan: "Is this dish vegan (no meat, fish, dairy, eggs or honey)?",
  gluten_free: "Is this dish gluten-free?",
  dairy_free: "Is this dish dairy-free?",
  contains_nuts: "Does this dish contain nuts?",
};

/** Thrown for chef input that does not fit the recipe (for example an alternative of another recipe). */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

export type TagValue = {
  tag: DietTag;
  value: boolean;
  confidence: number | null;
  source: "jev" | "chef";
  unsure: boolean;
};

export type VersionTags = {
  alternative_id: number | null;
  label: string;
  tags: TagValue[];
};

export type RecipeTags = {
  category: Category | null;
  category_source: "jev" | "chef" | null;
  versions: VersionTags[];
};

export type ChefTagInput = {
  category?: Category | null;
  tags?: { alternative_id: number | null; tag: DietTag; value: boolean }[];
};

type IngredientLine = { alternative_id: number | null; name: string; prep_note: string | null };

/** The text Jev reads for one version of a recipe. */
export function buildState(title: string, label: string, lines: IngredientLine[], method: string | null, alternativeId: number | null): string {
  const ingredients = lines
    .filter((l) => l.alternative_id === alternativeId)
    .map((l) => (l.prep_note ? `- ${l.name} (${l.prep_note})` : `- ${l.name}`));
  return [
    `Dish: ${title}`,
    `Version: ${label}`,
    "Ingredients:",
    ...(ingredients.length ? ingredients : ["- none listed"]),
    "Method:",
    (method ?? "").slice(0, METHOD_LIMIT) || "none given",
  ].join("\n");
}

// Only overwrites rows Jev made. Chef rows are left alone.
const UPSERT_JEV_TAG = `INSERT INTO recipe_diet_tags (recipe_id, alternative_id, tag, value, confidence, source)
  VALUES (?, ?, ?, ?, ?, 'jev')
  ON CONFLICT (recipe_id, IFNULL(alternative_id, 0), tag)
  DO UPDATE SET value = excluded.value, confidence = excluded.confidence, source = 'jev'
  WHERE recipe_diet_tags.source = 'jev'`;

/** Asks Jev for a category (main version only) and diet tags (each version), then saves what it said. */
export async function tagRecipe(db: D1Database, jev: Jev, recipeId: number): Promise<RecipeTags | null> {
  const recipe = await db
    .prepare("SELECT id, title, method, category_source FROM recipes WHERE id = ?")
    .bind(recipeId)
    .first<{ id: number; title: string; method: string | null; category_source: string | null }>();
  if (!recipe) return null;

  const { results: alts } = await db
    .prepare("SELECT id, label FROM recipe_alternatives WHERE recipe_id = ? ORDER BY id")
    .bind(recipeId)
    .all<{ id: number; label: string }>();
  const { results: lines } = await db
    .prepare(
      `SELECT ri.alternative_id, i.name, ri.prep_note FROM recipe_ingredients ri
       JOIN ingredients i ON i.id = ri.ingredient_id
       WHERE ri.recipe_id = ? ORDER BY ri.position, ri.id`,
    )
    .bind(recipeId)
    .all<IngredientLine>();
  const { results: existing } = await db
    .prepare("SELECT alternative_id, tag FROM recipe_diet_tags WHERE recipe_id = ? AND source = 'chef'")
    .bind(recipeId)
    .all<{ alternative_id: number | null; tag: DietTag }>();

  const chefRows = new Set(existing.map((r) => `${r.alternative_id ?? 0}:${r.tag}`));
  const versions = [
    { alternative_id: null, label: MAIN_LABEL },
    ...alts.map((a) => ({ alternative_id: a.id, label: a.label })),
  ];
  const statements: D1PreparedStatement[] = [];

  // Category: main version only, and only when the chef has not set one.
  if (recipe.category_source !== "chef") {
    const state = buildState(recipe.title, MAIN_LABEL, lines, recipe.method, null);
    const [answer] = await jev.ask(state, [
      { kind: "choose", key: "category", prompt: CATEGORY_PROMPT, options: [...CATEGORIES] },
    ]);
    if (answer?.kind !== "choose") throw new Error("Jev did not answer the category question");
    const best = CATEGORIES[answer.probabilities.indexOf(Math.max(...answer.probabilities))];
    statements.push(
      db
        .prepare(
          `UPDATE recipes SET category = ?, category_source = 'jev'
           WHERE id = ? AND (category_source IS NULL OR category_source <> 'chef')`,
        )
        .bind(best, recipeId),
    );
  }

  // Diet tags: one Jev call per version, for the tags the chef has not set.
  for (const v of versions) {
    const needed = DIET_TAGS.filter((t) => !chefRows.has(`${v.alternative_id ?? 0}:${t}`));
    if (needed.length === 0) continue;
    const state = buildState(recipe.title, v.label, lines, recipe.method, v.alternative_id);
    const questions: Question[] = needed.map((t) => ({ kind: "yes_no", key: t, prompt: DIET_PROMPTS[t] }));
    const answers = await jev.ask(state, questions);
    needed.forEach((tag, i) => {
      const answer = answers[i];
      if (answer?.kind !== "yes_no") throw new Error(`Jev did not answer the ${tag} question`);
      const p = answer.probability;
      statements.push(
        db
          .prepare(UPSERT_JEV_TAG)
          .bind(recipeId, v.alternative_id, tag, p >= 0.5 ? 1 : 0, Math.max(p, 1 - p)),
      );
    });
  }

  // Alternatives that were deleted: their rows cascade in the database, but
  // remove any stale Jev rows anyway so the result is right either way.
  statements.push(
    db
      .prepare(
        `DELETE FROM recipe_diet_tags WHERE recipe_id = ? AND source = 'jev' AND alternative_id IS NOT NULL
         AND alternative_id NOT IN (SELECT id FROM recipe_alternatives WHERE recipe_id = ?)`,
      )
      .bind(recipeId, recipeId),
  );

  if (statements.length) await db.batch(statements);
  return getRecipeTags(db, recipeId);
}

/** Current category and tags for a recipe. Does not call Jev. */
export async function getRecipeTags(db: D1Database, recipeId: number): Promise<RecipeTags | null> {
  const recipe = await db
    .prepare("SELECT category, category_source FROM recipes WHERE id = ?")
    .bind(recipeId)
    .first<{ category: Category | null; category_source: "jev" | "chef" | null }>();
  if (!recipe) return null;

  const { results: alts } = await db
    .prepare("SELECT id, label FROM recipe_alternatives WHERE recipe_id = ? ORDER BY id")
    .bind(recipeId)
    .all<{ id: number; label: string }>();
  const { results: rows } = await db
    .prepare(
      "SELECT alternative_id, tag, value, confidence, source FROM recipe_diet_tags WHERE recipe_id = ?",
    )
    .bind(recipeId)
    .all<{ alternative_id: number | null; tag: DietTag; value: number; confidence: number | null; source: "jev" | "chef" }>();

  const versions: VersionTags[] = [
    { alternative_id: null, label: MAIN_LABEL, tags: [] },
    ...alts.map((a) => ({ alternative_id: a.id, label: a.label, tags: [] as TagValue[] })),
  ].map((v) => ({
    ...v,
    tags: rows
      .filter((r) => r.alternative_id === v.alternative_id)
      .sort((a, b) => DIET_TAGS.indexOf(a.tag) - DIET_TAGS.indexOf(b.tag))
      .map((r) => ({
        tag: r.tag,
        value: r.value === 1,
        confidence: r.confidence,
        source: r.source,
        unsure: r.source === "jev" && r.confidence !== null && r.confidence < UNSURE_BELOW,
      })),
  }));

  return { category: recipe.category, category_source: recipe.category_source, versions };
}

/** Sets or confirms tags and category as the chef. Stored with source 'chef'. Returns null for an unknown recipe. */
export async function saveChefTags(db: D1Database, recipeId: number, input: ChefTagInput): Promise<RecipeTags | null> {
  const exists = await db.prepare("SELECT id FROM recipes WHERE id = ?").bind(recipeId).first();
  if (!exists) return null;

  const { results: alts } = await db
    .prepare("SELECT id FROM recipe_alternatives WHERE recipe_id = ?")
    .bind(recipeId)
    .all<{ id: number }>();
  const altIds = new Set(alts.map((a) => a.id));
  const statements: D1PreparedStatement[] = [];

  if (input.category !== undefined) {
    statements.push(
      input.category === null
        ? db.prepare("UPDATE recipes SET category = NULL, category_source = NULL WHERE id = ?").bind(recipeId)
        : db.prepare("UPDATE recipes SET category = ?, category_source = 'chef' WHERE id = ?").bind(input.category, recipeId),
    );
  }

  for (const t of input.tags ?? []) {
    if (t.alternative_id !== null && !altIds.has(t.alternative_id)) {
      throw new InputError(`Alternative ${t.alternative_id} does not belong to this recipe`);
    }
    statements.push(
      db
        .prepare(
          `INSERT INTO recipe_diet_tags (recipe_id, alternative_id, tag, value, confidence, source)
           VALUES (?, ?, ?, ?, NULL, 'chef')
           ON CONFLICT (recipe_id, IFNULL(alternative_id, 0), tag)
           DO UPDATE SET value = excluded.value, confidence = NULL, source = 'chef'`,
        )
        .bind(recipeId, t.alternative_id, t.tag, t.value ? 1 : 0),
    );
  }

  if (statements.length) await db.batch(statements);
  return getRecipeTags(db, recipeId);
}
