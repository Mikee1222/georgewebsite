import { NextRequest, NextResponse } from 'next/server';
import {
  getMonths,
  getWeeksOverlappingMonth,
  getWeeklyStatsByModelAndWeeks,
  getWeeklyForecastsByModelAndWeeks,
  upsertWeeklyForecast,
  getSettings,
} from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, serverError, unauthorized, badRequest } from '@/lib/api-utils';
import { convertUsdToEur, getFxRateDirect } from '@/lib/fx';
import { getOfFeePct } from '@/lib/business-rules';
import type { SettingsMap } from '@/lib/types';

export const runtime = 'edge';

const SCENARIOS = ['expected', 'conservative', 'aggressive'] as const;
const MULTIPLIERS: Record<(typeof SCENARIOS)[number], number> = { expected: 1, conservative: 0.85, aggressive: 1.15 };

const NET_FROM_GROSS_FACTOR = 0.8;

/**
 * Derive base_net_usd from a weekly_model_stats record.
 * Prefer net_revenue > 0, else computed_net_usd > 0, else gross * 0.8.
 */
function deriveBaseNetUsdFromStat(fields: {
  net_revenue?: number | null;
  computed_net_usd?: number | null;
  gross_revenue?: number | null;
  computed_gross_usd?: number | null;
}): number {
  const netRev = typeof fields.net_revenue === 'number' && Number.isFinite(fields.net_revenue) && fields.net_revenue > 0 ? fields.net_revenue : null;
  if (netRev != null) return netRev;
  const computed = typeof fields.computed_net_usd === 'number' && Number.isFinite(fields.computed_net_usd) && fields.computed_net_usd > 0 ? fields.computed_net_usd : null;
  if (computed != null) return computed;
  const gross = typeof fields.gross_revenue === 'number' && Number.isFinite(fields.gross_revenue) ? fields.gross_revenue : (typeof fields.computed_gross_usd === 'number' && Number.isFinite(fields.computed_gross_usd) ? fields.computed_gross_usd : 0);
  return gross > 0 ? Math.round(gross * NET_FROM_GROSS_FACTOR * 100) / 100 : 0;
}

/**
 * POST /api/models/[id]/weekly-forecast/recalculate
 * Body: { month_id? } or { month_key? }. For each week overlapping month: base from weekly_model_stats (net canonical),
 * 3 scenarios (expected 1.0, conservative 0.85, aggressive 1.15); upsert when not locked.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const { id: modelId } = await context.params;
  if (!modelId?.trim()) return badRequest(reqId, 'model id required');

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // optional body
  }

  let resolvedMonthKey = typeof body.month_key === 'string' ? body.month_key.trim() : '';
  const month_id = typeof body.month_id === 'string' ? body.month_id.trim() : '';
  if (!resolvedMonthKey && month_id) {
    if (/^\d{4}-\d{2}$/.test(month_id)) {
      resolvedMonthKey = month_id;
    } else {
      const months = await getMonths();
      const m = months.find((r) => r.id === month_id);
      resolvedMonthKey = m?.fields.month_key ?? '';
    }
  }
  if (!resolvedMonthKey) return badRequest(reqId, 'month_id or month_key required');

  try {
    const weeks = await getWeeksOverlappingMonth(resolvedMonthKey);
    const weekIds = weeks.map((w) => w.id);
    if (weeks.length === 0) {
      const res = NextResponse.json({
        ok: true,
        requestId: reqId,
        created: 0,
        updated: 0,
        skipped_locked: 0,
      });
      res.headers.set('request-id', reqId);
      return res;
    }

    const settingsRows = await getSettings();
    const settingsMap: Partial<SettingsMap> = {};
    for (const r of settingsRows) {
      const name = r.setting_name as keyof SettingsMap;
      if (name && typeof r.value === 'number') settingsMap[name] = r.value;
    }
    const feePctRaw = getOfFeePct(settingsMap);
    const feePct = typeof feePctRaw === 'number' && feePctRaw >= 1 ? feePctRaw / 100 : (feePctRaw ?? 0.2);
    const oneMinusFee = 1 - feePct;

    const stats = await getWeeklyStatsByModelAndWeeks(modelId, weekIds);
    const statByWeekId = new Map<string, (typeof stats)[0]>();
    for (const s of stats) {
      const wid = Array.isArray(s.fields.week) ? s.fields.week[0] : '';
      if (wid) statByWeekId.set(wid, s);
    }

    const fxRate = await getFxRateDirect();
    const rate6 = Math.round(fxRate * 1e6) / 1e6;

    const existingForecasts = await getWeeklyForecastsByModelAndWeeks(modelId, weekIds);
    const lockedSet = new Set<string>();
    for (const r of existingForecasts) {
      const wid = Array.isArray(r.fields.week) ? r.fields.week[0] : '';
      const sc = (r.fields.scenario ?? '') as string;
      if (wid && sc && r.fields.is_locked === true) lockedSet.add(`${wid}:${sc}`);
    }

    let created = 0;
    let updated = 0;
    let skipped_locked = 0;

    for (const target of weeks) {
      const stat = statByWeekId.get(target.id);
      const baseNetUsd = stat ? deriveBaseNetUsdFromStat(stat.fields) : 0;

      for (const scenario of SCENARIOS) {
        const key = `${target.id}:${scenario}`;
        if (lockedSet.has(key)) {
          skipped_locked++;
          continue;
        }
        const mult = MULTIPLIERS[scenario];
        const projected_net_usd = Math.round(baseNetUsd * mult * 100) / 100;
        const projected_net_eur = Math.round(convertUsdToEur(projected_net_usd, fxRate) * 100) / 100;
        const projected_gross_usd = oneMinusFee > 0 ? Math.round((projected_net_usd / oneMinusFee) * 100) / 100 : 0;
        const projected_gross_eur = Math.round(convertUsdToEur(projected_gross_usd, fxRate) * 100) / 100;

        console.log('[api/weekly-forecast/recalculate] weekId=', target.id, 'baseNetUsd=', baseNetUsd, 'feePct=', feePct, 'grossUsd=', projected_gross_usd, 'fx=', rate6, 'grossEur=', projected_gross_eur, 'scenario=', scenario);

        const payload = {
          projected_net_usd,
          projected_net_eur,
          projected_gross_usd,
          projected_gross_eur,
          fx_rate_usd_eur: rate6,
          source_type: 'auto' as const,
        };
        const existing = existingForecasts.find(
          (r) => (Array.isArray(r.fields.week) ? r.fields.week[0] : '') === target.id && (r.fields.scenario ?? '') === scenario
        );
        await upsertWeeklyForecast(modelId, target.id, target.week_key, scenario, payload);
        if (existing) updated++;
        else created++;
      }
    }

    const res = NextResponse.json({
      ok: true,
      requestId: reqId,
      created,
      updated,
      skipped_locked,
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/models/[id]/weekly-forecast/recalculate]', e);
    return serverError(reqId, e, { route: '/api/models/[id]/weekly-forecast/recalculate' });
  }
}
