-- Meal category on each recipe, diet tags per version, and the chef's
-- overrides and ticks on computed order lines.

-- brunch, snack, dinner, side or any. category_source says who set it:
-- 'jev' is a suggestion, 'chef' always wins and is never overwritten by Jev.
ALTER TABLE recipes ADD COLUMN category TEXT
  CHECK (category IN ('brunch', 'snack', 'dinner', 'side', 'any'));
ALTER TABLE recipes ADD COLUMN category_source TEXT
  CHECK (category_source IN ('jev', 'chef'));

-- One row per version (alternative_id NULL = main version) and tag.
-- tag: vegetarian, vegan, gluten_free, dairy_free, contains_nuts.
-- confidence is Jev's probability for the answer in value (NULL for chef tags);
-- anything below 0.9 is shown as "check this".
CREATE TABLE recipe_diet_tags (
  id INTEGER PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  alternative_id INTEGER REFERENCES recipe_alternatives(id) ON DELETE CASCADE,
  tag TEXT NOT NULL CHECK (tag IN ('vegetarian', 'vegan', 'gluten_free', 'dairy_free', 'contains_nuts')),
  value INTEGER NOT NULL CHECK (value IN (0, 1)),
  confidence REAL,
  source TEXT NOT NULL CHECK (source IN ('jev', 'chef'))
);
CREATE UNIQUE INDEX recipe_diet_tags_unique
  ON recipe_diet_tags(recipe_id, IFNULL(alternative_id, 0), tag);

-- Order lists are computed from the plan. Only the chef's changes are stored,
-- keyed by retreat, ingredient and the group the engine put the line in
-- ('pantry' or the need date, YYYY-MM-DD).
CREATE TABLE order_line_state (
  id INTEGER PRIMARY KEY,
  retreat_id INTEGER NOT NULL REFERENCES retreats(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  line_group TEXT NOT NULL,
  delivery_date TEXT,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  ticked INTEGER NOT NULL DEFAULT 0 CHECK (ticked IN (0, 1)),
  UNIQUE (retreat_id, ingredient_id, line_group)
);
