import { NextRequest, NextResponse } from 'next/server';
import {
  getPayoutRun,
  listPayoutLines,
  updatePayoutRun,
  deletePayoutRun,
  deletePayoutLine,
  getMonths,
  getTeamMember,
  getModel,
  writeAuditLog,
} from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, serverError, unauthorized, badRequest, forbidden, notFound } from '@/lib/api-utils';
import { formatEurDisplay, formatUsdDisplay, formatNumberDisplay } from '@/lib/format-display';

export const runtime = 'edge';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(_request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const { runId } = await params;
  if (!runId?.trim()) return badRequest(reqId, 'runId is required');

  try {
    const [run, lineRecs, months] = await Promise.all([
      getPayoutRun(runId),
      listPayoutLines(runId),
      getMonths(),
    ]);
    if (!run) return forbidden(reqId, 'Payout run not found');

    const monthKeyById: Record<string, string> = {};
    for (const m of months) {
      monthKeyById[m.id] = m.fields.month_key ?? '';
    }
    const month_id = run.fields.month?.[0] ?? '';
    const month_key = month_id ? (monthKeyById[month_id] ?? '') : '';

    const lines: Array<{
      id: string;
      team_member_id: string;
      team_member_name: string;
      payee_team_member_id?: string;
      department: string;
      role: string;
      payout_type: string;
      payout_percentage?: number;
      payout_flat_fee?: number;
      basis_webapp_amount: number;
      basis_manual_amount: number;
      bonus_amount: number;
      adjustments_amount: number;
      basis_total: number;
      payout_amount: number;
      amount_eur: number | null;
      amount_usd: number | null;
      currency: string;
      breakdown_json?: string;
      paid_status?: string;
      paid_at?: string | null;
      basis_webapp_amount_display: string;
      basis_manual_amount_display: string;
      bonus_amount_display: string;
      adjustments_amount_display: string;
      basis_total_display: string;
      payout_amount_display: string;
      amount_eur_display: string;
      amount_usd_display: string;
      payout_flat_fee_display: string;
    }> = [];

    for (const l of lineRecs) {
      const tmId = l.fields.team_member?.[0] ?? '';
      const modelId = l.fields.model?.[0] ?? '';
      let lineTeamMemberId = tmId;
      let name = '';
      if (modelId) {
        const model = await getModel(modelId);
        name = (model?.fields.name ?? '') as string;
        lineTeamMemberId = `model-${modelId}`;
      } else if (tmId) {
        const tm = await getTeamMember(tmId);
        name = (tm?.fields.name ?? '') as string;
      }
      const amountEur = typeof l.fields.amount_eur === 'number' ? l.fields.amount_eur : null;
      const amountUsd = typeof l.fields.amount_usd === 'number' ? l.fields.amount_usd : null;
      const payoutAmount = l.fields.payout_amount ?? 0;
      const basisWebapp = l.fields.basis_webapp_amount ?? 0;
      const basisManual = l.fields.basis_manual_amount ?? 0;
      const bonus = l.fields.bonus_amount ?? 0;
      const adjustments = l.fields.adjustments_amount ?? 0;
      const basisTotal = l.fields.basis_total ?? 0;
      const flatFee = l.fields.payout_flat_fee;
      lines.push({
        id: l.id,
        team_member_id: lineTeamMemberId,
        team_member_name: name,
        payee_team_member_id: tmId || undefined,
        department: (l.fields.department ?? '') as string,
        role: (l.fields.role ?? '') as string,
        payout_type: (l.fields.payout_type ?? 'none') as string,
        payout_percentage: l.fields.payout_percentage,
        payout_flat_fee: l.fields.payout_flat_fee,
        basis_webapp_amount: basisWebapp,
        basis_manual_amount: basisManual,
        bonus_amount: bonus,
        adjustments_amount: adjustments,
        basis_total: basisTotal,
        payout_amount: payoutAmount,
        amount_eur: amountEur,
        amount_usd: amountUsd,
        currency: amountEur != null ? 'eur' : 'usd',
        breakdown_json: l.fields.breakdown_json,
        paid_status: l.fields.paid_status ?? 'pending',
        paid_at: l.fields.paid_at ?? null,
        basis_webapp_amount_display: formatNumberDisplay(basisWebapp),
        basis_manual_amount_display: formatNumberDisplay(basisManual),
        bonus_amount_display: formatNumberDisplay(bonus),
        adjustments_amount_display: formatNumberDisplay(adjustments),
        basis_total_display: formatNumberDisplay(basisTotal),
        payout_amount_display: formatNumberDisplay(payoutAmount),
        amount_eur_display: formatEurDisplay(amountEur),
        amount_usd_display: formatUsdDisplay(amountUsd),
        payout_flat_fee_display: flatFee != null ? formatEurDisplay(flatFee) : '—',
      });
    }

    const payload = {
      ok: true,
      requestId: reqId,
      sample: {
        run: {
          id: run.id,
          month_id,
          month_key,
          status: run.fields.status ?? 'draft',
          notes: run.fields.notes ?? '',
        },
        lines,
      },
    };
    const res = NextResponse.json(payload);
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/payout-runs/[runId] GET]', e);
    return serverError(reqId, e, { route: '/api/payout-runs/[runId]' });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const { runId } = await params;
  if (!runId?.trim()) return badRequest(reqId, 'runId is required');

  let body: { status?: string; notes?: string };
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON body');
  }

  const status = body.status?.trim();
  if (status && !['draft', 'locked', 'paid'].includes(status)) {
    return badRequest(reqId, 'status must be draft, locked, or paid');
  }

  try {
    const run = await getPayoutRun(runId);
    if (!run) return forbidden(reqId, 'Payout run not found');

    const updates: Partial<{ status: 'draft' | 'locked' | 'paid'; notes: string }> = {};
    if (status) updates.status = status as 'draft' | 'locked' | 'paid';
    if (body.notes !== undefined) updates.notes = body.notes;

    if (Object.keys(updates).length === 0) {
      const res = NextResponse.json({ id: run.id, ...run.fields });
      res.headers.set('request-id', reqId);
      return res;
    }

    const updated = await updatePayoutRun(runId, updates);
    await writeAuditLog({
      user_email: session.email,
      table: 'payout_runs',
      record_id: runId,
      field_name: 'status_change',
      old_value: run.fields.status ?? '',
      new_value: JSON.stringify(updates),
    });
    const res = NextResponse.json({
      id: updated.id,
      status: updated.fields.status ?? 'draft',
      notes: updated.fields.notes ?? '',
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/payout-runs/[runId] PATCH]', e);
    return serverError(reqId, e, { route: '/api/payout-runs/[runId]' });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(_request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const { runId } = await params;
  if (!runId?.trim()) return badRequest(reqId, 'runId is required');

  try {
    const run = await getPayoutRun(runId);
    if (!run) return notFound(reqId, 'Payout run not found');

    const lineRecs = await listPayoutLines(runId);
    const BATCH_SIZE = 10;
    for (let i = 0; i < lineRecs.length; i += BATCH_SIZE) {
      const batch = lineRecs.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map((r) => deletePayoutLine(r.id)));
    }
    await deletePayoutRun(runId);

    const res = NextResponse.json({ ok: true });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/payout-runs/[runId] DELETE]', e);
    return serverError(reqId, e, { route: '/api/payout-runs/[runId]' });
  }
}
