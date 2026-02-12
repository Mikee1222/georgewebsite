import { NextRequest, NextResponse } from 'next/server';
import { getWeeksOverlappingMonth, getMonths, createWeek, deriveWeekKey } from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, serverError, unauthorized, badRequest } from '@/lib/api-utils';

export const runtime = 'edge';

/** Validate ISO date string (yyyy-mm-dd). */
function isValidIsoDate(s: string): boolean {
  if (!s?.trim()) return false;
  const m = s.trim().match(/^\d{4}-\d{2}-\d{2}$/);
  if (!m) return false;
  const d = new Date(s + 'T12:00:00Z');
  return !Number.isNaN(d.getTime());
}

/** GET /api/weeks?month_id=... or ?month_key=... (month_id can be Airtable id or YYYY-MM). Returns overlapping weeks. */
export async function GET(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  let month_key = request.nextUrl.searchParams.get('month_key')?.trim();
  let month_id = request.nextUrl.searchParams.get('month_id')?.trim();

  if (!month_key && month_id && /^\d{4}-\d{2}$/.test(month_id)) {
    month_key = month_id;
    month_id = '';
  }
  let resolvedMonthKey = month_key;
  if (!resolvedMonthKey && month_id) {
    const months = await getMonths();
    const m = months.find((r) => r.id === month_id);
    resolvedMonthKey = m?.fields.month_key ?? '';
  }
  if (!resolvedMonthKey) return badRequest(reqId, 'month_key or month_id required');

  try {
    const weeks = await getWeeksOverlappingMonth(resolvedMonthKey);
    const res = NextResponse.json({
      ok: true,
      requestId: reqId,
      sample: weeks,
      weeks,
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/weeks]', e);
    return serverError(reqId, e, { route: '/api/weeks' });
  }
}

/** POST /api/weeks — create week. Body: { week_start: iso, week_end?: iso }. week_end accepted but ignored (computed in Airtable). */
export async function POST(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON');
  }

  const week_start = typeof body.week_start === 'string' ? body.week_start.trim() : '';
  // week_end accepted from UI but ignored server-side (Airtable computes it from week_start)

  if (!week_start) return badRequest(reqId, 'week_start required');
  if (!isValidIsoDate(week_start)) {
    return badRequest(reqId, 'week_start must be valid ISO date (yyyy-mm-dd)');
  }

  try {
    const created = await createWeek(week_start);
    const sample = {
      id: created.id,
      week_start: created.fields.week_start,
      week_end: created.fields.week_end,
      week_key: deriveWeekKey(created.fields.week_start, created.fields.week_end),
    };
    const res = NextResponse.json({ ok: true, requestId: reqId, sample });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/weeks POST]', e);
    return serverError(reqId, e, { route: '/api/weeks' });
  }
}
