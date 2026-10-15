// Ten sample retreat recipes for trying the app, written out as SQL.
//
//   node seed/sample-recipes.mjs
//
// writes seed/sample-recipes.sql (loads the samples, replacing any already
// loaded) and seed/remove-samples.sql (takes them out again). Every sample
// recipe and supplier has "(sample)" at the end of its name. Ingredients are
// shared with real recipes by name, so removal only deletes the ones nothing
// else uses.
//
// Quantities are per serving, in the ingredient's base unit (g, ml or each).

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const SUFFIX = " (sample)";

const suppliers = [
  { name: "Tesco", kind: "supermarket", lead_days: 1 },
  { name: "Local butcher", kind: "specialist", lead_days: 2, contact: "Order by phone the day before" },
  { name: "Fishmonger", kind: "specialist", lead_days: 2 },
];

// name: [base unit, storage, supplier, pack size, pack label]
const ingredients = {
  "Eggs": ["each", "fresh", "Tesco", 12, "box of 12"],
  "Smoked back bacon": ["g", "fresh", "Local butcher"],
  "Pork sausages": ["each", "fresh", "Local butcher"],
  "Vegan sausages": ["each", "fresh", "Tesco", 6, "pack of 6"],
  "Chestnut mushrooms": ["g", "fresh", "Tesco", 250, "250g punnet"],
  "Tomatoes": ["each", "fresh", "Tesco", 6, "pack of 6"],
  "Baked beans": ["g", "pantry", "Tesco", 415, "415g tin"],
  "Sourdough bread": ["g", "fresh", "Tesco", 800, "800g loaf"],
  "Gluten-free bread": ["g", "fresh", "Tesco", 400, "400g loaf"],
  "Butter": ["g", "fresh", "Tesco", 250, "250g block"],
  "Dairy-free spread": ["g", "fresh", "Tesco", 500, "500g tub"],
  "Firm tofu": ["g", "fresh", "Tesco", 280, "280g block"],
  "Olive oil": ["ml", "pantry", "Tesco", 1000, "1 litre bottle"],
  "Chopped tomatoes": ["g", "pantry", "Tesco", 400, "400g tin"],
  "Onions": ["each", "fresh", "Tesco"],
  "Red peppers": ["each", "fresh", "Tesco"],
  "Garlic cloves": ["each", "fresh", "Tesco"],
  "Ground cumin": ["ml", "pantry", "Tesco"],
  "Smoked paprika": ["ml", "pantry", "Tesco"],
  "Feta": ["g", "fresh", "Tesco", 200, "200g pack"],
  "Flatbreads": ["each", "fresh", "Tesco", 6, "pack of 6"],
  "Fresh coriander": ["g", "fresh", "Tesco", 30, "30g bag"],
  "Rolled oats": ["g", "pantry", "Tesco", 1000, "1kg bag"],
  "Gluten-free oats": ["g", "pantry", "Tesco", 450, "450g bag"],
  "Whole milk": ["ml", "fresh", "Tesco", 2272, "4 pint bottle"],
  "Oat milk": ["ml", "pantry", "Tesco", 1000, "1 litre carton"],
  "Greek yoghurt": ["g", "fresh", "Tesco", 1000, "1kg tub"],
  "Coconut yoghurt": ["g", "fresh", "Tesco", 400, "400g tub"],
  "Honey": ["g", "pantry", "Tesco", 340, "340g jar"],
  "Maple syrup": ["ml", "pantry", "Tesco", 250, "250ml bottle"],
  "Frozen mixed berries": ["g", "pantry", "Tesco", 750, "750g bag"],
  "Chia seeds": ["g", "pantry", "Tesco"],
  "Chickpeas": ["g", "pantry", "Tesco", 400, "400g tin"],
  "Tahini": ["g", "pantry", "Tesco", 300, "300g jar"],
  "Lemons": ["each", "fresh", "Tesco"],
  "Carrots": ["g", "fresh", "Tesco", 1000, "1kg bag"],
  "Cucumber": ["each", "fresh", "Tesco"],
  "Golden syrup": ["g", "pantry", "Tesco", 454, "454g tin"],
  "Light brown sugar": ["g", "pantry", "Tesco", 500, "500g bag"],
  "Ripe bananas": ["each", "fresh", "Tesco"],
  "Plain flour": ["g", "pantry", "Tesco", 1500, "1.5kg bag"],
  "Gluten-free plain flour": ["g", "pantry", "Tesco", 1000, "1kg bag"],
  "Bicarbonate of soda": ["ml", "pantry", "Tesco"],
  "Walnuts": ["g", "pantry", "Tesco", 150, "150g bag"],
  "Braising beef": ["g", "fresh", "Local butcher"],
  "Brown ale": ["ml", "pantry", "Tesco", 500, "500ml bottle"],
  "Celery": ["each", "fresh", "Tesco"],
  "Beef stock cubes": ["each", "pantry", "Tesco", 8, "pack of 8"],
  "Vegetable stock cubes": ["each", "pantry", "Tesco", 8, "pack of 8"],
  "Fresh thyme": ["g", "fresh", "Tesco", 30, "30g pack"],
  "Maris Piper potatoes": ["g", "fresh", "Tesco", 2500, "2.5kg bag"],
  "Portobello mushrooms": ["g", "fresh", "Tesco"],
  "Green lentils": ["g", "pantry", "Tesco", 500, "500g bag"],
  "Tomato puree": ["g", "pantry", "Tesco", 200, "200g tube"],
  "Chicken thighs": ["g", "fresh", "Local butcher"],
  "Tikka masala paste": ["g", "pantry", "Tesco", 283, "283g jar"],
  "Fresh ginger": ["g", "fresh", "Tesco"],
  "Double cream": ["ml", "fresh", "Tesco", 300, "300ml pot"],
  "Coconut milk": ["ml", "pantry", "Tesco", 400, "400ml tin"],
  "Cauliflower": ["each", "fresh", "Tesco"],
  "Basmati rice": ["g", "pantry", "Tesco", 2000, "2kg bag"],
  "Salmon fillets": ["each", "fresh", "Fishmonger"],
  "New potatoes": ["g", "fresh", "Tesco", 1000, "1kg bag"],
  "Green beans": ["g", "fresh", "Tesco", 220, "220g pack"],
  "Fresh dill": ["g", "fresh", "Tesco", 30, "30g pack"],
  "Mixed salad leaves": ["g", "fresh", "Tesco", 120, "120g bag"],
  "Cherry tomatoes": ["g", "fresh", "Tesco", 250, "250g punnet"],
  "Red wine vinegar": ["ml", "pantry", "Tesco", 350, "350ml bottle"],
  "Dijon mustard": ["ml", "pantry", "Tesco"],
};

