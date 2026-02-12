import { NextRequest, NextResponse } from 'next/server';
import { listRecords } from '@/lib/airtable';
import { requestId } from '@/lib/api-utils';

export const runtime = 'edge';

interface Check {
  name: string;
  ok: boolean;
  message?: string;
  keys?: string[];
  missingFields?: string[];
}

/** Required field names per table (spec). Best-effort: we check sample record keys. Empty table = reachable, cannot verify. */
const REQUIRED_FIELDS: Record<string, string[]> = {
  months: ['month_key', 'month_name'],
  models: ['name', 'status', 'compensation_type'],
  team_members: ['name', 'role', 'department', 'status'],
  expense_entries: ['month', 'model', 'department', 'cost_owner_type', 'category', 'amount', 'description', 'vendor', 'date', 'created_by', 'receipt_url', 'created_at'],
};

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse(null, { status: 404 });
  }
  const reqId = requestId();
  const checks: Check[] = [];

  const envPresent: Check = {
    name: 'env',
    ok: !!(
      process.env.AIRTABLE_TOKEN &&
      process.env.AIRTABLE_BASE_ID &&
      process.env.SESSION_SECRET &&
      process.env.SESSION_SECRET.length >= 32
    ),
  };
  if (!envPresent.ok) {
    const missing: string[] = [];
    if (!process.env.AIRTABLE_TOKEN) missing.push('AIRTABLE_TOKEN');
    if (!process.env.AIRTABLE_BASE_ID) missing.push('AIRTABLE_BASE_ID');
    if (!process.env.SESSION_SECRET) missing.push('SESSION_SECRET');
    else if (process.env.SESSION_SECRET.length < 32) missing.push('SESSION_SECRET (min 32 chars)');
    envPresent.message = `Missing: ${missing.join(', ')}`;
  }
  checks.push(envPresent);

  if (!envPresent.ok) {
    const res = NextResponse.json({
      ok: false,
      checks,
      requestId: reqId,
    });
    res.headers.set('request-id', reqId);
    return res;
  }

  checks.push({ name: 'airtable_config', ok: true });

  /** Table reachable = ok. Empty table: ok, message "Reachable, no records (cannot verify fields)". */
  function addTableCheck(tableKey: string, keys: string[], err?: unknown): void {
    const required = REQUIRED_FIELDS[tableKey] ?? [];
    const missing = keys.length > 0 ? required.filter((f) => !keys.includes(f)) : [];
    const hasSample = keys.length > 0;
    const ok = !err && (required.length === 0 || !hasSample || missing.length === 0);
    const check: Check = {
      name: `${tableKey}_table`,
      ok: !!ok,
      message: err
        ? String(err)
        : hasSample
          ? missing.length > 0
            ? `Reachable; missing fields in sample: ${missing.join(', ')}`
            : `Reachable, sample keys: ${keys.join(', ')}`
          : 'Reachable, no records (cannot verify fields)',
      keys,
    };
    if (missing.length > 0) check.missingFields = missing;
    checks.push(check);
  }

  try {
    const months = await listRecords<{ month_key?: string; month_name?: string }>('months', {
      maxRecords: 1,
      sort: [{ field: 'month_key', direction: 'asc' }],
    });
    const keys = months[0]?.fields ? Object.keys(months[0].fields) : [];
    addTableCheck('months', keys);
  } catch (e) {
    addTableCheck('months', [], e);
  }

  try {
    const models = await listRecords<Record<string, unknown>>('models', { maxRecords: 1 });
    const keys = models[0]?.fields ? Object.keys(models[0].fields) : [];
    addTableCheck('models', keys);
  } catch (e) {
    addTableCheck('models', [], e);
  }

  try {
    const team = await listRecords<Record<string, unknown>>('team_members', { maxRecords: 1 });
    const keys = team[0]?.fields ? Object.keys(team[0].fields) : [];
    addTableCheck('team_members', keys);
  } catch (e) {
    addTableCheck('team_members', [], e);
  }

  try {
    const expenses = await listRecords<Record<string, unknown>>('expense_entries', { maxRecords: 1 });
    const keys = expenses[0]?.fields ? Object.keys(expenses[0].fields) : [];
    addTableCheck('expense_entries', keys);
  } catch (e) {
    addTableCheck('expense_entries', [], e);
  }

  const ok = checks.every((c) => c.ok);
  const res = NextResponse.json({ ok, checks, requestId: reqId });
  res.headers.set('request-id', reqId);
  return res;
}
