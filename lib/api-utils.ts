/**
 * Edge-safe API helpers: request ID (UUID) and consistent error response.
 * Cloudflare Pages compatible (no Node crypto).
 */

import { NextResponse } from 'next/server';

/** Generate a UUID v4 for request tracing. Edge-safe (crypto.randomUUID). */
export function requestId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Add request-id header to a NextResponse. */
export function addRequestId(response: NextResponse, id: string): NextResponse {
  response.headers.set('request-id', id);
  return response;
}

export interface ApiErrorPayload {
  error: string;
  requestId: string;
  hint?: string;
  route?: string;
  envMissing?: string[];
}

/** Build JSON error body. Dev may include hint, route, envMissing; prod only error + requestId. */
export function errorJson(
  requestId: string,
  error: string,
  options?: { hint?: string; route?: string; envMissing?: string[] }
): ApiErrorPayload {
  const isDev = process.env.NODE_ENV === 'development';
  const payload: ApiErrorPayload = { error, requestId };
  if (isDev && options) {
    if (options.hint) payload.hint = options.hint;
    if (options.route) payload.route = options.route;
    if (options.envMissing?.length) payload.envMissing = options.envMissing;
  }
  return payload;
}

/** Return 500 NextResponse with consistent error shape and request-id header. */
export function serverError(
  requestId: string,
  err: unknown,
  options?: { route?: string; envMissing?: string[] }
): NextResponse {
  const message = err instanceof Error ? err.message : String(err);
  const isDev = process.env.NODE_ENV === 'development';
  const payload = errorJson(
    requestId,
    isDev ? message : 'Internal server error',
    isDev ? { hint: message, route: options?.route, envMissing: options?.envMissing } : undefined
  );
  const res = NextResponse.json(payload, { status: 500 });
  res.headers.set('request-id', requestId);
  return res;
}

/** Return 401 with request-id. */
export function unauthorized(requestId: string): NextResponse {
  const res = NextResponse.json(
    { error: 'Unauthorized', requestId },
    { status: 401 }
  );
  res.headers.set('request-id', requestId);
  return res;
}

/** Return 403 with request-id. */
export function forbidden(requestId: string, message = 'Forbidden'): NextResponse {
  const res = NextResponse.json(
    { error: message, requestId },
    { status: 403 }
  );
  res.headers.set('request-id', requestId);
  return res;
}

/** Return 400 with request-id. */
export function badRequest(requestId: string, message: string): NextResponse {
  const res = NextResponse.json(
    { error: message, requestId },
    { status: 400 }
  );
  res.headers.set('request-id', requestId);
  return res;
}

/** Return 404 with request-id. */
export function notFound(requestId: string, message = 'Not found'): NextResponse {
  const res = NextResponse.json(
    { error: message, requestId },
    { status: 404 }
  );
  res.headers.set('request-id', requestId);
  return res;
}

/** Return 409 Conflict with request-id. */
export function conflict(requestId: string, message: string): NextResponse {
  const res = NextResponse.json(
    { error: message, requestId },
    { status: 409 }
  );
  res.headers.set('request-id', requestId);
  return res;
}
