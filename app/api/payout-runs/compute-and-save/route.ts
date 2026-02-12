import { NextRequest, NextResponse } from 'next/server';
import {
  getRecord,
  getMonthKeyFromId,
  listTeamMembers,
  listMonthlyMemberBasis,
  getOrCreatePayoutRun,
  upsertPayoutLinesFromSummary,
  writeAuditLog,
} from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, serverError, unauthorized, badRequest } from '@/lib/api-utils';
import type { MonthsRecord } from '@/lib/types';

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

export const runtime = 'edge';

/** FINE: prefix in notes = fine (adjustment). */
function isFineBasis(notes: string | undefined): boolean {
  return String(notes ?? '').trim().startsWith('FINE:');
}

export async function POST(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const month_id = request.nextUrl.searchParams.get('month_id')?.trim();
  if (!month_id) return badRequest(reqId, 'month_id is required');

  try {
    const monthRec = await getRecord<MonthsRecord>('months', month_id);
    if (!monthRec) return badRequest(reqId, 'Month not found');
    const month_key = (monthRec.fields.month_key ?? '') || ((await getMonthKeyFromId(month_id)) ?? '');

    const [allMembers, basisRecords] = await Promise.all([
      listTeamMembers(),
      listMonthlyMemberBasis(month_key ? { month_id, month_key } : { month_id }),
    ]);

    const fx = await getFxRateDirect();
    const fxRate = fx?.rate ?? 1;

    const basisByMember: Record<
      string,
      { gross_usd: number; payout_pct: number; bonus_total: number; fine_total: number }
    > = {};
    for (const r of basisRecords) {
      const tmId = Array.isArray(r.fields.team_member) && r.fields.team_member[0] ? String(r.fields.team_member[0]) : '';
      if (!tmId) continue;
      const member = allMembers.find((m) => m.id === tmId);
      if (!member) continue;
      if (!basisByMember[tmId]) {
        basisByMember[tmId] = {
          gross_usd: 0,
          payout_pct: Number(member.fields.payout_percentage) || 0,
          bonus_total: 0,
          fine_total: 0,
        };
      }
      const type = String(r.fields.basis_type ?? '').trim();
      const amountUsd = typeof r.fields.amount_usd === 'number' ? r.fields.amount_usd : null;
      const amountEur = typeof r.fields.amount_eur === 'number' ? r.fields.amount_eur : null;
      const amount = Number(r.fields.amount) || 0;
      let value = 0;
      if (amountUsd != null) {
        value = amountUsd;
      } else if (amountEur != null && fxRate > 0) {
        // Convert EUR input to USD using fx_rate_usd_eur (EUR = USD * rate ⇒ USD = EUR / rate).
        value = amountEur / fxRate;
      } else {
        value = amount;
      }
      const notes = r.fields.notes ?? '';
      if (type === 'chatter_sales') {
        basisByMember[tmId].gross_usd += value;
        const pctFromNotes = /^PCT:(\d+(?:\.\d+)?)/im.exec(notes ?? '');
        if (pctFromNotes) basisByMember[tmId].payout_pct = Number(pctFromNotes[1]);
      } else if (type === 'bonus') {
        basisByMember[tmId].bonus_total += value;
      } else if (type === 'adjustment' && isFineBasis(notes)) {
        basisByMember[tmId].fine_total += value;
      }
    }

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
    for (const [team_member_id, row] of Object.entries(basisByMember)) {
      const base_payout_usd = (row.gross_usd * row.payout_pct) / 100;
      // row.bonus_total and row.fine_total are currently in whatever currency we stored.
      // For chatter_sales gross_usd we already ensured USD; for bonus/fine we may have EUR.
      const bonus_total_usd = row.bonus_total; // row.bonus_total is built from USD amounts (or EUR already converted upstream if needed)
      const fine_total_usd = row.fine_total;
      const final_payout_usd = base_payout_usd + bonus_total_usd - fine_total_usd;
      const final_payout_eur = Math.round(final_payout_usd * fxRate * 100) / 100;
      lines.push({
        team_member_id,
        gross_usd: row.gross_usd,
        payout_percentage: row.payout_pct,
        base_payout_usd,
        bonus_total_usd,
        fine_total_usd,
        final_payout_usd,
        final_payout_eur,
        fx_rate_usd_eur: fxRate,
      });
    }

    const run = await getOrCreatePayoutRun(month_id);
    await upsertPayoutLinesFromSummary(run.id, lines);

    await writeAuditLog({
      user_email: session.email,
      table: 'payout_runs',
      record_id: run.id,
      field_name: 'compute_and_save',
      old_value: '',
      new_value: JSON.stringify({ month_id, lines_count: lines.length }),
    });

    const res = NextResponse.json({
      ok: true,
      requestId: reqId,
      runId: run.id,
      month_id,
      month_key: month_key || undefined,
      lines_count: lines.length,
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/payout-runs/compute-and-save]', e);
    return serverError(reqId, e, { route: '/api/payout-runs/compute-and-save' });
  }
}
