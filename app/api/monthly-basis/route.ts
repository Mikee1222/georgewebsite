import { NextRequest, NextResponse } from 'next/server';
import { listMonthlyMemberBasis, buildMonthlyMemberBasisFormula, createMonthlyMemberBasis, updateMonthlyMemberBasis, writeAuditLog, getMonthKeyFromId, listTeamMembers } from '@/lib/airtable';
import { getSessionFromRequest } from '@/lib/auth';
import { requestId, serverError, unauthorized, badRequest } from '@/lib/api-utils';
import { getFxRateForServer, ensureDualAmounts } from '@/lib/fx';
import type { MonthlyBasisType } from '@/lib/types';

export const runtime = 'edge';

const BASIS_TYPES: MonthlyBasisType[] = ['chatter_sales', 'bonus', 'adjustment', 'fine'];

const POST_BODY_ALLOWED = new Set([
  'month_id', 'month_key', 'team_member_id', 'team_member_numeric', 'department', 'basis_type', 'amount', 'amount_usd', 'gross_usd',
  'amount_eur', 'notes', 'payout_pct', 'reason',
]);

function assertNoUnknownBodyKeys(body: Record<string, unknown>, allowed: Set<string>, reqId: string): void {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw new Error(`[${reqId}] monthly-basis: body contains unknown field "${key}". Allowed: ${[...allowed].sort().join(', ')}`);
    }
  }
}

/** Parse payout_pct from notes (first line "PCT:15" or "PCT:15.5"). */
function parsePayoutPctFromNotes(notes: string | undefined): number | undefined {
  if (!notes?.trim()) return undefined;
  const first = notes.trim().split('\n')[0]?.trim() ?? '';
  const m = /^PCT:(\d+(?:\.\d+)?)$/i.exec(first);
  return m ? Number(m[1]) : undefined;
}

