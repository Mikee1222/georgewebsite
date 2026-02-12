import { NextRequest, NextResponse } from 'next/server';
import {
  getMonths,
  getModels,
  listTeamMembers,
  listExpenses,
  listRevenue,
} from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, unauthorized } from '@/lib/api-utils';
import type { ExpenseEntryRecord, RevenueEntryRecord, MonthsRecord, ModelsRecord } from '@/lib/types';
import type { AirtableRecord } from '@/lib/types';

export const runtime = 'edge';

type OwnerType = 'model' | 'team_member' | 'agency';

interface TopCostOwner {
  owner_type: OwnerType;
  owner_id: string;
  owner_name: string;
  total: number;
}

interface MonthAgg {
  month_id: string;
  month_key: string;
  month_name: string;
  revenue_total: number;
  expenses_total: number;
  profit_total: number;
  expenses_by_department: Record<string, number>;
  expenses_by_category: Record<string, number>;
  top_cost_owners: TopCostOwner[];
}

interface AgencyEntriesResponse {
  range: { from_month_id: string; to_month_id: string };
  byMonth: MonthAgg[];
  totals: {
    revenue_total: number;
    expenses_total: number;
    profit_total: number;
    expenses_by_department: Record<string, number>;
    expenses_by_category: Record<string, number>;
  };
}

const VALID_DEPARTMENTS = new Set([
  '',
  'all',
  'combined',
  'models',
  'chatting',
  'marketing',
  'production',
  'ops',
]);

