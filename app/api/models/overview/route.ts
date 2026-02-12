import { NextRequest, NextResponse } from 'next/server';
import {
  getPnlInRange,
  getModels,
  getMonths,
  getMonthKeysInRange,
  getSettings,
  getWeeksOverlappingMonth,
  getWeeklyStatsForWeeks,
  listExpenseEntriesForMonthByKey,
} from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { rawToPnlRow } from '@/lib/business-rules';
import { getModelPayoutAmount } from '@/lib/tiered-deal';
import { requestId, serverError, unauthorized, badRequest } from '@/lib/api-utils';
import { parsePeriodFromQuery } from '@/lib/period';
import { formatUsdDisplay, formatEurDisplay } from '@/lib/format-display';
import { getFxRateForServer, convertUsdToEur } from '@/lib/fx';
import type { PnlRow, PnlLinesRecordRaw } from '@/lib/types';
import type { SettingsMap } from '@/lib/types';

export const runtime = 'edge';

export interface ModelOverviewRow {
  model_id: string;
  model_name: string;
  revenue: number;
  /** From expense_entries: sum(amount_usd). Used for profit. */
  expenses: number;
  expenses_usd: number;
  expenses_eur: number;
  profit: number;
  margin: number;
  /** Creator payout for month (tiered deal when set, else compensation_type). */
  payout?: number;
  status: 'actual' | 'forecast';
  revenue_display: string;
  expenses_display: string;
  expenses_eur_display: string;
  profit_display: string;
  payout_display?: string;
}

export interface ModelsOverviewResponse {
  month_key: string;
  month_name: string;
  totals: {
    revenue: number;
    expenses: number;
    expenses_eur: number;
    profit: number;
    avg_margin: number;
    revenue_display: string;
    expenses_display: string;
    expenses_eur_display: string;
    profit_display: string;
  };
  models: ModelOverviewRow[];
}

/** One row per model from actuals only. */
function actualsOnlyPerModel(rows: PnlRow[]): Map<string, PnlRow> {
  const byModel = new Map<string, PnlRow>();
  for (const r of rows) {
    if (r.status === 'actual' && r.model_id) byModel.set(r.model_id, r);
  }
  return byModel;
}

/** One row per model: prefer actual, else forecast when includeForecast is true. */
function rowPerModelWithForecast(actualRows: PnlRow[], forecastRows: PnlRow[]): Map<string, PnlRow> {
  const byModel = new Map<string, PnlRow>();
  for (const r of forecastRows) {
    if (r.model_id) byModel.set(r.model_id, r);
  }
  for (const r of actualRows) {
    if (r.model_id) byModel.set(r.model_id, r);
  }
  return byModel;
}

