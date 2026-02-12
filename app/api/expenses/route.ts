import { NextRequest, NextResponse } from 'next/server';
import { listExpenses, getMonthKeysInRange, createExpense, writeAuditLog } from '@/lib/airtable';
import { getSessionFromRequest, canWriteExpense } from '@/lib/auth';
import { requestId, serverError, unauthorized, forbidden, badRequest } from '@/lib/api-utils';
import { getFxRateDirect, ensureDualAmounts } from '@/lib/fx';
import { parsePeriodFromQuery } from '@/lib/period';
import { MARKETING_PRODUCTION_CATEGORY_VALUES } from '@/lib/expense-categories';
import type { ExpenseEntry, ExpenseEntryRecord } from '@/lib/types';
import type { AirtableRecord } from '@/lib/types';

export const runtime = 'edge';

function toExpenseEntry(rec: AirtableRecord<ExpenseEntryRecord>): ExpenseEntry {
  const createdAt = rec.fields.created_at ?? (rec as { createdTime?: string }).createdTime;
  return {
    id: rec.id,
    month_id: rec.fields.month?.[0] ?? '',
    amount: rec.fields.amount ?? 0,
    amount_usd: rec.fields.amount_usd,
    amount_eur: rec.fields.amount_eur,
    category: rec.fields.category ?? '',
    department: rec.fields.department ?? '',
    cost_owner_type: (rec.fields.cost_owner_type as ExpenseEntry['cost_owner_type']) ?? 'agency',
    model_id: rec.fields.model?.[0] ?? '',
    team_member_id: rec.fields.team_member?.[0] ?? '',
    description: rec.fields.description ?? '',
    vendor: rec.fields.vendor ?? '',
    date: rec.fields.date ?? '',
    created_by: rec.fields.created_by ?? '',
    receipt_url: rec.fields.receipt_url ?? '',
    created_at: typeof createdAt === 'string' ? createdAt : undefined,
  };
}

export async function GET(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const url = request.nextUrl;
  const periodResult = parsePeriodFromQuery(url.searchParams);
  const department = url.searchParams.get('department') ?? undefined;
  const owner_type = url.searchParams.get('owner_type') ?? undefined;
  const model_id = url.searchParams.get('model_id') ?? undefined;
  const team_member_id = url.searchParams.get('team_member_id') ?? undefined;
  const categoriesParam = url.searchParams.get('categories') ?? undefined;
  const categories = categoriesParam ? categoriesParam.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  const isMarketingProduction =
    categories &&
    categories.length === MARKETING_PRODUCTION_CATEGORY_VALUES.length &&
    MARKETING_PRODUCTION_CATEGORY_VALUES.every((c) => categories.includes(c));

  let filters: Parameters<typeof listExpenses>[0] = {
    department: department ?? undefined,
    owner_type: owner_type ?? undefined,
    model_id: model_id ?? undefined,
    team_member_id: team_member_id ?? undefined,
    categories: isMarketingProduction ? categories : undefined,
  };
  if (periodResult.ok && !isMarketingProduction) {
    const { from_month_key, to_month_key } = periodResult.period;
    filters = { ...filters, from_month_key, to_month_key };
  } else if (!periodResult.ok) {
    const month_id = url.searchParams.get('month_id') ?? undefined;
    const month_idsParam = url.searchParams.get('month_ids');
    const month_ids = month_idsParam ? month_idsParam.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    filters = { ...filters, month_id, month_ids: month_ids?.length ? month_ids : undefined };
  }
  if (isMarketingProduction) {
    const month_id = url.searchParams.get('month_id') ?? undefined;
    if (!month_id?.trim()) {
      const res = NextResponse.json({ entries: [], totals: { marketing_usd: 0, marketing_eur: 0, production_usd: 0, production_eur: 0, total_usd: 0, total_eur: 0 } });
      res.headers.set('request-id', reqId);
      return res;
    }
    filters = { ...filters, month_id };
  }

  try {
    const records = await listExpenses(filters, { requestId: reqId });
    const entries = records.map((r) => toExpenseEntry(r as AirtableRecord<ExpenseEntryRecord>));

    if (isMarketingProduction) {
      let marketing_usd = 0;
      let marketing_eur = 0;
      let production_usd = 0;
      let production_eur = 0;
      for (const e of entries) {
        const usd = typeof e.amount_usd === 'number' && Number.isFinite(e.amount_usd) ? e.amount_usd : 0;
        const eur = typeof e.amount_eur === 'number' && Number.isFinite(e.amount_eur) ? e.amount_eur : (typeof e.amount === 'number' && Number.isFinite(e.amount) ? e.amount : 0);
        if (e.category === 'marketing_tools' || e.category === 'marketing_other') {
          marketing_usd += usd;
          marketing_eur += eur;
        } else {
          production_usd += usd;
          production_eur += eur;
        }
      }
      const total_usd = marketing_usd + production_usd;
      const total_eur = marketing_eur + production_eur;
      if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
        console.log('[marketing expenses]', { month_id: filters.month_id, count: entries.length, totals_usd: total_usd, totals_eur: total_eur });
      }
      const res = NextResponse.json({
        entries,
        totals: { marketing_usd, marketing_eur, production_usd, production_eur, total_usd, total_eur },
      });
      res.headers.set('request-id', reqId);
      return res;
    }

    const res = NextResponse.json(entries);
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    return serverError(reqId, e, { route: '/api/expenses' });
  }
}

