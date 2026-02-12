/**
 * Tiered (cliff) deal: when model has deal_threshold set, payout = flat under threshold,
 * rev * (percent/100) above. Otherwise fallback to compensation_type logic.
 * All revenue/payout use net_revenue as base. Pure helpers, no side effects. No rounding.
 */

import type { ModelsRecord } from '@/lib/types';

export interface TieredDealParams {
  /** Net revenue (base for threshold and %). */
  revenue: number;
  threshold: number;
  flat: number;
  percent: number;
}

/**
 * Compute payout for tiered deal. Revenue must be net_revenue.
 * - rev <= threshold → payout = flat
 * - rev > threshold → payout = rev * (percent / 100)
 * Payout >= 0, exact (no rounding).
 */
export function computeTieredDeal(params: TieredDealParams): number {
  const { revenue, threshold, flat, percent } = params;
  if (!Number.isFinite(revenue) || revenue < 0) return 0;
  if (!Number.isFinite(threshold) || threshold <= 0) return 0;
  const flatVal = Number.isFinite(flat) ? flat : 0;
  const pctVal = Number.isFinite(percent) ? percent : 0;
  let payout: number;
  if (revenue <= threshold) {
    payout = flatVal;
  } else {
    payout = revenue * (pctVal / 100);
  }
  return Math.max(0, payout);
}

/**
 * Whether the model has valid tiered-deal fields: threshold (USD), at least one flat (EUR or USD), and percent.
 */
export function hasValidTieredDeal(model: Partial<ModelsRecord> | null | undefined): boolean {
  if (!model) return false;
  const threshold = model.deal_threshold;
  if (threshold == null || !Number.isFinite(threshold) || threshold <= 0) return false;
  const flatEur = model.deal_flat_under_threshold;
  const flatUsd = model.deal_flat_under_threshold_usd;
  const hasFlat = (flatEur != null && Number.isFinite(flatEur) && flatEur >= 0) || (flatUsd != null && Number.isFinite(flatUsd) && flatUsd >= 0);
  const percent = model.deal_percent_above_threshold;
  if (!hasFlat || percent == null || !Number.isFinite(percent)) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[tiered-deal] deal_threshold set but flat (EUR/USD) or deal_percent_above_threshold missing/invalid; falling back to payout_type');
    }
    return false;
  }
  return true;
}

/**
 * Model payout for the month: tiered deal first (when valid), else compensation_type (Percentage / Salary / Hybrid).
 * Revenue must be pnl_lines net_revenue (not gross). Payout is returned in USD; caller converts to EUR via fx.
 * For Salary/Hybrid: uses salary_usd when set; else derives USD from salary_eur using fxRate (fallback for legacy records).
 */
export function getModelPayoutAmount(
  revenue: number,
  model: Partial<ModelsRecord> | null | undefined,
  fxRateUsdEur?: number | null
): number {
  if (!Number.isFinite(revenue) || revenue < 0) return 0;
  if (model && hasValidTieredDeal(model)) {
    const m = model;
    const flatUsd =
      m.deal_flat_under_threshold_usd != null && Number.isFinite(m.deal_flat_under_threshold_usd)
        ? m.deal_flat_under_threshold_usd
        : m.deal_flat_under_threshold != null &&
            Number.isFinite(m.deal_flat_under_threshold) &&
            fxRateUsdEur != null &&
            fxRateUsdEur > 0
          ? m.deal_flat_under_threshold / fxRateUsdEur
          : 0;
    return computeTieredDeal({
      revenue,
      threshold: m.deal_threshold!,
      flat: flatUsd,
      percent: m.deal_percent_above_threshold!,
    });
  }
  const comp = model?.compensation_type;
  const pct = model?.creator_payout_pct;
  const salaryEur = model?.salary_eur;
  const salaryUsd = model?.salary_usd;
  const salaryUsdResolved =
    salaryUsd != null && Number.isFinite(salaryUsd)
      ? salaryUsd
      : salaryEur != null && Number.isFinite(salaryEur) && fxRateUsdEur != null && fxRateUsdEur > 0
        ? salaryEur / fxRateUsdEur
        : 0;
  if (comp === 'Percentage' && pct != null && Number.isFinite(pct)) {
    return Math.max(0, revenue * (pct / 100));
  }
  if (comp === 'Salary') {
    return Math.max(0, salaryUsdResolved);
  }
  if (comp === 'Hybrid') {
    const pctPart = pct != null && Number.isFinite(pct) ? revenue * (pct / 100) : 0;
    return Math.max(0, pctPart + salaryUsdResolved);
  }
  return 0;
}
