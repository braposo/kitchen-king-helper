import { Hono } from "hono";
import type { AppEnv } from "../env";

// Retreats, meals and dishes (milestone 3). Mounted at /api/retreats.
// Every write that changes a retreat's plan answers with the full retreat
// (see loadRetreat) so the page can re-render straight from the response.
const retreats = new Hono<AppEnv>();

const MAX_DAYS = 14;
const DEFAULT_MEALS = [
  { slot: "brunch", time_label: "11:00" },
  { slot: "snacks", time_label: "16:00" },
  { slot: "dinner", time_label: "19:30" },
];

type RetreatRow = {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  headcount: number;
  buffer_percent: number;
};
type MealRow = {
  id: number;
  retreat_id: number;
  date: string;
  slot: string;
  position: number;
  time_label: string | null;
  headcount: number | null;
};

class HttpError extends Error {
  constructor(
    public status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

retreats.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: err.message }, 500);
});

// ---- dates ----------------------------------------------------------------

const DAY_MS = 86_400_000;

function parseDate(value: unknown, field: string): string {
  const ok =
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  if (!ok) throw new HttpError(400, `${field} must be a date like 2025-11-14.`);
  return value as string;
}

function dayNumber(date: string): number {
  return Math.round(Date.parse(date) / DAY_MS);
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Every date from start to end inclusive. */
function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let n = dayNumber(start); n <= dayNumber(end); n++) out.push(new Date(n * DAY_MS).toISOString().slice(0, 10));
  return out;
}

function checkRange(start: string, end: string) {
  if (dayNumber(end) < dayNumber(start)) throw new HttpError(400, "The last day can't be before the first day.");
  if (dayNumber(end) - dayNumber(start) + 1 > MAX_DAYS) throw new HttpError(400, `A retreat can be at most ${MAX_DAYS} days long.`);
}

// ---- validation -----------------------------------------------------------

function bodyObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Send a JSON object.");
  return body as Record<string, unknown>;
}

async function readBody(c: { req: { json: () => Promise<unknown> } }) {
  return bodyObject(await c.req.json().catch(() => null));
}

function parseName(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, "Give the retreat a name.");
  return value.trim();
}

