import { NextRequest, NextResponse } from 'next/server';
import {
  listMonthlyMemberBasis,
  listTeamMembers,
  getMonthKeyFromId,
  getAgencyRevenuesForMonth,
  isHourlyBasisRecord,
} from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, serverError, unauthorized, badRequest } from '@/lib/api-utils';
import { getFxRateDirect } from '@/lib/fx';
import { computeManagerPctPayoutEur } from '@/lib/payout-compute';

export const runtime = 'edge';

const FINE_NOTES_PREFIX = 'FINE:';

function isFineRow(basisType: string, notes: string | undefined): boolean {
  const t = (basisType ?? '').trim().toLowerCase();
  const n = (notes ?? '').trim().toUpperCase();
  return t === 'fine' || (t === 'adjustment' && n.startsWith(FINE_NOTES_PREFIX));
}

/** Marketing/production payroll row: pct payout, bonus, fines, hourly, total (EUR primary; USD when available). */
export type MarketingPayrollRow = {
  team_member_id: string;
  team_member_name: string;
  pct_payout_eur: number;
  pct_payout_usd: number;
  bonus_eur: number;
  bonus_usd: number;
  fines_eur: number;
  fines_usd: number;
  hourly_eur: number;
  hourly_usd: number;
  total_eur: number;
  total_usd: number;
};

export type MarketingPayrollResponse = {
  ok: true;
  summary: {
    total_payroll_eur: number;
    total_payroll_usd: number;
    members_count: number;
  };
  rows: MarketingPayrollRow[];
  fx_rate: number;
};

/**
 * GET /api/marketing-payroll?month_id=... | month_key=...
 * Row list is built from team_members (not from monthly_member_basis). Include every active member where
 * department in ['marketing','production'] or (role === 'va' AND department === 'marketing'); exclude chatters.
 * For each member: sum bonus/fines/hourly from monthly_member_basis; compute pct payout EUR when payout_type==='percentage'
 * using the same formula as payouts preview (computeManagerPctPayoutEur). Total = pct_payout_eur + bonus_eur - fines_eur + hourly_eur.
 */
