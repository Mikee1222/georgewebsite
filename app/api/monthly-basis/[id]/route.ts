import { NextRequest, NextResponse } from 'next/server';
import { getRecord, updateMonthlyMemberBasis, deleteMonthlyMemberBasis, writeAuditLog } from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, serverError, unauthorized, badRequest, forbidden } from '@/lib/api-utils';
import { getFxRateForServer, ensureDualAmounts } from '@/lib/fx';
import type { MonthlyMemberBasisRecord } from '@/lib/types';

export const runtime = 'edge';

const PATCH_BODY_ALLOWED = new Set(['amount', 'amount_usd', 'gross_usd', 'amount_eur', 'notes', 'payout_pct', 'team_member_id']);

function assertNoUnknownBodyKeys(body: Record<string, unknown>, allowed: Set<string>, reqId: string): void {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw new Error(`[${reqId}] monthly-basis/[id]: body contains unknown field "${key}". Allowed: ${[...allowed].sort().join(', ')}`);
    }
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const { id } = await params;
  if (!id?.trim()) return badRequest(reqId, 'Record id is required');

  let body: { amount?: number; amount_usd?: number; gross_usd?: number; amount_eur?: number; notes?: string; payout_pct?: number; team_member_id?: string };
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON body');
  }
  if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
    try {
      assertNoUnknownBodyKeys(body as Record<string, unknown>, PATCH_BODY_ALLOWED, reqId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return badRequest(reqId, msg);
    }
  }

  const team_member_id = typeof body.team_member_id === 'string' ? body.team_member_id.trim() : undefined;
  const amount = body.amount !== undefined ? Number(body.amount) : undefined;
  const amount_usd = (body.amount_usd ?? body.gross_usd) !== undefined ? Number(body.amount_usd ?? body.gross_usd) : undefined;
  const amount_eur = body.amount_eur !== undefined ? Number(body.amount_eur) : undefined;
  const payout_pct = body.payout_pct !== undefined ? Number(body.payout_pct) : undefined;
  if (amount !== undefined && (Number.isNaN(amount) || amount < 0)) {
    return badRequest(reqId, 'amount must be a non-negative number');
  }
  if (amount_usd !== undefined && (Number.isNaN(amount_usd) || amount_usd < 0)) {
    return badRequest(reqId, 'amount_usd must be a non-negative number');
  }
  if (amount_eur !== undefined && (Number.isNaN(amount_eur) || amount_eur < 0)) {
    return badRequest(reqId, 'amount_eur must be a non-negative number');
  }
  if (payout_pct !== undefined && (Number.isNaN(payout_pct) || payout_pct < 0 || payout_pct > 100)) {
    return badRequest(reqId, 'payout_pct must be between 0 and 100');
  }

  try {
    const existing = await getRecord<MonthlyMemberBasisRecord>('monthly_member_basis', id);
    if (!existing) return forbidden(reqId, 'Record not found');

    const basisType = (existing.fields.basis_type ?? '') as string;
    const existingNotes = (existing.fields.notes ?? '').trim();
    const notesWithoutPct = existingNotes.includes('\n')
      ? existingNotes.split('\n').slice(1).join('\n').trim()
      : (/^PCT:[\d.]+$/i.test(existingNotes.split('\n')[0] ?? '') ? existingNotes.split('\n').slice(1).join('\n').trim() : existingNotes);

    let notesValue: string | undefined;
    if (body.notes !== undefined) notesValue = body.notes;
    else if (payout_pct !== undefined && basisType === 'chatter_sales') {
      notesValue = `PCT:${payout_pct}${notesWithoutPct ? `\n${notesWithoutPct}` : ''}`;
    }

    const fields: Partial<{ amount: number; amount_usd: number; amount_eur: number; notes: string; team_member: string[] }> = {};
    if (amount !== undefined) fields.amount = amount;
    if (amount_usd !== undefined) fields.amount_usd = amount_usd;
    if (amount_eur !== undefined) fields.amount_eur = amount_eur;
    if (notesValue !== undefined) fields.notes = notesValue;
    if (team_member_id) fields.team_member = [team_member_id];
    if (fields.amount_usd !== undefined || fields.amount_eur !== undefined) {
      const existingUsd = existing.fields.amount_usd as number | undefined;
      const existingEur = existing.fields.amount_eur as number | undefined;
      let payloadUsd = fields.amount_usd ?? existingUsd;
      let payloadEur = fields.amount_eur ?? existingEur;
      const origin = new URL(request.url).origin;
      const fx = await getFxRateForServer(origin);
      const { amount_usd: fu, amount_eur: fe } = ensureDualAmounts(payloadUsd, payloadEur, fx?.rate ?? null);
      payloadUsd = fu;
      payloadEur = fe;
      if (basisType === 'fine') {
        if (payloadEur > 0) payloadEur = -Math.abs(payloadEur);
        if (payloadUsd != null && payloadUsd > 0) payloadUsd = -Math.abs(payloadUsd);
      }
      fields.amount_usd = payloadUsd;
      fields.amount_eur = payloadEur;
      fields.amount = payloadEur;
    }
    if (Object.keys(fields).length === 0) {
      const res = NextResponse.json({ id, ...existing.fields });
      res.headers.set('request-id', reqId);
      return res;
    }

    const updated = await updateMonthlyMemberBasis(id, fields);
    await writeAuditLog({
      user_email: session.email,
      table: 'monthly_member_basis',
      record_id: id,
      field_name: 'update',
      old_value: JSON.stringify(existing.fields),
      new_value: JSON.stringify(fields),
    });
    const res = NextResponse.json({
      id: updated.id,
      ...updated.fields,
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/monthly-basis PATCH]', e);
    return serverError(reqId, e, { route: '/api/monthly-basis/[id]' });
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
  if (!id?.trim()) return badRequest(reqId, 'Record id is required');

  try {
    const existing = await getRecord<MonthlyMemberBasisRecord>('monthly_member_basis', id);
    if (!existing) return forbidden(reqId, 'Record not found');

    await deleteMonthlyMemberBasis(id);
    await writeAuditLog({
      user_email: session.email,
      table: 'monthly_member_basis',
      record_id: id,
      field_name: 'delete',
      old_value: JSON.stringify(existing.fields),
      new_value: '',
    });
    const res = NextResponse.json({ deleted: true, id });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/monthly-basis DELETE]', e);
    return serverError(reqId, e, { route: '/api/monthly-basis/[id]' });
  }
}
