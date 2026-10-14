import { Hono } from "hono";
import type { AppEnv } from "../env";
import { loadPlanData } from "../lib/plan-data";
import { computeOrderLines, groupByDelivery, groupBySupplier } from "../lib/quantities";

// Order lists computed from a retreat's plan (milestone 4). Mounted at /api/orders.
// Only the chef's changes (moved delivery, other supplier, ticked) are stored.
const orders = new Hono<AppEnv>();

class BadRequest extends Error {}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** The full payload the page renders from. Null when the retreat doesn't exist. */
async function payload(db: D1Database, retreatId: number) {
  const data = await loadPlanData(db, retreatId);
  if (!data) return null;
  const lines = computeOrderLines(data);
  return {
    retreat: data.retreat,
    lines,
    by_delivery: groupByDelivery(lines),
    by_supplier: groupBySupplier(lines),
    suppliers: data.suppliers.map((s) => ({ id: s.id, name: s.name })),
  };
}

/** Checks the ids in a body that identifies one line. */
async function lineKey(db: D1Database, body: Record<string, unknown>) {
  const ingredientId = body.ingredient_id;
  if (typeof ingredientId !== "number" || !Number.isInteger(ingredientId)) throw new BadRequest("ingredient_id is required.");
  const group = body.line_group;
  if (typeof group !== "string" || (group !== "pantry" && !isDate(group))) throw new BadRequest("line_group must be 'pantry' or a date (YYYY-MM-DD).");
  const found = await db.prepare("SELECT id FROM ingredients WHERE id = ?").bind(ingredientId).first();
  if (!found) throw new BadRequest("That ingredient doesn't exist.");
  return { ingredientId, group };
}

async function readBody(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BadRequest("Send a JSON object.");
  return body as Record<string, unknown>;
}

orders.get("/:retreatId", async (c) => {
  const result = await payload(c.env.DB, Number(c.req.param("retreatId")));
  return result ? c.json(result) : c.json({ error: "Retreat not found." }, 404);
});

orders.put("/:retreatId/lines", async (c) => {
  const retreatId = Number(c.req.param("retreatId"));
  const db = c.env.DB;
  try {
    const retreat = await db.prepare("SELECT id FROM retreats WHERE id = ?").bind(retreatId).first();
    if (!retreat) return c.json({ error: "Retreat not found." }, 404);
    const body = await readBody(c);
    const { ingredientId, group } = await lineKey(db, body);

    const existing = await db
      .prepare("SELECT delivery_date, supplier_id, ticked FROM order_line_state WHERE retreat_id = ? AND ingredient_id = ? AND line_group = ?")
      .bind(retreatId, ingredientId, group)
      .first<{ delivery_date: string | null; supplier_id: number | null; ticked: number }>();
    let { delivery_date, supplier_id, ticked } = existing ?? { delivery_date: null, supplier_id: null, ticked: 0 };

    if ("delivery_date" in body) {
      if (body.delivery_date !== null && !isDate(body.delivery_date)) throw new BadRequest("Delivery date must look like 2026-11-13.");
      delivery_date = body.delivery_date;
    }
    if ("supplier_id" in body) {
      if (body.supplier_id !== null) {
        if (typeof body.supplier_id !== "number") throw new BadRequest("supplier_id must be a number or null.");
        const supplier = await db.prepare("SELECT id FROM suppliers WHERE id = ?").bind(body.supplier_id).first();
        if (!supplier) throw new BadRequest("That supplier doesn't exist.");
      }
      supplier_id = body.supplier_id;
    }
    if ("ticked" in body) {
      if (typeof body.ticked !== "boolean") throw new BadRequest("ticked must be true or false.");
      ticked = body.ticked ? 1 : 0;
    }

    await db
      .prepare(
        `INSERT INTO order_line_state (retreat_id, ingredient_id, line_group, delivery_date, supplier_id, ticked)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (retreat_id, ingredient_id, line_group)
         DO UPDATE SET delivery_date = excluded.delivery_date, supplier_id = excluded.supplier_id, ticked = excluded.ticked`,
      )
      .bind(retreatId, ingredientId, group, delivery_date, supplier_id, ticked)
      .run();
    return c.json(await payload(db, retreatId));
  } catch (err) {
    if (err instanceof BadRequest) return c.json({ error: err.message }, 400);
    throw err;
  }
});

orders.delete("/:retreatId/lines", async (c) => {
  const retreatId = Number(c.req.param("retreatId"));
  const db = c.env.DB;
  try {
    const retreat = await db.prepare("SELECT id FROM retreats WHERE id = ?").bind(retreatId).first();
    if (!retreat) return c.json({ error: "Retreat not found." }, 404);
    const { ingredientId, group } = await lineKey(db, await readBody(c));
    await db
      .prepare("DELETE FROM order_line_state WHERE retreat_id = ? AND ingredient_id = ? AND line_group = ?")
      .bind(retreatId, ingredientId, group)
      .run();
    return c.json(await payload(db, retreatId));
  } catch (err) {
    if (err instanceof BadRequest) return c.json({ error: err.message }, 400);
    throw err;
  }
});

export default orders;