function parseWhole(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new HttpError(400, `${field} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

function parseText(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new HttpError(400, `${field} must be text.`);
  return value.trim() || null;
}

function parseSlot(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, "Pick a slot (brunch, snacks, dinner or your own).");
  return value.trim();
}

function parseId(value: string): number {
  return /^\d+$/.test(value) ? Number(value) : -1;
}

// ---- loading --------------------------------------------------------------

async function getRetreatRow(db: D1Database, id: number): Promise<RetreatRow> {
  const row = await db.prepare("SELECT * FROM retreats WHERE id = ?").bind(id).first<RetreatRow>();
  if (!row) throw new HttpError(404, "Retreat not found.");
  return row;
}

async function getMealRow(db: D1Database, id: number): Promise<MealRow> {
  const row = await db.prepare("SELECT * FROM meals WHERE id = ?").bind(id).first<MealRow>();
  if (!row) throw new HttpError(404, "Meal not found.");
  return row;
}

type DishRow = { id: number; meal_id: number; recipe_id: number; title: string; servings: number | null };

/** The whole plan for one retreat: days with meals with dishes and their versions. */
async function loadRetreat(db: D1Database, id: number) {
  const retreat = await getRetreatRow(db, id);
  const [meals, dishes, dishAlts, available] = await Promise.all([
    db.prepare("SELECT * FROM meals WHERE retreat_id = ? ORDER BY date, position, id").bind(id).all<MealRow>(),
    db
      .prepare(
        `SELECT d.id, d.meal_id, d.recipe_id, r.title, d.servings
         FROM meal_dishes d JOIN meals m ON m.id = d.meal_id JOIN recipes r ON r.id = d.recipe_id
         WHERE m.retreat_id = ? ORDER BY d.id`,
      )
      .bind(id)
      .all<DishRow>(),
    db
      .prepare(
        `SELECT x.meal_dish_id, x.alternative_id, a.label, x.servings
         FROM meal_dish_alternatives x JOIN recipe_alternatives a ON a.id = x.alternative_id
         JOIN meal_dishes d ON d.id = x.meal_dish_id JOIN meals m ON m.id = d.meal_id
         WHERE m.retreat_id = ? ORDER BY a.id`,
      )
      .bind(id)
      .all<{ meal_dish_id: number; alternative_id: number; label: string; servings: number }>(),
    db
      .prepare(
        `SELECT DISTINCT a.id, a.recipe_id, a.label FROM recipe_alternatives a
         JOIN meal_dishes d ON d.recipe_id = a.recipe_id JOIN meals m ON m.id = d.meal_id
         WHERE m.retreat_id = ? ORDER BY a.id`,
      )
      .bind(id)
      .all<{ id: number; recipe_id: number; label: string }>(),
  ]);

  const shapeDish = (d: DishRow, people: number) => {
    const alternatives = dishAlts.results
      .filter((x) => x.meal_dish_id === d.id)
      .map(({ alternative_id, label, servings }) => ({ alternative_id, label, servings }));
    const taken = alternatives.reduce((sum, a) => sum + a.servings, 0);
    return {
      id: d.id,
      recipe_id: d.recipe_id,
      title: d.title,
      servings: d.servings,
      main_servings: d.servings ?? Math.max(0, people - taken),
      alternatives,
      available_alternatives: available.results.filter((a) => a.recipe_id === d.recipe_id).map(({ id, label }) => ({ id, label })),
    };
  };

  const mealsByDate = new Map<string, unknown[]>();
  for (const m of meals.results) {
    const people = m.headcount ?? retreat.headcount;
    const shaped = {
      id: m.id,
      date: m.date,
      slot: m.slot,
      position: m.position,
      time_label: m.time_label,
      headcount: m.headcount,
      people,
      dishes: dishes.results.filter((d) => d.meal_id === m.id).map((d) => shapeDish(d, people)),
    };
    mealsByDate.set(m.date, [...(mealsByDate.get(m.date) ?? []), shaped]);
  }

  const days = dateRange(retreat.start_date, retreat.end_date).map((date) => ({ date, meals: mealsByDate.get(date) ?? [] }));
  return { ...retreat, days };
}

function insertMealStatements(db: D1Database, retreatId: number, dates: string[]) {
  return dates.flatMap((date) =>
    DEFAULT_MEALS.map((m, position) =>
      db
        .prepare("INSERT INTO meals (retreat_id, date, slot, position, time_label) VALUES (?, ?, ?, ?, ?)")
        .bind(retreatId, date, m.slot, position, m.time_label),
    ),
  );
}

async function createRetreat(db: D1Database, name: string, start: string, end: string, headcount: number, buffer: number) {
  const res = await db
    .prepare("INSERT INTO retreats (name, start_date, end_date, headcount, buffer_percent) VALUES (?, ?, ?, ?, ?)")
    .bind(name, start, end, headcount, buffer)
    .run();
  return res.meta.last_row_id as number;
}

/** Next free position on a day. */
async function endOfDay(db: D1Database, retreatId: number, date: string): Promise<number> {
  const row = await db
    .prepare("SELECT MAX(position) AS p FROM meals WHERE retreat_id = ? AND date = ?")
    .bind(retreatId, date)
    .first<{ p: number | null }>();
  return row?.p === null || row?.p === undefined ? 0 : row.p + 1;
}

function checkInRange(retreat: RetreatRow, date: string) {
  if (date < retreat.start_date || date > retreat.end_date) throw new HttpError(400, "That day is outside the retreat's dates.");
}

// ---- retreats -------------------------------------------------------------

retreats.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM retreats ORDER BY start_date DESC, id DESC").all<RetreatRow>();
  return c.json(results.map((r) => ({ ...r, days: dayNumber(r.end_date) - dayNumber(r.start_date) + 1 })));
});

retreats.post("/", async (c) => {
  const body = await readBody(c);
  const name = parseName(body.name);
  const start = parseDate(body.start_date, "The first day");
  const end = parseDate(body.end_date, "The last day");
  checkRange(start, end);
  const headcount = parseWhole(body.headcount, "People", 1, 200);
  const buffer = body.buffer_percent === undefined ? 10 : parseWhole(body.buffer_percent, "Buffer", 0, 100);

  const id = await createRetreat(c.env.DB, name, start, end, headcount, buffer);
  await c.env.DB.batch(insertMealStatements(c.env.DB, id, dateRange(start, end)));
  return c.json(await loadRetreat(c.env.DB, id), 201);
});

retreats.get("/:id", async (c) => c.json(await loadRetreat(c.env.DB, parseId(c.req.param("id")))));

retreats.put("/:id", async (c) => {
  const db = c.env.DB;
  const id = parseId(c.req.param("id"));
  const current = await getRetreatRow(db, id);
  const body = await readBody(c);

  const name = body.name === undefined ? current.name : parseName(body.name);
  const start = body.start_date === undefined ? current.start_date : parseDate(body.start_date, "The first day");
  const end = body.end_date === undefined ? current.end_date : parseDate(body.end_date, "The last day");
  checkRange(start, end);
  const headcount = body.headcount === undefined ? current.headcount : parseWhole(body.headcount, "People", 1, 200);
  const buffer = body.buffer_percent === undefined ? current.buffer_percent : parseWhole(body.buffer_percent, "Buffer", 0, 100);

  // Days that would disappear must not hold dishes.
  const blocked = await db
    .prepare(
      `SELECT m.date FROM meals m JOIN meal_dishes d ON d.meal_id = m.id
       WHERE m.retreat_id = ? AND (m.date < ? OR m.date > ?) GROUP BY m.date ORDER BY m.date LIMIT 1`,
    )
    .bind(id, start, end)
    .first<{ date: string }>();
  if (blocked) {
    throw new HttpError(409, `${blocked.date} has dishes planned. Remove them or move the meals before shortening the retreat.`);
  }

  const oldDays = new Set(dateRange(current.start_date, current.end_date));
  const newDays = dateRange(start, end).filter((d) => !oldDays.has(d));
  await db.batch([
    db
      .prepare("UPDATE retreats SET name = ?, start_date = ?, end_date = ?, headcount = ?, buffer_percent = ? WHERE id = ?")
      .bind(name, start, end, headcount, buffer, id),
    db.prepare("DELETE FROM meals WHERE retreat_id = ? AND (date < ? OR date > ?)").bind(id, start, end),
    ...insertMealStatements(db, id, newDays),
  ]);
  return c.json(await loadRetreat(db, id));
});

retreats.delete("/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  await getRetreatRow(c.env.DB, id);
  await c.env.DB.prepare("DELETE FROM retreats WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

// Copies a retreat to new dates, shifting every meal by the same number of days.
retreats.post("/:id/duplicate", async (c) => {
  const db = c.env.DB;
  const source = await getRetreatRow(db, parseId(c.req.param("id")));
  const body = await readBody(c);
  const name = parseName(body.name);
  const start = parseDate(body.start_date, "The first day");
  const shift = dayNumber(start) - dayNumber(source.start_date);
  const end = addDays(source.end_date, shift);

  const newId = await createRetreat(db, name, start, end, source.headcount, source.buffer_percent);
  // Copy in a few set-based statements rather than one query per meal and dish:
  // D1 on the free plan allows only 50 queries per request. Rows are inserted
  // in id order, so the nth old meal (or dish) maps to the nth new one.
  const ranked = (table: string, retreat: string) =>
    table === "meals"
      ? `SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS n FROM meals WHERE retreat_id = ${retreat}`
      : `SELECT d.id, ROW_NUMBER() OVER (ORDER BY d.id) AS n FROM meal_dishes d JOIN meals m ON m.id = d.meal_id WHERE m.retreat_id = ${retreat}`;
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO meals (retreat_id, date, slot, position, time_label, headcount)
           SELECT ?1, date(date, ?3), slot, position, time_label, headcount FROM meals WHERE retreat_id = ?2 ORDER BY id`,
        )
        .bind(newId, source.id, `${shift >= 0 ? "+" : ""}${shift} days`),
      db
        .prepare(
          `INSERT INTO meal_dishes (meal_id, recipe_id, servings)
           SELECT nm.id, d.recipe_id, d.servings FROM meal_dishes d
           JOIN (${ranked("meals", "?2")}) om ON om.id = d.meal_id
           JOIN (${ranked("meals", "?1")}) nm ON nm.n = om.n
           ORDER BY d.id`,
        )
        .bind(newId, source.id),
      db
        .prepare(
          `INSERT INTO meal_dish_alternatives (meal_dish_id, alternative_id, servings)
           SELECT nd.id, x.alternative_id, x.servings FROM meal_dish_alternatives x
           JOIN (${ranked("dishes", "?2")}) od ON od.id = x.meal_dish_id
           JOIN (${ranked("dishes", "?1")}) nd ON nd.n = od.n
           ORDER BY x.id`,
        )
        .bind(newId, source.id),
    ]);
  } catch (err) {
    await db.prepare("DELETE FROM retreats WHERE id = ?").bind(newId).run();
    throw err;
  }
  return c.json(await loadRetreat(db, newId), 201);
});

