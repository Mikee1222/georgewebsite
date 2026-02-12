import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, unauthorized, badRequest, conflict } from '@/lib/api-utils';
import { getFxRateDirect, convertEurToUsd, round2 } from '@/lib/fx';
import { listHourlyBasisForMemberMonth, createHourlyPayoutBasis } from '@/lib/airtable';

export const runtime = 'edge';

type Body = {
  month_id?: string;
  team_member_id?: string;
  hours_worked?: number;
  hourly_rate_eur?: number;
  total_eur?: number;
  notes?: string;
};

/**
 * POST /api/payout-lines/hourly
 * Validate, compute total_eur server-side, write to monthly_member_basis (basis_type=hourly).
 * Shows in payouts preview and agency master (live). No pnl_lines dependency.
 */
export async function POST(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return badRequest(reqId, 'Invalid JSON body');
  }

  const month_id = (body.month_id ?? '').trim();
  const team_member_id = (body.team_member_id ?? '').trim();
  if (!month_id) return badRequest(reqId, 'month_id is required');
  if (!team_member_id) return badRequest(reqId, 'team_member_id is required');

  const hours = typeof body.hours_worked === 'number' ? body.hours_worked : parseFloat(String(body.hours_worked ?? ''));
  const rate = typeof body.hourly_rate_eur === 'number' ? body.hourly_rate_eur : parseFloat(String(body.hourly_rate_eur ?? ''));

  if (!Number.isFinite(hours) || hours <= 0) {
    return badRequest(reqId, 'hours_worked must be a positive number');
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    return badRequest(reqId, 'hourly_rate_eur must be a positive number');
  }

  const total_eur = round2(hours * rate);

  const existing = await listHourlyBasisForMemberMonth(month_id, team_member_id);
  if (existing.length > 0) {
    return conflict(reqId, 'Duplicate hourly entry for this team member and month');
  }

  let fx_rate: number;
  try {
    fx_rate = await getFxRateDirect();
    if (!Number.isFinite(fx_rate) || fx_rate <= 0) {
      const origin = new URL(request.url).origin;
      const fxRes = await fetch(`${origin}/api/fx/usd-eur`, { headers: { Accept: 'application/json' } });
      if (fxRes.ok) {
        const data = (await fxRes.json()) as { rate?: number };
        if (typeof data?.rate === 'number' && data.rate > 0) fx_rate = data.rate;
      }
      if (!Number.isFinite(fx_rate) || fx_rate <= 0) fx_rate = 0.92;
    }
  } catch {
    fx_rate = 0.92;
  }
  const total_usd = convertEurToUsd(total_eur, fx_rate);

  const record = await createHourlyPayoutBasis({
    month_id,
    team_member_id,
    hours_worked: hours,
    hourly_rate_eur: rate,
    amount_eur: total_eur,
    amount_usd: total_usd,
    fx_rate,
  });

  if (typeof console !== 'undefined') {
    console.log('[api/payout-lines/hourly POST]', { month_id, team_member_id, total_eur, recordId: record.id });
  }

  const res = NextResponse.json({ ok: true, record_id: record.id, total_eur, total_usd, fx_rate }, { status: 201 });
  res.headers.set('request-id', reqId);
  return res;
}
