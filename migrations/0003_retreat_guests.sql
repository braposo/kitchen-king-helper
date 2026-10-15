-- Who on a retreat has a dietary need. A row is one named person, or a group
-- with no name ("3 vegans"), so the chef can list only what they know.
-- diets is a comma-separated list of: vegetarian, vegan, gluten_free,
-- dairy_free, nut_free. note holds anything else ("no mushrooms").
CREATE TABLE retreat_guests (
  id INTEGER PRIMARY KEY,
  retreat_id INTEGER NOT NULL REFERENCES retreats(id) ON DELETE CASCADE,
  name TEXT,
  count INTEGER NOT NULL DEFAULT 1 CHECK (count >= 1),
  diets TEXT NOT NULL DEFAULT '',
  note TEXT
);
CREATE INDEX retreat_guests_retreat ON retreat_guests(retreat_id, id);

-- 1: the dish's version servings follow the retreat's dietary list.
-- 0: the chef typed them, so meal_dish_alternatives holds them.
ALTER TABLE meal_dishes ADD COLUMN versions_from_guests INTEGER NOT NULL DEFAULT 1
  CHECK (versions_from_guests IN (0, 1));
UPDATE meal_dishes SET versions_from_guests = 0
  WHERE id IN (SELECT meal_dish_id FROM meal_dish_alternatives);
