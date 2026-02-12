import { NextRequest, NextResponse } from 'next/server';
import { getRecord, updateRecord, deletePnlLine, writeAuditLog } from '@/lib/airtable';
import { getSessionFromRequest, canEdit, financeCanEditModel } from '@/lib/auth';
import { requestId, serverError, unauthorized, forbidden, badRequest } from '@/lib/api-utils';
import { PNL_INPUT_FIELDS } from '@/lib/types';

export const runtime = 'edge';

const ALLOWED_FIELDS = new Set<string>(PNL_INPUT_FIELDS);

/** PATCH /api/pnl-lines/[id] — update pnl line. Body: { line_type?, category?, amount_usd?, notes? } or raw { gross_revenue?, salary?, ... } */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);
  if (!canEdit(session.role)) return forbidden(reqId);

  const { id: recordId } = await params;
  if (!recordId) return badRequest(reqId, 'id required');

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON');
  }

  let updates: Record<string, unknown> = {};
  const line_type = body.line_type as 'revenue' | 'expense' | undefined;
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const amount_usd = typeof body.amount_usd === 'number' ? body.amount_usd : Number(body.amount_usd);
  const notes = typeof body.notes === 'string' ? body.notes.trim() : undefined;

  if (line_type === 'expense') {
    return badRequest(reqId, 'expenses must be recorded in expense_entries');
  }
  if (line_type && line_type === 'revenue' && Number.isFinite(amount_usd) && amount_usd >= 0) {
    updates.gross_revenue = Math.round(amount_usd * 100) / 100;
  }
  if (notes !== undefined) updates.notes_issues = notes;

  if (Object.keys(updates).length === 0) {
    updates = {};
    for (const [key, value] of Object.entries(body)) {
      if (!ALLOWED_FIELDS.has(key)) continue;
      if (key === 'notes_issues') {
        updates[key] = typeof value === 'string' ? value : String(value ?? '');
      } else if (key !== 'notes_issues' && typeof value === 'number') {
        updates[key] = value;
      } else if (value === null || value === undefined || value === '') {
        updates[key] = null;
      }
    }
  }
  if (Object.keys(updates).length === 0) {
    return badRequest(reqId, 'No allowed fields to update');
  }

  try {
    const existing = await getRecord<{ model?: string[] }>('pnl_lines', recordId);
    if (!existing) {
      const res = NextResponse.json({ error: 'Record not found', requestId: reqId }, { status: 404 });
      res.headers.set('request-id', reqId);
      return res;
    }
    const modelId = existing.fields.model?.[0] ?? '';
    if (!financeCanEditModel(session.role, modelId, session.allowed_model_ids)) {
      return forbidden(reqId);
    }

    for (const [fieldName, newVal] of Object.entries(updates)) {
      const oldVal = (existing.fields as Record<string, unknown>)[fieldName];
      const oldStr = oldVal != null ? String(oldVal) : '';
      const newStr = newVal != null ? String(newVal) : '';
      if (oldStr === newStr) continue;
      await writeAuditLog({
        user_email: session.email ?? '',
        table: 'pnl_lines',
        record_id: recordId,
        field_name: fieldName,
        old_value: oldStr,
        new_value: newStr,
      });
    }

    const updated = await updateRecord('pnl_lines', recordId, updates);
    const res = NextResponse.json({
      ok: true,
      requestId: reqId,
      sample: updated,
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/pnl-lines PATCH]', e);
    return serverError(reqId, e, { route: '/api/pnl-lines/[id]' });
  }
}

/** DELETE /api/pnl-lines/[id] — delete pnl line. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);
  if (!canEdit(session.role)) return forbidden(reqId);

  const { id: recordId } = await params;
  if (!recordId) return badRequest(reqId, 'id required');

  try {
    const existing = await getRecord<{ model?: string[] }>('pnl_lines', recordId);
    if (!existing) {
      const res = NextResponse.json({ error: 'Record not found', requestId: reqId }, { status: 404 });
      res.headers.set('request-id', reqId);
      return res;
    }
    const modelId = existing.fields.model?.[0] ?? '';
    if (!financeCanEditModel(session.role, modelId, session.allowed_model_ids)) {
      return forbidden(reqId);
    }

    await deletePnlLine(recordId);
    const res = NextResponse.json({
      ok: true,
      requestId: reqId,
      sample: { id: recordId, deleted: true },
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/pnl-lines DELETE]', e);
    return serverError(reqId, e, { route: '/api/pnl-lines/[id]' });
  }
}
