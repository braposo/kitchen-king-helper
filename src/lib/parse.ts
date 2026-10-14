// Reads a recipe pasted from the chef's documents into a draft the chef can check and save.
// Pure functions only: nothing here touches the database.
import { inferBaseUnit, normalizeUnit, toBase, unitDimension, type BaseUnit } from "./units";

export type KnownIngredient = { id: number; name: string; base_unit: BaseUnit };

/** One ingredient line as the chef wrote it, before it is compared with the ingredient list. */
export type ParsedLine = {
  raw: string;
  /** Amount for the whole recipe, as written (2 x 400g gives 800). Null when there is none. */
  quantity: number | null;
  /** The unit as written (canonical name when we know it), or null for a plain count like "3 onions". */
  unit: string | null;
  unknownUnit: boolean;
  name: string;
  prep_note: string | null;
  /** Said "a pinch of" or "to taste": no number to convert. */
  vague: boolean;
};

export type DraftLine = {
  raw: string;
  quantity: number | null;
  unit: string | null;
  name: string;
  prep_note: string | null;
  quantity_per_serving: number | null;
  base_unit: BaseUnit;
  match: { ingredient_id: number; name: string; base_unit: BaseUnit } | null;
  problem: string | null;
};

export type Draft = {
  title: string;
  servings: number;
  method: string;
  notes: string;
  lines: DraftLine[];
  /** Things to check about the recipe as a whole, such as servings not found. */
  problems: string[];
};

// ---------- numbers ----------

const FRACTIONS: Record<string, string> = { "½": "1/2", "¼": "1/4", "¾": "3/4", "⅓": "1/3", "⅔": "2/3", "⅛": "1/8" };

function normalizeFractions(text: string): string {
  return text
    .replace(/(\d)\s*([½¼¾⅓⅔⅛])/g, (_, digit, f) => `${digit} ${FRACTIONS[f]}`)
    .replace(/[½¼¾⅓⅔⅛]/g, (f) => FRACTIONS[f]);
}

/** "2", "1.5", "1,5", "1/2" and "1 1/2" to a number. */
export function parseNumber(text: string): number {
  const t = text.trim();
  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = t.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  return Number(t.replace(",", "."));
}

const NUM = String.raw`\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?`;
// quantity, optional range end ("2-3"), optional "x 400" multiplier, then the rest of the line.
const QUANTITY_RE = new RegExp(String.raw`^(${NUM})(?:\s*[-–]\s*(?:${NUM}))?\s*(?:[x×]\s*(${NUM}))?\s*(.*)$`, "i");

// ---------- one ingredient line ----------

// Words that look like units but have no fixed size. We keep the number and flag the line.
const VAGUE_UNITS = new Set([
  "handful", "handfuls", "sprig", "sprigs", "slice", "slices", "stick", "sticks", "head", "heads",
  "stalk", "stalks", "knob", "knobs", "sheet", "sheets", "rasher", "rashers", "pinch", "pinches",
]);
const CONTAINERS = /^(?:tins?|cans?|jars?|packets?|packs?|bags?|tubs?|cartons?|bottles?)\b\s*/i;
const PINCH_RE = /^(?:an?\s+|some\s+)?(pinch(?:es)?|handful|splash|dash|drizzle|knob|sprinkle|glug)\s+(?:of\s+)?(.+)$/i;
const NOT_INGREDIENT_AFTER_NUMBER = /^(?:°|º|degrees?\b|minutes?\b|mins?\b|hours?\b|hrs?\b|seconds?\b|secs?\b)/i;

function stripBullet(line: string, numbered: boolean): string {
  let out = line.replace(/^\s*[-•*–—·]\s*/, "");
  if (numbered) out = out.replace(/^\d+[.)]\s+/, "");
  return out.trim();
}

/** Splits "onions (red), finely diced" into the main text and the prep note. */
function splitPrep(text: string): { main: string; prep: string | null } {
  const notes: string[] = [];
  let main = "";
  let depth = 0;
  let comma = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    const decimalComma = /\d/.test(text[i - 1] ?? "") && /\d/.test(text[i + 1] ?? ""); // "1,5 kg"
    if (ch === "," && depth === 0 && !decimalComma) {
      comma = i;
      break;
    }
  }
  const head = comma >= 0 ? text.slice(0, comma) : text;
  const tail = comma >= 0 ? text.slice(comma + 1).trim() : "";
  main = head.replace(/\(([^)]*)\)/g, (_, inside: string) => {
    if (inside.trim()) notes.push(inside.trim());
    return " ";
  });
  if (tail) notes.push(tail);
  return { main: main.replace(/\s+/g, " ").trim(), prep: notes.length ? notes.join(", ") : null };
}

