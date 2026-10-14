# Assumptions

Decisions taken while building the MVP without input from Bernardo or the chef. Each is easy to change; flag any that are wrong.

## Foundation

- Pages are plain HTML with a small JavaScript module each, calling the JSON API. The plan mentioned htmx; plain `fetch` turned out simpler for the same result, so htmx isn't used.
- Quantities are stored per serving in the ingredient's base unit (g, ml or each), as the setup schema already did, rather than keeping the chef's original unit on each line.
- Tests run against Node's built-in SQLite with the real migrations, instead of Cloudflare's test pool, to keep the setup small.
- Jev tagging is triggered by the page right after a recipe is saved, not by the server in the background, so it is easy to test and retry.

## Recipes and import

- A recipe's category counts as the chef's choice only when she changes it; saving a recipe with the category Jev suggested leaves it marked as Jev's.
- An ingredient's unit (g, ml, each) can't be changed once a recipe uses it, because every saved quantity is in that unit.
- A pasted "2 tbsp flour" for a flour measured in grams converts at 1 ml = 1 g and flags the line. Ounces and pounds are also understood.
- Words with no fixed size ("2 sprigs thyme", "a handful") keep the number but are flagged; "a pinch of salt" and "salt to taste" have no amount and must be filled in before saving.
- Text before the Ingredients heading and anything under a Notes heading goes into the recipe's notes; a pasted "Vegan version" paragraph stays there for the chef to turn into an alternative.
- Servings default to 1 with a warning when a paste doesn't say. Changing servings on a saved recipe keeps the amounts as shown for the whole recipe, so per-serving quantities change.
