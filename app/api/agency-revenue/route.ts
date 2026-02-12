import { NextRequest, NextResponse } from 'next/server';
import { getMonthKeyFromId, getAgencyRevenuesForMonth, upsertAgencyRevenuesForMonth, writeAuditLog, AGENCY_REVENUES_TABLE_KEY } from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, serverError, unauthorized, badRequest } from '@/lib/api-utils';
import { getFxRateForServer, ensureDualAmounts } from '@/lib/fx';
import type { AgencyRevenuesApiResponse } from '@/lib/types';

export const runtime = 'edge';

/** GET ?month_id= — returns { ok, requestId, month_id, month_key, exists, recordId?, amounts, chatting_agency?, gunzo_agency? }. */
export async function GET(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const month_id = request.nextUrl.searchParams.get('month_id')?.trim();
  if (!month_id) return badRequest(reqId, 'month_id is required');

  try {
    const month_key = await getMonthKeyFromId(month_id);
    const data = await getAgencyRevenuesForMonth(month_id);
    const exists = Boolean(data?.id?.trim());
    const body: AgencyRevenuesApiResponse = {
      ok: true,
      requestId: reqId,
      month_id,
      month_key: month_key ?? '',
      exists,
      recordId: exists && data ? data.id : undefined,
      chatting_amount_usd: data?.chatting_amount_usd ?? null,
      chatting_amount_eur: data?.chatting_amount_eur ?? null,
      gunzo_amount_usd: data?.gunzo_amount_usd ?? null,
      gunzo_amount_eur: data?.gunzo_amount_eur ?? null,
      chatting_msgs_tips_net_usd: data?.chatting_msgs_tips_net_usd ?? null,
      chatting_msgs_tips_net_eur: data?.chatting_msgs_tips_net_eur ?? null,
      gunzo_msgs_tips_net_usd: data?.gunzo_msgs_tips_net_usd ?? null,
      gunzo_msgs_tips_net_eur: data?.gunzo_msgs_tips_net_eur ?? null,
      chatting_agency: data?.chatting_agency ?? null,
      gunzo_agency: data?.gunzo_agency ?? null,
      notes: data?.notes ?? null,
    };
    const res = NextResponse.json(body);
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/agency-revenue GET]', e);
    return serverError(reqId, e, { route: '/api/agency-revenue' });
  }
}

