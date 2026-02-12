import { NextResponse } from 'next/server';
import { listTeamMembers } from '@/lib/airtable';
import { requestId } from '@/lib/api-utils';
import type { TeamMember, TeamMemberRecord, PayoutType, PayoutFrequency } from '@/lib/types';
import type { AirtableRecord } from '@/lib/types';

export const runtime = 'edge';

const PAYOUT_TYPES: PayoutType[] = ['percentage', 'flat_fee', 'hybrid', 'none'];
const PAYOUT_FREQUENCIES: PayoutFrequency[] = ['weekly', 'monthly'];

function toTeamMember(rec: AirtableRecord<TeamMemberRecord>): TeamMember {
  const f = rec.fields;
  const rawPayoutType = f.payout_type as string | undefined;
  const payoutType =
    rawPayoutType !== undefined && rawPayoutType !== '' && PAYOUT_TYPES.includes(rawPayoutType as PayoutType)
      ? (rawPayoutType as PayoutType)
      : 'none';
  const rawPayoutFreq = f.payout_frequency as string | undefined;
  const payoutFreq =
    rawPayoutFreq !== undefined && rawPayoutFreq !== '' && PAYOUT_FREQUENCIES.includes(rawPayoutFreq as PayoutFrequency)
      ? (rawPayoutFreq as PayoutFrequency)
      : 'monthly';
  const modelsScope = Array.isArray(f.models_scope) ? f.models_scope.filter((id): id is string => typeof id === 'string') : [];
  return {
    id: rec.id,
    name: f.name ?? '',
    email: (f.email as string) ?? '',
    role: f.role ?? '',
    department: f.department ?? '',
    status: f.status ?? 'active',
    notes: f.notes ?? '',
    monthly_cost: f.monthly_cost,
    model_id: f.model?.[0],
    payout_type: payoutType,
    payout_percentage: f.payout_percentage,
    payout_flat_fee: f.payout_flat_fee,
    payout_frequency: payoutType !== 'none' ? payoutFreq : 'monthly',
    models_scope: modelsScope,
  };
}

/** Dev-only: return first team member raw Airtable fields + mapped TeamMember for sanity check. */
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse(null, { status: 404 });
  }
  const reqId = requestId();
  try {
    const records = await listTeamMembers({});
    const first = records[0];
    if (!first) {
      const res = NextResponse.json({ requestId: reqId, message: 'No team members', raw_fields: null, mapped: null });
      res.headers.set('request-id', reqId);
      return res;
    }
    const rawFields = first.fields as Record<string, unknown>;
    const mapped = toTeamMember(first as AirtableRecord<TeamMemberRecord>);
    const res = NextResponse.json({
      requestId: reqId,
      raw_fields: rawFields,
      mapped,
      field_names_match: [
        'payout_type',
        'payout_percentage',
        'payout_flat_fee',
        'payout_frequency',
        'models_scope',
      ].every((k) => Object.prototype.hasOwnProperty.call(rawFields, k) || k === 'models_scope'),
    });
    res.headers.set('request-id', reqId);
    return res;
  } catch (e) {
    const res = NextResponse.json(
      { requestId: reqId, error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 }
    );
    res.headers.set('request-id', reqId);
    return res;
  }
}
