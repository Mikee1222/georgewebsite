import { NextRequest, NextResponse } from 'next/server';
import {
  getTeamMember,
  updateTeamMember,
  deleteTeamMember,
  writeAuditLog,
  listModelAssignmentsByTeamMember,
  upsertModelAssignments,
} from '@/lib/airtable';
import { getSessionFromRequest, canManageTeamMembers } from '@/lib/auth';
import { requestId, serverError, unauthorized, forbidden, badRequest } from '@/lib/api-utils';
import type { TeamMemberRecord, TeamMember, PayoutType, PayoutFrequency } from '@/lib/types';
import type { AirtableRecord } from '@/lib/types';

export const runtime = 'edge';

const PAYOUT_TYPES: PayoutType[] = ['percentage', 'flat_fee', 'hybrid', 'none'];
const PAYOUT_FREQUENCIES: PayoutFrequency[] = ['weekly', 'monthly'];

function toMember(rec: AirtableRecord<TeamMemberRecord>): TeamMember {
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
  const modelsScope = Array.isArray(f.models_scope) ? f.models_scope.filter((id): id is string => typeof id === 'string') : [];
  const linkedModels = Array.isArray(f.linked_models) ? f.linked_models.filter((id): id is string => typeof id === 'string') : [];
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

function validatePayout(
  body: {
    payout_type?: string;
    payout_percentage?: number;
    payout_flat_fee?: number;
    payout_frequency?: string;
    models_scope?: string[];
    role?: string;
  }
): { error?: string; payout_type: PayoutType; payout_percentage?: number; payout_flat_fee?: number; payout_frequency: PayoutFrequency; models_scope: string[] } {
  const payoutType = (body.payout_type && PAYOUT_TYPES.includes(body.payout_type as PayoutType)) ? (body.payout_type as PayoutType) : 'none';
  const role = typeof body.role === 'string' ? body.role : '';
  const isChattingManager = role.toLowerCase() === 'chatting_manager';

  if (payoutType === 'percentage') {
    const pct = typeof body.payout_percentage === 'number' ? body.payout_percentage : undefined;
    if (pct === undefined || pct === null) return { error: 'payout_percentage required when payout_type is percentage', payout_type: payoutType, payout_frequency: 'monthly', models_scope: [] };
    if (pct <= 0 || pct > 100) return { error: 'payout_percentage must be between 0 and 100', payout_type: payoutType, payout_frequency: 'monthly', models_scope: [] };
    const freq = body.payout_frequency && PAYOUT_FREQUENCIES.includes(body.payout_frequency as PayoutFrequency) ? (body.payout_frequency as PayoutFrequency) : 'monthly';
    const scope = Array.isArray(body.models_scope) ? body.models_scope.filter((id): id is string => typeof id === 'string' && id.trim().length > 0) : [];
    return { payout_type: payoutType, payout_percentage: pct, payout_frequency: freq, models_scope: isChattingManager ? scope : [] };
  }
  if (payoutType === 'flat_fee') {
    const flat = typeof body.payout_flat_fee === 'number' ? body.payout_flat_fee : undefined;
    if (flat === undefined || flat === null) return { error: 'payout_flat_fee required when payout_type is flat_fee', payout_type: payoutType, payout_frequency: 'monthly', models_scope: [] };
    if (flat < 0) return { error: 'payout_flat_fee must be >= 0', payout_type: payoutType, payout_frequency: 'monthly', models_scope: [] };
    const freq = body.payout_frequency && PAYOUT_FREQUENCIES.includes(body.payout_frequency as PayoutFrequency) ? (body.payout_frequency as PayoutFrequency) : 'monthly';
    const scope = Array.isArray(body.models_scope) ? body.models_scope.filter((id): id is string => typeof id === 'string' && id.trim().length > 0) : [];
    return { payout_type: payoutType, payout_flat_fee: flat, payout_frequency: freq, models_scope: isChattingManager ? scope : [] };
  }
  if (payoutType === 'hybrid') {
    const pct = typeof body.payout_percentage === 'number' ? body.payout_percentage : undefined;
    const flat = typeof body.payout_flat_fee === 'number' ? body.payout_flat_fee : undefined;
    if ((pct === undefined || pct === null) && (flat === undefined || flat === null)) return { error: 'hybrid requires at least one of payout_percentage or payout_flat_fee', payout_type: payoutType, payout_frequency: 'monthly', models_scope: [] };
    if (pct != null && (pct <= 0 || pct > 100)) return { error: 'payout_percentage must be between 0 and 100', payout_type: payoutType, payout_frequency: 'monthly', models_scope: [] };
    if (flat != null && flat < 0) return { error: 'payout_flat_fee must be >= 0', payout_type: payoutType, payout_frequency: 'monthly', models_scope: [] };
    const freq = body.payout_frequency && PAYOUT_FREQUENCIES.includes(body.payout_frequency as PayoutFrequency) ? (body.payout_frequency as PayoutFrequency) : 'monthly';
    const scopeHybrid = Array.isArray(body.models_scope) ? body.models_scope.filter((id): id is string => typeof id === 'string' && id.trim().length > 0) : [];
    return { payout_type: payoutType, payout_percentage: pct, payout_flat_fee: flat, payout_frequency: freq, models_scope: isChattingManager ? scopeHybrid : [] };
  }
  const scopeNone = Array.isArray(body.models_scope) ? body.models_scope.filter((id): id is string => typeof id === 'string' && id.trim().length > 0) : [];
  return { payout_type: 'none', payout_frequency: 'monthly', models_scope: isChattingManager ? scopeNone : [] };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(_request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const { id } = await params;
  if (!id) return badRequest(reqId, 'id required');

  try {
    const existing = await getTeamMember(id);
    if (!existing) {
      const res = NextResponse.json({ error: 'Record not found', requestId: reqId }, { status: 404 });
      res.headers.set('request-id', reqId);
      return res;
    }
    const member = toMember(existing as AirtableRecord<TeamMemberRecord>);
    const assignments = await listModelAssignmentsByTeamMember(id);
    const assigned_model_ids = assignments
      .map((r) => (Array.isArray(r.fields.model) && r.fields.model[0] ? r.fields.model[0] : ''))
      .filter(Boolean);
    const res = NextResponse.json({ ...member, assigned_model_ids });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    return serverError(reqId, e, { route: `/api/team-members/${id}` });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);
  if (!canManageTeamMembers(session.role)) return forbidden(reqId, 'Forbidden: admin only');

  const { id } = await params;
  if (!id) return badRequest(reqId, 'id required');

  const existing = await getTeamMember(id);
  if (!existing) {
    const res = NextResponse.json({ error: 'Record not found', requestId: reqId }, { status: 404 });
    res.headers.set('request-id', reqId);
    return res;
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON');
  }

  const existingFields = existing.fields as TeamMemberRecord;
  const updates: Partial<{
    name: string;
    email: string;
    role: string;
    department: string;
    status: string;
    notes: string;
    monthly_cost: number;
    model_id: string | null;
    linked_models: string[];
    affiliator_percentage: number;
    payout_type: PayoutType;
    payout_percentage: number;
    payout_flat_fee: number;
    payout_frequency: PayoutFrequency;
    models_scope: string[];
    payout_scope: 'agency_total_net' | 'messages_tips_net';
  }> = {};

  if (typeof body.name === 'string') updates.name = body.name;
  if (typeof body.email === 'string') updates.email = body.email;
  if (typeof body.role === 'string') updates.role = body.role;
  if (typeof body.department === 'string') updates.department = body.department;
  if (typeof body.status === 'string') updates.status = body.status;
  if (typeof body.notes === 'string') updates.notes = body.notes;
  if (typeof body.monthly_cost === 'number') updates.monthly_cost = body.monthly_cost;
  if (body.model_id !== undefined) updates.model_id = body.model_id === null || body.model_id === '' ? null : (body.model_id as string);
  if (body.linked_models !== undefined) {
    updates.linked_models = Array.isArray(body.linked_models)
      ? (body.linked_models as unknown[]).filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : [];
  }
  const assigned_model_ids = body.assigned_model_ids !== undefined && Array.isArray(body.assigned_model_ids)
    ? (body.assigned_model_ids as unknown[]).filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : undefined;

  const hasPayoutFields =
    body.payout_type !== undefined ||
    body.payout_percentage !== undefined ||
    body.payout_flat_fee !== undefined ||
    body.payout_frequency !== undefined ||
    body.models_scope !== undefined;
  if (hasPayoutFields) {
    const roleForValidation = (typeof body.role === 'string' ? body.role : existingFields.role) ?? '';
    const payoutResult = validatePayout({
      payout_type: body.payout_type as string,
      payout_percentage: body.payout_percentage as number,
      payout_flat_fee: body.payout_flat_fee as number,
      payout_frequency: body.payout_frequency as string,
      models_scope: body.models_scope as string[],
      role: roleForValidation,
    });
    if (payoutResult.error) {
      const res = NextResponse.json({ error: payoutResult.error, requestId: reqId }, { status: 400 });
      res.headers.set('request-id', reqId);
      return res;
    }
    updates.payout_type = payoutResult.payout_type;
    updates.payout_percentage = payoutResult.payout_percentage;
    updates.payout_flat_fee = payoutResult.payout_flat_fee;
    updates.payout_frequency = payoutResult.payout_frequency;
    updates.models_scope = payoutResult.models_scope;
  }

  if (typeof body.payout_scope === 'string') {
    const scope = body.payout_scope.trim();
    if (scope === 'agency_total_net' || scope === 'messages_tips_net') {
      updates.payout_scope = scope;
    }
  }

  if (Object.keys(updates).length === 0 && assigned_model_ids === undefined) return badRequest(reqId, 'No allowed fields to update');

  if (process.env.NODE_ENV === 'development') {
    console.log('[team-members PATCH] requestId:', reqId, 'id:', id, 'payload to Airtable:', JSON.stringify(updates));
  }
  try {
    if (Object.keys(updates).length > 0) {
      for (const [fieldName, newVal] of Object.entries(updates)) {
      const oldVal =
        fieldName === 'model_id' ? (existingFields.model?.[0] ?? null) : fieldName === 'models_scope' ? (existingFields.models_scope ?? []) : (existingFields as Record<string, unknown>)[fieldName];
      const oldStr = Array.isArray(oldVal) ? JSON.stringify(oldVal) : (oldVal != null ? String(oldVal) : '');
      const newStr = Array.isArray(newVal) ? JSON.stringify(newVal) : (newVal != null ? String(newVal) : '');
      if (oldStr !== newStr) {
        await writeAuditLog({
          user_email: session.email,
          table: 'team_members',
          record_id: id,
          field_name: fieldName === 'model_id' ? 'model' : fieldName,
          old_value: oldStr,
          new_value: newStr,
        });
      }
    }
    }
    const updated = Object.keys(updates).length > 0 ? await updateTeamMember(id, updates) : await getTeamMember(id);
    if (!updated) {
      const res = NextResponse.json({ error: 'Record not found', requestId: reqId }, { status: 404 });
      res.headers.set('request-id', reqId);
      return res;
    }
    if (assigned_model_ids !== undefined) {
      await upsertModelAssignments(id, assigned_model_ids);
    }
    if (process.env.NODE_ENV === 'development') {
      const u = updated as AirtableRecord<TeamMemberRecord>;
      console.log('[team-members PATCH] requestId:', reqId, 'Airtable response fields:', JSON.stringify(u.fields));
    }
    const out = toMember(updated as AirtableRecord<TeamMemberRecord>);
    if (assigned_model_ids !== undefined) {
      (out as TeamMember & { assigned_model_ids: string[] }).assigned_model_ids = assigned_model_ids;
    } else {
      const assignments = await listModelAssignmentsByTeamMember(id);
      (out as TeamMember & { assigned_model_ids: string[] }).assigned_model_ids = assignments
        .map((r) => (Array.isArray(r.fields.model) && r.fields.model[0] ? r.fields.model[0] : ''))
        .filter(Boolean);
    }
    const res = NextResponse.json(out);
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (process.env.NODE_ENV === 'development') {
      console.error('[team-members PATCH] requestId:', reqId, 'id:', id, 'Airtable error:', msg, e);
    }
    if (msg.includes('422') || msg.includes('UNKNOWN_FIELD_NAME')) {
      const res = NextResponse.json({ error: msg.replace(/^Airtable \d+:?\s*/i, '').trim() || 'Airtable validation error (invalid field)', requestId: reqId }, { status: 400 });
      res.headers.set('request-id', reqId);
      return res;
    }
    return serverError(reqId, e, { route: `/api/team-members/${id}` });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(_request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);
  if (!canManageTeamMembers(session.role)) return forbidden(reqId, 'Forbidden: admin only');

  const { id } = await params;
  if (!id) return badRequest(reqId, 'id required');

  const existing = await getTeamMember(id);
  if (!existing) {
    const res = NextResponse.json({ error: 'Record not found', requestId: reqId }, { status: 404 });
    res.headers.set('request-id', reqId);
    return res;
  }

  try {
    await writeAuditLog({
      user_email: session.email,
      table: 'team_members',
      record_id: id,
      field_name: 'delete',
      old_value: JSON.stringify({ name: existing.fields.name, role: existing.fields.role }),
      new_value: '',
    });
    await deleteTeamMember(id);
    const res = NextResponse.json({ ok: true });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    return serverError(reqId, e, { route: `/api/team-members/${id}` });
  }
}
