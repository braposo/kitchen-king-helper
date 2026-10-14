import { Hono } from "hono";
import type { AppEnv } from "../env";

// Retreats, meals and dishes (milestone 3). Mounted at /api/retreats.
const retreats = new Hono<AppEnv>();

export default retreats;
