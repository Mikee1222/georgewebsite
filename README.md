# Agency Financial OS

Next.js 14 app (App Router), edge runtime, Airtable backend. Deployed on Cloudflare Pages via `@cloudflare/next-on-pages`.

## How to use dashboards

- **/agency** — Agency executive dashboard. Choose month range (from/to). View source: **Entries** (aggregated from expense_entries + revenue_entries) or **PnL** (from pnl_lines). KPIs, charts (revenue vs expenses, by department, by category), top cost owners and category breakdown. Use **GET /api/agency/overview?from=YYYY-MM&to=YYYY-MM** for executive overview (totals, byMonth, topModels, topCostOwners).

- **/models** — Models executive overview. Select a **month** (default: latest). KPIs: total model revenue, expenses, profit, avg margin. Table: all models with revenue, expenses, profit, margin, status; sortable and searchable. Click a row to open **/models/[modelId]**.

- **/models/[modelId]** — Model detail. Tabs: **Overview** (PnL actuals + forecast), **Earnings** (revenue entries + apply to monthly), **Expenses** (expense entries + apply to monthly), **Profit** (charts). Use month selector and “Apply entries to monthly” to push entries into pnl_lines.

- **/chatting** — Chatting payroll. Select **month**. Table of expense entries (department = chatting, cost owner = team member). Filters: role, member. **Add expense** (enabled when a month is selected): member, category, amount; creates record with `month_id`, `department=chatting`, `cost_owner_type=team_member`.

- **/marketing** — Marketing & production payroll. Toggle: **Marketing only** / **Production only** / **Combined**. Select **month**. Table and filters. **Add expense** (enabled when a month is selected): department (marketing or production), member, category, amount; body always includes `month_id`.

All add-expense flows require a selected month; the API expects `month_id` (Airtable months record id). Disable add expense when no month is selected; show helper text: "Select a month above to enable add expense." In dev, payloads are logged to the console before POST.
