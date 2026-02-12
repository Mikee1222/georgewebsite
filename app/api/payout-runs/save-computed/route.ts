import { NextRequest, NextResponse } from 'next/server';
import { getOrCreatePayoutRun, listTeamMembers, listMonthlyMemberBasis, upsertPayoutLines, writeAuditLog } from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, serverError, unauthorized, badRequest } from '@/lib/api-utils';
import { previewLinesToUpsertPayload } from '@/lib/payout-compute';
import type { PayoutPreviewLine } from '@/lib/payout-compute';
import { buildTeamMemberLookup, getMemberIdToRecordIdMap, resolveNumericTeamMemberToRecordId } from '@/lib/team-member-resolve';

export const runtime = 'edge';

/** POST /api/payout-runs/save-computed — persist current preview into payout_runs + payout_lines. Body: { month_id, lines: PayoutPreviewLine[] }. */
export async function POST(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  let body: { month_id?: string; lines?: PayoutPreviewLine[] };
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON body');
  }

  const month_id = body.month_id?.trim();
  if (!month_id) return badRequest(reqId, 'month_id is required');

  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  if (rawLines.length === 0) return badRequest(reqId, 'lines array is required');

  if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
    const teamCount = rawLines.filter((l) => !(l.team_member_id ?? '').startsWith('model-')).length;
    const modelCount = rawLines.filter((l) => (l.team_member_id ?? '').startsWith('model-')).length;
    console.log('[api/payout-runs/save-computed] request', { month_id, linesTotal: rawLines.length, teamMemberLines: teamCount, modelLines: modelCount });
    const modelSamples = rawLines.filter((l) => (l.team_member_id ?? '').startsWith('model-')).slice(0, 2);
    if (modelSamples.length > 0) {
      console.log('[api/payout-runs/save-computed] model payouts (base=net)', modelSamples.map((l) => ({ model_name: l.team_member_name, net_base: true, payout: l.payout_amount })));
    }
  }

  try {
    const month_id_trim = month_id!.trim();
    const [basisRecords, teamMembersRecords] = await Promise.all([
      listMonthlyMemberBasis({ month_id: month_id_trim }),
      listTeamMembers(),
    ]);
    const teamMembersSet = new Set(teamMembersRecords.map((r) => r.id));
    const hourlyRecords = basisRecords.filter((r) => (r.fields.basis_type ?? '') === 'hourly');

    const hourlySumByMember: Record<string, { amount_eur: number; amount_usd: number }> = {};
    for (const r of hourlyRecords) {
      const tmId = r.fields.team_member?.[0] ?? '';
      if (!tmId || !teamMembersSet.has(tmId)) continue;
      const amount_eur = typeof r.fields.amount_eur === 'number' ? r.fields.amount_eur : 0;
      const amount_usd = typeof r.fields.amount_usd === 'number' ? r.fields.amount_usd : 0;
      if (!hourlySumByMember[tmId]) hourlySumByMember[tmId] = { amount_eur: 0, amount_usd: 0 };
      hourlySumByMember[tmId].amount_eur += amount_eur;
      hourlySumByMember[tmId].amount_usd += amount_usd;
    }

    const modifiedLines: PayoutPreviewLine[] = rawLines.map((l) => {
      const isModel = l.category === 'model' || (l.team_member_id ?? '').startsWith('model-');
      if (isModel) return l;
      if (l.category === 'affiliate') return l;
      const tmId = l.team_member_id ?? '';
      const sum = hourlySumByMember[tmId];
      if (!sum || (sum.amount_eur === 0 && sum.amount_usd === 0)) return l;
      const amount_eur = (l.amount_eur ?? 0) - sum.amount_eur;
      const amount_usd =
        typeof l.amount_usd === 'number' ? l.amount_usd - sum.amount_usd : undefined;
      return {
        ...l,
        amount_eur: amount_eur,
        amount_usd: amount_usd ?? l.amount_usd,
        payout_amount: l.payout_amount - (typeof l.amount_usd === 'number' ? sum.amount_usd : sum.amount_eur),
      };
    });

    const hourlyPayloadItems: Array<{
      team_member_id: string;
      department: string;
      role: string;
      payout_type: string;
      payout_amount: number;
      amount_eur: number;
      amount_usd: number;
      fx_rate_usd_eur?: number;
    }> = [];
    for (const r of hourlyRecords) {
      const tmId = r.fields.team_member?.[0] ?? '';
      if (!tmId || !teamMembersSet.has(tmId)) continue;
      const amount_eur = typeof r.fields.amount_eur === 'number' ? r.fields.amount_eur : 0;
      const amount_usd = typeof r.fields.amount_usd === 'number' ? r.fields.amount_usd : 0;
      let fx_rate_usd_eur: number | undefined;
      try {
        const notes = r.fields.notes ?? '';
        const parsed = notes ? (JSON.parse(notes) as { fx_rate?: number }) : {};
        if (typeof parsed.fx_rate === 'number' && Number.isFinite(parsed.fx_rate)) fx_rate_usd_eur = parsed.fx_rate;
      } catch {
        /* ignore */
      }
      hourlyPayloadItems.push({
        team_member_id: tmId,
        department: 'va',
        role: 'va',
        payout_type: 'hourly',
        payout_amount: amount_usd > 0 ? amount_usd : amount_eur,
        amount_eur,
        amount_usd,
        fx_rate_usd_eur,
      });
    }

    let payload = previewLinesToUpsertPayload(modifiedLines);
    payload = payload.concat(
      hourlyPayloadItems.map((item) => ({
        team_member_id: item.team_member_id,
        department: item.department,
        role: item.role,
        payout_type: item.payout_type,
        payout_amount: item.payout_amount,
        amount_eur: item.amount_eur,
        amount_usd: item.amount_usd,
        fx_rate_usd_eur: item.fx_rate_usd_eur,
      }))
    );
    const lookup = buildTeamMemberLookup(
      teamMembersRecords.map((r) => ({ id: r.id, fields: { name: r.fields.name, member_id: r.fields.member_id } }))
    );
    const memberIdToRecordId = getMemberIdToRecordIdMap(lookup);
    payload = payload.map((line) => {
      const tid = line.team_member_id;
      if (!tid) return line;
      const resolved = resolveNumericTeamMemberToRecordId(tid, memberIdToRecordId);
      if (resolved) {
        if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
          console.log('[api/payout-runs/save-computed] autofix team_member link', { from: tid, to: resolved });
        }
        return { ...line, team_member_id: resolved };
      }
      return line;
    });

    const invalidTeamMemberIds: string[] = [];
    for (const line of payload) {
      const isModelLine = Boolean(line.model_id?.trim());
      if (isModelLine) {
        if (line.team_member_id?.trim() && !teamMembersSet.has(line.team_member_id.trim())) {
          invalidTeamMemberIds.push(line.team_member_id.trim());
        }
      } else {
        const tid = line.team_member_id?.trim();
        if (!tid || !teamMembersSet.has(tid)) {
          if (tid) invalidTeamMemberIds.push(tid);
          else invalidTeamMemberIds.push('(missing)');
        }
      }
    }
    if (invalidTeamMemberIds.length > 0) {
      const unique = [...new Set(invalidTeamMemberIds)];
      const res = NextResponse.json(
        {
          ok: false,
          error: 'One or more payout lines have invalid team_member id (not in team_members table). Fix or remove these before saving.',
          invalidTeamMemberIds: unique,
          requestId: reqId,
        },
        { status: 400 }
      );
      res.headers.set('request-id', reqId);
      return res;
    }

    const run = await getOrCreatePayoutRun(month_id);
    await upsertPayoutLines(run.id, payload);

    await writeAuditLog({
      user_email: session.email,
      table: 'payout_runs',
      record_id: run.id,
      field_name: 'save_computed',
      old_value: '',
      new_value: JSON.stringify({ month_id, lines_count: payload.length }),
    });

    if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
      console.log('[api/payout-runs/save-computed] response', { runId: run.id, lines_count: payload.length });
    }
    const res = NextResponse.json({
      ok: true,
      requestId: reqId,
      runId: run.id,
      month_id,
      lines_count: payload.length,
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/payout-runs/save-computed]', e);
    return serverError(reqId, e, { route: '/api/payout-runs/save-computed' });
  }
}
