import { describe, expect, it } from "vitest";
import { buildDraft, matchIngredient, parseIngredientLine, parseNumber, parseRecipe, resolveLine, type KnownIngredient } from "../src/lib/parse";

const pantry: KnownIngredient[] = [
  { id: 1, name: "Garlic", base_unit: "each" },
  { id: 2, name: "Onion", base_unit: "each" },
  { id: 3, name: "Chopped tomatoes", base_unit: "g" },
  { id: 4, name: "Olive oil", base_unit: "ml" },
  { id: 5, name: "Plain flour", base_unit: "g" },
  { id: 6, name: "Tomato", base_unit: "each" },
  { id: 7, name: "Cherry tomato", base_unit: "each" },
];

describe("parseNumber", () => {
  it("reads decimals, comma decimals and fractions", () => {
    expect(parseNumber("1.5")).toBe(1.5);
    expect(parseNumber("1,5")).toBe(1.5);
    expect(parseNumber("1/2")).toBe(0.5);
    expect(parseNumber("1 1/2")).toBe(1.5);
  });
});

describe("parseIngredientLine", () => {
  const read = (line: string) => {
    const p = parseIngredientLine(line);
    return { quantity: p.quantity, unit: p.unit, name: p.name, prep: p.prep_note };
  };

  it("reads attached and spaced metric units", () => {
    expect(read("200g flour")).toEqual({ quantity: 200, unit: "g", name: "flour", prep: null });
    expect(read("200 g flour")).toEqual({ quantity: 200, unit: "g", name: "flour", prep: null });
    expect(read("1.5kg potatoes")).toEqual({ quantity: 1.5, unit: "kg", name: "potatoes", prep: null });
  });

  it("reads a comma as a decimal point", () => {
    expect(read("1,5 kg rice")).toEqual({ quantity: 1.5, unit: "kg", name: "rice", prep: null });
  });

  it("reads spoons with and without 'of'", () => {
    expect(read("2 tbsp olive oil")).toEqual({ quantity: 2, unit: "tbsp", name: "olive oil", prep: null });
    expect(read("2 tablespoons of olive oil").name).toBe("olive oil");
  });

  it("reads unicode and written fractions", () => {
    expect(read("½ tsp salt")).toEqual({ quantity: 0.5, unit: "tsp", name: "salt", prep: null });
    expect(read("1½ tsp cumin").quantity).toBe(1.5);
    expect(read("1 1/2 cups milk")).toEqual({ quantity: 1.5, unit: "cup", name: "milk", prep: null });
    expect(read("1/2 cup oats").quantity).toBe(0.5);
  });

  it("reads plain counts", () => {
    expect(read("3 onions")).toEqual({ quantity: 3, unit: null, name: "onions", prep: null });
    expect(read("2 cloves garlic")).toEqual({ quantity: 2, unit: "clove", name: "garlic", prep: null });
  });

  it("multiplies '2 x 400g tins' and drops the tin word", () => {
    expect(read("2 x 400g tins chopped tomatoes")).toEqual({ quantity: 800, unit: "g", name: "chopped tomatoes", prep: null });
    expect(read("400g tin chickpeas").name).toBe("chickpeas");
  });

  it("takes the first number of a range", () => {
    expect(read("2-3 tbsp oil").quantity).toBe(2);
  });

  it("splits the prep note after a comma or in brackets", () => {
    expect(read("2 onions, finely diced")).toMatchObject({ name: "onions", prep: "finely diced" });
    expect(read("1 red pepper (deseeded)")).toMatchObject({ name: "red pepper", prep: "deseeded" });
    expect(read("1 carrot (large), grated")).toMatchObject({ name: "carrot", prep: "large, grated" });
  });

  it("strips bullets and numbering", () => {
    expect(read("- 200g flour").name).toBe("flour");
    expect(read("• 200g flour").quantity).toBe(200);
    expect(read("1. 200g flour").quantity).toBe(200);
  });

  it("has no quantity for a pinch or 'to taste'", () => {
    const pinch = parseIngredientLine("a pinch of salt");
    expect(pinch).toMatchObject({ quantity: null, name: "salt", vague: true, prep_note: "a pinch" });
    const taste = parseIngredientLine("salt to taste");
    expect(taste).toMatchObject({ quantity: null, name: "salt", vague: true, prep_note: "to taste" });
    expect(parseIngredientLine("Black pepper").quantity).toBeNull();
  });

  it("keeps vague units but flags them", () => {
    const line = parseIngredientLine("2 sprigs thyme");
    expect(line).toMatchObject({ quantity: 2, unit: "sprigs", unknownUnit: true, name: "thyme" });
  });
});

