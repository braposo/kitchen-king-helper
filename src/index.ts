import { Hono } from "hono";

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
};

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", async (c) => {
  const row = await c.env.DB.prepare("SELECT COUNT(*) AS recipes FROM recipes").first<{ recipes: number }>();
  return c.json({ ok: true, recipes: row?.recipes ?? 0 });
});

app.get("/api/recipes", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, title, servings FROM recipes ORDER BY title COLLATE NOCASE",
  ).all();
  return c.json(results);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app;