export async function GET(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const periodResult = parsePeriodFromQuery(request.nextUrl.searchParams);
  if (!periodResult.ok) return badRequest(reqId, periodResult.error);
  const { from_month_key, to_month_key } = periodResult.period;
  const includeForecast = request.nextUrl.searchParams.get('include_forecast') === 'true';

  const resolvedMonths = await getMonthKeysInRange(from_month_key, to_month_key);
  if (process.env.NODE_ENV === 'development') {
    console.log('[period]', { from_month_key, to_month_key, resolvedMonths, includeForecast });
  }

  const EXPECTED_WEEKS_PER_MONTH = 4;

  try {
    const [settingsRows, modelsRecords, monthsRecords, pnlActualRecords, pnlForecastRecords, weeksOverlapping] =
      await Promise.all([
        getSettings(),
        getModels(),
        getMonths(),
        getPnlInRange(from_month_key, to_month_key, { status: 'actual' }),
        includeForecast ? getPnlInRange(from_month_key, to_month_key, { status: 'forecast' }) : Promise.resolve([]),
        includeForecast ? getWeeksOverlappingMonth(from_month_key) : Promise.resolve([]),
      ]);

    const weekIds = Array.isArray(weeksOverlapping) ? weeksOverlapping.map((w) => w.id) : [];
    const weeklyStatsBulk =
      includeForecast && weekIds.length > 0 ? await getWeeklyStatsForWeeks(weekIds) : [];

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

    /** Expense totals from expense_entries for the overview month. Filter by month_key string (Airtable linked field returns primary text). Fetch all for month, aggregate by model in code. */
    const monthRec = monthsRecords.find((m) => m.fields.month_key === from_month_key);
    const expenseRecords = from_month_key ? await listExpenseEntriesForMonthByKey(from_month_key) : [];
    if (process.env.NODE_ENV === 'development') {
      console.log('[models/overview] TEMP monthKey=', from_month_key, 'expense_entries count=', expenseRecords.length);
      if (expenseRecords[0]) console.log('[models/overview] TEMP first record id=', expenseRecords[0].id, 'fields keys=', Object.keys(expenseRecords[0].fields ?? {}));
    }
    const origin = request.nextUrl?.origin ?? (typeof request.url === 'string' ? new URL(request.url).origin : '');
    const fxData = origin ? await getFxRateForServer(origin) : null;
    const fxRate = fxData?.rate != null && fxData.rate > 0 ? fxData.rate : null;
    const expensesByModel = new Map<string, { expenses_usd: number; expenses_eur: number }>();
    for (const r of expenseRecords) {
      const modelIds = r.fields.model;
      if (!Array.isArray(modelIds) || modelIds.length === 0) continue;
      const modelId = modelIds[0];
      const usd =
        typeof r.fields.amount_usd === 'number' && Number.isFinite(r.fields.amount_usd)
          ? r.fields.amount_usd
          : typeof r.fields.amount === 'number' && Number.isFinite(r.fields.amount)
            ? r.fields.amount
            : 0;
      const eur =
        typeof r.fields.amount_eur === 'number' && Number.isFinite(r.fields.amount_eur)
          ? r.fields.amount_eur
          : fxRate != null && usd !== 0
            ? convertUsdToEur(usd, fxRate)
            : 0;
      const cur = expensesByModel.get(modelId) ?? { expenses_usd: 0, expenses_eur: 0 };
      cur.expenses_usd += usd;
      cur.expenses_eur += eur;
      expensesByModel.set(modelId, cur);
    }

    const toPnlRow = (rec: { id: string; fields: PnlLinesRecordRaw }) =>
      rawToPnlRow(
        { id: rec.id, fields: rec.fields },
        settingsMap,
        rec.fields.month?.[0] ? monthNameById[rec.fields.month[0]] : undefined
      );
    const pnlActualRows = pnlActualRecords.map(toPnlRow);
    const pnlForecastRows = pnlForecastRecords.map(toPnlRow);

    const rowPerModel = includeForecast
      ? rowPerModelWithForecast(pnlActualRows, pnlForecastRows)
      : actualsOnlyPerModel(pnlActualRows);

    /** Weekly-based projection: modelId -> projected revenue (avg per week * 4). Only for models with no pnl row. */
    const weeklyProjectionByModel = new Map<string, number>();
    if (includeForecast && weeklyStatsBulk.length > 0 && weekIds.length > 0) {
      const weekIdSet = new Set(weekIds);
      const byModel = new Map<string, { sum: number; count: number }>();
      for (const rec of weeklyStatsBulk) {
        const wid = rec.fields.week?.[0] ?? '';
        if (!weekIdSet.has(wid)) continue;
        const mid = rec.fields.model?.[0] ?? '';
        if (!mid) continue;
        const net = rec.fields.net_revenue ?? rec.fields.gross_revenue ?? 0;
        const cur = byModel.get(mid) ?? { sum: 0, count: 0 };
        cur.sum += net;
        cur.count += 1;
        byModel.set(mid, cur);
      }
      for (const [mid, { sum, count }] of byModel) {
        if (count > 0) weeklyProjectionByModel.set(mid, (sum / count) * EXPECTED_WEEKS_PER_MONTH);
      }
    }

    const models: ModelOverviewRow[] = [];
    let totalRevenue = 0;
    let totalExpenses = 0;
    let totalProfit = 0;
    let marginSum = 0;
    let marginCount = 0;

    for (const rec of modelsRecords) {
      const modelId = rec.id;
      const row = rowPerModel.get(modelId);
      const name = rec.fields.name ?? modelId;
      const exp = expensesByModel.get(modelId) ?? { expenses_usd: 0, expenses_eur: 0 };
      const expenses_usd = exp.expenses_usd;
      const expenses_eur = exp.expenses_eur;

      if (!row) {
        const projectedRevenue = weeklyProjectionByModel.get(modelId);
        if (includeForecast && projectedRevenue != null && projectedRevenue > 0) {
          const net = projectedRevenue;
          const payout = getModelPayoutAmount(projectedRevenue, rec.fields);
          const profit = net - expenses_usd;
          totalRevenue += net;
          totalExpenses += expenses_usd;
          totalProfit += profit;
          models.push({
            model_id: modelId,
            model_name: name,
            revenue: net,
            expenses: expenses_usd,
            expenses_usd,
            expenses_eur,
            profit,
            margin: net > 0 ? profit / net : 0,
            payout,
            status: 'forecast',
            revenue_display: formatUsdDisplay(net),
            expenses_display: formatUsdDisplay(expenses_usd),
            expenses_eur_display: formatEurDisplay(expenses_eur),
            profit_display: formatUsdDisplay(profit),
            payout_display: payout != null ? formatUsdDisplay(payout) : undefined,
          });
        } else {
          totalExpenses += expenses_usd;
          totalProfit -= expenses_usd;
          models.push({
            model_id: modelId,
            model_name: name,
            revenue: 0,
            expenses: expenses_usd,
            expenses_usd,
            expenses_eur,
            profit: -expenses_usd,
            margin: 0,
            status: 'actual',
            revenue_display: formatUsdDisplay(0),
            expenses_display: formatUsdDisplay(expenses_usd),
            expenses_eur_display: formatEurDisplay(expenses_eur),
            profit_display: formatUsdDisplay(-expenses_usd),
          });
        }
        continue;
      }
      const netRev = row.net_revenue ?? 0;
      const hasNet = Number.isFinite(netRev) && netRev > 0;
      const revenue = hasNet ? netRev : 0;
      const profit = revenue - expenses_usd;
      const margin = revenue > 0 ? profit / revenue : 0;
      const payout = hasNet ? getModelPayoutAmount(netRev, rec.fields) : 0;
      totalRevenue += revenue;
      totalExpenses += expenses_usd;
      totalProfit += profit;
      if (revenue > 0) {
        marginSum += margin;
        marginCount += 1;
      }
      models.push({
        model_id: modelId,
        model_name: name,
        revenue,
        expenses: expenses_usd,
        expenses_usd,
        expenses_eur,
        profit,
        margin,
        payout,
        status: row.status ?? 'actual',
        revenue_display: formatUsdDisplay(revenue),
        expenses_display: formatUsdDisplay(expenses_usd),
        expenses_eur_display: formatEurDisplay(expenses_eur),
        profit_display: formatUsdDisplay(profit),
        payout_display: payout != null ? formatUsdDisplay(payout) : undefined,
      });
    }

    const totalExpensesEur = models.reduce((s, m) => s + m.expenses_eur, 0);
    const month_name = monthRec?.fields.month_name ?? monthRec?.fields.month_key ?? from_month_key;

    const payload: ModelsOverviewResponse = {
      month_key: from_month_key,
      month_name,
      totals: {
        revenue: totalRevenue,
        expenses: totalExpenses,
        expenses_eur: totalExpensesEur,
        profit: totalProfit,
        avg_margin: marginCount > 0 ? marginSum / marginCount : 0,
        revenue_display: formatUsdDisplay(totalRevenue),
        expenses_display: formatUsdDisplay(totalExpenses),
        expenses_eur_display: formatEurDisplay(totalExpensesEur),
        profit_display: formatUsdDisplay(totalProfit),
      },
      models,
    };

    const res = NextResponse.json(payload);
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    return serverError(reqId, e, { route: '/api/models/overview' });
  }
}
