import { NextRequest, NextResponse } from 'next/server';
import {
  getPnlByUniqueKey,
  getMonthKeyFromId,
  getMonths,
  createRecord,
  updateRecord,
  getRecord,
} from '@/lib/airtable';
import { getSessionFromRequest, canEdit, financeCanEditModel } from '@/lib/auth';
import { formatUsdDisplay } from '@/lib/format-display';
import type { PnlLinesRecordRaw } from '@/lib/types';
import type { AirtableRecord } from '@/lib/types';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/** Shape returned to client: single actual pnl row for model+month (revenue from pnl_lines). */
export interface EarningsRow {
  id: string;
  model_id: string;
  month_id: string;
  month_key: string;
  gross_revenue: number;
  net_revenue: number;
  gross_revenue_display: string;
  net_revenue_display: string;
  notes_issues?: string;
  status: 'actual';
}

const DEFAULT_NET_RATE = 0.8;

function toEarningsRow(rec: AirtableRecord<PnlLinesRecordRaw>, modelId: string, monthId: string, monthKey: string): EarningsRow {
  const g = rec.fields.gross_revenue;
  const n = rec.fields.net_revenue;
  const gross = typeof g === 'number' && Number.isFinite(g) ? g : 0;
  const net = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return {
    id: rec.id,
    model_id: modelId,
    month_id: monthId,
    month_key: monthKey,
    gross_revenue: gross,
    net_revenue: net,
    gross_revenue_display: formatUsdDisplay(gross),
    net_revenue_display: formatUsdDisplay(net),
    notes_issues: typeof rec.fields.notes_issues === 'string' ? rec.fields.notes_issues : undefined,
    status: 'actual',
  };
}

/** GET /api/models/[id]/earnings?month_id= — returns single actual pnl row for that month, or null. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: modelId } = await params;
  const monthId = request.nextUrl.searchParams.get('month_id') ?? '';
  if (!modelId) return NextResponse.json({ error: 'model id required' }, { status: 400 });
  if (!monthId) return NextResponse.json(null);

  const monthKey = await getMonthKeyFromId(monthId);
  if (!monthKey) return NextResponse.json(null);

  const uniqueKey = `${modelId}-${monthKey}-actual`;
  const rec = await getPnlByUniqueKey(uniqueKey);
  if (!rec) return NextResponse.json(null);

  const row = toEarningsRow(rec, modelId, monthId, monthKey);
  return NextResponse.json(row);
}

/** POST /api/models/[id]/earnings — upsert actual pnl row: add revenue (create if missing, else increment). Body: { month_id, gross_revenue (amount to add), net_revenue? (optional; default gross*0.8), notes_issues? }. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canEdit(session.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id: modelId } = await params;
  if (!modelId) return NextResponse.json({ error: 'model id required' }, { status: 400 });
  if (!financeCanEditModel(session.role, modelId, session.allowed_model_ids)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { month_id: string; gross_revenue?: number; net_revenue?: number; notes_issues?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { month_id, gross_revenue, net_revenue, notes_issues } = body;
  if (!month_id?.trim()) return NextResponse.json({ error: 'month_id required' }, { status: 400 });

  const monthKey = await getMonthKeyFromId(month_id.trim());
  if (!monthKey) return NextResponse.json({ error: 'month_id not found' }, { status: 400 });

  const amountToAddGross = typeof gross_revenue === 'number' && Number.isFinite(gross_revenue) ? Math.round(gross_revenue * 100) / 100 : 0;
  const amountToAddNet =
    typeof net_revenue === 'number' && Number.isFinite(net_revenue)
      ? Math.round(net_revenue * 100) / 100
      : Math.round(amountToAddGross * DEFAULT_NET_RATE * 100) / 100;
  const notes = typeof notes_issues === 'string' ? notes_issues : '';

  const uniqueKey = `${modelId}-${monthKey}-actual`;
  const existing = await getPnlByUniqueKey(uniqueKey);

  try {
    if (existing) {
      const currentGross = typeof existing.fields.gross_revenue === 'number' && Number.isFinite(existing.fields.gross_revenue) ? existing.fields.gross_revenue : 0;
      const currentNet = typeof existing.fields.net_revenue === 'number' && Number.isFinite(existing.fields.net_revenue) ? existing.fields.net_revenue : 0;
      const newGross = Math.round((currentGross + amountToAddGross) * 100) / 100;
      const newNet = Math.round((currentNet + amountToAddNet) * 100) / 100;
      const fields: Record<string, unknown> = { gross_revenue: newGross, net_revenue: newNet };
      if (notes !== undefined) fields.notes_issues = notes;
      await updateRecord('pnl_lines', existing.id, fields);
      const updated = await getRecord<PnlLinesRecordRaw>('pnl_lines', existing.id);
      const row = updated
        ? toEarningsRow(updated, modelId, month_id.trim(), monthKey)
        : toEarningsRow({ id: existing.id, fields: { ...existing.fields, gross_revenue: newGross, net_revenue: newNet, notes_issues: notes } } as AirtableRecord<PnlLinesRecordRaw>, modelId, month_id.trim(), monthKey);
      if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
        console.log('[api/models/[id]/earnings] POST updated', { modelId, month_key: monthKey, resulting_gross_revenue: newGross, resulting_net_revenue: newNet });
      }
      return NextResponse.json(row);
    }

    const created = await createRecord('pnl_lines', {
      model: [modelId],
      month: [month_id.trim()],
      status: 'actual',
      gross_revenue: amountToAddGross,
      net_revenue: amountToAddNet,
      notes_issues: notes,
    });
    const createdRec = created as AirtableRecord<PnlLinesRecordRaw>;
    const row = toEarningsRow(createdRec, modelId, month_id.trim(), monthKey);
    if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
      console.log('[api/models/[id]/earnings] POST created', { modelId, month_key: monthKey, gross_revenue: amountToAddGross, net_revenue: amountToAddNet });
    }
    return NextResponse.json(row);
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.warn('[api/models/[id]/earnings] POST error', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
