import { NextRequest, NextResponse } from 'next/server';
import {
  getMonths,
  getModels,
  listTeamMembers,
  listExpenses,
  listRevenue,
} from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, serverError, unauthorized, badRequest } from '@/lib/api-utils';
import type { ExpenseEntryRecord, RevenueEntryRecord } from '@/lib/types';
import type { AirtableRecord } from '@/lib/types';

export const runtime = 'edge';

type OwnerType = 'model' | 'team_member' | 'agency';

interface TopCostOwner {
  owner_type: OwnerType;
  owner_id: string;
  owner_name: string;
  total: number;
}

interface SummaryResponse {
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

export async function GET(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const month_id = request.nextUrl.searchParams.get('month_id') ?? '';
  if (!month_id) return badRequest(reqId, 'month_id is required');

  let monthRec: AirtableRecord<{ month_key: string; month_name?: string }> | null;
  let modelsRecords: AirtableRecord<{ name?: string }>[];
  let teamMembersRecords: AirtableRecord<{ name?: string }>[];
  let expenseRecords: AirtableRecord<ExpenseEntryRecord>[];
  let revenueRecords: AirtableRecord<RevenueEntryRecord>[];

  try {
    const [monthsRecords, models, teamMembers, expenses, revenue] = await Promise.all([
      getMonths(),
      getModels(),
      listTeamMembers(),
      listExpenses({ month_id }),
      listRevenue({ month_id }),
    ]);
    monthRec = monthsRecords.find((m) => m.id === month_id) ?? null;
    modelsRecords = models;
    teamMembersRecords = teamMembers;
    expenseRecords = expenses;
    revenueRecords = revenue;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/agency/entries/summary]', e);
    return serverError(reqId, e, { route: '/api/agency/entries/summary' });
  }

  const month_key = monthRec?.fields.month_key ?? month_id;
  const month_name = monthRec?.fields.month_name ?? month_key;

  const revenue_total = revenueRecords.reduce((s, r) => s + (r.fields.amount ?? 0), 0);
  const expenses_total = expenseRecords.reduce((s, r) => s + (r.fields.amount ?? 0), 0);
  const profit_total = revenue_total - expenses_total;

  const expenses_by_department: Record<string, number> = {};
  const expenses_by_category: Record<string, number> = {};
  const ownerSums = new Map<string, number>();

  const modelNameById = new Map(modelsRecords.map((m) => [m.id, m.fields.name ?? m.id]));
  const teamMemberNameById = new Map(
    teamMembersRecords.map((m) => [m.id, m.fields.name ?? m.id])
  );

  for (const r of expenseRecords) {
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

  const body: SummaryResponse = {
    month_id,
    month_key,
    month_name,
    revenue_total,
    expenses_total,
    profit_total,
    expenses_by_department,
    expenses_by_category,
    top_cost_owners,
  };
  const res = NextResponse.json(body);
  res.headers.set('request-id', reqId);
  return res;
}