describe("matchIngredient", () => {
  it("matches exact names ignoring case", () => {
    expect(matchIngredient("olive OIL", pantry)?.id).toBe(4);
  });
  it("matches singular and plural", () => {
    expect(matchIngredient("onions", pantry)?.id).toBe(2);
    expect(matchIngredient("tomatoes", pantry)?.id).toBe(6);
  });
  it("matches an existing name inside the line, longest first", () => {
    expect(matchIngredient("garlic cloves", pantry)?.id).toBe(1);
    expect(matchIngredient("fresh cherry tomatoes", pantry)?.id).toBe(7);
  });
  it("returns null when nothing fits", () => {
    expect(matchIngredient("saffron", pantry)).toBeNull();
  });
});

describe("resolveLine", () => {
  const line = (text: string, servings = 10) => resolveLine(parseIngredientLine(text), servings, pantry);

  it("divides by servings and converts to the base unit", () => {
    const l = line("1 kg plain flour");
    expect(l).toMatchObject({ quantity_per_serving: 100, base_unit: "g", problem: null, match: { ingredient_id: 5 } });
  });

  it("infers the base unit for unmatched ingredients", () => {
    expect(line("500 g feta")).toMatchObject({ base_unit: "g", match: null, quantity_per_serving: 50 });
    expect(line("1 l stock")).toMatchObject({ base_unit: "ml", quantity_per_serving: 100 });
    expect(line("5 eggs")).toMatchObject({ base_unit: "each", quantity_per_serving: 0.5 });
  });

  it("flags volume converted to mass", () => {
    const l = line("2 tbsp plain flour");
    expect(l.quantity_per_serving).toBe(3);
    expect(l.problem).toBe("Volume converted to grams at 1 ml = 1 g");
  });

  it("flags a count that cannot become mass and leaves the number as written", () => {
    const l = line("4 cloves chopped tomatoes");
    expect(l.problem).toMatch(/^Can't convert/);
    expect(l.quantity_per_serving).toBe(0.4);
  });

  it("flags a missing quantity and an unknown unit", () => {
    expect(line("salt to taste")).toMatchObject({ quantity_per_serving: null, problem: "No quantity" });
    expect(line("2 sprigs thyme").problem).toBe("Unknown unit 'sprigs'");
  });

  it("maps cloves of garlic to each", () => {
    expect(line("5 cloves garlic")).toMatchObject({ base_unit: "each", match: { ingredient_id: 1 }, quantity_per_serving: 0.5, problem: null });
  });
});

describe("parseRecipe", () => {
  it("strips # and 'Recipe:' from the title", () => {
    expect(parseRecipe("# Shakshuka\nServes 4").title).toBe("Shakshuka");
    expect(parseRecipe("Recipe: Dal\nServes 4").title).toBe("Dal");
  });

  it("finds servings in the usual phrasings", () => {
    expect(parseRecipe("A\nServes 10").servings).toBe(10);
    expect(parseRecipe("A\nServes: 8-10").servings).toBe(8);
    expect(parseRecipe("A\nFor 12 people").servings).toBe(12);
    expect(parseRecipe("A\nMakes 20").servings).toBe(20);
  });

  it("defaults servings to 1 and says so", () => {
    const r = parseRecipe("A\n200g flour");
    expect(r.servings).toBe(1);
    expect(r.problems).toContain("Servings not found, set to 1");
  });

  it("works without headings: quantity lines are ingredients, the rest is method", () => {
    const r = parseRecipe("Pancakes\nServes 4\n- 200g flour\n2 eggs\n1. Mix everything.\nHeat the pan and cook.\n180°C is too hot.");
    expect(r.lines.map((l) => l.name)).toEqual(["flour", "eggs"]);
    expect(r.method).toBe("1. Mix everything.\nHeat the pan and cook.\n180°C is too hot.");
  });

  it("uses headings, drops sub-headings and keeps no-quantity lines", () => {
    const r = parseRecipe("Soup\nServes 6\nIngredients\nFor the base:\n1. 2 onions\nSalt\nMethod\nChop.\nSimmer.\nNotes\nBetter next day.");
    expect(r.lines.map((l) => l.name)).toEqual(["onions", "Salt"]);
    expect(r.method).toBe("Chop.\nSimmer.");
    expect(r.notes).toBe("Better next day.");
  });
});

describe("full pasted recipes", () => {
  const shakshuka = `Shakshuka
Serves 10
A bright, easy brunch dish.

Ingredients
- 4 tbsp olive oil
- 3 onions, finely diced
- 2 red peppers (deseeded), sliced
- 6 cloves garlic, crushed
- 2 tsp ground cumin
- ½ tsp chilli flakes
- 2 x 400g tins chopped tomatoes
- 10 eggs
- 200 g feta, crumbled
- a pinch of salt
- A handful of fresh coriander

Method
1. Heat the oil in a large pan and soften the onions.
2. Add the peppers, garlic and spices and cook for 5 minutes.
3. Add the tomatoes and simmer for 15 minutes.
4. Make wells, crack in the eggs and cover until set.
`;

  it("reads a shakshuka for 10 against an existing ingredient list", () => {
    const d = buildDraft(shakshuka, pantry);
    expect(d.title).toBe("Shakshuka");
    expect(d.servings).toBe(10);
    expect(d.problems).toEqual([]);
    expect(d.notes).toBe("A bright, easy brunch dish.");
    expect(d.method.split("\n")).toHaveLength(4);
    expect(d.lines).toHaveLength(11);

    const by = (name: string) => d.lines.find((l) => l.name === name)!;
    expect(by("olive oil")).toMatchObject({ quantity: 4, unit: "tbsp", quantity_per_serving: 6, base_unit: "ml", match: { ingredient_id: 4 }, problem: null });
    expect(by("onions")).toMatchObject({ quantity_per_serving: 0.3, prep_note: "finely diced", match: { ingredient_id: 2 } });
    expect(by("red peppers")).toMatchObject({ prep_note: "deseeded, sliced", match: null });
    expect(by("garlic")).toMatchObject({ unit: "clove", quantity_per_serving: 0.6, base_unit: "each", match: { ingredient_id: 1 } });
    expect(by("chopped tomatoes")).toMatchObject({ quantity: 800, quantity_per_serving: 80, base_unit: "g", match: { ingredient_id: 3 } });
    expect(by("eggs")).toMatchObject({ base_unit: "each", quantity_per_serving: 1 });
    expect(by("feta")).toMatchObject({ base_unit: "g", quantity_per_serving: 20, prep_note: "crumbled" });
    expect(by("salt").problem).toBe("No quantity");
    expect(by("fresh coriander").problem).toBe("No quantity");
  });

  const chilli = `# Smoky vegan chilli
Serves: 8-10

Ingredients
2 tbsp olive oil
2 onions, diced
4 cloves garlic
2 x 400g tins kidney beans, drained
1 x 400g tin chopped tomatoes
1 1/2 tsp smoked paprika
250 ml vegetable stock
1.5 kg sweet potato, cubed
salt to taste

Method
Fry the onions in the oil, add the garlic and spices.
Add everything else and simmer for 40 minutes.

Notes
Vegan version: this chilli is already vegan. For the non-vegan crowd, serve with soured cream and grated cheese.
`;

  it("reads a vegan chilli and keeps the vegan note", () => {
    const d = buildDraft(chilli, pantry);
    expect(d.title).toBe("Smoky vegan chilli");
    expect(d.servings).toBe(8);
    expect(d.lines).toHaveLength(9);
    expect(d.notes).toMatch(/^Vegan version:/);
    expect(d.method).toMatch(/simmer for 40 minutes/);

    const by = (name: string) => d.lines.find((l) => l.name === name)!;
    expect(by("kidney beans")).toMatchObject({ quantity: 800, quantity_per_serving: 100, base_unit: "g", prep_note: "drained" });
    expect(by("chopped tomatoes")).toMatchObject({ quantity: 400, quantity_per_serving: 50, match: { ingredient_id: 3 } });
    expect(by("smoked paprika")).toMatchObject({ quantity: 1.5, unit: "tsp", base_unit: "ml", quantity_per_serving: 0.9375 });
    expect(by("vegetable stock")).toMatchObject({ base_unit: "ml", quantity_per_serving: 31.25 });
    expect(by("sweet potato")).toMatchObject({ base_unit: "g", quantity_per_serving: 187.5, prep_note: "cubed" });
    expect(by("salt")).toMatchObject({ problem: "No quantity", prep_note: "to taste" });
  });
});
