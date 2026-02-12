# Forecast & Weekly Stats — Current Behavior Spec

**Purpose:** Map exactly how "forecast" and weekly stats work today (no refactors). All references are to actual code paths and types.

---

## 1. Code paths involved

### 1.1 Weekly stats tab (model screen)

| Layer | File path | Notes |
|-------|-----------|--------|
| **Tab + container** | `app/(dashboard)/models/[modelId]/page.tsx` | Tab id `weekly_stats`, label "Weekly stats" (+ Beta badge). When active, renders `WeeklyStatsPanel` with `monthKey`, `months`, `monthId`, `weeks`, `stats`, `applyEntriesToMonthly`, `applyStatus`, `setApplyStatus`, `onEnsureForecast`, `forecasts`, etc. |
| **Panel UI** | `app/components/models/WeeklyStatsPanel.tsx` | Forecast PnlTable at top; month selector; "Apply to" (Actual/Forecast) + "Apply entries to monthly" button; weeks manager (add/edit/delete week); list of week rows with edit form or displayed stat. |

### 1.2 Week row editor (net/gross + USD input)

| Layer | File path | Notes |
|-------|-----------|--------|
| **Form component** | `app/components/models/WeeklyStatsPanel.tsx` — `WeeklyStatForm` (inline) | Revenue type &lt;select&gt; (Net/Gross), single USD &lt;input&gt;, EUR preview (from client FX fetch), Save/Cancel. No `status` or actual/forecast in the form. |
| **Save handler** | Same file, `WeeklyStatForm` → `handleSubmit` | Builds `body: { model_id, week_id, net_revenue? \| gross_revenue? }` (one of the two), then `fetch('/api/weekly-model-stats', { method: 'POST', body: JSON.stringify(body) })`. |
| **API** | `app/api/weekly-model-stats/route.ts` — `POST` | Validates `model_id`, `week_id`, one of `gross_revenue` or `net_revenue`. Gets FX rate (internal then external fallback), computes `amount_usd` and `amount_eur`. Calls `upsertWeeklyModelStats(model_id, week_id, { gross_revenue?, net_revenue?, amount_usd, amount_eur })`. |
| **Airtable** | `lib/airtable.ts` — `upsertWeeklyModelStats` | `getWeeklyStatByModelAndWeek` (model+week); then `updateRecord('weekly_model_stats', existing.id, payload)` or `createRecord('weekly_model_stats', payload)`. Payload: `model`, `week`, plus provided fields. |

**Important:** The week editor does **not** send or store any "actual" vs "forecast" flag. Table `weekly_model_stats` has **no status field** (see types: `WeeklyModelStatsRecord` has `model`, `week`, `gross_revenue`, `net_revenue`, `amount_usd`, `amount_eur`; computed fields exist in Airtable).

### 1.3 "Apply entries to monthly" action

| Layer | File path | Notes |
|-------|-----------|--------|
| **UI** | `app/components/models/WeeklyStatsPanel.tsx` (and `EntriesMonthBar` in same page) | Button "Apply entries to monthly". When in Weekly stats tab, `onClick={() => applyEntriesToMonthly?.(monthKey)}` — `monthKey` is the **currently selected month** in the Weekly stats month dropdown. |
| **Handler** | `app/(dashboard)/models/[modelId]/page.tsx` — `applyEntriesToMonthly(overrideMonthKey?)` | `monthKey = overrideMonthKey ?? selectedMonthOption?.month_key ?? ''`. Then `fetch(\`/api/models/${modelId}/apply-entries\`, { method: 'POST', body: JSON.stringify({ month_key: monthKey, status: applyStatus }) })`. So the **Apply to: Actual | Forecast** selector is `applyStatus` and is sent as `status`. |
| **API** | `app/api/models/[id]/apply-entries/route.ts` — `POST` | Body: `{ month_key: string, status: 'actual' \| 'forecast' }`. Builds `uniqueKey = \`${modelId}-${month_key}-${status}\``. Looks up **pnl_lines** by `getPnlByUniqueKey(uniqueKey)`. Loads **expense_entries** and **revenue_entries** for that `modelId` + `monthId` (month resolved from month_key). Sums expenses by category and revenue (gross). **Updates that pnl_lines record** with `updatedFields` (gross_revenue + expense category fields). Does **not** read or write `weekly_model_stats`. |

