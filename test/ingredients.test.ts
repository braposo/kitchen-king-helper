import { describe, expect, it } from "vitest";
import app from "../src/index";
import { call, testEnv } from "./helpers/d1";

describe("suppliers", () => {
  it("creates, lists, updates and deletes", async () => {
    const env = testEnv();
    const made = await call(app, env, "POST", "/api/suppliers", { name: "Tesco", contact: "  " });
    expect(made).toEqual({ status: 201, body: { id: 1, name: "Tesco", kind: "supermarket", contact: null, lead_days: 1 } });
    await call(app, env, "POST", "/api/suppliers", { name: "Bakery", kind: "specialist", lead_days: 2, contact: "01234" });
    const list = await call(app, env, "GET", "/api/suppliers");
    expect(list.body.map((s: any) => s.name)).toEqual(["Bakery", "Tesco"]);

    const put = await call(app, env, "PUT", "/api/suppliers/1", { name: "Tesco Extra", kind: "supermarket", lead_days: 0 });
    expect(put.body).toMatchObject({ name: "Tesco Extra", lead_days: 0 });
    expect((await call(app, env, "DELETE", "/api/suppliers/2")).status).toBe(200);
    expect((await call(app, env, "GET", "/api/suppliers")).body).toHaveLength(1);
  });

  it("validates and reports missing suppliers", async () => {
    const env = testEnv();
    expect((await call(app, env, "POST", "/api/suppliers", { name: "" })).status).toBe(400);
    expect((await call(app, env, "POST", "/api/suppliers", { name: "X", kind: "market" })).status).toBe(400);
    expect((await call(app, env, "POST", "/api/suppliers", { name: "X", lead_days: -1 })).status).toBe(400);
    expect((await call(app, env, "PUT", "/api/suppliers/9", { name: "X" })).status).toBe(404);
    expect((await call(app, env, "DELETE", "/api/suppliers/9")).status).toBe(404);
  });

  it("leaves ingredients without a supplier when one is deleted", async () => {
    const env = testEnv();
    await call(app, env, "POST", "/api/suppliers", { name: "Tesco" });
    await call(app, env, "POST", "/api/ingredients", { name: "Rice", base_unit: "g", supplier_id: 1 });
    await call(app, env, "DELETE", "/api/suppliers/1");
    expect((await call(app, env, "GET", "/api/ingredients")).body[0]).toMatchObject({ supplier_id: null, supplier_name: null });
  });
});

describe("ingredients", () => {
  it("creates with defaults and a supplier name, lists sorted", async () => {
    const env = testEnv();
    await call(app, env, "POST", "/api/suppliers", { name: "Tesco" });
    const made = await call(app, env, "POST", "/api/ingredients", {
      name: " Rice ",
      base_unit: "g",
      supplier_id: 1,
      pack_size: 1000,
      pack_label: "1 kg bag",
    });
    expect(made.status).toBe(201);
    expect(made.body).toEqual({ id: 1, name: "Rice", base_unit: "g", storage: "pantry", supplier_id: 1, supplier_name: "Tesco", pack_size: 1000, pack_label: "1 kg bag" });
    await call(app, env, "POST", "/api/ingredients", { name: "Basil", base_unit: "each", storage: "fresh" });
    const list = await call(app, env, "GET", "/api/ingredients");
    expect(list.body.map((i: any) => [i.name, i.storage, i.supplier_name])).toEqual([["Basil", "fresh", null], ["Rice", "pantry", "Tesco"]]);
  });

  it("validates fields and refuses duplicates ignoring case", async () => {
    const env = testEnv();
    const post = (body: unknown) => call(app, env, "POST", "/api/ingredients", body);
    expect((await post({ name: "", base_unit: "g" })).status).toBe(400);
    expect((await post({ name: "A", base_unit: "kg" })).status).toBe(400);
    expect((await post({ name: "A", base_unit: "g", storage: "freezer" })).status).toBe(400);
    expect((await post({ name: "A", base_unit: "g", pack_size: 0 })).status).toBe(400);
    expect((await post({ name: "A", base_unit: "g", supplier_id: 5 })).status).toBe(400);
    expect((await post({ name: "Rice", base_unit: "g" })).status).toBe(201);
    expect((await post({ name: "rice", base_unit: "g" })).status).toBe(409);
  });

  it("updates, and renaming onto another ingredient is refused", async () => {
    const env = testEnv();
    await call(app, env, "POST", "/api/ingredients", { name: "Rice", base_unit: "g" });
    await call(app, env, "POST", "/api/ingredients", { name: "Pasta", base_unit: "g" });
    const ok = await call(app, env, "PUT", "/api/ingredients/1", { name: "Basmati rice", base_unit: "g", storage: "pantry", pack_size: 500 });
    expect(ok.body).toMatchObject({ name: "Basmati rice", pack_size: 500 });
    expect((await call(app, env, "PUT", "/api/ingredients/1", { name: "pasta", base_unit: "g" })).status).toBe(409);
    expect((await call(app, env, "PUT", "/api/ingredients/1", { name: "Basmati rice", base_unit: "g" })).status).toBe(200);
    expect((await call(app, env, "PUT", "/api/ingredients/9", { name: "X", base_unit: "g" })).status).toBe(404);
  });

  it("protects ingredients that recipes use", async () => {
    const env = testEnv();
    await call(app, env, "POST", "/api/recipes", {
      title: "Plain rice",
      servings: 2,
      ingredients: [{ name: "Rice", base_unit: "g", quantity_per_serving: 100 }],
    });
    const del = await call(app, env, "DELETE", "/api/ingredients/1");
    expect(del.status).toBe(409);
    expect(del.body.error).toMatch(/Plain rice/);
    const unit = await call(app, env, "PUT", "/api/ingredients/1", { name: "Rice", base_unit: "ml" });
    expect(unit.status).toBe(409);
    expect((await call(app, env, "PUT", "/api/ingredients/1", { name: "Rice", base_unit: "g", storage: "fresh" })).status).toBe(200);
  });

  it("deletes unused ingredients", async () => {
    const env = testEnv();
    await call(app, env, "POST", "/api/ingredients", { name: "Rice", base_unit: "g" });
    expect((await call(app, env, "DELETE", "/api/ingredients/1")).status).toBe(200);
    expect((await call(app, env, "DELETE", "/api/ingredients/1")).status).toBe(404);
  });
});
