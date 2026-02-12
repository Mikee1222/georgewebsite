import { NextResponse } from 'next/server';
import { getSessionFromRequest, canEdit, canManageTeamMembers, canManageUsers, canManageModels } from '@/lib/auth';
import { requestId, unauthorized } from '@/lib/api-utils';

export const runtime = 'edge';

export async function GET(request: Request) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);
  const res = NextResponse.json({
    email: session.email,
    role: session.role,
    canEdit: canEdit(session.role),
    canManageMembers: canManageTeamMembers(session.role),
    canManageUsers: canManageUsers(session.role),
    canManageModels: canManageModels(session.role),
    allowed_model_ids: session.allowed_model_ids ?? [],
  });
  res.headers.set('request-id', reqId);
  return res;
}