### 1.4 "Apply to: Actual / Forecast" selector

| Layer | File path | Notes |
|-------|-----------|--------|
| **UI** | `app/components/models/WeeklyStatsPanel.tsx` and `EntriesMonthBar` in `app/(dashboard)/models/[modelId]/page.tsx` | `SmartSelect` with `value={applyStatus}`, `onChange={setApplyStatus}`, options `[{ value: 'actual', label: 'Actual' }, { value: 'forecast', label: 'Forecast' }]`. Single shared state `applyStatus` for the whole model page. |
| **Effect** | Only when "Apply entries to monthly" is clicked | The chosen `applyStatus` is sent as `status` to `POST /api/models/[id]/apply-entries`. It selects **which pnl_lines row** to update: the one with that model + month_key + status (actual or forecast). |

---

## 2. Client fetch summary

| Action | URL | Method | Payload shape |
|--------|-----|--------|----------------|
| Load weeks for month | `/api/weeks?month_id={monthId}` | GET | — |
| Load weekly stats for model + month | `/api/weekly-model-stats?model_id={modelId}&month_id={monthId}` | GET | — |
| Save/update one week stat | `/api/weekly-model-stats` | POST | `{ model_id, week_id, gross_revenue? \| net_revenue? }` |
| Apply entries to monthly | `/api/models/{modelId}/apply-entries` | POST | `{ month_key: string, status: 'actual' \| 'forecast' }` |
| Ensure forecast rows | `/api/models/{modelId}/forecast` | POST | (no body) |
| Load PnL (actuals) | `/api/models/{modelId}/pnl?status=actual` | GET | — |
| Load PnL (forecasts) | `/api/models/{modelId}/pnl?status=forecast` | GET | — |

---

## 3. API → Airtable

| API route | Airtable table(s) | Read / Write | Key fields for actual vs forecast |
|-----------|--------------------|--------------|------------------------------------|
| `GET /api/weekly-model-stats` | `weeks` (via getWeeksOverlappingMonth), `weekly_model_stats` | R | **weekly_model_stats:** no status; identified by model + week. |
| `POST /api/weekly-model-stats` | `weekly_model_stats` | W (upsert) | Writes `model`, `week`, `gross_revenue`, `net_revenue`, `amount_usd`, `amount_eur`. No status. |
| `POST /api/models/[id]/apply-entries` | `pnl_lines`, `months`, `expense_entries`, `revenue_entries` | R: pnl_lines (by unique_key), months, expense_entries, revenue_entries. W: pnl_lines | **pnl_lines:** `status` = 'actual' \| 'forecast'; identity = model + month + status (`unique_key` formula). |
| `POST /api/models/[id]/forecast` | `settings`, `months`, `pnl_lines` | R: settings, months. W: pnl_lines (create) | Creates **pnl_lines** rows with `status: 'forecast'` for future months (from settings.forecast_months_ahead). |
| `GET /api/models/[id]/pnl?status=actual|forecast` | `pnl_lines`, `months`, `settings` | R | `getPnlForModel(modelId, status)` filters by `status`. |

---

## 4. Where forecast is stored

- **Forecast (and actual) monthly rows** live in **pnl_lines** only.
- **Same table:** both actual and forecast are `pnl_lines` rows.
- **Distinguished by:** `status` field: `'actual'` or `'forecast'`.
- **Identity:** `unique_key` (formula) = `model_id_lookup & "-" & month_key_lookup & "-" & status`. So one row per (model, month, status).
- **weekly_model_stats** is **separate**: per model per **week**. It has **no status**. It is not "forecast" or "actual" in the schema; it’s just weekly revenue data. The UI does not currently tag weekly stats as actual vs forecast.

---

## 5. Weeks ↔ months linkage and aggregation

