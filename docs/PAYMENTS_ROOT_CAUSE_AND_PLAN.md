# Payments tab: root cause analysis and minimal plan

## 1. Existing Airtable tables (found in codebase)

| Table | Purpose | Key fields |
|-------|---------|------------|
| **monthly_member_basis** | Manual basis inputs for payouts | `month` (link), `team_member` (link), `department`, `basis_type`, `amount`, `amount_usd`, `amount_eur`, `notes` |
| **team_members** | Members (chatters, managers, production) | `name`, `role`, `department`, **`payout_type`**, **`payout_percentage`**, **`payout_flat_fee`**, `payout_frequency`, `chatting_percentage`, `gunzo_percentage` |
| **payout_runs** | One run per month | `month` (link), `status` (draft/locked/paid), `notes` |
| **payout_lines** | Computed output: one line per member per run | `payout_run`, `team_member`, `basis_webapp_amount`, `basis_manual_amount`, `bonus_amount`, `adjustments_amount`, `payout_amount`, `payout_percentage`, etc. |
| **months** | Month dimension | `month_key`, `month_name` |
| **agency_revenues** | Agency revenue per month (chatting/gunzo) | Used for manager/production payouts |

No separate “bonus” or “fine” tables exist. Bonuses and adjustments are stored in **monthly_member_basis** with `basis_type` = `'bonus'` or `'adjustment'`.

---

## 2. Member payout % (for chatters)

- **Field used in app:** `team_members.payout_percentage` (and `payout_type`, `payout_flat_fee`).
- **Where it’s read:**  
  - `app/api/payout-runs/compute/route.ts`: `const pct = Number(rec.fields.payout_percentage) || 0;`  
  - Compute formula for chatters: `payoutAmount = (basisTotal * pct) / 100 + bonusAmount - adjustmentsAmount`.
- **Conclusion:** Use **`payout_percentage`** on the team_member record for “base payout = gross_usd * member.payout_pct”.  
  There is no `commission_pct`; the app consistently uses **`payout_percentage`**.

---

## 3. Current payments behavior (root cause)

- **Data flow**
  - Payments page loads **monthly_member_basis** for selected month (GET `/api/monthly-basis?month_id=...`).
  - Tabs: “Chatter sales”, “Bonuses”, “Adjustments” filter by `basis_type`.
  - “Add entry” posts to POST `/api/monthly-basis` with `month_id`, `team_member_id`, `basis_type`, `amount` (EUR), `amount_usd`, `amount_eur`, `notes`. Amount is treated as EUR-first (MoneyInput baseCurrency eur).
  - Compute (POST `/api/payout-runs/compute?month_id=...`) reads all basis rows, groups by member:
    - `chatter_sales` → sum into `basisManual`
    - `bonus` → sum into `bonusAmount`
    - `adjustment` → sum into `adjustmentsAmount`
    - For chatters: `payout = (basisManual * payout_percentage/100) + bonusAmount - adjustmentsAmount`.
  - Payout lines are written to **payout_lines** (computed); they are not edited directly for input.

- **Why it’s “not correct”**
  1. **Gross USD not source of truth:** Requirements say “all amounts originate in USD gross”. Today the UI and API emphasize EUR (e.g. `amount`/`amount_eur` as primary, dual with USD). Compute uses `amount` (EUR) for basis.
  2. **No explicit “sales” record per (member, month):** Multiple `chatter_sales` rows per member/month are allowed; compute sums them. Requirement is one “sales” row per (member, month) with gross_usd, base payout, and optional bonus/fine/manual.
  3. **Bonus/fine semantics:** “Adjustment” is a single bucket (sum subtracted in compute). There is no separate “fine” type; fines could be stored as `basis_type = 'adjustment'` with positive amount. “Manual adjustment” (can be negative) is not distinguished; storing it would require negative amounts for some rows (currently validation is amount ≥ 0).
  4. **No per-row bonus/fine/manual on sales:** Base, bonus, fine, and manual are not on one record; they are separate basis rows. So the “unified monthly payout table” the user wants (one row per member/month with base + bonuses - fines + manual) has to be derived by aggregating basis rows and applying member `payout_percentage`.

