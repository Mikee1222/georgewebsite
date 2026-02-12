'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { AgencyRow, AgencyMasterResponse } from '@/lib/types';
import { formatEurFull, formatUsdFull, formatPercentFull, formatNumberFull } from '@/lib/format';
import { getMarginColor } from '@/lib/business-rules';
import EmptyState from '@/app/components/ui/EmptyState';
import { tableWrapper, tableBase, theadTr, thBase, tbodyTr, tdBase, tdRight } from '@/app/components/ui/table-styles';

type ColDef = {
  key: keyof AgencyRow;
  label: string;
  align?: 'left' | 'right';
  /** If set, cell shows USD primary + EUR subline using row[eurKey]. */
  eurKey?: keyof AgencyRow;
};

const COLS: ColDef[] = [
  { key: 'model_name', label: 'Model', align: 'left' },
  { key: 'revenue_usd', label: 'Revenue', align: 'right', eurKey: 'revenue_eur' },
  { key: 'expenses_usd', label: 'Expenses', align: 'right', eurKey: 'expenses_eur' },
  { key: 'profit_usd', label: 'Profit', align: 'right', eurKey: 'profit_eur' },
  { key: 'profit_margin_pct', label: 'Margin %', align: 'right' },
  { key: 'payout_usd', label: 'Payouts', align: 'right', eurKey: 'payout_eur' },
  { key: 'net_after_payouts_usd', label: 'Net after payouts', align: 'right', eurKey: 'net_after_payouts_eur' },
];

function marginColorClass(margin: number): string {
  const c = getMarginColor(margin, null);
  if (c === 'green') return 'text-[var(--green)]';
  if (c === 'yellow') return 'text-[var(--yellow)]';
  return 'text-[var(--red)]';
}

