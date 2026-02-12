import { NextRequest, NextResponse } from 'next/server';
import { getPnlForModel, getMonths, getSettings } from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { rawToPnlRow } from '@/lib/business-rules';
import { requestId, serverError, unauthorized, badRequest } from '@/lib/api-utils';
import type { SettingsMap } from '@/lib/types';

export const runtime = 'edge';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const { id: modelId } = await params;
  const status = request.nextUrl.searchParams.get('status') as 'actual' | 'forecast' | null;
  if (!modelId) return badRequest(reqId, 'model id required');

  try {
    const [settingsRows, monthsRecords] = await Promise.all([getSettings(), getMonths()]);
    const settingsMap: Partial<SettingsMap> = {};
    for (const r of settingsRows) {
      const name = r.setting_name as keyof SettingsMap;
      if (name && typeof r.value === 'number') settingsMap[name] = r.value;
    }
    const monthNameById: Record<string, string> = {};
    for (const m of monthsRecords) {
      monthNameById[m.id] = m.fields.month_name ?? m.fields.month_key ?? '';
    }

    const targetStatus = status === 'forecast' ? 'forecast' : 'actual';
    const records = await getPnlForModel(modelId, targetStatus);
    const rows = records.map((rec) => {
      const monthId = rec.fields.month?.[0];
      const monthName = monthId ? monthNameById[monthId] : undefined;
      return rawToPnlRow(
        { id: rec.id, fields: rec.fields },
        settingsMap,
        monthName
      );
    });
    const res = NextResponse.json(rows);
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    return serverError(reqId, e, { route: '/api/models/[id]/pnl' });
  }
}
