import { NextRequest, NextResponse } from 'next/server';
import {
  listAllTeamMemberPaymentMethods,
  createTeamMemberPaymentMethod,
} from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, serverError, unauthorized, badRequest } from '@/lib/api-utils';
import type { TeamMemberPaymentMethod } from '@/lib/types';
import type { AirtableRecord } from '@/lib/types';
import type { TeamMemberPaymentMethodRecord } from '@/lib/types';

export const runtime = 'edge';

function toNormalized(rec: AirtableRecord<TeamMemberPaymentMethodRecord>): TeamMemberPaymentMethod {
  const f = rec.fields;
  const teamMemberArr = Array.isArray(f.team_member) ? f.team_member : [];
  const teamMemberId = teamMemberArr[0] ? String(teamMemberArr[0]).trim() : '';
  const modelArr = Array.isArray(f.model) ? f.model.map((x) => String(x).trim()) : [];
  return {
    id: rec.id,
    team_member_id: teamMemberId,
    team_member: teamMemberArr.map((x) => String(x).trim()).filter(Boolean),
    method_type: f.payout_method ?? undefined,
    label: (f.method_label ?? f.payout_method ?? '') as string,
    method_label: f.method_label ?? undefined,
    payout_method: f.payout_method ?? undefined,
    beneficiary_name: f.beneficiary_name ?? undefined,
    iban_or_account: f.iban_or_account ?? undefined,
    revtag: f.revtag ?? undefined,
    status: f.status ?? undefined,
    notes: f.notes ?? undefined,
    is_default: Boolean(f.is_default),
    created_at: f.created_at ?? rec.createdTime ?? undefined,
    ...(modelArr.length ? { model: modelArr } : {}),
  };
}

export async function GET(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const team_member_ids = request.nextUrl.searchParams.get('team_member_ids')?.trim();
  const model_ids = request.nextUrl.searchParams.get('model_ids')?.trim();
  const teamMemberIds = team_member_ids ? team_member_ids.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean) : [];
  const modelIds = model_ids ? model_ids.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean) : [];
  if (teamMemberIds.length === 0 && modelIds.length === 0) {
    return badRequest(reqId, 'team_member_ids or model_ids is required');
  }

  try {
    const records = await listAllTeamMemberPaymentMethods();
    const byTeamMemberId = new Map<string, TeamMemberPaymentMethod[]>();
    const byModelId = new Map<string, TeamMemberPaymentMethod[]>();
    const teamMemberIdSet = new Set(teamMemberIds);
    const modelIdSet = new Set(modelIds);

    for (const rec of records) {
      const f = rec.fields;
      const tmArr = Array.isArray(f.team_member) ? f.team_member.map((x) => String(x).trim()) : [];
      const modelArr = Array.isArray(f.model) ? f.model.map((x) => String(x).trim()) : [];
      const intersectsTeam = teamMemberIdSet.size > 0 && tmArr.some((tid) => teamMemberIdSet.has(tid));
      const intersectsModel = modelIdSet.size > 0 && modelArr.some((mid) => modelIdSet.has(mid));
      if (!intersectsTeam && !intersectsModel) continue;

      const m = toNormalized(rec);
      if (intersectsTeam) {
        for (const tid of tmArr) {
          if (!teamMemberIdSet.has(tid)) continue;
          if (!byTeamMemberId.has(tid)) byTeamMemberId.set(tid, []);
          if (!byTeamMemberId.get(tid)!.some((x) => x.id === m.id)) byTeamMemberId.get(tid)!.push(m);
        }
      }
      if (intersectsModel) {
        for (const mid of modelArr) {
          if (!modelIdSet.has(mid)) continue;
          if (!byModelId.has(mid)) byModelId.set(mid, []);
          if (!byModelId.get(mid)!.some((x) => x.id === m.id)) byModelId.get(mid)!.push(m);
        }
      }
    }

    const body: Record<string, TeamMemberPaymentMethod[]> = {};
    for (const id of teamMemberIds) body[id] = byTeamMemberId.get(id) ?? [];
    for (const id of modelIds) body[id] = byModelId.get(id) ?? [];
    const res = NextResponse.json(body);
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    return serverError(reqId, e, { route: '/api/team-member-payment-methods' });
  }
}

const PAYOUT_METHOD_OPTIONS = ['revolut', 'revolut business', 'wise', 'bank transfer', 'paypal', 'other'];
const METHOD_LABEL_OPTIONS = ['primary', 'secondary'];
const STATUS_OPTIONS = ['active', 'inactive', 'pending'];

export async function POST(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  let body: {
    team_member_id?: string;
    method_label?: string;
    payout_method?: string;
    beneficiary_name?: string;
    iban_or_account?: string;
    revtag?: string;
    status?: string;
    notes?: string;
    is_default?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON body');
  }
  const team_member_id = body.team_member_id?.trim();
  if (!team_member_id) return badRequest(reqId, 'team_member_id is required');
  if (body.method_label && !METHOD_LABEL_OPTIONS.includes(body.method_label)) {
    return badRequest(reqId, `method_label must be one of: ${METHOD_LABEL_OPTIONS.join(', ')}`);
  }
  if (body.payout_method && !PAYOUT_METHOD_OPTIONS.includes(body.payout_method)) {
    return badRequest(reqId, `payout_method must be one of: ${PAYOUT_METHOD_OPTIONS.join(', ')}`);
  }
  if (body.status && !STATUS_OPTIONS.includes(body.status)) {
    return badRequest(reqId, `status must be one of: ${STATUS_OPTIONS.join(', ')}`);
  }

  try {
    const rec = await createTeamMemberPaymentMethod({
      team_member_id,
      method_label: body.method_label,
      payout_method: body.payout_method,
      beneficiary_name: body.beneficiary_name,
      iban_or_account: body.iban_or_account,
      revtag: body.revtag,
      status: body.status,
      notes: body.notes,
      is_default: Boolean(body.is_default),
    });
    const out = toNormalized(rec);
    const res = NextResponse.json(out);
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    return serverError(reqId, e, { route: '/api/team-member-payment-methods' });
  }
}