const TAGS = ["vegetarian", "vegan", "gluten_free", "dairy_free", "contains_nuts"];

// Each version lists its full ingredients as [name, quantity per serving, prep note]
// and the diet tags that are true for it; every other tag is stored as false.
const recipes = [
  {
    title: "Full English breakfast",
    category: "brunch",
    servings: 10,
    method:
      "Grill the sausages and bacon. Roast the halved tomatoes and mushrooms with a little oil. Warm the beans. Fry or scramble the eggs to order and serve with buttered toast.",
    tags: ["dairy_free"],
    ingredients: [
      ["Pork sausages", 2],
      ["Smoked back bacon", 60, "2 rashers"],
      ["Eggs", 2],
      ["Chestnut mushrooms", 60, "halved"],
      ["Tomatoes", 0.5, "halved"],
      ["Baked beans", 100],
      ["Sourdough bread", 70, "2 slices, toasted"],
      ["Dairy-free spread", 10],
    ],
    alternatives: [
      {
        label: "Vegan",
        notes: "Tofu scramble instead of eggs.",
        tags: ["vegetarian", "vegan", "dairy_free"],
        ingredients: [
          ["Vegan sausages", 2],
          ["Firm tofu", 100, "crumbled, fried with turmeric"],
          ["Chestnut mushrooms", 80, "halved"],
          ["Tomatoes", 0.5, "halved"],
          ["Baked beans", 100],
          ["Sourdough bread", 70, "2 slices, toasted"],
          ["Dairy-free spread", 10],
        ],
      },
    ],
  },
  {
    title: "Shakshuka with feta and flatbreads",
    category: "brunch",
    servings: 10,
    method:
      "Soften the onions and peppers in oil, add garlic and spices, then the tomatoes. Simmer 20 minutes until thick. Make wells, crack in the eggs, cover and cook until just set. Finish with feta and coriander. Serve with warm flatbreads.",
    tags: ["vegetarian"],
    ingredients: [
      ["Onions", 0.25, "sliced"],
      ["Red peppers", 0.5, "sliced"],
      ["Garlic cloves", 1, "crushed"],
      ["Olive oil", 10],
      ["Ground cumin", 1.5],
      ["Smoked paprika", 1.5],
      ["Chopped tomatoes", 200],
      ["Eggs", 2],
      ["Feta", 30, "crumbled"],
      ["Fresh coriander", 3],
      ["Flatbreads", 1],
    ],
    alternatives: [
      {
        label: "Gluten-free, dairy-free",
        notes: "No feta, gluten-free toast instead of flatbread.",
        tags: ["vegetarian", "gluten_free", "dairy_free"],
        ingredients: [
          ["Onions", 0.25, "sliced"],
          ["Red peppers", 0.5, "sliced"],
          ["Garlic cloves", 1, "crushed"],
          ["Olive oil", 10],
          ["Ground cumin", 1.5],
          ["Smoked paprika", 1.5],
          ["Chopped tomatoes", 200],
          ["Eggs", 2],
          ["Fresh coriander", 3],
          ["Gluten-free bread", 60, "toasted"],
        ],
      },
    ],
  },
  {
    title: "Overnight oats with berries",
    category: "brunch",
    servings: 10,
    method:
      "The night before, mix the oats, chia, milk and yoghurt in a large tub and chill. In the morning loosen with a splash of milk, top with the berries (thawed) and a drizzle of honey.",
    tags: ["vegetarian"],
    ingredients: [
      ["Rolled oats", 50],
      ["Chia seeds", 5],
      ["Whole milk", 120],
      ["Greek yoghurt", 60],
      ["Frozen mixed berries", 70],
      ["Honey", 10],
    ],
    alternatives: [
      {
        label: "Vegan, gluten-free",
        notes: "Gluten-free oats, oat milk, coconut yoghurt and maple syrup.",
        tags: ["vegetarian", "vegan", "gluten_free", "dairy_free"],
        ingredients: [
          ["Gluten-free oats", 50],
          ["Chia seeds", 5],
          ["Oat milk", 120],
          ["Coconut yoghurt", 60],
          ["Frozen mixed berries", 70],
          ["Maple syrup", 10],
        ],
      },
    ],
  },
  {
    title: "Hummus with crudités",
    category: "snack",
    servings: 10,
    method:
      "Blend the drained chickpeas with tahini, lemon juice, garlic, oil and a splash of cold water until smooth. Season. Cut the carrots, cucumber and peppers into sticks and serve alongside.",
    tags: ["vegetarian", "vegan", "gluten_free", "dairy_free"],
    ingredients: [
      ["Chickpeas", 80, "drained"],
      ["Tahini", 15],
      ["Lemons", 0.15, "juiced"],
      ["Garlic cloves", 0.3, "crushed"],
      ["Olive oil", 10],
      ["Carrots", 60, "sticks"],
      ["Cucumber", 0.15, "sticks"],
      ["Red peppers", 0.25, "strips"],
    ],
    alternatives: [],
  },
  {
    title: "Flapjacks",
    category: "snack",
    servings: 16,
    method:
      "Melt the butter, sugar and syrup together. Stir in the oats. Press into a lined tray and bake at 180°C for 20 to 25 minutes until golden at the edges. Cool in the tray, then cut into 16.",
    tags: ["vegetarian"],
    ingredients: [
      ["Butter", 15],
      ["Light brown sugar", 10],
      ["Golden syrup", 12],
      ["Rolled oats", 25],
    ],
    alternatives: [
      {
        label: "Vegan, gluten-free",
        notes: "Dairy-free spread and gluten-free oats. Bake on a separate tray.",
        tags: ["vegetarian", "vegan", "gluten_free", "dairy_free"],
        ingredients: [
          ["Dairy-free spread", 15],
          ["Light brown sugar", 10],
          ["Golden syrup", 12],
          ["Gluten-free oats", 25],
        ],
      },
    ],
  },
  {
    title: "Banana and walnut bread",
    category: "snack",
    servings: 10,
    method:
      "Cream the butter and sugar, beat in the eggs, then the mashed bananas. Fold in the flour, bicarb and chopped walnuts. Bake in a lined loaf tin at 170°C for about an hour, until a skewer comes out clean.",
    tags: ["vegetarian", "contains_nuts"],
    ingredients: [
      ["Ripe bananas", 0.3, "mashed"],
      ["Butter", 10],
      ["Light brown sugar", 12],
      ["Eggs", 0.2],
      ["Plain flour", 22],
      ["Bicarbonate of soda", 0.5],
      ["Walnuts", 6, "chopped"],
    ],
    alternatives: [
      {
        label: "Gluten-free, nut-free",
        notes: "Gluten-free flour and no walnuts. Bake in a separate tin.",
        tags: ["vegetarian", "gluten_free"],
        ingredients: [
          ["Ripe bananas", 0.3, "mashed"],
          ["Butter", 10],
          ["Light brown sugar", 12],
          ["Eggs", 0.2],
          ["Gluten-free plain flour", 22],
          ["Bicarbonate of soda", 0.5],
        ],
      },
    ],
  },
  {
    title: "Beef and ale stew with mash",
    category: "dinner",
    servings: 10,
    method:
      "Toss the beef in flour and brown in batches. Soften the onions, carrots and celery, add the beef back with the ale, stock, tomato puree and thyme. Cover and cook at 160°C for 2.5 hours. Boil the potatoes and mash with butter and hot milk.",
    tags: [],
    ingredients: [
      ["Braising beef", 200, "diced"],
      ["Plain flour", 8],
      ["Olive oil", 8],
      ["Onions", 0.3, "chopped"],
      ["Carrots", 60, "chunks"],
      ["Celery", 0.1, "sliced"],
      ["Brown ale", 60],
      ["Beef stock cubes", 0.3],
      ["Tomato puree", 5],
      ["Fresh thyme", 0.5],
      ["Maris Piper potatoes", 250, "peeled"],
      ["Butter", 12],
      ["Whole milk", 30],
    ],
    alternatives: [
      {
        label: "Vegan",
        notes: "Mushroom and lentil stew, mash made with oat milk and spread. Brown ale is often not vegan: check the label.",
        tags: ["vegetarian", "vegan", "dairy_free"],
        ingredients: [
          ["Portobello mushrooms", 150, "thick slices"],
          ["Green lentils", 40],
          ["Plain flour", 5],
          ["Olive oil", 10],
          ["Onions", 0.3, "chopped"],
          ["Carrots", 60, "chunks"],
          ["Celery", 0.1, "sliced"],
          ["Brown ale", 60],
          ["Vegetable stock cubes", 0.3],
          ["Tomato puree", 5],
          ["Fresh thyme", 0.5],
          ["Maris Piper potatoes", 250, "peeled"],
          ["Dairy-free spread", 12],
          ["Oat milk", 30],
        ],
      },
    ],
  },
  {
    title: "Chicken tikka masala with rice",
    category: "dinner",
    servings: 10,
    method:
      "Marinate the chicken in yoghurt and half the paste for a few hours, then grill until charred. Fry the onion, garlic and ginger, add the rest of the paste and the tomatoes and simmer 15 minutes. Add the chicken and cream and simmer 10 minutes more. Serve with rice and coriander.",
    tags: ["gluten_free"],
    ingredients: [
      ["Chicken thighs", 180, "boneless, diced"],
      ["Greek yoghurt", 25],
      ["Tikka masala paste", 30],
      ["Olive oil", 8],
      ["Onions", 0.3, "chopped"],
      ["Garlic cloves", 1, "crushed"],
      ["Fresh ginger", 4, "grated"],
      ["Chopped tomatoes", 80],
      ["Double cream", 30],
      ["Basmati rice", 75],
      ["Fresh coriander", 3],
    ],
    alternatives: [
      {
        label: "Vegan",
        notes: "Chickpea and cauliflower curry with coconut milk. Check the paste is vegan.",
        tags: ["vegetarian", "vegan", "gluten_free", "dairy_free"],
        ingredients: [
          ["Chickpeas", 120, "drained"],
          ["Cauliflower", 0.15, "florets, roasted"],
          ["Tikka masala paste", 30],
          ["Olive oil", 10],
          ["Onions", 0.3, "chopped"],
          ["Garlic cloves", 1, "crushed"],
          ["Fresh ginger", 4, "grated"],
          ["Chopped tomatoes", 80],
          ["Coconut milk", 60],
          ["Basmati rice", 75],
          ["Fresh coriander", 3],
        ],
      },
    ],
  },
  {
    title: "Baked salmon with new potatoes and green beans",
    category: "dinner",
    servings: 10,
    method:
      "Halve and boil the new potatoes, then toss with butter and dill. Lay the salmon on lined trays, season, add lemon slices and a drizzle of oil and bake at 200°C for 12 to 15 minutes. Blanch the green beans for 3 minutes.",
    tags: ["gluten_free"],
    ingredients: [
      ["Salmon fillets", 1],
      ["Lemons", 0.25, "sliced"],
      ["Olive oil", 5],
      ["New potatoes", 200, "halved"],
      ["Butter", 10],
      ["Fresh dill", 2, "chopped"],
      ["Green beans", 80, "trimmed"],
    ],
    alternatives: [
      {
        label: "Dairy-free",
        notes: "Olive oil on the potatoes instead of butter.",
        tags: ["gluten_free", "dairy_free"],
        ingredients: [
          ["Salmon fillets", 1],
          ["Lemons", 0.25, "sliced"],
          ["Olive oil", 15],
          ["New potatoes", 200, "halved"],
          ["Fresh dill", 2, "chopped"],
          ["Green beans", 80, "trimmed"],
        ],
      },
    ],
  },
  {
    title: "Big green salad",
    category: "side",
    servings: 10,
    method:
      "Whisk the oil, vinegar and mustard with a pinch of salt. Toss the leaves, cucumber and halved tomatoes with the dressing just before serving.",
    tags: ["vegetarian", "vegan", "gluten_free", "dairy_free"],
    ingredients: [
      ["Mixed salad leaves", 30],
      ["Cucumber", 0.1, "sliced"],
      ["Cherry tomatoes", 50, "halved"],
      ["Olive oil", 10],
      ["Red wine vinegar", 4],
      ["Dijon mustard", 1.5],
    ],
    alternatives: [],
  },
];

