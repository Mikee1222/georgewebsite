# Agency master – data lineage

**Scope:** Agency master page when **Data source = PnL lines** (default).  
**Page:** `app/(dashboard)/agency/page.tsx`  
**API:** `GET /api/agency?from={YYYY-MM}&to={YYYY-MM}&payouts_mode=owed|paid&payouts_source=live|locked`

---

## 1) Page and API routes

| Item | Path / URL |
|------|------------|
| Page component | `app/(dashboard)/agency/page.tsx` |
| Grid (table) | `app/components/AgencyGrid.tsx` |
| Client fetch | `apiFetch<AgencyMasterResponse>(url)` from `@/lib/client-fetch` |
| **PnL view (default)** | `GET /api/agency?from=&to=&payouts_mode=&payouts_source=` |
| Entries view (optional) | `GET /api/agency/entries?from_month_id=&to_month_id=&department=` |

Month range is selected via **From** / **To** dropdowns (month_id); the app resolves to `month_key` (YYYY-MM) and sends `from` and `to` as **month_key** in the query string.

---

## 2) Data lineage: top cards (PnL view)

| UI card | API field | Source of truth | Airtable | FX |
|---------|-----------|-----------------|----------|-----|
| **Revenue** (USD / EUR) | `totals.revenue_usd` / `totals.revenue_eur` | USD | **pnl_lines**: `net_revenue` (or computed from `gross_revenue` − OF fee via settings). Summed per model then across models. | EUR = USD × fx rate (server `getFxRateDirect`) |
| **Expenses** (USD / EUR) | `totals.expenses_usd` / `totals.expenses_eur` | USD | **expense_entries**: `amount_usd`; if 0, use `amount_eur / fx_rate`. Fields: `model`, `amount_usd`, `amount_eur`, `amount`. Filter: month in range (by month_id). | EUR = USD × fx rate |
| **Profit** (USD / EUR) | `totals.profit_usd` / `totals.profit_eur` | USD | Computed: revenue_usd − expenses_usd (per model, then summed). | EUR = USD × fx rate |
| **Margin** | `totals.margin_pct` | — | Computed: `sum(profit_usd) / sum(revenue_usd)` (totals). | — |
| **Total payouts** (USD / EUR) | `totals.payout_usd` / `totals.payout_eur` | USD | **payout_lines**: `final_payout_usd` or `amount_usd`; if 0, `final_payout_eur` or `amount_eur` → USD via /fx_rate. Lines filtered by **payout_runs** in month range; then by **payouts_source** (live vs locked) and **payouts_mode** (owed vs paid). | EUR = USD × fx rate |
| **Net after payouts** (USD / EUR) | `totals.net_after_payouts_usd` / `totals.net_after_payouts_eur` | USD | Computed: profit_usd − payout_usd (per model, then summed). | EUR = USD × fx rate |

---

## 3) Data lineage: table columns (AgencyGrid)

| Column | Row field | Source of truth | Airtable / logic | FX |
|--------|-----------|-----------------|------------------|-----|
| **Model** | `model_name` | — | **models** table `name` (lookup by model_id from pnl_lines / expense_entries / payout_lines). | — |
| **Revenue** | `revenue_usd` / `revenue_eur` | USD | **pnl_lines** `net_revenue` (see rawToPnlRow). Grouped by `model_id` (and month_key for display). | EUR = USD × fx rate |
| **Expenses** | `expenses_usd` / `expenses_eur` | USD | **expense_entries** `amount_usd` (fallback amount_eur→USD). Grouped by `model`. | EUR = USD × fx rate |
| **Profit** | `profit_usd` / `profit_eur` | USD | revenue_usd − expenses_usd per model. | EUR = USD × fx rate |
| **Margin %** | `profit_margin_pct` | — | profit_usd / revenue_usd per model (0 if no revenue). | — |
| **Payouts** | `payout_usd` / `payout_eur` | USD | **payout_lines** `final_payout_usd` or `amount_usd` (fallback EUR→USD). Grouped by `model` or team_member (resolved to row key). | EUR = USD × fx rate |
| **Net after payouts** | `net_after_payouts_usd` / `net_after_payouts_eur` | USD | profit_usd − payout_usd per model. | EUR = USD × fx rate |
| **Mkt costs** | `total_marketing_costs` | — | **pnl_lines**: `ads_spend` + `other_marketing_costs` (rawToPnlRow). Summed per model. | Display only (EUR-style display) |
| **Chatting** | `chatting_costs_team` | — | **pnl_lines** `chatting_costs_team`. | Display only |
| **Mkt team** | `marketing_costs_team` | — | **pnl_lines** `marketing_costs_team`. | Display only |
| **Production** | `production_costs_team` | — | **pnl_lines** `production_costs_team`. | Display only |
| **Ads spend** | `ads_spend` | — | **pnl_lines** `ads_spend`. | Display only |

