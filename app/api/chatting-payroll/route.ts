import { NextRequest, NextResponse } from 'next/server';
import {
  listMonthlyMemberBasis,
  listTeamMembers,
  getMonthKeyFromId,
} from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, serverError, unauthorized, badRequest } from '@/lib/api-utils';
import { getFxRateDirect } from '@/lib/fx';

export const runtime = 'edge';

const FINE_NOTES_PREFIX = 'FINE:';

function parsePayoutPctFromNotes(notes: string | undefined): number | undefined {
  if (!notes?.trim()) return undefined;
  const first = notes.trim().split('\n')[0]?.trim() ?? '';
  const m = /^PCT:(\d+(?:\.\d+)?)$/i.exec(first);
  return m ? Number(m[1]) : undefined;
}

function isFineRow(basisType: string, notes: string | undefined): boolean {
  const t = (basisType ?? '').trim().toLowerCase();
  const n = (notes ?? '').trim().toUpperCase();
  return t === 'fine' || (t === 'adjustment' && n.startsWith(FINE_NOTES_PREFIX));
}

export type ChatterPayrollRow = {
  team_member_id: string;
  team_member_name: string;
  gross_usd: number;
  payout_pct: number;
  base_payout_usd: number;
  bonus_total_eur: number;
  fine_total_eur: number;
  final_payout_usd: number;
  final_payout_eur: number;
};

export type ChatterPayrollResponse = {
  ok: true;
  summary: {
    totalGrossUsd: number;
    totalPayoutUsd: number;
    totalPayoutEur: number;
    netUsd?: number;
  };
  rows: ChatterPayrollRow[];
  fx_rate: number;
};

/**
 * GET /api/chatting-payroll?month_id=... | month_key=...
 * Returns chatter payroll for the selected month from monthly_member_basis.
 * Chatters only (role=chatter). No schema changes.
 */
export async function GET(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  let month_id = request.nextUrl.searchParams.get('month_id')?.trim() ?? undefined;
  let month_key = request.nextUrl.searchParams.get('month_key')?.trim() ?? undefined;

  try {
    if (month_id && !month_key) {
      const resolved = await getMonthKeyFromId(month_id);
      if (resolved) month_key = resolved;
    }
    if (!month_id && !month_key) {
      return badRequest(reqId, 'month_id or month_key is required');
    }

    const filters: { month_id?: string; month_key?: string } = {};
    if (month_id) filters.month_id = month_id;
    if (month_key) filters.month_key = month_key;

    const [teamMembers, records, fxRate] = await Promise.all([
      listTeamMembers({}),
      listMonthlyMemberBasis(filters),
      getFxRateDirect(),
    ]);

    const chatters = teamMembers.filter((m) => ((m.fields.role ?? '') as string).toLowerCase().trim() === 'chatter');
    const chatterIds = new Set(chatters.map((m) => m.id));
    const memberNameById = Object.fromEntries(chatters.map((m) => [m.id, (m.fields.name ?? '') as string]));

    const chatterRecords = records.filter((r) => {
      const teamRaw = r.fields.team_member;
      const teamMemberId = Array.isArray(teamRaw) && teamRaw[0] ? String(teamRaw[0]) : '';
      return teamMemberId !== '' && chatterIds.has(teamMemberId);
    });

    type Agg = {
      gross_usd: number;
      payout_pct: number;
      bonus_total_eur: number;
      fine_total_eur: number;
    };
    const byMember = new Map<string, Agg>();

    for (const r of chatterRecords) {
      const teamRaw = r.fields.team_member;
      const teamMemberId = Array.isArray(teamRaw) && teamRaw[0] ? String(teamRaw[0]) : '';
      if (!teamMemberId || !chatterIds.has(teamMemberId)) continue;

      if (!byMember.has(teamMemberId)) {
        const member = teamMembers.find((m) => m.id === teamMemberId);
        const pctChatters = Number((member?.fields as Record<string, unknown>)?.payout_percentage_chatters) || 0;
        byMember.set(teamMemberId, {
          gross_usd: 0,
          payout_pct: pctChatters,
          bonus_total_eur: 0,
          fine_total_eur: 0,
        });
      }
      const row = byMember.get(teamMemberId)!;
      const basisType = (r.fields.basis_type ?? '') as string;
      const notes = (r.fields.notes ?? '') as string;

      if (basisType === 'chatter_sales') {
        const amountUsd = typeof r.fields.amount_usd === 'number' ? r.fields.amount_usd : 0;
        row.gross_usd += amountUsd;
        const pct = parsePayoutPctFromNotes(notes);
        if (pct != null) row.payout_pct = pct;
      } else if (basisType === 'bonus') {
        const amountEur = typeof r.fields.amount_eur === 'number' ? r.fields.amount_eur : (r.fields.amount ?? 0);
        row.bonus_total_eur += amountEur;
      } else if (isFineRow(basisType, notes)) {
        const amountEur = typeof r.fields.amount_eur === 'number' ? r.fields.amount_eur : (r.fields.amount ?? 0);
        row.fine_total_eur += amountEur;
      }
    }

    const rate = fxRate > 0 ? fxRate : 0.92;

    const rows: ChatterPayrollRow[] = [];
    let totalGrossUsd = 0;
    let totalPayoutUsd = 0;
    let totalPayoutEur = 0;

    for (const [memberId, agg] of byMember.entries()) {
      const base_payout_usd = (agg.gross_usd * agg.payout_pct) / 100;
      const bonusFineEur = agg.bonus_total_eur + agg.fine_total_eur;
      const bonusFineUsd = rate > 0 ? bonusFineEur / rate : 0;
      const final_payout_usd = base_payout_usd + bonusFineUsd;
      const final_payout_eur = rate > 0 ? final_payout_usd * rate : final_payout_usd;

      rows.push({
        team_member_id: memberId,
        team_member_name: memberNameById[memberId] ?? memberId,
        gross_usd: agg.gross_usd,
        payout_pct: agg.payout_pct,
        base_payout_usd,
        bonus_total_eur: agg.bonus_total_eur,
        fine_total_eur: agg.fine_total_eur,
        final_payout_usd,
        final_payout_eur,
      });

      totalGrossUsd += agg.gross_usd;
      totalPayoutUsd += final_payout_usd;
      totalPayoutEur += final_payout_eur;
    }

    const res = NextResponse.json({
      ok: true,
      summary: {
        totalGrossUsd,
        totalPayoutUsd,
        totalPayoutEur,
        netUsd: totalGrossUsd - totalPayoutUsd,
      },
      rows,
      fx_rate: rate,
    } satisfies ChatterPayrollResponse);
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/chatting-payroll GET]', e);
    return serverError(reqId, e, { route: '/api/chatting-payroll' });
  }
}
