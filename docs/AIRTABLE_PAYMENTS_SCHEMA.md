# Airtable schema: Payments / Payouts

Minimal schema for monthly basis inputs and payout runs. Create these tables in your base (or use env `AIRTABLE_TABLE_*` to point to existing table names).

## 1) monthly_member_basis

One row per month per member per basis type (manual inputs for payouts).

| Field         | Type        | Notes                          |
|---------------|-------------|--------------------------------|
| month         | Link → months | Required                     |
| team_member   | Link → team_members | Required               |
| basis_type    | Single select | Required. Options: `chatter_sales`, `manager_sales`, `production_sales`, `bonus`, `adjustment` |
| amount        | Number      | Required                        |
| currency      | Single select | `eur`, `usd` (default eur)   |
| notes         | Long text   | Optional                        |
| created_at    | Created time | Optional (auto)               |

Do **not** add or use `created_by` on this table—the app never writes or reads it.

## 2) payout_runs

Run metadata (one per compute).

| Field       | Type        | Notes                    |
|-------------|-------------|--------------------------|
| month       | Link → months | Required               |
| period_start| Text        | e.g. month_key           |
| period_end  | Text        | e.g. month_key           |
| status      | Single select | `draft`, `locked`, `paid` |
| notes       | Long text   | Optional                  |
| created_by  | Text        | Optional                  |
| created_at  | Created time | Optional (auto)         |

## 3) payout_lines

One row per team member per run (computed payouts).

| Field               | Type        | Notes                          |
|---------------------|-------------|--------------------------------|
| payout_run          | Link → payout_runs | Required                   |
| team_member         | Link → team_members | Required                  |
| department          | Single select | chatting, marketing, production, ops |
| role                | Text        | Optional                        |
| payout_type         | Single select | percentage, flat_fee, hybrid, none |
| payout_percentage   | Number      | Optional                        |
| payout_flat_fee     | Number      | Optional                        |
| basis_webapp_amount | Number      | From pnl_lines / webapp         |
| basis_manual_amount | Number     | From monthly_member_basis       |
| bonus_amount        | Number      | From monthly_member_basis bonus |
| adjustments_amount  | Number      | From monthly_member_basis adjustment |
| basis_total         | Number      | basis_webapp + basis_manual     |
| payout_amount       | Number      | Required (final amount)         |
| currency            | Single select | eur, usd                     |
| breakdown_json      | Long text   | Optional (formula used)         |

## 4) team_members (additions)

Ensure these fields exist (already started in repo):

| Field              | Type        | Notes                                    |
|--------------------|-------------|------------------------------------------|
| payout_type        | Single select | percentage, flat_fee, hybrid, none     |
| payout_percentage  | Number      | Default 10 for chatters                   |
| payout_flat_fee    | Number      | Optional                                  |
| payout_frequency   | Single select | weekly, monthly (default monthly)     |
| models_scope      | Link to models | Optional (for webapp basis only)      |
| include_webapp_basis | Checkbox   | Optional; for chatters, default off       |

## Env (optional)

- `AIRTABLE_TABLE_MONTHLY_MEMBER_BASIS` – default `monthly_member_basis`
- `AIRTABLE_TABLE_PAYOUT_RUNS` – default `payout_runs`
- `AIRTABLE_TABLE_PAYOUT_LINES` – default `payout_lines`
