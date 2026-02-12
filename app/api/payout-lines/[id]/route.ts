import { NextRequest, NextResponse } from 'next/server';
import { getRecord, getModel, getPayoutRun, listExpenseEntries, createExpense, updatePayoutLine } from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, serverError, unauthorized, badRequest, forbidden } from '@/lib/api-utils';
import { getFxRateDirect, convertUsdToEur, convertEurToUsd, round2 } from '@/lib/fx';
import type { PayoutLineRecord } from '@/lib/types';
import type { MonthsRecord } from '@/lib/types';

export const runtime = 'edge';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const { id } = await params;
  if (!id?.trim()) return badRequest(reqId, 'id is required');

  let body: { paid?: boolean; paid_status?: string };
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON body');
  }

  let paidStatus: 'paid' | 'pending' | undefined;
  if (typeof body.paid === 'boolean') {
    paidStatus = body.paid ? 'paid' : 'pending';
  } else {
    const ps = body.paid_status?.trim();
    if (ps && ps !== 'paid' && ps !== 'pending') {
      return badRequest(reqId, 'paid_status must be paid or pending');
    }
    if (ps === 'paid' || ps === 'pending') paidStatus = ps;
  }

  try {
    const existing = await getRecord<PayoutLineRecord>('payout_lines', id);
    if (!existing) return forbidden(reqId, 'Payout line not found');

    const updates: Partial<{ paid_status: string; paid_at: string | null }> = {};
    if (paidStatus === 'paid') {
      updates.paid_status = 'paid';
      updates.paid_at = new Date().toISOString().slice(0, 10); // YYYY-MM-DD for Airtable date field
    } else if (paidStatus === 'pending') {
      updates.paid_status = 'pending';
      updates.paid_at = null;
    }

    if (Object.keys(updates).length === 0) {
      const res = NextResponse.json({
        id: existing.id,
        paid_status: existing.fields.paid_status ?? 'pending',
        paid_at: existing.fields.paid_at ?? null,
      });
      res.headers.set('request-id', reqId);
      return res;
    }

    const updated = await updatePayoutLine(id, updates);

    const wasUnpaid = (existing.fields.paid_status ?? 'pending') !== 'paid';
    if (paidStatus === 'paid' && wasUnpaid) {
      const modelId = existing.fields.model?.[0]?.trim();
      const runId = existing.fields.payout_run?.[0]?.trim();
      if (modelId && runId) {
        try {
          const [payoutRun, modelRec] = await Promise.all([getPayoutRun(runId), getModel(modelId)]);
          const monthId = payoutRun?.fields?.month?.[0]?.trim();
          if (!monthId || !modelRec) {
            if (modelId && runId && !modelRec) console.log('[salary-expense] skipped', { reason: 'model_or_month_missing', modelId, monthId: monthId ?? null });
          } else {
            const comp = (modelRec.fields.compensation_type ?? '') as string;
            if (comp !== 'Salary') {
              console.log('[salary-expense] skipped', { reason: 'not_salary', modelId, compensation_type: comp });
            } else {
              const existingEntries = await listExpenseEntries(modelId, monthId);
              const hasAutoSalaryEntry = existingEntries.some(
                (r) => (r.fields.category ?? '') === 'salary' && String(r.fields.description ?? '').startsWith('[salary:auto]')
              );
              if (hasAutoSalaryEntry) {
                console.log('[salary-expense] skipped', { reason: 'already_exists', modelId, monthId });
              } else {
                const salaryUsd = typeof modelRec.fields.salary_usd === 'number' ? modelRec.fields.salary_usd : undefined;
                const salaryEur = typeof modelRec.fields.salary_eur === 'number' ? modelRec.fields.salary_eur : undefined;
                const fxRate = await getFxRateDirect();
                let amount_usd: number;
                let amount_eur: number;
                if (salaryUsd != null && Number.isFinite(salaryUsd) && salaryUsd > 0) {
                  amount_usd = round2(salaryUsd);
                  amount_eur = fxRate > 0 ? round2(convertUsdToEur(salaryUsd, fxRate)) : 0;
                } else if (salaryEur != null && Number.isFinite(salaryEur) && salaryEur > 0) {
                  amount_eur = round2(salaryEur);
                  amount_usd = fxRate > 0 ? round2(convertEurToUsd(salaryEur, fxRate)) : 0;
                } else {
                  amount_usd = 0;
                  amount_eur = 0;
                }
                if (amount_usd > 0 || amount_eur > 0) {
                  const monthRec = await getRecord<MonthsRecord>('months', monthId);
                  const month_key = (monthRec?.fields?.month_key ?? monthId) as string;
                  const modelName = (modelRec.fields.name ?? modelId) as string;
                  const description = `[salary:auto] salary - ${modelName} - ${month_key}`;
                  await createExpense({
                    month_id: monthId,
                    amount: amount_usd > 0 ? amount_usd : amount_eur,
                    amount_usd,
                    amount_eur,
                    category: 'salary',
                    department: 'models',
                    cost_owner_type: 'model',
                    model_id: modelId,
                    description,
                    created_by: session.email ?? 'system',
                  });
                  console.log('[salary-expense] created', { modelId, monthId, month_key, amount_usd, amount_eur });
                } else {
                  console.log('[salary-expense] skipped', { reason: 'zero_salary', modelId });
                }
              }
            }
          }
        } catch (sideEffectErr) {
          console.error('[salary-expense] error', { modelId: existing.fields.model?.[0], err: sideEffectErr });
        }
      }
    }

    const res = NextResponse.json({
      id: updated.id,
      paid_status: (updated.fields as PayoutLineRecord).paid_status ?? 'pending',
      paid_at: (updated.fields as PayoutLineRecord).paid_at ?? null,
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/payout-lines/[id] PATCH]', e);
    return serverError(reqId, e, { route: '/api/payout-lines/[id]' });
  }
}
