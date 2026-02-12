import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, unauthorized, badRequest } from '@/lib/api-utils';
import { computePreviewPayouts } from '@/lib/payout-compute';
import { getFxRateDirect } from '@/lib/fx';

export const runtime = 'edge';

/** GET /api/payout-runs/preview?month_id=xxx — compute payout lines for all team members; no Airtable writes. */
export async function GET(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const month_id = request.nextUrl.searchParams.get('month_id')?.trim();
  if (!month_id) return badRequest(reqId, 'month_id is required');

  if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
    console.log('[api/payout-runs/preview] request', { month_id });
  }

  try {
    const fxRate = await getFxRateDirect();
    const { lines, month_key, byTab } = await computePreviewPayouts(month_id, fxRate > 0 ? fxRate : null);

    if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
      console.log('[api/payout-runs/preview] response', {
        linesCount: lines.length,
        month_key,
        byTab: {
          chatters: byTab.chatters.length,
          managers: byTab.managers.length,
          vas: byTab.vas.length,
          models: byTab.models.length,
        },
      });
    }

    const res = NextResponse.json({
      ok: true,
      requestId: reqId,
      lines,
      month_key,
      byTab,
      fx_rate: fxRate,
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Preview failed';
    if (process.env.NODE_ENV === 'development') console.error('[api/payout-runs/preview]', e);
    return badRequest(reqId, message);
  }
}
