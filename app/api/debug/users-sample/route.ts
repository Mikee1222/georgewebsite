import { NextResponse } from 'next/server';
import { getUsersSampleForDebug } from '@/lib/airtable';

export const runtime = 'edge';

/** DEV-only: returns resolved base id, users table name, and up to 5 record ids/emails (no secrets). */
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse(null, { status: 404 });
  }
  try {
    const data = await getUsersSampleForDebug();
    return NextResponse.json({
      baseId: data.baseId,
      usersTableName: data.usersTableName,
      records: data.records,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
