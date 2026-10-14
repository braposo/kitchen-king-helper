import { Hono } from "hono";
import type { AppEnv } from "../env";
import { createJev, JevError } from "../lib/jev";
import { suggestForMeal } from "../lib/suggest";
import { CATEGORIES, DIET_TAGS, getRecipeTags, InputError, saveChefTags, tagRecipe, type ChefTagInput, type Category, type DietTag } from "../lib/tagging";

// Jev tagging and suggestions (milestones 2 and 3). Mounted at /api/ai.
const ai = new Hono<AppEnv>();

const JEV_DOWN = "Jev could not answer, so nothing was changed. Try again in a moment.";

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const positiveInt = (raw: string) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

ai.get("/status", (c) => c.json({ live: Boolean(c.env.JEV_API_KEY) }));

ai.post("/recipes/:id/tag", async (c) => {
  const id = positiveInt(c.req.param("id"));
  if (id === null) return c.json({ error: "Recipe not found" }, 404);
  try {
    const tags = await tagRecipe(c.env.DB, createJev(c.env), id);
    if (!tags) return c.json({ error: "Recipe not found" }, 404);
    return c.json(tags);
  } catch (err) {
    if (err instanceof JevError) return c.json({ error: JEV_DOWN }, 502);
    throw err;
  }
});

ai.get("/recipes/:id/tags", async (c) => {
  const id = positiveInt(c.req.param("id"));
  const tags = id === null ? null : await getRecipeTags(c.env.DB, id);
  if (!tags) return c.json({ error: "Recipe not found" }, 404);
  return c.json(tags);
});

ai.put("/recipes/:id/tags", async (c) => {
  const id = positiveInt(c.req.param("id"));
  if (id === null) return c.json({ error: "Recipe not found" }, 404);

  const body = await c.req.json().catch(() => null);
  if (!isObject(body)) return c.json({ error: "Send a JSON object with category and/or tags" }, 400);

  const input: ChefTagInput = {};
  if ("category" in body) {
    const cat = body.category;
    if (cat !== null && !(typeof cat === "string" && (CATEGORIES as readonly string[]).includes(cat))) {
      return c.json({ error: `Category must be one of ${CATEGORIES.join(", ")}, or null to clear it` }, 400);
    }
    input.category = cat as Category | null;
  }
  if ("tags" in body) {
    if (!Array.isArray(body.tags)) return c.json({ error: "tags must be a list" }, 400);
    input.tags = [];
    for (const t of body.tags) {
      if (!isObject(t)) return c.json({ error: "Each tag must be an object" }, 400);
      const altId = t.alternative_id ?? null;
      if (altId !== null && !(typeof altId === "number" && Number.isInteger(altId) && altId > 0)) {
        return c.json({ error: "alternative_id must be a number or null" }, 400);
      }
      if (!(typeof t.tag === "string" && (DIET_TAGS as readonly string[]).includes(t.tag))) {
        return c.json({ error: `tag must be one of ${DIET_TAGS.join(", ")}` }, 400);
      }
      if (typeof t.value !== "boolean") return c.json({ error: "value must be true or false" }, 400);
      input.tags.push({ alternative_id: altId, tag: t.tag as DietTag, value: t.value });
    }
  }

  try {
    const tags = await saveChefTags(c.env.DB, id, input);
    if (!tags) return c.json({ error: "Recipe not found" }, 404);
    return c.json(tags);
  } catch (err) {
    if (err instanceof InputError) return c.json({ error: err.message }, 400);
    throw err;
  }
});

ai.get("/meals/:mealId/suggestions", async (c) => {
  const id = positiveInt(c.req.param("mealId"));
  if (id === null) return c.json({ error: "Meal not found" }, 404);
  try {
    const suggestions = await suggestForMeal(c.env.DB, createJev(c.env), id);
    if (!suggestions) return c.json({ error: "Meal not found" }, 404);
    return c.json({ suggestions });
  } catch (err) {
    if (err instanceof JevError) return c.json({ error: JEV_DOWN }, 502);
    throw err;
  }
});

export default ai;
