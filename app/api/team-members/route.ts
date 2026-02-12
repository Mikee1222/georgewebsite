import { NextRequest, NextResponse } from 'next/server';
import {
  listTeamMembers,
  createTeamMember,
  writeAuditLog,
  getModelAssignmentIdsByTeamMemberIds,
} from '@/lib/airtable';
import { getSessionFromRequest, canManageTeamMembers } from '@/lib/auth';
import { requestId, serverError, unauthorized, forbidden, badRequest } from '@/lib/api-utils';
import type { TeamMember, TeamMemberRecord, PayoutType, PayoutFrequency } from '@/lib/types';
import type { AirtableRecord } from '@/lib/types';

export const runtime = 'edge';

const PAYOUT_TYPES: PayoutType[] = ['percentage', 'flat_fee', 'hybrid', 'none'];
const PAYOUT_FREQUENCIES: PayoutFrequency[] = ['weekly', 'monthly'];

function toTeamMember(rec: AirtableRecord<TeamMemberRecord>): TeamMember {
  const f = rec.fields;
  const rawPayoutType = f.payout_type as string | undefined;
  const payoutType =
    rawPayoutType !== undefined && rawPayoutType !== '' && PAYOUT_TYPES.includes(rawPayoutType as PayoutType)
      ? (rawPayoutType as PayoutType)
      : 'none';
  const rawPayoutFreq = f.payout_frequency as string | undefined;
  const payoutFreq =
    rawPayoutFreq !== undefined && rawPayoutFreq !== '' && PAYOUT_FREQUENCIES.includes(rawPayoutFreq as PayoutFrequency)
      ? (rawPayoutFreq as PayoutFrequency)
      : 'monthly';
  const modelsScope = Array.isArray(f.models_scope)
    ? f.models_scope.filter((id): id is string => typeof id === 'string')
    : [];
  const linkedModels = Array.isArray(f.linked_models)
    ? f.linked_models.filter((id): id is string => typeof id === 'string')
    : [];
  return {
    id: rec.id,
    name: f.name ?? '',
    email: (f.email as string) ?? '',
    role: f.role ?? '',
    department: f.department ?? '',
    status: f.status ?? 'active',
    notes: f.notes ?? '',
    monthly_cost: f.monthly_cost,
    model_id: f.model?.[0],
    linked_models: linkedModels,
    payout_type: payoutType,
    payout_percentage: f.payout_percentage,
    payout_flat_fee: f.payout_flat_fee,
    payout_frequency: payoutType !== 'none' ? payoutFreq : 'monthly',
    models_scope: modelsScope,
    affiliator_percentage: f.affiliator_percentage,
    chatting_percentage: f.chatting_percentage,
    gunzo_percentage: f.gunzo_percentage,
    include_webapp_basis: f.include_webapp_basis,
    payout_scope: f.payout_scope,
  };
}

export async function GET(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  try {
    const url = request.nextUrl;
    const q = url.searchParams.get('q') ?? undefined;
    const department = url.searchParams.get('department') ?? undefined;
    const role = url.searchParams.get('role') ?? undefined;
    const status = url.searchParams.get('status') ?? undefined;
    const records = await listTeamMembers({ q, department, role, status });
    const members = records.map((r) => toTeamMember(r as AirtableRecord<TeamMemberRecord>));
    const ids = members.map((m) => m.id);
    const assignmentsByMember = await getModelAssignmentIdsByTeamMemberIds(ids);
    for (const m of members) {
      (m as TeamMember & { assigned_model_ids: string[] }).assigned_model_ids = assignmentsByMember[m.id] ?? [];
    }
    const res = NextResponse.json(members);
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    return serverError(reqId, e, { route: '/api/team-members' });
  }
}