// --- SQL -------------------------------------------------------------------

const q = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const supplierId = (name) => `(SELECT id FROM suppliers WHERE name = ${q(name + SUFFIX)})`;

function check() {
  for (const r of recipes) {
    for (const v of [r, ...r.alternatives]) {
      for (const [name, qty] of v.ingredients) {
        if (!ingredients[name]) throw new Error(`${r.title}: unknown ingredient ${name}`);
        if (!(qty > 0)) throw new Error(`${r.title}: bad quantity for ${name}`);
      }
      for (const t of v.tags) if (!TAGS.includes(t)) throw new Error(`${r.title}: unknown tag ${t}`);
    }
  }
}

function removeSql() {
  const titles = recipes.map((r) => q(r.title + SUFFIX)).join(", ");
  const names = Object.keys(ingredients).map(q).join(", ");
  const sampleRecipes = `SELECT id FROM recipes WHERE title IN (${titles})`;
  return [
    "-- Removes the sample recipes and suppliers, and any sample ingredient no real recipe uses.",
    "-- Generated by seed/sample-recipes.mjs. Sample dishes added to a retreat menu are taken off it too.",
    `DELETE FROM meal_dish_alternatives WHERE meal_dish_id IN (SELECT id FROM meal_dishes WHERE recipe_id IN (${sampleRecipes}));`,
    `DELETE FROM meal_dishes WHERE recipe_id IN (${sampleRecipes});`,
    `DELETE FROM recipes WHERE title IN (${titles});`,
    `DELETE FROM ingredients WHERE name IN (${names}) AND id NOT IN (SELECT ingredient_id FROM recipe_ingredients);`,
    `DELETE FROM suppliers WHERE name IN (${suppliers.map((s) => q(s.name + SUFFIX)).join(", ")});`,
    "",
  ].join("\n");
}

