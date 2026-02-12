# Deploy to Cloudflare Pages (GitHub integration)

This app uses **@cloudflare/next-on-pages** to build a Next.js 14 app for Cloudflare Pages (Workers runtime, edge). No `wrangler.toml` is required; configuration is via the Cloudflare dashboard and GitHub.

---

## Exact Cloudflare Pages settings

| Setting | Value |
|--------|--------|
| **Framework preset** | None *(or "None" – do not use "Next.js (Static HTML Export")* |
| **Build command** | `npm run build:cloudflare` |
| **Build output directory** | `.vercel/output/static` |
| **Root directory** | *(leave empty – repo root is the app)* |

---

## Step-by-step: Cloudflare Pages + GitHub setup

### 1. Connect repository

- In [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
- Choose **GitHub**, authorize, and select the repo (e.g. `your-org/agency-financial-os`).
- **Production branch**: usually `main` or `master`.

### 2. Build configuration

- **Framework preset**: **None**.
- **Build command**: `npm run build:cloudflare`
- **Build output directory**: `.vercel/output/static`
- **Root directory**: leave empty (monorepo would use e.g. `apps/web`).

### 3. Node version (optional)

- In **Settings** → **Environment variables** you cannot set NODE_VERSION there; use **Build configuration** if your plan allows, or rely on default (often Node 18).
- If the build fails on Node, add in **Build configuration** → **Environment variables**:  
  `NODE_VERSION` = `20`  
  (or `18`), depending on what Cloudflare offers.

### 4. Environment variables

Set these in **Settings** → **Environment variables** for the project. Apply to **Production** (and **Preview** if you want parity).

**Required (mark as Secret where noted):**

| Variable | Secret? | Description |
|----------|--------|-------------|
| `AIRTABLE_TOKEN` | **Yes** | Airtable API token (personal access token or OAuth). |
| `AIRTABLE_BASE_ID` | Yes (recommended) | Airtable base ID. |
| `SESSION_SECRET` | **Yes** | At least 32 characters; used to sign session cookies (HMAC). |
| `AIRTABLE_TABLE_USERS` | No | Airtable table name for users (defaults to `users` if unset). |

**Optional:**

| Variable | Secret? | Description |
|----------|--------|-------------|
| `FX_API_URL` | No | Override FX API URL (default: Frankfurter). |
| `FX_FALLBACK_RATE` | No | Fallback USD→EUR rate if FX API fails (e.g. `0.92`). |
| `AIRTABLE_TABLE_*` | No | Override any table name (e.g. `AIRTABLE_TABLE_TEAM_MEMBERS`, `AIRTABLE_TABLE_EXPENSE_ENTRIES`, etc.). See `lib/airtable.ts` for the full list. |

### 5. R2 binding (R2_BUCKET)

- **Settings** → **Functions** → **R2 bucket bindings** (or **Pages** → project → **Settings** → **Functions**).
- **Add binding**:
  - **Variable name**: `R2_BUCKET` *(must be exactly this)*
  - **R2 bucket**: select or create the bucket (e.g. for file uploads / files subdomain).
- Save. The binding is available in Workers runtime as `env.R2_BUCKET`.

### 6. Custom domains and DNS

- **Custom domains**: **Settings** → **Custom domains** → **Set up a custom domain**.
  - Add **gunzoagencypayments.com** (main app).
  - Add **files.gunzoagencypayments.com** (files subdomain) if you use it for static/file hosting.
- **DNS** (at your DNS provider, e.g. Cloudflare DNS):
  - For **gunzoagencypayments.com**: add a **CNAME** record pointing to the Pages hostname (e.g. `your-project.pages.dev`), or use the **Proxied** A/AAAA records Cloudflare gives you.
  - For **files.gunzoagencypayments.com**: same idea – CNAME to the same Pages project or to a separate worker/route if you split traffic.
- In Cloudflare Pages, attach both domains to the same project (or map subdomain to a different route if your design requires it). SSL is automatic once DNS is correct.

### 7. Deploy

- Push to the production branch; Cloudflare will run `npm run build:cloudflare` and deploy `.vercel/output/static`.
- Optional: run `npm run build:cloudflare` locally to confirm the build passes before pushing.

---

## Build script and next-on-pages

- **`npm run build:cloudflare`** (and **`npm run build:pages`**) run: `npx @cloudflare/next-on-pages`.
- That command runs `vercel build` under the hood, then transforms the output for Cloudflare Workers. The result is under **`.vercel/output/static`** (worker + assets).
- **Preview locally**: `npm run preview` runs `npx wrangler pages dev .vercel/output/static` (no wrangler.toml needed for this).

---

## Checklist summary

- [ ] Repo connected to Cloudflare Pages (GitHub).
- [ ] Build command: `npm run build:cloudflare`
- [ ] Build output directory: `.vercel/output/static`
- [ ] Root directory: empty (or set if monorepo).
- [ ] NODE_VERSION set if needed (e.g. 20).
- [ ] Env vars set: `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`, `SESSION_SECRET`, `AIRTABLE_TABLE_USERS` (and optional FX / table overrides).
- [ ] Secrets marked for: `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`, `SESSION_SECRET`.
- [ ] R2 binding added with variable name **`R2_BUCKET`**.
- [ ] Custom domains: **gunzoagencypayments.com**, **files.gunzoagencypayments.com**; DNS CNAME (or A/AAAA) pointing to Pages.
- [ ] First deploy triggered; build and runtime work with custom domain.
