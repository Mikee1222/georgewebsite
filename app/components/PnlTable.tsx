'use client';

import { useState, useCallback, useEffect } from 'react';
import type { PnlRow, PnlInputFieldName } from '@/lib/types';
import type { SettingsMap } from '@/lib/types';
import { getMarginColor } from '@/lib/business-rules';
import { PNL_INPUT_FIELDS } from '@/lib/types';
import { formatNumberFull, formatPercentFull, formatMonthLabel } from '@/lib/format';

const INPUT_FIELDS: { key: PnlInputFieldName; label: string; align: 'left' | 'right' }[] = [
  { key: 'gross_revenue', label: 'Gross rev', align: 'right' },
  { key: 'chatting_costs_team', label: 'Chatting', align: 'right' },
  { key: 'marketing_costs_team', label: 'Mkt team', align: 'right' },
  { key: 'production_costs_team', label: 'Production', align: 'right' },
  { key: 'ads_spend', label: 'Ads', align: 'right' },
  { key: 'other_marketing_costs', label: 'Other mkt', align: 'right' },
  { key: 'salary', label: 'Salary', align: 'right' },
  { key: 'affiliate_fee', label: 'Affiliate', align: 'right' },
  { key: 'bonuses', label: 'Bonuses', align: 'right' },
  { key: 'airbnbs', label: 'Airbnbs', align: 'right' },
  { key: 'softwares', label: 'Software', align: 'right' },
  { key: 'fx_withdrawal_fees', label: 'FX fees', align: 'right' },
  { key: 'other_costs', label: 'Other', align: 'right' },
  { key: 'notes_issues', label: 'Notes', align: 'left' },
];

const TOTAL_KEYS = new Set(['net_revenue', 'total_expenses', 'net_profit', 'profit_margin_pct']);

const COMPUTED: { key: keyof PnlRow; label: string }[] = [
  { key: 'of_fee', label: 'OF fee' },
  { key: 'net_revenue', label: 'Net rev' },
  { key: 'total_marketing_costs', label: 'Mkt total' },
  { key: 'total_expenses', label: 'Expenses' },
  { key: 'net_profit', label: 'Net profit' },
  { key: 'profit_margin_pct', label: 'Margin %' },
];

function marginPillClass(color: 'green' | 'yellow' | 'red'): string {
  const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ';
  if (color === 'green') return base + 'bg-[var(--green-dim)] text-[var(--green)]';
  if (color === 'yellow') return base + 'bg-[var(--yellow-dim)] text-[var(--yellow)]';
  return base + 'bg-[var(--red-dim)] text-[var(--red)]';
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export default function PnlTable({
  rows,
  settings,
  canEdit: allowEdit,
  title,
  onDataChange,
}: {
  rows: PnlRow[];
  settings: Partial<SettingsMap> | null;
  canEdit: boolean;
  title: string;
  onDataChange?: () => void;
}) {
  const [savingRecordId, setSavingRecordId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (saveStatus !== 'saved') return;
    const t = setTimeout(() => setSaveStatus('idle'), 2000);
    return () => clearTimeout(t);
  }, [saveStatus]);

  const patch = useCallback(
    async (recordId: string, field: PnlInputFieldName, value: string | number) => {
      if (!allowEdit) return;
      setSavingRecordId(recordId);
      setSaveStatus('saving');
      setErrorMessage(null);
      const body: Record<string, unknown> = { [field]: value };
      if (field !== 'notes_issues' && value !== '') body[field] = Number(value);
      try {
        const res = await fetch(`/api/pnl/${recordId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          const msg = data.error ?? 'Update failed';
          setErrorMessage(msg);
          setSaveStatus('error');
          return;
        }
        setErrorMessage(null);
        setSaveStatus('saved');
        onDataChange?.();
      } catch (e) {
        setErrorMessage(String(e));
        setSaveStatus('error');
      } finally {
        setSavingRecordId(null);
      }
    },
    [allowEdit, onDataChange]
  );

  return (
    <div className="relative mb-8 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)]">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            {title}
          </h2>
          {allowEdit && (
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Inline edit, autosave on blur
            </p>
          )}
        </div>
        {allowEdit && (
          <div className="text-xs text-[var(--text-muted)]">
            {saveStatus === 'saving' && <span>Saving…</span>}
            {saveStatus === 'saved' && <span className="text-[var(--green)]">Saved</span>}
            {saveStatus === 'error' && <span className="text-[var(--red)]">Error saving</span>}
          </div>
        )}
      </div>
      {errorMessage && (
        <div
          className="mb-3 rounded-lg border border-[var(--red)]/50 bg-[var(--red-dim)] px-3 py-2 text-sm text-[var(--red)]"
          role="alert"
        >
          {errorMessage}
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-white/10 bg-zinc-950/60">
        <div className="max-h-[calc(100vh-400px)] min-h-[120px] overflow-auto">
          <table className="min-w-[1100px]">
            <thead className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur-sm">
              <tr>
                <th className="col-frozen whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Month</th>
                {INPUT_FIELDS.map(({ key, label, align }) => (
                  <th key={key} className={`whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] ${align === 'right' ? 'text-right' : 'text-left'}`}>
                    {label}
                  </th>
                ))}
                {COMPUTED.map(({ key, label }) => (
                  <th key={key} className="whitespace-nowrap px-3 py-2 text-right text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const marginColor = getMarginColor(row.profit_margin_pct, settings);
                return (
                  <tr key={row.id}>
                    <td className="col-frozen whitespace-nowrap px-3 py-2 tabular-nums text-left text-sm">
                      {formatMonthLabel(row.month_key) || row.month_key}
                    </td>
                    {INPUT_FIELDS.map(({ key, align }) => (
                      <td
                        key={key}
                        className={`whitespace-nowrap px-3 py-2 tabular-nums text-sm ${align === 'right' ? 'text-right' : 'text-left'}`}
                      >
                        {allowEdit && PNL_INPUT_FIELDS.includes(key) ? (
                          <input
                            type={key === 'notes_issues' ? 'text' : 'number'}
                            className={`editable text-right ${key === 'notes_issues' ? 'min-w-[120px]' : 'w-28 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'}`}
                            style={{ textAlign: key === 'notes_issues' ? 'left' : 'right' }}
                            defaultValue={
                              key === 'notes_issues'
                                ? row[key]
                                : (row[key] as number) === 0
                                  ? ''
                                  : (row[key] as number)
                            }
                            step={key === 'notes_issues' ? undefined : 'any'}
                            onBlur={(e) => {
                              const v = e.target.value;
                              if (key === 'notes_issues') patch(row.id, key, v);
                              else patch(row.id, key, v === '' ? 0 : parseFloat(v));
                            }}
                            disabled={savingRecordId === row.id}
                          />
                        ) : key === 'notes_issues' ? (
                          <span className="text-left">{String(row[key] ?? '')}</span>
                        ) : (
                          formatNumberFull(row[key] as number)
                        )}
                      </td>
                    ))}
                    {COMPUTED.map(({ key }) => {
                      const isTotal = TOTAL_KEYS.has(key);
                      const marginColorClass =
                        key === 'profit_margin_pct' ? `margin-${marginColor}` : '';
                      return (
                        <td
                          key={key}
                          className={`whitespace-nowrap px-3 py-2 tabular-nums text-right text-sm ${marginColorClass} ${isTotal ? 'font-semibold text-[var(--text)]' : ''}`}
                        >
                          {key === 'profit_margin_pct' ? (
                            <span className={marginPillClass(marginColor)}>
                              {formatPercentFull(row[key] as number)}
                            </span>
                          ) : (
                            formatNumberFull(row[key] as number)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