// ---- meals ----------------------------------------------------------------

retreats.post("/:id/meals", async (c) => {
  const db = c.env.DB;
  const retreat = await getRetreatRow(db, parseId(c.req.param("id")));
  const body = await readBody(c);
  const date = parseDate(body.date, "The day");
  checkInRange(retreat, date);
  const slot = parseSlot(body.slot);
  const time = body.time_label === undefined ? null : parseText(body.time_label, "The time");
  const position = await endOfDay(db, retreat.id, date);
  await db
    .prepare("INSERT INTO meals (retreat_id, date, slot, position, time_label) VALUES (?, ?, ?, ?, ?)")
    .bind(retreat.id, date, slot, position, time)
    .run();
  return c.json(await loadRetreat(db, retreat.id), 201);
});

retreats.put("/meals/:mealId", async (c) => {
  const db = c.env.DB;
  const meal = await getMealRow(db, parseId(c.req.param("mealId")));
  const retreat = await getRetreatRow(db, meal.retreat_id);
  const body = await readBody(c);

  const date = body.date === undefined ? meal.date : parseDate(body.date, "The day");
  checkInRange(retreat, date);
  const slot = body.slot === undefined ? meal.slot : parseSlot(body.slot);
  const time = body.time_label === undefined ? meal.time_label : parseText(body.time_label, "The time");
  const headcount = body.headcount === undefined ? meal.headcount : body.headcount === null ? null : parseWhole(body.headcount, "People", 1, 200);
  const wantedPosition = body.position === undefined ? null : parseWhole(body.position, "Position", 0, 1000);

  const statements = [
    db.prepare("UPDATE meals SET date = ?, slot = ?, time_label = ?, headcount = ? WHERE id = ?").bind(date, slot, time, headcount, meal.id),
  ];
  if (wantedPosition !== null || date !== meal.date) {
    // Re-number the day: the meal goes where asked, or to the end after a move.
    const others = await db
      .prepare("SELECT id FROM meals WHERE retreat_id = ? AND date = ? AND id <> ? ORDER BY position, id")
      .bind(meal.retreat_id, date, meal.id)
      .all<{ id: number }>();
    const order = others.results.map((r) => r.id);
    order.splice(wantedPosition === null ? order.length : Math.min(wantedPosition, order.length), 0, meal.id);
    order.forEach((mealId, i) => statements.push(db.prepare("UPDATE meals SET position = ? WHERE id = ?").bind(i, mealId)));
  }
  await db.batch(statements);
  return c.json(await loadRetreat(db, meal.retreat_id));
});

