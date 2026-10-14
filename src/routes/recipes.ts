import { Hono } from "hono";
import type { AppEnv } from "../env";
import { buildDraft, type KnownIngredient } from "../lib/parse";

// Recipes, their alternatives and ingredient lines (milestone 2). Mounted at /api/recipes.
const recipes = new Hono<AppEnv>();

const BASE_UNITS = ["g", "ml", "each"];
const STORAGE = ["fresh", "pantry"];
const CATEGORIES = ["brunch", "snack", "dinner", "side", "any"];

// ---------- reading ----------

type Line = {
  ingredient_id: number;
  name: string;
  base_unit: string;
  storage: string;
  quantity_per_serving: number;
  prep_note: string | null;
  position: number;
};

async function loadRecipe(db: D1Database, id: number) {
  const recipe = await db
    .prepare("SELECT id, title, servings, method, notes, category, category_source FROM recipes WHERE id = ?")
    .bind(id)
    .first();
  if (!recipe) return null;

  const { results: alternatives } = await db
    .prepare("SELECT id, label, notes FROM recipe_alternatives WHERE recipe_id = ? ORDER BY id")
    .bind(id)
    .all<{ id: number; label: string; notes: string | null }>();
  const { results: rows } = await db
    .prepare(
      `SELECT ri.alternative_id, ri.ingredient_id, i.name, i.base_unit, i.storage,
              ri.quantity_per_serving, ri.prep_note, ri.position
       FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id
       WHERE ri.recipe_id = ? ORDER BY ri.position, ri.id`,
    )
    .bind(id)
    .all<Line & { alternative_id: number | null }>();

  const linesFor = (altId: number | null): Line[] =>
    rows.filter((r) => r.alternative_id === altId).map(({ alternative_id, ...line }) => line);

  return {
    ...recipe,
    ingredients: linesFor(null),
    alternatives: alternatives.map((a) => ({ ...a, ingredients: linesFor(a.id) })),
  };
}

function idParam(value: string): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

