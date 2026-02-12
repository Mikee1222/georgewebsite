import { NextRequest, NextResponse } from 'next/server';
import {
  getPnlInRange,
  getModels,
  getMonths,
  getSettings,
  listExpenseEntriesInRange,
  listPayoutLinesInRange,
  listTeamMembers,
} from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, unauthorized, badRequest, serverError } from '@/lib/api-utils';
import { rawToPnlRow } from '@/lib/business-rules';
import { formatEurDisplay, formatUsdDisplay } from '@/lib/format-display';
import { getFxRateDirect } from '@/lib/fx';
import { convertUsdToEur } from '@/lib/fx';
import { computeLivePayoutsInRange, type LivePayoutsResult } from '@/lib/payout-compute';
import { buildTeamMemberLookup, resolveTeamMemberName } from '@/lib/team-member-resolve';
import type { PayoutLineTeamMemberLike } from '@/lib/team-member-resolve';
import type { AgencyRow, AgencyMasterResponse } from '@/lib/types';
import type { SettingsMap } from '@/lib/types';

export const runtime = 'edge';

function num(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

export async function GET(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const from = request.nextUrl.searchParams.get('from') ?? '';
  const to = request.nextUrl.searchParams.get('to') ?? from;
  const payoutsMode = (request.nextUrl.searchParams.get('payouts_mode') ?? 'owed') as 'owed' | 'paid';
  const payoutsSource = (request.nextUrl.searchParams.get('payouts_source') ?? 'live') as 'live' | 'locked';
  const debugQuery = request.nextUrl.searchParams.get('debug') === '1';

  if (!from || !to) return badRequest(reqId, 'from and to (YYYY-MM) required');

  try {
    const payoutLinesPromise =
      payoutsSource === 'locked'
        ? listPayoutLinesInRange(from, to, { source: payoutsSource, mode: payoutsMode })
        : Promise.resolve([] as Awaited<ReturnType<typeof listPayoutLinesInRange>>);

    const [settingsRows, modelsRecords, monthsRecords, pnlRecords, expenseEntries, payoutLines, fxRate, teamMembersRecords] =
      await Promise.all([
        getSettings(),
        getModels(),
        getMonths(),
        getPnlInRange(from, to, { status: 'actual' }),
        listExpenseEntriesInRange(from, to),
        payoutLinesPromise,
        getFxRateDirect(),
        listTeamMembers(),
      ]);
    const teamMemberLookup = buildTeamMemberLookup(
      teamMembersRecords.map((r) => ({ id: r.id, fields: { name: r.fields.name, member_id: r.fields.member_id } }))
    );

    const settingsMap: Partial<SettingsMap> = {};
    for (const r of settingsRows) {
      const name = r.setting_name as keyof SettingsMap;
      if (name && typeof r.value === 'number') settingsMap[name] = r.value;
    }
    const monthNameById: Record<string, string> = {};
    for (const m of monthsRecords) {
      monthNameById[m.id] = m.fields.month_name ?? m.fields.month_key ?? '';
    }
    const modelNameById: Record<string, string> = {};
    for (const m of modelsRecords) {
      modelNameById[m.id] = m.fields.name ?? '';
    }
    const teamMemberNameById: Record<string, string> = {};
    for (const r of teamMembersRecords) {
      teamMemberNameById[r.id] = (r.fields.name ?? '') as string;
    }

    const pnlRows = pnlRecords.map((rec) =>
      rawToPnlRow(
        { id: rec.id, fields: rec.fields },
        settingsMap,
        rec.fields.month?.[0] ? monthNameById[rec.fields.month[0]] : undefined
      )
    );

    const byModel: Record<
      string,
      {
        model_id: string;
        model_name: string;
        month_key: string;
        month_name?: string;
        net_revenue: number;
        total_expenses: number;
        net_profit: number;
        profit_margin_pct: number;
        total_marketing_costs: number;
        chatting_costs_team: number;
        marketing_costs_team: number;
        production_costs_team: number;
        ads_spend: number;
        revenue_usd: number;
        revenue_eur: number;
        expenses_usd: number;
        expenses_eur: number;
        profit_usd: number;
        profit_eur: number;
        payout_usd: number;
        payout_eur: number;
        net_after_payouts_usd: number;
        net_after_payouts_eur: number;
      }
    > = {};

    const UNASSIGNED_KEY = '__unassigned__';
    const TEAM_CHATTING_KEY = '__team_chatting__';
    const CHATTING_EXPENSES_KEY = 'dept:chatting_expenses';
    /** Single row key for all affiliate payouts (not tied to a model). Display name: "Affiliate payouts". */
    const AFFILIATE_PAYOUTS_KEY = 'affiliate-payouts';

    for (const row of pnlRows) {
      const mid = row.model_id;
      const name = modelNameById[mid] ?? mid;
      if (!byModel[mid]) {
        byModel[mid] = {
          model_id: mid,
          model_name: name,
          month_key: row.month_key,
          month_name: row.month_name,
          net_revenue: 0,
          total_expenses: 0,
          net_profit: 0,
          profit_margin_pct: 0,
          total_marketing_costs: 0,
          chatting_costs_team: 0,
          marketing_costs_team: 0,
          production_costs_team: 0,
          ads_spend: 0,
          revenue_usd: 0,
          revenue_eur: 0,
          expenses_usd: 0,
          expenses_eur: 0,
          profit_usd: 0,
          profit_eur: 0,
          payout_usd: 0,
          payout_eur: 0,
          net_after_payouts_usd: 0,
          net_after_payouts_eur: 0,
        };
      }
      const agg = byModel[mid];
      agg.net_revenue += row.net_revenue;
      agg.total_marketing_costs += row.total_marketing_costs;
      agg.chatting_costs_team += row.chatting_costs_team;
      agg.marketing_costs_team += row.marketing_costs_team;
      agg.production_costs_team += row.production_costs_team;
      agg.ads_spend += row.ads_spend;
      agg.revenue_usd += row.net_revenue;
    }

    const resolvedMonthIds = monthsRecords
      .filter((m) => {
        const k = m.fields.month_key ?? '';
        return k >= from && k <= to;
      })
      .map((m) => m.id);
    for (const mid of Object.keys(byModel)) {
      const agg = byModel[mid];
      agg.revenue_eur = fxRate > 0 ? convertUsdToEur(agg.revenue_usd, fxRate) : agg.revenue_usd;
    }

    const sumByDepartment: Record<string, number> = {};
    const sumByOwnerType: Record<string, number> = {};
    for (const rec of expenseEntries) {
      const hasModel = Array.isArray(rec.fields.model) && rec.fields.model[0];
      const hasTeamMember = Array.isArray(rec.fields.team_member) && rec.fields.team_member[0];
      const costOwner = (rec.fields.cost_owner_type as string) ?? '';
      const dept = (rec.fields.department as string) ?? '';
      const category = (rec.fields.category as string) ?? '';
      let mid: string;
      if (hasModel) {
        mid = (rec.fields.model as string[])[0];
      } else if (hasTeamMember || costOwner === 'team_member') {
        mid = TEAM_CHATTING_KEY;
      } else {
        mid = category === 'crm_cost' || category === 'bot_cost' ? CHATTING_EXPENSES_KEY : UNASSIGNED_KEY;
      }
      const name =
        mid === TEAM_CHATTING_KEY
          ? 'Team (chatting)'
          : mid === CHATTING_EXPENSES_KEY
            ? 'Chatting expenses'
            : mid === UNASSIGNED_KEY
              ? 'Marketing and Production expenses'
              : (modelNameById[mid] ?? mid);
      if (!byModel[mid]) {
        byModel[mid] = {
          model_id: mid,
          model_name: name,
          month_key: from,
          month_name: undefined,
          net_revenue: 0,
          total_expenses: 0,
          net_profit: 0,
          profit_margin_pct: 0,
          total_marketing_costs: 0,
          chatting_costs_team: 0,
          marketing_costs_team: 0,
          production_costs_team: 0,
          ads_spend: 0,
          revenue_usd: 0,
          revenue_eur: 0,
          expenses_usd: 0,
          expenses_eur: 0,
          profit_usd: 0,
          profit_eur: 0,
          payout_usd: 0,
          payout_eur: 0,
          net_after_payouts_usd: 0,
          net_after_payouts_eur: 0,
        };
      }
      const agg = byModel[mid];
      let amountUsd = num(rec.fields.amount_usd);
      const amountEur = num(rec.fields.amount_eur);
      const amountOnly = num(rec.fields.amount);
      if (amountUsd !== 0) {
        // use as-is
      } else if (amountEur !== 0 && fxRate > 0) {
        amountUsd = amountEur / fxRate;
      } else if (amountOnly !== 0 && fxRate > 0) {
        amountUsd = amountOnly / fxRate;
      }
      if (amountUsd !== 0) {
        agg.expenses_usd += amountUsd;
        sumByDepartment[dept || '(blank)'] = (sumByDepartment[dept || '(blank)'] ?? 0) + amountUsd;
        sumByOwnerType[costOwner || '(blank)'] = (sumByOwnerType[costOwner || '(blank)'] ?? 0) + amountUsd;
      }
    }

    let expensesSumUsd = 0;
    let expensesSumEur = 0;
    for (const agg of Object.values(byModel)) {
      expensesSumUsd += agg.expenses_usd;
    }
    expensesSumEur = fxRate > 0 ? convertUsdToEur(expensesSumUsd, fxRate) : expensesSumUsd;
    const expensesLineage = {
      month_ids_count: resolvedMonthIds.length,
      resolved_month_ids: resolvedMonthIds,
      expense_entries_count: expenseEntries.length,
      sum_usd_raw: expensesSumUsd,
      sum_eur_raw: expensesSumEur,
      fx_rate_used: fxRate,
      sum_by_department: sumByDepartment,
      sum_by_owner_type: sumByOwnerType,
      expense_filter_note:
        'FIND(month_key, ARRAYJOIN({month}, ",")) > 0 per month in range; table=expense_entries; includes chatting/team_member',
    };
    if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
      console.log('[api/agency] expenses_lineage', { requestId: reqId, ...expensesLineage });
    }

    for (const mid of Object.keys(byModel)) {
      const agg = byModel[mid];
      agg.expenses_eur = fxRate > 0 ? convertUsdToEur(agg.expenses_usd, fxRate) : agg.expenses_usd;
    }

    let payoutPath: 'live' | 'locked';
    let livePayoutsResult: LivePayoutsResult | null = null;
    if (payoutsSource === 'live') {
      payoutPath = 'live';
      const livePayouts = await computeLivePayoutsInRange(from, to, fxRate > 0 ? fxRate : null);
      livePayoutsResult = livePayouts;
      for (const [modelId, amountUsd] of Object.entries(livePayouts.byModelId)) {
        if (!byModel[modelId]) {
          byModel[modelId] = {
            model_id: modelId,
            model_name: modelNameById[modelId] ?? modelId,
            month_key: from,
            month_name: undefined,
            net_revenue: 0,
            total_expenses: 0,
            net_profit: 0,
            profit_margin_pct: 0,
            total_marketing_costs: 0,
            chatting_costs_team: 0,
            marketing_costs_team: 0,
            production_costs_team: 0,
            ads_spend: 0,
            revenue_usd: 0,
            revenue_eur: 0,
            expenses_usd: 0,
            expenses_eur: 0,
            profit_usd: 0,
            profit_eur: 0,
            payout_usd: 0,
            payout_eur: 0,
            net_after_payouts_usd: 0,
            net_after_payouts_eur: 0,
          };
        }
        byModel[modelId].payout_usd += amountUsd;
      }
      for (const [tmId, amountUsd] of Object.entries(livePayouts.byTeamMemberId)) {
        if (!byModel[tmId]) {
          byModel[tmId] = {
            model_id: tmId,
            model_name: teamMemberNameById[tmId] ?? tmId,
            month_key: from,
            month_name: undefined,
            net_revenue: 0,
            total_expenses: 0,
            net_profit: 0,
            profit_margin_pct: 0,
            total_marketing_costs: 0,
            chatting_costs_team: 0,
            marketing_costs_team: 0,
            production_costs_team: 0,
            ads_spend: 0,
            revenue_usd: 0,
            revenue_eur: 0,
            expenses_usd: 0,
            expenses_eur: 0,
            profit_usd: 0,
            profit_eur: 0,
            payout_usd: 0,
            payout_eur: 0,
            net_after_payouts_usd: 0,
            net_after_payouts_eur: 0,
          };
        }
        byModel[tmId].payout_usd += amountUsd;
      }
      if (livePayouts.affiliateTotalUsd > 0) {
        if (!byModel[AFFILIATE_PAYOUTS_KEY]) {
          byModel[AFFILIATE_PAYOUTS_KEY] = {
            model_id: AFFILIATE_PAYOUTS_KEY,
            model_name: 'Affiliate payouts',
            month_key: from,
            month_name: undefined,
            net_revenue: 0,
            total_expenses: 0,
            net_profit: 0,
            profit_margin_pct: 0,
            total_marketing_costs: 0,
            chatting_costs_team: 0,
            marketing_costs_team: 0,
            production_costs_team: 0,
            ads_spend: 0,
            revenue_usd: 0,
            revenue_eur: 0,
            expenses_usd: 0,
            expenses_eur: 0,
            profit_usd: 0,
            profit_eur: 0,
            payout_usd: 0,
            payout_eur: 0,
            net_after_payouts_usd: 0,
            net_after_payouts_eur: 0,
          };
        }
        byModel[AFFILIATE_PAYOUTS_KEY].payout_usd += livePayouts.affiliateTotalUsd;
      }
      if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
        console.log('[api/agency] payouts_source=live', {
          requestId: reqId,
          payout_path: 'live',
          computed_items: livePayouts.itemCount,
          total_payout_usd: livePayouts.totalPayoutUsd,
          affiliate_total_usd: livePayouts.affiliateTotalUsd,
        });
      }
    } else {
      payoutPath = 'locked';
      for (const rec of payoutLines) {
        const role = (rec.fields.role ?? '') as string;
        const department = (rec.fields.department ?? '') as string;
        const isAffiliateLine = role.toLowerCase() === 'affiliator' || (department ?? '').toLowerCase() === 'affiliate';
        const mid = Array.isArray(rec.fields.model) ? rec.fields.model[0] : undefined;
        let modelId: string;
        let name: string;
        if (isAffiliateLine) {
          modelId = AFFILIATE_PAYOUTS_KEY;
          name = 'Affiliate payouts';
        } else if (mid) {
          modelId = mid;
          name = modelNameById[mid] ?? mid;
        } else {
          const resolved = resolveTeamMemberName(rec as unknown as PayoutLineTeamMemberLike, teamMemberLookup);
          modelId = resolved.rowKey;
          name = resolved.displayName;
        }
        if (!byModel[modelId]) {
          byModel[modelId] = {
            model_id: modelId,
            model_name: name,
            month_key: from,
            month_name: undefined,
            net_revenue: 0,
            total_expenses: 0,
            net_profit: 0,
            profit_margin_pct: 0,
            total_marketing_costs: 0,
            chatting_costs_team: 0,
            marketing_costs_team: 0,
            production_costs_team: 0,
            ads_spend: 0,
            revenue_usd: 0,
            revenue_eur: 0,
            expenses_usd: 0,
            expenses_eur: 0,
            profit_usd: 0,
            profit_eur: 0,
            payout_usd: 0,
            payout_eur: 0,
            net_after_payouts_usd: 0,
            net_after_payouts_eur: 0,
          };
        }
        const agg = byModel[modelId];
        const lineUsd = num(rec.fields.final_payout_usd) || num(rec.fields.amount_usd);
        const lineEur = num(rec.fields.final_payout_eur) || num(rec.fields.amount_eur);
        if (lineUsd !== 0) {
          agg.payout_usd += lineUsd;
        } else if (lineEur !== 0 && fxRate > 0) {
          agg.payout_usd += lineEur / fxRate;
        }
      }
      if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
        const lockedTotalUsd = Object.values(byModel).reduce((s, a) => s + a.payout_usd, 0);
        console.log('[api/agency] payouts_source=locked', {
          requestId: reqId,
          payout_path: 'locked',
          payout_lines_count: payoutLines.length,
          total_payout_usd: lockedTotalUsd,
        });
      }
    }

    for (const mid of Object.keys(byModel)) {
      const agg = byModel[mid];
      agg.payout_eur = fxRate > 0 ? convertUsdToEur(agg.payout_usd, fxRate) : agg.payout_usd;
    }

    const modelIdsSet = new Set(modelsRecords.map((m) => m.id));
    const models: AgencyRow[] = Object.values(byModel).map((agg) => {
      agg.profit_usd = agg.revenue_usd - agg.expenses_usd - agg.payout_usd;
      agg.profit_eur = agg.revenue_eur - agg.expenses_eur - agg.payout_eur;
      agg.net_after_payouts_usd = agg.profit_usd;
      agg.net_after_payouts_eur = agg.profit_eur;
      const margin = agg.revenue_usd > 0 ? agg.profit_usd / agg.revenue_usd : 0;
      agg.profit_margin_pct = margin;
      agg.net_profit = agg.profit_eur;
      agg.total_expenses = agg.expenses_eur;

      return {
        ...agg,
        is_model: modelIdsSet.has(agg.model_id),
        net_revenue_display: formatUsdDisplay(agg.revenue_usd),
        total_expenses_display: formatUsdDisplay(agg.expenses_usd),
        net_profit_display: formatUsdDisplay(agg.profit_usd),
        total_marketing_costs_display: formatEurDisplay(agg.total_marketing_costs),
        chatting_costs_team_display: formatEurDisplay(agg.chatting_costs_team),
        marketing_costs_team_display: formatEurDisplay(agg.marketing_costs_team),
        production_costs_team_display: formatEurDisplay(agg.production_costs_team),
        ads_spend_display: formatEurDisplay(agg.ads_spend),
        payout_display: formatUsdDisplay(agg.payout_usd),
      } as AgencyRow;
    });

    const revUsd = models.reduce((s, r) => s + (r.revenue_usd ?? 0), 0);
    const revEur = models.reduce((s, r) => s + (r.revenue_eur ?? 0), 0);
    const expUsd = models.reduce((s, r) => s + (r.expenses_usd ?? 0), 0);
    const expEur = models.reduce((s, r) => s + (r.expenses_eur ?? 0), 0);
    const payUsd = models.reduce((s, r) => s + (r.payout_usd ?? 0), 0);
    const payEur = models.reduce((s, r) => s + (r.payout_eur ?? 0), 0);
    const profitUsd = revUsd - expUsd - payUsd;
    const profitEur = revEur - expEur - payEur;

    const totals = {
      revenue_usd: revUsd,
      revenue_eur: revEur,
      expenses_usd: expUsd,
      expenses_eur: expEur,
      profit_usd: profitUsd,
      profit_eur: profitEur,
      margin_pct: revUsd > 0 ? profitUsd / revUsd : 0,
      payout_usd: payUsd,
      payout_eur: payEur,
      net_after_payouts_usd: profitUsd,
      net_after_payouts_eur: profitEur,
    };

    const lineage = {
      requestId: reqId,
      month_range: { from, to },
      resolved_month_ids: resolvedMonthIds,
      resolved_month_count: resolvedMonthIds.length,
      payout_source: payoutsSource,
      payout_path: payoutPath,
      ...(livePayoutsResult
        ? {
            payout_computed_items: livePayoutsResult.itemCount,
            payout_total_usd: livePayoutsResult.totalPayoutUsd,
          }
        : {
            payout_lines_count: payoutLines.length,
          }),
      tables: {
        pnl_lines: {
          filter: `month_key_lookup in [${from},${to}], status=actual`,
          count: pnlRecords.length,
        },
        expense_entries: {
          filter: 'FIND(month_key, ARRAYJOIN({month}, ",")) > 0 per month in range (month_key, not id)',
          count: expenseEntries.length,
        },
        payout_lines: {
          filter:
            payoutsSource === 'live'
              ? 'none (computed live from preview logic)'
              : `payout_run in runs for month range; source=${payoutsSource}; mode=${payoutsMode}`,
          count: payoutsSource === 'live' ? 0 : payoutLines.length,
        },
      },
      totals: {
        revenue_usd: totals.revenue_usd,
        expenses_usd: totals.expenses_usd,
        payout_usd: totals.payout_usd,
        profit_usd: totals.profit_usd,
        margin_pct: totals.margin_pct,
      },
      fx: {
        source: 'getFxRateDirect',
        rate: fxRate,
        source_of_truth: 'usd' as const,
      },
      expenses_lineage: expensesLineage,
    };

    if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
      console.log('[api/agency] lineage', JSON.stringify(lineage));
    }

    const body: AgencyMasterResponse & { requestId?: string; debug?: typeof lineage } = {
      totals,
      models,
      requestId: reqId,
    };
    if (debugQuery) body.debug = lineage;

    const res = NextResponse.json(body);
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    return serverError(reqId, e, { route: '/api/agency' });
  }
}