- **Weeks overlapping a month:** `lib/airtable.ts` — `getWeeksOverlappingMonth(monthKey)`. Loads all weeks, filters in app: overlap when `week_start <= month_end AND week_end >= month_start`. Month range from `monthKeyToRange(monthKey)` (first day to last day of month).
- **Weekly stats for a month:** GET weekly-model-stats receives `month_id` (or month_key), resolves month_key, calls `getWeeksOverlappingMonth(month_key)`, gets `weekIds`, then `getWeeklyStatsByModelAndWeeks(model_id, weekIds)` which lists `weekly_model_stats` filtered by model and then filters in app to those whose `week` is in `weekIds`.
- **Aggregation (totals in Weekly stats tab):** Client-side: `totals = Object.values(stats).reduce((acc, s) => { acc.computed_gross_usd += s.computed_gross_usd; acc.computed_net_usd += s.computed_net_usd; acc.amount_eur += s.amount_eur; return acc; })`. So month total = sum of overlapping weeks’ computed_gross_usd, computed_net_usd, amount_eur.
- **Models overview “weekly projection”:** When a model has **no** pnl row in range, and `includeForecast` is true: load weeks overlapping **from_month_key** only, load `getWeeklyStatsForWeeks(weekIds)`, aggregate by model (sum net/gross, count), then `projectedRevenue = (sum / count) * 4` (expected weeks per month). So weekly stats are used only to **display** a projected revenue for models with no pnl row; they are **not** written into pnl_lines by any current flow.

---

## 6. What "Apply entries to monthly" does (exact behavior)

- **Data source:** **expense_entries** and **revenue_entries** for that **model + month** (month = record id from month_key). No weekly_model_stats involved.
- **Target:** The **pnl_lines** row for that model + month + **status** (actual or forecast), i.e. `uniqueKey = \`${modelId}-${month_key}-${status}\``.
- **Overwrite vs fill:** **Overwrites** only the fields it computes: `gross_revenue` (from sum of revenue_entries.amount) and each expense category in `ALLOWED_PNL_FOR_APPLY` (from expense_entries summed by category). Other pnl_fields (e.g. net_revenue, notes_issues) are **not** sent, so they are left as-is. So partial update by field, not “fill only if missing.”
- **Overlapping months:** N/A. apply-entries is per single month_key; it uses that month’s expense_entries and revenue_entries (linked to that month id). Weeks overlapping multiple months are not involved in this API.
- **Gross vs net:** It only sets **gross_revenue** on pnl_lines (from revenue_entries). It does **not** set net_revenue. Expense category fields are set from expense_entries.
- **EUR at apply time:** It does **not** compute or store any EUR. Only gross_revenue and expense sums (numbers). So no FX at apply time.

---

## 7. Sequence (bullet) flows

### 7.1 Open Weekly stats tab, pick month, see weeks + stats

1. **UI:** `app/(dashboard)/models/[modelId]/page.tsx` — activeTab === 'weekly_stats' → render WeeklyStatsPanel; `monthId` = weeklyStatsMonthId, `monthKey` from months list.
2. **UI:** `loadWeeklyStats()` runs (useEffect): `fetch(/api/weeks?month_id=...)`, `fetch(/api/weekly-model-stats?model_id=...&month_id=...)`.
3. **API GET /api/weeks:** `app/api/weeks/route.ts` → getMonths (resolve month_key), getWeeksOverlappingMonth(month_key) → **Airtable:** list records `weeks`, filter in app by date overlap.
4. **API GET /api/weekly-model-stats:** `app/api/weekly-model-stats/route.ts` → getWeeksOverlappingMonth, getWeeklyStatsByModelAndWeeks(model_id, weekIds) → **Airtable:** list `weekly_model_stats` filtered by model, filter in app by weekIds.
5. **UI:** setWeeklyWeeks(weeks), setWeeklyStats(stats). Panel shows week rows and totals.

### 7.2 Edit week: set Net revenue (USD), Save

1. **UI:** `WeeklyStatsPanel.tsx` — `WeeklyStatForm` handleSubmit: body = `{ model_id, week_id, net_revenue }`, POST `/api/weekly-model-stats`.
2. **API POST /api/weekly-model-stats:** Validates body; gets FX rate (origin FX API then external fallback); amount_usd = net_revenue; amount_eur = convertUsdToEur(amount_usd, rate); upsertWeeklyModelStats(model_id, week_id, { net_revenue, amount_usd, amount_eur }).
3. **Airtable:** getWeeklyStatByModelAndWeek (read); then updateRecord or createRecord on **weekly_model_stats** with model, week, net_revenue, amount_usd, amount_eur.
4. **UI:** onSave(record) → setWeeklyStats(prev => ({ ...prev, [week_id]: record })); setEditingWeekId(null).

