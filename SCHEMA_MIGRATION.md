# Schema Migration (Phase 0)

This document lists **current** tables and fields referenced in the codebase, maps them to the **locked Airtable schema**, and enumerates API routes and UI components to update. No code changes until this doc is approved.

**Non‑negotiable rules (from requirements):**
1. **Users:** Do NOT remove auth fields. Keep: `password_hash`, `password_salt`, `allowed_model_ids`, `last_login_at` (even if not shown in UI). Do not change auth flow unless explicitly asked.
2. **Months:** Do NOT delete the `months` table. UI is date‑range based, but the system keeps stable period buckets. `pnl_lines` remains monthly snapshots with period boundaries; `weekly_stats` uses `week_start`; `payout_runs` uses `period_start`/`period_end`. Keep `months` for consistency; phase‑out later if needed.
3. **Models UI:** `/models` = executive overview dashboard (KPIs + sortable table + click to open model). `/models/[modelId]` = model profile with tabs: overview, earnings, expenses, payouts, forecast.

---

## 1. Current tables and fields (referenced in code)

### 1.1 `settings`
| Field            | Type    | Referenced in code |
|------------------|---------|--------------------|
| setting_name     | string  | Yes (key for lookup) |
| value            | number  | Yes |
| description      | string? | Optional |

**Used by:** `lib/airtable.ts` (getSettings, cache), `lib/business-rules.ts`, `app/api/settings/route.ts`, `app/api/models/overview/route.ts`, `app/api/models/[id]/pnl/route.ts`, `app/api/models/[id]/forecast/route.ts`, `app/api/models/[id]/apply-entries/route.ts`, bootstrap.

---

### 1.2 `models`
| Field              | Type    | Referenced in code |
|--------------------|---------|--------------------|
| name               | string  | Yes |
| status             | string  | Yes (Active \| Inactive \| On Hold) |
| compensation_type  | string  | Yes (Salary \| Percentage \| Hybrid) |
| creator_payout_pct | number? | Yes |
| notes              | string? | Yes |
| created_date       | string? | Optional |

**Used by:** `lib/airtable.ts`, `lib/types.ts`, `app/api/models/route.ts`, `app/api/models/[id]/route.ts`, overview, team-members (link), expense/revenue links.

---

### 1.3 `months`
| Field       | Type    | Referenced in code |
|-------------|---------|--------------------|
| month_key   | string  | Yes (YYYY-MM, sort/filter) |
| month_name  | string? | Yes (display) |
| year        | number? | Optional |
| month_number| number? | Optional |
| is_future   | bool?   | Optional |

**Used by:** `lib/airtable.ts` (getMonths, ensureForecastForModel, listExpenses month_ids), `app/api/months/route.ts`, `app/api/models/overview/route.ts`, `app/api/models/[id]/pnl/route.ts`, `app/api/models/[id]/apply-entries/route.ts`, `app/api/agency/overview/route.ts`, `app/api/team-members/[id]/expenses/route.ts`, all month-selector UIs (chatting, marketing, models, ExpenseEntriesSection, members, team).

---

### 1.4 `pnl_lines`
| Field                  | Type    | Referenced in code |
|------------------------|---------|--------------------|
| model                  | link[]  | Yes (→ models) |
| month                  | link[]  | Yes (→ months) |
| status                 | string  | Yes (actual \| forecast) |
| unique_key             | formula | Yes (identity: model-month-status) |
| model_id_lookup        | lookup  | Yes (filter/sort) |
| month_key_lookup       | lookup  | Yes (filter/sort) |
| creator_payout_pct     | number? | Yes |
| gross_revenue          | number? | Yes |
| chatting_costs_team    | number? | Yes |
| marketing_costs_team    | number? | Yes |
| production_costs_team   | number? | Yes |
| ads_spend              | number? | Yes |
| other_marketing_costs   | number? | Yes |
| salary                 | number? | Yes |
| affiliate_fee          | number? | Yes |
| bonuses                | number? | Yes |
| airbnbs                | number? | Yes |
| softwares              | number? | Yes |
| fx_withdrawal_fees     | number? | Yes |
| other_costs            | number? | Yes |
| notes_issues           | string? | Yes |

