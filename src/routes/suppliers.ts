import { Hono } from "hono";
import type { AppEnv } from "../env";

// Suppliers (milestone 2). Mounted at /api/suppliers.
const suppliers = new Hono<AppEnv>();

export default suppliers;
