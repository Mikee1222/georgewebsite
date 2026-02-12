import { NextRequest, NextResponse } from 'next/server';
import {
  getMonths,
  getWeeksOverlappingMonth,
  getWeeklyStatsByModelAndWeeks,
  getWeeklyForecastsByModelAndWeeks,
  getModelForecastByUniqueKey,
  upsertModelForecast,
  listRecords,
} from '@/lib/airtable';
import type { WeeksRecord } from '@/lib/types';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, serverError, unauthorized, badRequest, conflict } from '@/lib/api-utils';
import { getFxRateDirect, convertUsdToEur } from '@/lib/fx';
import { getWeekShareInMonth } from '@/lib/proration';

export const runtime = 'edge';

const SCENARIOS = ['expected', 'conservative', 'aggressive'] as const;
const FALLBACK_N_WEEKS = 4;
const NET_FROM_GROSS_FACTOR = 0.8;

/** Derive base net USD from weekly stat (for fallback avg). */
function deriveBaseNetUsdFromStat(fields: {
  net_revenue?: number | null;
  computed_net_usd?: number | null;
  gross_revenue?: number | null;
  computed_gross_usd?: number | null;
}): number {
  if (typeof fields.net_revenue === 'number' && Number.isFinite(fields.net_revenue) && fields.net_revenue > 0) return fields.net_revenue;
  if (typeof fields.computed_net_usd === 'number' && Number.isFinite(fields.computed_net_usd) && fields.computed_net_usd > 0) return fields.computed_net_usd;
  const gross = typeof fields.gross_revenue === 'number' && Number.isFinite(fields.gross_revenue)
    ? fields.gross_revenue
    : (typeof fields.computed_gross_usd === 'number' && Number.isFinite(fields.computed_gross_usd) ? fields.computed_gross_usd : 0);
  return gross > 0 ? Math.round(gross * NET_FROM_GROSS_FACTOR * 100) / 100 : 0;
}

/**
 * POST /api/model-forecasts/recalculate
 * Body: { model_id, month_id, scenario }
 * Source: weekly_model_forecasts (prorate by overlap days). Fallback: avg from weekly_model_stats (latest N weeks).
 * If existing forecast is_locked -> 409.
 */