export async function POST(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  let body: {
    month_id: string;
    amount?: number;
    amount_usd?: number;
    amount_eur?: number;
    category: string;
    department: string;
    cost_owner_type: 'model' | 'team_member' | 'agency';
    model_id?: string;
    team_member_id?: string;
    description?: string;
    vendor?: string;
    date?: string;
    receipt_url?: string;
  };
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON');
  }

  const {
    month_id,
    amount,
    amount_usd,
    amount_eur,
    category,
    department,
    cost_owner_type,
    model_id,
    team_member_id,
    description,
    vendor,
    date,
    receipt_url,
  } = body;

  if (!month_id || !category?.trim() || !department?.trim() || !cost_owner_type) {
    return badRequest(reqId, 'month_id, category, and department are required');
  }
  const hasAmount = typeof amount === 'number';
  const hasUsd = typeof amount_usd === 'number';
  const hasEur = typeof amount_eur === 'number';
  if (!hasAmount && !hasUsd && !hasEur) {
    return badRequest(reqId, 'At least one of amount, amount_usd, or amount_eur is required');
  }
  const amountVal = typeof amount === 'number' ? amount : (typeof amount_eur === 'number' ? amount_eur : amount_usd ?? 0);

  if (cost_owner_type === 'model') {
    if (!model_id?.trim()) {
      return badRequest(reqId, 'model_id required when cost_owner_type is model');
    }
    if (!canWriteExpense(session.role, 'model', model_id, session.allowed_model_ids)) {
      return forbidden(reqId);
    }
  } else if (cost_owner_type === 'team_member') {
    if (!team_member_id?.trim()) {
      return badRequest(reqId, 'team_member_id required when cost_owner_type is team_member');
    }
    if (!canWriteExpense(session.role, 'team_member', undefined, session.allowed_model_ids)) {
      return forbidden(reqId);
    }
  } else if (cost_owner_type === 'agency') {
    if (!canWriteExpense(session.role, 'agency', undefined, session.allowed_model_ids)) {
      return forbidden(reqId);
    }
  } else {
    return badRequest(reqId, 'cost_owner_type must be model, team_member, or agency');
  }

  const effectiveEur = hasEur ? amount_eur! : (typeof amount === 'number' ? amount : undefined);
  const effectiveUsd = hasUsd ? amount_usd : undefined;
  const fxRate = await getFxRateDirect();
  const { amount_usd: finalUsd, amount_eur: finalEur } = ensureDualAmounts(effectiveUsd, effectiveEur, fxRate);

  try {
    const created = await createExpense({
      month_id,
      amount: finalEur,
      amount_usd: finalUsd,
      amount_eur: finalEur,
      category: category.trim(),
      department: department.trim(),
      cost_owner_type,
      model_id: cost_owner_type === 'model' ? model_id : undefined,
      team_member_id: cost_owner_type === 'team_member' ? team_member_id : undefined,
      description,
      vendor,
      date,
      created_by: session.email,
      receipt_url,
    });
    await writeAuditLog({
      user_email: session.email,
      table: 'expense_entries',
      record_id: (created as { id: string }).id,
      field_name: 'create',
      old_value: '',
      new_value: JSON.stringify({ amount: amountVal, amount_usd, amount_eur, category, department, cost_owner_type, month_id }),
    });
    const res = NextResponse.json(toExpenseEntry(created as AirtableRecord<ExpenseEntryRecord>));
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('Airtable 422') || msg.includes('INVALID_VALUE_FOR_COLUMN') || msg.includes('INVALID_MULTIPLE_CHOICE')) {
      return badRequest(reqId, 'Invalid category or field value. Use an existing option from Airtable.');
    }
    return serverError(reqId, e, { route: '/api/expenses' });
  }
}