retreats.delete("/meals/:mealId", async (c) => {
  const meal = await getMealRow(c.env.DB, parseId(c.req.param("mealId")));
  await c.env.DB.prepare("DELETE FROM meals WHERE id = ?").bind(meal.id).run();
  return c.json(await loadRetreat(c.env.DB, meal.retreat_id));
});

// ---- dishes ---------------------------------------------------------------

type DishInfo = { id: number; recipe_id: number; retreat_id: number };

async function getDish(db: D1Database, id: number): Promise<DishInfo> {
  const row = await db
    .prepare("SELECT d.id, d.recipe_id, m.retreat_id FROM meal_dishes d JOIN meals m ON m.id = d.meal_id WHERE d.id = ?")
    .bind(id)
    .first<DishInfo>();
  if (!row) throw new HttpError(404, "Dish not found.");
  return row;
}

retreats.post("/meals/:mealId/dishes", async (c) => {
  const db = c.env.DB;
  const meal = await getMealRow(db, parseId(c.req.param("mealId")));
  const body = await readBody(c);
  const recipeId = parseWhole(body.recipe_id, "Recipe", 1, Number.MAX_SAFE_INTEGER);
  const recipe = await db.prepare("SELECT id FROM recipes WHERE id = ?").bind(recipeId).first();
  if (!recipe) throw new HttpError(404, "Recipe not found.");
  await db.prepare("INSERT INTO meal_dishes (meal_id, recipe_id) VALUES (?, ?)").bind(meal.id, recipeId).run();
  return c.json(await loadRetreat(db, meal.retreat_id), 201);
});

