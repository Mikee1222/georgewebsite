import { NextRequest, NextResponse } from 'next/server';
import { listExpenseEntries, getMonths } from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, serverError, unauthorized, badRequest } from '@/lib/api-utils';

export const runtime = 'edge';

/** GET /api/models/:id/expenses/summary?month_ids=id1,id2,id3 — aggregate expense totals by month for chart */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const { id: modelId } = await params;
  const monthIdsParam = request.nextUrl.searchParams.get('month_ids') ?? '';
  if (!modelId) return badRequest(reqId, 'model id required');
  const monthIds = monthIdsParam.split(',').map((s) => s.trim()).filter(Boolean);
  if (monthIds.length === 0) return badRequest(reqId, 'month_ids required (comma-separated)');

  try {
    const months = await getMonths();
    const monthKeyById = new Map(months.map((m) => [m.id, m.fields.month_key ?? '']));

    const byMonth: Record<string, { totalAmountEur: number; totalAmountUsd: number; month_key: string }> = {};
    for (const mid of monthIds) {
      byMonth[mid] = { totalAmountEur: 0, totalAmountUsd: 0, month_key: monthKeyById.get(mid) ?? '' };
    }

    for (const mid of monthIds) {
      const records = await listExpenseEntries(modelId, mid);
      let eur = 0;
      let usd = 0;
      for (const r of records) {
        eur += r.fields.amount_eur ?? r.fields.amount ?? 0;
        usd += r.fields.amount_usd ?? 0;
      }
      byMonth[mid] = {
        totalAmountEur: eur,
        totalAmountUsd: usd,
        month_key: monthKeyById.get(mid) ?? '',
      };
    }

    const res = NextResponse.json({ byMonth });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    return serverError(reqId, e, { route: `/api/models/${modelId}/expenses/summary` });
  }
}
