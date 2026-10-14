-- Initial schema. Quantities are stored per serving, in the ingredient's base unit.

CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'supermarket' CHECK (kind IN ('supermarket', 'specialist')),
  contact TEXT,
  lead_days INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE ingredients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  base_unit TEXT NOT NULL CHECK (base_unit IN ('g', 'ml', 'each')),
  storage TEXT NOT NULL DEFAULT 'pantry' CHECK (storage IN ('fresh', 'pantry')),
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  pack_size REAL,
  pack_label TEXT
);

CREATE TABLE recipes (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  servings INTEGER NOT NULL DEFAULT 1,
  method TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A version of the same dish for a diet (vegan, gluten-free). Each alternative
-- has its own full ingredient list in recipe_ingredients.
CREATE TABLE recipe_alternatives (
  id INTEGER PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  notes TEXT
);

-- alternative_id NULL means the ingredient belongs to the main version.
CREATE TABLE recipe_ingredients (
  id INTEGER PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  alternative_id INTEGER REFERENCES recipe_alternatives(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  quantity_per_serving REAL NOT NULL,
  prep_note TEXT,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX recipe_ingredients_recipe ON recipe_ingredients(recipe_id);

CREATE TABLE retreats (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  headcount INTEGER NOT NULL,
  buffer_percent INTEGER NOT NULL DEFAULT 10
);

-- Times are loose labels ("around 11"); position orders meals within a day.
CREATE TABLE meals (
  id INTEGER PRIMARY KEY,
  retreat_id INTEGER NOT NULL REFERENCES retreats(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  slot TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  time_label TEXT,
  headcount INTEGER
);
CREATE INDEX meals_retreat ON meals(retreat_id, date, position);

CREATE TABLE meal_dishes (
  id INTEGER PRIMARY KEY,
  meal_id INTEGER NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id),
  servings INTEGER
);

CREATE TABLE meal_dish_alternatives (
  id INTEGER PRIMARY KEY,
  meal_dish_id INTEGER NOT NULL REFERENCES meal_dishes(id) ON DELETE CASCADE,
  alternative_id INTEGER NOT NULL REFERENCES recipe_alternatives(id),
  servings INTEGER NOT NULL
);
