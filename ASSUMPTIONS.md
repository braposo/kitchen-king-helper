# Assumptions

Decisions taken while building the MVP without input from Bernardo or the chef. Each is easy to change; flag any that are wrong.

## Foundation

- Pages are plain HTML with a small JavaScript module each, calling the JSON API. The plan mentioned htmx; plain `fetch` turned out simpler for the same result, so htmx isn't used.
- Quantities are stored per serving in the ingredient's base unit (g, ml or each), as the setup schema already did, rather than keeping the chef's original unit on each line.
- Tests run against Node's built-in SQLite with the real migrations, instead of Cloudflare's test pool, to keep the setup small.
- Jev tagging is triggered by the page right after a recipe is saved, not by the server in the background, so it is easy to test and retry.

## Recipes and import

- A recipe's category counts as the chef's choice only when the chef changes it; saving a recipe with the category Jev suggested leaves it marked as Jev's.
- An ingredient's unit (g, ml, each) can't be changed once a recipe uses it, because every saved quantity is in that unit.
- A pasted "2 tbsp flour" for a flour measured in grams converts at 1 ml = 1 g and flags the line. Ounces and pounds are also understood.
- Words with no fixed size ("2 sprigs thyme", "a handful") keep the number but are flagged; "a pinch of salt" and "salt to taste" have no amount and must be filled in before saving.
- Text before the Ingredients heading and anything under a Notes heading goes into the recipe's notes; a pasted "Vegan version" paragraph stays there for the chef to turn into an alternative.
- Servings default to 1 with a warning when a paste doesn't say. Changing servings on a saved recipe keeps the amounts as shown for the whole recipe, so per-serving quantities change.

## Jev tagging and suggestions

- Jev's request and response JSON is assumed, not checked against the docs yet. All of it lives in `buildRequest` and `parseResponse` in `src/lib/jev.ts`.
- Without a key the app uses a keyword mock. Its tags always show as "check this", so the chef confirms them before relying on them.
- Jev suggests a category for the main version only. Alternatives get diet tags but no category of their own.
- A chef's category or tag is never overwritten by Jev. Clearing a chef category also clears it, so Jev can suggest one again.
- Suggestions leave out dishes already used elsewhere that day, unless that would leave no candidates at all.

## Retreats and menu plan

- New retreats get three meals a day (brunch 11:00, snacks 16:00, dinner 19:30); the chef can rename, move, add or delete them.
- Shortening a retreat is refused if a removed day has dishes; empty meals on removed days are deleted silently.
- When a dish version (e.g. Vegan) has servings, the main version is automatic: people at that meal minus the other versions. Typing a main number overrides it.
- Duplicating a retreat keeps the people count, buffer, per-meal people overrides, time labels, dishes and version servings, and moves everything by the gap between the two start dates.
- A meal can only be placed on a day inside the retreat dates.

## Quantities

- The buffer is added to every ingredient line, including spices and "each" items; the total is then rounded up (whole packs, or whole items when there is no pack size).
- Fresh items are delivered the day before the meal that uses them; pantry goods arrive the day before the retreat starts.
- If the alternatives take more people than the meal has, the main version drops to zero servings rather than going negative.
- Amounts of 10 g or ml and above are shown as whole numbers (333 g); below 10 they keep one decimal.

## Printables

- The daily sheet and recipe cards include the buffer, so the printed amounts match the order lists.
- A recipe served at two meals gets a card for each serving, dated, so the cook sees each occasion separately.
- The "prep ahead" list covers only the next day's meals; the last day of a retreat shows nothing to prep.

## Order lists

- "Copy list" leaves out lines the chef has already ticked, since ticked means done; the printed list still shows them as checked boxes.
- Saving the details panel only stores the fields the chef actually changed, so an untouched supplier or date keeps following the automatic choice.

## Jev on the pages

- Tags are set with yes/no taps. A tag left "not set" is not saved, and saving confirms every tag showing yes or no, so an unsure Jev tag becomes the chef's once they save.
- Jev looks at a recipe again after every save of it, and once after a new recipe or import is saved. Its answers never wait on the save.
- Choosing "Let Jev suggest" for the category clears the chef's choice and asks Jev again straight away.
- Suggested dishes are only fetched when the chef taps "Suggest dishes" on an empty meal, so opening a retreat costs no Jev calls.
