import { NextRequest, NextResponse } from 'next/server';
import { hasAnyUser, createRecord, getUserByEmail } from '@/lib/airtable';
import { hashPassword } from '@/lib/password';
import { createSession, sessionCookieValue } from '@/lib/auth';

export const runtime = 'edge';

/**
 * Bootstrap first admin user. Allowed ONLY when no users exist.
 * If users exist → 404 (setup not available).
 * Creates admin with hashed password, sets session cookie so user is logged in.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      );
    }

    const hasUsers = await hasAnyUser();
    if (hasUsers) {
      return new NextResponse(null, { status: 404 });
    }

    const existing = await getUserByEmail(email);
    if (existing) {
      return NextResponse.json(
        { error: 'Email already in use' },
        { status: 400 }
      );
    }

    const { password_hash, password_salt } = await hashPassword(password);
    await createRecord('users', {
      email,
      role: 'admin',
      is_active: true,
      password_hash,
      password_salt,
    });

    const token = await createSession(email, 'admin', []);
    const res = NextResponse.json({ ok: true, message: 'Admin user created' });
    res.headers.set('Set-Cookie', sessionCookieValue(token));

    return res;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unexpected server error' },
      { status: 500 }
    );
  }
}
