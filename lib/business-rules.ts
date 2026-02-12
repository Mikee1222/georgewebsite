import type { SettingsMap } from './types';
import type { PnlRow, PnlLinesRecordRaw } from './types';

const DEFAULT_OF_FEE_PCT = 0.2;
const DEFAULT_GREEN = 0.3;
const DEFAULT_YELLOW_LOW = 0.15;

export function getOfFeePct(settings: Partial<SettingsMap> | null): number {
  return settings?.of_fee_pct ?? DEFAULT_OF_FEE_PCT;
}

export function computeOfFee(grossRevenue: number, settings: Partial<SettingsMap> | null): number {
  return grossRevenue * getOfFeePct(settings);
}

export function computeNetRevenue(grossRevenue: number, ofFee: number): number {
  return grossRevenue - ofFee;
}

export function computeTotalMarketingCosts(adsSpend: number, otherMarketingCosts: number): number {
  return adsSpend + otherMarketingCosts;
}

export function computeTotalExpenses(fields: {
  chatting_costs_team?: number;
  marketing_costs_team?: number;
  production_costs_team?: number;
  ads_spend?: number;
  other_marketing_costs?: number;
  salary?: number;
  affiliate_fee?: number;
  bonuses?: number;
  airbnbs?: number;
  softwares?: number;
  fx_withdrawal_fees?: number;
  other_costs?: number;
}): number {
  return (
    (fields.chatting_costs_team ?? 0) +
    (fields.marketing_costs_team ?? 0) +
    (fields.production_costs_team ?? 0) +
    (fields.ads_spend ?? 0) +
    (fields.other_marketing_costs ?? 0) +
    (fields.salary ?? 0) +
    (fields.affiliate_fee ?? 0) +
    (fields.bonuses ?? 0) +
    (fields.airbnbs ?? 0) +
    (fields.softwares ?? 0) +
    (fields.fx_withdrawal_fees ?? 0) +
    (fields.other_costs ?? 0)
  );
}

export function computeNetProfit(netRevenue: number, totalExpenses: number): number {
  return netRevenue - totalExpenses;
}

export function computeProfitMarginPct(netProfit: number, netRevenue: number): number {
  if (netRevenue == null || netRevenue === 0) return 0;
  return netProfit / netRevenue;
}

/** Build full PnlRow from raw Airtable record + settings. Model/month from link fields; month_key from lookup. */
export function rawToPnlRow(
  rec: { id: string; fields: PnlLinesRecordRaw },
  settings: Partial<SettingsMap> | null,
  monthName?: string
): PnlRow {
  const g = rec.fields.gross_revenue ?? 0;
  const ofFee = computeOfFee(g, settings);
  const storedNet = rec.fields.net_revenue;
  const netRev =
    typeof storedNet === 'number' && Number.isFinite(storedNet) ? storedNet : computeNetRevenue(g, ofFee);
  const ads = rec.fields.ads_spend ?? 0;
  const otherM = rec.fields.other_marketing_costs ?? 0;
  const totalMkt = computeTotalMarketingCosts(ads, otherM);
  const totalExp = computeTotalExpenses(rec.fields);
  const netProfit = computeNetProfit(netRev, totalExp);
  const margin = computeProfitMarginPct(netProfit, netRev);

  const monthKeyLookup = rec.fields.month_key_lookup;
  const month_key =
    typeof monthKeyLookup === 'string'
      ? monthKeyLookup
      : Array.isArray(monthKeyLookup) && monthKeyLookup[0] != null
        ? String(monthKeyLookup[0])
        : '';

  return {
    id: rec.id,
    model_id: rec.fields.model?.[0] ?? '',
    month_key,
    month_id: rec.fields.month?.[0],
    status: rec.fields.status ?? 'actual',
    month_name: monthName,
    gross_revenue: g,
    of_fee: ofFee,
    net_revenue: netRev,
    chatting_costs_team: rec.fields.chatting_costs_team ?? 0,
    marketing_costs_team: rec.fields.marketing_costs_team ?? 0,
    production_costs_team: rec.fields.production_costs_team ?? 0,
    ads_spend: ads,
    other_marketing_costs: otherM,
    total_marketing_costs: totalMkt,
    salary: rec.fields.salary ?? 0,
    creator_payout_pct: rec.fields.creator_payout_pct,
    affiliate_fee: rec.fields.affiliate_fee ?? 0,
    bonuses: rec.fields.bonuses ?? 0,
    airbnbs: rec.fields.airbnbs ?? 0,
    softwares: rec.fields.softwares ?? 0,
    fx_withdrawal_fees: rec.fields.fx_withdrawal_fees ?? 0,
    other_costs: rec.fields.other_costs ?? 0,
    total_expenses: totalExp,
    net_profit: netProfit,
    profit_margin_pct: margin,
    notes_issues: rec.fields.notes_issues ?? '',
  };
}

export function getMarginColor(
  margin: number,
  settings: Partial<SettingsMap> | null
): 'green' | 'yellow' | 'red' {
  const green = settings?.green_threshold ?? DEFAULT_GREEN;
  const yellowLow = settings?.yellow_threshold_low ?? DEFAULT_YELLOW_LOW;
  if (margin > green) return 'green';
  if (margin >= yellowLow) return 'yellow';
  return 'red';
}