export async function GET(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  let month_id = request.nextUrl.searchParams.get('month_id')?.trim() ?? undefined;
  let month_key = request.nextUrl.searchParams.get('month_key')?.trim() ?? undefined;
  const debug = request.nextUrl.searchParams.get('debug') === '1';

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

    const [teamMembers, records, fxRate, agencyRevenues] = await Promise.all([
      listTeamMembers({}),
      listMonthlyMemberBasis(filters),
      getFxRateDirect(),
      month_id ? getAgencyRevenuesForMonth(month_id) : Promise.resolve(null),
    ]);

    const role = (m: { fields: { role?: unknown } }) => String((m.fields.role ?? '') || '').toLowerCase().trim();
    const department = (m: { fields: { department?: unknown } }) => {
      const raw = m.fields.department;
      const s = typeof raw === 'string' ? raw : (raw != null && typeof (raw as { name?: string }).name === 'string' ? (raw as { name: string }).name : '');
      return String(s || '').toLowerCase().trim();
    };
    const status = (m: { fields: { status?: unknown } }) => String((m.fields.status ?? '') || '').toLowerCase().trim();

    // Build row list from team_members (not from monthly_member_basis). Include every active marketing/production member.
    const allowedMemberIds = new Set<string>();
    const allowedMembers: { id: string; name: string; payout_type: string; fields: Record<string, unknown> }[] = [];
    for (const m of teamMembers) {
      if (status(m) !== 'active') continue;
      const r = role(m);
      const d = department(m);
      if (r === 'chatter') continue;
      if (d === 'marketing' || d === 'production') {
        allowedMemberIds.add(m.id);
        allowedMembers.push({
          id: m.id,
          name: (m.fields.name ?? '') as string,
          payout_type: String((m.fields.payout_type ?? '') || '').toLowerCase().trim(),
          fields: m.fields as Record<string, unknown>,
        });
        continue;
      }
      if (r === 'va' && d === 'marketing') {
        allowedMemberIds.add(m.id);
        allowedMembers.push({
          id: m.id,
          name: (m.fields.name ?? '') as string,
          payout_type: String((m.fields.payout_type ?? '') || '').toLowerCase().trim(),
          fields: m.fields as Record<string, unknown>,
        });
      }
    }

    const memberNameById: Record<string, string> = {};
    for (const m of teamMembers) {
      memberNameById[m.id] = (m.fields.name ?? '') as string;
    }

    const pctPayoutEurByMember: Record<string, number> = {};
    for (const mem of allowedMembers) {
      if (mem.payout_type === 'percentage') {
        pctPayoutEurByMember[mem.id] = computeManagerPctPayoutEur(agencyRevenues, mem.fields as Parameters<typeof computeManagerPctPayoutEur>[1]);
      } else {
        pctPayoutEurByMember[mem.id] = 0;
      }
    }

    const percentMembers = allowedMembers.filter((m) => m.payout_type === 'percentage');

    const basisRecords = records.filter((r) => {
      const teamRaw = r.fields.team_member;
      const teamMemberId = Array.isArray(teamRaw) && teamRaw[0] ? String(teamRaw[0]) : '';
      if (!teamMemberId || !allowedMemberIds.has(teamMemberId)) return false;
      const basisType = (r.fields.basis_type ?? '') as string;
      if (basisType === 'chatter_sales') return false;
      return true;
    });

    type Agg = {
      bonus_eur: number;
      bonus_usd: number;
      fines_eur: number;
      fines_usd: number;
      hourly_eur: number;
      hourly_usd: number;
    };
    const byMember = new Map<string, Agg>();
    const rate = fxRate > 0 ? fxRate : 0.92;

    function ensureMember(memberId: string) {
      if (!byMember.has(memberId)) {
        byMember.set(memberId, {
          bonus_eur: 0,
          bonus_usd: 0,
          fines_eur: 0,
          fines_usd: 0,
          hourly_eur: 0,
          hourly_usd: 0,
        });
      }
      return byMember.get(memberId)!;
    }

    function eurToUsd(eur: number): number {
      return rate > 0 ? eur / rate : 0;
    }

    for (const r of basisRecords) {
      const teamRaw = r.fields.team_member;
      const teamMemberId = Array.isArray(teamRaw) && teamRaw[0] ? String(teamRaw[0]) : '';
      if (!teamMemberId || !allowedMemberIds.has(teamMemberId)) continue;

      const basisType = (r.fields.basis_type ?? '') as string;
      const notes = (r.fields.notes ?? '') as string;
      const amountEur = typeof r.fields.amount_eur === 'number' ? r.fields.amount_eur : (r.fields.amount ?? 0) as number;
      const amountUsd = typeof r.fields.amount_usd === 'number' && Number.isFinite(r.fields.amount_usd) ? r.fields.amount_usd : eurToUsd(amountEur);
      const row = ensureMember(teamMemberId);

      if (isHourlyBasisRecord(r)) {
        row.hourly_eur += amountEur;
        row.hourly_usd += amountUsd;
      } else if (isFineRow(basisType, notes)) {
        const absEur = Math.abs(amountEur);
        const absUsd = typeof r.fields.amount_usd === 'number' && Number.isFinite(r.fields.amount_usd) ? Math.abs(r.fields.amount_usd) : eurToUsd(absEur);
        row.fines_eur += absEur;
        row.fines_usd += absUsd;
      } else if (basisType === 'bonus' || basisType === 'adjustment') {
        row.bonus_eur += amountEur;
        row.bonus_usd += amountUsd;
      }
    }

    const rows: MarketingPayrollRow[] = [];
    let total_payroll_eur = 0;
    let total_payroll_usd = 0;

    for (const mem of allowedMembers) {
      const memberId = mem.id;
      const agg = byMember.get(memberId) ?? {
        bonus_eur: 0,
        bonus_usd: 0,
        fines_eur: 0,
        fines_usd: 0,
        hourly_eur: 0,
        hourly_usd: 0,
      };
      const pct_payout_eur = pctPayoutEurByMember[memberId] ?? 0;
      const pct_payout_usd = rate > 0 ? pct_payout_eur / rate : 0;
      const total_eur = pct_payout_eur + agg.bonus_eur + agg.hourly_eur - agg.fines_eur;
      const total_usd = pct_payout_usd + agg.bonus_usd + agg.hourly_usd - agg.fines_usd;
      rows.push({
        team_member_id: memberId,
        team_member_name: memberNameById[memberId] ?? mem.name ?? memberId,
        pct_payout_eur,
        pct_payout_usd,
        bonus_eur: agg.bonus_eur,
        bonus_usd: agg.bonus_usd,
        fines_eur: agg.fines_eur,
        fines_usd: agg.fines_usd,
        hourly_eur: agg.hourly_eur,
        hourly_usd: agg.hourly_usd,
        total_eur,
        total_usd,
      });
      total_payroll_eur += total_eur;
      total_payroll_usd += total_usd;
    }

    let debugPayload: Record<string, unknown> | undefined;
    if (debug) {
      const percentComputedNonZeroCount = rows.filter((r) => (r.pct_payout_eur ?? 0) > 0).length;
      const revenueBase = agencyRevenues
        ? {
            chatting_amount_eur: agencyRevenues.chatting_amount_eur ?? null,
            gunzo_amount_eur: agencyRevenues.gunzo_amount_eur ?? null,
            chatting_msgs_tips_net_eur: agencyRevenues.chatting_msgs_tips_net_eur ?? null,
            gunzo_msgs_tips_net_eur: agencyRevenues.gunzo_msgs_tips_net_eur ?? null,
          }
        : null;
      const first5Percent = percentMembers.slice(0, 5).map((mem) => {
        const pctEur = pctPayoutEurByMember[mem.id] ?? 0;
        const chattingTotalNetEur = agencyRevenues?.chatting_amount_eur ?? 0;
        const gunzoTotalNetEur = agencyRevenues?.gunzo_amount_eur ?? 0;
        const chattingMsgsTipsNetEur = agencyRevenues?.chatting_msgs_tips_net_eur ?? 0;
        const gunzoMsgsTipsNetEur = agencyRevenues?.gunzo_msgs_tips_net_eur ?? 0;
        const chattingPct = Number(mem.fields.chatting_percentage) || 0;
        const chattingPctMsgs = Number(mem.fields.chatting_percentage_messages_tips) || 0;
        const gunzoPct = Number(mem.fields.gunzo_percentage) || 0;
        const gunzoPctMsgs = Number(mem.fields.gunzo_percentage_messages_tips) || 0;
        const baseUsed = {
          chattingTotalNetEur,
          gunzoTotalNetEur,
          chattingMsgsTipsNetEur,
          gunzoMsgsTipsNetEur,
          chattingPct,
          chattingPctMsgs,
          gunzoPct,
          gunzoPctMsgs,
        };
        return {
          id: mem.id,
          name: mem.name,
          department: mem.fields.department,
          role: mem.fields.role,
          payout_type: mem.payout_type,
          payout_scope: mem.fields.payout_scope,
          models_scope: mem.fields.models_scope,
          percent_fields: {
            chatting_percentage: mem.fields.chatting_percentage,
            gunzo_percentage: mem.fields.gunzo_percentage,
            chatting_percentage_messages_tips: mem.fields.chatting_percentage_messages_tips,
            gunzo_percentage_messages_tips: mem.fields.gunzo_percentage_messages_tips,
          },
          baseUsed,
          pct_payout_eur: pctEur,
        };
      });
      debugPayload = {
        month_key: month_key ?? null,
        teamMembersFetchedCount: teamMembers.length,
        allowedMembersCount: allowedMembers.length,
        percentMembersCount: percentMembers.length,
        monthlyBasisRowsCount: records.length,
        computedRowsCount: rows.length,
        percentComputedNonZeroCount,
        agencyRevenuesPresent: !!agencyRevenues,
        revenueBase: revenueBase ?? null,
        first5PercentMembers: first5Percent,
        sampleDepartmentValues: [...new Set(teamMembers.map((m) => (m.fields as { department?: unknown }).department))].slice(0, 10),
      };
      if (typeof console !== 'undefined') {
        console.log('[marketing-payroll debug]', JSON.stringify(debugPayload, null, 2));
        console.log('[marketing-payroll debug]', {
          teamMembersCount: teamMembers.length,
          percentageMembersCount: percentMembers.length,
          basisRowsCount: basisRecords.length,
          renderedRowsCount: rows.length,
        });
        const first5 = percentMembers.slice(0, 5).map((mem) => ({
          id: mem.id,
          name: mem.name,
          department: mem.fields.department,
          role: mem.fields.role,
          payout_type: mem.payout_type,
          payout_scope: mem.fields.payout_scope,
          models_scope: mem.fields.models_scope,
          baseUsed: {
            chatting_amount_eur: agencyRevenues?.chatting_amount_eur ?? null,
            gunzo_amount_eur: agencyRevenues?.gunzo_amount_eur ?? null,
            chatting_msgs_tips_net_eur: agencyRevenues?.chatting_msgs_tips_net_eur ?? null,
            gunzo_msgs_tips_net_eur: agencyRevenues?.gunzo_msgs_tips_net_eur ?? null,
          },
          pct_payout_eur: pctPayoutEurByMember[mem.id] ?? 0,
        }));
        console.log('[marketing-payroll debug] first 5 percentage members:', JSON.stringify(first5, null, 2));
      }
    }

    const resBody = {
      ok: true,
      summary: {
        total_payroll_eur,
        total_payroll_usd,
        members_count: rows.length,
      },
      rows,
      fx_rate: rate,
      ...(debugPayload ? { debug: debugPayload } : {}),
    };
    const res = NextResponse.json(resBody);
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/marketing-payroll GET]', e);
    return serverError(reqId, e, { route: '/api/marketing-payroll' });
  }
}
