# Assumptions

Decisions taken while building the MVP without input from Bernardo or the chef. Each is easy to change; flag any that are wrong.

## Foundation

- Pages are plain HTML with a small JavaScript module each, calling the JSON API. The plan mentioned htmx; plain `fetch` turned out simpler for the same result, so htmx isn't used.
- Quantities are stored per serving in the ingredient's base unit (g, ml or each), as the setup schema already did, rather than keeping the chef's original unit on each line.
- Tests run against Node's built-in SQLite with the real migrations, instead of Cloudflare's test pool, to keep the setup small.
- Jev tagging is triggered by the page right after a recipe is saved, not by the server in the background, so it is easy to test and retry.