export async function POST(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);
  if (!canManageTeamMembers(session.role)) return forbidden(reqId, 'Forbidden: admin only');

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON');
  }

  if (process.env.NODE_ENV === 'development') {
    console.log('[team-members POST] raw request body:', body);
  }

  const name = typeof body.name === 'string' ? body.name : '';
  const email = typeof body.email === 'string' ? body.email : undefined;
  const role = typeof body.role === 'string' ? body.role : '';
  const department = typeof body.department === 'string' ? body.department : '';
  const status = typeof body.status === 'string' ? body.status : undefined;
  const notes = typeof body.notes === 'string' ? body.notes : undefined;
  const monthly_cost = typeof body.monthly_cost === 'number' ? body.monthly_cost : undefined;
  const model_id = typeof body.model_id === 'string' ? body.model_id : undefined;
  const rawLinkedModels = Array.isArray(body.linked_models) ? (body.linked_models as unknown[]) : [];
  const linked_models = rawLinkedModels.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

  if (!name.trim()) return badRequest(reqId, 'name required');
  if (!role.trim()) return badRequest(reqId, 'role required');
  if (!department.trim()) return badRequest(reqId, 'department required');

  const roleLower = role.trim().toLowerCase();
  const deptLower = department.trim().toLowerCase();
  const isAffiliate = roleLower === 'affiliator' || deptLower === 'affiliate';
  const payoutTypeRaw = isAffiliate ? 'none' : (typeof body.payout_type === 'string' ? (body.payout_type as string) : 'none');
  const payout_type = PAYOUT_TYPES.includes(payoutTypeRaw as PayoutType)
    ? (payoutTypeRaw as PayoutType)
    : 'none';

  const isChatterFlow = roleLower === 'chatter';
  const isAffiliator = roleLower === 'affiliator';

  const pctChattersRaw =
    typeof body.payout_percentage_chatters === 'number' ? (body.payout_percentage_chatters as number) : undefined;
  const pctLegacy =
    typeof body.payout_percentage === 'number' ? (body.payout_percentage as number) : undefined;

  let payout_percentage_chatters: number | undefined;
  let chatting_percentage: number | undefined;
  let chatting_percentage_messages_tips: number | undefined;
  let gunzo_percentage: number | undefined;
  let gunzo_percentage_messages_tips: number | undefined;

  if (isChatterFlow) {
    if (pctLegacy != null) {
      return badRequest(reqId, 'payout_percentage is not allowed for chatter; use payout_percentage_chatters');
    }
    // For chatters we only accept payout_percentage_chatters
    const source = pctChattersRaw;
    if (
      (payout_type === 'percentage' || payout_type === 'hybrid') &&
      (source == null || Number.isNaN(source))
    ) {
      return badRequest(reqId, 'payout_percentage_chatters required when payout_type is percentage or hybrid');
    }
    if (source != null) {
      if (source < 0 || source > 100) {
        return badRequest(reqId, 'payout_percentage_chatters must be between 0 and 100');
      }
      payout_percentage_chatters = source;
    }
  } else {
    // Manager/bucket-based flow
    if (pctLegacy != null || pctChattersRaw != null) {
      return badRequest(
        reqId,
        'payout_percentage and payout_percentage_chatters are not allowed for manager roles; use bucket fields'
      );
    }
    const cp =
      typeof body.chatting_percentage === 'number' ? (body.chatting_percentage as number) : undefined;
    const cpMsgs =
      typeof body.chatting_percentage_messages_tips === 'number'
        ? (body.chatting_percentage_messages_tips as number)
        : undefined;
    const gp =
      typeof body.gunzo_percentage === 'number' ? (body.gunzo_percentage as number) : undefined;
    const gpMsgs =
      typeof body.gunzo_percentage_messages_tips === 'number'
        ? (body.gunzo_percentage_messages_tips as number)
        : undefined;

    chatting_percentage = cp;
    chatting_percentage_messages_tips = cpMsgs;
    gunzo_percentage = gp;
    gunzo_percentage_messages_tips = gpMsgs;

    const allPcts = [
      { key: 'chatting_percentage', value: chatting_percentage },
      { key: 'chatting_percentage_messages_tips', value: chatting_percentage_messages_tips },
      { key: 'gunzo_percentage', value: gunzo_percentage },
      { key: 'gunzo_percentage_messages_tips', value: gunzo_percentage_messages_tips },
    ];
    for (const { key, value } of allPcts) {
      if (value != null) {
        if (Number.isNaN(value) || value < 0 || value > 100) {
          return badRequest(reqId, `${key} must be between 0 and 100`);
        }
      }
    }

    // Double-counting guards
    if (
      (chatting_percentage ?? 0) > 0 &&
      (chatting_percentage_messages_tips ?? 0) > 0
    ) {
      return badRequest(
        reqId,
        'Cannot have both chatting_percentage and chatting_percentage_messages_tips > 0'
      );
    }
    if (
      (gunzo_percentage ?? 0) > 0 &&
      (gunzo_percentage_messages_tips ?? 0) > 0
    ) {
      return badRequest(
        reqId,
        'Cannot have both gunzo_percentage and gunzo_percentage_messages_tips > 0'
      );
    }
  }

  const flatFeeSource =
    typeof body.flat_fee === 'number'
      ? (body.flat_fee as number)
      : typeof body.payout_flat_fee === 'number'
      ? (body.payout_flat_fee as number)
      : undefined;
  if (flatFeeSource != null && flatFeeSource < 0) {
    return badRequest(reqId, 'payout_flat_fee must be >= 0');
  }
  if (payout_type === 'flat_fee' && (flatFeeSource == null || Number.isNaN(flatFeeSource))) {
    return badRequest(reqId, 'payout_flat_fee required when payout_type is flat_fee');
  }

  const rawModelsScope = Array.isArray(body.models_scope)
    ? (body.models_scope as unknown[])
    : [];
  const models_scope = rawModelsScope
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);

  const createPayload = {
    name: name.trim(),
    email: email ? email.trim() : undefined,
    role: role.trim(),
    department: department.trim(),
    status: (status?.trim() || 'active') as 'active' | 'inactive',
    notes: notes?.trim() ?? '',
    monthly_cost,
    model_id: model_id && model_id.trim() ? model_id.trim() : undefined,
    linked_models: !isAffiliate && linked_models.length > 0 ? linked_models : undefined,
    payout_type,
    payout_frequency: 'monthly' as PayoutFrequency,
    payout_percentage_chatters,
    chatting_percentage,
    chatting_percentage_messages_tips,
    gunzo_percentage,
    gunzo_percentage_messages_tips,
    payout_flat_fee: flatFeeSource,
    models_scope: models_scope.length > 0 ? models_scope : undefined,
    // payout_scope is deprecated for new creates; ignore if present
  };

  if (process.env.NODE_ENV === 'development') {
    console.log('[team-members POST] requestId:', reqId, 'createTeamMember payload:', createPayload);
  }

  try {
    const created = await createTeamMember(createPayload);
    if (process.env.NODE_ENV === 'development') {
      const c = created as AirtableRecord<TeamMemberRecord>;
      console.log(
        '[team-members POST] requestId:',
        reqId,
        'Airtable created record id:',
        c.id,
        'field keys:',
        Object.keys(c.fields)
      );
    }
    await writeAuditLog({
      user_email: session.email,
      table: 'team_members',
      record_id: (created as { id: string }).id,
      field_name: 'create',
      old_value: '',
      new_value: JSON.stringify({ name: name.trim(), role, department, status }),
    });
    const memberPayload = toTeamMember(created as AirtableRecord<TeamMemberRecord>);
    const res = NextResponse.json(memberPayload);
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (process.env.NODE_ENV === 'development') {
      console.error('[team-members POST] requestId:', reqId, 'Airtable error:', msg, e);
    }
    if (msg.includes('422') || msg.includes('UNKNOWN_FIELD_NAME')) {
      const res = NextResponse.json(
        {
          error:
            msg.replace(/^Airtable \d+:?\s*/i, '').trim() ||
            'Airtable validation error (invalid field)',
          requestId: reqId,
        },
        { status: 400 }
      );
      res.headers.set('request-id', reqId);
      return res;
    }
    return serverError(reqId, e, { route: '/api/team-members' });
  }
}

