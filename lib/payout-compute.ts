/**
 * Payout preview computation: same logic as compute route but no Airtable writes.
 * Returns computed lines for ALL team members (chatters, managers, VAs, models).
 * Used by GET /api/payout-runs/preview and by POST /api/payout-runs/compute (then we write).
 */

import {
  getRecord,
  getMonthRecordIdsInRange,
  listTeamMembers,
  listMonthlyMemberBasis,
  getAgencyRevenuesForMonth,
  getModels,
  getPnlInRange,
  isHourlyBasisRecord,
  listAffiliateModelDeals,
  toAffiliateModelDeal,
  getMonths,
} from '@/lib/airtable';
import { convertEurToUsd, convertUsdToEur } from '@/lib/fx';
import type { MonthsRecord } from '@/lib/types';
import type { PayoutType } from '@/lib/types';
import { getPayoutCategory, categoryForTab } from '@/lib/payout-tabs';
import { getModelPayoutAmount } from '@/lib/tiered-deal';
import type { PayoutTabId } from '@/lib/payout-tabs';
import { PAYOUT_TAB_IDS } from '@/lib/payout-tabs';
import type { PayoutCategory } from '@/lib/payout-tabs';

export type { PayoutCategory, PayoutTabId };

/** Agency revenue numbers for one month (EUR). Used for manager/VA percentage payout. */
export type AgencyRevenueForPct = {
  chatting_amount_eur?: number | null;
  gunzo_amount_eur?: number | null;
  chatting_msgs_tips_net_eur?: number | null;
  gunzo_msgs_tips_net_eur?: number | null;
};

/** Member fields needed for percentage payout (chatting/gunzo %). */
export type MemberPctFields = {
  chatting_percentage?: number;
  gunzo_percentage?: number;
  chatting_percentage_messages_tips?: number;
  gunzo_percentage_messages_tips?: number;
};

/**
 * Compute manager/VA percentage payout EUR for one member from agency revenues.
 * Same formula as in computePreviewPayouts: chattingTotalNet*chattingPct + chattingMsgsTips*chattingPctMsgs + gunzoTotalNet*gunzoPct + gunzoMsgsTips*gunzoPctMsgs.
 * Respects that member may have either agency_total_net % or messages_tips_net % (do not double-count).
 */
export function computeManagerPctPayoutEur(revenue: AgencyRevenueForPct | null, member: MemberPctFields): number {
  if (!revenue) return 0;
  const chattingTotalNetEur = revenue.chatting_amount_eur ?? 0;
  const gunzoTotalNetEur = revenue.gunzo_amount_eur ?? 0;
  const chattingMsgsTipsNetEur = revenue.chatting_msgs_tips_net_eur ?? 0;
  const gunzoMsgsTipsNetEur = revenue.gunzo_msgs_tips_net_eur ?? 0;
  const chattingPct = Number(member.chatting_percentage) || 0;
  const chattingPctMsgs = Number(member.chatting_percentage_messages_tips) || 0;
  const gunzoPct = Number(member.gunzo_percentage) || 0;
  const gunzoPctMsgs = Number(member.gunzo_percentage_messages_tips) || 0;
  const chattingPartEur = (chattingTotalNetEur * chattingPct) / 100;
  const chattingMsgsPartEur = (chattingMsgsTipsNetEur * chattingPctMsgs) / 100;
  const gunzoPartEur = (gunzoTotalNetEur * gunzoPct) / 100;
  const gunzoMsgsPartEur = (gunzoMsgsTipsNetEur * gunzoPctMsgs) / 100;
  return chattingPartEur + chattingMsgsPartEur + gunzoPartEur + gunzoMsgsPartEur;
}

type BasisType = 'chatter_sales' | 'bonus' | 'adjustment' | 'fine';

function isChatterPayout(role: string, _department: string): boolean {
  return (role ?? '').toLowerCase() === 'chatter';
}

