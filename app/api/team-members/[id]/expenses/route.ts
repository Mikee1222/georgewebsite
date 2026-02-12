import { NextRequest, NextResponse } from 'next/server';
import {
  getTeamMember,
  getMonths,
  getMonthKeysInRange,
  listExpenses,
  createExpense,
  writeAuditLog,
} from '@/lib/airtable';
import { getSessionFromRequest, canManageTeamMembers } from '@/lib/auth';
import {
  requestId,
  serverError,
  unauthorized,
  forbidden,
  badRequest,
} from '@/lib/api-utils';
import { parsePeriodFromQuery } from '@/lib/period';
import type { ExpenseEntryRecord, MonthsRecord } from '@/lib/types';
import type { AirtableRecord } from '@/lib/types';

export const runtime = 'edge';

interface MemberExpenseEntry {
  id: string;
  category: string;
  amount: number;
  description: string;
  vendor?: string;
  date?: string;
  month_key: string;
  created_by: string;
  department: string;
}

interface MemberExpensesResponse {
  memberId: string;
  totals: { total: number };
  byCategory: { category: string; total: number }[];
  entries: MemberExpenseEntry[];
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const { id } = await params;
  if (!id) return badRequest(reqId, 'id required');

  const url = request.nextUrl;
  const periodResult = parsePeriodFromQuery(url.searchParams);

  let listFilters: { team_member_id: string; from_month_key?: string; to_month_key?: string; month_id?: string; month_ids?: string[]; owner_type: string };
  if (periodResult.ok) {
    const { from_month_key, to_month_key } = periodResult.period;
    const resolvedMonths = await getMonthKeysInRange(from_month_key, to_month_key);
    if (process.env.NODE_ENV === 'development') {
      console.log('[period]', { from_month_key, to_month_key, resolvedMonths });
    }
    listFilters = { team_member_id: id, from_month_key, to_month_key, owner_type: 'team_member' };
  } else {
    const month_id = url.searchParams.get('month_id') ?? undefined;
    const month_idsParam = url.searchParams.get('month_ids');
    const month_ids = month_idsParam
      ? month_idsParam.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    const resolvedMonthIds = month_ids?.length ? month_ids : month_id ? [month_id] : undefined;
    listFilters = {
      team_member_id: id,
      owner_type: 'team_member',
      ...(resolvedMonthIds?.length === 1
        ? { month_id: resolvedMonthIds[0] }
        : resolvedMonthIds?.length
          ? { month_ids: resolvedMonthIds }
          : {}),
    };
  }

  try {
    const member = await getTeamMember(id);
    if (!member) {
      const res = NextResponse.json({ error: 'Member not found', requestId: reqId }, { status: 404 });
      res.headers.set('request-id', reqId);
      return res;
    }

    const records = await listExpenses(listFilters);

    const monthsRecords = await getMonths();
    const monthIdToKey: Record<string, string> = {};
    for (const m of monthsRecords as AirtableRecord<MonthsRecord>[]) {
      const key = m.fields.month_key ?? '';
      if (m.id) monthIdToKey[m.id] = key;
    }

    const entries: MemberExpenseEntry[] = records.map((r: AirtableRecord<ExpenseEntryRecord>) => {
      const monthId = r.fields.month?.[0] ?? '';
      return {
        id: r.id,
        category: r.fields.category ?? '',
        amount: r.fields.amount ?? 0,
        description: r.fields.description ?? '',
        vendor: r.fields.vendor ?? undefined,
        date: r.fields.date ?? undefined,
        month_key: monthIdToKey[monthId] ?? monthId,
        created_by: r.fields.created_by ?? '',
        department: r.fields.department ?? '',
      };
    });

    const total = entries.reduce((sum, e) => sum + e.amount, 0);
    const byCategoryMap: Record<string, number> = {};
    for (const e of entries) {
      const cat = e.category || 'Uncategorized';
      byCategoryMap[cat] = (byCategoryMap[cat] ?? 0) + e.amount;
    }
    const byCategory = Object.entries(byCategoryMap).map(([category, total]) => ({
      category,
      total,
    }));

    const body: MemberExpensesResponse = {
      memberId: id,
      totals: { total },
      byCategory,
      entries,
    };
    const res = NextResponse.json(body);
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/team-members/[id]/expenses]', e);
    return serverError(reqId, e, { route: '/api/team-members/[id]/expenses' });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);
  if (!canManageTeamMembers(session.role)) return forbidden(reqId, 'Forbidden: admin only');

  const { id } = await params;
  if (!id) return badRequest(reqId, 'id required');

  const member = await getTeamMember(id);
  if (!member) {
    const res = NextResponse.json({ error: 'Member not found', requestId: reqId }, { status: 404 });
    res.headers.set('request-id', reqId);
    return res;
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON');
  }

  const month_id = typeof body.month_id === 'string' ? body.month_id.trim() : '';
  const department = typeof body.department === 'string' ? body.department.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
  const description = typeof body.description === 'string' ? body.description : '';
  const vendor = typeof body.vendor === 'string' ? body.vendor : '';
  const date = typeof body.date === 'string' ? body.date : undefined;
  const receipt_url = typeof body.receipt_url === 'string' ? body.receipt_url : undefined;

  if (!month_id || !category || typeof amount !== 'number' || Number.isNaN(amount) || !department) {
    return badRequest(reqId, 'month_id, department, category, and amount are required');
  }

  try {
    const created = await createExpense({
      month_id,
      amount,
      category,
      department,
      cost_owner_type: 'team_member',
      team_member_id: id,
      description: description || undefined,
      vendor: vendor || undefined,
      date,
      created_by: session.email,
      receipt_url,
    });

    await writeAuditLog({
      user_email: session.email,
      table: 'expense_entries',
      record_id: created.id,
      field_name: 'create',
      old_value: '',
      new_value: JSON.stringify({
        category: created.fields.category,
        amount: created.fields.amount,
        department: created.fields.department,
        cost_owner_type: 'team_member',
        team_member_id: id,
      }),
    });

    const res = NextResponse.json({
      id: created.id,
      month_id: created.fields.month?.[0] ?? '',
      amount: created.fields.amount ?? 0,
      category: created.fields.category ?? '',
      department: created.fields.department ?? '',
      description: created.fields.description ?? '',
      vendor: created.fields.vendor ?? '',
      date: created.fields.date ?? '',
      created_by: created.fields.created_by ?? '',
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/team-members/[id]/expenses POST]', e);
    return serverError(reqId, e, { route: '/api/team-members/[id]/expenses' });
  }
}
