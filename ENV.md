# Environment variables

Set these in local **`.env.local`** (project root, next to `package.json`) and in Cloudflare Pages (Settings → Environment variables). Never commit `.env.local` (add to `.gitignore` if needed).

**Local dev:** Use `.env.local`; restart the local server after changing env vars (`npm run start:local`).

## Required

| Variable | Description |
|----------|-------------|
| `AIRTABLE_TOKEN` | Airtable API token (Personal access token or OAuth). |
| `AIRTABLE_BASE_ID` | Airtable base ID (starts with `app...`). |
| `SESSION_SECRET` | At least 32 characters; used to sign session cookies (HMAC-SHA256). |

## Optional (table names)

If your Airtable table names differ from the defaults, set:

| Variable | Default |
|----------|---------|
| `AIRTABLE_TABLE_SETTINGS` | `settings` |
| `AIRTABLE_TABLE_MODELS` | `models` |
| `AIRTABLE_TABLE_MONTHS` | `months` |
| `AIRTABLE_TABLE_PNL_LINES` | `pnl_lines` |
| `AIRTABLE_TABLE_AUDIT_LOG` | `audit_log` |
| `AIRTABLE_TABLE_USERS` | `users` |
| `AIRTABLE_TABLE_TEAM_MEMBERS` | `team_members` |
| `AIRTABLE_TABLE_EXPENSE_ENTRIES` | `expense_entries` |
| `AIRTABLE_TABLE_REVENUE_ENTRIES` | `revenue_entries` |
| `NEXT_PUBLIC_APP_VERSION` | Optional; shown on login/setup footer (default `1.0.0`). |

## Auth (Airtable users table)

Users and roles are stored in the **users** table in Airtable (no env-based email lists).

- **users** table: `email`, `role` (admin/finance/viewer), `is_active`, `password_hash`, `password_salt`, `allowed_model_ids` (comma-separated, finance only).
- Passwords are hashed with PBKDF2 (edge-safe); never store plaintext.

## First admin (setup)

The first admin is created via the **/setup** page in the browser when there are zero users in Airtable. No env token or curl is required. After the first admin exists, bootstrap is disabled and only **/login** is used.

## Airtable tables and fields (setup)

Single source of truth: **revenue_entries** (model earnings) and **expense_entries** (all expenses). **pnl_lines** is optional (monthly snapshot for model only).

### team_members (new table)

| Field | Type | Notes |
|-------|------|-------|
| name | Single line text (primary) | |
| role | Single select | chatter, chatting_manager, va, va_manager, marketing_manager, editor, other |
| department | Single select | chatting, marketing, production, ops |
| status | Single select | active, inactive |
| notes | Long text | optional |

### expense_entries

| Field | Type | Notes |
|-------|------|-------|
| expense_id or primary | — | optional primary field |
| month | Link to **months** (required) | |
| amount | Number/currency (required) | |
| category | Single select (required) | |
| department | Single select | models, chatting, marketing, production, ops |
| cost_owner_type | Single select | model, team_member, agency |
| model | Link to **models** | required when cost_owner_type = model |
| team_member | Link to **team_members** | required when cost_owner_type = team_member |
| description, vendor, date, created_by, receipt_url, created_at | — | optional |

### revenue_entries

| Field | Type | Notes |
|-------|------|-------|
| revenue_id or primary | — | optional |
| model | Link to **models** (required) | |
| month | Link to **months** (required) | |
| amount | Number (required) | |
| type | Single select | subscriptions, ppv, tips, referrals, other |
| description, date, created_by, created_at | — | optional |

### months, models

Existing. **months** must have `month_key` (e.g. `2025-01`). **models** must have `name`, `status`, etc.

## Summary

- **Required:** `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`, `SESSION_SECRET`
- **Optional:** `AIRTABLE_TABLE_*` (including `AIRTABLE_TABLE_TEAM_MEMBERS`, `AIRTABLE_TABLE_EXPENSE_ENTRIES`, `AIRTABLE_TABLE_REVENUE_ENTRIES`)
