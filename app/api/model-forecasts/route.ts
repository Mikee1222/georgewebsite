import { NextRequest, NextResponse } from 'next/server';
import {
  getMonths,
  getModelForecastByUniqueKey,
  upsertModelForecast,
} from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, serverError, unauthorized, badRequest } from '@/lib/api-utils';
import { getFxRateForServer } from '@/lib/fx';
import { convertUsdToEur } from '@/lib/fx';
import type { ModelForecastScenario, ModelForecastSourceType } from '@/lib/types';

export const runtime = 'edge';

const SCENARIOS: ModelForecastScenario[] = ['expected', 'conservative', 'aggressive'];

/**
 * GET /api/model-forecasts?model_id=...&month_id=...&scenario=expected|conservative|aggressive
 * Returns one forecast row if exists, else null. Does not create.
 */
export async function GET(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const model_id = request.nextUrl.searchParams.get('model_id')?.trim();
  const month_id = request.nextUrl.searchParams.get('month_id')?.trim();
  const scenario = request.nextUrl.searchParams.get('scenario')?.trim() as ModelForecastScenario | undefined;

  if (!model_id || !month_id) return badRequest(reqId, 'model_id and month_id required');
  if (!scenario || !SCENARIOS.includes(scenario)) {
    return badRequest(reqId, 'scenario must be expected, conservative, or aggressive');
  }

  try {
    const months = await getMonths();
    const monthRec = months.find((m) => m.id === month_id);
    const month_key = monthRec?.fields.month_key ?? '';
    if (!month_key) {
      const res = NextResponse.json({ ok: true, requestId: reqId, forecast: null });
      res.headers.set('request-id', reqId);
      return res;
    }
    const uniqueKey = `${model_id}-${month_key}-${scenario}`;
    const record = await getModelForecastByUniqueKey(uniqueKey);
    if (!record) {
      const res = NextResponse.json({ ok: true, requestId: reqId, forecast: null });
      res.headers.set('request-id', reqId);
      return res;
    }
    const forecast = {
      id: record.id,
      scenario: record.fields.scenario ?? scenario,
      projected_net_usd: record.fields.projected_net_usd ?? 0,
      projected_gross_usd: record.fields.projected_gross_usd ?? 0,
      projected_net_eur: record.fields.projected_net_eur ?? 0,
      projected_gross_eur: record.fields.projected_gross_eur ?? 0,
      fx_rate_usd_eur: record.fields.fx_rate_usd_eur ?? 0,
      source_type: record.fields.source_type ?? ('auto' as ModelForecastSourceType),
      is_locked: record.fields.is_locked ?? false,
      notes: record.fields.notes ?? '',
    };
    const res = NextResponse.json({ ok: true, requestId: reqId, forecast });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/model-forecasts GET]', e);
    return serverError(reqId, e, { route: '/api/model-forecasts' });
  }
}

/**
 * POST /api/model-forecasts — upsert one scenario.
 * When record is_locked=true: do NOT overwrite USD values unless body sets is_locked=false (unlock) or only notes are being sent.
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
  const scenario = body.scenario as ModelForecastScenario | undefined;
  const sendingUnlock = body.is_locked === false;

  if (!model_id || !month_id) return badRequest(reqId, 'model_id and month_id required');
  if (!scenario || !SCENARIOS.includes(scenario)) {
    return badRequest(reqId, 'scenario must be expected, conservative, or aggressive');
  }

  const months = await getMonths();
  const monthRec = months.find((m) => m.id === month_id);
  const month_key = monthRec?.fields.month_key ?? '';
  if (!month_key) return badRequest(reqId, 'month_id not found');

  const uniqueKey = `${model_id}-${month_key}-${scenario}`;
  const existing = await getModelForecastByUniqueKey(uniqueKey);
  const isLocked = existing?.fields.is_locked ?? false;

  if (isLocked && !sendingUnlock) {
    const notes = typeof body.notes === 'string' ? body.notes : existing?.fields.notes ?? '';
    try {
      const updated = await upsertModelForecast({
        modelId: model_id,
        monthId: month_id,
        monthKey: month_key,
        scenario,
        projected_net_usd: existing?.fields.projected_net_usd,
        projected_gross_usd: existing?.fields.projected_gross_usd,
        projected_net_eur: existing?.fields.projected_net_eur,
        projected_gross_eur: existing?.fields.projected_gross_eur,
        fx_rate_usd_eur: existing?.fields.fx_rate_usd_eur,
        source_type: existing?.fields.source_type,
        is_locked: true,
        notes,
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
      if (process.env.NODE_ENV === 'development') console.error('[api/model-forecasts POST locked]', e);
      return serverError(reqId, e, { route: '/api/model-forecasts' });
    }
  }

  let fx_rate = typeof body.fx_rate_usd_eur === 'number' ? body.fx_rate_usd_eur : existing?.fields.fx_rate_usd_eur;
  if (fx_rate == null || !Number.isFinite(fx_rate) || fx_rate <= 0) {
    const origin = new URL(request.url).origin;
    const fx = await getFxRateForServer(origin);
    if (fx?.rate != null && fx.rate > 0) fx_rate = fx.rate;
  }
  if (fx_rate == null || !Number.isFinite(fx_rate) || fx_rate <= 0) {
    const fallback = process.env.FX_FALLBACK_RATE != null ? parseFloat(process.env.FX_FALLBACK_RATE) : 0.92;
    fx_rate = Number.isFinite(fallback) && fallback > 0 ? fallback : 0.92;
  }

  const projected_net_usd = typeof body.projected_net_usd === 'number' ? body.projected_net_usd : existing?.fields.projected_net_usd;
  const projected_gross_usd = typeof body.projected_gross_usd === 'number' ? body.projected_gross_usd : existing?.fields.projected_gross_usd;
  const projected_net_eur =
    typeof body.projected_net_eur === 'number'
      ? body.projected_net_eur
      : (projected_net_usd != null && Number.isFinite(projected_net_usd) ? convertUsdToEur(projected_net_usd, fx_rate) : existing?.fields.projected_net_eur);
  const projected_gross_eur =
    typeof body.projected_gross_eur === 'number'
      ? body.projected_gross_eur
      : (projected_gross_usd != null && Number.isFinite(projected_gross_usd) ? convertUsdToEur(projected_gross_usd, fx_rate) : existing?.fields.projected_gross_eur);

  const source_type =
    (body.source_type as ModelForecastSourceType) ??
    (existing?.fields.source_type ?? ('manual' as ModelForecastSourceType));
  const is_locked = typeof body.is_locked === 'boolean' ? body.is_locked : existing?.fields.is_locked ?? false;
  const notes = typeof body.notes === 'string' ? body.notes : existing?.fields.notes ?? '';

  try {
    const updated = await upsertModelForecast({
      modelId: model_id,
      monthId: month_id,
      monthKey: month_key,
      scenario,
      projected_net_usd: projected_net_usd ?? 0,
      projected_gross_usd: projected_gross_usd ?? 0,
      projected_net_eur: projected_net_eur ?? 0,
      projected_gross_eur: projected_gross_eur ?? 0,
      fx_rate_usd_eur: fx_rate,
      source_type,
      is_locked,
      notes,
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
    if (process.env.NODE_ENV === 'development') console.error('[api/model-forecasts POST]', e);
    return serverError(reqId, e, { route: '/api/model-forecasts' });
  }
}
