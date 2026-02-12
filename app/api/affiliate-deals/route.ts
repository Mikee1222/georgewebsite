import { NextRequest, NextResponse } from 'next/server';
import {
  listAffiliateModelDeals,
  createAffiliateModelDeal,
  findAffiliateModelDealByAffiliatorAndModel,
  updateAffiliateModelDeal,
  toAffiliateModelDeal,
} from '@/lib/airtable';
import { getSessionFromRequest, canManageTeamMembers } from '@/lib/auth';
import { requestId, serverError, unauthorized, forbidden, badRequest } from '@/lib/api-utils';
import type { AirtableRecord } from '@/lib/types';
import type { AffiliateModelDealRecord } from '@/lib/types';

export const runtime = 'edge';

function toDeal(rec: AirtableRecord<AffiliateModelDealRecord>) {
  return toAffiliateModelDeal(rec as AirtableRecord<AffiliateModelDealRecord>);
}

export async function GET(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie') ?? null);
  if (!session) return unauthorized(reqId);

  try {
    const records = await listAffiliateModelDeals();
    const deals = records.map((r) => toDeal(r));
    const res = NextResponse.json(deals);
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    return serverError(reqId, e);
  }
}

export async function POST(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie') ?? null);
  if (!session) return unauthorized(reqId);
  if (!canManageTeamMembers(session.role)) return forbidden(reqId);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON');
  }

  const affiliator_id = typeof body.affiliator_id === 'string' ? body.affiliator_id.trim() : '';
  const model_id = typeof body.model_id === 'string' ? body.model_id.trim() : '';
  if (!affiliator_id || !model_id) return badRequest(reqId, 'affiliator_id and model_id are required');

  const percentage =
    typeof body.percentage === 'number'
      ? body.percentage
      : typeof body.percentage === 'string'
        ? parseFloat(body.percentage)
        : NaN;
  if (Number.isNaN(percentage) || percentage < 0 || percentage > 100)
    return badRequest(reqId, 'percentage must be a number between 0 and 100');
  const percentageRounded = Math.round(percentage * 100) / 100;

  const basis = body.basis === 'gross' || body.basis === 'net' ? body.basis : 'net';
  const is_active = body.is_active !== false;
  const start_month_id = typeof body.start_month_id === 'string' ? body.start_month_id.trim() || undefined : undefined;
  const end_month_id = typeof body.end_month_id === 'string' ? body.end_month_id.trim() || undefined : undefined;
  const notes = typeof body.notes === 'string' ? body.notes : undefined;

  try {
    if (process.env.NODE_ENV === 'development') {
      console.log('[affiliate-deals POST] params', { affiliator_id, model_id, percentage: percentageRounded, basis, is_active, start_month_id, end_month_id, notes });
    }
    const existing = await findAffiliateModelDealByAffiliatorAndModel(affiliator_id, model_id);
    if (existing) {
      const updated = await updateAffiliateModelDeal(existing.id, {
        percentage: percentageRounded,
        basis: basis as 'net' | 'gross',
        is_active,
        start_month_id: start_month_id ?? null,
        end_month_id: end_month_id ?? null,
        notes: notes ?? '',
      });
      const res = NextResponse.json(toDeal(updated));
      res.headers.set('request-id', reqId);
      return res;
    }
    const created = await createAffiliateModelDeal({
      affiliator_id,
      model_id,
      percentage: percentageRounded,
      basis: basis as 'net' | 'gross',
      is_active,
      start_month_id,
      end_month_id,
      notes,
    });
    const res = NextResponse.json(toDeal(created));
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    return serverError(reqId, e);
  }
}