/** Line shape for preview and for upsert (minus id/team_member_name). Includes category for tab filtering. */
export interface PayoutPreviewLine {
  id: string;
  team_member_id: string;
  team_member_name: string;
  /** Payee team_member id for payment methods; for models = linked team_member, else same as team_member_id. */
  payee_team_member_id?: string;
  department: string;
  role: string;
  /** Tab bucket: chatters | managers | vas | models */
  category: PayoutCategory;
  payout_type: string;
  payout_percentage?: number;
  payout_flat_fee?: number;
  basis_webapp_amount: number;
  basis_manual_amount: number;
  bonus_amount: number;
  adjustments_amount: number;
  basis_total: number;
  payout_amount: number;
  amount_eur: number | null;
  amount_usd: number | null;
  currency: string;
  breakdown_json?: string;
  /** Bonus in EUR (for display on department pages). */
  bonus_eur?: number | null;
  /** Adjustments/fines in EUR (for display on department pages). */
  adjustments_eur?: number | null;
  /** Hourly portion in EUR (for display on department pages). */
  hourly_eur?: number | null;
  /** Manager/VA % of agency revenue (EUR). Not set for chatters. TODO: plug in when percent-based payout is wired. */
  pct_payout_eur?: number | null;
}

/** Preview result shape: lines plus byTab for UI. Optional debug when requested. */
export interface PayoutPreviewResult {
  lines: PayoutPreviewLine[];
  month_key: string;
  byTab: Record<PayoutTabId, PayoutPreviewLine[]>;
  debug?: {
    affiliateDealsCount: number;
    matchedModelsCount: number;
    affiliatePayoutTotalUsd: number;
  };
}

/**
 * Compute payout lines for the given month for ALL team members.
 * Does NOT write to Airtable. Returns lines + byTab for UI (Chatters | Managers | VAs | Models | Affiliates).
 */