/** Whether a line begins with a quantity, so it can be told apart from method text. */
export function startsWithQuantity(line: string): boolean {
  const t = normalizeFractions(stripBullet(line, false));
  if (/^\d+[.)]\s/.test(t)) return false; // "1. Preheat the oven": a numbered step
  if (PINCH_RE.test(t)) return true;
  const m = t.match(QUANTITY_RE);
  // "200°C for 20 minutes" starts with a number but is method text.
  return !!m && !NOT_INGREDIENT_AFTER_NUMBER.test(m[3].trim());
}

export function parseIngredientLine(rawLine: string, numbered = true): ParsedLine {
  const raw = rawLine.trim();
  const text = normalizeFractions(stripBullet(raw, numbered));
  const { main, prep } = splitPrep(text);
  const base: ParsedLine = { raw, quantity: null, unit: null, unknownUnit: false, name: main, prep_note: prep, vague: false };

  // "a pinch of salt": keep the wording as the prep note.
  const pinch = main.match(PINCH_RE);
  if (pinch) {
    return { ...base, name: cleanName(pinch[2]), prep_note: [`a ${pinch[1].toLowerCase()}`, prep].filter(Boolean).join(", "), vague: true };
  }

  const m = main.match(QUANTITY_RE);
  if (!m) {
    // "salt to taste": no number at all.
    const taste = main.match(/^(.*?)\s+(to taste|as needed|as required)$/i);
    if (taste) return { ...base, name: cleanName(taste[1]), prep_note: [taste[2].toLowerCase(), prep].filter(Boolean).join(", "), vague: true };
    return { ...base, name: cleanName(main) };
  }

  let quantity = parseNumber(m[1]);
  if (m[2] !== undefined) quantity *= parseNumber(m[2]); // "2 x 400g"
  let rest = m[3].trim();
  let unit: string | null = null;
  let unknownUnit = false;

  const word = rest.match(/^([A-Za-z]+)\.?(?![A-Za-z])\s*(.*)$/);
  if (word) {
    const canonical = normalizeUnit(word[1]);
    if (canonical) {
      unit = canonical;
      rest = word[2];
    } else if (VAGUE_UNITS.has(word[1].toLowerCase())) {
      unit = word[1].toLowerCase();
      unknownUnit = true;
      rest = word[2];
    }
  }
  rest = rest.replace(/^of\s+/i, "");
  // "2 x 400g tins chopped tomatoes": the tin is already counted in the 400g.
  if (unit && unitDimension(unit) !== "count" && !unknownUnit) rest = rest.replace(CONTAINERS, "").replace(/^of\s+/i, "");

  const taste = rest.match(/^(.*?)\s+(to taste)$/i);
  return {
    ...base,
    quantity,
    unit,
    unknownUnit,
    name: cleanName(taste ? taste[1] : rest),
    prep_note: taste ? [taste[2], prep].filter(Boolean).join(", ") : prep,
  };
}

function cleanName(name: string): string {
  return name.replace(/^of\s+/i, "").replace(/\s+/g, " ").replace(/[.:;]+$/, "").trim();
}

// ---------- matching against the ingredient list ----------

function singular(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (/(?:ch|sh|x|z|o)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("ss") || word.endsWith("us")) return word;
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9À-ɏ]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map(singular)
    .join(" ");
}

/** Best existing ingredient for a name: exact, then singular/plural, then an existing name inside the line (longest first). */
export function matchIngredient(name: string, existing: KnownIngredient[]): KnownIngredient | null {
  const lower = name.trim().toLowerCase();
  if (!lower) return null;
  const exact = existing.find((i) => i.name.trim().toLowerCase() === lower);
  if (exact) return exact;
  const wanted = normalizeName(name);
  if (!wanted) return null;
  const same = existing.find((i) => normalizeName(i.name) === wanted);
  if (same) return same;
  const padded = ` ${wanted} `;
  const inside = existing
    .map((i) => ({ i, n: normalizeName(i.name) }))
    .filter(({ n }) => n && padded.includes(` ${n} `))
    .sort((a, b) => b.n.length - a.n.length);
  return inside[0]?.i ?? null;
}

// ---------- converting a line ----------

function round(n: number): number {
  return Math.round(n * 100000) / 100000;
}

