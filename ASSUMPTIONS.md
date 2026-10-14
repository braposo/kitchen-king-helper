# Assumptions

Decisions taken while building the MVP without input from Bernardo or the chef. Each is easy to change; flag any that are wrong.

## Foundation

- Pages are plain HTML with a small JavaScript module each, calling the JSON API. The plan mentioned htmx; plain `fetch` turned out simpler for the same result, so htmx isn't used.
- Quantities are stored per serving in the ingredient's base unit (g, ml or each), as the setup schema already did, rather than keeping the chef's original unit on each line.
- Tests run against Node's built-in SQLite with the real migrations, instead of Cloudflare's test pool, to keep the setup small.
- Jev tagging is triggered by the page right after a recipe is saved, not by the server in the background, so it is easy to test and retry.

## Quantities

- The buffer is added to every ingredient line, including spices and "each" items; the total is then rounded up (whole packs, or whole items when there is no pack size).
- Fresh items are delivered the day before the meal that uses them; pantry goods arrive the day before the retreat starts.
- If the alternatives take more people than the meal has, the main version drops to zero servings rather than going negative.
- Amounts of 10 g or ml and above are shown as whole numbers (333 g); below 10 they keep one decimal.

## Printables

- The daily sheet and recipe cards include the buffer, so the printed amounts match the order lists.
- A recipe served at two meals gets a card for each serving, dated, so the cook sees each occasion separately.
- The "prep ahead" list covers only the next day's meals; the last day of a retreat shows nothing to prep.
