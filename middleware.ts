import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { parseSession } from '@/lib/auth';
import { requestId } from '@/lib/api-utils';

const DEV = process.env.NODE_ENV !== 'production';

/** Paths that must NEVER be intercepted (Chrome requires 200 for /_next/static/*). Return next() before any await. */
function isNeverIntercept(pathname: string): boolean {
  const p = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (p.startsWith('/_next/')) return true;
  if (p === '/favicon.ico' || p === '/icon.svg' || p === '/robots.txt' || p === '/sitemap.xml' || p === '/manifest.webmanifest') return true;
  if (p.startsWith('/assets/') || p.startsWith('/fonts/') || p.startsWith('/images/')) return true;
  if (p === '/api/health' || p === '/api/version') return true;
  if (/\.(css|js|mjs|map|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot|otf|avif|xml|txt|webmanifest)$/i.test(p)) return true;
  return false;
}

/** Paths that must never run auth: same as above + extended static. */
function isStaticAsset(pathname: string): boolean {
  if (isNeverIntercept(pathname)) return true;
  const p = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return false;
}

/** Normalize path for comparison (trim trailing slash); /login/ and /login both become /login */
function norm(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

function isPublicPath(path: string): boolean {
  return (
    path === '/login' ||
    path === '/setup' ||
    path === '/api/auth/login' ||
    path === '/api/auth/logout' ||
    path === '/api/health' ||
    path === '/api/bootstrap-status' ||
    path === '/api/admin/bootstrap' ||
    path === '/api/debug/users-sample' ||
    path === '/api/dev/airtable-smoke-expenses' ||
    path === '/api/dev/hash-password' ||
    path === '/api/dev/env-check' ||
    path === '/api/dev/diagnostics' ||
    path === '/api/version' ||
    path === '/api/fx/usd-eur'
  );
}

function devLog(path: string, hasSession: boolean, decision: 'allow' | 'redirect', redirectTarget: string | null): void {
  if (!DEV) return;
  console.log('[auth]', { path, hasSession, decision, redirectTarget });
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // 0) Never intercept: Next static chunks, favicon, assets, api/health, api/version (Chrome 200 for /_next/static/*)
  if (isNeverIntercept(pathname)) {
    return NextResponse.next();
  }

  // 1) Static assets: never run auth; return immediately (matcher also excludes these)
  if (isStaticAsset(pathname)) {
    return NextResponse.next();
  }

  const path = norm(pathname);

  // 2) Public paths: always allow; redirect to /models if already logged in
  if (isPublicPath(path)) {
    const session = await parseSession(request.headers.get('cookie'));
    if (path === '/login' && session) {
      devLog(pathname, true, 'redirect', '/home');
      return NextResponse.redirect(new URL('/home', request.url));
    }
    if (path === '/setup' && session) {
      devLog(pathname, true, 'redirect', '/home');
      return NextResponse.redirect(new URL('/home', request.url));
    }
    devLog(pathname, false, 'allow', null);
    return NextResponse.next();
  }

  // 3) /api/seed: in dev allow without auth; in production require auth (route returns 404 for non-admin)
  if (path === '/api/seed' && DEV) {
    devLog(pathname, false, 'allow', null);
    return NextResponse.next();
  }

  // 4) All other paths: require session
  const session = await parseSession(request.headers.get('cookie'));
  if (!session) {
    if (DEV) console.log('[auth] blocked path (no session):', pathname);
    if (path.startsWith('/api/')) {
      devLog(pathname, false, 'redirect', '401');
      const reqId = requestId();
      const res = NextResponse.json({ error: 'Unauthorized', requestId: reqId }, { status: 401 });
      res.headers.set('request-id', reqId);
      return res;
    }
    devLog(pathname, false, 'redirect', '/login');
    return NextResponse.redirect(new URL('/login', request.url));
  }

  devLog(pathname, true, 'allow', null);
  const res = NextResponse.next();
  res.headers.set('x-session-email', session.email);
  res.headers.set('x-session-role', session.role);
  return res;
}

export const config = {
  // Exclude Next.js assets and common static paths so middleware never runs on them (Chrome requires 200 for /_next/static/*)
  matcher: [
    '/((?!_next/|favicon\\.ico|icon\\.svg|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest|assets/|fonts/|images/|\\.(?:css|js|mjs|map|png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot|otf|avif|xml|txt|webmanifest)$).*)',
  ],
};
