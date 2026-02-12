import { NextRequest, NextResponse } from 'next/server';
import {
  getPnlByUniqueKey,
  createPnlLine,
  updatePnlLine,
  getMonths,
} from '@/lib/airtable';
import { getSessionFromRequest, canEdit, financeCanEditModel } from '@/lib/auth';
import { requestId, serverError, unauthorized, forbidden, badRequest } from '@/lib/api-utils';

export const runtime = 'edge';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** POST /api/pnl-lines — create actual pnl line. Body: { model_id, month_id, line_type, category?, amount_usd, notes? } */
export async function POST(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);
  if (!canEdit(session.role)) return forbidden(reqId);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON');
  }

  const model_id = typeof body.model_id === 'string' ? body.model_id.trim() : '';
  const month_id = typeof body.month_id === 'string' ? body.month_id.trim() : '';
  const line_type = body.line_type as 'revenue' | 'expense' | undefined;
  const amount_usd = typeof body.amount_usd === 'number' ? body.amount_usd : Number(body.amount_usd);
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';

  if (!model_id || !month_id) return badRequest(reqId, 'model_id and month_id required');
  if (!financeCanEditModel(session.role, model_id, session.allowed_model_ids)) {
    return forbidden(reqId);
  }
  if (line_type !== 'revenue') {
    return badRequest(reqId, 'expenses must be recorded in expense_entries');
  }
  if (!Number.isFinite(amount_usd) || amount_usd < 0) {
    return badRequest(reqId, 'amount_usd must be a non-negative number');
  }

  const months = await getMonths();
  const monthRec = months.find((m) => m.id === month_id);
  const month_key = monthRec?.fields.month_key ?? '';
  if (!month_key) return badRequest(reqId, 'month_id not found');

  const uniqueKey = `${model_id}-${month_key}-actual`;
  const existing = await getPnlByUniqueKey(uniqueKey);

  const fieldName = 'gross_revenue';
  const currentVal = existing ? ((existing.fields as Record<string, unknown>)[fieldName] as number) ?? 0 : 0;
  const newAmount = round2(currentVal + amount_usd);

  const fieldsToWrite: Record<string, unknown> = { [fieldName]: newAmount };
  if (notes !== '') fieldsToWrite.notes_issues = notes;

  try {
    let record: { id: string; fields: Record<string, unknown> };
    if (existing) {
      const updated = await updatePnlLine(existing.id, fieldsToWrite);
      record = { id: updated.id, fields: { ...(existing.fields as Record<string, unknown>), ...fieldsToWrite } };
    } else {
      const created = await createPnlLine({
        model_id,
        month_id,
        status: 'actual',
        fields: { [fieldName]: amount_usd, ...(notes !== '' ? { notes_issues: notes } : {}) },
      });
      record = { id: created.id, fields: created.fields as Record<string, unknown> };
    }

    const res = NextResponse.json({
      ok: true,
      requestId: reqId,
      sample: record,
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/pnl-lines POST]', e);
    return serverError(reqId, e, { route: '/api/pnl-lines' });
  }
}
