import { NextRequest, NextResponse } from 'next/server';
import {
  getAffiliateModelDeal,
  updateAffiliateModelDeal,
  deleteAffiliateModelDeal,
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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(_request.headers.get('cookie') ?? null);
  if (!session) return unauthorized(reqId);

  const { id } = await params;
  if (!id) return badRequest(reqId, 'id required');

  try {
    const existing = await getAffiliateModelDeal(id);
    if (!existing) {
      const res = NextResponse.json({ error: 'Record not found', requestId: reqId }, { status: 404 });
      res.headers.set('request-id', reqId);
      return res;
    }
    const res = NextResponse.json(toDeal(existing));
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    return serverError(reqId, e);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie') ?? null);
  if (!session) return unauthorized(reqId);
  if (!canManageTeamMembers(session.role)) return forbidden(reqId);

  const { id } = await params;
  if (!id) return badRequest(reqId, 'id required');

  const existing = await getAffiliateModelDeal(id);
  if (!existing) {
    const res = NextResponse.json({ error: 'Record not found', requestId: reqId }, { status: 404 });
    res.headers.set('request-id', reqId);
    return res;
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON');
  }

  const updates: Partial<{
    affiliator_id: string;
    model_id: string;
    percentage: number;
    basis: 'net' | 'gross';
    is_active: boolean;
    start_month_id: string | null;
    end_month_id: string | null;
    notes: string;
  }> = {};

  if (typeof body.affiliator_id === 'string') updates.affiliator_id = body.affiliator_id.trim();
  if (typeof body.model_id === 'string') updates.model_id = body.model_id.trim();
  if (typeof body.percentage === 'number') {
    if (body.percentage < 0 || body.percentage > 100) return badRequest(reqId, 'percentage must be 0–100');
    updates.percentage = Math.round(body.percentage * 100) / 100;
  } else if (typeof body.percentage === 'string') {
    const p = parseFloat(body.percentage);
    if (Number.isNaN(p) || p < 0 || p > 100) return badRequest(reqId, 'percentage must be 0–100');
    updates.percentage = Math.round(p * 100) / 100;
  }
  if (body.basis === 'net' || body.basis === 'gross') updates.basis = body.basis;
  if (typeof body.is_active === 'boolean') updates.is_active = body.is_active;
  if (body.start_month_id !== undefined) updates.start_month_id = typeof body.start_month_id === 'string' ? body.start_month_id.trim() || null : null;
  if (body.end_month_id !== undefined) updates.end_month_id = typeof body.end_month_id === 'string' ? body.end_month_id.trim() || null : null;
  if (typeof body.notes === 'string') updates.notes = body.notes;

  if (Object.keys(updates).length === 0) {
    const res = NextResponse.json(existing ? toDeal(existing) : { error: 'Not found' });
    res.headers.set('request-id', reqId);
    return res;
  }

  try {
    const updated = await updateAffiliateModelDeal(id, updates);
    const res = NextResponse.json(toDeal(updated));
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    return serverError(reqId, e);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(_request.headers.get('cookie') ?? null);
  if (!session) return unauthorized(reqId);
  if (!canManageTeamMembers(session.role)) return forbidden(reqId);

  const { id } = await params;
  if (!id) return badRequest(reqId, 'id required');

  const existing = await getAffiliateModelDeal(id);
  if (!existing) {
    const res = NextResponse.json({ error: 'Record not found', requestId: reqId }, { status: 404 });
    res.headers.set('request-id', reqId);
    return res;
  }

  try {
    await deleteAffiliateModelDeal(id);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return serverError(reqId, e);
  }
}