**Used by:** `lib/airtable.ts`, `lib/types.ts` (PnlLinesRecordRaw, PNL_INPUT_FIELDS), `lib/business-rules.ts` (rawToPnlRow, computeTotalExpenses), `app/api/models/[id]/pnl/route.ts`, `app/api/models/[id]/apply-entries/route.ts`, `app/api/models/[id]/apply-revenue/route.ts`, `app/api/models/overview/route.ts`, `app/api/pnl/[recordId]/route.ts`, `app/api/agency/overview/route.ts`.

---

### 1.5 `users`
| Field             | Type    | Referenced in code |
|-------------------|---------|--------------------|
| email             | string  | Yes (login, list) |
| role              | string  | Yes (admin \| finance \| viewer) |
| is_active         | boolean | Yes |
| password_hash     | string  | Yes (login) |
| password_salt     | string  | Yes (login) |
| allowed_model_ids | string  | Yes (comma‑separated; RBAC) |
| last_login_at     | string? | Yes (post‑login update) |
| created_at        | string? | Optional (API response) |

**Used by:** `lib/airtable.ts`, `lib/auth.ts` (session uses role + allowed_model_ids), `app/api/auth/login/route.ts`, `app/api/users/route.ts`, `app/api/users/[id]/route.ts`, `app/api/me/route.ts`, team hub Users tab (add user: password_hash/salt).

---

### 1.6 `team_members`
| Field        | Type    | Referenced in code |
|--------------|---------|--------------------|
| name         | string  | Yes |
| email        | string? | Yes |
| role         | string  | Yes (chatter, chatting_manager, va, …) |
| department   | string  | Yes (chatting, marketing, production, ops) |
| status       | string  | Yes (active \| inactive) |
| notes        | string? | Yes |
| monthly_cost | number? | Yes |
| model        | link[]  | Yes (→ models, optional) |

**Used by:** `lib/airtable.ts`, `lib/types.ts`, `app/api/team-members/route.ts`, `app/api/team-members/[id]/route.ts`, `app/api/team-members/[id]/expenses/route.ts`, `app/api/team-members/[id]/timeline/route.ts`, team page, members page, chatting/marketing filters.

---

### 1.7 `expense_entries`
| Field           | Type    | Referenced in code |
|-----------------|---------|--------------------|
| month           | link[]  | Yes (→ months) |
| amount          | number  | Yes |
| category        | string  | Yes |
| department      | string  | Yes (models \| chatting \| marketing \| production \| ops) |
| cost_owner_type | string  | Yes (model \| team_member \| agency) |
| model           | link[]? | Yes |
| team_member     | link[]? | Yes |
| description     | string? | Yes |
| vendor          | string? | Yes |
| date            | string? | Yes |
| created_by      | string? | Yes |
| receipt_url     | string? | Yes |
| created_at      | string? | Optional |

**Used by:** `lib/airtable.ts`, `lib/types.ts`, `app/api/expenses/route.ts`, `app/api/expenses/[recordId]/route.ts`, `app/api/models/[id]/expenses/route.ts`, `app/api/models/[id]/apply-entries/route.ts`, `app/api/team-members/[id]/expenses/route.ts`, `app/api/agency/overview/route.ts`, `app/api/agency/entries/route.ts`, `app/api/agency/summary/route.ts`, ExpenseEntriesSection, chatting page, marketing page, members/[id] page.

---

### 1.8 `revenue_entries`
| Field       | Type    | Referenced in code |
|-------------|---------|--------------------|
| model       | link[]  | Yes (→ models) |
| month       | link[]  | Yes (→ months) |
| type        | string  | Yes |
| amount      | number  | Yes |
| description | string? | Yes |
| date        | string? | Yes |
| created_by  | string? | Yes |
| created_at  | string? | Optional |