export async function computePreviewPayouts(
  monthId: string,
  fxRate: number | null,
  options?: { debug?: boolean }
): Promise<PayoutPreviewResult> {
  const monthRec = await getRecord<MonthsRecord>('months', monthId);
  if (!monthRec) throw new Error('Month not found');
  const month_key = monthRec.fields.month_key ?? '';
  if (!month_key) throw new Error('Month has no month_key');

  const [allMembers, basisRecords, agencyRevenues, models, pnlInMonth, affiliateDealsRaw, months] = await Promise.all([
    listTeamMembers(),
    listMonthlyMemberBasis({ month_id: monthId, month_key }),
    getAgencyRevenuesForMonth(monthId),
    getModels(),
    getPnlInRange(month_key, month_key, { status: 'actual' }),
    listAffiliateModelDeals(),
    getMonths(),
  ]);

  const pnlByModelId: Record<string, { gross_revenue: number; net_revenue: number }> = {};
  for (const p of pnlInMonth ?? []) {
    const mid = p.fields.model?.[0] ?? '';
    if (!mid) continue;
    const gross = typeof p.fields.gross_revenue === 'number' ? p.fields.gross_revenue : 0;
    const net = typeof p.fields.net_revenue === 'number' ? p.fields.net_revenue : 0;
    if (!pnlByModelId[mid]) pnlByModelId[mid] = { gross_revenue: 0, net_revenue: 0 };
    pnlByModelId[mid].gross_revenue += gross;
    pnlByModelId[mid].net_revenue += net;
  }

  const teamMemberIdsSet = new Set((allMembers ?? []).map((r) => r.id));
  const invalidTeamMemberIdsInBasis: string[] = [];

  if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
    console.log('[payout-compute] preview inputs', {
      month_id: monthId,
      month_key,
      membersCount: allMembers.length,
      basisRecordsCount: basisRecords.length,
      basisRowsWithoutTeamMember: basisRecords.filter((r) => !r.fields.team_member?.[0]).length,
      modelsCount: models?.length ?? 0,
      pnlRowsInMonth: pnlInMonth?.length ?? 0,
    });
  }

  const basisByMember: Record<string, { chatter_sales: number; bonus: number; adjustment: number }> = {};
  for (const r of basisRecords) {
    if (isHourlyBasisRecord(r)) continue;
    const tmId = r.fields.team_member?.[0] ?? '';
    if (!tmId) {
      if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
        console.log('[payout-compute] skipping basis row (no team_member link)', { id: r.id, basis_type: r.fields.basis_type, amount_usd: r.fields.amount_usd });
      }
      continue;
    }
    if (!teamMemberIdsSet.has(tmId)) {
      invalidTeamMemberIdsInBasis.push(tmId);
      continue;
    }
    if (!basisByMember[tmId]) basisByMember[tmId] = { chatter_sales: 0, bonus: 0, adjustment: 0 };
    const type = (r.fields.basis_type ?? '') as BasisType;
    const amountUsd = typeof r.fields.amount_usd === 'number' ? r.fields.amount_usd : null;
    const amountEur = typeof r.fields.amount_eur === 'number' ? r.fields.amount_eur : null;
    const amount = r.fields.amount ?? 0;
    let value = 0;
    if (amountUsd != null) {
      value = amountUsd;
    } else if (amountEur != null && fxRate != null && fxRate > 0) {
      value = amountEur / fxRate;
    } else {
      value = amount;
    }
    if (type === 'chatter_sales') basisByMember[tmId].chatter_sales += value;
    else if (type === 'bonus') basisByMember[tmId].bonus += value;
    else if (type === 'adjustment' || type === 'fine') {
      basisByMember[tmId].adjustment += value;
      if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined' && (value < 0 || (r.fields.amount_eur != null && Number(r.fields.amount_eur) < 0))) {
        console.log('[payout-compute] fine/adj raw from basis', { basis_type: type, amount_eur: r.fields.amount_eur, amount_usd: r.fields.amount_usd, value, tmId });
      }
    }
  }

  const basisByMemberEur: Record<string, { bonus: number; adjustment: number }> = {};
  for (const r of basisRecords) {
    if (isHourlyBasisRecord(r)) continue;
    const tmId = r.fields.team_member?.[0] ?? '';
    if (!tmId) continue;
    if (!teamMemberIdsSet.has(tmId)) continue;
    if (!basisByMemberEur[tmId]) basisByMemberEur[tmId] = { bonus: 0, adjustment: 0 };
    const type = (r.fields.basis_type ?? '') as BasisType;
    const amountEur = typeof r.fields.amount_eur === 'number' ? r.fields.amount_eur : null;
    const amountUsd = typeof r.fields.amount_usd === 'number' ? r.fields.amount_usd : null;
    const amount = typeof r.fields.amount === 'number' ? r.fields.amount : 0;
    const valueEur = amountEur ?? amountUsd ?? amount;
    if (type === 'bonus') basisByMemberEur[tmId].bonus += valueEur;
    else if (type === 'adjustment' || type === 'fine') basisByMemberEur[tmId].adjustment += valueEur;
  }

  /** Hourly payout items per member (USD source of truth). Identified via notes.payout_type === 'hourly'. */
  const hourlyByMemberUsd: Record<string, number> = {};
  for (const r of basisRecords) {
    if (!isHourlyBasisRecord(r)) continue;
    const tmId = r.fields.team_member?.[0] ?? '';
    if (!tmId) continue;
    if (!teamMemberIdsSet.has(tmId)) {
      invalidTeamMemberIdsInBasis.push(tmId);
      continue;
    }
    const amountUsd = typeof r.fields.amount_usd === 'number' ? r.fields.amount_usd : null;
    const amountEur = typeof r.fields.amount_eur === 'number' ? r.fields.amount_eur : null;
    let valueUsd = 0;
    if (amountUsd != null && amountUsd > 0) {
      valueUsd = amountUsd;
    } else if (amountEur != null && amountEur > 0 && fxRate != null && fxRate > 0) {
      valueUsd = amountEur / fxRate;
    }
    if (!hourlyByMemberUsd[tmId]) hourlyByMemberUsd[tmId] = 0;
    hourlyByMemberUsd[tmId] += valueUsd;
  }

  const chattingRevenue = agencyRevenues
    ? (agencyRevenues.chatting_amount_eur ?? agencyRevenues.chatting_amount_usd ?? 0)
    : 0;
  const gunzoRevenue = agencyRevenues
    ? (agencyRevenues.gunzo_amount_eur ?? agencyRevenues.gunzo_amount_usd ?? 0)
    : 0;
  const chattingTotalNetEur = agencyRevenues?.chatting_amount_eur ?? 0;
  const gunzoTotalNetEur = agencyRevenues?.gunzo_amount_eur ?? 0;
  const chattingMsgsTipsNetEur = agencyRevenues?.chatting_msgs_tips_net_eur ?? 0;
  const gunzoMsgsTipsNetEur = agencyRevenues?.gunzo_msgs_tips_net_eur ?? 0;

  const lines: PayoutPreviewLine[] = [];

  for (const rec of allMembers) {
    const memberId = rec.id;
    const role = (rec.fields.role ?? '') as string;
    const department = (rec.fields.department ?? '') as string;
    // Affiliates are excluded from generic payout generation; they only get lines from affiliate_model_deals below (one per month, keyed by team_member_id + payout_type='affiliate').
    const isAffiliator = (role ?? '').toLowerCase().trim() === 'affiliator' || (department ?? '').toLowerCase().trim() === 'affiliate';
    if (isAffiliator) continue;

    const payoutType = (rec.fields.payout_type ?? 'none') as PayoutType;
    const team_member_name = (rec.fields.name ?? '') as string;

    const basisRow = basisByMember[memberId] ?? { chatter_sales: 0, bonus: 0, adjustment: 0 };
    const basisRowEur = basisByMemberEur[memberId] ?? { bonus: 0, adjustment: 0 };
    const bonusAmount = basisRow.bonus;
    const adjustmentsAmount = basisRow.adjustment;
    if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
      const basisRowsUsed = basisRecords.filter((r) => (r.fields.team_member?.[0] ?? '') === memberId);
      console.log('[payout-compute] member basis', {
        memberId,
        month_key,
        basisRowIds: basisRowsUsed.map((r) => r.id),
        amounts: basisRowsUsed.map((r) => ({ type: r.fields.basis_type, amount_usd: r.fields.amount_usd, amount_eur: r.fields.amount_eur })),
        totals: { chatter_sales: basisRow.chatter_sales, bonus: bonusAmount, adjustment: adjustmentsAmount },
      });
    }

    const category = getPayoutCategory(role, department);
    if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
      console.log('[payout-compute] line category', { team_member_id: memberId, role, department, category });
    }

    const hourlyUsd = hourlyByMemberUsd[memberId] ?? 0;

    if (payoutType === 'none' || String(rec.fields.payout_type ?? '').toLowerCase() === 'none') {
      const payoutAmountNone = hourlyUsd;
      const amountEurNone = fxRate != null && fxRate > 0 ? convertUsdToEur(hourlyUsd, fxRate) : hourlyUsd;
      const basisEurNone = basisByMemberEur[memberId] ?? { bonus: 0, adjustment: 0 };
      lines.push({
        id: `preview-${memberId}`,
        team_member_id: memberId,
        team_member_name,
        payee_team_member_id: memberId,
        department: department || 'ops',
        role,
        category,
        payout_type: 'none',
        basis_webapp_amount: 0,
        basis_manual_amount: 0,
        bonus_amount: bonusAmount,
        adjustments_amount: adjustmentsAmount,
        basis_total: 0,
        payout_amount: payoutAmountNone,
        amount_eur: amountEurNone,
        amount_usd: hourlyUsd > 0 ? hourlyUsd : null,
        currency: hourlyUsd > 0 ? 'usd' : 'eur',
        breakdown_json: JSON.stringify({ note: 'payout_type is none', hourly_usd: hourlyUsd }),
        bonus_eur: basisEurNone.bonus,
        adjustments_eur: basisEurNone.adjustment,
        hourly_eur: amountEurNone,
        pct_payout_eur: null,
      });
      continue;
    }

    const pct = Number(rec.fields.payout_percentage) || 0;
    const pctChatters = Number((rec.fields as Record<string, unknown>).payout_percentage_chatters) || 0;
    const chattingPct = Number(rec.fields.chatting_percentage) || 0;
    const chattingPctMsgs = Number((rec.fields as Record<string, unknown>).chatting_percentage_messages_tips) || 0;
    const gunzoPct = Number(rec.fields.gunzo_percentage) || 0;
    const gunzoPctMsgs = Number((rec.fields as Record<string, unknown>).gunzo_percentage_messages_tips) || 0;
    const flatFee = Number(rec.fields.payout_flat_fee) || 0;

    const isChatter = isChatterPayout(role, department);
    let basisWebapp = 0;
    let basisManual = 0;
    let payoutAmount = 0;
    let linePct: number | undefined;
    let breakdown: Record<string, unknown>;
    let bonus_eur: number | null = null;
    let adjustments_eur: number | null = null;
    let hourly_eur: number | null = null;
    let pct_payout_eur: number | null = null;

    if (isChatter) {
      basisManual = basisRow.chatter_sales;
      const basisTotal = basisManual;
      const chatterPct = pctChatters || pct;
      linePct = payoutType === 'percentage' || payoutType === 'hybrid' ? chatterPct : undefined;
      if (payoutType === 'percentage') {
        payoutAmount = (basisTotal * chatterPct) / 100 + bonusAmount + adjustmentsAmount;
      } else if (payoutType === 'flat_fee') {
        payoutAmount = flatFee + bonusAmount + adjustmentsAmount;
      } else if (payoutType === 'hybrid') {
        payoutAmount = (basisTotal * chatterPct) / 100 + flatFee + bonusAmount + adjustmentsAmount;
      }
      payoutAmount += hourlyUsd;
      if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined' && adjustmentsAmount !== 0) {
        console.log('[payout-compute] after compute (chatter)', { memberId, adjustmentsAmount, payoutAmount });
      }
      breakdown = {
        basis_manual: basisManual,
        bonus: bonusAmount,
        adjustments: adjustmentsAmount,
        hourly_usd: hourlyUsd,
        formula: payoutType === 'percentage' ? `(chatter_revenue * ${chatterPct}%) + bonus + adj + hourly` : payoutType === 'flat_fee' ? 'flat_fee + bonus + adj + hourly' : payoutType === 'hybrid' ? `(chatter_revenue * ${chatterPct}%) + flat + bonus + adj + hourly` : 'none',
      };
      bonus_eur = fxRate != null && fxRate > 0 ? convertUsdToEur(bonusAmount, fxRate) : 0;
      adjustments_eur = fxRate != null && fxRate > 0 ? convertUsdToEur(adjustmentsAmount, fxRate) : 0;
      hourly_eur = fxRate != null && fxRate > 0 ? convertUsdToEur(hourlyUsd, fxRate) : 0;
    } else {
      if (gunzoPct > 0 && gunzoPctMsgs > 0) {
        throw new Error(`Manager ${memberId} has both gunzo_percentage and gunzo_percentage_messages_tips > 0 (double-counting).`);
      }
      if (chattingPct > 0 && chattingPctMsgs > 0) {
        throw new Error(`Manager ${memberId} has both chatting_percentage and chatting_percentage_messages_tips > 0 (double-counting).`);
      }
      const chattingPartEur = (chattingTotalNetEur * chattingPct) / 100;
      const chattingMsgsPartEur = (chattingMsgsTipsNetEur * chattingPctMsgs) / 100;
      const gunzoPartEur = (gunzoTotalNetEur * gunzoPct) / 100;
      const gunzoMsgsPartEur = (gunzoMsgsTipsNetEur * gunzoPctMsgs) / 100;
      const agencyPartEur = chattingPartEur + chattingMsgsPartEur + gunzoPartEur + gunzoMsgsPartEur;
      const bonusEur = basisRowEur.bonus;
      const adjustmentsEur = basisRowEur.adjustment;
      const flatFeeEur = flatFee;
      const hourlyEur = fxRate != null && fxRate > 0 ? convertUsdToEur(hourlyUsd, fxRate) : 0;
      payoutAmount = agencyPartEur + flatFeeEur + bonusEur + adjustmentsEur + hourlyEur;
      if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined' && adjustmentsEur !== 0) {
        console.log('[payout-compute] after compute (manager)', { memberId, adjustmentsEur, payoutAmount });
      }
      basisManual = 0;
      breakdown = {
        chatting_revenue: chattingRevenue,
        gunzo_revenue: gunzoRevenue,
        chatting_percentage: chattingPct,
        gunzo_percentage: gunzoPct,
        agency_part: agencyPartEur,
        flat_fee: flatFee,
        bonus_eur: bonusEur,
        adjustments_eur: adjustmentsEur,
        hourly_usd: hourlyUsd,
        hourly_eur: hourlyEur,
        formula: 'manager: sum(bucket_eur * pct) + flat + bonus + adj + hourly',
      };
      linePct = undefined;
      bonus_eur = bonusEur;
      adjustments_eur = adjustmentsEur;
      hourly_eur = hourlyEur;
      pct_payout_eur = agencyPartEur;
    }

    const basisTotal = basisWebapp + basisManual;

    let amountEur: number;
    let amountUsd: number | undefined;
    if (isChatter) {
      amountUsd = payoutAmount;
      amountEur = fxRate != null && fxRate > 0 ? convertUsdToEur(payoutAmount, fxRate) : payoutAmount;
    } else {
      amountEur = payoutAmount;
      amountUsd = fxRate != null && fxRate > 0 ? convertEurToUsd(payoutAmount, fxRate) : undefined;
    }

    const hasPercent = payoutType === 'percentage' || payoutType === 'hybrid';
    const hasFlat = payoutType === 'flat_fee' || payoutType === 'hybrid';

    lines.push({
      id: `preview-${memberId}`,
      team_member_id: memberId,
      team_member_name,
      payee_team_member_id: memberId,
      department: department || 'ops',
      role,
      category,
      payout_type: payoutType,
      payout_percentage: hasPercent ? linePct : undefined,
      payout_flat_fee: hasFlat ? flatFee : undefined,
      basis_webapp_amount: basisWebapp,
      basis_manual_amount: basisManual,
      bonus_amount: bonusAmount,
      adjustments_amount: adjustmentsAmount,
      basis_total: basisTotal,
      payout_amount: payoutAmount,
      amount_eur: amountEur,
      amount_usd: amountUsd ?? null,
      currency: amountEur != null ? 'eur' : 'usd',
      breakdown_json: JSON.stringify(breakdown),
      bonus_eur: bonus_eur ?? undefined,
      adjustments_eur: adjustments_eur ?? undefined,
      hourly_eur: hourly_eur ?? undefined,
      pct_payout_eur: pct_payout_eur ?? undefined,
    });
  }

  let modelLogCount = 0;
  for (const m of models ?? []) {
    const modelId = m.id;
    const modelName = (m.fields.name ?? '') as string;
    const pnl = pnlByModelId[modelId];
    const grossRevenue = pnl?.gross_revenue ?? 0;
    const netRevenue = pnl?.net_revenue ?? 0;
    const netRevenueMissing = (netRevenue == null || netRevenue === 0) && grossRevenue > 0;
    const revenueBase = netRevenueMissing ? 0 : netRevenue;
    const payoutAmount = netRevenueMissing ? 0 : getModelPayoutAmount(netRevenue, m.fields, fxRate);
    const compType = (m.fields.compensation_type ?? '') as string;
    const pct = typeof m.fields.creator_payout_pct === 'number' ? m.fields.creator_payout_pct : null;
    if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
      console.log('[payout-compute] model payout', {
        model_id: modelId,
        month_key,
        net_usd: netRevenue,
        gross_usd: grossRevenue,
        chosen_basis_usd: revenueBase,
        base: 'net',
        net_revenue_missing: netRevenueMissing,
        compensation_type: compType,
        creator_payout_pct: pct,
        computed_payout: payoutAmount,
      });
      if (modelLogCount < 2) {
        console.log('[payout-compute] model sample (base=net)', { model_name: modelName, net_revenue: netRevenue, payout: payoutAmount });
        modelLogCount += 1;
      }
    }
    const payeeTeamMemberId = Array.isArray(m.fields.team_member) && m.fields.team_member[0] ? m.fields.team_member[0] : undefined;
    lines.push({
      id: `preview-model-${modelId}`,
      team_member_id: `model-${modelId}`,
      team_member_name: modelName,
      payee_team_member_id: payeeTeamMemberId,
      department: 'models',
      role: 'model',
      category: 'model',
      payout_type: compType === 'Percentage' ? 'percentage' : compType === 'Tiered deal (threshold)' ? 'hybrid' : 'none',
      payout_percentage: pct ?? undefined,
      basis_webapp_amount: revenueBase, // always pnl net_revenue (USD); never gross
      basis_manual_amount: 0,
      bonus_amount: 0,
      adjustments_amount: 0,
      basis_total: revenueBase,
      payout_amount: payoutAmount,
      amount_usd: payoutAmount,
      amount_eur: fxRate != null && fxRate > 0 ? convertUsdToEur(payoutAmount, fxRate) : null,
      currency: 'usd',
      breakdown_json: JSON.stringify({
        gross_revenue: grossRevenue,
        net_revenue: netRevenue,
        net_revenue_missing: netRevenueMissing,
        compensation_type: compType,
        creator_payout_pct: pct,
        computed_payout: payoutAmount,
      }),
      bonus_eur: 0,
      adjustments_eur: 0,
      hourly_eur: null,
      pct_payout_eur: null,
    });
  }

  // --- Affiliate payouts: % of model net_revenue from affiliate_model_deals (active, month in range), one line per affiliator.
  // Example: model net_revenue 10,000 USD, deal pct 5% => affiliate payout 500 USD => EUR via fx. Bonus/adj from monthly_member_basis applied same as managers/VAs. ---
  const monthIdToKey: Record<string, string> = {};
  for (const m of months ?? []) {
    monthIdToKey[m.id] = (m.fields as { month_key?: string }).month_key ?? '';
  }
  const affiliatorIds = new Set(
    (allMembers ?? []).filter(
      (r) => (String((r.fields as { role?: string }).role ?? '').toLowerCase() === 'affiliator' || String((r.fields as { department?: string }).department ?? '').toLowerCase() === 'affiliate')
    ).map((r) => r.id)
  );
  const deals = (affiliateDealsRaw ?? []).map(toAffiliateModelDeal).filter((d) => d.is_active && affiliatorIds.has(d.affiliator_id));
  const dealsInRange: typeof deals = [];
  for (const d of deals) {
    const startKey = d.start_month_id ? (monthIdToKey[d.start_month_id] ?? '') : '';
    const endKey = d.end_month_id ? (monthIdToKey[d.end_month_id] ?? '') : '';
    if (startKey && month_key < startKey) continue;
    if (endKey && month_key > endKey) continue;
    dealsInRange.push(d);
  }
  const affiliatePayoutByMember: Record<string, { totalUsd: number; breakdown: Array<{ model_id: string; deal_id: string; pct: number; net_revenue: number; amount_usd: number }> }> = {};
  const matchedModelIds = new Set<string>();
  for (const d of dealsInRange) {
    const net = pnlByModelId[d.model_id]?.net_revenue ?? 0;
    if (net > 0) matchedModelIds.add(d.model_id);
    const amountUsd = net * (d.percentage / 100);
    if (!affiliatePayoutByMember[d.affiliator_id]) affiliatePayoutByMember[d.affiliator_id] = { totalUsd: 0, breakdown: [] };
    affiliatePayoutByMember[d.affiliator_id].totalUsd += amountUsd;
    affiliatePayoutByMember[d.affiliator_id].breakdown.push({
      model_id: d.model_id,
      deal_id: d.id,
      pct: d.percentage,
      net_revenue: net,
      amount_usd: amountUsd,
    });
  }
  let affiliatePayoutTotalUsd = 0;
  for (const [affiliatorId, data] of Object.entries(affiliatePayoutByMember)) {
    const basisRow = basisByMember[affiliatorId] ?? { chatter_sales: 0, bonus: 0, adjustment: 0 };
    const bonusAdjustmentUsd = basisRow.bonus + basisRow.adjustment;
    const totalUsd = data.totalUsd + bonusAdjustmentUsd;
    affiliatePayoutTotalUsd += totalUsd;
    const memberRec = (allMembers ?? []).find((r) => r.id === affiliatorId);
    const team_member_name = (memberRec?.fields?.name ?? '') as string;
    const amountEur = fxRate != null && fxRate > 0 ? convertUsdToEur(totalUsd, fxRate) : 0;
    const basisRowEur = basisByMemberEur[affiliatorId] ?? { bonus: 0, adjustment: 0 };
    const breakdownJson = JSON.stringify({
      payout_type: 'affiliate',
      fx_rate: fxRate,
      models: data.breakdown.map((b) => ({ model_id: b.model_id, deal_id: b.deal_id, pct: b.pct, fx_rate: fxRate, net_revenue: b.net_revenue, amount_usd: b.amount_usd })),
      bonus_eur: basisRowEur.bonus,
      adjustments_eur: basisRowEur.adjustment,
    });
    lines.push({
      id: `preview-affiliate-${affiliatorId}`,
      team_member_id: affiliatorId,
      team_member_name,
      payee_team_member_id: affiliatorId,
      department: 'affiliate',
      role: 'affiliator',
      category: 'affiliate',
      payout_type: 'affiliate',
      basis_webapp_amount: 0,
      basis_manual_amount: 0,
      bonus_amount: basisRowEur.bonus,
      adjustments_amount: basisRowEur.adjustment,
      basis_total: 0,
      payout_amount: totalUsd,
      amount_usd: totalUsd,
      amount_eur: amountEur,
      currency: 'usd',
      breakdown_json: breakdownJson,
      bonus_eur: basisRowEur.bonus,
      adjustments_eur: basisRowEur.adjustment,
      hourly_eur: null,
      pct_payout_eur: null,
    });
  }

  if (invalidTeamMemberIdsInBasis.length > 0 && process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
    const counts: Record<string, number> = {};
    for (const id of invalidTeamMemberIdsInBasis) counts[id] = (counts[id] ?? 0) + 1;
    const unique = Object.keys(counts);
    console.log('[payout-compute] invalidTeamMemberIdsFoundInBasis (basis rows with team_member not in team_members)', { unique, counts });
  }

  const byTab = {} as Record<PayoutTabId, PayoutPreviewLine[]>;
  for (const tab of PAYOUT_TAB_IDS) {
    byTab[tab] = lines.filter((l) => l.category === categoryForTab(tab));
  }

  if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
    console.log('[payout-compute] preview result', {
      linesCount: lines.length,
      byTab: { chatters: byTab.chatters.length, managers: byTab.managers.length, vas: byTab.vas.length, models: byTab.models.length, affiliates: byTab.affiliates?.length ?? 0 },
    });
  }

  const result: PayoutPreviewResult = {
    lines,
    month_key,
    byTab,
  };
  if (options?.debug) {
    result.debug = {
      affiliateDealsCount: dealsInRange.length,
      matchedModelsCount: matchedModelIds.size,
      affiliatePayoutTotalUsd,
    };
  }

  return result;
}

