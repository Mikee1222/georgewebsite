import { NextRequest, NextResponse } from 'next/server';
import { getUserByEmail, updateUserLastLogin } from '@/lib/airtable';
import { createSession, sessionCookieValue } from '@/lib/auth';
import { verifyPassword } from '@/lib/password';
import type { Role } from '@/lib/types';

export const runtime = 'edge';

/** Simple in-memory rate limit (best-effort on edge: per-instance). Max 10 failed attempts per IP per minute. */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const rateLimit = new Map<string, { count: number; resetAt: number }>();

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown'
  );
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimit.get(ip);
  if (!entry) return false;
  if (now > entry.resetAt) {
    rateLimit.delete(ip);
    return false;
  }
  return entry.count >= RATE_LIMIT_MAX;
}

function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const entry = rateLimit.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimit.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return;
  }
  entry.count++;
}

function validateLoginEnv(): void {
  if (!process.env.AIRTABLE_TOKEN?.trim()) {
    throw new Error('missing_env: AIRTABLE_TOKEN');
  }
  if (!process.env.AIRTABLE_BASE_ID?.trim()) {
    throw new Error('missing_env: AIRTABLE_BASE_ID');
  }
  if (!process.env.SESSION_SECRET?.trim()) {
    throw new Error('missing_env: SESSION_SECRET');
  }
  if (!process.env.AIRTABLE_TABLE_USERS?.trim()) {
    throw new Error('missing_env: AIRTABLE_TABLE_USERS');
  }
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  }

  try {
    validateLoginEnv();

    const body = await request.json();
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    const userRec = await getUserByEmail(email);
    if (!userRec) {
      recordFailedAttempt(ip);
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const fields = userRec.fields;
    const isActive = fields.is_active === true;
    if (!isActive) {
      return NextResponse.json({ error: 'Account inactive' }, { status: 403 });
    }

    const storedHash = fields.password_hash ?? '';
    const storedSalt = fields.password_salt ?? '';
    if (!storedHash || !storedSalt) {
      throw new Error('user_missing_credentials');
    }

    const valid = await verifyPassword(password, storedHash, storedSalt);
    if (!valid) {
      recordFailedAttempt(ip);
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const role = (fields.role ?? 'viewer') as Role;
    const allowedModelIdsStr = fields.allowed_model_ids ?? '';
    const allowed_model_ids = allowedModelIdsStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const token = await createSession(email, role, allowed_model_ids);
    const res = NextResponse.json({ ok: true });
    res.headers.set('Set-Cookie', sessionCookieValue(token));

    await updateUserLastLogin(userRec.id, new Date().toISOString());

    return res;
  } catch (e) {
    const requestId = crypto.randomUUID();
    const err = e instanceof Error ? e : new Error(String(e));
    console.error('[login:500]', requestId, err.stack ?? err.message);
    return NextResponse.json(
      { ok: false, error: 'internal_error', requestId },
      { status: 500 }
    );
  }
}