recipes.get("/", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.title, r.servings, r.category,
            (SELECT COUNT(*) FROM recipe_alternatives a WHERE a.recipe_id = r.id) AS alternatives
     FROM recipes r WHERE r.title LIKE ? ESCAPE '\\' ORDER BY r.title COLLATE NOCASE`,
  )
    .bind(like)
    .all();
  return c.json(results);
});

recipes.get("/:id", async (c) => {
  const id = idParam(c.req.param("id"));
  const recipe = id && (await loadRecipe(c.env.DB, id));
  return recipe ? c.json(recipe) : c.json({ error: "Recipe not found." }, 404);
});

// ---------- paste import (nothing is saved) ----------

recipes.post("/parse", async (c) => {
  const body = await c.req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text : "";
  if (!text.trim()) return c.json({ error: "Paste the recipe text first." }, 400);
  const { results } = await c.env.DB.prepare("SELECT id, name, base_unit FROM ingredients").all<KnownIngredient>();
  return c.json(buildDraft(text, results));
});

// ---------- writing ----------

type CleanLine = {
  ingredient_id: number | null;
  name: string | null;
  base_unit: string;
  storage: string;
  quantity_per_serving: number;
  prep_note: string | null;
};
type CleanAlternative = { id: number | null; label: string; notes: string | null; ingredients: CleanLine[] };
type CleanRecipe = {
  title: string;
  servings: number;
  method: string | null;
  notes: string | null;
  /** undefined: leave as is; null: clear; string: the chef's choice */
  category: string | null | undefined;
  ingredients: CleanLine[];
  alternatives: CleanAlternative[];
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanLines(value: unknown, where: string): CleanLine[] | string {
  if (!Array.isArray(value)) return `${where}: ingredients must be a list.`;
  const out: CleanLine[] = [];
  for (const [n, line] of value.entries()) {
    const at = `${where}, line ${n + 1}`;
    const qty = line?.quantity_per_serving;
    if (typeof qty !== "number" || !Number.isFinite(qty) || qty < 0) return `${at}: the amount must be a number, 0 or more.`;
    const prep_note = text(line.prep_note);
    if (line.ingredient_id !== undefined && line.ingredient_id !== null) {
      if (!Number.isInteger(line.ingredient_id)) return `${at}: pick an ingredient from the list.`;
      out.push({ ingredient_id: line.ingredient_id, name: null, base_unit: "g", storage: "pantry", quantity_per_serving: qty, prep_note });
    } else {
      const name = text(line?.name);
      if (!name) return `${at}: the ingredient needs a name.`;
      if (!BASE_UNITS.includes(line.base_unit)) return `${at}: "${name}" needs a unit of g, ml or each.`;
      const storage = line.storage ?? "pantry";
      if (!STORAGE.includes(storage)) return `${at}: storage must be fresh or pantry.`;
      out.push({ ingredient_id: null, name, base_unit: line.base_unit, storage, quantity_per_serving: qty, prep_note });
    }
  }
  return out;
}

function validate(body: any): CleanRecipe | string {
  const title = text(body?.title);
  if (!title) return "Give the recipe a title.";
  if (!Number.isInteger(body.servings) || body.servings < 1) return "Servings must be a whole number, 1 or more.";
  let category: string | null | undefined;
  if (body.category !== undefined) {
    category = text(body.category);
    if (category !== null && !CATEGORIES.includes(category)) return `Category must be one of ${CATEGORIES.join(", ")}.`;
  }
  const ingredients = cleanLines(body.ingredients ?? [], "Main recipe");
  if (typeof ingredients === "string") return ingredients;

  const alternatives: CleanAlternative[] = [];
  const seen = new Set<number>();
  for (const [n, alt] of (Array.isArray(body.alternatives) ? body.alternatives : []).entries()) {
    const label = text(alt?.label);
    if (!label) return `Alternative ${n + 1} needs a name, such as "Vegan version".`;
    const lines = cleanLines(alt.ingredients ?? [], `"${label}"`);
    if (typeof lines === "string") return lines;
    let id: number | null = null;
    if (alt.id !== undefined && alt.id !== null) {
      if (!Number.isInteger(alt.id) || seen.has(alt.id)) return `"${label}": invalid alternative id.`;
      const altId: number = alt.id;
      id = altId;
      seen.add(altId);
    }
    alternatives.push({ id, label, notes: text(alt.notes), ingredients: lines });
  }
  return { title, servings: body.servings, method: text(body.method), notes: text(body.notes), category, ingredients, alternatives };
}

/**
 * Loads the ingredient list once, checks every ingredient_id exists, points lines whose name
 * already exists (ignoring case) at that ingredient, and returns one statement that creates
 * the genuinely new ones. D1 limits queries per request, so this stays at one read and one write.
 */
async function prepareIngredients(db: D1Database, r: CleanRecipe): Promise<{ error?: string; stmts: D1PreparedStatement[] }> {
  const { results } = await db.prepare("SELECT id, name FROM ingredients").all<{ id: number; name: string }>();
  const byName = new Map(results.map((i) => [i.name.toLowerCase(), i.id]));
  const ids = new Set(results.map((i) => i.id));
  const fresh = new Map<string, CleanLine>();
  for (const l of [...r.ingredients, ...r.alternatives.flatMap((a) => a.ingredients)]) {
    if (l.ingredient_id !== null) {
      if (!ids.has(l.ingredient_id)) return { error: "One of the ingredients no longer exists. Reload the page and try again.", stmts: [] };
      continue;
    }
    const key = l.name!.toLowerCase();
    const known = byName.get(key);
    if (known !== undefined) {
      l.ingredient_id = known;
    } else if (!fresh.has(key)) {
      fresh.set(key, l);
    }
  }
  const stmts: D1PreparedStatement[] = [];
  const list = [...fresh.values()];
  for (let i = 0; i < list.length; i += 30) {
    const chunk = list.slice(i, i + 30);
    stmts.push(
      db
        .prepare(`INSERT OR IGNORE INTO ingredients (name, base_unit, storage) VALUES ${chunk.map(() => "(?, ?, ?)").join(", ")}`)
        .bind(...chunk.flatMap((l) => [l.name, l.base_unit, l.storage])),
    );
  }
  return { stmts };
}

/** Statements that write the ingredient lines of one version, several rows per statement. */
function lineStatements(db: D1Database, recipeId: number, altId: number | null, lines: CleanLine[]) {
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < lines.length; i += 12) {
    const chunk = lines.slice(i, i + 12);
    const rows = chunk.map((l) => (l.ingredient_id !== null ? "(?, ?, ?, ?, ?, ?)" : "(?, ?, (SELECT id FROM ingredients WHERE name = ?), ?, ?, ?)"));
    const params = chunk.flatMap((l, n) => [recipeId, altId, l.ingredient_id !== null ? l.ingredient_id : l.name, l.quantity_per_serving, l.prep_note, i + n]);
    stmts.push(
      db
        .prepare(`INSERT INTO recipe_ingredients (recipe_id, alternative_id, ingredient_id, quantity_per_serving, prep_note, position) VALUES ${rows.join(", ")}`)
        .bind(...params),
    );
  }
  return stmts;
}

async function nextId(db: D1Database, table: "recipes" | "recipe_alternatives"): Promise<number> {
  const row = await db.prepare(`SELECT COALESCE(MAX(id), 0) AS id FROM ${table}`).first<{ id: number }>();
  return (row?.id ?? 0) + 1;
}

recipes.post("/", async (c) => {
  const r = validate(await c.req.json().catch(() => null));
  if (typeof r === "string") return c.json({ error: r }, 400);
  const db = c.env.DB;
  const prep = await prepareIngredients(db, r);
  if (prep.error) return c.json({ error: prep.error }, 400);

  // Ids are chosen up front so the whole recipe goes in as one batch.
  const recipeId = await nextId(db, "recipes");
  let altId = await nextId(db, "recipe_alternatives");
  const stmts = [
    db
      .prepare("INSERT INTO recipes (id, title, servings, method, notes, category, category_source) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(recipeId, r.title, r.servings, r.method, r.notes, r.category ?? null, r.category ? "chef" : null),
    ...prep.stmts,
    ...lineStatements(db, recipeId, null, r.ingredients),
  ];
  for (const alt of r.alternatives) {
    stmts.push(
      db.prepare("INSERT INTO recipe_alternatives (id, recipe_id, label, notes) VALUES (?, ?, ?, ?)").bind(altId, recipeId, alt.label, alt.notes),
      ...lineStatements(db, recipeId, altId, alt.ingredients),
    );
    altId++;
  }
  await db.batch(stmts);
  return c.json(await loadRecipe(db, recipeId), 201);
});

recipes.put("/:id", async (c) => {
  const id = idParam(c.req.param("id"));
  const r = validate(await c.req.json().catch(() => null));
  if (typeof r === "string") return c.json({ error: r }, 400);
  const db = c.env.DB;
  if (!id || !(await db.prepare("SELECT id FROM recipes WHERE id = ?").bind(id).first())) {
    return c.json({ error: "Recipe not found." }, 404);
  }
  const prep = await prepareIngredients(db, r);
  if (prep.error) return c.json({ error: prep.error }, 400);

  const { results: existing } = await db
    .prepare("SELECT id, label FROM recipe_alternatives WHERE recipe_id = ?")
    .bind(id)
    .all<{ id: number; label: string }>();
  const existingIds = new Set(existing.map((a) => a.id));
  const keep = r.alternatives.flatMap((a) => (a.id === null ? [] : [a.id]));
  if (keep.some((k) => !existingIds.has(k))) return c.json({ error: "An alternative doesn't belong to this recipe. Reload the page and try again." }, 400);

  // An alternative that menus already use can't disappear.
  const gone = existing.filter((a) => !keep.includes(a.id));
  if (gone.length) {
    const used = await db
      .prepare(`SELECT alternative_id FROM meal_dish_alternatives WHERE alternative_id IN (${gone.map(() => "?").join(", ")}) LIMIT 1`)
      .bind(...gone.map((a) => a.id))
      .first<{ alternative_id: number }>();
    if (used) {
      const label = gone.find((a) => a.id === used.alternative_id)?.label;
      return c.json({ error: `The "${label}" version is used in a menu, so it can't be removed.` }, 409);
    }
  }

  let altId = await nextId(db, "recipe_alternatives");
  // Category: only touched when the body has the key. Setting it makes it the chef's choice,
  // unless it is the value already stored (the page sends it back unchanged).
  const update =
    r.category === undefined
      ? db.prepare("UPDATE recipes SET title = ?, servings = ?, method = ?, notes = ? WHERE id = ?").bind(r.title, r.servings, r.method, r.notes, id)
      : db
          .prepare(
            "UPDATE recipes SET title = ?, servings = ?, method = ?, notes = ?, " +
              "category_source = CASE WHEN ? IS NULL THEN NULL WHEN category IS ? THEN category_source ELSE 'chef' END, category = ? WHERE id = ?",
          )
          .bind(r.title, r.servings, r.method, r.notes, r.category, r.category, r.category, id);

  const stmts = [
    update,
    // Removed alternatives take their lines and tags with them (cascade).
    keep.length
      ? db.prepare(`DELETE FROM recipe_alternatives WHERE recipe_id = ? AND id NOT IN (${keep.map(() => "?").join(", ")})`).bind(id, ...keep)
      : db.prepare("DELETE FROM recipe_alternatives WHERE recipe_id = ?").bind(id),
    db.prepare("DELETE FROM recipe_ingredients WHERE recipe_id = ?").bind(id),
    ...prep.stmts,
    ...lineStatements(db, id, null, r.ingredients),
  ];
  for (const alt of r.alternatives) {
    if (alt.id !== null) {
      stmts.push(
        db.prepare("UPDATE recipe_alternatives SET label = ?, notes = ? WHERE id = ?").bind(alt.label, alt.notes, alt.id),
        ...lineStatements(db, id, alt.id, alt.ingredients),
      );
    } else {
      stmts.push(
        db.prepare("INSERT INTO recipe_alternatives (id, recipe_id, label, notes) VALUES (?, ?, ?, ?)").bind(altId, id, alt.label, alt.notes),
        ...lineStatements(db, id, altId, alt.ingredients),
      );
      altId++;
    }
  }
  await db.batch(stmts);
  return c.json(await loadRecipe(db, id));
});

recipes.delete("/:id", async (c) => {
  const id = idParam(c.req.param("id"));
  const row = id ? await c.env.DB.prepare("SELECT title FROM recipes WHERE id = ?").bind(id).first<{ title: string }>() : null;
  if (!id || !row) return c.json({ error: "Recipe not found." }, 404);
  const used = await c.env.DB.prepare("SELECT id FROM meal_dishes WHERE recipe_id = ? LIMIT 1").bind(id).first();
  if (used) return c.json({ error: `"${row.title}" is on a menu, so it can't be deleted. Take it off the menu first.` }, 409);
  await c.env.DB.prepare("DELETE FROM recipes WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

export default recipes;
