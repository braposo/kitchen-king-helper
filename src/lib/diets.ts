// The retreat's dietary list: reading a pasted list of people and their needs,
// and working out which version of each dish they eat.

export const DIETS = ["vegetarian", "vegan", "gluten_free", "dairy_free", "nut_free"] as const;
export type Diet = (typeof DIETS)[number];

export const DIET_LABELS: Record<Diet, string> = {
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  gluten_free: "Gluten-free",
  dairy_free: "Dairy-free",
  nut_free: "Nut-free",
};

/** One named person, or a group with no name ("3 vegans"). */
export type Guest = { id?: number; name: string | null; count: number; diets: Diet[]; note: string | null };

// Words the chef might write for each diet, longest first within each diet.
// "veg" and "gf" are whole words only, so "vegan" never reads as "veg".
const SYNONYMS: [Diet, string][] = [
  ["vegan", "plant[\\s-]*based"],
  ["vegan", "vegans?"],
  ["vegan", "vg"],
  ["vegetarian", "vegetarians?"],
  ["vegetarian", "veggies?"],
  ["vegetarian", "vegi"],
  ["vegetarian", "veg"],
  ["gluten_free", "gluten[\\s-]*free"],
  ["gluten_free", "gluten[\\s-]*intoleran(?:t|ce)"],
  ["gluten_free", "no[\\s-]*gluten"],
  ["gluten_free", "wheat[\\s-]*free"],
  ["gluten_free", "c(?:o|oe)?eliacs?"],
  ["gluten_free", "gf"],
  ["dairy_free", "dairy[\\s-]*free"],
  ["dairy_free", "no[\\s-]*dairy"],
  ["dairy_free", "lactose[\\s-]*(?:free|intoleran(?:t|ce))"],
  ["dairy_free", "lactose"],
  ["dairy_free", "df"],
  ["nut_free", "nut[\\s-]*free"],
  ["nut_free", "(?:pea)?nuts?[\\s-]*allerg(?:y|ic)"],
  ["nut_free", "allergic[\\s-]*to[\\s-]*(?:pea)?nuts"],
  ["nut_free", "no[\\s-]*(?:pea)?nuts"],
  ["nut_free", "(?:pea)?nuts?"],
];
const PATTERNS = SYNONYMS.map(([diet, source]) => ({ diet, re: new RegExp(`(?<![\\p{L}\\d])${source}(?![\\p{L}\\d])`, "giu") }));

/** Puts diets in the standard order without repeats. */
export function sortDiets(diets: Iterable<string>): Diet[] {
  const set = new Set(diets);
  return DIETS.filter((d) => set.has(d));
}

/** The diets column ("vegan,gluten_free") as a list. */
export function dietsFromColumn(text: string): Diet[] {
  return sortDiets(text.split(",").map((s) => s.trim()));
}

/** Finds diet words in free text. `rest` is whatever is left, tidied, for a note. */
export function findDiets(text: string): { diets: Diet[]; rest: string } {
  const found = new Set<Diet>();
  let rest = text;
  for (const { diet, re } of PATTERNS) {
    rest = rest.replace(re, () => {
      found.add(diet);
      return " , ";
    });
  }
  rest = rest
    .replace(/[\t()[\]]/g, " , ")
    .replace(/\s*[,;/&+|]+[\s,;/&+|]*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,:\-–—=.]+|[\s,:\-–—=.]+$/g, "")
    .replace(/^(?:(?:and|also|plus)\b[\s,]*)+|(?:[\s,]*\b(?:and|also|plus))+$/gi, "")
    .trim();
  return { diets: sortDiets(found), rest };
}

const HEADER_WORDS = new Set(["name", "names", "guest", "guests", "person", "people", "who"]);

/** Reads one pasted line into guests. Returns null when the line holds nothing to keep. */
function parseLine(raw: string): Guest[] | null {
  const line = raw.trim().replace(/^(?:[-*•·]|\d+[.)])\s+/, "").trim();
  if (!line) return [];

  // "3 vegan", "3x gluten free"
  const lead = line.match(/^(\d+)\s*[x×]?\s+(.+)$/i);
  if (lead) {
    const { diets, rest } = findDiets(lead[2]);
    return diets.length ? [{ name: null, count: Number(lead[1]), diets, note: rest || null }] : null;
  }

  // "vegan x3", "Gluten free: 2"
  const trail = line.match(/^(.+?)\s*(?:[x×]|[:\t=]|\s[-–—])\s*(\d+)$/i);
  if (trail) {
    const { diets, rest } = findDiets(trail[1]);
    if (diets.length && !rest) return [{ name: null, count: Number(trail[2]), diets, note: null }];
  }

  // "Tom - vegan", "Tom: gf, no mushrooms", "Tom (vegan)", "Tom<tab>Vegan"
  const split = line.match(/^(.*?)\s*(?:\t|\s[-–—]\s|:|=|\()\s*(.*?)\)?\s*$/);
  if (split && split[1].trim()) {
    const head = split[1].trim();
    if (HEADER_WORDS.has(head.toLowerCase())) return [];
    const headDiets = findDiets(head);
    if (headDiets.diets.length && !headDiets.rest) {
      // "Vegan: Tom, Sam and Jo"
      const names = split[2].split(/\s*(?:[,;&]|\band\b)\s*/i).map((n) => n.trim()).filter(Boolean);
      if (!names.length) return [{ name: null, count: 1, diets: headDiets.diets, note: null }];
      return names.map((name) => ({ name, count: 1, diets: headDiets.diets, note: null }));
    }
    const { diets, rest } = findDiets(split[2]);
    if (!diets.length && !rest) return null;
    return [{ name: head, count: 1, diets, note: rest || null }];
  }

  // "Tom vegan", "gluten free"
  const { diets, rest } = findDiets(line);
  if (!diets.length) return null;
  return [{ name: rest || null, count: 1, diets, note: null }];
}

