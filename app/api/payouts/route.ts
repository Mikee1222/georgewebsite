import { NextRequest, NextResponse } from 'next/server';
import {
  getPayoutRun,
  listPayoutLines,
  getMonths,
  getTeamMember,
  getModel,
} from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, serverError, unauthorized, badRequest, forbidden } from '@/lib/api-utils';
import { formatEurDisplay, formatUsdDisplay, formatNumberDisplay } from '@/lib/format-display';
import { computePreviewPayouts } from '@/lib/payout-compute';
import { getFxRateDirect } from '@/lib/fx';

export const runtime = 'edge';

/**
 * GET /api/payouts?source=live&month_id=xxx — compute fresh from monthly_member_basis + pnl_lines + team members. No payout_runs/payout_lines. No writes.
 * GET /api/payouts?source=saved&run_id=xxx — read payout_run + payout_lines from Airtable.
 */
export async function GET(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const { searchParams } = request.nextUrl;
  const source = searchParams.get('source')?.trim()?.toLowerCase();
  const month_id = searchParams.get('month_id')?.trim();
  const run_id = searchParams.get('run_id')?.trim();
  const debug = searchParams.get('debug') === '1';

  if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
    console.log('[api/payouts] request', { source, month_id: month_id ?? undefined, run_id: run_id ?? undefined });
  }

  if (source === 'live') {
    if (!month_id) return badRequest(reqId, 'month_id is required when source=live');
    try {
      const fxRate = await getFxRateDirect();
      const out = await computePreviewPayouts(month_id, fxRate > 0 ? fxRate : null, { debug });
      const { lines, month_key, byTab, debug: debugBlock } = out;
      if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
        console.log('[api/payouts] response source=live', {
          computed_from: 'live',
          linesCount: lines.length,
          month_key,
          run_ids_present: false,
          ...(debugBlock && { debug: debugBlock }),
        });
      }
      const resBody: Record<string, unknown> = {
        ok: true,
        requestId: reqId,
        computed_from: 'live',
        lines,
        byTab,
        month_key,
        fx_rate: fxRate,
      };
      if (debug && debugBlock) resBody.debug = debugBlock;
      const res = NextResponse.json(resBody);
      res.headers.set('request-id', reqId);
      return res;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Live compute failed';
      if (process.env.NODE_ENV === 'development') console.error('[api/payouts] source=live', e);
      return badRequest(reqId, message);
    }
  }

  if (source === 'saved') {
    if (!run_id) return badRequest(reqId, 'run_id is required when source=saved');
    try {
      const [run, lineRecs, months] = await Promise.all([
        getPayoutRun(run_id),
        listPayoutLines(run_id),
        getMonths(),
      ]);
      if (!run) return forbidden(reqId, 'Payout run not found');

      const monthKeyById: Record<string, string> = {};
      for (const m of months) {
        monthKeyById[m.id] = m.fields.month_key ?? '';
      }
      const month_id_from_run = run.fields.month?.[0] ?? '';
      const month_key = month_id_from_run ? (monthKeyById[month_id_from_run] ?? '') : '';

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

      if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
        console.log('[api/payouts] response source=saved', { computed_from: 'saved', run_id: run.id, linesCount: lines.length });
      }
      const res = NextResponse.json({
        ok: true,
        requestId: reqId,
        computed_from: 'saved',
        run_id: run.id,
        sample: {
          run: {
            id: run.id,
            month_id: month_id_from_run,
            month_key,
            status: run.fields.status ?? 'draft',
            notes: run.fields.notes ?? '',
          },
          lines,
        },
      });
      res.headers.set('request-id', reqId);
      return res;
    } catch (e) {
      if (process.env.NODE_ENV === 'development') console.error('[api/payouts] source=saved', e);
      return serverError(reqId, e, { route: '/api/payouts' });
    }
  }

  return badRequest(reqId, 'source is required: use source=live or source=saved');
}
