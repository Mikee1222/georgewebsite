import { NextRequest, NextResponse } from 'next/server';
import { getPnlByUniqueKey } from '@/lib/airtable';
import { getSessionFromRequest, canEdit, financeCanEditModel } from '@/lib/auth';
import { requestId, serverError, unauthorized, forbidden, badRequest } from '@/lib/api-utils';

export const runtime = 'edge';

/** Revenue is stored in pnl_lines only (no revenue_entries table). Apply-revenue now just returns current pnl gross_revenue for the given model/month/status. */
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
    return forbidden(reqId, 'Forbidden');
  }

  let body: { month_id: string; month_key: string; status: 'actual' | 'forecast' };
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON');
  }
  const { month_id, month_key, status } = body;
  if (!month_id || !month_key || (status !== 'actual' && status !== 'forecast')) {
    return badRequest(reqId, 'month_id, month_key, and status (actual|forecast) required');
  }

  try {
    const uniqueKey = `${modelId}-${month_key}-${status}`;
    const pnlRecord = await getPnlByUniqueKey(uniqueKey);
    const grossRevenue = pnlRecord != null && typeof (pnlRecord.fields as Record<string, unknown>).gross_revenue === 'number'
      ? (pnlRecord.fields as Record<string, unknown>).gross_revenue as number
      : 0;

    const res = NextResponse.json({
      applied: true,
      gross_revenue: grossRevenue,
      requestId: reqId,
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/models apply-revenue]', e);
    return serverError(reqId, e, { route: `/api/models/${modelId}/apply-revenue` });
  }
}