/** Reads a pasted list, one person (or group) per line. Lines it can't read come back in `skipped`. */
export function parseGuestList(text: string): { guests: Guest[]; skipped: string[] } {
  const guests: Guest[] = [];
  const skipped: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (parsed === null) skipped.push(line.trim());
    else guests.push(...parsed);
  }
  return { guests, skipped };
}

/** How many people need each diet, in the standard order, leaving out diets nobody needs. */
export function dietCounts(guests: Guest[]): { diet: Diet; label: string; count: number }[] {
  return DIETS.map((diet) => ({
    diet,
    label: DIET_LABELS[diet],
    count: guests.filter((g) => g.diets.includes(diet)).reduce((sum, g) => sum + g.count, 0),
  })).filter((d) => d.count > 0);
}

// ---------- which version each guest eats ----------

export type TagRow = { recipe_id: number; alternative_id: number | null; tag: string; value: number };
export type AlternativeRow = { id: number; recipe_id: number; label: string };
export type VersionDiets = { alternative_id: number | null; diets: Set<Diet> };

/** A vegan dish is also vegetarian and dairy-free. */
function withImplied(diets: Set<Diet>): Set<Diet> {
  if (diets.has("vegan")) diets.add("vegetarian").add("dairy_free");
  return diets;
}

/**
 * The diets each version of a recipe suits, from its diet tags. An
 * alternative with no tag for a diet falls back to its label, so a version
 * called "Vegan" counts as vegan before Jev or the chef has tagged it.
 */
export function versionDiets(recipeId: number, alternatives: AlternativeRow[], tags: TagRow[]): VersionDiets[] {
  const versions = [null, ...alternatives.filter((a) => a.recipe_id === recipeId).map((a) => a.id)];
  return versions.map((altId) => {
    const own = tags.filter((t) => t.recipe_id === recipeId && t.alternative_id === altId);
    const tagged = new Map<Diet, boolean>();
    for (const t of own) {
      if (t.tag === "contains_nuts") tagged.set("nut_free", t.value === 0);
      else if ((DIETS as readonly string[]).includes(t.tag)) tagged.set(t.tag as Diet, t.value === 1);
    }
    const diets = new Set<Diet>([...tagged].filter(([, yes]) => yes).map(([d]) => d));
    if (altId !== null) {
      const label = alternatives.find((a) => a.id === altId)!.label;
      for (const d of findDiets(label).diets) if (!tagged.has(d)) diets.add(d);
    }
    return { alternative_id: altId, diets: withImplied(diets) };
  });
}

/**
 * Picks a version for each guest: the main version when it suits all their
 * diets, else the alternative that suits them with the fewest other
 * restrictions. Guests nothing suits eat the main version and are reported.
 */
export function assignVersions(guests: Guest[], versions: VersionDiets[]) {
  const servings = new Map<number, number>();
  const unmatched: Guest[] = [];
  for (const g of guests) {
    if (!g.diets.length) continue;
    const suits = versions.filter((v) => g.diets.every((d) => v.diets.has(d)));
    if (suits.some((v) => v.alternative_id === null)) continue;
    if (!suits.length) {
      unmatched.push(g);
      continue;
    }
    const best = suits.reduce((a, b) => (b.diets.size < a.diets.size ? b : a));
    servings.set(best.alternative_id!, (servings.get(best.alternative_id!) ?? 0) + g.count);
  }
  return { servings, unmatched };
}

export type DishRef = { id: number; recipe_id: number; versions_from_guests: number };

/**
 * Version servings for every dish that follows the dietary list, as
 * meal_dish_alternatives-shaped rows, plus who has no suitable version per dish.
 */
export function guestAlternatives(guests: Guest[], dishes: DishRef[], alternatives: AlternativeRow[], tags: TagRow[]) {
  const rows: { meal_dish_id: number; alternative_id: number; servings: number }[] = [];
  const unmatched = new Map<number, Guest[]>();
  const byRecipe = new Map<number, ReturnType<typeof assignVersions>>();
  for (const dish of dishes) {
    if (!dish.versions_from_guests) continue;
    let result = byRecipe.get(dish.recipe_id);
    if (!result) {
      result = assignVersions(guests, versionDiets(dish.recipe_id, alternatives, tags));
      byRecipe.set(dish.recipe_id, result);
    }
    for (const [alternative_id, servings] of [...result.servings].sort((a, b) => a[0] - b[0])) {
      rows.push({ meal_dish_id: dish.id, alternative_id, servings });
    }
    if (result.unmatched.length) unmatched.set(dish.id, result.unmatched);
  }
  return { rows, unmatched };
}
