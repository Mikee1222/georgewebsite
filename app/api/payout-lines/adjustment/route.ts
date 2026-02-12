import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, unauthorized, badRequest } from '@/lib/api-utils';
import { getFxRateDirect, convertEurToUsd, round2 } from '@/lib/fx';
import { createMonthlyMemberBasis } from '@/lib/airtable';

export const runtime = 'edge';

type Body = {
  month_id?: string;
  team_member_id?: string;
  type?: 'bonus' | 'fine';
  amount_eur?: number;
  notes?: string;
};

/**
 * POST /api/payout-lines/adjustment
 * Create a bonus (positive) or fine (negative) in monthly_member_basis.
 * Uses existing basis_type options only; no new Airtable schema.
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
  const type = body.type;
  if (!month_id) return badRequest(reqId, 'month_id is required');
  if (!team_member_id) return badRequest(reqId, 'team_member_id is required');
  if (type !== 'bonus' && type !== 'fine') return badRequest(reqId, 'type must be "bonus" or "fine"');

  const amountEurRaw = typeof body.amount_eur === 'number' ? body.amount_eur : parseFloat(String(body.amount_eur ?? ''));
  if (!Number.isFinite(amountEurRaw) || amountEurRaw <= 0) {
    return badRequest(reqId, 'amount_eur must be a positive number');
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

  const amount_eur = type === 'fine' ? -round2(Math.abs(amountEurRaw)) : round2(amountEurRaw);
  const amount_usd = type === 'fine' ? -Math.abs(convertEurToUsd(amountEurRaw, fx_rate)) : convertEurToUsd(amountEurRaw, fx_rate);
  const amount_usd_rounded = round2(amount_usd);
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';

  try {
    const record = await createMonthlyMemberBasis({
      month_id,
      team_member_id,
      basis_type: type,
      amount: amount_eur,
      amount_eur,
      amount_usd: amount_usd_rounded,
      notes: notes || '',
    });
    const res = NextResponse.json({ ok: true, record: { id: record.id, fields: record.fields } }, { status: 201 });
    res.headers.set('request-id', reqId);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('422') && (message.includes('INVALID_MULTIPLE_CHOICE') || message.includes('multiple choice'))) {
      return badRequest(
        reqId,
        'Add option "bonus" and/or "fine" to monthly_member_basis.basis_type in Airtable.'
      );
    }
    throw err;
  }
}
