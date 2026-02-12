import { NextResponse } from 'next/server';
import { listRecords } from '@/lib/airtable';
import { requestId } from '@/lib/api-utils';
import type { ExpenseEntryRecord } from '@/lib/types';
import type { AirtableRecord } from '@/lib/types';

export const runtime = 'edge';

/** Dev-only: fetch one expense_entries record and return table name + field names for diagnostics. */
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse(null, { status: 404 });
  }
  const reqId = requestId();
  try {
    const tableKey = 'expense_entries';
    const records = await listRecords<ExpenseEntryRecord>(tableKey, { maxRecords: 1 });
    const first = records[0];
    if (!first) {
      const res = NextResponse.json({
        ok: true,
        tableName: tableKey,
        sampleFields: [],
        message: 'No records in expense_entries',
        requestId: reqId,
      });
      res.headers.set('request-id', reqId);
      return res;
    }
    const fields = (first as AirtableRecord<ExpenseEntryRecord>).fields as Record<string, unknown>;
    const sampleFields = Object.keys(fields);
    const res = NextResponse.json({
      ok: true,
      tableName: tableKey,
      sampleFields,
      requestId: reqId,
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    const res = NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'Failed to read expense_entries',
        requestId: reqId,
      },
      { status: 500 }
    );
    res.headers.set('request-id', reqId);
    return res;
  }
}
