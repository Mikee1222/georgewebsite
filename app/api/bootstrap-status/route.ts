import { NextResponse } from 'next/server';
import { getBootstrapDiagnostics, hasAnyUser } from '@/lib/airtable';

export const runtime = 'edge';

const DEV = process.env.NODE_ENV !== 'production';

/** Public endpoint: returns whether any user exists (so UI can show /setup vs /login). */
export async function GET() {
  try {
    if (DEV) {
      const d = await getBootstrapDiagnostics();
      const usersTableEnv = process.env.AIRTABLE_TABLE_USERS;
      return NextResponse.json({
        hasUsers: d.hasUsers,
        diag: {
          baseId: d.baseId,
          usersTableEnv: usersTableEnv ?? undefined,
          resolvedUsersTable: d.usersTableName,
          recordCountSample: d.recordCount,
          firstRecordId: d.firstRecordId ?? null,
          hint: 'Run npm run start:local after changing .env',
        },
      });
    }
    const hasUsers = await hasAnyUser();
    return NextResponse.json({ hasUsers });
  } catch {
    return NextResponse.json({ hasUsers: true }, { status: 200 });
  }
}