retreats.put("/dishes/:dishId", async (c) => {
  const db = c.env.DB;
  const dish = await getDish(db, parseId(c.req.param("dishId")));
  const body = await readBody(c);
  const statements: D1PreparedStatement[] = [];

  if (body.servings !== undefined) {
    const servings = body.servings === null ? null : parseWhole(body.servings, "Servings", 0, 1000);
    statements.push(db.prepare("UPDATE meal_dishes SET servings = ? WHERE id = ?").bind(servings, dish.id));
  }

  if (body.alternatives !== undefined) {
    if (!Array.isArray(body.alternatives)) throw new HttpError(400, "alternatives must be a list.");
    const own = await db.prepare("SELECT id FROM recipe_alternatives WHERE recipe_id = ?").bind(dish.recipe_id).all<{ id: number }>();
    const allowed = new Set(own.results.map((r) => r.id));
    const wanted = new Map<number, number>();
    for (const item of body.alternatives) {
      const entry = bodyObject(item);
      const altId = parseWhole(entry.alternative_id, "Version", 1, Number.MAX_SAFE_INTEGER);
      if (!allowed.has(altId)) throw new HttpError(400, "That version doesn't belong to this dish's recipe.");
      wanted.set(altId, parseWhole(entry.servings, "Servings", 0, 1000));
    }
    statements.push(db.prepare("DELETE FROM meal_dish_alternatives WHERE meal_dish_id = ?").bind(dish.id));
    for (const [altId, servings] of wanted) {
      if (servings > 0) {
        statements.push(
          db.prepare("INSERT INTO meal_dish_alternatives (meal_dish_id, alternative_id, servings) VALUES (?, ?, ?)").bind(dish.id, altId, servings),
        );
      }
    }
  }

  if (statements.length) await db.batch(statements);
  return c.json(await loadRetreat(db, dish.retreat_id));
});

retreats.delete("/dishes/:dishId", async (c) => {
  const dish = await getDish(c.env.DB, parseId(c.req.param("dishId")));
  await c.env.DB.prepare("DELETE FROM meal_dishes WHERE id = ?").bind(dish.id).run();
  return c.json(await loadRetreat(c.env.DB, dish.retreat_id));
});

export default retreats;
