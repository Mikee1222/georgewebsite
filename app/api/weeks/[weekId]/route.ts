import { NextRequest, NextResponse } from 'next/server';
import { updateWeek, deleteWeek, getRecord, deriveWeekKey } from '@/lib/airtable';
import type { WeeksRecord } from '@/lib/types';
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

/** PATCH /api/weeks/[weekId] — update week. Body: { week_start?: iso, week_end?: iso }. week_end accepted but ignored (computed in Airtable). */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ weekId: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const { weekId } = await params;
  if (!weekId?.trim()) return badRequest(reqId, 'weekId required');

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON');
  }

  const week_start = typeof body.week_start === 'string' ? body.week_start.trim() : undefined;
  const week_end = typeof body.week_end === 'string' ? body.week_end.trim() : undefined;
  // week_end accepted from UI but ignored server-side (Airtable computes it from week_start)

  if (week_start != null && !isValidIsoDate(week_start)) {
    return badRequest(reqId, 'week_start must be valid ISO date (yyyy-mm-dd)');
  }

  try {
    const updated = await updateWeek(weekId, { week_start, week_end });
    const sample = {
      id: updated.id,
      week_start: updated.fields.week_start,
      week_end: updated.fields.week_end,
      week_key: deriveWeekKey(updated.fields.week_start, updated.fields.week_end),
    };
    const res = NextResponse.json({ ok: true, requestId: reqId, sample });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('not found')) {
      const res = NextResponse.json({ error: 'Week not found', requestId: reqId }, { status: 404 });
      res.headers.set('request-id', reqId);
      return res;
    }
    if (process.env.NODE_ENV === 'development') console.error('[api/weeks PATCH]', e);
    return serverError(reqId, e, { route: '/api/weeks/[weekId]' });
  }
}

/** DELETE /api/weeks/[weekId] — delete week. ?force=true to delete week + its stats. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ weekId: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const { weekId } = await params;
  if (!weekId?.trim()) return badRequest(reqId, 'weekId required');

  const force = request.nextUrl.searchParams.get('force') === 'true';

  try {
    const existing = await getRecord<WeeksRecord>('weeks', weekId);
    if (!existing) {
      const res = NextResponse.json({ error: 'Week not found', requestId: reqId }, { status: 404 });
      res.headers.set('request-id', reqId);
      return res;
    }

    await deleteWeek(weekId, force);
    const res = NextResponse.json({ ok: true, requestId: reqId });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('Cannot delete') && msg.includes('weekly stats')) {
      const res = NextResponse.json(
        { error: msg, requestId: reqId },
        { status: 409 }
      );
      res.headers.set('request-id', reqId);
      return res;
    }
    if (process.env.NODE_ENV === 'development') console.error('[api/weeks DELETE]', e);
    return serverError(reqId, e, { route: '/api/weeks/[weekId]' });
  }
}
