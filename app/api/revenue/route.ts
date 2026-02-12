import { NextRequest, NextResponse } from 'next/server';
import { listRevenue, createRevenue, writeAuditLog } from '@/lib/airtable';
import { getSessionFromRequest, canWriteRevenue } from '@/lib/auth';
import { getFxRateForServer, ensureDualAmounts } from '@/lib/fx';
import type { RevenueEntry, RevenueEntryRecord } from '@/lib/types';
import type { AirtableRecord } from '@/lib/types';

export const runtime = 'edge';

function toRevenueEntry(rec: AirtableRecord<RevenueEntryRecord>): RevenueEntry {
  return {
    id: rec.id,
    model_id: rec.fields.model?.[0] ?? '',
    month_id: rec.fields.month?.[0] ?? '',
    type: rec.fields.type ?? '',
    amount: rec.fields.amount ?? 0,
    amount_usd: rec.fields.amount_usd,
    amount_eur: rec.fields.amount_eur,
    description: rec.fields.description ?? '',
    date: rec.fields.date ?? '',
    created_by: rec.fields.created_by ?? '',
  };
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = request.nextUrl;
  const month_id = url.searchParams.get('month_id') ?? undefined;
  const model_id = url.searchParams.get('model_id') ?? undefined;

  try {
    const records = await listRevenue({ month_id, model_id });
    return NextResponse.json(records.map(toRevenueEntry));
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.warn('[api/revenue GET]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: {
    model_id: string;
    month_id: string;
    type: string;
    amount?: number;
    amount_usd?: number;
    amount_eur?: number;
    description?: string;
    date?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { model_id, month_id, type, amount, amount_usd, amount_eur, description, date } = body;

  if (!model_id?.trim() || !month_id?.trim()) {
    return NextResponse.json({ error: 'model_id and month_id are required' }, { status: 400 });
  }
  const hasAmount = typeof amount === 'number';
  const hasUsd = typeof amount_usd === 'number';
  const hasEur = typeof amount_eur === 'number';
  if (!hasAmount && !hasUsd && !hasEur) {
    return NextResponse.json({ error: 'At least one of amount, amount_usd, or amount_eur is required' }, { status: 400 });
  }
  const effectiveUsd = hasUsd ? amount_usd! : (typeof amount === 'number' ? amount : undefined);
  const effectiveEur = hasEur ? amount_eur : undefined;
  const origin = new URL(request.url).origin;
  const fx = await getFxRateForServer(origin);
  const { amount_usd: finalUsd, amount_eur: finalEur } = ensureDualAmounts(effectiveUsd, effectiveEur, fx?.rate ?? null);

  if (!canWriteRevenue(session.role, model_id, session.allowed_model_ids)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const created = await createRevenue({
      model_id: model_id.trim(),
      month_id: month_id.trim(),
      type: type ?? 'other',
      amount: finalUsd,
      amount_usd: finalUsd,
      amount_eur: finalEur,
      description,
      date,
      created_by: session.email,
    });
    await writeAuditLog({
      user_email: session.email,
      table: 'revenue_entries',
      record_id: (created as { id: string }).id,
      field_name: 'create',
      old_value: '',
      new_value: JSON.stringify({ model_id, month_id, type, amount_usd: finalUsd, amount_eur: finalEur }),
    });
    return NextResponse.json(toRevenueEntry(created as AirtableRecord<RevenueEntryRecord>));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