/** Aggregated live payouts for agency master: per-model and per-team_member payout_usd plus total. Affiliate payouts summed into affiliateTotalUsd (one row "Affiliate payouts"), not per-team_member. */
export interface LivePayoutsResult {
  byModelId: Record<string, number>;
  byTeamMemberId: Record<string, number>;
  /** Sum of all affiliate payout USD in range; show as single row "Affiliate payouts" in agency master. */
  affiliateTotalUsd: number;
  totalPayoutUsd: number;
  itemCount: number;
}

export async function computeLivePayoutsInRange(
  from_month_key: string,
  to_month_key: string,
  fxRate: number | null
): Promise<LivePayoutsResult> {
  const monthIds = await getMonthRecordIdsInRange(from_month_key.trim(), to_month_key.trim());
  const byModelId: Record<string, number> = {};
  const byTeamMemberId: Record<string, number> = {};
  let affiliateTotalUsd = 0;
  let totalPayoutUsd = 0;
  let itemCount = 0;

  for (const monthId of monthIds) {
    const { lines } = await computePreviewPayouts(monthId, fxRate);
    for (const line of lines) {
      const amountUsd =
        line.amount_usd != null && Number.isFinite(line.amount_usd)
          ? line.amount_usd
          : line.amount_eur != null && fxRate != null && fxRate > 0
            ? line.amount_eur / fxRate
            : 0;
      if (amountUsd === 0) continue;
      itemCount += 1;
      totalPayoutUsd += amountUsd;
      const tid = line.team_member_id ?? '';
      if (line.category === 'affiliate') {
        affiliateTotalUsd += amountUsd;
      } else if (tid.startsWith('model-')) {
        const modelId = tid.replace(/^model-/, '');
        byModelId[modelId] = (byModelId[modelId] ?? 0) + amountUsd;
      } else if (tid) {
        byTeamMemberId[tid] = (byTeamMemberId[tid] ?? 0) + amountUsd;
      }
    }
  }

  return { byModelId, byTeamMemberId, affiliateTotalUsd, totalPayoutUsd, itemCount };
}

