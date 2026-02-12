import { NextRequest, NextResponse } from 'next/server';
import {
  getWeeksOverlappingMonth,
  getWeeklyStatsByModelAndWeeks,
  upsertWeeklyModelStats,
  getSettings,
} from '@/lib/airtable';
import { getMonths } from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, serverError, unauthorized, badRequest } from '@/lib/api-utils';
import { convertUsdToEur, getFxRateForServer } from '@/lib/fx';
import { getOfFeePct } from '@/lib/business-rules';
import type { SettingsMap } from '@/lib/types';

export const runtime = 'edge';

/** Derive computed_gross_usd from raw fields (OF fee 20%). Fallback when Airtable formula not yet returned. */
function deriveComputedGross(gross?: number, net?: number): number {
  if (typeof gross === 'number' && Number.isFinite(gross)) return gross;
  if (typeof net === 'number' && Number.isFinite(net) && net > 0) return Math.round((net / 0.8) * 100) / 100;
  return 0;
}

/** Derive computed_net_usd from raw fields (OF fee 20%). Fallback when Airtable formula not yet returned. */
function deriveComputedNet(gross?: number, net?: number): number {
  if (typeof net === 'number' && Number.isFinite(net)) return net;
  if (typeof gross === 'number' && Number.isFinite(gross) && gross > 0) return Math.round((gross * 0.8) * 100) / 100;
  return 0;
}

/** GET /api/weekly-model-stats?model_id=...&month_id=... or &month_key=... (month_id can be Airtable id or YYYY-MM). */
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
    if (process.env.NODE_ENV === 'development') {
      console.log('[api/weekly-model-stats GET] resolved month_key:', resolvedMonthKey);
    }
    const weeks = await getWeeksOverlappingMonth(resolvedMonthKey);
    const weekIds = weeks.map((w) => w.id);
    if (process.env.NODE_ENV === 'development') {
      console.log('[api/weekly-model-stats GET] weekIds from weeks overlapping month:', weekIds.length, 'sample:', weekIds.slice(0, 3));
    }
    const stats = await getWeeklyStatsByModelAndWeeks(model_id, weekIds);
    const byWeek: Record<string, { id: string; model_id: string; week_id: string; gross_revenue: number; net_revenue: number; amount_usd: number; amount_eur: number; computed_gross_usd: number; computed_net_usd: number }> = {};
    for (const s of stats) {
      const weekId = (Array.isArray(s.fields.week) ? s.fields.week[0] : undefined) ?? '';
      if (!weekId) continue;
      const gross = s.fields.gross_revenue ?? 0;
      const net = s.fields.net_revenue ?? 0;
      const computedGross = typeof s.fields.computed_gross_usd === 'number' ? s.fields.computed_gross_usd : deriveComputedGross(gross, net);
      const computedNet = typeof s.fields.computed_net_usd === 'number' ? s.fields.computed_net_usd : deriveComputedNet(gross, net);
      byWeek[weekId] = {
        id: s.id,
        model_id,
        week_id: weekId,
        gross_revenue: gross,
        net_revenue: net,
        amount_usd: s.fields.amount_usd ?? 0,
        amount_eur: s.fields.amount_eur ?? 0,
        computed_gross_usd: computedGross,
        computed_net_usd: computedNet,
      };
    }
    const totals = Object.values(byWeek).reduce(
      (acc, s) => {
        acc.computed_gross_usd += s.computed_gross_usd ?? 0;
        acc.computed_net_usd += s.computed_net_usd ?? 0;
        acc.amount_eur += s.amount_eur ?? 0;
        return acc;
      },
      { computed_gross_usd: 0, computed_net_usd: 0, amount_eur: 0 }
    );
    const res = NextResponse.json({
      ok: true,
      requestId: reqId,
      sample: { weeks, stats: byWeek, totals },
      weeks,
      stats: byWeek,
      totals,
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/weekly-model-stats GET]', e);
    return serverError(reqId, e, { route: '/api/weekly-model-stats' });
  }
}

