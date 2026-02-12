import { NextRequest, NextResponse } from 'next/server';
import {
  getPnlInRange,
  getModels,
  getMonths,
  getMonthKeysInRange,
  getSettings,
  listExpenses,
  listTeamMembers,
} from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { rawToPnlRow } from '@/lib/business-rules';
import { requestId, serverError, unauthorized, badRequest } from '@/lib/api-utils';
import { parsePeriodFromQuery } from '@/lib/period';
import type { SettingsMap } from '@/lib/types';
import type { ExpenseEntryRecord } from '@/lib/types';
import type { AirtableRecord } from '@/lib/types';

export const runtime = 'edge';

export interface AgencyOverviewResponse {
  months: { month_key: string; month_name: string }[];
  totals: { revenue: number; expenses: number; profit: number; avg_margin: number };
  byMonth: {
    month_key: string;
    revenue: number;
    expenses: number;
    profit: number;
    expenses_models: number;
    expenses_chatting: number;
    expenses_marketing_production: number;
  }[];
  topModels: { model_id: string; model_name: string; revenue: number; profit: number }[];
  topCostOwners: { cost_owner_type: string; owner_name: string; department: string; amount: number }[];
}

export async function GET(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const periodResult = parsePeriodFromQuery(request.nextUrl.searchParams);
  if (!periodResult.ok) return badRequest(reqId, periodResult.error);
  const { from_month_key, to_month_key } = periodResult.period;

  const resolvedMonths = await getMonthKeysInRange(from_month_key, to_month_key);
  if (process.env.NODE_ENV === 'development') {
    console.log('[period]', { from_month_key, to_month_key, resolvedMonths });
  }

  try {
    const [settingsRows, modelsRecords, monthsRecords, pnlRecords] = await Promise.all([
      getSettings(),
      getModels(),
      getMonths(),
      getPnlInRange(from_month_key, to_month_key),
    ]);

    const monthsInRange = monthsRecords
      .filter((m) => {
        const k = m.fields.month_key ?? '';
        return k >= from_month_key && k <= to_month_key;
      })
      .sort((a, b) => (a.fields.month_key ?? '').localeCompare(b.fields.month_key ?? ''));

    const monthIdsInRange = monthsInRange.map((m) => m.id);
    const [expenseRecords, teamRecords] = await Promise.all([
      listExpenses({ from_month_key, to_month_key }),
      listTeamMembers(),
    ]);

    const settingsMap: Partial<SettingsMap> = {};
    for (const r of settingsRows) {
      const name = r.setting_name as keyof SettingsMap;
      if (name && typeof r.value === 'number') settingsMap[name] = r.value;
    }
    const monthNameByKey: Record<string, string> = {};
    const monthIdByKey: Record<string, string> = {};
    const monthKeyById: Record<string, string> = {};
    for (const m of monthsRecords) {
      const k = m.fields.month_key ?? '';
      monthNameByKey[k] = m.fields.month_name ?? k;
      monthIdByKey[k] = m.id;
      monthKeyById[m.id] = k;
    }
    const modelNameById: Record<string, string> = {};
    for (const m of modelsRecords) {
      modelNameById[m.id] = m.fields.name ?? '';
    }
    const teamNameById: Record<string, string> = {};
    const teamDeptById: Record<string, string> = {};
    for (const t of teamRecords) {
      teamNameById[t.id] = t.fields.name ?? t.id;
      teamDeptById[t.id] = (t.fields.department as string) ?? '';
    }

    const pnlRows = pnlRecords.map((rec) => {
      const monthKeyLookup = rec.fields.month_key_lookup;
      const month_key =
        typeof monthKeyLookup === 'string'
          ? monthKeyLookup
          : Array.isArray(monthKeyLookup) && monthKeyLookup[0] != null
            ? String(monthKeyLookup[0])
            : '';
      return rawToPnlRow(
        { id: rec.id, fields: rec.fields },
        settingsMap,
        month_key ? monthNameByKey[month_key] : undefined
      );
    });

    const byModelMonth = new Map<string, { revenue: number; expenses: number; profit: number; margin: number; status: string }>();
    const actuals = pnlRows.filter((r) => r.status === 'actual');
    const forecasts = pnlRows.filter((r) => r.status === 'forecast');
    for (const r of actuals) {
      const key = `${r.model_id}|${r.month_key}`;
      byModelMonth.set(key, {
        revenue: r.net_revenue ?? 0,
        expenses: r.total_expenses ?? 0,
        profit: r.net_profit ?? 0,
        margin: r.profit_margin_pct ?? 0,
        status: 'actual',
      });
    }
    for (const r of forecasts) {
      const key = `${r.model_id}|${r.month_key}`;
      if (!byModelMonth.has(key)) {
        byModelMonth.set(key, {
          revenue: r.net_revenue ?? 0,
          expenses: r.total_expenses ?? 0,
          profit: r.net_profit ?? 0,
          margin: r.profit_margin_pct ?? 0,
          status: 'forecast',
        });
      }
    }

    const byMonthAgg: Record<
      string,
      { revenue: number; expenses: number; expenses_models: number; expenses_chatting: number; expenses_marketing_production: number; expenses_agency: number }
    > = {};
    for (const m of monthsInRange) {
      const k = m.fields.month_key ?? '';
      byMonthAgg[k] = { revenue: 0, expenses: 0, expenses_models: 0, expenses_chatting: 0, expenses_marketing_production: 0, expenses_agency: 0 };
    }
    for (const [key, val] of byModelMonth) {
      const month_key = key.split('|')[1] ?? '';
      if (byMonthAgg[month_key]) {
        byMonthAgg[month_key].revenue += val.revenue;
        byMonthAgg[month_key].expenses_models += val.expenses;
      }
    }
    for (const rec of expenseRecords as AirtableRecord<ExpenseEntryRecord>[]) {
      const monthId = rec.fields.month?.[0] ?? '';
      const month_key = monthKeyById[monthId] ?? '';
      const amount = rec.fields.amount ?? 0;
      const dept = (rec.fields.department ?? '') as string;
      const ownerType = (rec.fields.cost_owner_type ?? '') as string;
      if (!byMonthAgg[month_key]) continue;
      if (dept === 'chatting') byMonthAgg[month_key].expenses_chatting += amount;
      else if (dept === 'marketing' || dept === 'production') byMonthAgg[month_key].expenses_marketing_production += amount;
      else if (ownerType === 'agency') byMonthAgg[month_key].expenses_agency += amount;
      byMonthAgg[month_key].expenses =
        byMonthAgg[month_key].expenses_models +
        byMonthAgg[month_key].expenses_chatting +
        byMonthAgg[month_key].expenses_marketing_production +
        byMonthAgg[month_key].expenses_agency;
    }

    const byMonth = monthsInRange.map((m) => {
      const k = m.fields.month_key ?? '';
      const agg = byMonthAgg[k] ?? { revenue: 0, expenses: 0, expenses_models: 0, expenses_chatting: 0, expenses_marketing_production: 0, expenses_agency: 0 };
      const profit = agg.revenue - agg.expenses;
      return {
        month_key: k,
        revenue: agg.revenue,
        expenses: agg.expenses,
        profit,
        expenses_models: agg.expenses_models,
        expenses_chatting: agg.expenses_chatting,
        expenses_marketing_production: agg.expenses_marketing_production,
      };
    });

    const modelTotals = new Map<
      string,
      { revenue: number; expenses: number; profit: number; marginSum: number; marginCount: number }
    >();
    for (const [key, val] of byModelMonth) {
      const model_id = key.split('|')[0] ?? '';
      let cur = modelTotals.get(model_id);
      if (!cur) {
        cur = { revenue: 0, expenses: 0, profit: 0, marginSum: 0, marginCount: 0 };
        modelTotals.set(model_id, cur);
      }
      cur.revenue += val.revenue;
      cur.expenses += val.expenses;
      cur.profit += val.profit;
      if (val.revenue > 0) {
        cur.marginSum += val.margin;
        cur.marginCount += 1;
      }
    }
    const topModels = Array.from(modelTotals.entries())
      .map(([model_id, cur]) => ({
        model_id,
        model_name: modelNameById[model_id] ?? model_id,
        revenue: cur.revenue,
        profit: cur.profit,
      }))
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 20);

    const costByMember = new Map<string, { amount: number; department: string }>();
    for (const rec of expenseRecords as AirtableRecord<ExpenseEntryRecord>[]) {
      const owner = rec.fields.cost_owner_type as string;
      if (owner !== 'team_member') continue;
      const tid = rec.fields.team_member?.[0] ?? '';
      if (!tid) continue;
      const amt = rec.fields.amount ?? 0;
      const dept = (rec.fields.department ?? '') as string;
      const cur = costByMember.get(tid) ?? { amount: 0, department: dept };
      cur.amount += amt;
      costByMember.set(tid, cur);
    }
    const topCostOwners = Array.from(costByMember.entries())
      .map(([tid, cur]) => ({
        cost_owner_type: 'team_member',
        owner_name: teamNameById[tid] ?? tid,
        department: cur.department,
        amount: cur.amount,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 20);

    const totals = byMonth.reduce(
      (acc, m) => {
        acc.revenue += m.revenue;
        acc.expenses += m.expenses;
        acc.profit += m.profit;
        return acc;
      },
      { revenue: 0, expenses: 0, profit: 0, avg_margin: 0 }
    );
    totals.avg_margin = totals.revenue > 0 ? totals.profit / totals.revenue : 0;

    const payload: AgencyOverviewResponse = {
      months: monthsInRange.map((m) => ({
        month_key: m.fields.month_key ?? '',
        month_name: m.fields.month_name ?? m.fields.month_key ?? '',
      })),
      totals: { ...totals },
      byMonth,
      topModels,
      topCostOwners,
    };

    const res = NextResponse.json(payload);
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    return serverError(reqId, e, { route: '/api/agency/overview' });
  }
}
