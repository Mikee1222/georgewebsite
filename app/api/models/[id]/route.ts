import { NextRequest, NextResponse } from 'next/server';
import { getModel, updateModel, writeAuditLog } from '@/lib/airtable';
import { getSessionFromRequest, canManageModels } from '@/lib/auth';
import { requestId, serverError, unauthorized, forbidden, badRequest } from '@/lib/api-utils';
import type { ModelsRecord } from '@/lib/types';
import type { AirtableRecord } from '@/lib/types';

export const runtime = 'edge';

/** Soft-delete: set status to Inactive. No Airtable record removal. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(_request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);
  if (!canManageModels(session.role)) return forbidden(reqId, 'Forbidden: admin only');

  const { id } = await params;
  if (!id) return badRequest(reqId, 'id required');

  const existing = await getModel(id);
  if (!existing) {
    const res = NextResponse.json({ error: 'Model not found', requestId: reqId }, { status: 404 });
    res.headers.set('request-id', reqId);
    return res;
  }

  const currentStatus = (existing.fields.status ?? 'Active') as string;
  if (currentStatus !== 'Active') {
    const res = NextResponse.json({ error: 'Model is already inactive', requestId: reqId }, { status: 400 });
    res.headers.set('request-id', reqId);
    return res;
  }

  try {
    await writeAuditLog({
      user_email: session.email,
      table: 'models',
      record_id: id,
      field_name: 'status',
      old_value: currentStatus,
      new_value: 'Inactive',
    });
    const updated = await updateModel(id, { status: 'Inactive' });
    const res = NextResponse.json({
      id: updated.id,
      name: updated.fields.name ?? '',
      status: updated.fields.status ?? 'Active',
      compensation_type: updated.fields.compensation_type,
      creator_payout_pct: updated.fields.creator_payout_pct,
      salary_eur: updated.fields.salary_eur,
      salary_usd: updated.fields.salary_usd,
      deal_threshold: updated.fields.deal_threshold,
      deal_flat_under_threshold: updated.fields.deal_flat_under_threshold,
      deal_flat_under_threshold_usd: updated.fields.deal_flat_under_threshold_usd,
      deal_percent_above_threshold: updated.fields.deal_percent_above_threshold,
      notes: updated.fields.notes,
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/models DELETE]', e);
    return serverError(reqId, e, { route: `/api/models/${id}` });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);
  if (!canManageModels(session.role)) return forbidden(reqId, 'Forbidden: admin only');

  const { id } = await params;
  if (!id) return badRequest(reqId, 'id required');

  const existing = await getModel(id);
  if (!existing) {
    const res = NextResponse.json({ error: 'Model not found', requestId: reqId }, { status: 404 });
    res.headers.set('request-id', reqId);
    return res;
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON');
  }

  const COMP_TIERED_DEAL = 'Tiered deal (threshold)';
  const updates: Partial<{ name: string; status: string; compensation_type: string; creator_payout_pct: number; salary_eur: number; salary_usd: number; deal_threshold: number; deal_flat_under_threshold: number; deal_flat_under_threshold_usd: number; deal_percent_above_threshold: number; notes: string }> = {};
  if (typeof body.name === 'string') updates.name = body.name.trim();
  if (typeof body.status === 'string' && ['Active', 'Inactive', 'On Hold'].includes(body.status)) updates.status = body.status;
  if (typeof body.compensation_type === 'string') updates.compensation_type = body.compensation_type.trim();
  if (typeof body.creator_payout_pct === 'number') updates.creator_payout_pct = body.creator_payout_pct;
  if (typeof body.salary_eur === 'number') updates.salary_eur = body.salary_eur;
  if (typeof body.salary_usd === 'number') updates.salary_usd = body.salary_usd;
  if (typeof body.deal_threshold === 'number') updates.deal_threshold = body.deal_threshold;
  if (typeof body.deal_flat_under_threshold === 'number') updates.deal_flat_under_threshold = body.deal_flat_under_threshold;
  if (typeof body.deal_flat_under_threshold_usd === 'number') updates.deal_flat_under_threshold_usd = body.deal_flat_under_threshold_usd;
  if (typeof body.deal_percent_above_threshold === 'number') updates.deal_percent_above_threshold = body.deal_percent_above_threshold;
  if (typeof body.notes === 'string') updates.notes = body.notes;

  if (Object.keys(updates).length === 0) return badRequest(reqId, 'No allowed fields to update');

  const compType = (updates.compensation_type ?? existing.fields.compensation_type) as string | undefined;
  const effectivePct = updates.creator_payout_pct ?? existing.fields.creator_payout_pct;
  const effectiveSalaryEur = updates.salary_eur ?? existing.fields.salary_eur;
  const effectiveSalaryUsd = updates.salary_usd ?? existing.fields.salary_usd;
  const hasSalary = (effectiveSalaryEur != null && effectiveSalaryEur >= 0) || (effectiveSalaryUsd != null && effectiveSalaryUsd >= 0);
  const effectiveThreshold = updates.deal_threshold ?? existing.fields.deal_threshold;
  const effectiveFlatEur = updates.deal_flat_under_threshold ?? existing.fields.deal_flat_under_threshold;
  const effectiveFlatUsd = updates.deal_flat_under_threshold_usd ?? existing.fields.deal_flat_under_threshold_usd;
  const hasFlatTiered = (effectiveFlatEur != null && effectiveFlatEur >= 0) || (effectiveFlatUsd != null && effectiveFlatUsd >= 0);
  const effectivePercentDeal = updates.deal_percent_above_threshold ?? existing.fields.deal_percent_above_threshold;
  if (compType === 'Percentage' && (effectivePct == null || effectivePct < 0 || effectivePct > 100)) {
    return badRequest(reqId, 'Creator payout % is required (0–100) for Percentage compensation');
  }
  if (compType === 'Salary' && !hasSalary) {
    return badRequest(reqId, 'Salary (EUR and/or USD) is required for Salary compensation');
  }
  if (compType === 'Hybrid') {
    if (effectivePct == null || effectivePct < 0 || effectivePct > 100) {
      return badRequest(reqId, 'Creator payout % is required (0–100) for Hybrid');
    }
    if (!hasSalary) {
      return badRequest(reqId, 'Salary (EUR and/or USD) is required for Hybrid');
    }
  }
  if (compType === COMP_TIERED_DEAL) {
    if (effectiveThreshold == null || effectiveThreshold <= 0) return badRequest(reqId, 'deal_threshold (USD) required and must be > 0 for Tiered deal');
    if (!hasFlatTiered) return badRequest(reqId, 'Flat payout under threshold (EUR or USD) required for Tiered deal');
    if (effectivePercentDeal == null || effectivePercentDeal < 0 || effectivePercentDeal > 100) return badRequest(reqId, 'deal_percent_above_threshold required and must be 0–100 for Tiered deal');
  }

  try {
    for (const [fieldName, newVal] of Object.entries(updates)) {
      const oldVal = (existing.fields as Record<string, unknown>)[fieldName];
      const oldStr = oldVal != null ? String(oldVal) : '';
      const newStr = newVal != null ? String(newVal) : '';
      if (oldStr !== newStr) {
        await writeAuditLog({
          user_email: session.email,
          table: 'models',
          record_id: id,
          field_name: fieldName,
          old_value: oldStr,
          new_value: newStr,
        });
      }
    }
    const updated = await updateModel(id, updates);
    const res = NextResponse.json({
      id: updated.id,
      name: updated.fields.name ?? '',
      status: updated.fields.status ?? 'Active',
      compensation_type: updated.fields.compensation_type,
      creator_payout_pct: updated.fields.creator_payout_pct,
      salary_eur: updated.fields.salary_eur,
      salary_usd: updated.fields.salary_usd,
      deal_threshold: updated.fields.deal_threshold,
      deal_flat_under_threshold: updated.fields.deal_flat_under_threshold,
      deal_flat_under_threshold_usd: updated.fields.deal_flat_under_threshold_usd,
      deal_percent_above_threshold: updated.fields.deal_percent_above_threshold,
      notes: updated.fields.notes,
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/models PATCH]', e);
    return serverError(reqId, e, { route: `/api/models/${id}` });
  }
}