function seedSql() {
  const out = [
    "-- Ten sample recipes for trying the app. Generated by seed/sample-recipes.mjs: edit that, not this.",
    "-- Safe to run again: it removes the previous samples first.",
    "",
    removeSql(),
  ];

  for (const s of suppliers) {
    out.push(
      `INSERT INTO suppliers (name, kind, contact, lead_days) VALUES (${q(s.name + SUFFIX)}, ${q(s.kind)}, ${q(s.contact)}, ${s.lead_days});`,
    );
  }
  out.push("");

  // Ingredients the chef already has keep their own settings.
  const ingRows = Object.entries(ingredients).map(
    ([name, [base, storage, supplier, packSize, packLabel]]) =>
      `  (${q(name)}, ${q(base)}, ${q(storage)}, ${supplierId(supplier)}, ${q(packSize)}, ${q(packLabel)})`,
  );
  out.push(
    `INSERT OR IGNORE INTO ingredients (name, base_unit, storage, supplier_id, pack_size, pack_label) VALUES\n${ingRows.join(",\n")};`,
    "",
  );

  // Recipes, then their versions, ingredients and tags, joined by name so the
  // file works whatever ids the database hands out.
  const recipeRows = recipes.map(
    (r) => `  (${q(r.title + SUFFIX)}, ${r.servings}, ${q(r.method)}, 'Sample recipe for testing the app.', ${q(r.category)}, 'chef')`,
  );
  out.push(
    `INSERT INTO recipes (title, servings, method, notes, category, category_source) VALUES\n${recipeRows.join(",\n")};`,
    "",
  );

  const altRows = recipes.flatMap((r) => r.alternatives.map((a) => `  (${q(r.title + SUFFIX)}, ${q(a.label)}, ${q(a.notes)})`));
  out.push(
    "INSERT INTO recipe_alternatives (recipe_id, label, notes)",
    `SELECT r.id, v.column2, v.column3 FROM (VALUES\n${altRows.join(",\n")}\n) v JOIN recipes r ON r.title = v.column1;`,
    "",
  );

  const versions = recipes.flatMap((r) => [{ ...r, recipe: r.title + SUFFIX, label: null }, ...r.alternatives.map((a) => ({ ...a, recipe: r.title + SUFFIX }))]);
  const versionJoin =
    "JOIN recipes r ON r.title = v.column1 LEFT JOIN recipe_alternatives a ON a.recipe_id = r.id AND a.label = v.column2";

  const lineRows = versions.flatMap((v) =>
    v.ingredients.map(([name, qty, note], i) => `  (${q(v.recipe)}, ${q(v.label)}, ${q(name)}, ${qty}, ${q(note)}, ${i})`),
  );
  out.push(
    "INSERT INTO recipe_ingredients (recipe_id, alternative_id, ingredient_id, quantity_per_serving, prep_note, position)",
    `SELECT r.id, a.id, i.id, v.column4, v.column5, v.column6 FROM (VALUES\n${lineRows.join(",\n")}\n) v ${versionJoin} JOIN ingredients i ON i.name = v.column3;`,
    "",
  );

  const tagRows = versions.map((v) => `  (${q(v.recipe)}, ${q(v.label)}, ${TAGS.map((t) => (v.tags.includes(t) ? 1 : 0)).join(", ")})`);
  const tagSelects = TAGS.map((t, i) => `SELECT r.id, a.id, ${q(t)}, v.column${i + 3}, 'chef' FROM v ${versionJoin}`);
  out.push(
    "INSERT INTO recipe_diet_tags (recipe_id, alternative_id, tag, value, source)",
    `WITH v AS (VALUES\n${tagRows.join(",\n")}\n)\n${tagSelects.join("\nUNION ALL ")};`,
    "",
  );
  return out.join("\n");
}

check();
const dir = import.meta.dirname;
writeFileSync(join(dir, "sample-recipes.sql"), seedSql());
writeFileSync(join(dir, "remove-samples.sql"), removeSql());
console.log(`Wrote ${recipes.length} recipes, ${Object.keys(ingredients).length} ingredients.`);
