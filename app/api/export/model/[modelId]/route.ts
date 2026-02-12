import { NextRequest, NextResponse } from 'next/server';
import { getPnlForModel, getMonths, getSettings } from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { rawToPnlRow } from '@/lib/business-rules';
import type { SettingsMap } from '@/lib/types';
import type { AirtableRecord } from '@/lib/types';
import type { PnlLinesRecordRaw } from '@/lib/types';

export const runtime = 'edge';

const CSV_HEADERS =
  'month,month_key,gross_revenue,of_fee,net_revenue,chatting_costs_team,marketing_costs_team,production_costs_team,ads_spend,other_marketing_costs,total_marketing_costs,salary,affiliate_fee,bonuses,airbnbs,softwares,fx_withdrawal_fees,other_costs,total_expenses,net_profit,profit_margin_pct,notes_issues';

function escapeCsv(val: string | number | undefined): string {
  const s = val == null ? '' : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> }
) {
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return new NextResponse('Unauthorized', { status: 401 });

  const { modelId } = await params;
  if (!modelId) return new NextResponse('model id required', { status: 400 });

  try {
    const [settingsRows, monthsRecords, actuals, forecasts] = await Promise.all([
      getSettings(),
      getMonths(),
      getPnlForModel(modelId, 'actual'),
      getPnlForModel(modelId, 'forecast'),
    ]);
    const settingsMap: Partial<SettingsMap> = {};
    for (const r of settingsRows) {
      const name = r.setting_name as keyof SettingsMap;
      if (name && typeof r.value === 'number') settingsMap[name] = r.value;
    }
    const monthNameById: Record<string, string> = {};
    for (const m of monthsRecords) {
      monthNameById[m.id] = m.fields.month_name ?? m.fields.month_key ?? '';
    }

    const toCsvLine = (rec: AirtableRecord<PnlLinesRecordRaw>) => {
      const monthId = rec.fields.month?.[0];
      const row = rawToPnlRow(
        { id: rec.id, fields: rec.fields },
        settingsMap,
        monthId ? monthNameById[monthId] : undefined
      );
      return [
        row.month_name,
        row.month_key,
        row.gross_revenue,
        row.of_fee,
        row.net_revenue,
        row.chatting_costs_team,
        row.marketing_costs_team,
        row.production_costs_team,
        row.ads_spend,
        row.other_marketing_costs,
        row.total_marketing_costs,
        row.salary,
        row.affiliate_fee,
        row.bonuses,
        row.airbnbs,
        row.softwares,
        row.fx_withdrawal_fees,
        row.other_costs,
        row.total_expenses,
        row.net_profit,
        row.profit_margin_pct,
        row.notes_issues,
      ].map(escapeCsv).join(',');
    };

    const lines = [CSV_HEADERS];
    for (const rec of actuals) lines.push(toCsvLine(rec));
    for (const rec of forecasts) lines.push(toCsvLine(rec));

    const csv = lines.join('\n');
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="model-${modelId}.csv"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