/** POST — body: { month_id, chatting_amount_usd?, chatting_amount_eur?, gunzo_amount_usd?, gunzo_amount_eur?, notes? }. At least one numeric field required. Upserts agency_revenues for the month. */
export async function POST(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  let body: {
    month_id?: string;
    chatting_amount_usd?: number;
    chatting_amount_eur?: number;
    gunzo_amount_usd?: number;
    gunzo_amount_eur?: number;
    chatting_msgs_tips_net_usd?: number;
    chatting_msgs_tips_net_eur?: number;
    gunzo_msgs_tips_net_usd?: number;
    gunzo_msgs_tips_net_eur?: number;
    notes?: string;
  };
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON body');
  }
  const month_id = body.month_id?.trim();
  if (!month_id) return badRequest(reqId, 'month_id is required');

  const hasChatting =
    body.chatting_amount_usd !== undefined ||
    body.chatting_amount_eur !== undefined;
  const hasGunzo =
    body.gunzo_amount_usd !== undefined ||
    body.gunzo_amount_eur !== undefined;
  if (!hasChatting && !hasGunzo) {
    return badRequest(reqId, 'At least one of chatting_amount_usd/eur or gunzo_amount_usd/eur is required');
  }

  const origin = new URL(request.url).origin;
  const fx = await getFxRateForServer(origin);
  const rate = fx?.rate ?? null;

  const payload: Parameters<typeof upsertAgencyRevenuesForMonth>[1] = {};
  if (hasChatting) {
    const cu = typeof body.chatting_amount_usd === 'number' ? body.chatting_amount_usd : undefined;
    const ce = typeof body.chatting_amount_eur === 'number' ? body.chatting_amount_eur : undefined;
    const { amount_usd: cUsd, amount_eur: cEur } = ensureDualAmounts(cu, ce, rate);
    payload.chatting_amount_usd = cUsd;
    payload.chatting_amount_eur = cEur;
  }
  if (hasGunzo) {
    const gu = typeof body.gunzo_amount_usd === 'number' ? body.gunzo_amount_usd : undefined;
    const ge = typeof body.gunzo_amount_eur === 'number' ? body.gunzo_amount_eur : undefined;
    const { amount_usd: gUsd, amount_eur: gEur } = ensureDualAmounts(gu, ge, rate);
    payload.gunzo_amount_usd = gUsd;
    payload.gunzo_amount_eur = gEur;
  }
  const hasChattingMsgsTips =
    body.chatting_msgs_tips_net_usd !== undefined ||
    body.chatting_msgs_tips_net_eur !== undefined;
  const hasGunzoMsgsTips =
    body.gunzo_msgs_tips_net_usd !== undefined ||
    body.gunzo_msgs_tips_net_eur !== undefined;

  if (hasChattingMsgsTips) {
    const cu = typeof body.chatting_msgs_tips_net_usd === 'number' ? body.chatting_msgs_tips_net_usd : undefined;
    const ce = typeof body.chatting_msgs_tips_net_eur === 'number' ? body.chatting_msgs_tips_net_eur : undefined;
    const { amount_usd: cUsd, amount_eur: cEur } = ensureDualAmounts(cu, ce, rate);
    payload.chatting_msgs_tips_net_usd = cUsd;
    payload.chatting_msgs_tips_net_eur = cEur;
  }
  if (hasGunzoMsgsTips) {
    const gu = typeof body.gunzo_msgs_tips_net_usd === 'number' ? body.gunzo_msgs_tips_net_usd : undefined;
    const ge = typeof body.gunzo_msgs_tips_net_eur === 'number' ? body.gunzo_msgs_tips_net_eur : undefined;
    const { amount_usd: gUsd, amount_eur: gEur } = ensureDualAmounts(gu, ge, rate);
    payload.gunzo_msgs_tips_net_usd = gUsd;
    payload.gunzo_msgs_tips_net_eur = gEur;
  }

  if (body.notes !== undefined) payload.notes = body.notes ?? '';

  try {
    await upsertAgencyRevenuesForMonth(month_id, payload);
    const month_key = await getMonthKeyFromId(month_id);
    const data = await getAgencyRevenuesForMonth(month_id);
    const exists = Boolean(data?.id?.trim());
      const out: AgencyRevenuesApiResponse = {
      ok: true,
      requestId: reqId,
      month_id,
      month_key: month_key ?? '',
      exists,
      recordId: exists && data ? data.id : undefined,
      chatting_amount_usd: data?.chatting_amount_usd ?? null,
      chatting_amount_eur: data?.chatting_amount_eur ?? null,
      gunzo_amount_usd: data?.gunzo_amount_usd ?? null,
      gunzo_amount_eur: data?.gunzo_amount_eur ?? null,
        chatting_msgs_tips_net_usd: data?.chatting_msgs_tips_net_usd ?? null,
        chatting_msgs_tips_net_eur: data?.chatting_msgs_tips_net_eur ?? null,
        gunzo_msgs_tips_net_usd: data?.gunzo_msgs_tips_net_usd ?? null,
        gunzo_msgs_tips_net_eur: data?.gunzo_msgs_tips_net_eur ?? null,
      chatting_agency: data?.chatting_agency ?? null,
      gunzo_agency: data?.gunzo_agency ?? null,
      notes: data?.notes ?? null,
    };
    await writeAuditLog({
      user_email: session.email,
      table: AGENCY_REVENUES_TABLE_KEY,
      record_id: out.recordId || month_id,
      field_name: 'upsert',
      old_value: '',
      new_value: JSON.stringify({ chatting_amount_usd: out.chatting_amount_usd, chatting_amount_eur: out.chatting_amount_eur, gunzo_amount_usd: out.gunzo_amount_usd, gunzo_amount_eur: out.gunzo_amount_eur }),
    });
    const res = NextResponse.json(out);
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/agency-revenue POST]', e);
    return serverError(reqId, e, { route: '/api/agency-revenue' });
  }
}
