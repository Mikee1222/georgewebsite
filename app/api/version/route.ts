import { NextResponse } from 'next/server';

export const runtime = 'edge';

/** Returns app version (optional for auth footer). Set NEXT_PUBLIC_APP_VERSION or defaults to 1.0.0. */
export async function GET() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? '1.0.0';
  return NextResponse.json({ version });
}
