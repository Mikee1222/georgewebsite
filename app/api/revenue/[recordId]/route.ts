import { NextRequest, NextResponse } from 'next/server';
import {
  getRecord,
  updateRevenueEntry,
  deleteRevenueEntry,
  writeAuditLog,
} from '@/lib/airtable';
import { getSessionFromRequest, canWriteRevenue } from '@/lib/auth';
import { getFxRateForServer, ensureDualAmounts } from '@/lib/fx';
import type { RevenueEntryRecord } from '@/lib/types';

export const runtime = 'edge';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { recordId } = await params;
  if (!recordId) return NextResponse.json({ error: 'recordId required' }, { status: 400 });

  const existing = await getRecord<RevenueEntryRecord>('revenue_entries', recordId);
  if (!existing) return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  const modelId = existing.fields.model?.[0] ?? '';
  if (!canWriteRevenue(session.role, modelId, session.allowed_model_ids)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const updates: Partial<{ amount: number; amount_usd: number; amount_eur: number; description: string; type: string; date: string }> = {};
  if (typeof body.amount === 'number') updates.amount = body.amount;
  if (typeof body.amount_usd === 'number') updates.amount_usd = body.amount_usd;
  if (typeof body.amount_eur === 'number') updates.amount_eur = body.amount_eur;
  if (typeof body.description === 'string') updates.description = body.description;
  if (typeof body.type === 'string') updates.type = body.type;
  if (typeof body.date === 'string') updates.date = body.date;
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No allowed fields to update' }, { status: 400 });
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
    updates.amount = finalUsd;
  }

  try {
    for (const [fieldName, newVal] of Object.entries(updates)) {
      const oldVal = (existing.fields as Record<string, unknown>)[fieldName];
      const oldStr = oldVal != null ? String(oldVal) : '';
      const newStr = newVal != null ? String(newVal) : '';
      if (oldStr !== newStr) {
        await writeAuditLog({
          user_email: session.email,
          table: 'revenue_entries',
          record_id: recordId,
          field_name: fieldName,
          old_value: oldStr,
          new_value: newStr,
        });
      }
    }
    const updated = await updateRevenueEntry(recordId, updates);
    return NextResponse.json({
      id: updated.id,
      model_id: updated.fields.model?.[0] ?? '',
      month_id: updated.fields.month?.[0] ?? '',
      type: updated.fields.type ?? '',
      amount: updated.fields.amount ?? 0,
      amount_usd: updated.fields.amount_usd,
      amount_eur: updated.fields.amount_eur,
      description: updated.fields.description ?? '',
      date: updated.fields.date ?? '',
      created_by: updated.fields.created_by ?? '',
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const session = await getSessionFromRequest(_request.headers.get('cookie'));
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { recordId } = await params;
  if (!recordId) return NextResponse.json({ error: 'recordId required' }, { status: 400 });

  const existing = await getRecord<RevenueEntryRecord>('revenue_entries', recordId);
  if (!existing) return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  const modelId = existing.fields.model?.[0] ?? '';
  if (!canWriteRevenue(session.role, modelId, session.allowed_model_ids)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    await writeAuditLog({
      user_email: session.email,
      table: 'revenue_entries',
      record_id: recordId,
      field_name: 'delete',
      old_value: JSON.stringify({
        type: existing.fields.type,
        amount: existing.fields.amount,
        month_id: existing.fields.month?.[0],
      }),
      new_value: '',
    });
    await deleteRevenueEntry(recordId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