export async function GET(request: NextRequest) {
  const reqId = requestId();
  const from_month_id = (request.nextUrl.searchParams.get('from_month_id') ?? '').trim();
  const to_month_id = (request.nextUrl.searchParams.get('to_month_id') ?? '').trim();
  const departmentRaw = (request.nextUrl.searchParams.get('department') ?? '').trim();
  const department = departmentRaw === '' ? 'all' : departmentRaw;

  console.log('[agency/entries]', { requestId: reqId, from_month_id, to_month_id, department });

  try {
    const session = await getSessionFromRequest(request.headers.get('cookie'));
    if (!session) {
      const res = unauthorized(reqId);
      res.headers.set('request-id', reqId);
      return res;
    }

    if (!from_month_id || !to_month_id) {
      const res = NextResponse.json({ error: 'from_month_id and to_month_id are required', requestId: reqId }, { status: 400 });
      res.headers.set('request-id', reqId);
      return res;
    }
    if (!VALID_DEPARTMENTS.has(department)) {
      const res = NextResponse.json({ error: 'invalid department', requestId: reqId }, { status: 400 });
      res.headers.set('request-id', reqId);
      return res;
    }

    let monthsRecords: AirtableRecord<MonthsRecord>[];
    let modelsRecords: AirtableRecord<ModelsRecord>[];
    let teamMembersRecords: AirtableRecord<{ name?: string }>[];

    [monthsRecords, modelsRecords, teamMembersRecords] = await Promise.all([
      getMonths(),
      getModels(),
      listTeamMembers(),
    ]);

    const monthList = monthsRecords
      .slice()
      .sort((a, b) => (a.fields.month_key ?? '').localeCompare(b.fields.month_key ?? ''));
    const fromIdx = monthList.findIndex((m) => m.id === from_month_id);
    const toIdx = monthList.findIndex((m) => m.id === to_month_id);
    if (fromIdx === -1 || toIdx === -1) {
      const res = NextResponse.json({ error: 'invalid month ids', requestId: reqId }, { status: 400 });
      res.headers.set('request-id', reqId);
      return res;
    }
    const rangeMonths = monthList.slice(
      Math.min(fromIdx, toIdx),
      Math.max(fromIdx, toIdx) + 1
    );
    const monthIdsInRange = rangeMonths.map((m) => m.id);

    if (process.env.NODE_ENV === 'development') {
      console.log('[api/agency/entries]', { requestId: reqId, monthIdsInRange });
    }

    const expenseFilters: { month_ids: string[]; department?: string } = { month_ids: monthIdsInRange };
    if (department !== 'all' && department !== '') {
      expenseFilters.department = department;
    }

    const [expenseRecords, revenueRecords] = await Promise.all([
      listExpenses(expenseFilters, { requestId: reqId }),
      listRevenue({ month_ids: monthIdsInRange }).catch((e) => {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[agency/entries] listRevenue failed, using empty list', { requestId: reqId, error: String(e) });
        }
        return [] as AirtableRecord<RevenueEntryRecord>[];
      }),
    ]);

    const modelNameById = new Map(modelsRecords.map((m) => [m.id, m.fields.name ?? m.id]));
    const teamMemberNameById = new Map(
      teamMembersRecords.map((m) => [m.id, m.fields.name ?? m.id])
    );

    const byMonth: MonthAgg[] = rangeMonths.map((month) => {
    const monthId = month.id;
    const month_key = month.fields.month_key ?? '';
    const month_name = month.fields.month_name ?? month_key;

    const monthRevenue = revenueRecords.filter(
      (r) => r.fields.month?.[0] === monthId
    );
    const monthExpenses = expenseRecords.filter(
      (r) => r.fields.month?.[0] === monthId
    );

    const revenue_total = monthRevenue.reduce((s, r) => s + (r.fields.amount ?? 0), 0);
    const expenses_total = monthExpenses.reduce((s, r) => s + (r.fields.amount ?? 0), 0);
    const profit_total = revenue_total - expenses_total;

    const expenses_by_department: Record<string, number> = {};
    const expenses_by_category: Record<string, number> = {};
    const ownerSums = new Map<string, number>();

    for (const r of monthExpenses) {
      const amt = r.fields.amount ?? 0;
      const dept = r.fields.department ?? 'ops';
      expenses_by_department[dept] = (expenses_by_department[dept] ?? 0) + amt;
      const cat = r.fields.category ?? 'other';
      expenses_by_category[cat] = (expenses_by_category[cat] ?? 0) + amt;

      const ownerType = (r.fields.cost_owner_type as OwnerType) ?? 'agency';
      let ownerId = 'agency';
      if (ownerType === 'model' && r.fields.model?.[0]) ownerId = r.fields.model[0];
      else if (ownerType === 'team_member' && r.fields.team_member?.[0])
        ownerId = r.fields.team_member[0];
      const key = `${ownerType}:${ownerId}`;
      ownerSums.set(key, (ownerSums.get(key) ?? 0) + amt);
    }

    const top_cost_owners: TopCostOwner[] = Array.from(ownerSums.entries())
      .map(([key, total]) => {
        const [owner_type, owner_id] = key.split(':') as [OwnerType, string];
        let owner_name = 'agency';
        if (owner_type === 'model') owner_name = modelNameById.get(owner_id) ?? owner_id;
        else if (owner_type === 'team_member')
          owner_name = teamMemberNameById.get(owner_id) ?? owner_id;
        return { owner_type, owner_id, owner_name, total };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    return {
      month_id: monthId,
      month_key,
      month_name,
      revenue_total,
      expenses_total,
      profit_total,
      expenses_by_department,
      expenses_by_category,
      top_cost_owners,
    };
  });

    const totals = {
      revenue_total: byMonth.reduce((s, m) => s + m.revenue_total, 0),
      expenses_total: byMonth.reduce((s, m) => s + m.expenses_total, 0),
      profit_total: byMonth.reduce((s, m) => s + m.profit_total, 0),
      expenses_by_department: {} as Record<string, number>,
      expenses_by_category: {} as Record<string, number>,
    };
    for (const m of byMonth) {
      for (const [k, v] of Object.entries(m.expenses_by_department)) {
        totals.expenses_by_department[k] = (totals.expenses_by_department[k] ?? 0) + v;
      }
      for (const [k, v] of Object.entries(m.expenses_by_category)) {
        totals.expenses_by_category[k] = (totals.expenses_by_category[k] ?? 0) + v;
      }
    }

    const body: AgencyEntriesResponse = {
      range: { from_month_id, to_month_id },
      byMonth,
      totals,
    };
    const res = NextResponse.json(body);
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error('[agency/entries error]', { requestId: reqId, from_month_id, to_month_id, department, error: String(err), stack: err?.stack });
    const res = NextResponse.json(
      { error: 'Failed to load agency entries', requestId: reqId },
      { status: 500 }
    );
    res.headers.set('request-id', reqId);
    return res;
  }
}
