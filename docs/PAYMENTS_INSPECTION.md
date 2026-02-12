# Payments – Step 0: Inspection (from code only)

## Current payments page and API routes

| Location | Purpose |
|----------|--------|
| **app/(dashboard)/payments/page.tsx** | Single payments page: month selector, agency revenue, manual basis tabs (Chatter sales / Bonuses / Adjustments), compute payouts, run selector, payout lines table |
| **app/api/monthly-basis/route.ts** | GET (list by month_id, team_member_id), POST (create one basis row) |
| **app/api/monthly-basis/[id]/route.ts** | PATCH (update amount, amount_usd, amount_eur, notes), DELETE |
| **app/api/payout-runs/route.ts** | GET list of runs by month_id |
| **app/api/payout-runs/[runId]/route.ts** | GET run + lines, PATCH status |
| **app/api/payout-runs/compute/route.ts** | POST compute payouts for month, write payout_lines |

## Airtable tables used for chatter payments (from lib/airtable.ts)

Table names are resolved via `tableName(key)` with env overrides. Literal defaults:

| Key | Default table name | Env override |
|-----|--------------------|--------------|
| monthly_member_basis | `monthly_member_basis` | AIRTABLE_TABLE_MONTHLY_MEMBER_BASIS |
| team_members | `team_members` | AIRTABLE_TABLE_TEAM_MEMBERS |
| months | `months` | (no override in defaults) |
| payout_runs | `payout_runs` | AIRTABLE_TABLE_PAYOUT_RUNS |
| payout_lines | `payout_lines` | AIRTABLE_TABLE_PAYOUT_LINES |

## Fields (from ALLOWED_KEYS_BY_TABLE and create/update helpers)

**monthly_member_basis** (allowed write keys; do not add created_by—field does not exist in Airtable):

- `month` (link)
- `team_member` (link)
- `department`
- `basis_type`
- `amount`
- `amount_usd`
- `amount_eur`
- `notes`

**basis_type** (from lib/types.ts MonthlyBasisType): `'chatter_sales' | 'bonus' | 'adjustment'`.  
No `'fine'` value; fines are stored as **basis_type = 'adjustment'** with notes prefix **"FINE: "** (convention, no schema change).

**team_members** (payout-related, from getTeamMember / createTeamMember / compute):

- `payout_type`, `payout_percentage`, `payout_flat_fee`, `payout_frequency`, `chatting_percentage`, `gunzo_percentage`

Member payout % for chatters: **payout_percentage** (used in compute: `pct = rec.fields.payout_percentage`).

## Summary

- **Chatter sales:** `monthly_member_basis` with `basis_type = 'chatter_sales'`. Store gross in **amount_usd** (and optionally amount/amount_eur). Payout % from **team_members.payout_percentage**; override per entry via notes convention (e.g. `PCT:15\n` + notes).
- **Bonuses:** same table, `basis_type = 'bonus'`, amount_usd, notes = reason.
- **Fines:** same table, `basis_type = 'adjustment'`, amount_usd (positive), notes = `"FINE: " + reason`. No new table or new enum value required.

## Schema change (only if required later)

**No Airtable schema change was made.** If you want an explicit **fine** type in Airtable: add **"fine"** as a new option to the **basis_type** single-select field on **monthly_member_basis**. Then use `basis_type = 'fine'` instead of adjustment + "FINE: " prefix. Until then, the app uses the convention above with zero schema change.

---

## Implementation summary (payments fix)

- **API**  
  - **POST /api/monthly-basis:** For `basis_type: 'chatter_sales'` requires `gross_usd`; accepts `payout_pct` (stored in notes as `PCT:15\n...`). Upsert: one sales record per (month, member). For bonus: `reason` required (stored in notes). For fine: `basis_type: 'adjustment'`, `reason` required, notes stored as `FINE: <reason>`.  
  - **GET /api/monthly-basis:** Response includes `payout_pct` for chatter_sales rows (parsed from notes).  
  - **PATCH /api/monthly-basis/[id]:** Accepts `gross_usd` (or `amount_usd`), `payout_pct` (for sales, merged into notes), `notes`, `reason` (for bonus/fine via notes).  
- **Compute**  
  - Uses `amount_usd` when present for all basis types; chatters’ payout is computed in USD then converted to EUR for payout_lines.  
- **Payments page**  
  - Three forms: Chatter sales (member, month, gross_usd, payout_pct, notes; live base_payout_usd + EUR preview), Bonus (member, month, amount_usd, reason, notes), Fine (member, month, amount_usd, reason).  
  - Three tables with Edit/Delete.  
  - Payout summary table: member, month, gross_usd, payout_pct, base_payout_usd, bonus_total, fine_total, final_payout_usd (= base + bonus − fine).
