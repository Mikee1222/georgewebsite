import { NextRequest, NextResponse } from 'next/server';
import { getUser, updateUser, writeAuditLog } from '@/lib/airtable';
import { getSessionFromRequest, canManageUsers } from '@/lib/auth';
import { requestId, serverError, unauthorized, forbidden, badRequest } from '@/lib/api-utils';
import type { UsersRecord, Role } from '@/lib/types';
import type { AirtableRecord } from '@/lib/types';

export const runtime = 'edge';

function toUserPayload(rec: AirtableRecord<UsersRecord>) {
  const allowed = rec.fields.allowed_model_ids ?? '';
  const ids = typeof allowed === 'string' ? allowed.split(',').map((s) => s.trim()).filter(Boolean) : [];
  return {
    id: rec.id,
    email: rec.fields.email ?? '',
    role: (rec.fields.role as Role) ?? 'viewer',
    is_active: rec.fields.is_active ?? true,
    allowed_model_ids: ids,
    last_login_at: rec.fields.last_login_at ?? undefined,
  };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);
  if (!canManageUsers(session.role)) return forbidden(reqId, 'Forbidden: admin only');

  const { id } = await params;
  if (!id) return badRequest(reqId, 'id required');

  const existing = await getUser(id);
  if (!existing) {
    const res = NextResponse.json({ error: 'User not found', requestId: reqId }, { status: 404 });
    res.headers.set('request-id', reqId);
    return res;
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON');
  }

  const updates: Partial<{ role: Role; is_active: boolean; allowed_model_ids: string }> = {};
  if (body.role !== undefined) {
    if (!['admin', 'finance', 'viewer'].includes(body.role as string)) return badRequest(reqId, 'role must be admin, finance, or viewer');
    updates.role = body.role as Role;
  }
  if (body.is_active !== undefined) updates.is_active = Boolean(body.is_active);
  if (body.allowed_model_ids !== undefined) {
    updates.allowed_model_ids = Array.isArray(body.allowed_model_ids)
      ? (body.allowed_model_ids as string[]).join(',')
      : String(body.allowed_model_ids ?? '');
  }
  if (Object.keys(updates).length === 0) return badRequest(reqId, 'No allowed fields to update');

  try {
    for (const [fieldName, newVal] of Object.entries(updates)) {
      const oldVal = (existing.fields as Record<string, unknown>)[fieldName];
      const oldStr = oldVal != null ? String(oldVal) : '';
      const newStr = newVal != null ? String(newVal) : '';
      if (oldStr !== newStr) {
        await writeAuditLog({
          user_email: session.email,
          table: 'users',
          record_id: id,
          field_name: fieldName,
          old_value: oldStr,
          new_value: newStr,
        });
      }
    }
    const updated = await updateUser(id, updates);
    const res = NextResponse.json(toUserPayload(updated as AirtableRecord<UsersRecord>));
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/users PATCH]', e);
    return serverError(reqId, e, { route: `/api/users/${id}` });
  }
}
