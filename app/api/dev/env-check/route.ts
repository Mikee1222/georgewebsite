import { NextResponse } from 'next/server';

export const runtime = 'edge';

/** DEV-only: returns env presence for login/setup guardrails (no secrets). */
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse(null, { status: 404 });
  }
  const hasToken = Boolean(process.env.AIRTABLE_TOKEN?.trim());
  const baseId = process.env.AIRTABLE_BASE_ID?.trim() ?? null;
  const usersTable = process.env.AIRTABLE_TABLE_USERS?.trim() ?? null;
  const hasSessionSecret = Boolean(process.env.SESSION_SECRET?.trim());

  const missing: string[] = [];
  if (!hasToken) missing.push('AIRTABLE_TOKEN');
  if (!baseId) missing.push('AIRTABLE_BASE_ID');
  if (!hasSessionSecret) missing.push('SESSION_SECRET');
  if (!usersTable) missing.push('AIRTABLE_TABLE_USERS');

  return NextResponse.json({
    hasToken,
    baseId,
    usersTable,
    hasSessionSecret,
    missing,
  });
}
