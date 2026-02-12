import { NextRequest, NextResponse } from 'next/server';
import { listExpenseEntries, createExpense, writeAuditLog } from '@/lib/airtable';
import { getSessionFromRequest, canWriteExpense } from '@/lib/auth';
import { requestId, serverError, unauthorized, forbidden, badRequest } from '@/lib/api-utils';
import { getFxRateForServer, ensureDualAmounts } from '@/lib/fx';
import type { ExpenseEntry, ExpenseEntryRecord } from '@/lib/types';
import type { AirtableRecord } from '@/lib/types';

export const runtime = 'edge';

function toExpenseEntry(rec: AirtableRecord<ExpenseEntryRecord>): ExpenseEntry {
  return {
    id: rec.id,
    month_id: rec.fields.month?.[0] ?? '',
    amount: rec.fields.amount ?? 0,
    amount_usd: rec.fields.amount_usd,
    amount_eur: rec.fields.amount_eur,
    category: rec.fields.category ?? '',
    department: rec.fields.department ?? 'models',
    cost_owner_type: (rec.fields.cost_owner_type as ExpenseEntry['cost_owner_type']) ?? 'model',
    model_id: rec.fields.model?.[0] ?? '',
    team_member_id: rec.fields.team_member?.[0] ?? '',
    description: rec.fields.description ?? '',
    vendor: rec.fields.vendor ?? '',
    date: rec.fields.date ?? '',
    created_by: rec.fields.created_by ?? '',
    receipt_url: rec.fields.receipt_url ?? '',
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const { id: modelId } = await params;
  const monthId = request.nextUrl.searchParams.get('month_id') ?? '';
  if (!modelId) return badRequest(reqId, 'model id required');
  if (!monthId) return badRequest(reqId, 'month_id required');

  try {
    const records = await listExpenseEntries(modelId, monthId);
    const items = records.map(toExpenseEntry);
    const totalsByCategory: Record<string, number> = {};
    let totalAmountEur = 0;
    let totalAmountUsd = 0;
    for (const e of items) {
      const amtEur = e.amount_eur ?? e.amount ?? 0;
      const amtUsd = e.amount_usd ?? 0;
      totalAmountEur += amtEur;
      totalAmountUsd += amtUsd;
      const c = e.category || 'other_costs';
      totalsByCategory[c] = (totalsByCategory[c] ?? 0) + amtEur;
    }
    const res = NextResponse.json({
      items,
      totalsByCategory,
      totalAmountEur,
      totalAmountUsd,
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    return serverError(reqId, e, { route: `/api/models/${modelId}/expenses` });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const { id: modelId } = await params;
  if (!modelId) return badRequest(reqId, 'model id required');
  if (!canWriteExpense(session.role, 'model', modelId, session.allowed_model_ids)) {
    return forbidden(reqId);
  }

  let body: {
    month_id: string;
    category: string;
    amount?: number;
    amount_usd?: number;
    amount_eur?: number;
    description?: string;
    date?: string;
  };
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON');
  }
  const { month_id, category, amount, amount_usd, amount_eur, description, date: bodyDate } = body;
  if (!month_id || !category) return badRequest(reqId, 'month_id and category required');
  const hasAmount = typeof amount === 'number';
  const hasUsd = typeof amount_usd === 'number';
  const hasEur = typeof amount_eur === 'number';
  if (!hasAmount && !hasUsd && !hasEur) return badRequest(reqId, 'At least one of amount, amount_usd, or amount_eur required');
  const effectiveEur = hasEur ? amount_eur! : (typeof amount === 'number' ? amount : undefined);
  const effectiveUsd = hasUsd ? amount_usd : undefined;
  const origin = new URL(request.url).origin;
  const fx = await getFxRateForServer(origin);
  const { amount_usd: finalUsd, amount_eur: finalEur } = ensureDualAmounts(effectiveUsd, effectiveEur, fx?.rate ?? null);

  try {
    const payload = {
      month_id,
      amount: finalEur,
      amount_usd: finalUsd,
      amount_eur: finalEur,
      category: category.trim(),
      department: 'models',
      cost_owner_type: 'model' as const,
      model_id: modelId,
      description: description ?? '',
      date: bodyDate ?? new Date().toISOString().slice(0, 10),
      created_by: session.email,
    };
    if (process.env.NODE_ENV === 'development') {
      console.log('[expenses POST] payload model/month (arrays):', { model: [modelId], month: [month_id] });
    }
    const created = await createExpense(payload);
    await writeAuditLog({
      user_email: session.email,
      table: 'expense_entries',
      record_id: (created as { id?: string }).id ?? '',
      field_name: 'create',
      old_value: '',
      new_value: JSON.stringify({ category, amount, month_id }),
    });
    const res = NextResponse.json(toExpenseEntry(created as AirtableRecord<ExpenseEntryRecord>));
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    return serverError(reqId, e, { route: `/api/models/${modelId}/expenses` });
  }
}
