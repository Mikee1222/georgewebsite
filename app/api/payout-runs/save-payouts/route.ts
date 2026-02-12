import { NextRequest, NextResponse } from 'next/server';
import { getOrCreatePayoutRun, upsertPayoutLinesFromSummary, writeAuditLog } from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, serverError, unauthorized, badRequest } from '@/lib/api-utils';

export const runtime = 'edge';

const FX_CACHE_MS = 10 * 60 * 1000;
const FRANKFURTER_URL = 'https://api.frankfurter.app/latest?from=USD&to=EUR';
let fxCache: { rate: number; asOf: string } | null = null;
let fxCacheTs = 0;

async function getFxRate(): Promise<number> {
  const now = Date.now();
  if (fxCache != null && now - fxCacheTs < FX_CACHE_MS) return fxCache.rate;
  try {
    const res = await fetch(process.env.FX_API_URL ?? FRANKFURTER_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return 1;
    const data = (await res.json()) as { rates?: { EUR?: number }; date?: string };
    const rate = data?.rates?.EUR;
    if (rate == null || typeof rate !== 'number' || rate <= 0) return 1;
    const asOf = typeof data?.date === 'string' ? data.date : new Date().toISOString().slice(0, 10);
    fxCache = { rate, asOf };
    fxCacheTs = now;
    return rate;
  } catch {
    return 1;
  }
}

export async function POST(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  let body: { month_id?: string; lines?: Array<{ member_id?: string; gross_usd?: number; payout_pct?: number; base_payout_usd?: number; bonus_total?: number; fine_total?: number }> };
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON body');
  }

  const month_id = body.month_id?.trim();
  if (!month_id) return badRequest(reqId, 'month_id is required');

  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  const lines: Array<{
    team_member_id: string;
    gross_usd: number;
    payout_percentage: number;
    base_payout_usd: number;
    bonus_total_usd: number;
    fine_total_usd: number;
    final_payout_usd: number;
    final_payout_eur: number;
    fx_rate_usd_eur: number;
  }> = [];

  const fxRate = await getFxRate();

  for (const row of rawLines) {
    const member_id = row.member_id?.trim();
    if (!member_id) continue;
    const gross_usd = Number(row.gross_usd) || 0;
    const payout_pct = Number(row.payout_pct) || 0;
    const base_payout_usd = Number(row.base_payout_usd) || 0;
    const bonus_total = Number(row.bonus_total) || 0;
    const fine_total = Number(row.fine_total) || 0;
    const final_payout_usd = base_payout_usd + bonus_total - fine_total;
    const final_payout_eur = Math.round(final_payout_usd * fxRate * 100) / 100;
    lines.push({
      team_member_id: member_id,
      gross_usd,
      payout_percentage: payout_pct,
      base_payout_usd,
      bonus_total_usd: bonus_total,
      fine_total_usd: fine_total,
      final_payout_usd,
      final_payout_eur,
      fx_rate_usd_eur: fxRate,
    });
  }

  try {
    const run = await getOrCreatePayoutRun(month_id);
    await upsertPayoutLinesFromSummary(run.id, lines);

    await writeAuditLog({
      user_email: session.email,
      table: 'payout_runs',
      record_id: run.id,
      field_name: 'save_payouts',
      old_value: '',
      new_value: JSON.stringify({ month_id, lines_count: lines.length }),
    });

    const res = NextResponse.json({
      ok: true,
      requestId: reqId,
      runId: run.id,
      month_id,
      lines_count: lines.length,
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/payout-runs/save-payouts]', e);
    return serverError(reqId, e, { route: '/api/payout-runs/save-payouts' });
  }
}