export async function POST(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON');
  }

  const model_id = typeof body.model_id === 'string' ? body.model_id.trim() : '';
  const month_id = typeof body.month_id === 'string' ? body.month_id.trim() : '';
  const scenario = body.scenario as string | undefined;

  if (!model_id || !month_id) return badRequest(reqId, 'model_id and month_id required');
  if (!scenario || !SCENARIOS.includes(scenario as (typeof SCENARIOS)[number])) {
    return badRequest(reqId, 'scenario must be expected, conservative, or aggressive');
  }

  const months = await getMonths();
  const monthRec = months.find((m) => m.id === month_id);
  const month_key = monthRec?.fields.month_key ?? '';
  if (!month_key) return badRequest(reqId, 'month_id not found');

  const uniqueKey = `${model_id}-${month_key}-${scenario}`;
  const existing = await getModelForecastByUniqueKey(uniqueKey);
  if (existing?.fields.is_locked === true) {
    return conflict(reqId, 'locked');
  }

  try {
    const weeks = await getWeeksOverlappingMonth(month_key);
    const weekIds = weeks.map((w) => w.id);
    if (weeks.length === 0) {
      const fx_rate = await getFxRateDirect();
      const fx_6 = Math.round(fx_rate * 1e6) / 1e6;
      const updated = await upsertModelForecast({
        modelId: model_id,
        monthId: month_id,
        monthKey: month_key,
        scenario: scenario as 'expected' | 'conservative' | 'aggressive',
        projected_net_usd: 0,
        projected_gross_usd: 0,
        projected_net_eur: 0,
        projected_gross_eur: 0,
        fx_rate_usd_eur: fx_6,
        source_type: 'auto',
        is_locked: existing?.fields.is_locked ?? false,
        notes: existing?.fields.notes ?? '',
      });
      const res = NextResponse.json({
        ok: true,
        requestId: reqId,
        forecast: {
          id: updated.id,
          scenario: updated.fields.scenario,
          projected_net_usd: 0,
          projected_gross_usd: 0,
          projected_net_eur: 0,
          projected_gross_eur: 0,
          fx_rate_usd_eur: fx_6,
          source_type: 'auto',
          is_locked: updated.fields.is_locked ?? false,
          notes: updated.fields.notes ?? '',
        },
      });
      res.headers.set('request-id', reqId);
      return res;
    }

    const weeklyForecasts = await getWeeklyForecastsByModelAndWeeks(model_id, weekIds);
    const forecastByWeekId = new Map<string, (typeof weeklyForecasts)[0]>();
    for (const r of weeklyForecasts) {
      const sc = (r.fields.scenario ?? '') as string;
      if (sc !== scenario) continue;
      const wid = Array.isArray(r.fields.week) ? r.fields.week[0] : '';
      if (wid) forecastByWeekId.set(wid, r);
    }

    const fxRate = await getFxRateDirect();
    let fallbackWeekUsd = 0;
    const recentWeeks = await listRecords<WeeksRecord>('weeks', {
      sort: [{ field: 'week_end', direction: 'desc' }],
      maxRecords: 52,
    });
    const recentWithEnd = recentWeeks
      .filter((r) => r.id && r.fields?.week_start && r.fields?.week_end)
      .map((r) => ({ id: r.id as string, week_end: (r.fields?.week_end ?? '') as string }));
    const recentWeekIds = recentWithEnd.map((w) => w.id);
    const weekEndById = new Map(recentWithEnd.map((w) => [w.id, w.week_end]));

    if (recentWeekIds.length > 0) {
      const recentStats = await getWeeklyStatsByModelAndWeeks(model_id, recentWeekIds);
      const withNet = recentStats
        .map((s) => {
          const wid = Array.isArray(s.fields.week) ? s.fields.week[0] : '';
          const net = deriveBaseNetUsdFromStat(s.fields);
          const weekEnd = wid ? (weekEndById.get(wid) ?? '') : '';
          return { weekId: wid, net, weekEnd };
        })
        .filter((x) => x.net > 0 && x.weekEnd)
        .sort((a, b) => b.weekEnd.localeCompare(a.weekEnd))
        .slice(0, FALLBACK_N_WEEKS);
      if (withNet.length > 0) {
        fallbackWeekUsd = withNet.reduce((sum, x) => sum + x.net, 0) / withNet.length;
        fallbackWeekUsd = Math.round(fallbackWeekUsd * 100) / 100;
      }
    }
    const fallbackWeekEur = Math.round(convertUsdToEur(fallbackWeekUsd, fxRate) * 100) / 100;

    let monthlyNetUsd = 0;
    let monthlyNetEur = 0;
    let usedFallback = false;

    for (const w of weeks) {
      const share = getWeekShareInMonth(w.week_start, w.week_end, month_key);
      if (share <= 0) continue;

      const f = forecastByWeekId.get(w.id);
      if (f) {
        const netUsd = (f.fields.projected_net_usd ?? 0) * share;
        const netEur = (f.fields.projected_net_eur ?? 0) * share;
        monthlyNetUsd += netUsd;
        monthlyNetEur += netEur;
      } else {
        usedFallback = true;
        monthlyNetUsd += fallbackWeekUsd * share;
        monthlyNetEur += fallbackWeekEur * share;
      }
    }

    monthlyNetUsd = Math.round(monthlyNetUsd * 100) / 100;
    monthlyNetEur = Math.round(monthlyNetEur * 100) / 100;

    let fx_rate_eur_per_usd: number;
    if (monthlyNetUsd > 0) {
      fx_rate_eur_per_usd = monthlyNetEur / monthlyNetUsd;
    } else {
      fx_rate_eur_per_usd = existing?.fields.fx_rate_usd_eur != null && Number.isFinite(existing.fields.fx_rate_usd_eur)
        ? existing.fields.fx_rate_usd_eur
        : fxRate;
    }
    fx_rate_eur_per_usd = Math.round(fx_rate_eur_per_usd * 1e6) / 1e6;

    const source_type = usedFallback ? 'hybrid' : 'auto';

    const projected_gross_usd = monthlyNetUsd > 0 ? Math.round((monthlyNetUsd / NET_FROM_GROSS_FACTOR) * 100) / 100 : 0;
    const projected_gross_eur = monthlyNetEur > 0 ? Math.round((monthlyNetEur / NET_FROM_GROSS_FACTOR) * 100) / 100 : 0;

    const updated = await upsertModelForecast({
      modelId: model_id,
      monthId: month_id,
      monthKey: month_key,
      scenario: scenario as 'expected' | 'conservative' | 'aggressive',
      projected_net_usd: monthlyNetUsd,
      projected_gross_usd,
      projected_net_eur: monthlyNetEur,
      projected_gross_eur,
      fx_rate_usd_eur: fx_rate_eur_per_usd,
      source_type,
      is_locked: existing?.fields.is_locked ?? false,
      notes: existing?.fields.notes ?? '',
    });

    const res = NextResponse.json({
      ok: true,
      requestId: reqId,
      forecast: {
        id: updated.id,
        scenario: updated.fields.scenario,
        projected_net_usd: updated.fields.projected_net_usd ?? 0,
        projected_gross_usd: updated.fields.projected_gross_usd ?? 0,
        projected_net_eur: updated.fields.projected_net_eur ?? 0,
        projected_gross_eur: updated.fields.projected_gross_eur ?? 0,
        fx_rate_usd_eur: updated.fields.fx_rate_usd_eur ?? 0,
        source_type: updated.fields.source_type,
        is_locked: updated.fields.is_locked ?? false,
        notes: updated.fields.notes ?? '',
      },
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/model-forecasts/recalculate]', e);
    return serverError(reqId, e, { route: '/api/model-forecasts/recalculate' });
  }
}
