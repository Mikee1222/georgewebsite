import { NextRequest, NextResponse } from 'next/server';
import { getMonths } from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, serverError, unauthorized } from '@/lib/api-utils';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  try {
    const records = await getMonths();
    const list = records
      .map((r) => ({
        id: r.id,
        month_key: r.fields.month_key ?? '',
        month_name: r.fields.month_name ?? r.fields.month_key ?? '',
      }))
      .sort((a, b) => (b.month_key || '').localeCompare(a.month_key || ''));
    const res = NextResponse.json(list);
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/months]', e);
    return serverError(reqId, e, { route: '/api/months' });
  }
}
