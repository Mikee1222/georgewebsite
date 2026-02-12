import { NextRequest, NextResponse } from 'next/server';
import { hashPassword } from '@/lib/password';

export const runtime = 'edge';

/** DEV-only: returns PBKDF2 hash and salt for a password (for pasting into Airtable users table). */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse(null, { status: 404 });
  }
  try {
    const body = await request.json();
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!password) {
      return NextResponse.json({ error: 'password is required' }, { status: 400 });
    }
    const { password_hash, password_salt } = await hashPassword(password);
    return NextResponse.json({ password_hash, password_salt });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unexpected error' },
      { status: 500 }
    );
  }
}
