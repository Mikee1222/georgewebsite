import { NextRequest, NextResponse } from 'next/server';
import {
  listExpenseEntries,
  listRevenueEntries,
  getMonths,
  getPnlByUniqueKey,
  updateRecord,
  writeAuditLog,
} from '@/lib/airtable';
import { getSessionFromRequest, canEdit, financeCanEditModel } from '@/lib/auth';
import { requestId, serverError, unauthorized, forbidden, badRequest } from '@/lib/api-utils';
import { PNL_INPUT_FIELDS, type PnlInputFieldName } from '@/lib/types';

export const runtime = 'edge';

/** Expense category -> pnl_lines input field name (1:1). Unknown category maps to other_costs. */
const EXPENSE_CATEGORY_TO_PNL: Record<string, PnlInputFieldName> = {
  chatting_costs_team: 'chatting_costs_team',
  marketing_costs_team: 'marketing_costs_team',
  production_costs_team: 'production_costs_team',
  ads_spend: 'ads_spend',
  other_marketing_costs: 'other_marketing_costs',
  salary: 'salary',
  affiliate_fee: 'affiliate_fee',
  bonuses: 'bonuses',
  airbnbs: 'airbnbs',
  softwares: 'softwares',
  fx_withdrawal_fees: 'fx_withdrawal_fees',
  other_costs: 'other_costs',
};

const ALLOWED_PNL_FOR_APPLY = new Set<string>(
  PNL_INPUT_FIELDS.filter((f) => f !== 'notes_issues')
);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);
  if (!canEdit(session.role)) return forbidden(reqId);

  const { id: modelId } = await params;
  if (!modelId) return badRequest(reqId, 'model id required');
  if (!financeCanEditModel(session.role, modelId, session.allowed_model_ids)) {
    return forbidden(reqId);
  }

  let body: { month_key: string; status: 'actual' | 'forecast' };
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON');
  }
  const { month_key, status } = body;
  if (!month_key || (status !== 'actual' && status !== 'forecast')) {
    return badRequest(reqId, 'month_key and status (actual|forecast) required');
  }

  try {
    const uniqueKey = `${modelId}-${month_key}-${status}`;
    const pnlRecord = await getPnlByUniqueKey(uniqueKey);
    if (!pnlRecord) {
      const res = NextResponse.json(
        {
          error: 'No pnl_lines record for this model/month/status. Ensure forecast or actual row exists.',
          requestId: reqId,
        },
        { status: 404 }
      );
      res.headers.set('request-id', reqId);
      return res;
    }

    const monthsRecords = await getMonths();
    const monthRec = monthsRecords.find((m) => m.fields.month_key === month_key);
    const monthId = monthRec?.id ?? '';
    const expenseRecords = monthId
      ? await listExpenseEntries(modelId, monthId)
      : [];
    const revenueRecords = monthId
      ? await listRevenueEntries(modelId, monthId)
      : [];

    const categorySums: Record<string, number> = {};
    let totalExpenses = 0;
    for (const rec of expenseRecords) {
      const cat = (rec.fields.category ?? '').trim() || 'other_costs';
      const pnlField = EXPENSE_CATEGORY_TO_PNL[cat] ?? 'other_costs';
      const amount = rec.fields.amount ?? 0;
      categorySums[pnlField] = (categorySums[pnlField] ?? 0) + amount;
      totalExpenses += amount;
    }

    let grossRevenue = 0;
    for (const rec of revenueRecords) {
      grossRevenue += rec.fields.amount ?? 0;
    }

    const updatedFields: Record<string, number> = {};
    if (grossRevenue > 0 || revenueRecords.length > 0) {
      updatedFields.gross_revenue = grossRevenue;
    }
    for (const [field, sum] of Object.entries(categorySums)) {
      if (ALLOWED_PNL_FOR_APPLY.has(field)) {
        updatedFields[field] = sum;
      }
    }

    if (Object.keys(updatedFields).length === 0) {
      const res = NextResponse.json({
        updatedFields: {},
        totalExpenses: 0,
        grossRevenue: 0,
        applied: false,
        message: 'No entries to apply',
        requestId: reqId,
      });
      res.headers.set('request-id', reqId);
      return res;
    }

    const recordId = (pnlRecord as { id: string }).id;
    for (const [fieldName, newVal] of Object.entries(updatedFields)) {
      const oldVal = (pnlRecord.fields as Record<string, unknown>)[fieldName];
      const oldStr = oldVal != null ? String(oldVal) : '';
      const newStr = String(newVal);
      if (oldStr !== newStr) {
        await writeAuditLog({
          user_email: session.email,
          table: 'pnl_lines',
          record_id: recordId,
          field_name: fieldName,
          old_value: oldStr,
          new_value: newStr,
        });
      }
    }
    await updateRecord('pnl_lines', recordId, updatedFields as Record<string, unknown>);

    await writeAuditLog({
      user_email: session.email,
      table: 'apply_entries',
      record_id: uniqueKey,
      field_name: 'apply',
      old_value: '',
      new_value: JSON.stringify({ modelId, month_key, status, totalExpenses, grossRevenue }),
    });

    const res = NextResponse.json({
      updatedFields,
      totalExpenses,
      grossRevenue,
      applied: true,
      requestId: reqId,
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    return serverError(reqId, e, { route: `/api/models/${modelId}/apply-entries` });
  }
}
