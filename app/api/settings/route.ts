import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import type { SettingsMap } from '@/lib/types';

export const runtime = 'edge';

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const rows = await getSettings();
    const map: Partial<SettingsMap> = {};
    for (const r of rows) {
      const name = r.setting_name as keyof SettingsMap;
      if (name && typeof r.value === 'number') map[name] = r.value;
    }
    return NextResponse.json({
      of_fee_pct: map.of_fee_pct ?? 0.2,
      green_threshold: map.green_threshold ?? 0.3,
      yellow_threshold_low: map.yellow_threshold_low ?? 0.15,
      forecast_months_ahead: map.forecast_months_ahead ?? 2,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
