import { NextRequest, NextResponse } from 'next/server';
import {
  getRecord,
  updateExpense,
  deleteExpense,
  writeAuditLog,
} from '@/lib/airtable';
import { getSessionFromRequest, canWriteExpense } from '@/lib/auth';
import { requestId, serverError, unauthorized, forbidden, badRequest } from '@/lib/api-utils';
import { getFxRateForServer, ensureDualAmounts } from '@/lib/fx';
import type { ExpenseEntryRecord } from '@/lib/types';

export const runtime = 'edge';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const { recordId } = await params;
  if (!recordId) return badRequest(reqId, 'recordId required');

  const existing = await getRecord<ExpenseEntryRecord>('expense_entries', recordId);
  if (!existing) {
    const res = NextResponse.json({ error: 'Record not found', requestId: reqId }, { status: 404 });
    res.headers.set('request-id', reqId);
    return res;
  }

  const cost_owner_type = (existing.fields.cost_owner_type as 'model' | 'team_member' | 'agency') ?? 'agency';
  const modelId = existing.fields.model?.[0];
  if (!canWriteExpense(session.role, cost_owner_type, modelId, session.allowed_model_ids)) {
    return forbidden(reqId);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON');
  }

  const updates: Partial<{
    amount: number;
    amount_usd: number;
    amount_eur: number;
    category: string;
    department: string;
    description: string;
    vendor: string;
    date: string;
    receipt_url: string;
    model_id: string;
    team_member_id: string;
  }> = {};
  if (typeof body.amount === 'number') updates.amount = body.amount;
  if (typeof body.amount_usd === 'number') updates.amount_usd = body.amount_usd;
  if (typeof body.amount_eur === 'number') updates.amount_eur = body.amount_eur;
  if (typeof body.category === 'string') updates.category = body.category;
  if (typeof body.department === 'string') updates.department = body.department;
  if (typeof body.description === 'string') updates.description = body.description;
  if (typeof body.vendor === 'string') updates.vendor = body.vendor;
  if (typeof body.date === 'string') updates.date = body.date;
  if (typeof body.receipt_url === 'string') updates.receipt_url = body.receipt_url;
  if (body.model_id !== undefined) updates.model_id = typeof body.model_id === 'string' ? body.model_id : '';
  if (body.team_member_id !== undefined) updates.team_member_id = typeof body.team_member_id === 'string' ? body.team_member_id : '';
  if (Object.keys(updates).length === 0) {
    return badRequest(reqId, 'No allowed fields to update');
  }

  if (updates.amount_usd !== undefined || updates.amount_eur !== undefined) {
    const existingUsd = existing.fields.amount_usd as number | undefined;
    const existingEur = existing.fields.amount_eur as number | undefined;
    const payloadUsd = updates.amount_usd ?? existingUsd;
    const payloadEur = updates.amount_eur ?? existingEur;
    const origin = new URL(request.url).origin;
    const fx = await getFxRateForServer(origin);
    const { amount_usd: finalUsd, amount_eur: finalEur } = ensureDualAmounts(payloadUsd, payloadEur, fx?.rate ?? null);
    updates.amount_usd = finalUsd;
    updates.amount_eur = finalEur;
    updates.amount = finalEur;
  }

  try {
    for (const [fieldName, newVal] of Object.entries(updates)) {
      const oldVal = (existing.fields as Record<string, unknown>)[fieldName];
      const oldStr = oldVal != null ? String(oldVal) : '';
      const newStr = newVal != null ? String(newVal) : '';
      if (oldStr !== newStr) {
        await writeAuditLog({
          user_email: session.email,
          table: 'expense_entries',
          record_id: recordId,
          field_name: fieldName,
          old_value: oldStr,
          new_value: newStr,
        });
      }
    }
    const updated = await updateExpense(recordId, updates);
    const res = NextResponse.json({
      id: updated.id,
      month_id: updated.fields.month?.[0] ?? '',
      amount: updated.fields.amount ?? 0,
      amount_usd: updated.fields.amount_usd,
      amount_eur: updated.fields.amount_eur,
      category: updated.fields.category ?? '',
      department: updated.fields.department ?? '',
      cost_owner_type: updated.fields.cost_owner_type ?? 'agency',
      model_id: updated.fields.model?.[0] ?? '',
      team_member_id: updated.fields.team_member?.[0] ?? '',
      description: updated.fields.description ?? '',
      vendor: updated.fields.vendor ?? '',
      date: updated.fields.date ?? '',
      created_by: updated.fields.created_by ?? '',
      receipt_url: updated.fields.receipt_url ?? '',
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    return serverError(reqId, e, { route: `/api/expenses/${recordId}` });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(_request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const { recordId } = await params;
  if (!recordId) return badRequest(reqId, 'recordId required');

  const existing = await getRecord<ExpenseEntryRecord>('expense_entries', recordId);
  if (!existing) {
    const res = NextResponse.json({ error: 'Record not found', requestId: reqId }, { status: 404 });
    res.headers.set('request-id', reqId);
    return res;
  }

  const cost_owner_type = (existing.fields.cost_owner_type as 'model' | 'team_member' | 'agency') ?? 'agency';
  const modelId = existing.fields.model?.[0];
  if (!canWriteExpense(session.role, cost_owner_type, modelId, session.allowed_model_ids)) {
    return forbidden(reqId);
  }

  try {
    await writeAuditLog({
      user_email: session.email,
      table: 'expense_entries',
      record_id: recordId,
      field_name: 'delete',
      old_value: JSON.stringify({
        category: existing.fields.category,
        amount: existing.fields.amount,
        month_id: existing.fields.month?.[0],
        cost_owner_type: existing.fields.cost_owner_type,
      }),
      new_value: '',
    });
    await deleteExpense(recordId);
    const res = NextResponse.json({ ok: true });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    return serverError(reqId, e, { route: `/api/expenses/${recordId}` });
  }
}
