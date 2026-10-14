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

1. `npx wrangler login`
2. `npx wrangler d1 create kitchen`, then paste the printed `database_id` into `wrangler.jsonc`.
3. `npm run db:migrate:remote`
4. `npm run deploy`
5. Lock it down: in the Cloudflare dashboard, open **Workers & Pages → kitchen-king-helper → Access**, choose **Protect this Worker behind Access** for all traffic, and allow only the chef's email. This needs Zero Trust turned on for the account.

## Layout

- `src/index.ts`: API routes (Hono), all under `/api/*`
- `public/`: plain HTML, CSS and JavaScript, plus the home-screen manifest
- `migrations/`: D1 schema as SQL files, applied in order
