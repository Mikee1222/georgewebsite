# Agency Financial OS – Setup

## Prerequisites

- Node.js 18+
- An Airtable base with the required tables (including **users**)
- Airtable API token with read/write access to that base

## 1. Clone and install

```bash
cd agency-financial-os
npm install
```

## 2. Environment variables

**Use `.env.local` (not `.env`)** so Next.js loads it reliably in dev:

- File must be in the **project root** (same folder as `package.json`).
- Restart the local server after any change to env vars (`npm run start:local`).

```bash
cp .env.example .env.local
# Edit .env.local: AIRTABLE_TOKEN, AIRTABLE_BASE_ID, SESSION_SECRET, AIRTABLE_TABLE_USERS
```

Required: `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`, `SESSION_SECRET` (min 32 chars, e.g. `openssl rand -base64 48`), `AIRTABLE_TABLE_USERS` (e.g. `users` if your Airtable table is named "Users").

**Check that vars are loaded:** run `npm run env:check` (prints presence only, no secrets). If /login or /setup show "Missing env vars", fix `.env.local` and restart `npm run start:local`.

### Env file location (dev)

1. Use **`.env.local`** (not `.env`) so Next.js loads it reliably.
2. File must be in the **project root** (next to `package.json`).
3. **Restart the local server** after changing env vars (`npm run start:local`).

## 3. Airtable schema (reference)

Tables expected in your base:

- **settings** – `setting_name`, `value`, `description`
- **models** – `name`, `status`, `compensation_type`, `creator_payout_pct`, `notes`, `created_date`; formula `model_id = RECORD_ID()`
- **months** – `month_key` (YYYY-MM), `month_name`, `year`, `month_number`, `is_future`
- **pnl_lines** – Link `model` → models, link `month` → months; `status` (actual/forecast); input fields (gross_revenue, …); lookups `model_id_lookup`, `month_key_lookup`; formula `unique_key`
- **audit_log** (optional) – `timestamp`, `user`, `table`, `record_id`, `field_name`, `old_value`, `new_value`, `model_name`
- **users** – `email` (text), `role` (single select: admin, finance, viewer), `is_active` (checkbox), `password_hash` (long text), `password_salt` (long text), `allowed_model_ids` (text, comma-separated; finance only), `last_login_at` (date), `created_at` (created time)

## 4. Create the first admin user (setup flow)

**No manual steps or curl.** When there are **zero users** in the **users** table:

1. Run the app: `npm run start:local`
2. Open the app in the browser (e.g. http://localhost:3000)
3. You will be redirected to **/setup** (because no users exist)
4. On the setup page, enter:
   - **Email** – valid email address
   - **Password** – at least 8 characters
   - **Confirm password**
5. Click **Create admin account**
6. The app creates the first admin user, logs you in automatically, and redirects to **/models**

After the first admin exists:

- **/setup** is no longer available (visiting it redirects to **/login**)
- **/login** is the only way to sign in; normal login is enforced

## 5. Adding more users (Airtable or script)

- **In Airtable:** Create a record in **users** with `email`, `role`, `is_active`. For password, you must set `password_hash` and `password_salt` – use a one-off script that calls `hashPassword(password)` and writes the result to Airtable (e.g. via API or extension).
- **Finance users:** Set `allowed_model_ids` to a comma-separated list of model record IDs (e.g. `recXXX,recYYY`). Leave empty to allow all models.

### Creating test users (dev only)

To create a test user in Airtable without guessing hashes:

1. **Call the dev-only hash helper** (local server must be running: `npm run start:local`):

   ```bash
   curl -X POST http://localhost:3000/api/dev/hash-password \
     -H "Content-Type: application/json" \
     -d '{"password":"YourPassword123"}'
   ```

   Response: `{"password_hash":"...","password_salt":"..."}` (404 in production).

2. **Paste into Airtable:** In the **users** table, create a record with `email`, `role` (e.g. admin/finance/viewer), `is_active` ✓, and paste the returned `password_hash` and `password_salt` into the matching fields.

3. **Log in:** Use that email and the same password at **/login**.

## 6. Verify Airtable connectivity

In dev (no auth):

```bash
curl http://localhost:3000/api/seed
```

Expected: `{"ok":true,"airtable":{...}}`. In production, `/api/seed` requires an admin session; otherwise 404.

## 7. Run locally

**DO NOT use `next dev` (or `npm run dev`).** This project uses a production-like local workflow to avoid hot-reloader corruption: `next dev` often crashes with "Cannot find module './xxx.js'" from webpack-runtime after code changes, due to corrupted dev cache / HMR state.

**Use this instead:**

```bash
npm run start:local
```

That runs `next build && next start`: a full build then the production server on http://localhost:3000. No hot reload – after code or env changes, stop the server (Ctrl+C), run `npm run start:local` again.

- If no users exist → **/setup**. If users exist → **/login**. After signing in you are redirected to **/models**.
- **Clean reinstall:** `npm run reset` (removes `.next`, `node_modules`, `package-lock.json`; runs `npm install`). Then `npm run start:local`.

## 8. Build for Cloudflare

```bash
npm run build
```

For Cloudflare Pages, see [DEPLOY.md](./DEPLOY.md).
