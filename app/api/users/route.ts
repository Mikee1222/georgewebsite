import { NextRequest, NextResponse } from 'next/server';
import { listUsers, createUser, writeAuditLog } from '@/lib/airtable';
import { hashPassword } from '@/lib/password';
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
    allowed_models_count: ids.length,
    last_login_at: rec.fields.last_login_at ?? undefined,
    created_at: rec.fields.created_at ?? undefined,
  };
}

export async function GET(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);
  if (!canManageUsers(session.role)) return forbidden(reqId, 'Forbidden: admin only');

  try {
    const records = await listUsers();
    const q = (request.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase();
    let list = records.map(toUserPayload);
    if (q) list = list.filter((u) => (u.email ?? '').toLowerCase().includes(q));
    const res = NextResponse.json(list);
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/users]', e);
    return serverError(reqId, e, { route: '/api/users' });
  }
}

export async function POST(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);
  if (!canManageUsers(session.role)) return forbidden(reqId, 'Forbidden: admin only');

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON');
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const role = (body.role as Role) ?? 'viewer';
  const is_active = body.is_active !== false;
  const password = typeof body.password === 'string' ? body.password : '';
  const allowed_model_ids = Array.isArray(body.allowed_model_ids)
    ? (body.allowed_model_ids as string[]).join(',')
    : typeof body.allowed_model_ids === 'string'
      ? body.allowed_model_ids
      : '';

  if (!email) return badRequest(reqId, 'email required');
  if (!['admin', 'finance', 'viewer'].includes(role)) return badRequest(reqId, 'role must be admin, finance, or viewer');
  if (!password || password.length < 8) return badRequest(reqId, 'password required (min 8 characters)');

  let password_hash: string;
  let password_salt: string;
  try {
    const hashed = await hashPassword(password);
    password_hash = hashed.password_hash;
    password_salt = hashed.password_salt;
  } catch (hashErr) {
    if (process.env.NODE_ENV === 'development') console.error('[api/users POST] hash error', hashErr);
    return serverError(reqId, hashErr, { route: '/api/users' });
  }

  try {
    const created = await createUser({
      email: email.toLowerCase(),
      role,
      is_active,
      password_hash,
      password_salt,
      allowed_model_ids: allowed_model_ids || undefined,
    });
    await writeAuditLog({
      user_email: session.email,
      table: 'users',
      record_id: created.id,
      field_name: 'create',
      old_value: '',
      new_value: JSON.stringify({ email: created.fields.email, role: created.fields.role }),
    });
    const res = NextResponse.json(toUserPayload(created as AirtableRecord<UsersRecord>));
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/users POST]', e);
    return serverError(reqId, e, { route: '/api/users' });
  }
}
