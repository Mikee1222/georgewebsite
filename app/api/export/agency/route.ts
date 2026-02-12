import { NextRequest, NextResponse } from 'next/server';
import { getPnlInRange, getModels, getMonths, getSettings } from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { rawToPnlRow } from '@/lib/business-rules';
import type { SettingsMap } from '@/lib/types';
import type { AirtableRecord } from '@/lib/types';
import type { PnlLinesRecordRaw } from '@/lib/types';

export const runtime = 'edge';

const CSV_HEADERS =
  'model_id,model_name,month_key,month_name,net_revenue,total_expenses,net_profit,profit_margin_pct,total_marketing_costs,chatting_costs_team,marketing_costs_team,production_costs_team,ads_spend';

function escapeCsv(val: string | number): string {
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return new NextResponse('Unauthorized', { status: 401 });

  const from = request.nextUrl.searchParams.get('from') ?? '';
  const to = request.nextUrl.searchParams.get('to') ?? from;
  if (!from || !to) return new NextResponse('from and to (YYYY-MM) required', { status: 400 });

  try {
    const [settingsRows, modelsRecords, monthsRecords, pnlRecords] = await Promise.all([
      getSettings(),
      getModels(),
      getMonths(),
      getPnlInRange(from, to),
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
    const modelNameById: Record<string, string> = {};
    for (const m of modelsRecords) {
      modelNameById[m.id] = m.fields.name ?? '';
    }

    const pnlRows = pnlRecords.map((rec: AirtableRecord<PnlLinesRecordRaw>) => {
      const monthId = rec.fields.month?.[0];
      return rawToPnlRow(
        { id: rec.id, fields: rec.fields },
        settingsMap,
        monthId ? monthNameById[monthId] : undefined
      );
    });

    const byModel: Record<
      string,
      {
        model_id: string;
        model_name: string;
        month_key: string;
        month_name: string;
        net_revenue: number;
        total_expenses: number;
        net_profit: number;
        total_marketing_costs: number;
        chatting_costs_team: number;
        marketing_costs_team: number;
        production_costs_team: number;
        ads_spend: number;
      }
    > = {};
    for (const row of pnlRows) {
      const mid = row.model_id;
      const name = modelNameById[mid] ?? mid;
      if (!byModel[mid]) {
        byModel[mid] = {
          model_id: mid,
          model_name: name,
          month_key: row.month_key,
          month_name: row.month_name ?? '',
          net_revenue: 0,
          total_expenses: 0,
          net_profit: 0,
          total_marketing_costs: 0,
          chatting_costs_team: 0,
          marketing_costs_team: 0,
          production_costs_team: 0,
          ads_spend: 0,
        };
      }
      const agg = byModel[mid];
      agg.net_revenue += row.net_revenue;
      agg.total_expenses += row.total_expenses;
      agg.net_profit += row.net_profit;
      agg.total_marketing_costs += row.total_marketing_costs;
      agg.chatting_costs_team += row.chatting_costs_team;
      agg.marketing_costs_team += row.marketing_costs_team;
      agg.production_costs_team += row.production_costs_team;
      agg.ads_spend += row.ads_spend;
    }

    const list = Object.values(byModel).map((agg) => ({
      ...agg,
      profit_margin_pct: agg.net_revenue ? agg.net_profit / agg.net_revenue : 0,
    }));

    const lines = [
      CSV_HEADERS,
      ...list.map((row) =>
        [
          row.model_id,
          row.model_name,
          row.month_key,
          row.month_name,
          row.net_revenue,
          row.total_expenses,
          row.net_profit,
          row.profit_margin_pct,
          row.total_marketing_costs,
          row.chatting_costs_team,
          row.marketing_costs_team,
          row.production_costs_team,
          row.ads_spend,
        ]
          .map(escapeCsv)
          .join(',')
      ),
    ];
    const csv = lines.join('\n');
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="agency-${from}-${to}.csv"`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
