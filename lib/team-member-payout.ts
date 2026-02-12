/**
 * Persist team member compensation in notes as JSON (no Airtable schema change).
 * Format: notes may contain a line PAYOUT_JSON:{"type":"percentage","pct":15,"flat":0,"scope":["rec..."]}
 * or we append/prepend JSON to notes.
 */

export type PayoutType = 'percentage' | 'flat_fee' | 'hybrid' | 'none';

export interface PayoutData {
  type: PayoutType;
  pct?: number;
  flat?: number;
  scope?: string[];
}

const PAYOUT_MARKER = 'PAYOUT_JSON:';

export function parsePayoutFromNotes(notes: string | null | undefined): PayoutData | null {
  if (!notes || typeof notes !== 'string') return null;
  const idx = notes.indexOf(PAYOUT_MARKER);
  if (idx === -1) return null;
  const start = idx + PAYOUT_MARKER.length;
  let depth = 0;
  let end = start;
  for (let i = start; i < notes.length; i++) {
    const c = notes[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  const json = notes.slice(start, end);
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    const type = (raw.type as PayoutType) ?? 'none';
    const pct = typeof raw.pct === 'number' ? raw.pct : undefined;
    const flat = typeof raw.flat === 'number' ? raw.flat : undefined;
    const scope = Array.isArray(raw.scope) ? (raw.scope as string[]).filter((s) => typeof s === 'string') : undefined;
    return { type, pct, flat, scope };
  } catch {
    return null;
  }
}

export function mergePayoutIntoNotes(
  notes: string | null | undefined,
  payout: PayoutData | null
): string {
  const rest = notes && typeof notes === 'string' ? notes : '';
  const without = rest.includes(PAYOUT_MARKER)
    ? rest.replace(new RegExp(`${PAYOUT_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*(\\{[^]*?\\})?`, 'g'), '').trim()
    : rest.trim();
  if (!payout || payout.type === 'none') return without;
  const payload: Record<string, unknown> = { type: payout.type };
  if (payout.pct != null) payload.pct = payout.pct;
  if (payout.flat != null) payload.flat = payout.flat;
  if (payout.scope?.length) payload.scope = payout.scope;
  const line = `${PAYOUT_MARKER}${JSON.stringify(payload)}`;
  return without ? `${without}\n${line}` : line;
}
