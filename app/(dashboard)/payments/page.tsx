'use client';

import { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { formatEur, formatUsd } from '@/lib/format-money';
import { formatMonthLabel } from '@/lib/format';
import { round2 } from '@/lib/fx';
import { apiFetch } from '@/lib/client-fetch';
import { getCurrentMonthKey, pickDefaultMonthId } from '@/lib/months';
import type { TeamMemberPaymentMethod } from '@/lib/types';

/** team_member_id (recxxx) -> methods */
type PaymentMethodsByTeamMemberId = Record<string, TeamMemberPaymentMethod[]>;
/** model_id (recxxx or "model-recxxx") -> methods; when schema has no model link, use fallback to team_member. */
type PaymentMethodsByModelId = Record<string, TeamMemberPaymentMethod[]>;
import GlassCard from '@/app/components/ui/GlassCard';
import Toolbar from '@/app/components/ui/Toolbar';
import SmartSelect from '@/app/components/ui/SmartSelect';
import MoneyInput from '@/app/components/MoneyInput';
import { useFxRate } from '@/app/hooks/useFxRate';
import EmptyState from '@/app/components/ui/EmptyState';
import ErrorState from '@/app/components/ui/ErrorState';
import { TableWithEmpty } from '@/app/components/ui/DataTable';
import { getPayoutCategory, PAYOUT_TAB_IDS, categoryForTab, type PayoutTabId } from '@/lib/payout-tabs';

const PAYMENTS_STORAGE_KEY = 'payments:selectedRunId';

function maskIbanOrAccount(value: string | undefined): string {
  if (!value || typeof value !== 'string') return '—';
  const t = value.trim();
  if (t.length <= 4) return '••••';
  return '••••' + t.slice(-4);
}

/** Format IBAN/account for display: 4-char groups, no masking. Uses exact stored value. */
function formatIbanDisplay(value: string | undefined): string {
  if (!value || typeof value !== 'string') return '—';
  return value.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
}

function PaymentMethodBlock({ method, isDefault }: { method: TeamMemberPaymentMethod; isDefault: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.06] p-4">
      <div className="flex flex-wrap items-center gap-2">
        {isDefault && (
          <span className="inline-flex rounded-full bg-white/15 px-2 py-0.5 text-xs font-medium text-white/90">default</span>
        )}
        {method.status && (
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
              method.status === 'active' ? 'bg-green-500/20 text-green-300' : method.status === 'inactive' ? 'bg-white/10 text-white/60' : 'bg-amber-500/20 text-amber-300'
            }`}
          >
            {method.status}
          </span>
        )}
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        {method.payout_method && (
          <>
            <dt className="text-white/50">Payout method</dt>
            <dd className="text-white/90">{method.payout_method}</dd>
          </>
        )}
        {method.beneficiary_name && (
          <>
            <dt className="text-white/50">Beneficiary</dt>
            <dd className="text-white/90">{method.beneficiary_name}</dd>
          </>
        )}
        {method.iban_or_account != null && (
          <>
            <dt className="text-white/50">IBAN / Account</dt>
            <dd className="font-mono text-white/80">{maskIbanOrAccount(method.iban_or_account)}</dd>
          </>
        )}
        {method.revtag != null && method.revtag !== '' && (
          <>
            <dt className="text-white/50">Revtag</dt>
            <dd className="font-mono text-white/80">{method.revtag}</dd>
          </>
        )}
      </dl>
      {method.notes?.trim() && (
        <p className="mt-3 border-t border-white/10 pt-3 text-xs text-white/60">{method.notes.trim()}</p>
      )}
    </div>
  );
}

interface MonthOption {
  id: string;
  month_key: string;
  month_name: string;
}

interface TeamMemberOption {
  id: string;
  name: string;
  department: string;
  role: string;
  status?: string;
  payout_percentage?: number;
}

interface BasisRow {
  id: string;
  month_id: string;
  /** Set when month is stored as scalar key (e.g. "2026-01") or resolved from linked month. */
  month_key?: string;
  team_member_id: string;
  /** Set when team_member is stored as scalar number/string instead of linked record. */
  team_member_numeric_id?: number | string;
  department?: string;
  basis_type: string;
  amount: number;
  amount_usd?: number;
  amount_eur?: number;
  currency: string;
  notes: string;
  payout_pct?: number;
  created_at: string;
}

const FINE_NOTES_PREFIX = 'FINE:';
function isFineRow(row: BasisRow): boolean {
  return (
    (row.basis_type === 'adjustment' && (row.notes?.startsWith(FINE_NOTES_PREFIX) ?? false)) ||
    row.basis_type === 'fine'
  );
}
function fineReasonFromNotes(notes: string | undefined): string {
  if (!notes) return '';
  return notes.startsWith(FINE_NOTES_PREFIX) ? notes.slice(FINE_NOTES_PREFIX.length).trim() : notes;
}

/** Summary totals for bonus/fine rows: total bonus EUR, total fines EUR (positive), net = bonus - fines. */
function bonusFineSummary(rows: BasisRow[]): { totalBonusEur: number; totalFinesEur: number; netEur: number } {
  let totalBonusEur = 0;
  let totalFinesEur = 0;
  for (const r of rows) {
    const amountEur = typeof r.amount_eur === 'number' ? r.amount_eur : (r.amount ?? 0);
    if (r.basis_type === 'bonus') {
      totalBonusEur += amountEur;
    } else if (isFineRow(r)) {
      totalFinesEur += Math.abs(amountEur);
    }
  }
  return { totalBonusEur, totalFinesEur, netEur: totalBonusEur - totalFinesEur };
}

function formatCreatedAt(createdAt: string | undefined): string {
  if (!createdAt) return '—';
  try {
    const d = new Date(createdAt);
    if (Number.isNaN(d.getTime())) return createdAt;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return createdAt;
  }
}

interface PayoutLineRow {
  id: string;
  team_member_id: string;
  team_member_name: string;
  /** Payee team_member id for payment methods; for models from API, else same as team_member_id. */
  payee_team_member_id?: string;
  department: string;
  role: string;
  category?: 'chatter' | 'manager' | 'va' | 'model';
  payout_type: string;
  payout_percentage?: number;
  payout_flat_fee?: number;
  basis_webapp_amount: number;
  basis_manual_amount: number;
  bonus_amount: number;
  adjustments_amount: number;
  basis_total: number;
  payout_amount: number;
  amount_eur?: number | null;
  amount_usd?: number | null;
  currency: string;
  breakdown_json?: string;
  paid_status?: string;
  paid_at?: string | null;
  basis_webapp_amount_display?: string;
  basis_manual_amount_display?: string;
  bonus_amount_display?: string;
  adjustments_amount_display?: string;
  basis_total_display?: string;
  payout_amount_display?: string;
  amount_eur_display?: string;
  amount_usd_display?: string;
  payout_flat_fee_display?: string;
}

interface PayoutRunRow {
  id: string;
  month_id: string;
  month_key: string;
  status: string;
  notes: string;
}

function payoutPercentDisplay(payoutType: string, payoutPercentage: number | undefined, role?: string): string {
  if (role != null && (role as string).toLowerCase() !== 'chatter') return '—';
  if ((payoutType === 'percentage' || payoutType === 'hybrid') && typeof payoutPercentage === 'number') {
    return `${payoutPercentage}%`;
  }
  return '—';
}

function payoutFlatDisplay(payoutType: string, payoutFlatFee: number | undefined, formatEur: (n: number) => string): string {
  if ((payoutType === 'flat_fee' || payoutType === 'hybrid') && typeof payoutFlatFee === 'number') {
    return formatEur(payoutFlatFee);
  }
  return '—';
}

/** Final payout cell: use *_display when present (exact Airtable display), else format from numbers. */
function PayoutDualCell({
  amountUsd,
  amountEur,
  amountUsdDisplay,
  amountEurDisplay,
  fxRate,
}: {
  amountUsd?: number;
  amountEur?: number;
  amountUsdDisplay?: string;
  amountEurDisplay?: string;
  fxRate?: number | null;
}) {
  if (amountEurDisplay != null && amountEurDisplay !== '—' && amountUsdDisplay != null && amountUsdDisplay !== '—') {
    return (
      <div className="flex flex-col items-end">
        <div className="font-semibold text-lg tabular-nums text-white/90">{amountEurDisplay}</div>
        <div className="text-sm tabular-nums opacity-70 text-white/80">{amountUsdDisplay}</div>
      </div>
    );
  }
  if (amountEurDisplay != null && amountEurDisplay !== '—') {
    return <div className="font-semibold text-lg tabular-nums text-white/90">{amountEurDisplay}</div>;
  }
  if (amountUsdDisplay != null && amountUsdDisplay !== '—') {
    return <div className="font-semibold tabular-nums text-white/90">{amountUsdDisplay}</div>;
  }
  const hasUsd = typeof amountUsd === 'number' && Number.isFinite(amountUsd);
  const hasEur = typeof amountEur === 'number' && Number.isFinite(amountEur);
  const rate = typeof fxRate === 'number' && Number.isFinite(fxRate) && fxRate > 0 ? fxRate : null;
  const eur = hasEur ? round2(amountEur!) : (hasUsd && rate ? round2(amountUsd! * rate) : null);
  const usd = hasUsd ? round2(amountUsd!) : (hasEur && rate ? round2(amountEur! / rate) : null);
  if (eur != null && usd != null) {
    return (
      <div className="flex flex-col items-end">
        <div className="font-semibold text-lg tabular-nums text-white/90">{formatEur(eur)}</div>
        <div className="text-sm tabular-nums opacity-70 text-white/80">{formatUsd(usd)}</div>
      </div>
    );
  }
  if (eur != null) return <div className="font-semibold text-lg tabular-nums text-white/90">{formatEur(eur)}</div>;
  if (usd != null) return <div className="font-semibold tabular-nums text-white/90">{formatUsd(usd)}</div>;
  return <span className="text-white/60">—</span>;
}

/** Format number as EUR with 2 decimals for payout table (exact, no k/M). */
function formatEur2(n: number | undefined | null): string {
  return formatEur(n != null && Number.isFinite(n) ? round2(n) : undefined);
}

/** Basis (webapp) is USD. Primary line: USD with $; second line: EUR with € (live fx). */
function BasisUsdEur({
  amountUsd,
  fxRate,
}: {
  amountUsd: number | undefined | null;
  fxRate?: number | null;
}) {
  if (amountUsd == null || !Number.isFinite(amountUsd)) return <span className="text-white/60">—</span>;
  const usdStr = formatUsd(amountUsd);
  const eurVal = fxRate != null && Number.isFinite(fxRate) && fxRate > 0 ? amountUsd * fxRate : null;
  const eurStr = eurVal != null ? formatEur(eurVal) : 'EUR unavailable';
  return (
    <div className="block" aria-label={`Basis: ${usdStr} USD${eurVal != null ? `, ${eurStr} EUR` : ''}`}>
      <div className="font-mono tabular-nums text-sm text-white/90" title="USD">{usdStr}</div>
      <div className="text-xs font-mono tabular-nums text-white/50" title="EUR">{eurStr}</div>
    </div>
  );
}

/** Exact number: no abbreviation (no k/M). Uses 2 decimals for money. */
function formatExactNumber(
  value: number | undefined | null,
  opts: { minDecimals?: number } = {}
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const minDecimals = opts.minDecimals ?? 2;
  return Number(value).toFixed(minDecimals);
}

/** Exact number for breakdown display: 2 decimals, no abbreviations. */
function formatNum(n: number | undefined | null): string {
  return formatExactNumber(n, { minDecimals: 2 });
}

function paymentSummaryLabel(methods: TeamMemberPaymentMethod[] | undefined): string {
  if (!methods?.length) return 'no methods';
  const first = methods[0];
  const provider = (first.label ?? first.payout_method ?? first.method_type ?? 'payout').toString().trim() || 'payout';
  if (methods.length > 1) return `${provider} (+${methods.length - 1})`;
  return provider;
}

/** Average affiliate % from breakdown_json.models[].pct for "5% avg" display; returns "—" if none. */
function affiliateAvgPctDisplay(row: PayoutLineRow): string {
  if (!row.breakdown_json) return '—';
  try {
    const parsed = JSON.parse(row.breakdown_json) as { models?: Array<{ pct?: number }> };
    const arr = parsed?.models;
    if (!Array.isArray(arr) || arr.length === 0) return '—';
    const sum = arr.reduce((s, m) => s + (typeof m.pct === 'number' && Number.isFinite(m.pct) ? m.pct : 0), 0);
    const avg = sum / arr.length;
    return Number.isFinite(avg) ? `${round2(avg)}% avg` : '—';
  } catch {
    return '—';
  }
}

/** Premium breakdown dialog: parsed sections, exact numbers, no raw JSON. */
function BreakdownDialog({
  row,
  open,
  onOpenChange,
  fxRate,
}: {
  row: PayoutLineRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fxRate?: number | null;
}) {
  const parsed = useMemo(() => {
    if (!row?.breakdown_json) return null;
    try {
      return JSON.parse(row.breakdown_json) as Record<string, unknown>;
    } catch {
      return null;
    }
  }, [row?.breakdown_json]);

  const basisWebapp = (parsed?.basis_webapp_amount ?? row?.basis_webapp_amount ?? 0) as number;
  const basisManual = (parsed?.basis_manual ?? parsed?.basis_manual_amount ?? row?.basis_manual_amount ?? 0) as number;
  const basisTotal = (parsed?.basis_total ?? row?.basis_total ?? 0) as number;
  const bonus = (parsed?.bonus ?? parsed?.bonus_amount ?? row?.bonus_amount ?? 0) as number;
  const adjustments = (parsed?.adjustments ?? parsed?.adjustments_amount ?? row?.adjustments_amount ?? 0) as number;
  const formula = typeof parsed?.formula === 'string' ? parsed.formula : null;
  const amountEur = row?.amount_eur ?? (row?.currency === 'eur' ? row?.payout_amount : null);
  const amountUsd = row?.amount_usd ?? (row?.currency === 'usd' ? row?.payout_amount : null);
  const rate = typeof fxRate === 'number' && Number.isFinite(fxRate) && fxRate > 0 ? fxRate : null;
  const eurDisplay = amountEur != null && Number.isFinite(amountEur) ? formatEur(round2(amountEur)) : null;
  const usdDisplay = amountUsd != null && Number.isFinite(amountUsd) ? formatUsd(round2(amountUsd)) : (eurDisplay && rate ? formatUsd(round2(amountEur! / rate)) : null);

  if (!row) return null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-[50%] top-[50%] z-50 max-h-[85vh] w-full max-w-lg translate-x-[-50%] translate-y-[-50%] overflow-y-auto rounded-2xl border border-white/10 bg-zinc-900/95 p-6 shadow-xl backdrop-blur-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <Dialog.Title className="text-lg font-semibold text-white">Breakdown — {row.team_member_name}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-white/60">Payout calculation details</Dialog.Description>

          {parsed?.net_revenue_missing === true && row.department === 'models' && (
            <p className="mt-4 text-amber-400/90 text-xs rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5">Net revenue missing — payout set to 0. Add net_revenue on pnl_lines for this model/month.</p>
          )}

          <div className="mt-6 space-y-5">
            <div className="rounded-xl border border-white/10 bg-white/[0.06] p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-white/50">Basis</h4>
              <dl className="mt-2 space-y-1.5 text-sm">
                <div className="flex justify-between gap-4 items-start">
                  <dt className="text-white/70">Basis (webapp)</dt>
                  <dd className="text-right"><BasisUsdEur amountUsd={basisWebapp} fxRate={fxRate} /></dd>
                </div>
                <div className="flex justify-between gap-4 items-start">
                  <dt className="text-white/70">Basis (manual)</dt>
                  <dd className="text-right"><BasisUsdEur amountUsd={basisManual} fxRate={fxRate} /></dd>
                </div>
                <div className="flex justify-between gap-4 items-start border-t border-white/10 pt-2">
                  <dt className="font-medium text-white/90">Basis total</dt>
                  <dd className="text-right font-medium"><BasisUsdEur amountUsd={basisTotal} fxRate={fxRate} /></dd>
                </div>
              </dl>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.06] p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-white/50">Bonus & adjustments</h4>
              <dl className="mt-2 space-y-1.5 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-white/70">Bonus</dt>
                  <dd className="font-mono tabular-nums text-right text-white/90">{formatNum(bonus)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-white/70">Fines / adjustments</dt>
                  <dd className="font-mono tabular-nums text-right text-white/90">{formatNum(adjustments)}</dd>
                </div>
                {Number(bonus) === 0 && Number(adjustments) === 0 && (
                  <p className="mt-2 text-xs text-white/50">No bonus or adjustment entries for this line.</p>
                )}
              </dl>
            </div>

            {formula && (
              <div className="rounded-xl border border-white/10 bg-white/[0.06] p-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-white/50">Formula</h4>
                <p className="mt-2 font-mono text-sm text-white/80">{formula}</p>
              </div>
            )}

            <div className="rounded-xl border border-white/10 bg-white/[0.06] p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-white/50">Computed payout</h4>
              <div className="mt-2 flex flex-col items-end gap-1 text-sm">
                {eurDisplay && <span className="font-mono text-base font-semibold tabular-nums text-white/90">{eurDisplay}</span>}
                {usdDisplay && <span className="font-mono tabular-nums text-white/70">{usdDisplay}</span>}
                {!eurDisplay && !usdDisplay && <span className="text-white/50">—</span>}
              </div>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <Dialog.Close asChild>
              <button type="button" className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/15">Close</button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const actionBtnBase =
  'inline-flex items-center h-9 px-3 text-sm font-medium rounded-xl border border-white/10 bg-zinc-900/60 backdrop-blur-sm shadow-sm transition-all duration-200 ease-out hover:translate-y-[-1px]';

/** Full payout string for copy: "revolut | beneficiary: name | iban: ....3113 | revtag: 313113" */
function fullPayoutString(m: TeamMemberPaymentMethod): string {
  const parts: string[] = [];
  parts.push((m.payout_method || m.method_type || 'payout').toString().trim());
  if (m.beneficiary_name?.trim()) parts.push('beneficiary: ' + m.beneficiary_name.trim());
  if (m.iban_or_account) parts.push('iban: ' + maskIbanOrAccount(m.iban_or_account));
  if (m.revtag?.trim()) parts.push('revtag: ' + m.revtag.trim().replace(/^@/, ''));
  return parts.join(' | ');
}

function CopyButton({ label, text, fieldId, copiedFieldId, onCopy }: { label: string; text: string; fieldId: string; copiedFieldId: string | null; onCopy: (text: string, id: string) => void }) {
  const isCopied = copiedFieldId === fieldId;
  if (!text || text === '—') return null;
  return (
    <button
      type="button"
      onClick={() => onCopy(text, fieldId)}
      className="ml-1.5 inline-flex items-center rounded border border-white/20 bg-white/5 px-1.5 py-0.5 text-xs text-white/70 hover:bg-white/10 hover:text-white/90"
      title={`Copy ${label}`}
    >
      {isCopied ? 'Copied' : 'Copy'}
    </button>
  );
}

function PaymentCellContent({ methods }: { methods: TeamMemberPaymentMethod[] }) {
  const defaultMethod = methods.find((m) => m.is_default) ?? methods[0];
  const label = (defaultMethod.label ?? defaultMethod.payout_method ?? defaultMethod.method_type ?? 'payout').toString().trim() || 'payout';
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {defaultMethod.is_default && (
        <span className="inline-flex rounded-full bg-white/15 px-2 py-0.5 text-xs font-medium text-white/90">primary</span>
      )}
      <span className="text-sm text-white/80">{label}</span>
    </div>
  );
}

function BreakdownRow({
  row,
  idx,
  fxRate,
  onPaidToggle,
  paidToggleBusy,
  paymentMethods,
  payeeId,
  memberName,
  isPaymentExpanded,
  onTogglePaymentExpand,
  onManagePayment,
  onToggleBreakdown,
  isBreakdownExpanded,
  compactAffiliate,
}: {
  row: PayoutLineRow;
  idx: number;
  fxRate?: number | null;
  onPaidToggle?: (lineId: string, currentStatus: string) => void;
  paidToggleBusy?: string | null;
  paymentMethods: TeamMemberPaymentMethod[];
  payeeId: string | null;
  memberName: string;
  isPaymentExpanded: boolean;
  onTogglePaymentExpand: () => void;
  onManagePayment: () => void;
  onToggleBreakdown: () => void;
  isBreakdownExpanded: boolean;
  /** Affiliates tab: only Member, %, Payout, Payment, Actions (basis columns hidden). */
  compactAffiliate?: boolean;
}) {
  const [copiedFieldId, setCopiedFieldId] = useState<string | null>(null);
  const [formulaCopied, setFormulaCopied] = useState(false);
  const copyToClipboard = useCallback(async (text: string, fieldId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedFieldId(fieldId);
      const t = setTimeout(() => setCopiedFieldId(null), 2000);
      return () => clearTimeout(t);
    } catch {
      setCopiedFieldId(null);
    }
  }, []);

  const isPaid = (row.paid_status ?? 'pending') === 'paid';
  const busy = paidToggleBusy === row.id;
  const currencyDisplay = row.currency
    ? (row.currency as string).toUpperCase()
    : (row.role && (row.role as string).toLowerCase() !== 'chatter' ? 'EUR' : '—');
  const paymentLabel = paymentSummaryLabel(paymentMethods);
  const hasPayee = payeeId != null && payeeId !== '';
  const compact = compactAffiliate === true;
  const colSpan = compact ? 5 : 15;

  return (
    <>
      <tr className={`border-t border-white/10 hover:bg-white/5 ${idx % 2 === 1 ? 'bg-white/[0.03]' : ''}`}>
        <td className="py-3 px-4 font-medium text-white/90">{row.team_member_name}</td>
        {compact ? (
          <>
            <td className="py-3 px-4 text-right tabular-nums font-mono text-sm text-white/70">{affiliateAvgPctDisplay(row)}</td>
            <td className="py-3 px-4">
              <PayoutDualCell
                amountEur={row.amount_eur ?? (row.currency === 'eur' ? row.payout_amount : undefined)}
                amountUsd={row.amount_usd ?? (row.currency === 'usd' ? row.payout_amount : undefined)}
                amountEurDisplay={row.amount_eur_display}
                amountUsdDisplay={row.amount_usd_display}
                fxRate={fxRate}
              />
            </td>
            <td className="py-3 px-4">
              {paymentMethods.length === 0 ? (
                <span className="text-sm text-white/50">no methods</span>
              ) : (
                <PaymentCellContent methods={paymentMethods} />
              )}
            </td>
          </>
        ) : (
          <>
        <td className="py-3 px-4 text-white/80">{row.role}</td>
        <td className="py-3 px-4 text-white/70">{row.department}</td>
        <td className="py-3 px-4 text-right"><BasisUsdEur amountUsd={row.basis_webapp_amount} fxRate={fxRate} /></td>
        <td className="py-3 px-4 text-right"><BasisUsdEur amountUsd={row.basis_manual_amount} fxRate={fxRate} /></td>
        <td className="py-3 px-4 text-right tabular-nums font-mono text-sm text-white/90">{row.bonus_amount_display ?? formatEur2(row.bonus_amount)}</td>
        <td className="py-3 px-4 text-right"><BasisUsdEur amountUsd={row.basis_total} fxRate={fxRate} /></td>
        <td className="py-3 px-4 text-white/80">{row.payout_type}</td>
        <td className="py-3 px-4 text-right tabular-nums font-mono text-sm text-white/70">{payoutPercentDisplay(row.payout_type, row.payout_percentage, row.role)}</td>
        <td className="py-3 px-4 text-right tabular-nums font-mono text-sm text-white/70">{row.payout_flat_fee_display ?? payoutFlatDisplay(row.payout_type, row.payout_flat_fee, formatEur2)}</td>
        <td className="py-3 px-4">
          <PayoutDualCell
            amountEur={row.amount_eur ?? (row.currency === 'eur' ? row.payout_amount : undefined)}
            amountUsd={row.amount_usd ?? (row.currency === 'usd' ? row.payout_amount : undefined)}
            amountEurDisplay={row.amount_eur_display}
            amountUsdDisplay={row.amount_usd_display}
            fxRate={fxRate}
          />
        </td>
        <td className="py-3 px-4 text-white/70">{currencyDisplay}</td>
        <td className="py-3 px-4">
          {onPaidToggle ? (
            <button
              type="button"
              onClick={() => onPaidToggle(row.id, row.paid_status ?? 'pending')}
              disabled={busy}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200 shadow-inner disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
                isPaid
                  ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 hover:border-emerald-400'
                  : 'border border-zinc-600 bg-zinc-900/40 text-zinc-300 hover:border-[var(--purple-500)] hover:bg-[var(--purple-500)]/10'
              }`}
            >
              {busy ? (
                '…'
              ) : isPaid ? (
                <>
                  <span aria-hidden>✓</span>
                  Paid
                </>
              ) : (
                <>
                  <span aria-hidden>💳</span>
                  Pay
                </>
              )}
            </button>
          ) : (
            <span className={isPaid ? 'text-emerald-400' : 'text-white/70'}>{isPaid ? 'Paid' : 'Pending'}</span>
          )}
        </td>
        <td className="py-3 px-4">
          {paymentMethods.length === 0 ? (
            <span className="text-sm text-white/50">no methods</span>
          ) : (
            <PaymentCellContent methods={paymentMethods} />
          )}
        </td>
          </>
        )}
        <td className="py-3 px-4">
          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={onTogglePaymentExpand}
              className={`${actionBtnBase} text-white/90 hover:bg-zinc-800/80 hover:border-white/20`}
            >
              <svg className="h-4 w-4 mr-1.5 opacity-70 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              {isPaymentExpanded ? 'Hide' : 'View'}
            </button>
            {hasPayee && (
              <button
                type="button"
                onClick={onManagePayment}
                className={`${actionBtnBase} text-white bg-gradient-to-b from-zinc-900/90 to-zinc-800/70 hover:from-purple-600/20 hover:to-purple-500/10 hover:shadow-[0_0_20px_rgba(168,85,247,0.25)] hover:border-white/20`}
              >
                <svg className="h-4 w-4 mr-1.5 opacity-70 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                Manage
              </button>
            )}
            {row.breakdown_json ? (
              <button
                type="button"
                onClick={onToggleBreakdown}
                className={`${actionBtnBase} text-[var(--purple-400)] border-purple-500/30 hover:bg-purple-600/10 active:scale-95`}
              >
                Breakdown
                <svg className={`h-4 w-4 ml-1.5 shrink-0 transition-transform duration-200 ${isBreakdownExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
            ) : (
              <span className="text-white/40 text-sm">—</span>
            )}
          </div>
        </td>
      </tr>
      <tr className={`border-t border-white/10 ${idx % 2 === 1 ? 'bg-white/[0.02]' : ''}`}>
        <td colSpan={colSpan} className="p-0 align-top">
          <div
            className="overflow-hidden border-b border-white/10 bg-white/[0.04] transition-[max-height] duration-200 ease-out"
            style={{ maxHeight: isPaymentExpanded ? 400 : 0 }}
          >
            <div className="px-4 py-3">
              {paymentMethods.length === 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm text-white/50">No payment methods on file.</p>
                  {hasPayee && (
                    <button type="button" onClick={onManagePayment} className="rounded bg-white/10 px-2 py-1 text-xs font-medium text-white/80 hover:bg-white/15">
                      Manage
                    </button>
                  )}
                </div>
              ) : (
                (() => {
                  const defaultMethod = paymentMethods.find((m) => m.is_default) ?? paymentMethods[0];
                  const m = defaultMethod;
                  return (
                    <div className="rounded-xl border border-white/10 bg-white/[0.06] p-4 max-w-2xl">
                      <div className="flex flex-wrap items-center gap-2 mb-4">
                        <span className="text-sm font-semibold text-white/90">{m.payout_method || m.method_type || '—'}</span>
                        {m.status && (
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                              m.status === 'active' ? 'bg-green-500/20 text-green-300' : m.status === 'inactive' ? 'bg-white/10 text-white/60' : 'bg-amber-500/20 text-amber-300'
                            }`}
                          >
                            {m.status}
                          </span>
                        )}
                      </div>
                      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                        <div className="flex flex-wrap items-center gap-1">
                          <dt className="text-white/50 shrink-0">Beneficiary</dt>
                          <dd className="font-mono text-white/90">{m.beneficiary_name || '—'}</dd>
                          <CopyButton label="beneficiary" text={m.beneficiary_name?.trim() ?? ''} fieldId={`${m.id}-beneficiary`} copiedFieldId={copiedFieldId} onCopy={copyToClipboard} />
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="text-white/50 text-xs mb-1.5">IBAN/Account</dt>
                          <dd className="mt-0">
                            <div className="flex items-center justify-between gap-3 bg-zinc-950/50 rounded-xl px-4 py-3 border border-zinc-800">
                              <span className="font-mono tracking-wider text-white/90 text-sm break-all min-w-0">
                                {formatIbanDisplay(m.iban_or_account)}
                              </span>
                              <CopyButton label="IBAN/account" text={m.iban_or_account?.trim() ?? ''} fieldId={`${m.id}-iban`} copiedFieldId={copiedFieldId} onCopy={copyToClipboard} />
                            </div>
                          </dd>
                        </div>
                        {m.revtag != null && m.revtag !== '' && (
                          <div className="flex flex-wrap items-center gap-1 sm:col-span-2">
                            <dt className="text-white/50 shrink-0">Revtag</dt>
                            <dd className="font-mono text-white/80">{m.revtag}</dd>
                            <CopyButton label="revtag" text={m.revtag?.trim() ?? ''} fieldId={`${m.id}-revtag`} copiedFieldId={copiedFieldId} onCopy={copyToClipboard} />
                          </div>
                        )}
                        {m.notes?.trim() && (
                          <div className="flex flex-wrap items-start gap-1 sm:col-span-2">
                            <dt className="text-white/50 shrink-0">Notes</dt>
                            <dd className="text-white/70">{m.notes.trim()}</dd>
                          </div>
                        )}
                      </dl>
                      <div className="mt-4 pt-3 border-t border-white/10">
                        <button
                          type="button"
                          onClick={() => copyToClipboard(fullPayoutString(m), `${m.id}-full`)}
                          className="rounded-xl bg-[var(--purple-500)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--purple-600)]"
                        >
                          {copiedFieldId === `${m.id}-full` ? 'Copied' : 'Copy full payout string'}
                        </button>
                      </div>
                    </div>
                  );
                })()
              )}
            </div>
          </div>
        </td>
      </tr>
      {row.breakdown_json && isBreakdownExpanded && (
        <tr className={`border-t border-white/10 ${idx % 2 === 1 ? 'bg-white/[0.02]' : ''}`}>
          <td colSpan={colSpan} className="p-0 align-top">
            <div className="border-b border-white/10 bg-white/[0.04] px-4 py-3">
              {(() => {
                let parsed: Record<string, unknown> | null = null;
                try {
                  parsed = JSON.parse(row.breakdown_json!) as Record<string, unknown>;
                } catch {
                  return <p className="text-sm text-white/50">Invalid breakdown data.</p>;
                }
                const basisWebapp = (parsed?.basis_webapp_amount ?? row.basis_webapp_amount ?? 0) as number;
                const basisManual = (parsed?.basis_manual ?? parsed?.basis_manual_amount ?? row.basis_manual_amount ?? 0) as number;
                const basisTotal = (parsed?.basis_total ?? row.basis_total ?? 0) as number;
                const bonus = (parsed?.bonus ?? parsed?.bonus_amount ?? row.bonus_amount ?? 0) as number;
                const adjustments = (parsed?.adjustments ?? parsed?.adjustments_amount ?? row.adjustments_amount ?? 0) as number;
                const formula = typeof parsed?.formula === 'string' ? parsed.formula : null;
                const amountEur = row.amount_eur ?? (row.currency === 'eur' ? row.payout_amount : null);
                const amountUsd = row.amount_usd ?? (row.currency === 'usd' ? row.payout_amount : null);
                const rate = typeof fxRate === 'number' && Number.isFinite(fxRate) && fxRate > 0 ? fxRate : null;
                const eurDisplay = amountEur != null && Number.isFinite(amountEur) ? formatEur(round2(amountEur)) : null;
                const usdDisplay = amountUsd != null && Number.isFinite(amountUsd) ? formatUsd(round2(amountUsd)) : (eurDisplay && rate ? formatUsd(round2(amountEur! / rate)) : null);
                const copyFormula = () => {
                  if (formula) {
                    navigator.clipboard.writeText(formula);
                    setFormulaCopied(true);
                    setTimeout(() => setFormulaCopied(false), 2000);
                  }
                };
                const netRevenueMissing = parsed?.net_revenue_missing === true && row.department === 'models';
                return (
                  <div className="rounded-xl border border-white/10 bg-white/[0.06] p-4 max-w-2xl">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-white/50 mb-3">Breakdown</h4>
                    {netRevenueMissing && (
                      <p className="text-amber-400/90 text-xs mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5">Net revenue missing — payout set to 0. Add net_revenue on pnl_lines for this model/month.</p>
                    )}
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                      {Number(basisWebapp) !== 0 && (
                        <>
                          <span className="text-white/60">Basis (webapp)</span>
                          <span className="text-right"><BasisUsdEur amountUsd={basisWebapp} fxRate={fxRate} /></span>
                        </>
                      )}
                      {Number(basisManual) !== 0 && (
                        <>
                          <span className="text-white/60">Basis (manual)</span>
                          <span className="text-right"><BasisUsdEur amountUsd={basisManual} fxRate={fxRate} /></span>
                        </>
                      )}
                      {(Number(basisWebapp) !== 0 || Number(basisManual) !== 0) && (
                        <>
                          <span className="text-white/70 font-medium">Basis total</span>
                          <span className="text-right font-medium"><BasisUsdEur amountUsd={basisTotal} fxRate={fxRate} /></span>
                        </>
                      )}
                      {Number(bonus) !== 0 && (
                        <>
                          <span className="text-white/60">Bonus</span>
                          <span className="font-mono tabular-nums text-right text-white/90">{formatNum(bonus)}</span>
                        </>
                      )}
                      {Number(adjustments) !== 0 && (
                        <>
                          <span className="text-white/60">Fines / adjustments</span>
                          <span className="font-mono tabular-nums text-right text-white/90">{formatNum(adjustments)}</span>
                        </>
                      )}
                      {eurDisplay && (
                        <>
                          <span className="text-white/60">Payout (EUR)</span>
                          <span className="font-mono tabular-nums text-right text-white/90">{eurDisplay}</span>
                        </>
                      )}
                      {usdDisplay && (
                        <>
                          <span className="text-white/60">Payout (USD)</span>
                          <span className="font-mono tabular-nums text-right text-white/90">{usdDisplay}</span>
                        </>
                      )}
                    </div>
                    {formula && (
                      <div className="mt-3 pt-3 border-t border-white/10 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-white/50">Formula</span>
                        <code className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 font-mono text-xs text-white/80">{formula}</code>
                        <button type="button" onClick={copyFormula} className="rounded border border-white/20 bg-white/5 px-2 py-0.5 text-xs text-white/70 hover:bg-white/10">
                          {formulaCopied ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

type PaymentMethodFormState = {
  method_label: string;
  payout_method: string;
  beneficiary_name: string;
  iban_or_account: string;
  revtag: string;
  status: string;
  notes: string;
  is_default: boolean;
};

const PAYOUT_METHOD_OPTIONS = [
  { value: 'revolut', label: 'revolut' },
  { value: 'revolut business', label: 'revolut business' },
  { value: 'wise', label: 'wise' },
  { value: 'bank transfer', label: 'bank transfer' },
  { value: 'paypal', label: 'paypal' },
  { value: 'other', label: 'other' },
];

function showRevtagField(payoutMethod: string): boolean {
  const m = (payoutMethod || '').toLowerCase();
  return m === 'revolut' || m === 'revolut business' || m === 'wise';
}

function PaymentMethodFormBlock({
  form,
  setForm,
  memberId,
  editId,
  onSave,
  onCancel,
  saveBusy,
}: {
  form: PaymentMethodFormState;
  setForm: React.Dispatch<React.SetStateAction<PaymentMethodFormState>>;
  memberId: string;
  editId: string | null;
  onSave: () => void;
  onCancel: () => void;
  saveBusy: boolean;
}) {
  const [formCopiedId, setFormCopiedId] = useState<string | null>(null);
  const copyFormField = useCallback(async (text: string, id: string) => {
    if (!text?.trim()) return;
    try {
      await navigator.clipboard.writeText(text.trim());
      setFormCopiedId(id);
      setTimeout(() => setFormCopiedId(null), 2000);
    } catch {
      setFormCopiedId(null);
    }
  }, []);
  const glass = 'rounded-xl border bg-white/5 px-3 py-2 text-sm text-white/90';
  return (
    <div className="mt-5 space-y-5 rounded-xl border border-white/10 bg-white/[0.06] p-5">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-white/60 mb-1">Label</label>
          <SmartSelect
            value={form.method_label || 'primary'}
            onValueChange={(v) => setForm((f) => ({ ...f, method_label: v ?? 'primary' }))}
            options={[{ value: 'primary', label: 'primary' }, { value: 'secondary', label: 'secondary' }]}
            placeholder="Label"
            allowClear={false}
            className="w-full"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-white/60 mb-1">Payout method</label>
          <SmartSelect
            value={form.payout_method || null}
            onValueChange={(v) => setForm((f) => ({ ...f, payout_method: v ?? '' }))}
            options={PAYOUT_METHOD_OPTIONS}
            placeholder="—"
            allowClear={true}
            className="w-full"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-white/60 mb-1">Beneficiary name</label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={form.beneficiary_name}
            onChange={(e) => setForm((f) => ({ ...f, beneficiary_name: e.target.value }))}
            className={`${glass} flex-1`}
          />
          {form.beneficiary_name?.trim() && (
            <button
              type="button"
              onClick={() => copyFormField(form.beneficiary_name, 'beneficiary')}
              className="rounded border border-white/20 bg-white/5 px-2 py-1 text-xs text-white/70 hover:bg-white/10"
            >
              {formCopiedId === 'beneficiary' ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-white/60 mb-1">IBAN / Account</label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={form.iban_or_account}
            onChange={(e) => setForm((f) => ({ ...f, iban_or_account: e.target.value }))}
            className={`${glass} flex-1 font-mono ${!form.iban_or_account?.trim() ? 'border-white/10' : 'border-white/20'}`}
          />
          {form.iban_or_account?.trim() && (
            <button
              type="button"
              onClick={() => copyFormField(form.iban_or_account, 'iban')}
              className="rounded border border-white/20 bg-white/5 px-2 py-1 text-xs text-white/70 hover:bg-white/10"
            >
              {formCopiedId === 'iban' ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-white/50">Full IBAN or account number for bank/Revolut/Wise.</p>
      </div>
      {showRevtagField(form.payout_method) && (
        <div>
          <label className="block text-xs font-medium text-white/60 mb-1">Revtag</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={form.revtag}
              onChange={(e) => setForm((f) => ({ ...f, revtag: e.target.value }))}
              className={`${glass} flex-1 font-mono placeholder:text-white/30 ${!form.revtag?.trim() ? 'border-amber-500/30' : 'border-white/20'}`}
              placeholder="@username"
            />
            {form.revtag?.trim() && (
              <button
                type="button"
                onClick={() => copyFormField(form.revtag, 'revtag')}
                className="rounded border border-white/20 bg-white/5 px-2 py-1 text-xs text-white/70 hover:bg-white/10"
              >
                {formCopiedId === 'revtag' ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-white/50">Required for Revolut/Wise payouts.</p>
        </div>
      )}
      <div>
        <label className="block text-xs font-medium text-white/60 mb-1">Status</label>
        <SmartSelect
          value={form.status || 'active'}
          onValueChange={(v) => setForm((f) => ({ ...f, status: v ?? 'active' }))}
          options={[
            { value: 'active', label: 'active' },
            { value: 'inactive', label: 'inactive' },
            { value: 'pending', label: 'pending' },
          ]}
          placeholder="Status"
          allowClear={false}
          className="w-full"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-white/60 mb-1">Notes (optional)</label>
        <textarea
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          rows={2}
          className={`${glass} w-full resize-y`}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-white/80">
        <input
          type="checkbox"
          checked={form.is_default}
          onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))}
          className="rounded border-white/20"
        />
        Default for this member
      </label>
      <div className="flex gap-2 pt-2">
        <button
          type="button"
          disabled={saveBusy}
          onClick={onSave}
          className="rounded-xl bg-[var(--purple-500)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--purple-600)] disabled:opacity-50"
        >
          {saveBusy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/15">
          Cancel
        </button>
      </div>
    </div>
  );
}

function PaymentsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [months, setMonths] = useState<MonthOption[]>([]);
  const [selectedMonthId, setSelectedMonthId] = useState('');
  const [teamMembers, setTeamMembers] = useState<TeamMemberOption[]>([]);
  const [basisRows, setBasisRows] = useState<BasisRow[]>([]);
  type NonChatterGroup = { bonuses: BasisRow[]; fines: BasisRow[]; totals: { totalBonusEur: number; totalFinesEur: number; netEur: number } };
  const [nonChatterByRole, setNonChatterByRole] = useState<{ managers: NonChatterGroup; vas: NonChatterGroup; models: NonChatterGroup; affiliates: NonChatterGroup }>({
    managers: { bonuses: [], fines: [], totals: { totalBonusEur: 0, totalFinesEur: 0, netEur: 0 } },
    vas: { bonuses: [], fines: [], totals: { totalBonusEur: 0, totalFinesEur: 0, netEur: 0 } },
    models: { bonuses: [], fines: [], totals: { totalBonusEur: 0, totalFinesEur: 0, netEur: 0 } },
    affiliates: { bonuses: [], fines: [], totals: { totalBonusEur: 0, totalFinesEur: 0, netEur: 0 } },
  });
  const [nonChatterTab, setNonChatterTab] = useState<'managers' | 'vas' | 'models' | 'affiliates'>('managers');
  const [nonChatterByRoleLoading, setNonChatterByRoleLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [basisLoading, setBasisLoading] = useState(false);
  const [error, setError] = useState<{ message: string; requestId: string | null } | null>(null);

  const { rate: fxRate, asOf: fxAsOf, refresh: fxRefresh } = useFxRate();

  const [salesModalOpen, setSalesModalOpen] = useState(false);
  const [bonusModalOpen, setBonusModalOpen] = useState(false);
  const [fineModalOpen, setFineModalOpen] = useState(false);
  const [hourlyModalOpen, setHourlyModalOpen] = useState(false);
  const [hourlyForm, setHourlyForm] = useState({ team_member_id: '', hours_worked: '', hourly_rate_eur: '' });
  const [salesForm, setSalesForm] = useState({ memberId: '', grossUsd: '', payoutPct: '', notes: '' });
  const [bonusForm, setBonusForm] = useState({ memberId: '', amountEur: '', reason: '', notes: '' });
  const [fineForm, setFineForm] = useState({ memberId: '', amountEur: '', reason: '' });
  const [salesBusy, setSalesBusy] = useState(false);
  const [bonusBusy, setBonusBusy] = useState(false);
  const [fineBusy, setFineBusy] = useState(false);
  const [hourlySaveBusy, setHourlySaveBusy] = useState(false);
  const [hourlySaveToast, setHourlySaveToast] = useState(false);
  const [refreshPreviewTrigger, setRefreshPreviewTrigger] = useState(0);
  const [editBasisRow, setEditBasisRow] = useState<BasisRow | null>(null);
  const [editAmountUsd, setEditAmountUsd] = useState<number | undefined>(undefined);
  const [editNotes, setEditNotes] = useState('');
  const [editPayoutPct, setEditPayoutPct] = useState<string>('');
  const [editReason, setEditReason] = useState('');
  const [editBusy, setEditBusy] = useState(false);

  // Agency revenue (monthly): one record per month; view / create / edit modes
  type AgencyRevenueMode = 'view' | 'create' | 'edit';
  const [agencyRevenueMode, setAgencyRevenueMode] = useState<AgencyRevenueMode>('create');
  const [agencyRevenueSnapshot, setAgencyRevenueSnapshot] = useState<{
    id: string;
    chatting_amount_usd: number | null;
    chatting_amount_eur: number | null;
    gunzo_amount_usd: number | null;
    gunzo_amount_eur: number | null;
    chatting_msgs_tips_net_usd: number | null;
    chatting_msgs_tips_net_eur: number | null;
    gunzo_msgs_tips_net_usd: number | null;
    gunzo_msgs_tips_net_eur: number | null;
  } | null>(null);
  const [agencyChattingUsd, setAgencyChattingUsd] = useState<number | undefined>(undefined);
  const [agencyChattingEur, setAgencyChattingEur] = useState<number | undefined>(undefined);
  const [agencyGunzoUsd, setAgencyGunzoUsd] = useState<number | undefined>(undefined);
  const [agencyGunzoEur, setAgencyGunzoEur] = useState<number | undefined>(undefined);
  const [agencyChattingMsgsTipsUsd, setAgencyChattingMsgsTipsUsd] = useState<number | undefined>(undefined);
  const [agencyChattingMsgsTipsEur, setAgencyChattingMsgsTipsEur] = useState<number | undefined>(undefined);
  const [agencyGunzoMsgsTipsUsd, setAgencyGunzoMsgsTipsUsd] = useState<number | undefined>(undefined);
  const [agencyGunzoMsgsTipsEur, setAgencyGunzoMsgsTipsEur] = useState<number | undefined>(undefined);
  const [agencyRevenueLoading, setAgencyRevenueLoading] = useState(false);
  const [agencyRevenueSaving, setAgencyRevenueSaving] = useState(false);


  const [payoutRun, setPayoutRun] = useState<{ run: PayoutRunRow; lines: PayoutLineRow[] } | null>(null);
  const [payoutRuns, setPayoutRuns] = useState<PayoutRunRow[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [runDetail, setRunDetail] = useState<{ run: PayoutRunRow; lines: PayoutLineRow[] } | null>(null);
  const [runDetailLoading, setRunDetailLoading] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [paymentMethodsByTeamMemberId, setPaymentMethodsByTeamMemberId] = useState<PaymentMethodsByTeamMemberId>({});
  const [paymentMethodsByModelId, setPaymentMethodsByModelId] = useState<PaymentMethodsByModelId>({});
  /** Expanded payout tab row (View payment methods) — row.id */
  const [expandedPayoutRowId, setExpandedPayoutRowId] = useState<string | null>(null);
  /** Row whose inline breakdown section is expanded — row.id */
  const [expandedBreakdownRowId, setExpandedBreakdownRowId] = useState<string | null>(null);
  const [managePaymentFor, setManagePaymentFor] = useState<{ memberId: string; memberName: string } | null>(null);
  const [paymentMethodEditId, setPaymentMethodEditId] = useState<string | null>(null);
  const [paymentMethodForm, setPaymentMethodForm] = useState<{
    method_label: string;
    payout_method: string;
    beneficiary_name: string;
    iban_or_account: string;
    revtag: string;
    status: string;
    notes: string;
    is_default: boolean;
  }>({ method_label: 'primary', payout_method: '', beneficiary_name: '', iban_or_account: '', revtag: '', status: 'active', notes: '', is_default: false });
  const [paymentMethodSaveBusy, setPaymentMethodSaveBusy] = useState(false);
  const [refreshRunDetailTrigger, setRefreshRunDetailTrigger] = useState(0);
  const [savePayoutsBusy, setSavePayoutsBusy] = useState(false);
  const [deleteRunConfirmRunId, setDeleteRunConfirmRunId] = useState<string | null>(null);
  const [deleteRunBusy, setDeleteRunBusy] = useState(false);
  const [deleteRunError, setDeleteRunError] = useState<string | null>(null);
  const [paymentsToast, setPaymentsToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [paidToggleBusy, setPaidToggleBusy] = useState<string | null>(null);
  const [previewLines, setPreviewLines] = useState<PayoutLineRow[]>([]);
  const [previewByTab, setPreviewByTab] = useState<Record<PayoutTabId, PayoutLineRow[]>>({
    chatters: [], managers: [], vas: [], models: [], affiliates: [],
  });
  const [previewDebug, setPreviewDebug] = useState<{ affiliateDealsCount: number; matchedModelsCount: number; affiliatePayoutTotalUsd: number } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [payoutViewMode, setPayoutViewMode] = useState<'preview' | 'saved'>('preview');
  const [activePayoutTab, setActivePayoutTab] = useState<PayoutTabId>('chatters');
  const debugMode = searchParams.get('debug') === '1';

  const activeRunIdRef = useRef<string | null>(null);
  const runCacheRef = useRef<Map<string, { run: PayoutRunRow; lines: PayoutLineRow[] }>>(new Map());
  const detailReq = useRef(0);
  const pendingRestoreRunIdRef = useRef<string>('');
  const selectedRunIdRef = useRef<string>('');
  selectedRunIdRef.current = selectedRunId;

  const selectedMonth = months.find((m) => m.id === selectedMonthId);

  const loadMonths = useCallback(() => {
    apiFetch<MonthOption[]>('/api/months')
      .then(({ ok, data: list }) => {
        const arr = ok && Array.isArray(list) ? list : [];
        const sorted = [...arr].sort((a, b) => (b.month_key ?? '').localeCompare(a.month_key ?? ''));
        setMonths(sorted);
        if (sorted.length > 0 && !selectedMonthId) {
          const fromUrl = searchParams.get('month_id')?.trim();
          const monthId =
            fromUrl && sorted.some((m) => m.id === fromUrl)
              ? fromUrl
              : (pickDefaultMonthId(sorted, getCurrentMonthKey()) ?? sorted[0]?.id ?? '');
          setSelectedMonthId(monthId);
        }
      })
      .catch(() => setMonths([]));
  }, [selectedMonthId, searchParams]);

  const loadTeamMembers = useCallback(() => {
    apiFetch<{ id: string; name: string; department: string; role: string; status?: string; payout_percentage?: number }[]>('/api/team-members')
      .then(({ ok, data: list }) => {
        const arr = ok && Array.isArray(list) ? list : [];
        setTeamMembers(arr.map((m) => ({
          id: m.id,
          name: m.name ?? m.id,
          department: m.department ?? '',
          role: m.role ?? '',
          status: m.status,
          payout_percentage: m.payout_percentage,
        })));
      })
      .catch(() => setTeamMembers([]));
  }, []);

  useEffect(() => {
    loadMonths();
    loadTeamMembers();
  }, [loadMonths, loadTeamMembers]);

  /** Basis (chatter sales, bonuses, fines) is input data from monthly_member_basis. Does NOT depend on payout_run or payout_lines. */
  const loadBasis = useCallback(() => {
    if (!selectedMonthId) {
      setBasisRows([]);
      setBasisLoading(false);
      return;
    }
    setBasisLoading(true);
    const selectedMonth = months.find((m) => m.id === selectedMonthId);
    const monthKey = selectedMonth?.month_key;
    const query = monthKey ? `month_key=${encodeURIComponent(monthKey)}` : `month_id=${encodeURIComponent(selectedMonthId)}`;
    apiFetch<BasisRow[]>(`/api/monthly-basis?${query}`)
      .then(({ ok, data: list }) => {
        const arr = ok && Array.isArray(list) ? list : [];
        setBasisRows(arr);
      })
      .catch(() => setBasisRows([]))
      .finally(() => setBasisLoading(false));
  }, [selectedMonthId, months]);

  /** Non-chatter bonus/fine entries grouped by role (managers, vas, models, affiliates). Same source as basis; filtered by team_members.role in API. */
  const loadNonChatterByRole = useCallback(() => {
    const empty = { bonuses: [] as BasisRow[], fines: [] as BasisRow[], totals: { totalBonusEur: 0, totalFinesEur: 0, netEur: 0 } };
    if (!selectedMonthId) {
      setNonChatterByRole({
        managers: empty,
        vas: empty,
        models: empty,
        affiliates: empty,
      });
      setNonChatterByRoleLoading(false);
      return;
    }
    setNonChatterByRoleLoading(true);
    const selectedMonth = months.find((m) => m.id === selectedMonthId);
    const monthKey = selectedMonth?.month_key;
    const params = new URLSearchParams();
    params.set('month_id', selectedMonthId);
    if (monthKey) params.set('month_key', monthKey);
    apiFetch<{ ok?: boolean; groups?: { managers: NonChatterGroup; vas: NonChatterGroup; models: NonChatterGroup; affiliates: NonChatterGroup } }>(`/api/monthly-basis/by-role?${params.toString()}`)
      .then(({ ok, data }) => {
        const fallback = { managers: empty, vas: empty, models: empty, affiliates: empty };
        if (ok && data?.groups) {
          setNonChatterByRole({
            managers: data.groups.managers ?? empty,
            vas: data.groups.vas ?? empty,
            models: data.groups.models ?? empty,
            affiliates: data.groups.affiliates ?? empty,
          });
        } else {
          setNonChatterByRole(fallback);
        }
      })
      .catch(() =>
        setNonChatterByRole({
          managers: empty,
          vas: empty,
          models: empty,
          affiliates: empty,
        })
      )
      .finally(() => setNonChatterByRoleLoading(false));
  }, [selectedMonthId, months]);

  const loadAgencyRevenue = useCallback(() => {
    if (!selectedMonthId) {
      setAgencyChattingUsd(undefined);
      setAgencyChattingEur(undefined);
      setAgencyGunzoUsd(undefined);
      setAgencyGunzoEur(undefined);
      setAgencyChattingMsgsTipsUsd(undefined);
      setAgencyChattingMsgsTipsEur(undefined);
      setAgencyGunzoMsgsTipsUsd(undefined);
      setAgencyGunzoMsgsTipsEur(undefined);
      setAgencyRevenueSnapshot(null);
      setAgencyRevenueMode('create');
      setAgencyRevenueLoading(false);
      return;
    }
    setAgencyRevenueLoading(true);
    apiFetch<{
      ok: boolean;
      exists: boolean;
      recordId?: string;
      month_id: string;
      month_key: string;
      chatting_amount_usd: number | null;
      chatting_amount_eur: number | null;
      gunzo_amount_usd: number | null;
      gunzo_amount_eur: number | null;
      chatting_msgs_tips_net_usd: number | null;
      chatting_msgs_tips_net_eur: number | null;
      gunzo_msgs_tips_net_usd: number | null;
      gunzo_msgs_tips_net_eur: number | null;
      notes?: string | null;
    }>(`/api/agency-revenue?month_id=${encodeURIComponent(selectedMonthId)}`)
      .then(({ ok, data }) => {
        if (ok && data) {
          const hasRecord = Boolean(data.exists);
          setAgencyRevenueSnapshot(
            hasRecord && data.recordId
              ? {
                  id: data.recordId,
                  chatting_amount_usd: data.chatting_amount_usd,
                  chatting_amount_eur: data.chatting_amount_eur,
                  gunzo_amount_usd: data.gunzo_amount_usd,
                  gunzo_amount_eur: data.gunzo_amount_eur,
                  chatting_msgs_tips_net_usd: data.chatting_msgs_tips_net_usd,
                  chatting_msgs_tips_net_eur: data.chatting_msgs_tips_net_eur,
                  gunzo_msgs_tips_net_usd: data.gunzo_msgs_tips_net_usd,
                  gunzo_msgs_tips_net_eur: data.gunzo_msgs_tips_net_eur,
                }
              : null
          );
          setAgencyChattingUsd(data.chatting_amount_usd != null ? data.chatting_amount_usd : undefined);
          setAgencyChattingEur(data.chatting_amount_eur != null ? data.chatting_amount_eur : undefined);
          setAgencyGunzoUsd(data.gunzo_amount_usd != null ? data.gunzo_amount_usd : undefined);
          setAgencyGunzoEur(data.gunzo_amount_eur != null ? data.gunzo_amount_eur : undefined);
          setAgencyChattingMsgsTipsUsd(data.chatting_msgs_tips_net_usd != null ? data.chatting_msgs_tips_net_usd : undefined);
          setAgencyChattingMsgsTipsEur(data.chatting_msgs_tips_net_eur != null ? data.chatting_msgs_tips_net_eur : undefined);
          setAgencyGunzoMsgsTipsUsd(data.gunzo_msgs_tips_net_usd != null ? data.gunzo_msgs_tips_net_usd : undefined);
          setAgencyGunzoMsgsTipsEur(data.gunzo_msgs_tips_net_eur != null ? data.gunzo_msgs_tips_net_eur : undefined);
          setAgencyRevenueMode(hasRecord ? 'view' : 'create');
        } else {
          setAgencyChattingUsd(undefined);
          setAgencyChattingEur(undefined);
          setAgencyGunzoUsd(undefined);
          setAgencyGunzoEur(undefined);
          setAgencyChattingMsgsTipsUsd(undefined);
          setAgencyChattingMsgsTipsEur(undefined);
          setAgencyGunzoMsgsTipsUsd(undefined);
          setAgencyGunzoMsgsTipsEur(undefined);
          setAgencyRevenueSnapshot(null);
          setAgencyRevenueMode('create');
        }
      })
      .catch(() => {
        setAgencyChattingUsd(undefined);
        setAgencyChattingEur(undefined);
        setAgencyGunzoUsd(undefined);
        setAgencyGunzoEur(undefined);
        setAgencyChattingMsgsTipsUsd(undefined);
        setAgencyChattingMsgsTipsEur(undefined);
        setAgencyGunzoMsgsTipsUsd(undefined);
        setAgencyGunzoMsgsTipsEur(undefined);
        setAgencyRevenueSnapshot(null);
        setAgencyRevenueMode('create');
      })
      .finally(() => setAgencyRevenueLoading(false));
  }, [selectedMonthId]);

  const saveAgencyRevenue = useCallback(
    (
      chattingUsd: number,
      chattingEur: number,
      gunzoUsd: number,
      gunzoEur: number,
      chattingMsgsTipsUsd: number,
      chattingMsgsTipsEur: number,
      gunzoMsgsTipsUsd: number,
      gunzoMsgsTipsEur: number
    ) => {
      if (!selectedMonthId) return;
      setAgencyRevenueSaving(true);
      apiFetch<{
        id: string;
        month_id: string;
        chatting_amount_usd: number | null;
        chatting_amount_eur: number | null;
        gunzo_amount_usd: number | null;
        gunzo_amount_eur: number | null;
        chatting_msgs_tips_net_usd: number | null;
        chatting_msgs_tips_net_eur: number | null;
        gunzo_msgs_tips_net_usd: number | null;
        gunzo_msgs_tips_net_eur: number | null;
      }>(`/api/agency-revenue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month_id: selectedMonthId,
          chatting_amount_usd: chattingUsd,
          chatting_amount_eur: chattingEur,
          gunzo_amount_usd: gunzoUsd,
          gunzo_amount_eur: gunzoEur,
          chatting_msgs_tips_net_usd: chattingMsgsTipsUsd,
          chatting_msgs_tips_net_eur: chattingMsgsTipsEur,
          gunzo_msgs_tips_net_usd: gunzoMsgsTipsUsd,
          gunzo_msgs_tips_net_eur: gunzoMsgsTipsEur,
        }),
      })
        .then(({ ok }) => {
          if (ok) {
            loadAgencyRevenue();
          }
        })
        .finally(() => setAgencyRevenueSaving(false));
    },
    [selectedMonthId, loadAgencyRevenue]
  );

  const canSaveAgencyRevenue =
    (agencyChattingUsd ?? 0) > 0 ||
    (agencyChattingEur ?? 0) > 0 ||
    (agencyGunzoUsd ?? 0) > 0 ||
    (agencyGunzoEur ?? 0) > 0 ||
    (agencyChattingMsgsTipsUsd ?? 0) > 0 ||
    (agencyChattingMsgsTipsEur ?? 0) > 0 ||
    (agencyGunzoMsgsTipsUsd ?? 0) > 0 ||
    (agencyGunzoMsgsTipsEur ?? 0) > 0;

  const handleCancelAgencyRevenue = () => {
    if (agencyRevenueSnapshot) {
      setAgencyChattingUsd(agencyRevenueSnapshot.chatting_amount_usd != null ? agencyRevenueSnapshot.chatting_amount_usd : undefined);
      setAgencyChattingEur(agencyRevenueSnapshot.chatting_amount_eur != null ? agencyRevenueSnapshot.chatting_amount_eur : undefined);
      setAgencyGunzoUsd(agencyRevenueSnapshot.gunzo_amount_usd != null ? agencyRevenueSnapshot.gunzo_amount_usd : undefined);
      setAgencyGunzoEur(agencyRevenueSnapshot.gunzo_amount_eur != null ? agencyRevenueSnapshot.gunzo_amount_eur : undefined);
      setAgencyChattingMsgsTipsUsd(agencyRevenueSnapshot.chatting_msgs_tips_net_usd != null ? agencyRevenueSnapshot.chatting_msgs_tips_net_usd : undefined);
      setAgencyChattingMsgsTipsEur(agencyRevenueSnapshot.chatting_msgs_tips_net_eur != null ? agencyRevenueSnapshot.chatting_msgs_tips_net_eur : undefined);
      setAgencyGunzoMsgsTipsUsd(agencyRevenueSnapshot.gunzo_msgs_tips_net_usd != null ? agencyRevenueSnapshot.gunzo_msgs_tips_net_usd : undefined);
      setAgencyGunzoMsgsTipsEur(agencyRevenueSnapshot.gunzo_msgs_tips_net_eur != null ? agencyRevenueSnapshot.gunzo_msgs_tips_net_eur : undefined);
    }
    setAgencyRevenueMode('view');
  };

  const loadPayoutRuns = useCallback((keepSelectedRunId?: boolean): Promise<PayoutRunRow[] | undefined> | void => {
    if (!selectedMonthId) return;
    return apiFetch<{ ok?: boolean; requestId?: string; sample?: PayoutRunRow[] }>(`/api/payout-runs?month_id=${encodeURIComponent(selectedMonthId)}`)
      .then(({ ok, data }) => {
        const runs = ok && Array.isArray(data?.sample) ? data.sample : [];
        setPayoutRuns(runs);
        if (keepSelectedRunId && selectedRunIdRef.current) return runs;
        if (!selectedRunIdRef.current && runs.length > 0) {
          const saved = pendingRestoreRunIdRef.current || '';
          setSelectedRunId(saved && runs.some((r) => r.id === saved) ? saved : runs[0].id);
        } else if (runs.length === 0) {
          setSelectedRunId('');
        }
        return runs;
      })
      .catch(() => {
        if (selectedMonthId) setPayoutRuns([]);
        return [];
      });
  }, [selectedMonthId]);

  useEffect(() => {
    if (!selectedMonthId) return;
    pendingRestoreRunIdRef.current = typeof window !== 'undefined' ? (localStorage.getItem(`${PAYMENTS_STORAGE_KEY}:${selectedMonthId}`) || '') : '';
    loadBasis();
    loadNonChatterByRole();
    loadAgencyRevenue();
    loadPayoutRuns(true);
  }, [selectedMonthId, loadBasis, loadNonChatterByRole, loadAgencyRevenue, loadPayoutRuns]);

  useEffect(() => {
    if (!payoutRuns.length || !selectedRunId) return;
    const inList = payoutRuns.some((r) => r.id === selectedRunId);
    if (!inList) setSelectedRunId('');
  }, [payoutRuns, selectedRunId]);

  useEffect(() => {
    if (!selectedMonthId) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('month_id', selectedMonthId);
    if (selectedRunId) params.set('run_id', selectedRunId);
    else params.delete('run_id');
    const qs = params.toString();
    const path = qs ? `/payments?${qs}` : '/payments';
    router.replace(path, { scroll: false });
    if (selectedRunId && typeof window !== 'undefined') {
      localStorage.setItem(`${PAYMENTS_STORAGE_KEY}:${selectedMonthId}`, selectedRunId);
    }
  }, [selectedMonthId, selectedRunId, router, searchParams]);

  useEffect(() => {
    if (payoutViewMode === 'saved' && payoutRuns.length > 0 && !selectedRunId) {
      setSelectedRunId(payoutRuns[0].id);
    }
  }, [payoutViewMode, payoutRuns, selectedRunId]);

  useEffect(() => {
    if (!paymentsToast) return;
    const t = setTimeout(() => setPaymentsToast(null), 4000);
    return () => clearTimeout(t);
  }, [paymentsToast]);

  useEffect(() => {
    if (!selectedRunId) {
      setRunDetailLoading(false);
      return;
    }

    const runIdForRequest = selectedRunId;
    const cached = runCacheRef.current.get(runIdForRequest);
    if (cached) setRunDetail(cached);

    const req = ++detailReq.current;
    setRunDetailLoading(true);

    (async () => {
      try {
        const res = await apiFetch<{ ok?: boolean; requestId?: string; computed_from?: string; sample?: { run?: PayoutRunRow; lines?: PayoutLineRow[] } }>(
          `/api/payouts?source=saved&run_id=${encodeURIComponent(selectedRunId)}`
        );
        if (req !== detailReq.current) return;

        const sample = res?.data?.sample;
        const run = sample?.run ?? null;
        const lines = Array.isArray(sample?.lines) ? sample.lines : null;

        if (!run || run.id !== selectedRunId) return;

        setRunDetail((prev) => {
          const prevLinesLen = Array.isArray(prev?.lines) ? prev.lines.length : 0;
          const nextLinesLen = Array.isArray(lines) ? lines.length : 0;
          if (nextLinesLen === 0 && prevLinesLen > 0) return prev;
          const payload = { run, lines: Array.isArray(lines) ? lines : [] };
          runCacheRef.current.set(runIdForRequest, payload);
          return payload;
        });
      } catch {
        // ignore
      } finally {
        if (req === detailReq.current) setRunDetailLoading(false);
      }
    })();
  }, [selectedRunId, refreshRunDetailTrigger]);

  useEffect(() => {
    if (!selectedMonthId) {
      setPreviewLines([]);
      setPreviewByTab({ chatters: [], managers: [], vas: [], models: [], affiliates: [] });
      setPreviewDebug(null);
      return;
    }
    setPreviewLoading(true);
    const debugQ = debugMode ? '&debug=1' : '';
    apiFetch<{ ok?: boolean; computed_from?: string; lines?: PayoutLineRow[]; byTab?: Record<PayoutTabId, PayoutLineRow[]>; fx_rate?: number; debug?: { affiliateDealsCount: number; matchedModelsCount: number; affiliatePayoutTotalUsd: number } }>(
      `/api/payouts?source=live&month_id=${encodeURIComponent(selectedMonthId)}${debugQ}`
    )
      .then(({ ok, data }) => {
        if (ok && (data?.computed_from === 'live') && Array.isArray(data?.lines)) {
          setPreviewLines(data.lines);
          setPreviewByTab(
            data?.byTab ?? { chatters: [], managers: [], vas: [], models: [], affiliates: [] }
          );
          setPreviewDebug(debugMode && data?.debug ? data.debug : null);
        } else {
          setPreviewLines([]);
          setPreviewByTab({ chatters: [], managers: [], vas: [], models: [], affiliates: [] });
          setPreviewDebug(null);
        }
      })
      .catch(() => {
        setPreviewLines([]);
        setPreviewByTab({ chatters: [], managers: [], vas: [], models: [], affiliates: [] });
        setPreviewDebug(null);
      })
      .finally(() => setPreviewLoading(false));
  }, [selectedMonthId, refreshPreviewTrigger, debugMode]);


  /** Chatter sales: input data from monthly_member_basis only. Used for the basis input table and add-sales flow only. Payouts preview table uses API response (previewByTab) only. */
  const salesRows = basisRows.filter((r) => String(r.basis_type).trim() === 'chatter_sales');
  const bonusRows = basisRows.filter((r) => String(r.basis_type).trim() === 'bonus');
  const fineRows = basisRows.filter(isFineRow);
  const memberNameById = Object.fromEntries(teamMembers.map((m) => [m.id, m.name]));
  const monthKeyById = Object.fromEntries(months.map((m) => [m.id, m.month_key ?? m.id]));
  const monthDisplay = (row: BasisRow) => row.month_key ?? monthKeyById[row.month_id] ?? row.month_id;
  const memberDisplay = (row: BasisRow) => memberNameById[row.team_member_id] ?? (row.team_member_numeric_id != null ? String(row.team_member_numeric_id) : row.team_member_id);

  const handleSubmitSales = () => {
    if (!selectedMonthId || !salesForm.memberId) return;
    const grossUsd = parseFloat(salesForm.grossUsd);
    if (!Number.isFinite(grossUsd) || grossUsd < 0) return;
    const payoutPct = salesForm.payoutPct.trim() ? parseFloat(salesForm.payoutPct) : undefined;
    if (payoutPct !== undefined && (!Number.isFinite(payoutPct) || payoutPct < 0 || payoutPct > 100)) return;
    setSalesBusy(true);
    const monthKey = months.find((m) => m.id === selectedMonthId)?.month_key;
    apiFetch<BasisRow>('/api/monthly-basis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        month_id: selectedMonthId,
        ...(monthKey ? { month_key: monthKey } : {}),
        team_member_id: salesForm.memberId,
        basis_type: 'chatter_sales',
        gross_usd: grossUsd,
        payout_pct: payoutPct,
        notes: salesForm.notes.trim() || undefined,
      }),
    })
      .then(({ ok }) => {
        if (ok) {
          loadBasis();
          setSalesModalOpen(false);
          setSalesForm({ memberId: '', grossUsd: '', payoutPct: '', notes: '' });
        }
      })
      .finally(() => setSalesBusy(false));
  };

  const handleSubmitBonus = () => {
    if (!selectedMonthId || !bonusForm.memberId) return;
    const amountEur = parseFloat(bonusForm.amountEur);
    if (!Number.isFinite(amountEur) || amountEur < 0) return;
    if (!bonusForm.reason.trim()) return;
    setBonusBusy(true);
    const monthKey = months.find((m) => m.id === selectedMonthId)?.month_key;
    apiFetch<BasisRow>('/api/monthly-basis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        month_id: selectedMonthId,
        ...(monthKey ? { month_key: monthKey } : {}),
        team_member_id: bonusForm.memberId,
        basis_type: 'bonus',
        amount_eur: amountEur,
        reason: bonusForm.reason.trim(),
        notes: bonusForm.notes.trim() || undefined,
      }),
    })
      .then(({ ok }) => {
        if (ok) {
          loadBasis();
          loadNonChatterByRole();
          setBonusModalOpen(false);
          setBonusForm({ memberId: '', amountEur: '', reason: '', notes: '' });
        }
      })
      .finally(() => setBonusBusy(false));
  };

  const handleSubmitFine = () => {
    if (!selectedMonthId || !fineForm.memberId) return;
    const amountEur = parseFloat(fineForm.amountEur);
    if (!Number.isFinite(amountEur) || amountEur < 0) return;
    if (!fineForm.reason.trim()) return;
    setFineBusy(true);
    const monthKey = months.find((m) => m.id === selectedMonthId)?.month_key;
    apiFetch<BasisRow>('/api/monthly-basis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        month_id: selectedMonthId,
        ...(monthKey ? { month_key: monthKey } : {}),
        team_member_id: fineForm.memberId,
        basis_type: 'fine',
        amount_eur: amountEur,
        reason: fineForm.reason.trim(),
      }),
    })
      .then(({ ok }) => {
        if (ok) {
          loadBasis();
          loadNonChatterByRole();
          setFineModalOpen(false);
          setFineForm({ memberId: '', amountEur: '', reason: '' });
        }
      })
      .finally(() => setFineBusy(false));
  };

  const handleSaveEdit = () => {
    if (!editBasisRow) return;
    const isSales = editBasisRow.basis_type === 'chatter_sales';
    const isBonus = editBasisRow.basis_type === 'bonus';
    const isFine = isFineRow(editBasisRow);
    const payload: { amount_usd?: number; amount_eur?: number; notes?: string; payout_pct?: number } = {};
    if (isSales) {
      const usd = editAmountUsd;
      if (typeof usd === 'number' && !Number.isNaN(usd) && usd >= 0) payload.amount_usd = usd;
      const pct = editPayoutPct.trim() ? parseFloat(editPayoutPct) : undefined;
      if (pct !== undefined && Number.isFinite(pct) && pct >= 0 && pct <= 100) payload.payout_pct = pct;
      payload.notes = editNotes.trim() || undefined;
    } else if (isBonus) {
      const eur = editAmountUsd;
      if (typeof eur === 'number' && !Number.isNaN(eur) && eur >= 0) payload.amount_eur = eur;
      payload.notes = (editReason.trim() || editNotes.trim()) || undefined;
    } else if (isFine) {
      const eur = editAmountUsd;
      if (typeof eur === 'number' && !Number.isNaN(eur) && eur >= 0) payload.amount_eur = eur;
      payload.notes = editReason.trim() ? `FINE: ${editReason.trim()}` : undefined;
    }
    if (Object.keys(payload).length === 0) {
      setEditBasisRow(null);
      return;
    }
    setEditBusy(true);
    apiFetch(`/api/monthly-basis/${editBasisRow.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(({ ok }) => {
        if (ok) {
          loadBasis();
          loadNonChatterByRole();
          setEditBasisRow(null);
        }
      })
      .finally(() => setEditBusy(false));
  };

  const handleDelete = (id: string) => {
    if (!confirm('Delete this entry?')) return;
    apiFetch(`/api/monthly-basis/${id}`, { method: 'DELETE' }).then(({ ok }) => {
      if (ok) {
        loadBasis();
        loadNonChatterByRole();
      }
    });
  };

  const openEdit = (row: BasisRow) => {
    setEditBasisRow(row);
    const amountForEdit = isFineRow(row)
      ? Math.abs(typeof row.amount_eur === 'number' ? row.amount_eur : row.amount ?? 0)
      : (row.amount_usd ?? row.amount);
    setEditAmountUsd(amountForEdit);
    setEditNotes(row.notes?.replace(/^PCT:[\d.]+\n?/i, '').trim() ?? '');
    setEditPayoutPct(row.basis_type === 'chatter_sales' && row.payout_pct != null ? String(row.payout_pct) : '');
    setEditReason(row.basis_type === 'bonus' ? (row.notes ?? '') : isFineRow(row) ? fineReasonFromNotes(row.notes ?? '') : '');
  };

  const summaryByMemberMonth = (() => {
    const map = new Map<string, {
      month_id: string;
      month_key?: string;
      member_id: string;
      gross_usd: number;
      payout_pct: number;
      base_payout_usd: number;
      bonus_total_eur: number;
      fine_total_eur: number;
      final_payout_usd: number;
      final_payout_eur: number;
    }>();
    for (const r of basisRows) {
      const key = `${r.month_key ?? r.month_id}:${r.team_member_id || (r.team_member_numeric_id != null ? String(r.team_member_numeric_id) : '')}`;
      const basisType = String(r.basis_type).trim();
      if (!map.has(key)) {
        const member = teamMembers.find((m) => m.id === r.team_member_id);
        const pct = basisType === 'chatter_sales' ? (r.payout_pct ?? member?.payout_percentage ?? 0) : 0;
        const gross = basisType === 'chatter_sales' ? (r.amount_usd ?? r.amount ?? 0) : 0;
        map.set(key, {
          month_id: r.month_id,
          month_key: r.month_key,
          member_id: r.team_member_id || (r.team_member_numeric_id != null ? String(r.team_member_numeric_id) : ''),
          gross_usd: gross,
          payout_pct: pct,
          base_payout_usd: (gross * pct) / 100,
          bonus_total_eur: 0,
          fine_total_eur: 0,
          final_payout_usd: 0,
          final_payout_eur: 0,
        });
      }
      const row = map.get(key)!;
      if (basisType === 'chatter_sales') {
        const pct = r.payout_pct ?? teamMembers.find((m) => m.id === r.team_member_id)?.payout_percentage ?? 0;
        const gross = r.amount_usd ?? r.amount ?? 0;
        row.gross_usd = gross;
        row.payout_pct = pct;
        row.base_payout_usd = (gross * pct) / 100;
      } else if (basisType === 'bonus') {
        const amountEur = typeof r.amount_eur === 'number' ? r.amount_eur : (r.amount ?? 0);
        row.bonus_total_eur += amountEur;
      } else if (isFineRow(r)) {
        const amountEur = typeof r.amount_eur === 'number' ? r.amount_eur : (r.amount ?? 0);
        row.fine_total_eur += amountEur;
      }
    }

    // After aggregating EUR bonuses/fines, compute final payouts. Fines are stored negative, so fine_total_eur is negative; add it (so payout is reduced).
    const fx = fxRate ?? null;
    for (const row of map.values()) {
      const rate = fx && fx > 0 ? fx : null;
      const bonusUsd = rate ? row.bonus_total_eur / rate : 0;
      const fineUsd = rate ? row.fine_total_eur / rate : 0;
      const finalUsd = row.base_payout_usd + bonusUsd + fineUsd;
      row.final_payout_usd = finalUsd;
      row.final_payout_eur = rate ? finalUsd * rate : finalUsd;
    }
    return Array.from(map.values());
  })();

  const handleStatusChange = (status: 'locked' | 'paid') => {
    if (!selectedRunId) return;
    setStatusBusy(true);
    apiFetch(`/api/payout-runs/${selectedRunId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
      .then(({ ok }) => {
        if (ok) {
          loadPayoutRuns(true);
          if (runDetail?.run?.id === selectedRunId) {
            const next = runDetail ? { ...runDetail, run: { ...runDetail.run, status } } : null;
            if (next && selectedRunId) runCacheRef.current.set(selectedRunId, next);
            setRunDetail(next);
          }
        }
      })
      .finally(() => setStatusBusy(false));
  };

  const exportCsv = () => {
    if (!runDetail?.lines?.length) return;
    const headers = ['Member', 'Role', 'Department', 'Basis (webapp)', 'Basis (manual)', 'Bonus', 'Adjustments', 'Payout', 'Currency'];
    const rows = runDetail.lines.map((l) => [
      l.team_member_name,
      l.role,
      l.department,
      l.basis_webapp_amount,
      l.basis_manual_amount,
      l.bonus_amount,
      l.adjustments_amount,
      l.payout_amount,
      l.currency,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.map((c) => (typeof c === 'string' && c.includes(',') ? `"${c}"` : c)).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payouts-${runDetail.run?.month_key ?? 'run'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const monthOptions = months.map((m) => ({ value: m.id, label: formatMonthLabel(m.month_key) || m.month_key || m.id }));
  const runOptions = payoutRuns.map((r) => ({ value: r.id, label: `${formatMonthLabel(r.month_key) || r.month_key} – ${r.status} (${r.id.slice(0, 8)})` }));

  /** When Source=Live, use preview lines as returned by API (computed from monthly_member_basis + pnl_lines + team members). No merge with client summary. */
  const mergedPreviewLines = useMemo(() => previewLines, [previewLines]);

  const mergedPreviewByTab = useMemo(() => {
    const byTab: Record<PayoutTabId, PayoutLineRow[]> = { chatters: [], managers: [], vas: [], models: [], affiliates: [] };
    for (const line of mergedPreviewLines) {
      const cat = getPayoutCategory(line.role, line.department);
      const tab: PayoutTabId = cat === 'chatter' ? 'chatters' : cat === 'manager' ? 'managers' : cat === 'va' ? 'vas' : cat === 'affiliate' ? 'affiliates' : 'models';
      byTab[tab].push(line);
    }
    return byTab;
  }, [mergedPreviewLines]);

  /** All payee team_member_ids from payouts (preview or run detail) for single payment-methods fetch. Ids trimmed so lookup matches. */
  const payoutsPayeeIds = useMemo(() => {
    const lines = payoutViewMode === 'preview' ? mergedPreviewLines : (runDetail?.lines ?? []);
    const ids = new Set<string>();
    for (const line of lines) {
      const payeeId = (line.payee_team_member_id ?? line.team_member_id)?.trim();
      if (payeeId && !payeeId.startsWith('model-')) ids.add(payeeId);
    }
    return [...ids].sort().join(',');
  }, [payoutViewMode, mergedPreviewLines, runDetail?.lines]);

  const refreshPaymentMethods = useCallback(() => {
    if (!payoutsPayeeIds) return;
    const ids = payoutsPayeeIds.split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return;
    apiFetch<Record<string, TeamMemberPaymentMethod[]>>(
      `/api/team-member-payment-methods?team_member_ids=${encodeURIComponent(ids.join(','))}`
    )
      .then(({ ok, data }) => {
        if (!ok || !data || typeof data !== 'object') {
          setPaymentMethodsByTeamMemberId({});
          setPaymentMethodsByModelId({});
          return;
        }
        const raw = data as Record<string, TeamMemberPaymentMethod[]>;
        const byTeamMember: PaymentMethodsByTeamMemberId = {};
        for (const id of ids) {
          byTeamMember[id] = Array.isArray(raw[id]) ? raw[id] : [];
        }
        setPaymentMethodsByTeamMemberId(byTeamMember);
        setPaymentMethodsByModelId({});
      })
      .catch(() => {
        setPaymentMethodsByTeamMemberId({});
        setPaymentMethodsByModelId({});
      });
  }, [payoutsPayeeIds]);

  useEffect(() => {
    if (!payoutsPayeeIds) {
      setPaymentMethodsByTeamMemberId({});
      setPaymentMethodsByModelId({});
      return;
    }
    refreshPaymentMethods();
  }, [payoutsPayeeIds, refreshPaymentMethods]);

  const isPreview = payoutViewMode === 'preview';
  const savedLinesByTab = (() => {
    const lines = runDetail?.lines ?? [];
    const cat = categoryForTab(activePayoutTab);
    return lines.filter((l) => getPayoutCategory(l.role, l.department) === cat);
  })();
  const displayLines = isPreview ? (mergedPreviewByTab[activePayoutTab] ?? []) : savedLinesByTab;
  const allLinesForTotals = isPreview ? mergedPreviewLines : (runDetail?.lines ?? []);
  const totalFromLines = (lines: PayoutLineRow[] | undefined) => {
    if (!lines?.length) return { eur: 0, usd: 0 };
    const eur = lines.reduce((s, l) => s + (l.amount_eur ?? (l.currency === 'eur' ? l.payout_amount : 0)), 0);
    const usd = lines.reduce((s, l) => s + (l.amount_usd ?? (l.currency === 'usd' ? l.payout_amount : 0)), 0);
    return { eur, usd };
  };
  const totals = totalFromLines(allLinesForTotals);

  return (
    <div className="min-h-full">
      <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6">
        <GlassCard className="card-hero rounded-2xl border border-white/10 bg-white/5 p-6 shadow-lg shadow-black/30 backdrop-blur-xl">
          <h1 className="text-2xl font-bold tracking-tight text-white/95">Payments</h1>
          <p className="mt-1.5 text-sm text-white/60">
            Agency revenue (chatting / gunzo), chatter sales, bonuses and adjustments. Managers and production are paid from total agency revenue.
          </p>
        </GlassCard>

        <Toolbar>
          <span className="text-sm font-medium text-white/70">Month</span>
          <SmartSelect
            value={selectedMonthId || null}
            onValueChange={(v) => setSelectedMonthId(v ?? '')}
            options={monthOptions}
            placeholder={monthOptions.length === 0 ? 'No months' : 'Select month'}
            searchable={monthOptions.length > 8}
            disabled={monthOptions.length === 0}
          />
        </Toolbar>

        {!selectedMonthId && (
          <EmptyState
            title="Select a month"
            description="Choose a month above to manage basis inputs and payouts."
          />
        )}

        {selectedMonthId && (
          <>
            <section className="space-y-3">
              <h2 className="text-lg font-medium text-white/90">Agency revenue (monthly)</h2>
              <p className="text-sm text-white/60">Total chatting agency and gunzo agency revenue (NET) for this month. Used for manager and production payouts.</p>
              {agencyRevenueLoading ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-center text-sm text-white/60">Loading…</div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg shadow-black/30 backdrop-blur-xl">
                  {agencyRevenueMode === 'view' && agencyRevenueSnapshot && (
                    <p className="mb-3 text-sm text-white/70"><span className="rounded bg-white/10 px-2 py-0.5 text-xs font-medium text-white/80">Saved</span> for this month.</p>
                  )}
                  <div className="flex flex-wrap items-end gap-4">
                    <div className="min-w-[260px]">
                      <MoneyInput
                        label="Chatting agency revenue"
                        valueUsd={agencyChattingUsd}
                        valueEur={agencyChattingEur}
                        onChange={({ amount_usd, amount_eur }) => {
                          setAgencyChattingUsd(amount_usd);
                          setAgencyChattingEur(amount_eur);
                        }}
                        fxRate={fxRate}
                        baseCurrency="usd"
                        asOf={fxAsOf ?? undefined}
                        onRefetch={fxRefresh}
                        lockBaseCurrency
                        disabled={agencyRevenueMode === 'view'}
                      />
                    </div>
                    <div className="min-w-[260px]">
                      <MoneyInput
                        label="Gunzo agency revenue"
                        valueUsd={agencyGunzoUsd}
                        valueEur={agencyGunzoEur}
                        onChange={({ amount_usd, amount_eur }) => {
                          setAgencyGunzoUsd(amount_usd);
                          setAgencyGunzoEur(amount_eur);
                        }}
                        fxRate={fxRate}
                        baseCurrency="usd"
                        asOf={fxAsOf ?? undefined}
                        onRefetch={fxRefresh}
                        lockBaseCurrency
                        disabled={agencyRevenueMode === 'view'}
                      />
                    </div>
                    <div className="min-w-[260px]">
                      <MoneyInput
                        label="Chatting messages+tips net"
                        valueUsd={agencyChattingMsgsTipsUsd}
                        valueEur={agencyChattingMsgsTipsEur}
                        onChange={({ amount_usd, amount_eur }) => {
                          setAgencyChattingMsgsTipsUsd(amount_usd);
                          setAgencyChattingMsgsTipsEur(amount_eur);
                        }}
                        fxRate={fxRate}
                        baseCurrency="usd"
                        asOf={fxAsOf ?? undefined}
                        onRefetch={fxRefresh}
                        lockBaseCurrency
                        disabled={agencyRevenueMode === 'view'}
                      />
                    </div>
                    <div className="min-w-[260px]">
                      <MoneyInput
                        label="Gunzo messages+tips net"
                        valueUsd={agencyGunzoMsgsTipsUsd}
                        valueEur={agencyGunzoMsgsTipsEur}
                        onChange={({ amount_usd, amount_eur }) => {
                          setAgencyGunzoMsgsTipsUsd(amount_usd);
                          setAgencyGunzoMsgsTipsEur(amount_eur);
                        }}
                        fxRate={fxRate}
                        baseCurrency="usd"
                        asOf={fxAsOf ?? undefined}
                        onRefetch={fxRefresh}
                        lockBaseCurrency
                        disabled={agencyRevenueMode === 'view'}
                      />
                    </div>
                    {agencyRevenueMode === 'view' && agencyRevenueSnapshot && (
                      <button
                        type="button"
                        onClick={() => setAgencyRevenueMode('edit')}
                        className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/15"
                      >
                        Edit
                      </button>
                    )}
                    {(agencyRevenueMode === 'create' || agencyRevenueMode === 'edit') && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            const cu = agencyChattingUsd ?? 0;
                            const ce = agencyChattingEur ?? (fxRate != null ? round2(cu * fxRate) : 0);
                            const gu = agencyGunzoUsd ?? 0;
                            const ge = agencyGunzoEur ?? (fxRate != null ? round2(gu * fxRate) : 0);
                            const cmu = agencyChattingMsgsTipsUsd ?? 0;
                            const cme = agencyChattingMsgsTipsEur ?? (fxRate != null ? round2(cmu * fxRate) : 0);
                            const gmu = agencyGunzoMsgsTipsUsd ?? 0;
                            const gme = agencyGunzoMsgsTipsEur ?? (fxRate != null ? round2(gmu * fxRate) : 0);
                            if (canSaveAgencyRevenue) saveAgencyRevenue(cu, ce, gu, ge, cmu, cme, gmu, gme);
                          }}
                          disabled={!canSaveAgencyRevenue || agencyRevenueSaving}
                          className="rounded-xl bg-[var(--purple-500)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                        >
                          {agencyRevenueSaving ? 'Saving…' : 'Save agency revenue'}
                        </button>
                        {agencyRevenueMode === 'edit' && (
                          <button
                            type="button"
                            onClick={handleCancelAgencyRevenue}
                            disabled={agencyRevenueSaving}
                            className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/15 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </section>

            <section className="space-y-3" data-input-section="chatter_sales">
              <h2 className="text-lg font-medium text-white/90">Chatter sales (monthly gross USD)</h2>
              <p className="text-sm text-white/60">Input data (no payout run required). One record per member per month. Base payout = gross_usd × payout_pct. Store USD as source of truth.</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSalesModalOpen(true)}
                  className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/15"
                >
                  + Add chatter sales
                </button>
              </div>
              {basisLoading ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-white/60">Loading…</div>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5 shadow-lg shadow-black/30 backdrop-blur-xl">
                  <TableWithEmpty<BasisRow>
                    headers={['Month', 'Member', 'Gross USD', 'Payout %', 'Base payout USD', 'Created', '']}
                    rows={salesRows}
                    emptyTitle="No chatter sales entries"
                    emptyDescription="Add chatter sales for this month."
                    numericColumns={[2, 3, 4]}
                    renderRow={(row) => {
                      const gross = row.amount_usd ?? row.amount ?? 0;
                      const pct = row.payout_pct ?? teamMembers.find((m) => m.id === row.team_member_id)?.payout_percentage ?? 0;
                      const base = (gross * pct) / 100;
                      return (
                        <tr key={row.id} className="border-t border-white/10 hover:bg-white/5">
                          <td className="py-3 px-4 text-white/70">{monthDisplay(row)}</td>
                          <td className="py-3 px-4 text-white/90">{memberDisplay(row)}</td>
                          <td className="py-3 px-4 text-right tabular-nums text-white/90">{gross.toFixed(2)}</td>
                          <td className="py-3 px-4 text-right tabular-nums text-white/90">{pct}%</td>
                          <td className="py-3 px-4 text-right tabular-nums text-white/90">{base.toFixed(2)}</td>
                          <td className="py-3 px-4 text-white/60 text-sm">{row.created_at ? new Date(row.created_at).toLocaleDateString() : '—'}</td>
                          <td className="py-3 px-4">
                            <button type="button" onClick={() => openEdit(row)} className="mr-2 text-xs text-[var(--purple-400)] hover:underline">Edit</button>
                            <button type="button" onClick={() => handleDelete(row.id)} className="text-xs text-red-400 hover:underline">Delete</button>
                          </td>
                        </tr>
                      );
                    }}
                  />
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-medium text-white/90">Bonuses</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setBonusModalOpen(true)}
                  className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/15"
                >
                  + Add bonus
                </button>
              </div>
              {basisLoading ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-white/60">Loading…</div>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5 shadow-lg shadow-black/30 backdrop-blur-xl">
                  <TableWithEmpty<BasisRow>
                    headers={['Month', 'Member', 'Amount EUR', 'Reason', '']}
                    rows={bonusRows}
                    emptyTitle="No bonus entries"
                    emptyDescription="Add a bonus for this month."
                    numericColumns={[2]}
                    renderRow={(row) => {
                      const amountEur = typeof row.amount_eur === 'number' ? row.amount_eur : (row.amount ?? 0);
                      return (
                        <tr key={row.id} className="border-t border-white/10 hover:bg-white/5">
                          <td className="py-3 px-4 text-white/70">{monthDisplay(row)}</td>
                          <td className="py-3 px-4 text-white/90">{memberDisplay(row)}</td>
                          <td className="py-3 px-4 text-right tabular-nums text-white/90">{amountEur.toFixed(2)}</td>
                          <td className="py-3 px-4 max-w-[200px] truncate text-white/70">{row.notes || '—'}</td>
                          <td className="py-3 px-4">
                            <button type="button" onClick={() => openEdit(row)} className="mr-2 text-xs text-[var(--purple-400)] hover:underline">Edit</button>
                            <button type="button" onClick={() => handleDelete(row.id)} className="text-xs text-red-400 hover:underline">Delete</button>
                          </td>
                        </tr>
                      );
                    }}
                  />
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-lg font-medium text-white/90">Fines</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFineModalOpen(true)}
                  className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/15"
                >
                  + Add fine
                </button>
              </div>
              {basisLoading ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-white/60">Loading…</div>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5 shadow-lg shadow-black/30 backdrop-blur-xl">
                  <TableWithEmpty<BasisRow>
                    headers={['Month', 'Member', 'Amount EUR', 'Reason', '']}
                    rows={fineRows}
                    emptyTitle="No fine entries"
                    emptyDescription="Add a fine for this month."
                    numericColumns={[2]}
                    renderRow={(row) => {
                      const amountEur = typeof row.amount_eur === 'number' ? row.amount_eur : (row.amount ?? 0);
                      return (
                        <tr key={row.id} className="border-t border-white/10 hover:bg-white/5">
                          <td className="py-3 px-4 text-white/70">{monthDisplay(row)}</td>
                          <td className="py-3 px-4 text-white/90">{memberDisplay(row)}</td>
                          <td className="py-3 px-4 text-right tabular-nums text-white/90">{amountEur.toFixed(2)}</td>
                          <td className="py-3 px-4 max-w-[200px] truncate text-white/70">{fineReasonFromNotes(row.notes ?? '') || '—'}</td>
                          <td className="py-3 px-4">
                            <button type="button" onClick={() => openEdit(row)} className="mr-2 text-xs text-[var(--purple-400)] hover:underline">Edit</button>
                            <button type="button" onClick={() => handleDelete(row.id)} className="text-xs text-red-400 hover:underline">Delete</button>
                          </td>
                        </tr>
                      );
                    }}
                  />
                </div>
              )}
            </section>

            <section className="space-y-3" data-input-section="payout_summary">
              <div>
                <h2 className="text-lg font-medium text-white/90">Payout summary (by member × month)</h2>
                <p className="text-sm text-white/60">From input data above (no payout run required). Final payout = base_payout_usd + bonus_total − fine_total.</p>
              </div>
              {basisLoading ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-white/60">Loading…</div>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5 shadow-lg shadow-black/30 backdrop-blur-xl">
                  <TableWithEmpty
                    headers={['Month', 'Member', 'Gross USD', 'Payout %', 'Base payout USD', 'Bonus EUR', 'Fine EUR', 'Final payout']}
                    rows={summaryByMemberMonth}
                    emptyTitle="No payout data"
                    emptyDescription="Add chatter sales to see summary."
                    numericColumns={[2, 3, 4, 5, 6]}
                    renderRow={(row) => {
                      const rowKey = `${row.month_id}:${row.month_key ?? ''}:${row.member_id}`;
                      const finalPayoutUsd = row.final_payout_usd;
                      return (
                        <tr key={rowKey} className="border-t border-white/10 hover:bg-white/5">
                          <td className="py-3 px-4 text-white/70">{row.month_key ?? monthKeyById[row.month_id] ?? row.month_id}</td>
                          <td className="py-3 px-4 text-white/90">{memberNameById[row.member_id] ?? row.member_id}</td>
                          <td className="py-3 px-4 text-right tabular-nums font-mono text-white/90">{formatExactNumber(row.gross_usd)}</td>
                          <td className="py-3 px-4 text-right tabular-nums text-white/90">{row.payout_pct}%</td>
                          <td className="py-3 px-4 text-right tabular-nums font-mono text-white/90">{formatExactNumber(row.base_payout_usd)}</td>
                          <td className="py-3 px-4 text-right tabular-nums font-mono text-white/90">{formatExactNumber(row.bonus_total_eur)}</td>
                          <td className="py-3 px-4 text-right tabular-nums font-mono text-white/90">{formatExactNumber(row.fine_total_eur)}</td>
                          <td className="py-3 px-4">
                            <PayoutDualCell amountUsd={finalPayoutUsd} fxRate={fxRate} />
                          </td>
                        </tr>
                      );
                    }}
                  />
                </div>
              )}
            </section>

            {/* Non-chatter: one unified card with tabs (Managers | VAs | Models), bonuses table + fines table + summary per tab */}
            <GlassCard className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-black/30 backdrop-blur-xl">
              <section className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-medium text-white/90">Team bonuses & fines</h2>
                    <p className="text-sm text-white/60">Bonus and fine entries for managers, VAs, and models (non-chatters). Same add/edit modals as above.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setBonusModalOpen(true)}
                      className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/15"
                    >
                      + Add bonus
                    </button>
                    <button
                      type="button"
                      onClick={() => setFineModalOpen(true)}
                      className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/15"
                    >
                      + Add fine
                    </button>
                  </div>
                </div>
                <div className="flex rounded-xl bg-white/10 p-1">
                  {(['managers', 'vas', 'models', 'affiliates'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setNonChatterTab(tab)}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${nonChatterTab === tab ? 'bg-white/20 text-white' : 'text-white/70 hover:text-white/90'}`}
                    >
                      {tab === 'managers' ? 'Managers' : tab === 'vas' ? 'VAs' : tab === 'affiliates' ? 'Affiliates' : 'Models'}
                    </button>
                  ))}
                </div>
                {nonChatterByRoleLoading ? (
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-white/60">Loading…</div>
                ) : (
                  (() => {
                    const group = nonChatterByRole[nonChatterTab];
                    const { bonuses, fines, totals } = group;
                    const renderBonusRow = (row: BasisRow) => {
                      const amountEur = typeof row.amount_eur === 'number' ? row.amount_eur : (row.amount ?? 0);
                      return (
                        <tr key={row.id} className="border-t border-white/10 hover:bg-white/5">
                          <td className="py-3 px-4 text-white/70">{monthDisplay(row)}</td>
                          <td className="py-3 px-4 text-white/90">{memberDisplay(row)}</td>
                          <td className="py-3 px-4 text-right tabular-nums font-mono text-white/90">{amountEur.toFixed(2)}</td>
                          <td className="py-3 px-4 max-w-[200px] truncate text-white/70">{row.notes || '—'}</td>
                          <td className="py-3 px-4 text-white/60 text-sm">{formatCreatedAt(row.created_at)}</td>
                          <td className="py-3 px-4">
                            <button type="button" onClick={() => openEdit(row)} className="mr-2 text-xs text-[var(--purple-400)] hover:underline">Edit</button>
                            <button type="button" onClick={() => handleDelete(row.id)} className="text-xs text-red-400 hover:underline">Delete</button>
                          </td>
                        </tr>
                      );
                    };
                    const renderFineRow = (row: BasisRow) => {
                      const amountEur = typeof row.amount_eur === 'number' ? row.amount_eur : (row.amount ?? 0);
                      const displayAmount = Math.abs(amountEur);
                      const reasonOrNotes = fineReasonFromNotes(row.notes ?? '') || '—';
                      return (
                        <tr key={row.id} className="border-t border-white/10 hover:bg-white/5">
                          <td className="py-3 px-4 text-white/70">{monthDisplay(row)}</td>
                          <td className="py-3 px-4 text-white/90">{memberDisplay(row)}</td>
                          <td className="py-3 px-4 text-right tabular-nums font-mono text-white/90">{displayAmount.toFixed(2)}</td>
                          <td className="py-3 px-4 max-w-[200px] truncate text-white/70">{reasonOrNotes}</td>
                          <td className="py-3 px-4 text-white/60 text-sm">{formatCreatedAt(row.created_at)}</td>
                          <td className="py-3 px-4">
                            <button type="button" onClick={() => openEdit(row)} className="mr-2 text-xs text-[var(--purple-400)] hover:underline">Edit</button>
                            <button type="button" onClick={() => handleDelete(row.id)} className="text-xs text-red-400 hover:underline">Delete</button>
                          </td>
                        </tr>
                      );
                    };
                    return (
                      <>
                        <div>
                          <h3 className="mb-2 text-sm font-medium text-white/80">Bonuses</h3>
                          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
                            <TableWithEmpty<BasisRow>
                              headers={['Month', 'Member', 'Amount EUR', 'Reason / notes', 'Created', '']}
                              rows={bonuses}
                              emptyTitle="No bonuses"
                              emptyDescription="Add a bonus using the button above."
                              numericColumns={[2]}
                              renderRow={renderBonusRow}
                            />
                          </div>
                        </div>
                        <div>
                          <h3 className="mb-2 text-sm font-medium text-white/80">Fines</h3>
                          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
                            <TableWithEmpty<BasisRow>
                              headers={['Month', 'Member', 'Amount EUR', 'Reason / notes', 'Created', '']}
                              rows={fines}
                              emptyTitle="No fines"
                              emptyDescription="Add a fine using the button above."
                              numericColumns={[2]}
                              renderRow={renderFineRow}
                            />
                          </div>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
                          <span className="text-white/60">Summary: </span>
                          <span className="text-white/80">Total bonuses €{totals.totalBonusEur.toFixed(2)}</span>
                          <span className="mx-2 text-white/50">·</span>
                          <span className="text-white/80">Total fines €{totals.totalFinesEur.toFixed(2)}</span>
                          <span className="mx-2 text-white/50">·</span>
                          <span className="font-medium text-white/90">Net €{totals.netEur.toFixed(2)}</span>
                        </div>
                      </>
                    );
                  })()
                )}
              </section>
            </GlassCard>

            <GlassCard className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-black/30 backdrop-blur-xl">
              <section className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-medium text-white/90">Payouts</h2>
                  <div className="flex flex-wrap items-center gap-2">
                    {isPreview && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!selectedMonthId || !mergedPreviewLines.length) return;
                          setSavePayoutsBusy(true);
                          apiFetch<{ ok?: boolean; runId?: string }>('/api/payout-runs/save-computed', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ month_id: selectedMonthId, lines: mergedPreviewLines }),
                          })
                            .then(({ ok, data }) => {
                              if (ok && data?.runId) {
                                runCacheRef.current.delete(data.runId);
                                setSelectedRunId(data.runId);
                                setRefreshRunDetailTrigger((t) => t + 1);
                                loadPayoutRuns(true);
                              }
                            })
                            .finally(() => setSavePayoutsBusy(false));
                        }}
                        disabled={savePayoutsBusy || !selectedMonthId || !mergedPreviewLines.length}
                        className="rounded-xl bg-[var(--purple-500)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                      >
                        {savePayoutsBusy ? 'Saving…' : 'Save computed payouts'}
                      </button>
                    )}
                    {!isPreview && runDetail?.run?.status === 'draft' && (
                      <button
                        type="button"
                        onClick={() => handleStatusChange('locked')}
                        disabled={statusBusy}
                        className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/15 disabled:opacity-50"
                      >
                        Lock
                      </button>
                    )}
                    {!isPreview && runDetail?.run?.status === 'locked' && (
                      <button
                        type="button"
                        onClick={() => handleStatusChange('paid')}
                        disabled={statusBusy}
                        className="rounded-xl bg-green-600/80 px-4 py-2 text-sm font-medium text-white hover:bg-green-600 disabled:opacity-50"
                      >
                        Mark paid
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={exportCsv}
                      disabled={isPreview || !runDetail?.lines?.length}
                      className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/15 disabled:opacity-50"
                    >
                      Export CSV
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex rounded-xl bg-white/10 p-1">
                    <button
                      type="button"
                      onClick={() => setPayoutViewMode('preview')}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${isPreview ? 'bg-white/20 text-white' : 'text-white/70 hover:text-white/90'}`}
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPayoutViewMode('saved');
                        if (payoutRuns.length > 0 && !selectedRunId) setSelectedRunId(payoutRuns[0].id);
                      }}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${!isPreview ? 'bg-white/20 text-white' : 'text-white/70 hover:text-white/90'}`}
                    >
                      Saved
                    </button>
                  </div>
                  {!isPreview && (
                    <>
                      <span className="text-sm font-medium text-white/70">Run</span>
                      <SmartSelect
                        value={selectedRunId && payoutRuns.some((r) => r.id === selectedRunId) ? selectedRunId : null}
                        onValueChange={(v) => setSelectedRunId(v ?? '')}
                        options={runOptions}
                        placeholder={payoutRuns.length === 0 ? 'No runs' : 'Select run'}
                        disabled={payoutRuns.length === 0}
                      />
                      {runDetail?.run && (
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            runDetail.run.status === 'draft'
                              ? 'bg-white/15 text-white/80'
                              : runDetail.run.status === 'locked'
                                ? 'bg-green-500/20 text-green-300'
                                : 'bg-white/10 text-white/70'
                          }`}
                        >
                          {runDetail.run.status}
                        </span>
                      )}
                      {!isPreview && selectedRunId && (
                        <button
                          type="button"
                          onClick={() => {
                            setDeleteRunConfirmRunId(selectedRunId);
                            setDeleteRunError(null);
                          }}
                          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-500/20"
                        >
                          Delete run
                        </button>
                      )}
                    </>
                  )}
                  <span className="text-xs text-white/50">{isPreview ? 'Preview is auto-computed. Save to create a run.' : 'Saved data from payout_runs only.'}</span>
                </div>

                <div className="flex flex-wrap gap-1 border-b border-white/10">
                  {PAYOUT_TAB_IDS.map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setActivePayoutTab(tab)}
                      className={`rounded-t-lg px-4 py-2 text-sm font-medium capitalize transition-colors ${
                        activePayoutTab === tab
                          ? 'bg-white/15 text-white border-b-2 border-[var(--purple-400)] -mb-px'
                          : 'text-white/70 hover:bg-white/10 hover:text-white/90'
                      }`}
                    >
                      {tab === 'vas' ? 'VAs' : tab === 'affiliates' ? 'Affiliates' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                  ))}
                </div>

                {isPreview && previewLoading ? (
                  <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/60">Loading preview…</div>
                ) : !isPreview && selectedRunId && runDetailLoading && !(runDetail?.run?.id === selectedRunId && Array.isArray(runDetail?.lines)) ? (
                  <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/60">Loading run…</div>
                ) : displayLines && displayLines.length > 0 ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center gap-4">
                        <div className="flex items-baseline gap-2">
                          <span className="text-white/70">Total payout:</span>
                          <PayoutDualCell amountEur={totals.eur} amountUsd={totals.usd ?? undefined} fxRate={fxRate} />
                        </div>
                        <span className="text-white/70">Members: <span className="font-medium text-white/90">{displayLines.length}</span></span>
                        {isPreview && <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-200">Preview (unsaved)</span>}
                      </div>
                      {activePayoutTab === 'vas' && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setHourlyModalOpen(true)}
                            className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/15"
                          >
                            Add hourly
                          </button>
                        </div>
                      )}
                    </div>
                    {isPreview && previewDebug && (
                      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs font-mono text-amber-200/90">
                        <span className="font-semibold">Affiliate debug (?debug=1):</span> deals={previewDebug.affiliateDealsCount} matched_models={previewDebug.matchedModelsCount} affiliate_payout_total_usd={previewDebug.affiliatePayoutTotalUsd.toFixed(2)}
                      </div>
                    )}
                    <div className="overflow-x-auto rounded-xl border border-white/10 bg-white/5 shadow-inner">
                      <table className="w-full min-w-[1000px]">
                        <thead className="sticky top-0 z-10 border-b border-white/10 bg-white/10 backdrop-blur-sm">
                          <tr>
                            <th className="py-3 px-4 text-left text-xs font-semibold uppercase tracking-wider text-white/80">Member</th>
                            {activePayoutTab === 'affiliates' ? (
                              <>
                                <th className="py-3 px-4 text-right text-xs font-semibold uppercase tracking-wider text-white/80">%</th>
                                <th className="py-3 px-4 text-right text-xs font-semibold uppercase tracking-wider text-white/80">Payout</th>
                                <th className="py-3 px-4 text-left text-xs font-semibold uppercase tracking-wider text-white/80">Payment</th>
                              </>
                            ) : (
                              <>
                            <th className="py-3 px-4 text-left text-xs font-semibold uppercase tracking-wider text-white/80">Role</th>
                            <th className="py-3 px-4 text-left text-xs font-semibold uppercase tracking-wider text-white/80">Dept</th>
                            <th className="py-3 px-4 text-right text-xs font-semibold uppercase tracking-wider text-white/80">Basis (webapp)</th>
                            <th className="py-3 px-4 text-right text-xs font-semibold uppercase tracking-wider text-white/80">Basis (manual)</th>
                            <th className="py-3 px-4 text-right text-xs font-semibold uppercase tracking-wider text-white/80">Bonus</th>
                            <th className="py-3 px-4 text-right text-xs font-semibold uppercase tracking-wider text-white/80">Basis total</th>
                            <th className="py-3 px-4 text-left text-xs font-semibold uppercase tracking-wider text-white/80">Type</th>
                            <th className="py-3 px-4 text-right text-xs font-semibold uppercase tracking-wider text-white/80">%</th>
                            <th className="py-3 px-4 text-right text-xs font-semibold uppercase tracking-wider text-white/80">Flat</th>
                            <th className="py-3 px-4 text-right text-xs font-semibold uppercase tracking-wider text-white/80">Payout</th>
                            <th className="py-3 px-4 text-left text-xs font-semibold uppercase tracking-wider text-white/80">Currency</th>
                            <th className="py-3 px-4 text-left text-xs font-semibold uppercase tracking-wider text-white/80">Paid</th>
                            <th className="py-3 px-4 text-left text-xs font-semibold uppercase tracking-wider text-white/80">Payment</th>
                              </>
                            )}
                            <th className="py-3 px-4 text-right text-xs font-semibold uppercase tracking-wider text-white/80">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10">
                          {displayLines.map((row, idx) => {
                            const isModelLine = getPayoutCategory(row.role, row.department) === 'model';
                            const teamMemberKey = (row.team_member_id ?? '').trim();
                            const payeeKey = (row.payee_team_member_id ?? '').trim();
                            const modelKey = row.team_member_id?.startsWith('model-') ? row.team_member_id : '';
                            const methods = isModelLine
                              ? (paymentMethodsByModelId[modelKey] ?? paymentMethodsByTeamMemberId[payeeKey] ?? [])
                              : (paymentMethodsByTeamMemberId[teamMemberKey] ?? []);
                            const payeeId = payeeKey && !payeeKey.startsWith('model-') ? payeeKey : (teamMemberKey && !teamMemberKey.startsWith('model-') ? teamMemberKey : null);
                            return (
                              <BreakdownRow
                                key={row.id}
                                row={row}
                                idx={idx}
                                fxRate={fxRate}
                                compactAffiliate={activePayoutTab === 'affiliates'}
                                onToggleBreakdown={() => setExpandedBreakdownRowId((id) => (id === row.id ? null : row.id))}
                                isBreakdownExpanded={expandedBreakdownRowId === row.id}
                                onPaidToggle={isPreview ? undefined : (lineId, currentStatus) => {
                                  const nextPaid = currentStatus !== 'paid';
                                  setPaidToggleBusy(lineId);
                                  const prevLines = runDetail?.lines;
                                  setRunDetail((prev) => {
                                    if (!prev) return prev;
                                    return {
                                      ...prev,
                                      lines: prev.lines.map((l) =>
                                        l.id === lineId
                                          ? { ...l, paid_status: nextPaid ? 'paid' : 'pending', paid_at: nextPaid ? new Date().toISOString().slice(0, 10) : null }
                                          : l
                                      ),
                                    };
                                  });
                                  apiFetch<{ ok?: boolean; id?: string; paid_status?: string; paid_at?: string | null }>(`/api/payout-lines/${lineId}`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ paid: nextPaid }),
                                  })
                                    .then((res) => {
                                      if (res.ok !== true) {
                                        setRunDetail((p) => (p && prevLines ? { ...p, lines: prevLines } : p));
                                      }
                                    })
                                    .catch(() => {
                                      setRunDetail((p) => (p && prevLines ? { ...p, lines: prevLines } : p));
                                    })
                                    .finally(() => setPaidToggleBusy(null));
                                }}
                                paidToggleBusy={paidToggleBusy}
                                paymentMethods={methods}
                                payeeId={payeeId && !String(payeeId).startsWith('model-') ? payeeId : null}
                                memberName={row.team_member_name}
                                isPaymentExpanded={expandedPayoutRowId === row.id}
                                onTogglePaymentExpand={() => setExpandedPayoutRowId((id) => (id === row.id ? null : row.id))}
                                onManagePayment={() => setManagePaymentFor({ memberId: payeeId ?? '', memberName: row.team_member_name })}
                              />
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : !isPreview && payoutRuns.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-white/60">No saved runs for this month. Use Preview and Save to create one.</div>
                ) : !isPreview && selectedRunId && !runDetail && !runDetailLoading ? (
                  <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-white/60">Could not load run.</div>
                ) : !isPreview && runDetail && Array.isArray(runDetail.lines) && runDetail.lines.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-8">
                    <EmptyState title="No payout lines" description="This run has no payout lines." />
                  </div>
                ) : isPreview && !previewLoading && !previewLines.length ? (
                  <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-white/60">No team members to show. Add team members to see preview.</div>
                ) : displayLines.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-white/60">
                    No {activePayoutTab} in {isPreview ? 'preview' : 'this run'}.
                  </div>
                ) : null}
              </section>
            </GlassCard>
          </>
        )}

        {/* Manage payment methods modal — Radix Dialog, premium cards + form */}
        <Dialog.Root
          open={!!managePaymentFor}
          onOpenChange={(open) => {
            if (!open) {
              setManagePaymentFor(null);
              setPaymentMethodEditId(null);
            }
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
            <Dialog.Content className="fixed left-[50%] top-[50%] z-50 max-h-[85vh] w-full max-w-lg translate-x-[-50%] translate-y-[-50%] overflow-y-auto rounded-2xl border border-white/10 bg-zinc-900/95 p-6 shadow-xl backdrop-blur-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
              {managePaymentFor && (
                <>
                  <Dialog.Title className="text-lg font-semibold text-white">
                    {managePaymentFor.memberName}
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-sm text-white/60">
                    Add, edit, or set default. Only one default per member.
                  </Dialog.Description>

                  {(() => {
                    const memberId = managePaymentFor.memberId?.trim() ?? '';
                    const methods = paymentMethodsByTeamMemberId[memberId] ?? [];
                    return (
                      <>
                        {methods.length > 0 && (
                          <ul className="mt-5 space-y-3">
                            {methods.map((m) => (
                              <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.06] p-4">
                                <div className="flex flex-wrap items-center gap-2 min-w-0">
                                  <span className="inline-flex rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-xs font-medium text-white/90">
                                    {m.method_label ?? (m.is_default ? 'primary' : 'secondary')}
                                  </span>
                                  <span className="text-sm font-medium text-white/90">{m.payout_method || m.method_type || '—'}</span>
                                  <span className="font-mono text-sm text-white/70">{maskIbanOrAccount(m.iban_or_account)}</span>
                                  <span
                                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                      m.status === 'active' ? 'bg-green-500/20 text-green-300' : m.status === 'inactive' ? 'bg-white/10 text-white/60' : 'bg-amber-500/20 text-amber-300'
                                    }`}
                                  >
                                    {m.status || '—'}
                                  </span>
                                </div>
                                <div className="flex shrink-0 gap-2">
                                  {!m.is_default && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        apiFetch(`/api/team-member-payment-methods/${m.id}`, {
                                          method: 'PATCH',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ is_default: true }),
                                        }).then(() => refreshPaymentMethods());
                                      }}
                                      className="rounded border border-white/20 bg-white/5 px-2 py-1 text-xs text-white/80 hover:bg-white/10"
                                    >
                                      Set default
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPaymentMethodEditId(m.id);
                                      setPaymentMethodForm({
                                        method_label: m.method_label ?? 'primary',
                                        payout_method: m.payout_method ?? '',
                                        beneficiary_name: m.beneficiary_name ?? '',
                                        iban_or_account: m.iban_or_account ?? '',
                                        revtag: m.revtag ?? '',
                                        status: m.status ?? 'active',
                                        notes: m.notes ?? '',
                                        is_default: Boolean(m.is_default),
                                      });
                                    }}
                                    className="rounded border border-white/20 bg-white/5 px-2 py-1 text-xs text-[var(--purple-400)] hover:bg-white/10"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!confirm('Delete this payment method?')) return;
                                      apiFetch(`/api/team-member-payment-methods/${m.id}`, { method: 'DELETE' }).then(() => {
                                        refreshPaymentMethods();
                                        if (paymentMethodEditId === m.id) setPaymentMethodEditId(null);
                                      });
                                    }}
                                    className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-400 hover:bg-red-500/20"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                        {methods.length === 0 && paymentMethodEditId === null && (
                          <p className="mt-5 text-sm text-white/50">No payment methods on file.</p>
                        )}
                      </>
                    );
                  })()}

                  {paymentMethodEditId === null ? (
                    <div className="mt-5">
                      <button
                        type="button"
                        onClick={() => {
                          setPaymentMethodEditId('');
                          setPaymentMethodForm({
                            method_label: 'primary',
                            payout_method: '',
                            beneficiary_name: '',
                            iban_or_account: '',
                            revtag: '',
                            status: 'active',
                            notes: '',
                            is_default: false,
                          });
                        }}
                        className="rounded-xl bg-[var(--purple-500)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--purple-600)]"
                      >
                        Add method
                      </button>
                    </div>
                  ) : (
                    <PaymentMethodFormBlock
                      form={paymentMethodForm}
                      setForm={setPaymentMethodForm}
                      memberId={managePaymentFor.memberId}
                      editId={paymentMethodEditId}
                      onSave={() => {
                        setPaymentMethodSaveBusy(true);
                        const body = { ...paymentMethodForm, team_member_id: managePaymentFor.memberId };
                        if (paymentMethodEditId === '') {
                          apiFetch(`/api/team-member-payment-methods`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body),
                          })
                            .then(() => {
                              refreshPaymentMethods();
                              setPaymentMethodEditId(null);
                            })
                            .finally(() => setPaymentMethodSaveBusy(false));
                        } else {
                          apiFetch(`/api/team-member-payment-methods/${paymentMethodEditId}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(paymentMethodForm),
                          })
                            .then(() => {
                              refreshPaymentMethods();
                              setPaymentMethodEditId(null);
                            })
                            .finally(() => setPaymentMethodSaveBusy(false));
                        }
                      }}
                      onCancel={() => setPaymentMethodEditId(null)}
                      saveBusy={paymentMethodSaveBusy}
                    />
                  )}

                  <div className="mt-6 flex justify-end">
                    <Dialog.Close asChild>
                      <button type="button" className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/15">
                        Close
                      </button>
                    </Dialog.Close>
                  </div>
                </>
              )}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* Delete payout run confirm */}
        <Dialog.Root
          open={!!deleteRunConfirmRunId}
          onOpenChange={(open) => {
            if (!open) {
              setDeleteRunConfirmRunId(null);
              setDeleteRunError(null);
            }
          }}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
            <Dialog.Content className="fixed left-[50%] top-[50%] z-50 w-full max-w-md translate-x-[-50%] translate-y-[-50%] rounded-2xl border border-white/10 bg-zinc-900/95 p-6 shadow-xl backdrop-blur-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
              <Dialog.Title className="text-lg font-semibold text-white">Delete payout run?</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-white/60">
                This will permanently delete the run and all payout lines inside it. This cannot be undone.
              </Dialog.Description>
              {deleteRunError && (
                <p className="mt-3 rounded-lg bg-red-500/20 px-3 py-2 text-sm text-red-300">{deleteRunError}</p>
              )}
              <div className="mt-6 flex justify-end gap-3">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/15"
                  >
                    Cancel
                  </button>
                </Dialog.Close>
                <button
                  type="button"
                  disabled={deleteRunBusy}
                  onClick={async () => {
                    if (!deleteRunConfirmRunId) return;
                    setDeleteRunBusy(true);
                    setDeleteRunError(null);
                    try {
                      const { ok, status, data } = await apiFetch<{ ok?: boolean; error?: string }>(
                        `/api/payout-runs/${deleteRunConfirmRunId}`,
                        { method: 'DELETE' }
                      );
                      if (ok && data?.ok) {
                        runCacheRef.current.delete(deleteRunConfirmRunId);
                        setSelectedRunId('');
                        setRunDetail(null);
                        setDeleteRunConfirmRunId(null);
                        const loadPromise = loadPayoutRuns(false);
                        if (loadPromise) {
                          loadPromise.then((runs) => {
                            if (runs && runs.length === 0) setPayoutViewMode('preview');
                          });
                        }
                        setPaymentsToast({ message: 'Deleted payout run', type: 'success' });
                      } else if (status === 409) {
                        setDeleteRunError(data?.error ?? 'Run is locked and cannot be deleted.');
                      } else {
                        setDeleteRunError(data?.error ?? 'Failed to delete run.');
                      }
                    } catch {
                      setDeleteRunError('Failed to delete run.');
                    } finally {
                      setDeleteRunBusy(false);
                    }
                  }}
                  className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {deleteRunBusy ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {paymentsToast && (
          <div
            className={`fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-xl border px-4 py-3 text-sm shadow-lg ${
              paymentsToast.type === 'success'
                ? 'border-[var(--success)]/50 bg-[var(--success-dim)] text-[var(--success)]'
                : 'border-[var(--danger)]/50 bg-[var(--danger-dim)] text-[var(--danger)]'
            }`}
            role="status"
          >
            {paymentsToast.message}
          </div>
        )}

        {/* Chatter sales modal */}
        {salesModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSalesModalOpen(false)}>
            <div className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-white">Add chatter sales</h3>
              <p className="mt-1 text-sm text-white/70">Gross USD (OnlyFans). Base payout = gross × payout_pct. Member and month are required.</p>
              <div className="mt-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-white/70">Member (required)</label>
                  <select
                    value={salesForm.memberId || '__pick__'}
                    onChange={(e) => {
                      const v = e.target.value === '__pick__' ? '' : e.target.value;
                      setSalesForm((f) => ({
                        ...f,
                        memberId: v,
                        payoutPct: v ? String(teamMembers.find((m) => m.id === v)?.payout_percentage ?? '') : '',
                      }));
                    }}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 glass-input"
                  >
                    <option value="__pick__">Select member</option>
                    {teamMembers.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/70">Month (required – select in toolbar above)</label>
                  <div className="mt-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90">
                    {selectedMonthId ? (monthKeyById[selectedMonthId] ?? selectedMonthId) : 'Select a month in the toolbar above'}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/70">Gross USD</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={salesForm.grossUsd}
                    onChange={(e) => setSalesForm((f) => ({ ...f, grossUsd: e.target.value }))}
                    placeholder="0.00"
                    className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/70">Payout % (editable)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={salesForm.payoutPct}
                    onChange={(e) => setSalesForm((f) => ({ ...f, payoutPct: e.target.value }))}
                    placeholder="e.g. 10"
                    className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/70">Notes (optional)</label>
                  <input
                    type="text"
                    value={salesForm.notes}
                    onChange={(e) => setSalesForm((f) => ({ ...f, notes: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90"
                  />
                </div>
                {salesForm.grossUsd && salesForm.payoutPct && (
                  <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
                    <span className="text-white/70">Base payout USD: </span>
                    <span className="font-mono text-white/90">
                      {((parseFloat(salesForm.grossUsd) || 0) * (parseFloat(salesForm.payoutPct) || 0) / 100).toFixed(2)}
                    </span>
                    {fxRate != null && (
                      <span className="ml-2 text-white/60">
                        {((parseFloat(salesForm.grossUsd) || 0) * (parseFloat(salesForm.payoutPct) || 0) / 100 * fxRate).toFixed(2)} EUR
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <button type="button" onClick={() => setSalesModalOpen(false)} className="rounded-xl px-4 py-2 text-sm text-white/80 hover:bg-white/10">Cancel</button>
                <button
                  type="button"
                  onClick={handleSubmitSales}
                  disabled={salesBusy || !selectedMonthId || !salesForm.memberId || !(parseFloat(salesForm.grossUsd) >= 0)}
                  className="rounded-xl bg-[var(--purple-500)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {salesBusy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bonus modal */}
        {bonusModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setBonusModalOpen(false)}>
            <div className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-white">Add bonus</h3>
              <div className="mt-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-white/70">Member</label>
                  <select
                    value={bonusForm.memberId || '__pick__'}
                    onChange={(e) => setBonusForm((f) => ({ ...f, memberId: e.target.value === '__pick__' ? '' : e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 glass-input"
                  >
                    <option value="__pick__">Select member</option>
                    {teamMembers.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/70">Month</label>
                  <div className="mt-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90">
                    {selectedMonthId ? (monthKeyById[selectedMonthId] ?? selectedMonthId) : '—'}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/70">Amount EUR</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={bonusForm.amountEur}
                    onChange={(e) => setBonusForm((f) => ({ ...f, amountEur: e.target.value }))}
                    placeholder="0.00"
                    className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/70">Reason (required)</label>
                  <input
                    type="text"
                    value={bonusForm.reason}
                    onChange={(e) => setBonusForm((f) => ({ ...f, reason: e.target.value }))}
                    placeholder="Short reason"
                    className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/70">Notes (optional)</label>
                  <input
                    type="text"
                    value={bonusForm.notes}
                    onChange={(e) => setBonusForm((f) => ({ ...f, notes: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90"
                  />
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <button type="button" onClick={() => setBonusModalOpen(false)} className="rounded-xl px-4 py-2 text-sm text-white/80 hover:bg-white/10">Cancel</button>
                <button
                  type="button"
                  onClick={handleSubmitBonus}
                  disabled={bonusBusy || !bonusForm.memberId || !bonusForm.reason.trim() || !(parseFloat(bonusForm.amountEur) >= 0)}
                  className="rounded-xl bg-[var(--purple-500)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {bonusBusy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Fine modal */}
        {fineModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setFineModalOpen(false)}>
            <div className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-white">Add fine</h3>
              <div className="mt-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-white/70">Member</label>
                  <select
                    value={fineForm.memberId || '__pick__'}
                    onChange={(e) => setFineForm((f) => ({ ...f, memberId: e.target.value === '__pick__' ? '' : e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 glass-input"
                  >
                    <option value="__pick__">Select member</option>
                    {teamMembers.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/70">Month</label>
                  <div className="mt-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90">
                    {selectedMonthId ? (monthKeyById[selectedMonthId] ?? selectedMonthId) : '—'}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/70">Amount EUR (positive)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={fineForm.amountEur}
                    onChange={(e) => setFineForm((f) => ({ ...f, amountEur: e.target.value }))}
                    placeholder="0.00"
                    className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/70">Reason (required)</label>
                  <input
                    type="text"
                    value={fineForm.reason}
                    onChange={(e) => setFineForm((f) => ({ ...f, reason: e.target.value }))}
                    placeholder="Short reason"
                    className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90"
                  />
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <button type="button" onClick={() => setFineModalOpen(false)} className="rounded-xl px-4 py-2 text-sm text-white/80 hover:bg-white/10">Cancel</button>
                <button
                  type="button"
                  onClick={handleSubmitFine}
                  disabled={fineBusy || !fineForm.memberId || !fineForm.reason.trim() || !(parseFloat(fineForm.amountEur) >= 0)}
                  className="rounded-xl bg-[var(--purple-500)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {fineBusy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Add hourly (VAs) — team members from team_members table, status=Active only */}
        {hourlyModalOpen && (() => {
          const hourlyModalMembers = teamMembers.filter(
            (m) => (m.status ?? '').toString().toLowerCase() === 'active'
          );
          if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
            console.log('Hourly modal team members:', hourlyModalMembers);
          }
          return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setHourlyModalOpen(false)}>
            <div className="w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-white">Add hourly</h3>
              <p className="mt-1 text-sm text-white/70">Hours worked and hourly rate. Total is computed.</p>
              <div className="mt-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-white/70">Team member</label>
                  <select
                    value={hourlyForm.team_member_id || '__pick__'}
                    onChange={(e) => setHourlyForm((f) => ({ ...f, team_member_id: e.target.value === '__pick__' ? '' : e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90"
                  >
                    <option value="__pick__">Select team member</option>
                    {hourlyModalMembers.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/70">Hours worked</label>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={hourlyForm.hours_worked}
                    onChange={(e) => setHourlyForm((f) => ({ ...f, hours_worked: e.target.value }))}
                    placeholder="0"
                    className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/70">Hourly rate (EUR)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={hourlyForm.hourly_rate_eur}
                    onChange={(e) => setHourlyForm((f) => ({ ...f, hourly_rate_eur: e.target.value }))}
                    placeholder="0.00"
                    className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/70">Total (EUR)</label>
                  <div className="mt-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm tabular-nums text-white/90">
                    {(() => {
                      const h = parseFloat(hourlyForm.hours_worked) || 0;
                      const r = parseFloat(hourlyForm.hourly_rate_eur) || 0;
                      return (h * r).toFixed(2);
                    })()}
                  </div>
                </div>
                {(() => {
                  const teamMemberId = (hourlyForm.team_member_id || '').trim();
                  const hasMember = teamMemberId && teamMemberId !== '__pick__';
                  const hours = parseFloat(hourlyForm.hours_worked) || 0;
                  const rate = parseFloat(hourlyForm.hourly_rate_eur) || 0;
                  const saveDisabled = !hasMember || hours <= 0 || rate <= 0 || hourlySaveBusy;
                  if (!saveDisabled) return null;
                  const msg = !hasMember ? 'Select a team member' : hours <= 0 ? 'Enter hours worked > 0' : 'Enter hourly rate (EUR) > 0';
                  return <p className="text-xs text-amber-400">{msg}</p>;
                })()}
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <button type="button" onClick={() => { setHourlyModalOpen(false); setHourlySaveToast(false); }} className="rounded-xl px-4 py-2 text-sm text-white/80 hover:bg-white/10">Cancel</button>
                <button
                  type="button"
                  onClick={async () => {
                    const teamMemberId = (hourlyForm.team_member_id || '').trim();
                    const hasMember = teamMemberId && teamMemberId !== '__pick__';
                    const hours = parseFloat(hourlyForm.hours_worked) || 0;
                    const rate = parseFloat(hourlyForm.hourly_rate_eur) || 0;
                    const totalEur = hours * rate;
                    console.log('hourly save clicked', { teamMemberId: teamMemberId || null, hours, hourlyRateEur: rate, totalEur });
                    if (!hasMember || hours <= 0 || rate <= 0) return;
                    setHourlySaveBusy(true);
                    try {
                      const { ok } = await apiFetch<{ ok?: boolean; record_id?: string }>('/api/payout-lines/hourly', {
                        method: 'POST',
                        body: JSON.stringify({
                          month_id: selectedMonthId,
                          team_member_id: teamMemberId,
                          hours_worked: hours,
                          hourly_rate_eur: rate,
                          total_eur: Math.round(totalEur * 100) / 100,
                          notes: undefined,
                        }),
                      });
                      if (ok) {
                        setHourlyModalOpen(false);
                        setHourlyForm({ team_member_id: '', hours_worked: '', hourly_rate_eur: '' });
                        setRefreshPreviewTrigger((t) => t + 1);
                        setHourlySaveToast(true);
                        setTimeout(() => setHourlySaveToast(false), 2000);
                      }
                    } finally {
                      setHourlySaveBusy(false);
                    }
                  }}
                  disabled={
                    !(hourlyForm.team_member_id || '').trim() ||
                    (hourlyForm.team_member_id || '') === '__pick__' ||
                    (parseFloat(hourlyForm.hours_worked) || 0) <= 0 ||
                    (parseFloat(hourlyForm.hourly_rate_eur) || 0) <= 0 ||
                    hourlySaveBusy
                  }
                  className="rounded-xl bg-[var(--purple-500)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {hourlySaveBusy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
          );
        })()}

        {hourlySaveToast && (
          <div className="fixed bottom-4 right-4 z-[60] rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-lg">
            Saved
          </div>
        )}

        {/* Edit modal (sales / bonus / fine) */}
        {editBasisRow && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setEditBasisRow(null)}>
            <div className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-zinc-900 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-white">Edit {editBasisRow.basis_type === 'chatter_sales' ? 'chatter sales' : isFineRow(editBasisRow) ? 'fine' : 'bonus'}</h3>
              <p className="mt-1 text-sm text-white/70">{memberDisplay(editBasisRow)}</p>
              <div className="mt-4 space-y-3">
                {editBasisRow.basis_type === 'chatter_sales' && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-white/70">Gross USD</label>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={editAmountUsd ?? ''}
                        onChange={(e) => setEditAmountUsd(e.target.value === '' ? undefined : parseFloat(e.target.value))}
                        className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-white/70">Payout %</label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.1}
                        value={editPayoutPct}
                        onChange={(e) => setEditPayoutPct(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-white/70">Notes</label>
                      <input type="text" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90" />
                    </div>
                  </>
                )}
                {(editBasisRow.basis_type === 'bonus' || isFineRow(editBasisRow)) && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-white/70">Amount EUR</label>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={editAmountUsd ?? ''}
                        onChange={(e) => setEditAmountUsd(e.target.value === '' ? undefined : parseFloat(e.target.value))}
                        className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-white/70">Reason</label>
                      <input type="text" value={editReason} onChange={(e) => setEditReason(e.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90" />
                    </div>
                    {editBasisRow.basis_type === 'bonus' && (
                      <div>
                        <label className="block text-xs font-medium text-white/70">Notes</label>
                        <input type="text" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90" />
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <button type="button" onClick={() => setEditBasisRow(null)} className="rounded-xl px-4 py-2 text-sm text-white/80 hover:bg-white/10">Cancel</button>
                <button type="button" onClick={handleSaveEdit} disabled={editBusy} className="rounded-xl bg-[var(--purple-500)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                  {editBusy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PaymentsPage() {
  return (
    <Suspense fallback={<div className="min-h-full flex items-center justify-center py-12 text-white/60">Loading…</div>}>
      <PaymentsPageContent />
    </Suspense>
  );
}
