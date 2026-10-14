import { Hono } from "hono";
import type { AppEnv } from "../env";

// Jev tagging and suggestions (milestones 2 and 3). Mounted at /api/ai.
const ai = new Hono<AppEnv>();

export default ai;