**Used by:** `lib/airtable.ts`, `lib/types.ts`, `app/api/revenue/route.ts`, `app/api/revenue/[recordId]/route.ts`, `app/api/models/[id]/revenue/route.ts`, `app/api/models/[id]/apply-revenue/route.ts`, model profile revenue tab.

---

### 1.9 `audit_log`
| Field      | Type   | Referenced in code |
|------------|--------|--------------------|
| timestamp  | string | Yes |
| user       | string | Yes |
| table      | string | Yes |
| record_id  | string | Yes |
| field_name | string | Yes |
| old_value  | string | Yes |
| new_value  | string | Yes |
| model_name | string?| Yes |

**Used by:** `lib/airtable.ts` (writeAuditLog), multiple API routes on create/update (users, team-members, expenses, revenue, pnl, models).

---

## 2. Locked Airtable schema (target)

Tables to align with (from requirements):

- **models**
- **weekly_stats** (not yet in code; use `week_start` for weekly data)
- **pnl_lines** (monthly snapshots; keep period boundaries; can add period_start/period_end later)
- **expense_entries**
- **team_members**
- **users**
- **payout_rules** (not yet in code)
- **payout_runs** (period_start, period_end; not yet in code)
- **payout_lines** (not yet in code)
- **settings**
- **audit_log**
- **months** (kept for consistency; phase‑out later)

**Not in locked list:** `revenue_entries`. Either retain if the base already has it, or later derive revenue from `weekly_stats` when that table is wired in.

---

## 3. Exact mapping: current code → Airtable fields

| Table            | Current code fields (exact) | Airtable (use as‑is / note) |
|------------------|-----------------------------|------------------------------|
| **settings**    | setting_name, value, description | Same. No change. |
| **models**       | name, status, compensation_type, creator_payout_pct, notes, created_date | Same. No change. |
| **months**       | month_key, month_name, year, month_number, is_future | **Keep.** Same. Used for period buckets; UI can stay date‑range. |
| **pnl_lines**    | model, month, status, unique_key, model_id_lookup, month_key_lookup, creator_payout_pct, gross_revenue, chatting_costs_team, marketing_costs_team, production_costs_team, ads_spend, other_marketing_costs, salary, affiliate_fee, bonuses, airbnbs, softwares, fx_withdrawal_fees, other_costs, notes_issues | Same. Monthly snapshots; boundaries can stay month link or add period_start/period_end later. |
| **users**        | email, role, is_active, **password_hash, password_salt, allowed_model_ids, last_login_at**, created_at | **Keep all.** No removal of auth fields. |
| **team_members** | name, email, role, department, status, notes, monthly_cost, model | Same. (Diagnostics list has `is_active` but code uses `status`; keep code as status.) |
| **expense_entries** | month, amount, category, department, cost_owner_type, model, team_member, description, vendor, date, created_by, receipt_url, created_at | Same. |
| **revenue_entries** | model, month, type, amount, description, date, created_by, created_at | **Retain** if base has it; else document as “future: derive from weekly_stats”. |
| **audit_log**    | timestamp, user, table, record_id, field_name, old_value, new_value, model_name | Same. |

**New tables (no code yet):**  
`weekly_stats` (week_start, …), `payout_rules`, `payout_runs` (period_start, period_end), `payout_lines` — add when implementing those features.

---

## 4. API routes to update (by phase)

Only when adding new schema (e.g. weekly_stats, payouts) or renaming fields; current field set stays.

- **lib/airtable.ts** — Table keys, `tableName()` defaults, all CRUD and list helpers. Add `weekly_stats` / payout_* when needed; do not remove months or user auth fields.
- **lib/types.ts** — Keep all current record types; add types for weekly_stats, payout_* when implemented.
- **lib/business-rules.ts** — Uses pnl_lines fields only; no change unless pnl_lines gains period_start/period_end.

**Routes that read/write Airtable (for reference; no changes until Phase 1+):**

