/**
 * Proration helpers: overlap days between week and month, share = overlapDays / totalDaysInWeek.
 * Edge-safe (Date only, no Node APIs).
 */

/** Parse YYYY-MM-DD to timestamp at noon UTC. Returns NaN if invalid. */
function parseDate(iso: string): number {
  const d = new Date(iso.trim() + 'T12:00:00Z');
  return d.getTime();
}

/** Inclusive days between two ISO date strings (start and end inclusive). */
function inclusiveDays(start: string, end: string): number {
  const t0 = parseDate(start);
  const t1 = parseDate(end);
  if (Number.isNaN(t0) || Number.isNaN(t1) || t1 < t0) return 0;
  return Math.round((t1 - t0) / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * Month date range from month_key (yyyy-mm).
 * Returns { start, end } as ISO dates (inclusive), or null if invalid.
 */
export function getMonthRange(monthKey: string): { start: string; end: string } | null {
  const m = monthKey?.trim();
  if (!m || !/^\d{4}-\d{2}$/.test(m)) return null;
  const [y, mo] = m.split('-').map(Number);
  const start = `${y}-${String(mo).padStart(2, '0')}-01`;
  const lastDay = new Date(y, mo, 0);
  const end = `${y}-${String(mo).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;
  return { start, end };
}

/**
 * Inclusive overlap days between [weekStart..weekEnd] and [rangeStart..rangeEnd].
 * Dates are ISO YYYY-MM-DD.
 */
export function inclusiveOverlapDays(
  weekStart: string,
  weekEnd: string,
  rangeStart: string,
  rangeEnd: string
): number {
  const ws = parseDate(weekStart);
  const we = parseDate(weekEnd);
  const rs = parseDate(rangeStart);
  const re = parseDate(rangeEnd);
  if (Number.isNaN(ws) || Number.isNaN(we) || Number.isNaN(rs) || Number.isNaN(re) || we < ws || re < rs) return 0;
  const overlapStart = new Date(Math.max(ws, rs));
  const overlapEnd = new Date(Math.min(we, re));
  if (overlapStart.getTime() > overlapEnd.getTime()) return 0;
  const os = overlapStart.toISOString().slice(0, 10);
  const oe = overlapEnd.toISOString().slice(0, 10);
  return inclusiveDays(os, oe);
}

/**
 * Total days in week (inclusive). Typically 7 for a full week.
 */
export function totalDaysInWeek(weekStart: string, weekEnd: string): number {
  const n = inclusiveDays(weekStart.trim(), weekEnd.trim());
  return n > 0 ? n : 7;
}

/**
 * Share of week that falls inside the month: overlapDays / totalDaysInWeek.
 * Returns 0 if monthKey invalid or no overlap.
 */
export function getWeekShareInMonth(weekStart: string, weekEnd: string, monthKey: string): number {
  const range = getMonthRange(monthKey);
  if (!range) return 0;
  const overlap = inclusiveOverlapDays(weekStart, weekEnd, range.start, range.end);
  const total = totalDaysInWeek(weekStart, weekEnd);
  if (total <= 0) return 0;
  return overlap / total;
}
