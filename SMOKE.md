# Smoke checklist (Chrome + Safari)

Run locally: `npm run start` (after `npm run build`). Use this list to verify the app is 100% functional.

## Pre-flight
- [ ] **Lint + build**: `npm run lint` then `npm run build` (or `npm run quality`) — no errors.
- [ ] **Chrome**: Open app; UI is styled (no raw HTML). No console errors (no 400 on `/_next/static/*`, no ChunkLoadError).
- [ ] **Safari**: Same — styled, no console errors.

## Auth & navigation
- [ ] **Login**: Open `/login` in Chrome and Safari. Page is styled (premium card, inputs). Sign in works; redirect to `/models`.
- [ ] **Models**: Sidebar shows models; clicking a model loads the model page.

## Model page
- [ ] **PnL**: Actuals and Forecast tables load; numbers and layout look correct.
- [ ] **Month selector**: "Entries for month" dropdown lists months from PnL. If no PnL rows, helper text: "Create pnl line first or ensure forecast."

## Expense entries
- [ ] **Select month**: Choose a month. Expense entries section shows entries for that month (or empty state).
- [ ] **Add expense**: "Add expense" is disabled when no month selected. With month selected, open Add expense → fill category, amount → submit. Entry appears in UI and in Airtable `expense_entries` (month = link to months).
- [ ] No "month_id, category, and amount required" when month is selected and form is filled.

## Revenue entries
- [ ] **Select month**: Revenue entries section shows entries for selected month (or "Create pnl line first or select a month above" when no month).
- [ ] **Add revenue**: With month selected, Add revenue → type, amount, description → submit. Entry appears in UI and in Airtable `revenue_entries` (model + month links).
- [ ] **Edit/delete**: Inline edit amount/description; delete with confirm. Viewer sees read-only (no add/edit/delete).

## Apply entries
- [ ] **Single apply**: One bar: "Entries for month" + "Apply to" (Actual/Forecast) + "Apply entries to monthly". Click applies both revenue + expenses to PnL.
- [ ] **Success**: Toast: "Applied: N expenses, M gross revenue"; PnL and entries refetch.
- [ ] **No entries**: Toast warning: "No entries to apply for this month."
- [ ] **No PnL row**: Toast error: "No PnL row for this month/status. Create forecast or add actual row first."

## Agency & export
- [ ] **Agency**: `/agency` loads; month range filters data. Export CSV uses URL `/api/export/agency?from=...&to=...` (no `.csv` in path). Download has filename via Content-Disposition (e.g. `agency-YYYY-MM-YYYY-MM.csv`).
- [ ] **Model export**: Model page "Export CSV" downloads model PnL CSV.

## Quality gate commands
```bash
npm run lint        # or npm run lint:ci for CI (max-warnings 0)
npm run build      # must pass
npm run start      # then run through this checklist in Chrome and Safari
```
Single command that runs lint + build: `npm run quality`.
