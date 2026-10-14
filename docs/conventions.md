# Conventions

How the code is laid out, so each milestone can be built in parallel without stepping on the others.

## Server (`src/`)

- `src/index.ts` mounts one Hono router per area. Each area owns one file in `src/routes/` and is mounted at `/api/<name>`:
  `recipes`, `ingredients`, `suppliers`, `retreats`, `orders`, `ai`. Add routes to your own file; don't edit `index.ts` unless you add a new area.
- Pure logic (parsing, scaling, Jev calls) lives in `src/lib/` and has unit tests. Routes stay thin.
- Use `c.env.DB.prepare(sql).bind(...)` with `?` placeholders. Never build SQL from user input. Use `DB.batch([...])` for multi-statement writes; it runs as one transaction.
- Validate request bodies by hand (no extra libraries) and return `400 { error: "message" }` with a message the chef can read. Missing rows return `404 { error }`.
- Only the Workers runtime is available in `src/`: no Node built-ins.

## Data

- Schema changes are new files in `migrations/`, numbered in order. Never edit an applied migration.
- Ingredient quantities in `recipe_ingredients.quantity_per_serving` are stored **per serving, in the ingredient's base unit** (`g`, `ml` or `each`). Conversion from the chef's units happens on the way in (import and editing) and back to friendly units on display.
- A recipe's main version is the rows with `alternative_id IS NULL`. Each alternative has its **own full ingredient list**, not a diff.
- Dates are `YYYY-MM-DD` text.
- Meal slots are `brunch`, `snacks`, `dinner` or any custom text. Recipe categories are `brunch`, `snack`, `dinner`, `side`, `any`.
- Order lists are computed from the plan every time. Only the chef's changes (moved delivery, other supplier, ticked) are stored, in `order_line_state`.

## Pages (`public/`)

- Plain HTML pages, one per screen, each with a small ES module beside it (`recipes.html` + `recipes.js`). No framework and no build step.
- Copy the `<head>` and `<header>` from `public/index.html` so every page has the same nav and stylesheet.
- Use the helpers in `public/lib.js`: `api()` for every request, `escape()` for every bit of data put into HTML, `qs()` for query parameters, `toast()` for short messages.
- Pass ids in the query string: `recipe.html?id=3`, `retreat.html?id=2`.
- Style with the classes in `public/styles.css` (`card`, `button`, `secondary`, `badge`, `muted`, `row`, `spread`). Design for a phone first: one column, big tap targets.
- Printable pages hide navigation and buttons automatically; add `no-print` to anything else that should not print.

## Tests

- `npm test` runs Vitest. `test/helpers/d1.ts` gives a real SQLite database with every migration applied (`testEnv()`), and `call(app, env, method, path, body)` for route tests.
- Every route file gets a test file in `test/` (`test/recipes.test.ts`); every `src/lib` module gets unit tests.
- `npm run typecheck` must pass too. CI runs both.

## Assumptions

Anything decided without Bernardo or the chef goes in `ASSUMPTIONS.md`, one line each, under the milestone it belongs to.