/** Convert preview line to the payload shape expected by upsertPayoutLines (no id, no team_member_name). Model lines get model_id, department "models", role "model", and optional team_member (payee). */
export function previewLinesToUpsertPayload(
  lines: PayoutPreviewLine[]
): Array<{
  team_member_id?: string;
  model_id?: string;
  department?: string;
  role?: string;
  payout_type?: string;
  payout_percentage?: number;
  payout_flat_fee?: number;
  basis_webapp_amount?: number;
  basis_manual_amount?: number;
  bonus_amount?: number;
  adjustments_amount?: number;
  basis_total?: number;
  payout_amount: number;
  amount_eur?: number;
  amount_usd?: number;
  breakdown_json?: string;
}> {
  return lines.map((l) => {
    const isModel = l.category === 'model' || (l.team_member_id ?? '').startsWith('model-');
    const modelId = isModel ? (l.team_member_id ?? '').replace(/^model-/, '') : undefined;
    return {
      team_member_id: isModel ? (l.payee_team_member_id ?? undefined) : l.team_member_id,
      model_id: modelId || undefined,
      department: isModel ? 'models' : l.department,
      role: isModel ? 'model' : l.role,
      payout_type: l.payout_type,
      payout_percentage: l.payout_percentage,
      payout_flat_fee: l.payout_flat_fee,
      basis_webapp_amount: l.basis_webapp_amount,
      basis_manual_amount: l.basis_manual_amount,
      bonus_amount: l.bonus_amount,
      adjustments_amount: l.adjustments_amount,
      basis_total: l.basis_total,
      payout_amount: l.payout_amount,
      amount_eur: l.amount_eur ?? undefined,
      amount_usd: l.amount_usd ?? undefined,
      breakdown_json: l.breakdown_json,
    };
  });
}
