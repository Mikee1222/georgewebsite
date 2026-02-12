import { NextRequest, NextResponse } from 'next/server';
import { listPayoutRuns, getMonths } from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, serverError, unauthorized } from '@/lib/api-utils';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const month_id = request.nextUrl.searchParams.get('month_id')?.trim();

  try {
    const runs = await listPayoutRuns(month_id);
    const months = await getMonths();
    const monthKeyById: Record<string, string> = {};
    for (const m of months) {
      monthKeyById[m.id] = m.fields.month_key ?? '';
    }
    const list = runs.map((r) => ({
      id: r.id,
      month_id: r.fields.month?.[0] ?? '',
      month_key: r.fields.month?.[0] ? monthKeyById[r.fields.month[0]] ?? '' : '',
      status: r.fields.status ?? 'draft',
      notes: r.fields.notes ?? '',
    }));
    const res = NextResponse.json({ ok: true, requestId: reqId, sample: list });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/payout-runs GET]', e);
    return serverError(reqId, e, { route: '/api/payout-runs' });
  }
}
