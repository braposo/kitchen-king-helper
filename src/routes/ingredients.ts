import { Hono } from "hono";
import type { AppEnv } from "../env";

// Shared ingredient list (milestone 2). Mounted at /api/ingredients.
const ingredients = new Hono<AppEnv>();

const BASE_UNITS = ["g", "ml", "each"];
const STORAGE = ["fresh", "pantry"];

type Ingredient = {
  name: string;
  base_unit: string;
  storage: string;
  supplier_id: number | null;
  pack_size: number | null;
  pack_label: string | null;
};

/** Checks a request body; returns the clean fields or an error message the chef can read. */
function validate(body: any): Ingredient | string {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return "Give the ingredient a name.";
  if (!BASE_UNITS.includes(body.base_unit)) return "Base unit must be g, ml or each.";
  const storage = body.storage ?? "pantry";
  if (!STORAGE.includes(storage)) return "Storage must be fresh or pantry.";
  const supplier = body.supplier_id ?? null;
  if (supplier !== null && !Number.isInteger(supplier)) return "Pick a supplier from the list.";
  const pack = body.pack_size ?? null;
  if (pack !== null && !(typeof pack === "number" && pack > 0)) return "Pack size must be a number above 0.";
  const label = typeof body.pack_label === "string" && body.pack_label.trim() ? body.pack_label.trim() : null;
  return { name, base_unit: body.base_unit, storage, supplier_id: supplier, pack_size: pack, pack_label: label };
}

const SELECT = `SELECT i.id, i.name, i.base_unit, i.storage, i.supplier_id, s.name AS supplier_name, i.pack_size, i.pack_label
  FROM ingredients i LEFT JOIN suppliers s ON s.id = i.supplier_id`;

ingredients.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(`${SELECT} ORDER BY i.name COLLATE NOCASE`).all();
  return c.json(results);
});

/** Returns a message if the supplier or name is not usable, else null. */
async function problem(db: D1Database, i: Ingredient, selfId: number | null): Promise<{ status: 400 | 409; error: string } | null> {
  if (i.supplier_id !== null) {
    const supplier = await db.prepare("SELECT id FROM suppliers WHERE id = ?").bind(i.supplier_id).first();
    if (!supplier) return { status: 400, error: "That supplier doesn't exist." };
  }
  const clash = await db.prepare("SELECT id FROM ingredients WHERE name = ? AND id IS NOT ?").bind(i.name, selfId).first();
  if (clash) return { status: 409, error: `There is already an ingredient called "${i.name}".` };
  return null;
}

ingredients.post("/", async (c) => {
  const i = validate(await c.req.json().catch(() => null));
  if (typeof i === "string") return c.json({ error: i }, 400);
  const bad = await problem(c.env.DB, i, null);
  if (bad) return c.json({ error: bad.error }, bad.status);
  const created = await c.env.DB.prepare(
    "INSERT INTO ingredients (name, base_unit, storage, supplier_id, pack_size, pack_label) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
  )
    .bind(i.name, i.base_unit, i.storage, i.supplier_id, i.pack_size, i.pack_label)
    .first<{ id: number }>();
  const row = await c.env.DB.prepare(`${SELECT} WHERE i.id = ?`).bind(created!.id).first();
  return c.json(row, 201);
});

ingredients.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const i = validate(await c.req.json().catch(() => null));
  if (typeof i === "string") return c.json({ error: i }, 400);
  const current = await c.env.DB.prepare("SELECT base_unit FROM ingredients WHERE id = ?").bind(id).first<{ base_unit: string }>();
  if (!current) return c.json({ error: "Ingredient not found." }, 404);
  const bad = await problem(c.env.DB, i, id);
  if (bad) return c.json({ error: bad.error }, bad.status);
  // Recipe quantities are stored in the base unit, so changing it would silently change every recipe.
  if (current.base_unit !== i.base_unit) {
    const used = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM recipe_ingredients WHERE ingredient_id = ?").bind(id).first<{ n: number }>();
    if (used && used.n > 0) {
      return c.json({ error: `"${i.name}" is used in recipes measured in ${current.base_unit}, so its unit can't be changed.` }, 409);
    }
  }
  await c.env.DB.prepare(
    "UPDATE ingredients SET name = ?, base_unit = ?, storage = ?, supplier_id = ?, pack_size = ?, pack_label = ? WHERE id = ?",
  )
    .bind(i.name, i.base_unit, i.storage, i.supplier_id, i.pack_size, i.pack_label, id)
    .run();
  return c.json(await c.env.DB.prepare(`${SELECT} WHERE i.id = ?`).bind(id).first());
});

ingredients.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const row = await c.env.DB.prepare("SELECT name FROM ingredients WHERE id = ?").bind(id).first<{ name: string }>();
  if (!row) return c.json({ error: "Ingredient not found." }, 404);
  const used = await c.env.DB.prepare(
    "SELECT r.title FROM recipe_ingredients ri JOIN recipes r ON r.id = ri.recipe_id WHERE ri.ingredient_id = ? LIMIT 1",
  )
    .bind(id)
    .first<{ title: string }>();
  if (used) return c.json({ error: `"${row.name}" is used in a recipe (${used.title}), so it can't be deleted.` }, 409);
  await c.env.DB.prepare("DELETE FROM ingredients WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

export default ingredients;
