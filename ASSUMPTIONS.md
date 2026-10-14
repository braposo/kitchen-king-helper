# Assumptions

Decisions taken while building the MVP without input from Bernardo or the chef. Each is easy to change; flag any that are wrong.

## Foundation

- Pages are plain HTML with a small JavaScript module each, calling the JSON API. The plan mentioned htmx; plain `fetch` turned out simpler for the same result, so htmx isn't used.
- Quantities are stored per serving in the ingredient's base unit (g, ml or each), as the setup schema already did, rather than keeping the chef's original unit on each line.
- Tests run against Node's built-in SQLite with the real migrations, instead of Cloudflare's test pool, to keep the setup small.
- Jev tagging is triggered by the page right after a recipe is saved, not by the server in the background, so it is easy to test and retry.

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