---

## 4. Minimal plan using existing schema (no new tables)

Assumptions:

- **Do not add or change Airtable tables/fields.**
- Reuse **monthly_member_basis** for:
  - Chatter sales (one row per (member, month) with `basis_type = 'chatter_sales'`, store **gross_usd** in `amount_usd`; `amount`/`amount_eur` can be derived or stored for display).
  - Bonuses: `basis_type = 'bonus'`, `amount_usd` (+ optional `amount_eur`), `notes` = reason.
  - Fines: `basis_type = 'adjustment'`, positive `amount_usd`, `notes` = reason.
  - Manual adjustment: `basis_type = 'adjustment'`, `amount_usd` (positive or negative), `notes` e.g. “Manual adjustment” (and optionally allow negative in API for this type only).

### 4.1 Chatter sales (form A)

- **UI:** One “sales” record per (member, month): member select, month select, **Gross USD** (required).  
  Base payout = gross_usd × (member.`payout_percentage` / 100).  
  Overrides: bonus_usd, fine_usd, manual_adjustment_usd (defaults 0); final_payout = base + bonus - fine + manual.
- **Storage (no schema change):**
  - One **monthly_member_basis** row: `basis_type = 'chatter_sales'`, `amount_usd = gross_usd`, `amount`/`amount_eur` from FX at save (or leave to compute).
  - Bonus/fine/manual can be stored as:
    - **Option (a):** Separate basis rows: one `bonus` row with amount = bonus_usd, one or two `adjustment` rows (one for “fine” total, one for “manual” with signed amount). Then compute must stay as-is (sum bonus, sum adjustment) and we need to allow negative `amount_usd` for one of the adjustment rows, and compute logic: adjustments_amount = sum of “fine” rows only; manual_adjustment = sum of “manual” adjustment rows (could be one row with positive/negative). So we need a way to distinguish “fine” vs “manual” in the same table without new fields: e.g. notes convention (“Manual: …” vs “Fine: …”) and in compute we split by note prefix. That’s fragile.
  - **Option (b):** Keep single “sales” row per (member, month) and store bonus/fine/manual in **notes as JSON** (e.g. `PAYOUT_OVERRIDES:{"bonus_usd":10,"fine_usd":5,"manual_adjustment_usd":-2}`). No schema change; compute (or a new aggregation API) reads this and adds to the formula. Then we don’t need negative amount in API.
- **Recommendation:** Option (b): one chatter_sales row per (member, month) with `amount_usd = gross_usd`; overrides in notes as JSON. Compute (or a dedicated “payments summary” API) parses notes and computes final_payout = base + bonus_usd - fine_usd + manual_adjustment_usd. Display in “unified table” from this row + member.payout_percentage + parsed overrides.

### 4.2 Bonus form (B)

- **UI:** Member, month, amount_usd, reason. Creates **monthly_member_basis** with `basis_type = 'bonus'`, `amount_usd`, `notes` = reason. Edit/delete = PATCH/DELETE `/api/monthly-basis/[id]`. No schema change.

### 4.3 Fine form (C)

- **UI:** Member, month, amount_usd, reason. Creates **monthly_member_basis** with `basis_type = 'adjustment'`, `amount_usd` (positive), `notes` = reason (e.g. prefix “Fine: ”). Edit/delete same as bonus. No schema change.  
  If we later need to separate “manual adjustment” from “fine”, we can use notes convention (e.g. “Fine: …” vs “Manual: …”) and in aggregation treat only “Fine:” rows as fines and “Manual:” as manual_adjustment; or allow one “manual” adjustment row per (member, month) with amount that can be negative (API change: allow negative amount for basis_type `adjustment` when notes start with “Manual:”).

