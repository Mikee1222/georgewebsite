import { NextRequest, NextResponse } from 'next/server';
import { listPayoutLines, getTeamMember } from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, serverError, unauthorized, badRequest } from '@/lib/api-utils';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const run_id = request.nextUrl.searchParams.get('run_id')?.trim();
  if (!run_id) return badRequest(reqId, 'run_id is required');

  try {
    const lineRecs = await listPayoutLines(run_id);
    const lines: Array<{
      id: string;
      payout_run_id: string;
      team_member_id: string;
      team_member_name: string;
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
    }> = [];

    for (const l of lineRecs) {
      const tmId = l.fields.team_member?.[0] ?? '';
      let name = '';
      if (tmId) {
        const tm = await getTeamMember(tmId);
        name = (tm?.fields.name ?? '') as string;
      }
      const amountEur = typeof l.fields.amount_eur === 'number' ? l.fields.amount_eur : null;
      const amountUsd = typeof l.fields.amount_usd === 'number' ? l.fields.amount_usd : null;
      lines.push({
        id: l.id,
        payout_run_id: run_id,
        team_member_id: tmId,
        team_member_name: name,
        department: (l.fields.department ?? '') as string,
        role: (l.fields.role ?? '') as string,
        payout_type: (l.fields.payout_type ?? 'none') as string,
        payout_percentage: l.fields.payout_percentage,
        payout_flat_fee: l.fields.payout_flat_fee,
        basis_webapp_amount: l.fields.basis_webapp_amount ?? 0,
        basis_manual_amount: l.fields.basis_manual_amount ?? 0,
        bonus_amount: l.fields.bonus_amount ?? 0,
        adjustments_amount: l.fields.adjustments_amount ?? 0,
        basis_total: l.fields.basis_total ?? 0,
        payout_amount: l.fields.payout_amount ?? 0,
        amount_eur: amountEur,
        amount_usd: amountUsd,
        currency: amountEur != null ? 'eur' : 'usd',
        breakdown_json: l.fields.breakdown_json,
      });
    }

    const res = NextResponse.json(lines);
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/payout-lines GET]', e);
    return serverError(reqId, e, { route: '/api/payout-lines' });
  }
}
