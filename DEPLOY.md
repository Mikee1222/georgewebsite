# Deploy to Cloudflare Pages

This app is built for **Cloudflare Pages** using **@cloudflare/next-on-pages** (Next.js 14 App Router, Workers/Edge runtime). Do **not** add a root `wrangler.toml` for Pages; configuration is via the dashboard and build command.

## Build command

```bash
npx @cloudflare/next-on-pages
```

Or, if your CI runs `next build` first:

```bash
npx next build && npx @cloudflare/next-on-pages
```

In Cloudflare Pages dashboard: set **Build command** to one of the above (e.g. `npx @cloudflare/next-on-pages`). Set **Build output directory** to the value indicated by the CLI (typically `.vercel/output/static` or similar per next-on-pages docs).

## Environment variables (Pages)

In Cloudflare Pages → your project → **Settings** → **Environment variables**, add the same variables as in [ENV.md](./ENV.md):

- **Required:** `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`, `SESSION_SECRET`, `LOGIN_PASSWORD`
- **Optional:** `AIRTABLE_TABLE_*`, `ADMIN_EMAILS`, `FINANCE_EMAILS`, `VIEWER_EMAILS`, `FINANCE_MODEL_IDS`

Apply to **Production** (and **Preview** if you use preview envs).

## Custom domain

1. Cloudflare Pages → your project → **Custom domains**.
2. Add your domain (e.g. `app.agency.com`).
3. Follow the DNS instructions (CNAME or proxy through Cloudflare).
4. SSL is provisioned automatically.

## Framework preset

- **Framework preset:** Next.js (or “None” and use the build command above).
- **Root directory:** leave blank if the app is at repo root; otherwise set to the subdirectory containing `package.json`.

## Seed / connectivity check

After deploy, you can verify Airtable connectivity (no auth):

```bash
curl https://your-pages-url.pages.dev/api/seed
```

Expected: `{"ok":true,"airtable":{...}, "ts":"..."}`.

## Constraints (reminder)

- No Node-only APIs; all API routes use `export const runtime = 'edge'`.
- Airtable is called only from server route handlers; the Airtable token is never exposed to the client.
- No root `wrangler.toml` for Pages; use dashboard build settings and env vars.