| Route | Tables used | Notes |
|-------|-------------|--------|
| GET/POST /api/settings | settings | |
| GET/POST/PATCH/DELETE /api/models, /api/models/[id] | models | |
| GET /api/months | months | Keep. |
| GET /api/models/overview | models, months, pnl_lines, settings | month_key param. |
| GET /api/models/[id]/pnl | pnl_lines, months, settings | |
| GET /api/models/[id]/expenses | expense_entries | month_id param. |
| GET/POST /api/models/[id]/expenses | expense_entries | |
| GET/POST /api/models/[id]/revenue | revenue_entries | |
| POST /api/models/[id]/apply-entries | expense_entries, pnl_lines, months | |
| POST /api/models/[id]/apply-revenue | revenue_entries, pnl_lines, months | |
| GET /api/models/[id]/forecast | pnl_lines, months, settings | |
| GET/PATCH /api/pnl/[recordId] | pnl_lines | |
| GET/POST /api/expenses | expense_entries | month_id, month_ids, department, owner_type, model_id, team_member_id. |
| GET/PATCH/DELETE /api/expenses/[recordId] | expense_entries | |
| GET/POST /api/revenue | revenue_entries | |
| GET/PATCH/DELETE /api/revenue/[recordId] | revenue_entries | |
| GET /api/agency/overview | months, pnl_lines, expense_entries, models | |
| GET /api/agency/entries | expense_entries | |
| GET /api/agency/summary | expense_entries | |
| GET /api/team-members | team_members | |
| GET/PATCH/DELETE /api/team-members/[id] | team_members | |
| GET/POST /api/team-members/[id]/expenses | expense_entries, months, team_members | |
| GET /api/team-members/[id]/timeline | expense_entries, months | |
| GET/POST /api/users | users | Keep auth fields. |
| GET/PATCH /api/users/[id] | users | Keep auth fields; do not expose password_* in response. |
| POST /api/auth/login | users (getUserByEmail, updateUserLastLogin) | password_hash, password_salt, role, allowed_model_ids, last_login_at. |
| GET /api/me | users | |
| GET /api/dev/diagnostics | months, models, team_members, expense_entries, revenue_entries | Fix team_members required list: use `status` not `is_active` if that matches code. |

---

## 5. UI components / pages to update (when schema or API changes)

- **app/(dashboard)/models/page.tsx** — Executive overview; month filter; uses `/api/models/overview`, `/api/months`. Date‑range later; keep month_key for now if API unchanged.
- **app/(dashboard)/models/[id]/page.tsx** — Model profile tabs (overview, earnings, expenses, payouts, forecast). Uses pnl, expenses, revenue, months.
- **app/(dashboard)/team/page.tsx** — Users (password_hash/salt in add form), team members, mapping helpers. Uses users, team_members, models, months.
- **app/(dashboard)/members/page.tsx** — Members list; uses team_members.
- **app/(dashboard)/members/[id]/page.tsx** — Member detail; expenses by month/range; uses team_members, expenses, months.
- **app/(dashboard)/chatting/page.tsx** — Department=chatting expenses; month filter; uses expenses, months, team_members.
- **app/(dashboard)/marketing/page.tsx** — Marketing/production expenses; month filter; uses expenses, months.
- **app/components/ExpenseEntriesSection.tsx** — Model expenses; month select; add/edit expense. Uses model expenses API, months.
- **app/components/members/MemberExpenseTable.tsx** — month_key, month_name.
- **app/components/members/MemberCharts.tsx** — month_key, by‑month aggregation.

When adding date‑range UI: keep calling months (or period_start/period_end) for stable buckets; only change how the user picks range (e.g. from_month_key, to_month_key or date range → month list).

---

## 6. Phase 1+ order (after this doc is approved)

1. **Phase 1 (backend, small commits):**  
   - No schema renames; ensure types and airtable helpers match the tables/fields above.  
   - Fix dev/diagnostics REQUIRED_FIELDS for team_members (`status` not `is_active`) if desired.  
   - After each commit: `npm run lint`, `npm run build`.

2. Later phases: add `weekly_stats`, payout_* tables and routes; optionally add period_start/period_end to pnl_lines; date‑range UI (still backed by months or explicit period boundaries).

---

*End of Phase 0 document. No code changes until approved.*