/** POST /api/weekly-model-stats — upsert. Body: { model_id, week_id, gross_revenue?, net_revenue? }. One of gross_revenue or net_revenue required. amount_usd/amount_eur derived. */
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
  const gross_revenue = typeof body.gross_revenue === 'number' ? body.gross_revenue : undefined;
  const net_revenue = typeof body.net_revenue === 'number' ? body.net_revenue : undefined;

  if (!model_id || !week_id) return badRequest(reqId, 'model_id and week_id required');

  const hasGross = gross_revenue != null && Number.isFinite(gross_revenue);
  const hasNet = net_revenue != null && Number.isFinite(net_revenue);
  if (hasGross && hasNet) return badRequest(reqId, 'Provide either gross_revenue or net_revenue, not both');
  if (!hasGross && !hasNet) return badRequest(reqId, 'One of gross_revenue or net_revenue required');

  const inputGross = hasGross ? gross_revenue! : undefined;
  const inputNet = hasNet ? net_revenue! : undefined;
  if ((inputGross ?? inputNet ?? 0) < 0) return badRequest(reqId, 'Amount must be ≥ 0');

  const settingsRows = await getSettings();
  const settingsMap: Partial<SettingsMap> = {};
  for (const r of settingsRows) {
    const name = r.setting_name as keyof SettingsMap;
    if (name && typeof r.value === 'number') settingsMap[name] = r.value;
  }
  const feePct = getOfFeePct(settingsMap);
  const oneMinusFee = 1 - feePct;

  let finalGross: number;
  let finalNet: number;
  if (hasGross) {
    finalGross = Math.round(inputGross! * 100) / 100;
    finalNet = oneMinusFee > 0 ? Math.round(finalGross * oneMinusFee * 100) / 100 : 0;
  } else {
    finalNet = Math.round(inputNet! * 100) / 100;
    finalGross = oneMinusFee > 0 ? Math.round((finalNet / oneMinusFee) * 100) / 100 : 0;
  }

  let rate: number | null = null;
  const origin = new URL(request.url).origin;
  const fx = await getFxRateForServer(origin);
  if (fx?.rate != null && fx.rate > 0) rate = fx.rate;
  if (rate == null) {
    const fallbackUrl = process.env.FX_API_URL ?? 'https://api.frankfurter.app/latest?from=USD&to=EUR';
    try {
      const res = await fetch(fallbackUrl, { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const data = (await res.json()) as { rates?: { EUR?: number } };
        const r = data?.rates?.EUR;
        if (typeof r === 'number' && r > 0) rate = r;
      }
    } catch {
      /* ignore */
    }
  }
  if (rate == null && process.env.FX_FALLBACK_RATE != null) {
    const r = parseFloat(process.env.FX_FALLBACK_RATE);
    if (Number.isFinite(r) && r > 0) rate = r;
  }
  if (rate == null) rate = 0.92;

  const amount_usd = finalNet;
  const amount_eur = rate > 0 ? convertUsdToEur(amount_usd, rate) : 0;

  const payload = {
    gross_revenue: finalGross,
    net_revenue: finalNet,
    amount_usd,
    amount_eur,
  };
  console.log('[api/weekly-model-stats POST] inputs:', { gross_revenue: inputGross, net_revenue: inputNet }, 'fee_pct:', feePct, 'computed:', { gross_revenue: finalGross, net_revenue: finalNet }, 'payload keys:', Object.keys(payload));

  try {
    const updated = await upsertWeeklyModelStats(model_id, week_id, payload);
    const gross = updated.fields.gross_revenue ?? 0;
    const net = updated.fields.net_revenue ?? 0;
    const computedGross = typeof updated.fields.computed_gross_usd === 'number' ? updated.fields.computed_gross_usd : deriveComputedGross(gross, net);
    const computedNet = typeof updated.fields.computed_net_usd === 'number' ? updated.fields.computed_net_usd : deriveComputedNet(gross, net);
    const record = {
      id: updated.id,
      model_id,
      week_id,
      gross_revenue: gross,
      net_revenue: net,
      amount_usd: updated.fields.amount_usd ?? 0,
      amount_eur: updated.fields.amount_eur ?? 0,
      computed_gross_usd: computedGross,
      computed_net_usd: computedNet,
    };
    const res = NextResponse.json({
      ok: true,
      requestId: reqId,
      sample: record,
      record,
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/weekly-model-stats POST]', e);
    return serverError(reqId, e, { route: '/api/weekly-model-stats' });
  }
}