---

## 4) Airtable tables and filters (PnL view)

| Table | Fields used | Filter / logic |
|-------|-------------|----------------|
| **pnl_lines** | `model`, `month`, `month_key_lookup`, `status`, `gross_revenue`, `net_revenue`, `chatting_costs_team`, `marketing_costs_team`, `production_costs_team`, `ads_spend`, `other_marketing_costs`, (+ salary, affiliate_fee, bonuses, etc. for total_expenses in rawToPnlRow) | `filterByFormula`: `ARRAYJOIN({month_key_lookup},"") >= from` AND `<= to` AND `{status}="actual"`. |
| **expense_entries** | `model`, `amount_usd`, `amount_eur`, `amount` | Fetched per month_id in range. `getMonthRecordIdsInRange(from_month_key, to_month_key)` → list **expense_entries** per month with `month` link = month_id. |
| **payout_runs** | `month`, `status` | All runs; then filter where `month` in month_ids from `getMonthRecordIdsInRange(from, to)`. |
| **payout_lines** | `payout_run`, `model`, `team_member`, `final_payout_usd`, `amount_usd`, `final_payout_eur`, `amount_eur` | All lines (max 1000); keep only where `payout_run[0]` in runIds. runIds: if **payouts_source=locked** → runs with status locked|paid; if **payouts_mode=paid** → runs with status paid. |
| **months** | `month_key`, `month_name` | Full list; used for month_key→month_name and for range resolution (month_key >= from && <= to). |
| **models** | `name` | Full list; used for model_id → model_name. |
| **settings** | `setting_name`, `value` | Used for OF fee % (net_revenue fallback) in rawToPnlRow. |
| **team_members** | `name`, `member_id` | Used to resolve payout_lines without model to a display row (team_member name). |

**Month range:** Inputs are **month_key** (YYYY-MM) `from` and `to`. Resolved via **months** table: all records where `month_key >= from` and `month_key <= to`; their ids are used for expense_entries (month link) and payout_runs (month link).

**Model grouping:** Rows are keyed by **model_id** (from pnl_lines, expense_entries, or payout_lines). Payout lines without model use team_member and are keyed by a resolved row key (see team-member-resolve).

**FX:** Single rate per request from **getFxRateDirect()** (lib/fx). USD is source of truth; EUR is display-only (convertUsdToEur).

---

## 5) Debug: requestId and lineage in response

- **requestId:** Generated at start of GET (uuid), included in response JSON and in `request-id` response header.
- **Server log (one block per request):** In development, a single structured log object is written: requestId, month range (from/to), resolved month_ids count, tables queried + record counts, computed totals (revenue_usd, expenses_usd, payout_usd, profit_usd, margin_pct), fx source and rate, source_of_truth: 'usd'.
- **Optional `debug=1`:** If the query string contains `debug=1`, the response JSON includes a `debug` object with the same lineage info (no secrets). Use for verifying sources in browser or API clients.

**Payout source:**

- **payouts_source=live:** Payouts are computed on the fly (same logic as Payments → Preview): `computeLivePayoutsInRange(from, to, fxRate)` uses `computePreviewPayouts` per month (pnl_lines net_revenue for models, monthly_member_basis + agency revenue % for chatters/managers/VAs). No payout_runs or payout_lines are read. Totals should match Payments page Preview for the same month range.
- **payouts_source=locked:** Payouts come from payout_lines linked to payout_runs in range (filtered by run status and mode owed/paid).

**How to trigger and verify:**

1. Open the Agency master page: e.g. `http://localhost:3000/agency` (or your app URL).
2. Select **From** and **To** months (PnL lines view is default). Set **Payouts** to Owed and **Source** to **Live**.
3. The page calls `GET /api/agency?from=YYYY-MM&to=YYYY-MM&payouts_mode=owed&payouts_source=live`.
4. **Terminal:** In the server (Next.js) terminal you should see `[api/agency] payouts_source=live` with requestId, payout_path, computed_items, total_payout_usd, then `[api/agency] lineage` with payout_source, payout_path, payout_computed_items, payout_total_usd.
5. **Compare with Payments preview:** Open **Payments**, same month (or same range by checking each month in range). Source = Live (Preview). Sum the preview totals across those months; Agency master **Total payouts** (with Source = Live and same From/To) should match.
6. **Response with lineage in body:** Call the API with `&debug=1`. The JSON response will include `requestId` and `debug` with lineage (including payout_source, payout_path, and either payout_computed_items/payout_total_usd or payout_lines_count).
