import { NextRequest, NextResponse } from 'next/server';
import { getRecord, updateRecord, writeAuditLog } from '@/lib/airtable';
import { getSessionFromRequest, canEdit, financeCanEditModel } from '@/lib/auth';
import { PNL_INPUT_FIELDS, type PnlInputFieldName } from '@/lib/types';

export const runtime = 'edge';

/** Only input fields; never update computed fields or unique_key (formula). */
const ALLOWED_FIELDS = new Set<string>(PNL_INPUT_FIELDS);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canEdit(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { recordId } = await params;
  if (!recordId) return NextResponse.json({ error: 'recordId required' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
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
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No allowed fields to update' }, { status: 400 });
  }

  try {
    const existing = await getRecord<{ model?: string[] }>('pnl_lines', recordId);
    if (!existing) return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    const modelId = existing.fields.model?.[0] ?? '';
    if (!financeCanEditModel(session.role, modelId, session.allowed_model_ids)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    for (const [fieldName, newVal] of Object.entries(updates)) {
      const oldVal = (existing.fields as Record<string, unknown>)[fieldName];
      const oldStr = oldVal != null ? String(oldVal) : '';
      const newStr = newVal != null ? String(newVal) : '';
      if (oldStr === newStr) continue;
      await writeAuditLog({
        user_email: session.email,
        table: 'pnl_lines',
        record_id: recordId,
        field_name: fieldName,
        old_value: oldStr,
        new_value: newStr,
      });
    }

    const updated = await updateRecord('pnl_lines', recordId, updates);
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
