import { Hono } from "hono";
import type { AppEnv } from "../env";

// Suppliers (milestone 2). Mounted at /api/suppliers.
const suppliers = new Hono<AppEnv>();

const KINDS = ["supermarket", "specialist"];

type Supplier = { name: string; kind: string; contact: string | null; lead_days: number };

/** Checks a request body; returns the clean fields or an error message the chef can read. */
function validate(body: any): Supplier | string {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return "Give the supplier a name.";
  const kind = body.kind ?? "supermarket";
  if (!KINDS.includes(kind)) return "Kind must be supermarket or specialist.";
  const lead = body.lead_days ?? 1;
  if (!Number.isInteger(lead) || lead < 0) return "Lead days must be a whole number, 0 or more.";
  const contact = typeof body.contact === "string" && body.contact.trim() ? body.contact.trim() : null;
  return { name, kind, contact, lead_days: lead };
}

const COLUMNS = "id, name, kind, contact, lead_days";

suppliers.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT ${COLUMNS} FROM suppliers ORDER BY name COLLATE NOCASE`).all();
  return c.json(results);
});

suppliers.post("/", async (c) => {
  const s = validate(await c.req.json().catch(() => null));
  if (typeof s === "string") return c.json({ error: s }, 400);
  const row = await c.env.DB.prepare(
    `INSERT INTO suppliers (name, kind, contact, lead_days) VALUES (?, ?, ?, ?) RETURNING ${COLUMNS}`,
  )
    .bind(s.name, s.kind, s.contact, s.lead_days)
    .first();
  return c.json(row, 201);
});

suppliers.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const s = validate(await c.req.json().catch(() => null));
  if (typeof s === "string") return c.json({ error: s }, 400);
  const row = await c.env.DB.prepare(
    `UPDATE suppliers SET name = ?, kind = ?, contact = ?, lead_days = ? WHERE id = ? RETURNING ${COLUMNS}`,
  )
    .bind(s.name, s.kind, s.contact, s.lead_days, id)
    .first();
  return row ? c.json(row) : c.json({ error: "Supplier not found." }, 404);
});

// Ingredients that used this supplier simply lose it (ON DELETE SET NULL).
suppliers.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const res = await c.env.DB.prepare("DELETE FROM suppliers WHERE id = ?").bind(id).run();
  return res.meta.changes ? c.json({ ok: true }) : c.json({ error: "Supplier not found." }, 404);
});

export default suppliers;