/** Compares a parsed line with the ingredient list and works out the per-serving quantity in base units. */
export function resolveLine(line: ParsedLine, servings: number, existing: KnownIngredient[]): DraftLine {
  const match = line.name ? matchIngredient(line.name, existing) : null;
  const baseUnit: BaseUnit = match?.base_unit ?? (line.unknownUnit ? "each" : inferBaseUnit(line.unit));
  const problems: string[] = [];
  let perServing: number | null = null;

  if (line.quantity === null) {
    problems.push("No quantity");
  } else {
    let total = line.quantity;
    if (line.unknownUnit) {
      problems.push(`Unknown unit '${line.unit}'`);
    } else {
      const converted = toBase(line.quantity, line.unit ?? "each", baseUnit);
      total = converted.quantity;
      if (converted.problem) problems.push(converted.problem);
    }
    perServing = round(total / servings);
  }
  if (!line.name) problems.push("No ingredient name");

  return {
    raw: line.raw,
    quantity: line.quantity,
    unit: line.unit,
    name: line.name,
    prep_note: line.prep_note,
    quantity_per_serving: perServing,
    base_unit: baseUnit,
    match: match ? { ingredient_id: match.id, name: match.name, base_unit: match.base_unit } : null,
    problem: problems.length ? problems.join("; ") : null,
  };
}

// ---------- the whole recipe ----------

const HEADING_RE = /^(?:#{1,6}\s*)?(ingredients?|method|instructions?|directions?|steps?|preparation|notes?|tips?)\s*:?\s*$/i;
const SERVINGS_RE = /^(?:serves|servings?|makes|yields?|for|portions?)\b\s*:?\s*(\d+)|^(\d+)\s+(?:servings|portions|people)\b/i;

type Section = "intro" | "ingredients" | "method" | "notes";

function headingSection(line: string): Section | null {
  const m = line.match(HEADING_RE);
  if (!m) return null;
  const word = m[1].toLowerCase();
  if (word.startsWith("ingredient")) return "ingredients";
  if (word.startsWith("note") || word.startsWith("tip")) return "notes";
  return "method";
}

/** Reads pasted text into title, servings, method, notes and raw ingredient lines. */
export function parseRecipe(text: string): { title: string; servings: number; method: string; notes: string; lines: ParsedLine[]; problems: string[] } {
  const all = text.replace(/\r/g, "").replace(/\*\*/g, "").split("\n").map((l) => l.trim());
  let at = 0;
  while (at < all.length && !all[at]) at++;
  const title = (all[at++] ?? "").replace(/^#+\s*/, "").replace(/^recipe\s*:\s*/i, "").trim();
  const body = all.slice(at).filter(Boolean);

  const hasIngredientHeading = body.some((l) => headingSection(l) === "ingredients");
  let servings: number | null = null;
  let section: Section = "intro";
  const ingredientLines: string[] = [];
  const method: string[] = [];
  const notes: string[] = [];

  for (const line of body) {
    const heading = headingSection(line);
    if (heading) {
      section = heading;
      continue;
    }
    if (section !== "method") {
      const s = line.match(SERVINGS_RE);
      if (s && servings === null) {
        servings = Number(s[1] ?? s[2]);
        continue;
      }
    }
    if (section === "ingredients") {
      const cleaned = stripBullet(line, true);
      if (/:$/.test(cleaned) && !/\d/.test(cleaned)) continue; // a sub-heading such as "For the sauce:"
      if (cleaned) ingredientLines.push(cleaned);
    } else if (section === "method") {
      method.push(line);
    } else if (section === "notes") {
      notes.push(line);
    } else if (hasIngredientHeading) {
      notes.push(line); // a description before the ingredients
    } else if (startsWithQuantity(line)) {
      ingredientLines.push(stripBullet(line, false));
    } else {
      method.push(line);
    }
  }

  const problems: string[] = [];
  if (!title) problems.push("No title found");
  if (servings === null || servings < 1) {
    problems.push("Servings not found, set to 1");
    servings = 1;
  }
  if (!ingredientLines.length) problems.push("No ingredient lines found");

  return {
    title,
    servings,
    method: method.join("\n"),
    notes: notes.join("\n"),
    lines: ingredientLines.map((l) => parseIngredientLine(l, false)),
    problems,
  };
}

/** Full draft: parsed recipe with each line matched to the ingredient list and converted. */
export function buildDraft(text: string, existing: KnownIngredient[]): Draft {
  const parsed = parseRecipe(text);
  return {
    title: parsed.title,
    servings: parsed.servings,
    method: parsed.method,
    notes: parsed.notes,
    lines: parsed.lines.map((l) => resolveLine(l, parsed.servings, existing)),
    problems: parsed.problems,
  };
}
