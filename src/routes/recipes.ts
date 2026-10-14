import { Hono } from "hono";
import type { AppEnv } from "../env";

// Recipes, their alternatives and ingredient lines (milestone 2). Mounted at /api/recipes.
const recipes = new Hono<AppEnv>();

recipes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, title, servings FROM recipes ORDER BY title COLLATE NOCASE",
  ).all();
  return c.json(results);
});

export default recipes;
