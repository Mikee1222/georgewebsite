# Cloudflare Pages – Deploy checklist

## Required environment variables

Set in **Cloudflare Pages → Settings → Environment variables** (Production and Preview as needed):

| Variable | Description |
|----------|-------------|
| `AIRTABLE_TOKEN` | Airtable Personal Access Token (PAT). |
| `AIRTABLE_BASE_ID` | Airtable base ID (e.g. from URL: `appXXXXXXXXXXXXXX`). |
| `SESSION_SECRET` | At least 32 characters (e.g. `openssl rand -base64 48`). |

Users and roles live in the Airtable **users** table (no env-based email lists). Create the first admin via `POST /api/admin/bootstrap` with `{ email, password }` when no users exist, or with `{ email, password, token }` when `BOOTSTRAP_TOKEN` is set.

Optional: `AIRTABLE_TABLE_*`, `BOOTSTRAP_TOKEN`.

## Build command

```bash
npx @cloudflare/next-on-pages
```

Or, if your CI runs Next build first:

```bash
npx next build && npx @cloudflare/next-on-pages
```

- **Framework preset:** Next.js (or None).
- **Root directory:** Leave blank if the app is at repo root; otherwise the folder containing `package.json`.
- **Build output directory:** Use the path indicated by `@cloudflare/next-on-pages` (often `.vercel/output/static` or similar).

Do **not** add a root `wrangler.toml` for Pages; configure via the dashboard.

## Smoke test endpoints

After deploy, check:

1. **Health (no auth)**  
   `GET https://your-project.pages.dev/api/health`  
   - **200:** `{ "ok": true }` → app and Airtable reachable.  
   - **503:** `{ "ok": false, "error": "Service unavailable" }` → env or Airtable misconfigured (no secrets in response).

2. **Login page**  
   `GET https://your-project.pages.dev/login`  
   - **200:** Login form loads.

3. **Protected redirect**  
   `GET https://your-project.pages.dev/models` (no cookie)  
   - **302** to `/login`.

4. **Seed (production, admin only)**  
   `GET https://your-project.pages.dev/api/seed`  
   - With admin session cookie: **200** and Airtable counts.  
   - Without auth or non-admin: **401** or **404**.

## Notes

- All API routes use `runtime = 'edge'`; no Node-only APIs.
- Airtable token is never sent to the client; all Airtable calls are in route handlers.
- `/api/health` does one minimal Airtable read (settings, 1 record) and returns only `ok` / generic error.