export async function GET(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  let month_id = request.nextUrl.searchParams.get('month_id')?.trim() ?? undefined;
  let month_key = request.nextUrl.searchParams.get('month_key')?.trim() ?? undefined;
  const team_member_id = request.nextUrl.searchParams.get('team_member_id')?.trim() ?? undefined;
  const team_member_numericRaw = request.nextUrl.searchParams.get('team_member_numeric');
  const team_member_numeric = team_member_numericRaw === null || team_member_numericRaw === '' ? undefined : (Number(team_member_numericRaw) || team_member_numericRaw);

  try {
    if (month_id && !month_key) {
      const resolved = await getMonthKeyFromId(month_id);
      if (resolved) month_key = resolved;
    }
    const filters: { month_id?: string; month_key?: string; team_member_id?: string; team_member_numeric?: number | string } = {};
    if (month_id) filters.month_id = month_id;
    if (month_key) filters.month_key = month_key;
    if (team_member_id) filters.team_member_id = team_member_id;
    if (team_member_numeric !== undefined) filters.team_member_numeric = team_member_numeric;

    const formula = buildMonthlyMemberBasisFormula(filters);
    if (process.env.NODE_ENV === 'development') {
      console.log('[api/monthly-basis GET]', { month_id: month_id ?? '(none)', month_key: month_key ?? '(none)', team_member_id: team_member_id ?? '(none)', filterByFormula: formula ?? '(none)', filters });
    }
    let records = await listMonthlyMemberBasis(filters);
    const teamMembers = await listTeamMembers({});
    const chatters = teamMembers.filter((m) => ((m.fields.role ?? '') as string).toLowerCase() === 'chatter');
    const chatterIds = new Set(chatters.map((m) => m.id));
    records = records.filter((r) => {
      const teamRaw = r.fields.team_member;
      const teamMemberId = Array.isArray(teamRaw) && teamRaw[0] ? String(teamRaw[0]) : '';
      return teamMemberId !== '' && chatterIds.has(teamMemberId);
    });
    if (process.env.NODE_ENV === 'development') {
      console.log('[api/monthly-basis GET]', { recordsCount: records.length, chatterIdsSize: chatterIds.size, sample: records.slice(0, 3).map((r) => ({ id: r.id, basis_type: r.fields.basis_type, month: r.fields.month, team_member: r.fields.team_member, amount_usd: r.fields.amount_usd })) });
    }

    const linkedMonthIds = new Set<string>();
    for (const r of records) {
      const m = r.fields.month;
      if (Array.isArray(m) && m[0]) linkedMonthIds.add(String(m[0]));
    }
    const monthIdToKey: Record<string, string> = {};
    await Promise.all(
      Array.from(linkedMonthIds).map(async (id) => {
        const key = await getMonthKeyFromId(id);
        if (key) monthIdToKey[id] = key;
      })
    );

    const list = records.map((r) => {
      const amountEur = typeof r.fields.amount_eur === 'number' ? r.fields.amount_eur : null;
      const notes = r.fields.notes ?? '';
      const rawBasisType = r.fields.basis_type;
      const basisType = typeof rawBasisType === 'string' ? rawBasisType.trim() : '';
      const payout_pct = basisType === 'chatter_sales' ? parsePayoutPctFromNotes(notes) : undefined;
      const monthRaw = r.fields.month;
      const teamRaw = r.fields.team_member;
      const monthId = Array.isArray(monthRaw) && monthRaw[0] ? String(monthRaw[0]) : '';
      const monthKeyResolved = typeof monthRaw === 'string' ? monthRaw : (monthId ? monthIdToKey[monthId] ?? '' : '');
      const teamMemberId = Array.isArray(teamRaw) && teamRaw[0] ? String(teamRaw[0]) : '';
      const teamMemberNumericId = !Array.isArray(teamRaw) && (typeof teamRaw === 'number' || (typeof teamRaw === 'string' && teamRaw !== '')) ? (typeof teamRaw === 'number' ? teamRaw : teamRaw) : undefined;
      const dept = r.fields.department ?? '';
      return {
        id: r.id,
        month_id: monthId ?? '',
        month_key: monthKeyResolved || undefined,
        team_member_id: teamMemberId ?? '',
        team_member_numeric_id: teamMemberNumericId,
        department: basisType === 'chatter_sales' ? (dept || 'chatting') : dept,
        basis_type: basisType,
        amount: r.fields.amount ?? 0,
        amount_usd: r.fields.amount_usd,
        amount_eur: r.fields.amount_eur,
        currency: basisType === 'chatter_sales' ? 'usd' : (amountEur != null ? 'eur' : 'usd'),
        notes,
        payout_pct,
        created_at: r.fields.created_at ?? r.createdTime ?? '',
      };
    });
    const res = NextResponse.json(list);
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/monthly-basis GET]', e);
    return serverError(reqId, e, { route: '/api/monthly-basis' });
  }
}

