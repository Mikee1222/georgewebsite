import { NextRequest, NextResponse } from 'next/server';
import {
  listMonthlyMemberBasis,
  listTeamMembers,
  getMonthKeyFromId,
} from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, serverError, unauthorized, badRequest } from '@/lib/api-utils';

export const runtime = 'edge';

/** Role sets for non-chatter bonus/fine sections. Matches payout-tabs and user spec. */
const MANAGER_ROLES = new Set(['manager', 'chatting_manager', 'marketing_manager']);

function isAffiliator(m: { fields: { role?: unknown; department?: unknown } }): boolean {
  const role = String((m.fields.role ?? '') as string).toLowerCase().trim();
  const dept = String((m.fields.department ?? '') as string).toLowerCase().trim();
  return role === 'affiliator' || dept === 'affiliate';
}

export type BasisEntry = {
  id: string;
  month_id: string;
  month_key?: string;
  team_member_id: string;
  team_member_numeric_id?: number | string;
  department?: string;
  basis_type: string;
  amount: number;
  amount_usd?: number;
  amount_eur?: number;
  currency: string;
  notes: string;
  created_at: string;
};

export type NonChatterGroup = {
  bonuses: BasisEntry[];
  fines: BasisEntry[];
  totals: { totalBonusEur: number; totalFinesEur: number; netEur: number };
};

function isBonusOrAdjustment(basisType: string): boolean {
  const t = (basisType ?? '').trim().toLowerCase();
  return t === 'bonus' || t === 'adjustment' || t === 'fine';
}

const FINE_NOTES_PREFIX = 'FINE:';
/** Classify as fine: basis_type "fine", or negative amount, or notes "FINE: ...". Do not filter by amount before this. */
function isFineEntry(entry: { basis_type: string; amount_eur?: number; amount_usd?: number; notes?: string }): boolean {
  const basisType = (entry.basis_type ?? '').trim().toLowerCase();
  const notes = (entry.notes ?? '').trim();
  const amountEur = entry.amount_eur;
  const amountUsd = entry.amount_usd;
  if (basisType === 'fine') return true;
  if (typeof amountEur === 'number' && amountEur < 0) return true;
  if (typeof amountUsd === 'number' && amountUsd < 0) return true;
  if (basisType === 'adjustment' && notes.toUpperCase().startsWith(FINE_NOTES_PREFIX)) return true;
  return false;
}

