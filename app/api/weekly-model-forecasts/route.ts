import { NextRequest, NextResponse } from 'next/server';
import {
  getWeeksOverlappingMonth,
  getWeeklyForecastsByModelAndWeeks,
  upsertWeeklyForecast,
} from '@/lib/airtable';
import { getMonths } from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, serverError, unauthorized, badRequest } from '@/lib/api-utils';
import { getFxRateDirect } from '@/lib/fx';
import { convertUsdToEur } from '@/lib/fx';
import type { ModelForecastScenario } from '@/lib/types';

export const runtime = 'edge';

const SCENARIOS: ModelForecastScenario[] = ['expected', 'conservative', 'aggressive'];

/** GET /api/weekly-model-forecasts?model_id=...&month_id=... or &month_key=... */
export async function GET(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const model_id = request.nextUrl.searchParams.get('model_id')?.trim();
  let month_key = request.nextUrl.searchParams.get('month_key')?.trim();
  let month_id = request.nextUrl.searchParams.get('month_id')?.trim();

  if (!model_id) return badRequest(reqId, 'model_id required');
  if (!month_key && month_id && /^\d{4}-\d{2}$/.test(month_id)) {
    month_key = month_id;
    month_id = '';
  }
  let resolvedMonthKey = month_key;
  if (!resolvedMonthKey && month_id) {
    const months = await getMonths();
    const m = months.find((r) => r.id === month_id);
    resolvedMonthKey = m?.fields.month_key ?? '';
  }
  if (!resolvedMonthKey) return badRequest(reqId, 'month_key or month_id required');

  try {
    const weeks = await getWeeksOverlappingMonth(resolvedMonthKey);
    const weekIds = weeks.map((w) => w.id);
    const records = await getWeeklyForecastsByModelAndWeeks(model_id, weekIds);
    type ForecastRow = { id: string; scenario: string; projected_net_usd: number; projected_net_eur: number; projected_gross_usd: number | null; projected_gross_eur: number | null; fx_rate_usd_eur: number; source_type: string; is_locked: boolean; notes: string };
    const forecastsByWeek: Record<string, { expected?: ForecastRow; conservative?: ForecastRow; aggressive?: ForecastRow }> = {};
    const allowed = new Set<string>(['expected', 'conservative', 'aggressive']);
    for (const r of records) {
      const weekId = (Array.isArray(r.fields.week) ? r.fields.week[0] : undefined) ?? '';
      const scenario = ((r.fields.scenario ?? 'expected') as string).toLowerCase();
      if (!weekId || !allowed.has(scenario)) continue;
      if (!forecastsByWeek[weekId]) forecastsByWeek[weekId] = {};
      const row: ForecastRow = {
        id: r.id,
        scenario,
        projected_net_usd: r.fields.projected_net_usd ?? 0,
        projected_net_eur: r.fields.projected_net_eur ?? 0,
        projected_gross_usd: r.fields.projected_gross_usd ?? null,
        projected_gross_eur: r.fields.projected_gross_eur ?? null,
        fx_rate_usd_eur: r.fields.fx_rate_usd_eur ?? 0,
        source_type: r.fields.source_type ?? 'auto',
        is_locked: r.fields.is_locked ?? false,
        notes: r.fields.notes ?? '',
      };
      (forecastsByWeek[weekId] as Record<string, ForecastRow>)[scenario] = row;
    }
    const res = NextResponse.json({
      ok: true,
      requestId: reqId,
      weeks,
      forecastsByWeek,
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/weekly-model-forecasts GET]', e);
    return serverError(reqId, e, { route: '/api/weekly-model-forecasts' });
  }
}

/** POST /api/weekly-model-forecasts — manual save one row. Body: model_id, week_id, week_key, scenario, projected_net_usd?, is_locked?, notes? */
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
  const week_id = typeof body.week_id === 'string' ? body.week_id.trim() : '';
  const week_key = typeof body.week_key === 'string' ? body.week_key.trim() : '';
  const scenario = typeof body.scenario === 'string' && SCENARIOS.includes(body.scenario as ModelForecastScenario) ? (body.scenario as ModelForecastScenario) : 'expected';
  const projected_net_usd = typeof body.projected_net_usd === 'number' && Number.isFinite(body.projected_net_usd) ? body.projected_net_usd : undefined;
  const is_locked = typeof body.is_locked === 'boolean' ? body.is_locked : undefined;
  const notes = typeof body.notes === 'string' ? body.notes : undefined;

  if (!model_id || !week_id || !week_key) return badRequest(reqId, 'model_id, week_id, and week_key required');

  try {
    const rate = await getFxRateDirect();
    const rate6 = Math.round(rate * 1e6) / 1e6;
    const projected_net_eur = projected_net_usd != null && Number.isFinite(projected_net_usd) ? convertUsdToEur(projected_net_usd, rate) : undefined;

    const updated = await upsertWeeklyForecast(model_id, week_id, week_key, scenario, {
      projected_net_usd,
      projected_net_eur,
      fx_rate_usd_eur: rate6,
      source_type: 'manual',
      is_locked,
      notes,
    });

    const out = {
      id: updated.id,
      scenario: updated.fields.scenario ?? scenario,
      projected_net_usd: updated.fields.projected_net_usd ?? 0,
      projected_net_eur: updated.fields.projected_net_eur ?? 0,
      projected_gross_usd: updated.fields.projected_gross_usd ?? null,
      projected_gross_eur: updated.fields.projected_gross_eur ?? null,
      fx_rate_usd_eur: updated.fields.fx_rate_usd_eur ?? 0,
      source_type: updated.fields.source_type ?? 'manual',
      is_locked: updated.fields.is_locked ?? false,
      notes: updated.fields.notes ?? '',
    };
    const res = NextResponse.json({ ok: true, requestId: reqId, forecast: out });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/weekly-model-forecasts POST]', e);
    return serverError(reqId, e, { route: '/api/weekly-model-forecasts' });
  }
}
