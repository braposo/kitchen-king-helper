# Kitchen King Helper

Plan and run the kitchen for retreats: recipes, menus, quantities and daily orders.

One Cloudflare Worker serves the pages in `public/` and a small API in `src/`, with data in D1 (SQLite). Login is handled by Cloudflare Access, so the app has no login code.

## Local development

```sh
npm install
npm run db:migrate:local   # create the local D1 database
npm run dev                # http://localhost:8787
npm test
```

## First deploy

Every push to `main` deploys through GitHub Actions (`.github/workflows/deploy.yml`): it runs the checks, applies D1 migrations, then deploys. It skips until the secrets below exist.

1. The D1 database `kitchen` already exists and its id is in `wrangler.jsonc`. For a fresh account, create one under **Storage & Databases → D1** and replace the id.
2. Create an API token (**My Profile → API Tokens → Create Token**) from the **Edit Cloudflare Workers** template, adding **Account → D1 → Edit**.
3. In GitHub, add repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (the account id is on the Workers overview page).
4. Run the **Deploy** workflow (or push to `main`).
5. Lock it down: in the Cloudflare dashboard, open **Workers & Pages → kitchen-king-helper → Settings → Domains & Routes**, enable **Cloudflare Access** on the `workers.dev` route, and allow only the chef's email. This needs Zero Trust turned on for the account (free plan is fine).
6. Optional: `npx wrangler secret put JEV_API_KEY` to switch Jev from the offline mock to the live API.

To deploy by hand instead: `npx wrangler login`, `npm run db:migrate:remote`, `npm run deploy`.

## Layout

- `src/index.ts`: mounts the API routers in `src/routes/`, all under `/api/*`
- `src/lib/`: pure logic (parsing, quantities, Jev)
- `public/`: plain HTML, CSS and JavaScript, plus the home-screen manifest
- `migrations/`: D1 schema as SQL files, applied in order

See [docs/conventions.md](docs/conventions.md) for how the code is organised, and [ASSUMPTIONS.md](ASSUMPTIONS.md) for decisions still to confirm.
