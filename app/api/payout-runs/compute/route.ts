import { NextRequest, NextResponse } from 'next/server';
import { getOrCreatePayoutRun, upsertPayoutLines, writeAuditLog } from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, serverError, unauthorized, badRequest } from '@/lib/api-utils';
import { computePreviewPayouts, previewLinesToUpsertPayload } from '@/lib/payout-compute';

export const runtime = 'edge';

const FX_CACHE_MS = 10 * 60 * 1000;
const FRANKFURTER_URL = 'https://api.frankfurter.app/latest?from=USD&to=EUR';
let fxCache: { rate: number; asOf: string } | null = null;
let fxCacheTs = 0;

async function getFxRateDirect(): Promise<{ rate: number; asOf: string } | null> {
  const now = Date.now();
  if (fxCache != null && now - fxCacheTs < FX_CACHE_MS) return fxCache;
  try {
    const res = await fetch(process.env.FX_API_URL ?? FRANKFURTER_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { rates?: { EUR?: number }; date?: string };
    const rate = data?.rates?.EUR;
    if (rate == null || typeof rate !== 'number' || rate <= 0) return null;
    const asOf = typeof data?.date === 'string' ? data.date : new Date().toISOString().slice(0, 10);
    fxCache = { rate, asOf };
    fxCacheTs = now;
    return fxCache;
  } catch {
    return null;
  }
}

/** POST /api/payout-runs/compute?month_id=xxx — compute and persist (preview + write). Kept for backwards compatibility. */
export async function POST(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const month_id = request.nextUrl.searchParams.get('month_id')?.trim();
  if (!month_id) return badRequest(reqId, 'month_id is required');

  try {
    const fx = await getFxRateDirect();
    const fxRate = fx?.rate ?? null;
    const { lines: previewLines, month_key } = await computePreviewPayouts(month_id, fxRate);

    const run = await getOrCreatePayoutRun(month_id);
    const payload = previewLinesToUpsertPayload(previewLines);
    const created = await upsertPayoutLines(run.id, payload);

    const linesOut = created.map((rec, i) => {
      const p = previewLines[i];
      return {
        id: rec.id,
        team_member_id: p.team_member_id,
        team_member_name: p.team_member_name,
        department: p.department,
        role: p.role,
        category: p.category,
        payout_type: p.payout_type,
        payout_percentage: p.payout_percentage,
        payout_flat_fee: p.payout_flat_fee,
        basis_webapp_amount: p.basis_webapp_amount,
        basis_manual_amount: p.basis_manual_amount,
        bonus_amount: p.bonus_amount,
        adjustments_amount: p.adjustments_amount,
        basis_total: p.basis_total,
        payout_amount: p.payout_amount,
        amount_eur: p.amount_eur,
        amount_usd: p.amount_usd,
        currency: p.currency,
        breakdown_json: p.breakdown_json,
      };
    });

    await writeAuditLog({
      user_email: session.email,
      table: 'payout_runs',
      record_id: run.id,
      field_name: 'compute',
      old_value: '',
      new_value: JSON.stringify({ month_id, lines_count: linesOut.length }),
    });

    const res = NextResponse.json({
      ok: true,
      requestId: reqId,
      sample: {
        runId: run.id,
        members: previewLines.length,
        lines: linesOut,
        run: {
          id: run.id,
          month_id,
          month_key,
          status: run.fields.status ?? 'draft',
          notes: run.fields.notes ?? '',
        },
      },
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/payout-runs/compute]', e);
    return serverError(reqId, e, { route: '/api/payout-runs/compute' });
  }
}
