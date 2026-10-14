import { Hono } from "hono";
import type { AppEnv } from "../env";

// Shared ingredient list (milestone 2). Mounted at /api/ingredients.
const ingredients = new Hono<AppEnv>();

export default ingredients;