export async function POST(request: NextRequest) {
  const reqId = requestId();
  const session = await getSessionFromRequest(request.headers.get('cookie'));
  if (!session) return unauthorized(reqId);

  let body: {
    month_id?: string;
    month_key?: string;
    team_member_id?: string;
    team_member_numeric?: number | string;
    department?: string;
    basis_type?: string;
    amount?: number;
    amount_usd?: number;
    gross_usd?: number;
    amount_eur?: number;
    notes?: string;
    payout_pct?: number;
    reason?: string;
  };
  try {
    body = await request.json();
  } catch {
    return badRequest(reqId, 'Invalid JSON body');
  }
  if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
    try {
      assertNoUnknownBodyKeys(body as Record<string, unknown>, POST_BODY_ALLOWED, reqId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return badRequest(reqId, msg);
    }
  }
  const month_id = body.month_id?.trim();
  const month_key = body.month_key?.trim();
  const team_member_id = body.team_member_id?.trim();
  const team_member_numeric = body.team_member_numeric;
  const hasMonth = Boolean(month_id) || Boolean(month_key);
  const hasTeam = Boolean(team_member_id) || (team_member_numeric !== undefined && team_member_numeric !== null && team_member_numeric !== '');
  const basis_type = body.basis_type?.trim();
  if (!basis_type) {
    return badRequest(reqId, 'basis_type is required');
  }
  if (!hasMonth) {
    return badRequest(reqId, 'month_id or month_key is required');
  }
  if (!hasTeam) {
    return badRequest(reqId, 'team_member_id or team_member_numeric is required');
  }
  const isMemberScoped = ['chatter_sales', 'bonus', 'adjustment', 'fine'].includes(basis_type);
  if (isMemberScoped && !team_member_id) {
    return badRequest(reqId, 'team_member_id is required for chatter_sales, bonus, adjustment, and fine (linked record required for payout attribution)');
  }
  if (!BASIS_TYPES.includes(basis_type as MonthlyBasisType)) {
    return badRequest(reqId, `basis_type must be one of: ${BASIS_TYPES.join(', ')}`);
  }

  const isChatterSales = basis_type === 'chatter_sales';
  const isFine = basis_type === 'fine';
  if (isFine && !(body.reason?.trim())) return badRequest(reqId, 'reason is required for fine entries');
  if (basis_type === 'bonus' && !(body.reason?.trim() || body.notes?.trim())) {
    return badRequest(reqId, 'reason or notes is required for bonus entries');
  }
  const notesContent = (isFine ? `FINE: ${body.reason?.trim() ?? ''}` : (body.reason ?? body.notes ?? '').trim()).trim();
  const payoutPct = body.payout_pct != null ? Number(body.payout_pct) : undefined;
  if (payoutPct != null && (Number.isNaN(payoutPct) || payoutPct < 0 || payoutPct > 100)) {
    return badRequest(reqId, 'payout_pct must be between 0 and 100');
  }

  let effectiveUsd: number | undefined;
  let effectiveEur: number | undefined;
  if (isChatterSales) {
    const gross = typeof body.gross_usd === 'number' ? body.gross_usd : body.amount_usd;
    if (typeof gross !== 'number' || Number.isNaN(gross) || gross < 0) {
      return badRequest(reqId, 'chatter_sales requires gross_usd (non-negative number)');
    }
    effectiveUsd = gross;
  } else {
    const isBonus = basis_type === 'bonus';
    const isFineBasis = isFine;
    const hasEur = typeof body.amount_eur === 'number';
    const hasUsd = typeof body.amount_usd === 'number';
    const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
    const hasAmount = typeof body.amount === 'number';

    if (isBonus || isFineBasis) {
      // For bonus and fines we treat the input as EUR. User enters positive; for fines we persist negative.
      if (!hasEur) {
        return badRequest(reqId, 'amount_eur is required for bonus/fine entries');
      }
      if (Number.isNaN(body.amount_eur) || (body.amount_eur as number) < 0) {
        return badRequest(reqId, 'amount_eur must be a non-negative number');
      }
      effectiveEur = isFineBasis ? -Math.abs(body.amount_eur as number) : (body.amount_eur as number);
      // Ignore any amount_usd provided for bonus/fine; we'll derive USD from FX where needed.
      effectiveUsd = undefined;
    } else {
      const hasAny = hasAmount || hasUsd || hasEur;
      if (!hasAny) return badRequest(reqId, 'At least one of amount, amount_usd, or amount_eur is required');
      if (hasAmount && (Number.isNaN(amount) || amount < 0)) {
        return badRequest(reqId, 'amount must be a non-negative number');
      }
      effectiveEur = hasEur ? (body.amount_eur as number) : (typeof body.amount === 'number' ? body.amount : undefined);
      effectiveUsd = hasUsd ? (body.amount_usd as number) : undefined;
    }
  }

  const origin = new URL(request.url).origin;
  const fx = await getFxRateForServer(origin);
  const { amount_usd: finalUsd, amount_eur: finalEur } = ensureDualAmounts(effectiveUsd, effectiveEur, fx?.rate ?? null);

  const notes =
    isChatterSales && payoutPct != null
      ? `PCT:${payoutPct}${notesContent ? `\n${notesContent}` : ''}`
      : notesContent;

  const resolvedMonthKey = month_key || (month_id ? await getMonthKeyFromId(month_id) : null);

  try {
    if (isChatterSales) {
      const lookupFilters: { month_id?: string; month_key?: string; team_member_id?: string; team_member_numeric?: number | string; basis_type: string } = { basis_type: 'chatter_sales' };
      if (month_id) lookupFilters.month_id = month_id;
      if (resolvedMonthKey) lookupFilters.month_key = resolvedMonthKey;
      if (team_member_id) lookupFilters.team_member_id = team_member_id;
      if (team_member_numeric !== undefined && team_member_numeric !== null && team_member_numeric !== '') lookupFilters.team_member_numeric = team_member_numeric;
      const existing = await listMonthlyMemberBasis(lookupFilters);
      if (existing.length > 0) {
        const recordId = existing[0].id;
        const updated = await updateMonthlyMemberBasis(recordId, {
          amount_usd: finalUsd,
          amount_eur: finalEur,
          amount: finalEur,
          notes,
          ...(team_member_id ? { team_member: [team_member_id] } : {}),
        });
        await writeAuditLog({
          user_email: session.email,
          table: 'monthly_member_basis',
          record_id: recordId,
          field_name: 'update',
          old_value: JSON.stringify({ basis_type: 'chatter_sales', month_id, team_member_id }),
          new_value: JSON.stringify({ amount_usd: finalUsd, notes }),
        });
        const amountEur = typeof updated.fields.amount_eur === 'number' ? updated.fields.amount_eur : null;
        const res = NextResponse.json({
          id: updated.id,
          month_id,
          team_member_id,
          basis_type: 'chatter_sales',
          amount: updated.fields.amount ?? finalEur,
          amount_usd: updated.fields.amount_usd ?? finalUsd,
          amount_eur: updated.fields.amount_eur,
          currency: amountEur != null ? 'eur' : 'usd',
          notes: updated.fields.notes ?? '',
          payout_pct: parsePayoutPctFromNotes(updated.fields.notes ?? ''),
        });
        res.headers.set('request-id', reqId);
        return res;
      }
    }

    let saveEur = finalEur;
    let saveUsd = finalUsd;
    if (basis_type === 'fine') {
      if (saveEur > 0) saveEur = -Math.abs(saveEur);
      if (saveUsd != null && saveUsd > 0) saveUsd = -Math.abs(saveUsd);
    }
    const payloadToSave = {
      ...(month_id ? { month_id } : {}),
      ...(month_key ? { month_key } : {}),
      ...(team_member_id ? { team_member_id } : {}),
      ...(team_member_numeric !== undefined && team_member_numeric !== null && team_member_numeric !== '' ? { team_member_numeric } : {}),
      basis_type,
      amount: saveEur,
      amount_usd: saveUsd,
      amount_eur: saveEur,
      notes,
    };
    if (process.env.NODE_ENV === 'development' && isFine) {
      console.log('[api/monthly-basis POST] creating fine — saved fields:', {
        basis_type,
        amount_eur: saveEur,
        amount_usd: saveUsd,
        notes: notes.slice(0, 80),
      });
    }
    const record = await createMonthlyMemberBasis(payloadToSave);
    await writeAuditLog({
      user_email: session.email,
      table: 'monthly_member_basis',
      record_id: record.id,
      field_name: 'create',
      old_value: '',
      new_value: JSON.stringify({ basis_type, amount: finalEur, month_id, team_member_id }),
    });
    const amountEur = typeof record.fields.amount_eur === 'number' ? record.fields.amount_eur : null;
    const res = NextResponse.json({
      id: record.id,
      month_id,
      team_member_id,
      basis_type,
      amount: finalEur,
      amount_usd: record.fields.amount_usd,
      amount_eur: record.fields.amount_eur,
      currency: amountEur != null ? 'eur' : 'usd',
      notes: record.fields.notes ?? '',
      payout_pct: isChatterSales ? parsePayoutPctFromNotes(record.fields.notes ?? '') : undefined,
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.error('[api/monthly-basis POST]', e);
    return serverError(reqId, e, { route: '/api/monthly-basis' });
  }
}
