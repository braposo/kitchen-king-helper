import { Hono } from "hono";
import type { AppEnv } from "../env";

// Order lists computed from a retreat's plan (milestone 4). Mounted at /api/orders.
const orders = new Hono<AppEnv>();

export default orders;