### 4.4 Unified monthly payout table (D)

- **Source of data:**  
  - GET monthly_member_basis for selected month (or range).  
  - GET team_members (for payout_percentage, name).  
  - Optional: GET `/api/fx/usd-eur` for EUR display.
- **Per (month, member):**
  - **Sales:** One row with `basis_type = 'chatter_sales'` → gross_usd = row.amount_usd, base_payout_usd = gross_usd × (member.payout_percentage / 100). Parse notes for PAYOUT_OVERRIDES → bonus_usd, fine_usd, manual_adjustment_usd.
  - **Bonuses:** Sum of rows with `basis_type = 'bonus'` for that (month, member).
  - **Fines:** Sum of rows with `basis_type = 'adjustment'` and notes not “Manual:” (or all adjustment rows if we don’t store manual in same table).
  - **Manual:** From PAYOUT_OVERRIDES on the sales row, or from one adjustment row with “Manual:” in notes (and allow negative amount).
  - **Final payout_usd** = base_payout_usd + total_bonus_usd - total_fine_usd + manual_adjustment_usd.
- **EUR:** Compute from USD using FX rate at display time (or follow existing “store EUR at save” if present elsewhere; current payments compute stores amount_eur in payout_lines but basis is stored with amount_usd/amount_eur in monthly_member_basis).

### 4.5 API shape (reuse + small extensions)

- **Existing:**  
  - `GET/POST /api/monthly-basis` (month_id, team_member_id, basis_type, amount, amount_usd, amount_eur, notes)  
  - `PATCH/DELETE /api/monthly-basis/[id]`
- **New or clarified:**  
  - **Sales:** Use POST monthly-basis with basis_type=chatter_sales, amount_usd=gross_usd; optional body field `overrides: { bonus_usd?, fine_usd?, manual_adjustment_usd? }` written into notes as JSON.  
  - **Bonuses:** POST with basis_type=bonus.  
  - **Fines:** POST with basis_type=adjustment, notes e.g. “Fine: &lt;reason&gt;”.  
  - **Unified table:** Either extend GET `/api/monthly-basis?month_id=...` to return aggregated view by (month, member) with base_payout, bonuses, fines, manual, final_payout, or add GET `/api/payments/summary?month_id=...` that does this aggregation (and uses team_members for payout_percentage).  

No new Airtable tables; optional new route for “payments summary” for the unified table.

---

## 5. What does not exist (and is not proposed as schema change)

- No **member_sales** table (e.g. member, month, gross_usd, manual_adjustment_usd).  
- No **member_adjustments** table (type bonus|fine, member, month, amount_usd, reason).  
- **Fines:** Handled as `basis_type = 'adjustment'` with positive amount and reason in notes.  
- **Manual adjustment:** Handled either in sales row notes (JSON overrides) or as one adjustment row with “Manual:” in notes and allowed negative amount in API for that case only.

---

## 6. Summary: tables and fields that already match

| Need | Existing | Notes |
|------|----------|--------|
| Chatter sales (gross USD per member/month) | **monthly_member_basis** with basis_type=chatter_sales | Store gross in **amount_usd**; enforce one row per (member, month) in app or allow multiple and sum. |
| Member payout % | **team_members.payout_percentage** | Used in compute; use for base_payout = gross_usd * pct/100. |
| Bonuses | **monthly_member_basis** with basis_type=bonus | amount_usd, notes=reason. |
| Fines | **monthly_member_basis** with basis_type=adjustment (positive amount) | notes=reason (e.g. “Fine: …”). |
| Manual adjustment | Notes JSON on sales row, or adjustment row with “Manual:” and negative allowed in API | No new field. |
| Months / members lists | **months**, **team_members** | Already used by payments page. |

No new Airtable tables or new fields are required for the minimal plan above.
