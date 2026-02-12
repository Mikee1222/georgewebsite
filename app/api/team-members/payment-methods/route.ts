import { NextRequest, NextResponse } from 'next/server';
import { listTeamMemberPaymentMethods } from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, unauthorized } from '@/lib/api-utils';
import type { TeamMemberPaymentMethod, TeamMemberPaymentMethodsResponse } from '@/lib/types';
import type { AirtableRecord } from '@/lib/types';
import type { TeamMemberPaymentMethodRecord } from '@/lib/types';

export const runtime = 'edge';

function toMethod(rec: AirtableRecord<TeamMemberPaymentMethodRecord>): TeamMemberPaymentMethod {
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

function sortMethods(methods: TeamMemberPaymentMethod[]): TeamMemberPaymentMethod[] {
  return [...methods].sort((a, b) => {
    if (a.is_default && !b.is_default) return -1;
    if (!a.is_default && b.is_default) return 1;
    const order = (m: TeamMemberPaymentMethod) =>
      m.method_label === 'primary' ? 0 : m.method_label === 'secondary' ? 1 : 2;
    if (order(a) !== order(b)) return order(a) - order(b);
    return (b.created_at ?? '').localeCompare(a.created_at ?? '');
  });
}

export async function GET(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const team_member_ids = request.nextUrl.searchParams.get('team_member_ids')?.trim();
  const ids = team_member_ids
    ? team_member_ids.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
    : [];

  let records: AirtableRecord<TeamMemberPaymentMethodRecord>[];
  try {
    records = await listTeamMemberPaymentMethods(ids);
  } catch (e) {
    console.error('[api/team-members/payment-methods]', e);
    const res = NextResponse.json({} as TeamMemberPaymentMethodsResponse);
    res.headers.set('request-id', reqId);
    return res;
  }

  const methodsByMember = new Map<string, TeamMemberPaymentMethod[]>();
  for (const rec of records) {
    const f = rec.fields;
    const memberId = Array.isArray(f.team_member) && f.team_member[0] ? String(f.team_member[0]) : '';
    if (!memberId) continue;
    if (!methodsByMember.has(memberId)) methodsByMember.set(memberId, []);
    methodsByMember.get(memberId)!.push(toMethod(rec));
  }

  const body: TeamMemberPaymentMethodsResponse = {};
  for (const memberId of ids) {
    const list = methodsByMember.get(memberId) ?? [];
    const sorted = sortMethods(list);
    const defaultMethod = sorted.find((m) => m.is_default) ?? sorted[0] ?? null;
    body[memberId] = { default: defaultMethod, methods: sorted };
  }

  const res = NextResponse.json(body);
  res.headers.set('request-id', reqId);
  return res;
}
