# Weekly Stats Implementation — Inventory

## Step 1: File paths to change

| Step | File path | Purpose |
|------|-----------|---------|
| 1 | `lib/airtable.ts` | Add console.log for Airtable field keys (weeks, weekly_model_stats) |
| 2 | `app/api/weeks/route.ts` | GET /api/weeks?month_id=… — overlapping weeks, derive week_key in code |
| 3 | `app/api/weekly-model-stats/route.ts` | GET + POST — upsert, FX snapshot, sample in response |
| 4 | `app/(dashboard)/models/[modelId]/page.tsx` | Weekly stats panel, default month |

## Airtable field keys (read/write)

### weeks table (READ only — no writes)
- **Read**: `week_start`, `week_end` (also `id` for record id)
- **Ignore**: `week_key` (Airtable formula #error) — derive in app from week_start + week_end
- **Not used for this feature**: `week_id`, `months`, `weekly_model_stats`

### weekly_model_stats table (READ + WRITE)
- **Read**: `model`, `week`, `gross_revenue`, `net_revenue`, `amount_usd`, `amount_eur`
- **Write**: `model`, `week`, `gross_revenue`, `net_revenue`, `amount_usd`, `amount_eur`
