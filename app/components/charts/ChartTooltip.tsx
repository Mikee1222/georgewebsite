'use client';

import { formatEurFull } from '@/lib/format';

export interface ChartTooltipPayloadItem {
  name?: string;
  value?: number | string;
  dataKey?: string;
  color?: string;
}

export interface ChartTooltipProps {
  active?: boolean;
  payload?: ChartTooltipPayloadItem[];
  label?: string;
  /** Format value for display. Default: formatEurFull (full precision, no compact) */
  formatter?: (value: number, name: string) => string;
  /** Format label (e.g. x-axis value). Default: identity */
  labelFormatter?: (label: string) => string;
}

/**
 * Shared Recharts tooltip: dark glass card, no black rectangle.
 * Use: <Tooltip content={<ChartTooltip formatter={...} />} cursor={{ fill: 'transparent' }} />
 * For Pie: <Tooltip content={<ChartTooltip formatter={...} />} />
 */
export default function ChartTooltip({
  active,
  payload,
  label,
  formatter = (value: number) => formatEurFull(value),
  labelFormatter = (l: string) => l,
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  return (
    <div
      className="pointer-events-none rounded-xl border border-white/10 px-3 py-2.5 shadow-lg backdrop-blur-md"
      style={{
        background: 'rgba(20,20,20,0.85)',
        fontSize: 12,
      }}
    >
      {label != null && label !== '' && (
        <p className="mb-1.5 text-xs font-medium text-white/90">
          {labelFormatter(String(label))}
        </p>
      )}
      <div className="space-y-0.5">
        {payload.map((item, i) => {
          const value = item.value;
          const num = typeof value === 'number' ? value : Number(value);
          const name = item.name ?? item.dataKey ?? '';
          const displayName = typeof name === 'string' ? name : '';
          const formatted = Number.isFinite(num) ? formatter(num, displayName) : String(value ?? '—');
          return (
            <div key={i} className="flex items-center justify-between gap-3 text-[13px] tabular-nums text-white/95">
              <span className="truncate" style={item.color ? { color: item.color } : undefined}>
                {displayName}
              </span>
              <span className="shrink-0 font-medium">{formatted}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
