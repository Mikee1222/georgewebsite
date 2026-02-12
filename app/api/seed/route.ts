import { NextResponse } from 'next/server';
import { getSettings, getModels, getMonths } from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';

export const runtime = 'edge';

/** GET /api/seed – verify Airtable connectivity. In production, requires admin auth; otherwise 404. */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    const session = await getSessionFromRequest(request.headers.get('cookie'));
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }
  }

  try {
    const [settings, models, months] = await Promise.all([
      getSettings(),
      getModels(),
      getMonths(),
    ]);
    return NextResponse.json({
      ok: true,
      airtable: {
        settings: settings.length,
        models: models.length,
        months: months.length,
      },
      ts: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String(e), ts: new Date().toISOString() },
      { status: 500 }
    );
  }
}