/**
 * GET /api/monthly-basis/by-role?month_id=... | month_key=...
 * Returns bonus and adjustment (fine) entries grouped by team_members.role:
 * - managers: role in ["manager","chatting_manager","marketing_manager"]
 * - vas: role === "va"
 * - models: role === "model"
 * No chatter_sales; no schema changes. Sorted newest first per group.
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

    const [teamMembers, records] = await Promise.all([
      listTeamMembers({}),
      listMonthlyMemberBasis(filters),
    ]);

    const roleLower = (r: { fields: { role?: unknown } }) => ((r.fields.role ?? '') as string).toLowerCase().trim();
    const managerIds = new Set(
      teamMembers.filter((m) => MANAGER_ROLES.has(roleLower(m))).map((m) => m.id)
    );
    const vaIds = new Set(
      teamMembers.filter((m) => roleLower(m) === 'va').map((m) => m.id)
    );
    const modelIds = new Set(
      teamMembers.filter((m) => roleLower(m) === 'model').map((m) => m.id)
    );
    const affiliateIds = new Set(
      teamMembers.filter((m) => isAffiliator(m)).map((m) => m.id)
    );

    const bonusOrAdjustment = records.filter((r) => {
      const basisType = (r.fields.basis_type ?? '') as string;
      if (!isBonusOrAdjustment(basisType)) return false;
      const teamRaw = r.fields.team_member;
      const teamMemberId = Array.isArray(teamRaw) && teamRaw[0] ? String(teamRaw[0]) : '';
      return teamMemberId !== '' && (managerIds.has(teamMemberId) || vaIds.has(teamMemberId) || modelIds.has(teamMemberId) || affiliateIds.has(teamMemberId));
    });

    const linkedMonthIds = new Set<string>();
    for (const r of bonusOrAdjustment) {
      const m = r.fields.month;
      if (Array.isArray(m) && m[0]) linkedMonthIds.add(String(m[0]));
    }
    const monthIdToKey: Record<string, string> = {};
    await Promise.all(
      Array.from(linkedMonthIds).map(async (id) => {
        const key = await getMonthKeyFromId(id);
        if (key) monthIdToKey[id] = key;
      })
    );

    const mapRecord = (r: (typeof bonusOrAdjustment)[0]): BasisEntry => {
      const amountEur = typeof r.fields.amount_eur === 'number' ? r.fields.amount_eur : null;
      const notes = r.fields.notes ?? '';
      const rawBasisType = r.fields.basis_type;
      const basisType = typeof rawBasisType === 'string' ? rawBasisType.trim() : '';
      const monthRaw = r.fields.month;
      const teamRaw = r.fields.team_member;
      const monthId = Array.isArray(monthRaw) && monthRaw[0] ? String(monthRaw[0]) : '';
      const monthKeyResolved = typeof monthRaw === 'string' ? monthRaw : (monthId ? monthIdToKey[monthId] ?? '' : '');
      const teamMemberId = Array.isArray(teamRaw) && teamRaw[0] ? String(teamRaw[0]) : '';
      const teamMemberNumericId = !Array.isArray(teamRaw) && (typeof teamRaw === 'number' || (typeof teamRaw === 'string' && teamRaw !== ''))
        ? (typeof teamRaw === 'number' ? teamRaw : teamRaw)
        : undefined;
      const dept = r.fields.department ?? '';
      return {
        id: r.id,
        month_id: monthId ?? '',
        month_key: monthKeyResolved || undefined,
        team_member_id: teamMemberId ?? '',
        team_member_numeric_id: teamMemberNumericId,
        department: dept,
        basis_type: basisType,
        amount: r.fields.amount ?? 0,
        amount_usd: r.fields.amount_usd,
        amount_eur: r.fields.amount_eur,
        currency: amountEur != null ? 'eur' : 'usd',
        notes,
        created_at: r.fields.created_at ?? r.createdTime ?? '',
      };
    };

    const byRole = {
      managers: [] as BasisEntry[],
      vas: [] as BasisEntry[],
      models: [] as BasisEntry[],
      affiliates: [] as BasisEntry[],
    };

    for (const r of bonusOrAdjustment) {
      const teamRaw = r.fields.team_member;
      const teamMemberId = Array.isArray(teamRaw) && teamRaw[0] ? String(teamRaw[0]) : '';
      const entry = mapRecord(r);
      if (managerIds.has(teamMemberId)) {
        byRole.managers.push(entry);
      } else if (vaIds.has(teamMemberId)) {
        byRole.vas.push(entry);
      } else if (modelIds.has(teamMemberId)) {
        byRole.models.push(entry);
      } else if (affiliateIds.has(teamMemberId)) {
        byRole.affiliates.push(entry);
      }
    }

    const sortNewestFirst = (a: BasisEntry, b: BasisEntry) => {
      const ta = a.created_at || '';
      const tb = b.created_at || '';
      return tb.localeCompare(ta);
    };
    byRole.managers.sort(sortNewestFirst);
    byRole.vas.sort(sortNewestFirst);
    byRole.models.sort(sortNewestFirst);
    byRole.affiliates.sort(sortNewestFirst);

    function buildGroup(entries: BasisEntry[]): NonChatterGroup {
      const fines = entries.filter((e) => isFineEntry(e));
      const bonuses = entries.filter((e) => !isFineEntry(e));
      let totalBonusEur = 0;
      let totalFinesEur = 0;
      for (const e of bonuses) {
        const amount = typeof e.amount_eur === 'number' ? e.amount_eur : (e.amount ?? 0);
        totalBonusEur += amount;
      }
      for (const e of fines) {
        const amount = typeof e.amount_eur === 'number' ? e.amount_eur : (e.amount ?? 0);
        totalFinesEur += Math.abs(amount);
      }
      return {
        bonuses,
        fines,
        totals: { totalBonusEur, totalFinesEur, netEur: totalBonusEur - totalFinesEur },
      };
    }

    const groups = {
      managers: buildGroup(byRole.managers),
      vas: buildGroup(byRole.vas),
      models: buildGroup(byRole.models),
      affiliates: buildGroup(byRole.affiliates),
    };

    const res = NextResponse.json({ ok: true, groups });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/monthly-basis/by-role GET]', e);
    return serverError(reqId, e, { route: '/api/monthly-basis/by-role' });
  }
}
