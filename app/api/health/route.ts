import { NextResponse } from 'next/server';
import { listRecords } from '@/lib/airtable';
import type { SettingsRecord } from '@/lib/types';

export const runtime = 'edge';

/**
 * Health check: minimal Airtable read (settings, 1 record). Edge-safe; does not leak secrets.
 * Success: { ok: true }. Failure: { ok: false, error } with generic message only.
 */
export async function GET() {
  try {
    await listRecords<SettingsRecord>('settings', { maxRecords: 1 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: 'Service unavailable' }, { status: 503 });
  }
}
