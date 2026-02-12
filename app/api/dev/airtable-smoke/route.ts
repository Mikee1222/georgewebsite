import { NextResponse } from 'next/server';
import { listRecords, getTableName, AGENCY_REVENUES_TABLE_KEY } from '@/lib/airtable';
import { requestId } from '@/lib/api-utils';
import type { AgencyRevenuesRecord } from '@/lib/types';

export const runtime = 'edge';

/** Dev-only: read 1 record from agency_revenues (table name from AIRTABLE_TABLE_AGENCY_REVENUES). */
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse(null, { status: 404 });
  }
  const reqId = requestId();
  const tableNameUsed = getTableName(AGENCY_REVENUES_TABLE_KEY);
  try {
    await listRecords<AgencyRevenuesRecord>(AGENCY_REVENUES_TABLE_KEY, { maxRecords: 1 });
    const res = NextResponse.json({ ok: true, tableNameUsed, requestId: reqId });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const res = NextResponse.json(
      { ok: false, error, tableNameUsed, requestId: reqId },
      { status: 500 }
    );
    res.headers.set('request-id', reqId);
    return res;
  }
}
