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
  /** When true, persist to Airtable (monthly_member_basis, basis_type=hourly). Requires month_id and team_member_id. */
  persist?: boolean;
};

/**
 * POST /api/hourly-payout-draft
 * Compute total_eur (hours * rate) and total_usd (using FX).
 * If body.persist === true: also write one record to monthly_member_basis (basis_type=hourly). Rejects duplicate for same member+month.
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

  const hours = typeof body.hours_worked === 'number' ? body.hours_worked : parseFloat(String(body.hours_worked ?? ''));
  const rate = typeof body.hourly_rate_eur === 'number' ? body.hourly_rate_eur : parseFloat(String(body.hourly_rate_eur ?? ''));

  if (!Number.isFinite(hours) || hours <= 0) {
    return badRequest(reqId, 'hours_worked must be a positive number');
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    return badRequest(reqId, 'hourly_rate_eur must be a positive number');
  }

  const total_eur = round2(hours * rate);

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
  } catch (e) {
    if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
      console.warn('[api/hourly-payout-draft] getFxRateDirect failed', e);
    }
    fx_rate = 0.92;
  }

  const total_usd = convertEurToUsd(total_eur, fx_rate);

  const persist = body.persist === true;
  if (persist) {
    const month_id = (body.month_id ?? '').trim();
    const team_member_id = (body.team_member_id ?? '').trim();
    if (!month_id) return badRequest(reqId, 'month_id is required when persist is true');
    if (!team_member_id) return badRequest(reqId, 'team_member_id is required when persist is true');

    const existing = await listHourlyBasisForMemberMonth(month_id, team_member_id);
    if (existing.length > 0) {
      return conflict(reqId, 'Duplicate hourly entry for this team member and month');
    }

    const record = await createHourlyPayoutBasis({
      month_id,
      team_member_id,
      hours_worked: hours,
      hourly_rate_eur: rate,
      amount_eur: total_eur,
      amount_usd: total_usd,
      fx_rate,
    });

    if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
      console.log('[api/hourly-payout-draft] persisted', {
        requestId: reqId,
        record_id: record.id,
        month_id,
        team_member_id,
        hours_worked: hours,
        hourly_rate_eur: rate,
        total_eur,
        total_usd,
        fx_rate,
      });
    }

    const res = NextResponse.json(
      {
        total_eur,
        total_usd,
        fx_rate,
        record_id: record.id,
      },
      { status: 201 }
    );
    res.headers.set('request-id', reqId);
    return res;
  }

  const res = NextResponse.json({
    total_eur,
    total_usd,
    fx_rate,
  });
  res.headers.set('request-id', reqId);
  return res;
}
