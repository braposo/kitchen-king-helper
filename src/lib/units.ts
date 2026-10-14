// Units the chef writes in, and conversion into the ingredient's base unit (g, ml or each).

export type BaseUnit = "g" | "ml" | "each";
export type Dimension = "mass" | "volume" | "count";

type UnitInfo = { dimension: Dimension; /** how many base units (g, ml or each) make one of this unit */ factor: number };

// Canonical unit name -> what it is worth. Spoons and cups are volumes.
const UNITS: Record<string, UnitInfo> = {
  g: { dimension: "mass", factor: 1 },
  kg: { dimension: "mass", factor: 1000 },
  oz: { dimension: "mass", factor: 28.35 },
  lb: { dimension: "mass", factor: 453.6 },
  ml: { dimension: "volume", factor: 1 },
  l: { dimension: "volume", factor: 1000 },
  tsp: { dimension: "volume", factor: 5 },
  tbsp: { dimension: "volume", factor: 15 },
  cup: { dimension: "volume", factor: 240 },
  each: { dimension: "count", factor: 1 },
  clove: { dimension: "count", factor: 1 },
  tin: { dimension: "count", factor: 1 },
  bunch: { dimension: "count", factor: 1 },
};

// Every spelling we accept (lower case) -> canonical name.
const ALIASES: Record<string, string> = {};
function alias(canonical: string, ...words: string[]) {
  for (const w of [canonical, ...words]) ALIASES[w] = canonical;
}
alias("g", "gram", "grams", "gr", "gm");
alias("kg", "kgs", "kilo", "kilos", "kilogram", "kilograms");
alias("oz", "ounce", "ounces");
alias("lb", "lbs", "pound", "pounds");
alias("ml", "millilitre", "millilitres", "milliliter", "milliliters");
alias("l", "litre", "litres", "liter", "liters");
alias("tsp", "tsps", "teaspoon", "teaspoons");
alias("tbsp", "tbsps", "tbs", "tablespoon", "tablespoons");
alias("cup", "cups");
alias("each", "pc", "pcs", "piece", "pieces");
alias("clove", "cloves");
alias("tin", "tins", "can", "cans");
alias("bunch", "bunches");

/** Maps what the chef wrote ("Tbsp.", "litres") to a canonical unit, or null if we don't know it. */
export function normalizeUnit(word: string): string | null {
  return ALIASES[word.toLowerCase().replace(/\.$/, "")] ?? null;
}

/** Whether a unit measures mass, volume or a count; null for an unknown unit. Accepts any spelling. */
export function unitDimension(unit: string): Dimension | null {
  const canonical = normalizeUnit(unit);
  return canonical ? UNITS[canonical].dimension : null;
}

/** The dimension of a base unit. */
export function baseDimension(baseUnit: BaseUnit): Dimension {
  return baseUnit === "g" ? "mass" : baseUnit === "ml" ? "volume" : "count";
}

/** The base unit a new ingredient gets when the chef writes it in this unit. */
export function inferBaseUnit(unit: string | null): BaseUnit {
  const dimension = unit ? unitDimension(unit) : "count";
  return dimension === "mass" ? "g" : dimension === "volume" ? "ml" : "each";
}

export type Conversion = { quantity: number; problem: string | null };

/**
 * Converts an amount in the chef's unit into the ingredient's base unit.
 * Volume and mass convert at 1 ml = 1 g, with a problem to check. Counts can't
 * convert to or from mass or volume: the number is returned as written, with a problem.
 */
export function toBase(quantity: number, unit: string, baseUnit: BaseUnit): Conversion {
  const canonical = normalizeUnit(unit);
  if (!canonical) return { quantity, problem: `Unknown unit '${unit}'` };
  const info = UNITS[canonical];
  const inOwnBase = quantity * info.factor;
  const target = baseDimension(baseUnit);
  if (info.dimension === target) return { quantity: inOwnBase, problem: null };
  if (info.dimension === "volume" && target === "mass") {
    return { quantity: inOwnBase, problem: "Volume converted to grams at 1 ml = 1 g" };
  }
  if (info.dimension === "mass" && target === "volume") {
    return { quantity: inOwnBase, problem: "Weight converted to ml at 1 g = 1 ml" };
  }
  return { quantity, problem: `Can't convert ${canonical} to ${baseUnit}` };
}
