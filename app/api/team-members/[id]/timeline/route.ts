import { NextRequest, NextResponse } from 'next/server';
import { listRecords, listExpenses, getTeamMember } from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, serverError, unauthorized, badRequest } from '@/lib/api-utils';
import type { AuditLogRecord } from '@/lib/types';
import type { AirtableRecord } from '@/lib/types';

export const runtime = 'edge';

interface TimelineItem {
  timestamp: string;
  actor: string;
  action: string;
  table: string;
  record_id: string;
  field_name?: string;
  old_value?: string;
  new_value?: string;
  summary: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  const { id } = await params;
  if (!id) return badRequest(reqId, 'id required');

  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit')) || 50, 100);

  try {
    const member = await getTeamMember(id);
    if (!member) {
      const res = NextResponse.json({ error: 'Member not found', requestId: reqId }, { status: 404 });
      res.headers.set('request-id', reqId);
      return res;
    }

    const expenseRecords = await listExpenses({
      team_member_id: id,
      owner_type: 'team_member',
    });
    const expenseIds = new Set(expenseRecords.map((r) => r.id));

    const auditRecords = await listRecords<AuditLogRecord>('audit_log', {
      sort: [{ field: 'timestamp', direction: 'desc' }],
      maxRecords: 500,
    });

    const filtered = auditRecords.filter((rec: AirtableRecord<AuditLogRecord>) => {
      const table = rec.fields.table ?? '';
      const record_id = rec.fields.record_id ?? '';
      if (table === 'team_members' && record_id === id) return true;
      if (table === 'expense_entries' && expenseIds.has(record_id)) return true;
      return false;
    });

    const items: TimelineItem[] = filtered.slice(0, limit).map((rec: AirtableRecord<AuditLogRecord>) => {
      const f = rec.fields;
      const field_name = f.field_name ?? '';
      const old_value = f.old_value ?? '';
      const new_value = f.new_value ?? '';
      let action = 'update';
      if (field_name === 'delete') action = 'delete';
      else if (field_name === 'create' || (old_value === '' && new_value)) action = 'create';

      let summary = `${field_name} changed`;
      if (field_name === 'delete') summary = 'Record deleted';
      else if (old_value && new_value) summary = `${field_name}: ${old_value} → ${new_value}`;
      else if (new_value) summary = `${field_name} set to ${new_value}`;

      return {
        timestamp: f.timestamp ?? '',
        actor: f.user_email ?? f.user ?? '',
        action,
        table: f.table ?? '',
        record_id: f.record_id ?? '',
        field_name: field_name || undefined,
        old_value: old_value || undefined,
        new_value: new_value || undefined,
        summary,
      };
    });

    const res = NextResponse.json(items);
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/team-members/[id]/timeline]', e);
    return serverError(reqId, e, { route: '/api/team-members/[id]/timeline' });
  }
}
