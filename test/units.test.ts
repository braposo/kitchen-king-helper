import { describe, expect, it } from "vitest";
import { inferBaseUnit, normalizeUnit, toBase, unitDimension } from "../src/lib/units";

describe("units", () => {
  it("knows the spellings the chef uses", () => {
    expect(normalizeUnit("Grams")).toBe("g");
    expect(normalizeUnit("Tbsp.")).toBe("tbsp");
    expect(normalizeUnit("litres")).toBe("l");
    expect(normalizeUnit("cloves")).toBe("clove");
    expect(normalizeUnit("handful")).toBeNull();
  });

  it("says what a unit measures", () => {
    expect(unitDimension("kg")).toBe("mass");
    expect(unitDimension("tsp")).toBe("volume");
    expect(unitDimension("bunch")).toBe("count");
    expect(unitDimension("nonsense")).toBeNull();
  });

  it("infers a base unit for new ingredients", () => {
    expect(inferBaseUnit("kg")).toBe("g");
    expect(inferBaseUnit("cup")).toBe("ml");
    expect(inferBaseUnit("tin")).toBe("each");
    expect(inferBaseUnit(null)).toBe("each");
  });

  it("converts within a dimension", () => {
    expect(toBase(1.5, "kg", "g")).toEqual({ quantity: 1500, problem: null });
    expect(toBase(2, "tbsp", "ml")).toEqual({ quantity: 30, problem: null });
    expect(toBase(1, "cup", "ml")).toEqual({ quantity: 240, problem: null });
    expect(toBase(3, "each", "each")).toEqual({ quantity: 3, problem: null });
  });

  it("converts volume and mass at 1 ml = 1 g and says so", () => {
    expect(toBase(2, "tbsp", "g")).toEqual({ quantity: 30, problem: "Volume converted to grams at 1 ml = 1 g" });
    expect(toBase(200, "g", "ml").problem).toMatch(/1 g = 1 ml/);
  });

  it("will not convert counts to mass or volume", () => {
    const result = toBase(3, "clove", "g");
    expect(result.quantity).toBe(3);
    expect(result.problem).toMatch(/^Can't convert/);
    expect(toBase(200, "g", "each").problem).toMatch(/^Can't convert/);
  });
});