export default function AgencyGrid({
  rows,
  totals: totalsProp,
  sortKey,
  sortDir,
  onSort,
}: {
  rows: AgencyRow[];
  totals?: AgencyMasterResponse['totals'] | null;
  sortKey: keyof AgencyRow;
  sortDir: 'asc' | 'desc';
  onSort: (key: keyof AgencyRow) => void;
}) {
  const router = useRouter();
  const computedTotals = rows.reduce(
    (acc, r) => ({
      revenue_usd: acc.revenue_usd + (r.revenue_usd ?? 0),
      revenue_eur: acc.revenue_eur + (r.revenue_eur ?? 0),
      expenses_usd: acc.expenses_usd + (r.expenses_usd ?? 0),
      expenses_eur: acc.expenses_eur + (r.expenses_eur ?? 0),
      profit_usd: acc.profit_usd + (r.profit_usd ?? 0),
      profit_eur: acc.profit_eur + (r.profit_eur ?? 0),
      payout_usd: acc.payout_usd + (r.payout_usd ?? 0),
      payout_eur: acc.payout_eur + (r.payout_eur ?? 0),
      net_after_payouts_usd: acc.net_after_payouts_usd + (r.net_after_payouts_usd ?? 0),
      net_after_payouts_eur: acc.net_after_payouts_eur + (r.net_after_payouts_eur ?? 0),
      total_marketing_costs: acc.total_marketing_costs + (r.total_marketing_costs ?? 0),
      chatting_costs_team: acc.chatting_costs_team + (r.chatting_costs_team ?? 0),
      marketing_costs_team: acc.marketing_costs_team + (r.marketing_costs_team ?? 0),
      production_costs_team: acc.production_costs_team + (r.production_costs_team ?? 0),
      ads_spend: acc.ads_spend + (r.ads_spend ?? 0),
    }),
    {
      revenue_usd: 0,
      revenue_eur: 0,
      expenses_usd: 0,
      expenses_eur: 0,
      profit_usd: 0,
      profit_eur: 0,
      payout_usd: 0,
      payout_eur: 0,
      net_after_payouts_usd: 0,
      net_after_payouts_eur: 0,
      total_marketing_costs: 0,
      chatting_costs_team: 0,
      marketing_costs_team: 0,
      production_costs_team: 0,
      ads_spend: 0,
    }
  );
  const marginPct =
    totalsProp && totalsProp.revenue_usd > 0
      ? totalsProp.profit_usd / totalsProp.revenue_usd
      : computedTotals.revenue_usd > 0
        ? computedTotals.profit_usd / computedTotals.revenue_usd
        : 0;
  const totals = totalsProp
    ? {
        revenue_usd: totalsProp.revenue_usd,
        revenue_eur: totalsProp.revenue_eur,
        expenses_usd: totalsProp.expenses_usd,
        expenses_eur: totalsProp.expenses_eur,
        profit_usd: totalsProp.profit_usd,
        profit_eur: totalsProp.profit_eur,
        payout_usd: totalsProp.payout_usd,
        payout_eur: totalsProp.payout_eur,
        net_after_payouts_usd: totalsProp.net_after_payouts_usd,
        net_after_payouts_eur: totalsProp.net_after_payouts_eur,
        total_marketing_costs: computedTotals.total_marketing_costs,
        chatting_costs_team: computedTotals.chatting_costs_team,
        marketing_costs_team: computedTotals.marketing_costs_team,
        production_costs_team: computedTotals.production_costs_team,
        ads_spend: computedTotals.ads_spend,
      }
    : computedTotals;

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No data in this range"
        description="Add pnl_lines records for models and months in Airtable, then refresh."
        action={<Link href="/models" className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-medium text-white/90 ring-purple-400/30 transition hover:bg-white/15 focus:ring-2 inline-block no-underline">Go to models</Link>}
      />
    );
  }

  const t = totals;

  return (
    <div className={`table-wrap table-wrap-scroll-hint overflow-hidden ${tableWrapper}`}>
      <div className="max-h-[calc(100vh-320px)] min-h-[200px] overflow-auto overflow-x-auto">
        <table className={tableBase}>
          <thead>
            <tr className={`${theadTr} bg-white/6`}>
              {COLS.map(({ key, label, align }) => (
                <th
                  key={String(key)}
                  onClick={() => onSort(key)}
                  className={`cursor-pointer select-none ${thBase} ${align === 'right' ? 'text-right' : 'text-left'} hover:bg-white/10 bg-white/6`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {label}
                    {sortKey === key && (
                      <span className="text-purple-300" aria-hidden>
                        {sortDir === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {rows.map((row, idx) => {
              const isModelRow = Boolean(row.is_model ?? (row as { model?: { id: string } }).model?.id ?? (row as { kind?: string }).kind === 'model');
              const handleRowClick = (e: React.MouseEvent<HTMLTableRowElement>) => {
                const target = e.target as HTMLElement;
                if (target.closest('button, a') || window.getSelection()?.toString()) return;
                router.push(`/models/${row.model_id}`);
              };
              const handleRowKeyDown = (e: React.KeyboardEvent<HTMLTableRowElement>) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  router.push(`/models/${row.model_id}`);
                }
              };
              return (
              <tr
                key={row.model_id}
                {...(isModelRow ? { role: 'button' as const, tabIndex: 0, onClick: handleRowClick, onKeyDown: handleRowKeyDown } : {})}
                className={`${isModelRow ? 'cursor-pointer hover:bg-white/5' : ''} ${tbodyTr} ${idx % 2 === 1 ? 'bg-white/[0.03]' : ''}`}
              >
                {COLS.map(({ key, align, eurKey }) => {
                  const isMargin = key === 'profit_margin_pct';
                  const marginVal = row.profit_margin_pct ?? 0;
                  const numVal = typeof row[key] === 'number' ? (row[key] as number) : 0;
                  const isNegative = eurKey != null && numVal < 0;
                  const negClass = isNegative ? 'text-red-400/90' : '';
                  return (
                    <td
                      key={String(key)}
                      className={`${align === 'right' ? tdRight : tdBase} ${isMargin ? marginColorClass(marginVal) : ''} ${negClass}`}
                    >
                      {isMargin ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-90"
                            aria-hidden
                          />
                          {formatPercentFull(marginVal)}
                        </span>
                      ) : key === 'model_name' ? (
                        row.model_name
                      ) : key === 'revenue_usd' && eurKey === 'revenue_eur' && (row.revenue_usd ?? 0) === 0 && (row.revenue_eur ?? 0) === 0 ? (
                        <span className="block text-center text-white/40">—</span>
                      ) : key === 'payout_usd' && eurKey === 'payout_eur' && (row.payout_usd ?? 0) === 0 && (row.payout_eur ?? 0) === 0 ? (
                        <span className="block text-center text-white/40">—</span>
                      ) : eurKey != null ? (
                        <span className="block">
                          <span className="block tabular-nums">{formatUsdFull(Number(row[key] ?? 0))}</span>
                          <span className={`block text-xs tabular-nums ${isNegative ? 'text-red-400/70' : 'text-white/50'}`}>{formatEurFull(Number(row[eurKey] ?? 0))}</span>
                        </span>
                      ) : (
                        (() => {
                          const displayKey = `${String(key)}_display` as keyof AgencyRow;
                          const display = row[displayKey];
                          if (typeof display === 'string') return display;
                          const n = row[key];
                          return typeof n === 'number' ? formatNumberFull(n) : String(row[key] ?? '—');
                        })()
                      )}
                    </td>
                  );
                })}
              </tr>
            );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-white/10 bg-white/[0.08]">
              <td className="px-3 py-4 text-left text-white/90 font-semibold">Total</td>
              <td className={tdRight}>
                <span className="block tabular-nums">{formatUsdFull(t.revenue_usd ?? 0)}</span>
                <span className="block text-xs tabular-nums text-white/50">{formatEurFull(t.revenue_eur ?? 0)}</span>
              </td>
              <td className={tdRight}>
                <span className="block tabular-nums">{formatUsdFull(t.expenses_usd ?? 0)}</span>
                <span className="block text-xs tabular-nums text-white/50">{formatEurFull(t.expenses_eur ?? 0)}</span>
              </td>
              <td className={tdRight}>
                <span className="block tabular-nums">{formatUsdFull(t.profit_usd ?? 0)}</span>
                <span className="block text-xs tabular-nums text-white/50">{formatEurFull(t.profit_eur ?? 0)}</span>
              </td>
              <td className={`${tdRight} text-purple-300`}>{formatPercentFull(marginPct)}</td>
              <td className={tdRight}>
                <span className="block tabular-nums">{formatUsdFull(t.payout_usd ?? 0)}</span>
                <span className="block text-xs tabular-nums text-white/50">{formatEurFull(t.payout_eur ?? 0)}</span>
              </td>
              <td className={tdRight}>
                <span className="block tabular-nums">{formatUsdFull(t.net_after_payouts_usd ?? 0)}</span>
                <span className="block text-xs tabular-nums text-white/50">{formatEurFull(t.net_after_payouts_eur ?? 0)}</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
