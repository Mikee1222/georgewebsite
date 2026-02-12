# FX + Currency Consistency & Cloudflare Pages Audit

## Summary

- **Single source of truth**: `/api/fx/usd-eur` (Frankfurter API, then `FX_FALLBACK_RATE` env, then 0.92). Client uses `useFxRate()` (payments, models, team, RevenueEntriesSection, ExpenseEntriesSection) or `useFxUsdEur()` (CeoToolsCard only). Server-side uses `getFxRateDirect()` or `getFxRateForServer(origin)`.
- **Historical correctness**: On save, all write paths use `ensureDualAmounts(usd, eur, fx_at_save)` and persist both; stored values are never recomputed on read. Live display uses client `useFxRate()` for secondary conversion only where needed.
- **Marketing vs Chatting**: Marketing expenses/payroll are separate from chatting; no merging of categories or aggregation logic.

---

## Files Changed (Diffs Applied)

### 1. `app/api/fx/usd-eur/route.ts`
- **Issue**: `runtime = 'nodejs'` incompatible with Cloudflare Workers; response cached 5–10 min; `next.revalidate` on upstream fetch.
- **Fix**: `runtime = 'edge'`; removed in-memory cache (stateless workers); `Cache-Control: private, no-store, no-cache`; upstream fetch with `cache: 'no-store'`; error fallback uses 0.92 (no stale cache reference).

### 2. `app/hooks/useFxRate.ts`
- **Issue**: Fetch could be cached by browser/CDN.
- **Fix**: `fetch('/api/fx/usd-eur', { credentials: 'include', cache: 'no-store' })`.

### 3. `lib/hooks/useFxUsdEur.ts`
- **Issue**: Same as above.
- **Fix**: `fetch(..., { credentials: 'include', cache: 'no-store' })`.

### 4. `app/api/models/[id]/earnings/route.ts`
- **Issue**: No `runtime = 'edge'` (next-on-pages requirement).
- **Fix**: `export const runtime = 'edge';`.

### 5. `app/layout.tsx`
- **Fix**: `export const runtime = 'edge';` so all app routes (including metadata) run on edge.

### 6. `app/(dashboard)/layout.tsx`
- **Fix**: `export const runtime = 'edge';` for dashboard segment.

### 7. `app/icon.svg` → `public/icon.svg`
- **Issue**: Next treated `app/icon.svg` as a non-edge route.
- **Fix**: Moved to `public/icon.svg`; deleted `app/icon.svg`. Metadata already references `/icon.svg`, served as static asset.

---

## Files Audited (No Changes Required)

| Area | Finding |
|------|--------|
| **FX source** | All pages use `useFxRate()` or get `fx_rate` from API response; no hardcoded rates in UI except fallback 0.92 when API fails or record has no rate. |
| **Caching** | FX API now sends `no-store`; client fetches with `cache: 'no-store'`. |
| **Live display** | Payments, models overview/model PnL, agency, chatting payroll, expense sections all use `useFxRate()` or server-provided `fx_rate`. |
| **Historical** | monthly-basis, expenses, payout save-computed all use `getFxRateDirect()` or `getFxRateForServer()` at save; `ensureDualAmounts` + `round2`; stored `amount_eur`/`amount_usd` shown as-is; live conversion only for secondary display. |
| **expense_entries** | Create uses `getFxRateDirect()` + `ensureDualAmounts`; salary auto-expense (payout-lines [id]) stores both `amount_usd` and `amount_eur` with `round2`. |
| **Payouts** | `payout-compute` uses single `fxRate` per run; tiered-deal uses `fxRateUsdEur`; salary_usd/salary_eur used correctly; save-computed persists `amount_eur`/`amount_usd` from computed lines. |
| **Rounding** | `lib/fx.ts` `round2` used at display and in `ensureDualAmounts`; payout-compute uses `round2` for conversions. |
| **Edge/runtime** | No `fs`/Node-only crypto in API routes; all use `fetch` and `process.env`; FX route switched to edge. |
| **Logs** | `payout-compute` and API `console.log`/`console.warn` are behind `process.env.NODE_ENV === 'development'`; no production log changes. |

---

## Acceptable Fallbacks (No Change)

- **lib/fx.ts** `getFxRateDirect()`: fallback 0.92 when Frankfurter and `FX_FALLBACK_RATE` fail.
- **app/(dashboard)/marketing/page.tsx**: initial state and API fallback 0.92 when `/api/payouts` does not return `fx_rate` (API does return it).
- **app/api/marketing-payroll/route.ts**: `rate = fxRate > 0 ? fxRate : 0.92` when `getFxRateDirect()` returns 0.
- **app/components/models/WeeklyStatsPanel.tsx**: `f?.fx_rate_usd_eur ?? 0.92` for stored forecast row display when record has no rate.

---

## Build

- **Script**: `npm run build:pages` (not `build:cloudflare` in package.json).
- **Result**: Build completes successfully with `@cloudflare/next-on-pages`.

---

## Manual Verification Checklist After Deploy

1. **FX freshness**: Open Payments (or any page with EUR/USD). Refresh; open Network tab, call `/api/fx/usd-eur` and confirm `Cache-Control: private, no-store, no-cache` (or equivalent) and response changes when rate changes.
2. **Payments**: Select a month, ensure payout preview shows; check that USD and EUR amounts use the same rate; add a bonus/fine and confirm amounts and totals.
3. **Model overview + PnL**: Open a model, Overview tab; confirm Total expenses / Net revenue / Profit and secondary EUR or USD line use live rate; switch to Earnings/Expenses/Profit tabs and confirm numbers and conversions.
4. **Agency master**: Open Agency; confirm revenue/expenses/payout totals and any USD↔EUR secondary display use consistent rate.
5. **Chatting payroll**: Open Chatting payroll; confirm chatter rows and totals (USD/EUR) match expected rate.
6. **Expenses**: Create an expense (model or team_member); confirm stored `amount_usd` and `amount_eur` in Airtable match `fx_at_save`; on list/detail, confirm primary display is stored values; any “live” conversion is secondary.
7. **Payout save**: Run “Compute & save” for a month; confirm payout_lines in Airtable have both `amount_usd` and `amount_eur`; reload Payments and confirm saved run shows same amounts (no recomputation).
8. **Salary auto-expense**: Mark a Salary model payout line as Paid; confirm one expense_entries row with category “salary”, negative amount, and both amount_eur and amount_usd set.
9. **Marketing vs Chatting**: Confirm Marketing page shows only marketing/production departments and categories; Chatting shows chatting payroll; no mixed aggregation.
10. **Production logs**: In production, confirm no `[payout-compute]` or other verbose debug logs in console/worker logs; only essential error logs if any.
