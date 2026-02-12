/**
 * Client-side fetch helper that captures request-id for error display.
 */

export interface ApiFetchResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
  requestId: string | null;
}

/**
 * Fetch JSON from an API route. Returns ok, status, parsed data, and requestId (from header or JSON body).
 */
export async function apiFetch<T = unknown>(
  url: string,
  opts: RequestInit = {}
): Promise<ApiFetchResult<T>> {
  const res = await fetch(url, { ...opts, credentials: 'include' });
  const requestIdHeader = res.headers.get('request-id');
  let data: T;
  let requestIdFromBody: string | null = null;
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      const json = (await res.json()) as T & { error?: string; requestId?: string };
      data = json as T;
      if (json && typeof json === 'object' && 'requestId' in json && typeof (json as { requestId?: string }).requestId === 'string') {
        requestIdFromBody = (json as { requestId: string }).requestId;
      }
    } catch {
      data = null as T;
    }
  } else {
    data = null as T;
  }
  const requestId = requestIdFromBody ?? requestIdHeader;
  return { ok: res.ok, status: res.status, data, requestId };
}
