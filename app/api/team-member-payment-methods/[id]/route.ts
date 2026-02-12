import { NextRequest, NextResponse } from 'next/server';
import { getRecord, updateTeamMemberPaymentMethod, deleteTeamMemberPaymentMethod } from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, serverError, unauthorized, badRequest, forbidden } from '@/lib/api-utils';
import type { TeamMemberPaymentMethod } from '@/lib/types';
import type { TeamMemberPaymentMethodRecord } from '@/lib/types';

export const runtime = 'edge';

const PAYOUT_METHOD_OPTIONS = ['revolut', 'revolut business', 'wise', 'bank transfer', 'paypal', 'other'];
const METHOD_LABEL_OPTIONS = ['primary', 'secondary'];
const STATUS_OPTIONS = ['active', 'inactive', 'pending'];

function toNormalized(rec: { id: string; fields: TeamMemberPaymentMethodRecord; createdTime?: string }): TeamMemberPaymentMethod {
  const f = rec.fields;
  const teamMemberId = Array.isArray(f.team_member) && f.team_member[0] ? String(f.team_member[0]) : '';
  return {
    id: rec.id,
    team_member_id: teamMemberId,
    method_label: f.method_label ?? undefined,
    payout_method: f.payout_method ?? undefined,
    beneficiary_name: f.beneficiary_name ?? undefined,
    iban_or_account: f.iban_or_account ?? undefined,
    revtag: f.revtag ?? undefined,
    status: f.status ?? undefined,
    notes: f.notes ?? undefined,
    is_default: Boolean(f.is_default),
    created_at: f.created_at ?? rec.createdTime ?? undefined,
  };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const { id } = await params;
  if (!id?.trim()) return badRequest(reqId, 'id is required');

  let body: Partial<{
    method_label: string;
    payout_method: string;
    beneficiary_name: string;
    iban_or_account: string;
    revtag: string;
    status: string;
    notes: string;
    is_default: boolean;
  }>;
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON body');
  }
  if (body?.method_label && !METHOD_LABEL_OPTIONS.includes(body.method_label)) {
    return badRequest(reqId, `method_label must be one of: ${METHOD_LABEL_OPTIONS.join(', ')}`);
  }
  if (body?.payout_method && !PAYOUT_METHOD_OPTIONS.includes(body.payout_method)) {
    return badRequest(reqId, `payout_method must be one of: ${PAYOUT_METHOD_OPTIONS.join(', ')}`);
  }
  if (body?.status && !STATUS_OPTIONS.includes(body.status)) {
    return badRequest(reqId, `status must be one of: ${STATUS_OPTIONS.join(', ')}`);
  }

  try {
    const existing = await getRecord<TeamMemberPaymentMethodRecord>('team_member_payment_methods', id);
    if (!existing) return forbidden(reqId, 'Payment method not found');

    const updates: Parameters<typeof updateTeamMemberPaymentMethod>[1] = {};
    if (body?.method_label !== undefined) updates.method_label = body.method_label;
    if (body?.payout_method !== undefined) updates.payout_method = body.payout_method;
    if (body?.beneficiary_name !== undefined) updates.beneficiary_name = body.beneficiary_name;
    if (body?.iban_or_account !== undefined) updates.iban_or_account = body.iban_or_account;
    if (body?.revtag !== undefined) updates.revtag = body.revtag;
    if (body?.status !== undefined) updates.status = body.status;
    if (body?.notes !== undefined) updates.notes = body.notes;
    if (body?.is_default !== undefined) updates.is_default = body.is_default;

    if (Object.keys(updates).length === 0) {
      const res = NextResponse.json(toNormalized(existing));
      res.headers.set('request-id', reqId);
      return res;
    }

    const updated = await updateTeamMemberPaymentMethod(id, updates);
    const res = NextResponse.json(toNormalized(updated));
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/team-member-payment-methods/[id] PATCH]', e);
    return serverError(reqId, e, { route: '/api/team-member-payment-methods/[id]' });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(_request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const { id } = await params;
  if (!id?.trim()) return badRequest(reqId, 'id is required');

  try {
    const existing = await getRecord<TeamMemberPaymentMethodRecord>('team_member_payment_methods', id);
    if (!existing) return forbidden(reqId, 'Payment method not found');
    await deleteTeamMemberPaymentMethod(id);
    const res = NextResponse.json({ ok: true });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/team-member-payment-methods/[id] DELETE]', e);
    return serverError(reqId, e, { route: '/api/team-member-payment-methods/[id]' });
  }
}
