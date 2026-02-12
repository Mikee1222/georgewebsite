import { NextRequest, NextResponse } from 'next/server';
import { getModels, createModel, writeAuditLog } from '@/lib/airtable';
import { getSessionFromRequest, canManageModels } from '@/lib/auth';
import { requestId, serverError, unauthorized, forbidden, badRequest } from '@/lib/api-utils';
import type { ModelsRecord } from '@/lib/types';
import type { AirtableRecord } from '@/lib/types';

export const runtime = 'edge';

export async function GET(_request: Request) {
  const reqId = requestId();
  const session = await getSessionFromRequest(_request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  try {
    const records = await getModels();
    const list = records.map((r: AirtableRecord<ModelsRecord>) => ({
      id: r.id,
      name: r.fields.name ?? '',
      status: r.fields.status ?? 'Active',
      compensation_type: r.fields.compensation_type ?? undefined,
      creator_payout_pct: r.fields.creator_payout_pct,
      salary_eur: r.fields.salary_eur,
      salary_usd: r.fields.salary_usd,
      deal_threshold: r.fields.deal_threshold,
      deal_flat_under_threshold: r.fields.deal_flat_under_threshold,
      deal_flat_under_threshold_usd: r.fields.deal_flat_under_threshold_usd,
      deal_percent_above_threshold: r.fields.deal_percent_above_threshold,
      notes: r.fields.notes ?? undefined,
    }));
    const res = NextResponse.json(list);
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    return serverError(reqId, e, { route: '/api/models' });
  }
}

export async function POST(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);
  if (!canManageModels(session.role)) return forbidden(reqId, 'Forbidden: admin only');

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON');
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return badRequest(reqId, 'name required');

  const status = (body.status as string) ?? 'Active';
  const compensation_type = typeof body.compensation_type === 'string' ? body.compensation_type.trim() : undefined;
  const creator_payout_pct = typeof body.creator_payout_pct === 'number' ? body.creator_payout_pct : undefined;
  const salary_eur = typeof body.salary_eur === 'number' ? body.salary_eur : undefined;
  const salary_usd = typeof body.salary_usd === 'number' ? body.salary_usd : undefined;
  const deal_threshold = typeof body.deal_threshold === 'number' ? body.deal_threshold : undefined;
  const deal_flat_under_threshold = typeof body.deal_flat_under_threshold === 'number' ? body.deal_flat_under_threshold : undefined;
  const deal_flat_under_threshold_usd = typeof body.deal_flat_under_threshold_usd === 'number' ? body.deal_flat_under_threshold_usd : undefined;
  const deal_percent_above_threshold = typeof body.deal_percent_above_threshold === 'number' ? body.deal_percent_above_threshold : undefined;
  const notes = typeof body.notes === 'string' ? body.notes : undefined;

  const COMP_TIERED_DEAL = 'Tiered deal (threshold)';
  if (compensation_type === 'Percentage' && (creator_payout_pct == null || creator_payout_pct < 0 || creator_payout_pct > 100)) {
    return badRequest(reqId, 'Creator payout % is required (0–100) for Percentage compensation');
  }
  const hasSalary = (salary_eur != null && salary_eur >= 0) || (salary_usd != null && salary_usd >= 0);
  if (compensation_type === 'Salary' && !hasSalary) {
    return badRequest(reqId, 'Salary (EUR and/or USD) is required for Salary compensation');
  }
  if (compensation_type === 'Hybrid') {
    if (creator_payout_pct == null || creator_payout_pct < 0 || creator_payout_pct > 100) {
      return badRequest(reqId, 'Creator payout % is required (0–100) for Hybrid');
    }
    if (!hasSalary) {
      return badRequest(reqId, 'Salary (EUR and/or USD) is required for Hybrid');
    }
  }
  const hasFlatTiered = (deal_flat_under_threshold != null && deal_flat_under_threshold >= 0) || (deal_flat_under_threshold_usd != null && deal_flat_under_threshold_usd >= 0);
  if (compensation_type === COMP_TIERED_DEAL) {
    if (deal_threshold == null || deal_threshold <= 0) return badRequest(reqId, 'deal_threshold (USD) required and must be > 0 for Tiered deal');
    if (!hasFlatTiered) return badRequest(reqId, 'Flat payout under threshold (EUR or USD) required for Tiered deal');
    if (deal_percent_above_threshold == null || deal_percent_above_threshold < 0 || deal_percent_above_threshold > 100) return badRequest(reqId, 'deal_percent_above_threshold required and must be 0–100 for Tiered deal');
  }

  try {
    const created = await createModel({
      name,
      status: ['Active', 'Inactive', 'On Hold'].includes(status) ? status : 'Active',
      compensation_type: compensation_type ?? undefined,
      creator_payout_pct: compensation_type === 'Percentage' || compensation_type === 'Hybrid' ? creator_payout_pct : undefined,
      salary_eur: compensation_type === 'Salary' || compensation_type === 'Hybrid' ? salary_eur : undefined,
      salary_usd: compensation_type === 'Salary' || compensation_type === 'Hybrid' ? salary_usd : undefined,
      deal_threshold: compensation_type === COMP_TIERED_DEAL ? deal_threshold : undefined,
      deal_flat_under_threshold: compensation_type === COMP_TIERED_DEAL ? deal_flat_under_threshold : undefined,
      deal_flat_under_threshold_usd: compensation_type === COMP_TIERED_DEAL ? deal_flat_under_threshold_usd : undefined,
      deal_percent_above_threshold: compensation_type === COMP_TIERED_DEAL ? deal_percent_above_threshold : undefined,
      notes,
    });
    await writeAuditLog({
      user_email: session.email,
      table: 'models',
      record_id: created.id,
      field_name: 'create',
      old_value: '',
      new_value: JSON.stringify({ name: created.fields.name, status: created.fields.status }),
    });
    const res = NextResponse.json({
      id: created.id,
      name: created.fields.name ?? '',
      status: created.fields.status ?? 'Active',
      compensation_type: created.fields.compensation_type,
      creator_payout_pct: created.fields.creator_payout_pct,
      salary_eur: created.fields.salary_eur,
      salary_usd: created.fields.salary_usd,
      deal_threshold: created.fields.deal_threshold,
      deal_flat_under_threshold: created.fields.deal_flat_under_threshold,
      deal_flat_under_threshold_usd: created.fields.deal_flat_under_threshold_usd,
      deal_percent_above_threshold: created.fields.deal_percent_above_threshold,
      notes: created.fields.notes,
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/models POST]', e);
    return serverError(reqId, e, { route: '/api/models' });
  }
}
