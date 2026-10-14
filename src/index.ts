import { Hono } from "hono";
import type { AppEnv } from "./env";
import recipes from "./routes/recipes";
import ingredients from "./routes/ingredients";
import suppliers from "./routes/suppliers";
import retreats from "./routes/retreats";
import orders from "./routes/orders";
import ai from "./routes/ai";

export type { Env } from "./env";

const app = new Hono<AppEnv>();

app.get("/api/health", async (c) => {
  const row = await c.env.DB.prepare("SELECT COUNT(*) AS recipes FROM recipes").first<{ recipes: number }>();
  return c.json({ ok: true, recipes: row?.recipes ?? 0 });
});

app.route("/api/recipes", recipes);
app.route("/api/ingredients", ingredients);
app.route("/api/suppliers", suppliers);
app.route("/api/retreats", retreats);
app.route("/api/orders", orders);
app.route("/api/ai", ai);

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

export default app;
