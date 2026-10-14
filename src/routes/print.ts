import { Hono } from "hono";
import type { AppEnv } from "../env";
import { loadPlanData } from "../lib/plan-data";
import { dayPrepAhead, scaleMeal, type PlanData, type ScaledMeal } from "../lib/quantities";

// Printables (milestone 5): the daily sheet and recipe cards. Mounted at /api/print.
const print = new Hono<AppEnv>();

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written YYYY-MM-DD (rejects 2026-02-30). */
function isDate(value: string): boolean {
  if (!DATE_SHAPE.test(value)) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

/** Retreat ids come from the URL; anything that is not a whole number is an unknown retreat. */
function parseId(raw: string): number | null {
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

function inRetreat(data: PlanData, date: string): boolean {
  return date >= data.retreat.start_date && date <= data.retreat.end_date;
}

function retreatSummary(data: PlanData) {
  const { id, name, start_date, end_date } = data.retreat;
  return { id, name, start_date, end_date };
}

// GET /api/print/:retreatId/day/:date
// One day for the daily sheet: each meal scaled, plus what to prep for tomorrow.
print.get("/:retreatId/day/:date", async (c) => {
  const id = parseId(c.req.param("retreatId"));
  const data = id === null ? null : await loadPlanData(c.env.DB, id);
  if (!data) return c.json({ error: "Retreat not found" }, 404);

  const date = c.req.param("date");
  if (!isDate(date)) return c.json({ error: "Date must look like YYYY-MM-DD" }, 400);
  if (!inRetreat(data, date)) return c.json({ error: `${date} is outside this retreat` }, 400);

  // Meals arrive from the loader already in date, position order.
  const meals = data.meals
    .filter((m) => m.date === date)
    .map((m) => scaleMeal(data, m.id))
    .filter((m): m is ScaledMeal => m !== null)
    .map((m) => ({ ...m, time_label: m.meal.time_label }));

  return c.json({ retreat: retreatSummary(data), date, meals, prep_ahead: dayPrepAhead(data, date) });
});

// GET /api/print/:retreatId/recipes?date=YYYY-MM-DD
// One recipe card per dish served on that date, or for the whole retreat when date is left out.
print.get("/:retreatId/recipes", async (c) => {
  const id = parseId(c.req.param("retreatId"));
  const data = id === null ? null : await loadPlanData(c.env.DB, id);
  if (!data) return c.json({ error: "Retreat not found" }, 404);

  const date = c.req.query("date") || null;
  if (date !== null) {
    if (!isDate(date)) return c.json({ error: "Date must look like YYYY-MM-DD" }, 400);
    if (!inRetreat(data, date)) return c.json({ error: `${date} is outside this retreat` }, 400);
  }

  const cards = [];
  for (const meal of data.meals) {
    if (date !== null && meal.date !== date) continue;
    const scaled = scaleMeal(data, meal.id);
    if (!scaled) continue;
    for (const dish of scaled.dishes) {
      cards.push({
        date: meal.date,
        slot: meal.slot,
        time_label: meal.time_label,
        title: dish.title,
        method: dish.method ?? null,
        versions: dish.versions,
      });
    }
  }

  return c.json({ retreat: retreatSummary(data), cards });
});

export default print;