### 7.3 Apply entries to monthly (Apply to: Forecast)

1. **UI:** User chose "Forecast" in Apply to; clicks "Apply entries to monthly". `applyEntriesToMonthly(monthKey)` with monthKey = selected month in Weekly stats panel. POST `/api/models/{modelId}/apply-entries`, body `{ month_key, status: 'forecast' }`.
2. **API POST /api/models/[id]/apply-entries:** getPnlByUniqueKey(\`${modelId}-${month_key}-forecast\`) → **Airtable:** pnl_lines by unique_key. If missing → 404. getMonths → find monthId for month_key. listExpenseEntries(modelId, monthId), listRevenueEntries(modelId, monthId) → **Airtable:** expense_entries, revenue_entries. Sum by category and gross; build updatedFields; updateRecord('pnl_lines', recordId, updatedFields).
3. **UI:** load(); toast; after 4s clear toast.

### 7.4 Ensure forecast (button in Weekly stats)

1. **UI:** `ensureForecast()` → POST `/api/models/{modelId}/forecast` (no body).
2. **API POST /api/models/[id]/forecast:** ensureForecastForModel(modelId) → getSettings (forecast_months_ahead), getMonths, for each future month (month_key > current) createRecord('pnl_lines', { model, month, status: 'forecast' }) if not exists.
3. **Airtable:** create pnl_lines rows with status = 'forecast'.
4. **UI:** load(); setForecastResult({ created, skipped }).

---

## 8. Inconsistencies / bugs noted

1. **weekly_model_stats has no actual/forecast:** All weekly stats are stored without a status. The "Apply to: Actual | Forecast" selector only affects **apply-entries** (which pnl_lines row to update), not where weekly data is written. So weekly stats are effectively "untyped" with respect to actual vs forecast; if you later wanted to "apply weekly to monthly forecast," you’d need a separate flow that reads weekly_model_stats and writes into pnl_lines (forecast).
2. **Apply entries does not use weekly stats:** "Apply entries to monthly" only pushes **expense_entries** and **revenue_entries** into pnl_lines. It never reads weekly_model_stats. So the label "Apply entries to monthly" is accurate (entries → monthly); it is not "apply weekly stats to monthly."
3. **EUR in weekly stats:** Now fixed (API persists amount_eur with FX fallback). No inconsistency left there.
4. **Overview weekly projection uses only from_month:** When includeForecast is true, getWeeksOverlappingMonth is called with `from_month_key` only, so weekly projection is for the first month in the range only, not the whole range.
5. **apply-entries does not set net_revenue:** Only gross_revenue and expense fields are written. If pnl_lines has a formula for net_revenue, Airtable may still show it; otherwise it could be stale.

---

## 9. Smallest possible change plan (after agreeing on spec)

- **If goal is “apply weekly stats into monthly forecast (or actual)”:** Add a new API (e.g. `POST /api/models/[id]/apply-weekly-to-monthly`) that: takes `month_key` + `status`; gets weeks overlapping that month; gets weekly_model_stats for that model + those weeks; aggregates (e.g. sum computed_net_usd or gross); finds pnl_lines by model+month_key+status; updates that row’s gross_revenue (and optionally net_revenue) from the aggregated weekly data. No schema change; weekly_model_stats stays without status unless we later add an optional field.
- **If goal is “tag weekly stats as actual vs forecast”:** Add optional `status` (or `apply_to`) to weekly_model_stats schema and to write path (week editor save + any new apply-weekly API), and filter reads by status where needed. This would be a schema change (new field).
- **If goal is only to clarify UI:** Add copy in Weekly stats panel: e.g. "Apply entries to monthly" subtext: "Copies expense and revenue entries for the selected month into the chosen Actual or Forecast row. Does not use weekly stats above." No backend change.

All of the above are minimal and edge-safe; build remains valid.
