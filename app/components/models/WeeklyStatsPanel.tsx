'use client';

import { useState, useEffect, useCallback } from 'react';
import { Pencil, ChevronDown } from 'lucide-react';
import SmartSelect from '@/app/components/ui/SmartSelect';
import SkeletonTable from '@/app/components/SkeletonTable';
import SheetForm from '@/app/components/ui/SheetForm';
import { formatEurFull, formatUsdFull, formatShortDate, formatMonthLabel, formatMoneyExact, formatWeekRange } from '@/lib/format';

const ENABLE_MONTHLY_FORECAST = false;

/** Format ISO date (YYYY-MM-DD) to dd/mm/yyyy for European (el-GR) preview. */
function formatDateElGR(isoDate: string): string {
  if (!isoDate || isoDate.length < 10) return '';
  const d = new Date(isoDate + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

type ForecastScenario = 'expected' | 'conservative' | 'aggressive';

interface ModelForecastItem {
  id: string;
  scenario: string;
  projected_net_usd: number;
  projected_gross_usd: number;
  projected_net_eur: number;
  projected_gross_eur: number;
  fx_rate_usd_eur: number;
  source_type: string;
  is_locked: boolean;
  notes: string;
}

export interface WeekRow {
  id: string;
  week_start: string;
  week_end: string;
  week_key?: string;
}

export interface WeeklyStatRow {
  id: string;
  gross_revenue: number;
  net_revenue: number;
  amount_usd: number;
  amount_eur: number;
  /** From Airtable or derived (OF fee 20%). UI always reads this. */
  computed_gross_usd: number;
  /** From Airtable or derived (OF fee 20%). UI always reads this. */
  computed_net_usd: number;
}

export interface WeeklyForecastRow {
  id: string;
  scenario: string;
  projected_net_usd: number;
  projected_net_eur: number;
  projected_gross_usd: number | null;
  projected_gross_eur: number | null;
  fx_rate_usd_eur: number;
  source_type: string;
  is_locked: boolean;
  notes: string;
}

export interface WeeklyStatsPanelProps {
  modelId: string;
  canEdit: boolean;
  monthKey: string;
  months: { id: string; month_key: string; month_name: string }[];
  monthId: string;
  setMonthId: (id: string) => void;
  weeks: WeekRow[];
  stats: Record<string, WeeklyStatRow>;
  forecasts?: Record<string, Record<string, WeeklyForecastRow>>;
  loading: boolean;
  editingWeekId: string | null;
  setEditingWeekId: (id: string | null) => void;
  onLoad: () => void;
  onBeforeStatSave?: () => void;
  onStatSaved?: (record: WeeklyStatRow & { week_id: string }) => void;
}

/** Inline SVG copy icon (no new lib). */
function CopyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

/** Per-week weekly forecast: 3 scenario cards with net usd/eur, source badge, lock, inline edit. */
function WeeklyForecastSection({
  modelId,
  weekId,
  weekKey,
  scenarios,
  forecastsForWeek,
  canEdit,
  onSave,
  saveBusy,
  setSaveBusy,
  lockBusy,
  setLockBusy,
}: {
  modelId: string;
  weekId: string;
  weekKey: string;
  scenarios: string[];
  forecastsForWeek: Record<string, WeeklyForecastRow>;
  canEdit: boolean;
  onSave: () => void;
  saveBusy: string | null;
  setSaveBusy: (k: string | null) => void;
  lockBusy: string | null;
  setLockBusy: (k: string | null) => void;
}) {
  const [editState, setEditState] = useState<Record<string, { netUsd: string; notes: string }>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleSave = async (scenario: string) => {
    const f = forecastsForWeek[scenario];
    const local = editState[`${weekId}:${scenario}`];
    const projected_net_usd = local ? (parseFloat(local.netUsd) || 0) : (f?.projected_net_usd ?? 0);
    const notes = local?.notes ?? f?.notes ?? '';
    setSaveBusy(`${weekId}:${scenario}`);
    try {
      const res = await fetch('/api/weekly-model-forecasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          model_id: modelId,
          week_id: weekId,
          week_key: weekKey,
          scenario,
          projected_net_usd,
          notes,
        }),
      });
      if (res.ok) onSave();
    } finally {
      setSaveBusy(null);
    }
  };

  const handleLockToggle = async (scenario: string) => {
    const f = forecastsForWeek[scenario];
    if (!f) return;
    setLockBusy(`${weekId}:${scenario}`);
    try {
      const res = await fetch('/api/weekly-model-forecasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          model_id: modelId,
          week_id: weekId,
          week_key: weekKey,
          scenario,
          projected_net_usd: f.projected_net_usd,
          notes: f.notes,
          is_locked: !f.is_locked,
        }),
      });
      if (res.ok) onSave();
    } finally {
      setLockBusy(null);
    }
  };

  const handleCopy = (key: string, text: string) => {
    if (typeof navigator?.clipboard?.writeText === 'function') {
      navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    }
  };

  const scenarioTitle = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  return (
    <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
      <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">Weekly forecast</p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {scenarios.map((scenario) => {
          const f = forecastsForWeek[scenario];
          const key = `${weekId}:${scenario}`;
          const local = editState[key];
          const netUsdStr = local?.netUsd ?? (f ? String(f.projected_net_usd) : '');
          const notesStr = local?.notes ?? (f?.notes ?? '');
          const isLocked = f?.is_locked ?? false;
          const busy = saveBusy === key || lockBusy === key;
          const fxRate = f?.fx_rate_usd_eur ?? 0.92;
          const netUsdNum = parseFloat(netUsdStr) || 0;
          const eurPreview = Math.round(netUsdNum * fxRate * 100) / 100;
          const isEmpty = !f;

          return (
            <div
              key={scenario}
              className={`rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)]/60 px-4 py-3 shadow-[var(--shadow-sm)] transition-opacity ${isLocked ? 'opacity-80' : ''}`}
            >
              {/* Top row: title + source pill + lock badge */}
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium capitalize text-[var(--text)]">{scenarioTitle(scenario)}</span>
                <div className="flex items-center gap-1.5">
                  {f && (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                      {f.source_type}
                    </span>
                  )}
                  {isLocked && (
                    <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-400/90">
                      Locked
                    </span>
                  )}
                </div>
              </div>

              {/* Empty state hint */}
              {isEmpty && (
                <p className="mb-2 text-[10px] uppercase tracking-wider text-[var(--text-muted)]/70">No forecast yet</p>
              )}

              {/* Net (USD) label + big input */}
              <label className="block text-xs font-medium text-[var(--text-muted)]">Net (USD)</label>
              <div className="mt-1 flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg)]/80 focus-within:border-[var(--accent)]/50 focus-within:ring-1 focus-within:ring-[var(--accent)]/30">
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={netUsdStr}
                  onChange={(e) => setEditState((prev) => ({ ...prev, [key]: { netUsd: e.target.value, notes: prev[key]?.notes ?? f?.notes ?? '' } }))}
                  disabled={isLocked}
                  placeholder={isEmpty ? '0' : ''}
                  className="w-full min-w-0 border-0 bg-transparent py-2.5 pl-3 pr-1 text-lg font-mono tabular-nums text-[var(--text)] placeholder:text-[var(--text-muted)]/50 outline-none disabled:opacity-70"
                />
                <span className="shrink-0 text-xs font-medium text-[var(--text-muted)]">USD</span>
                <button
                  type="button"
                  onClick={() => handleCopy(`${key}-usd`, String(netUsdNum.toFixed(2)))}
                  className="shrink-0 rounded p-1 text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text)]"
                  title="Copy USD"
                >
                  <CopyIcon className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* EUR preview + copy */}
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-xs tabular-nums text-[var(--text-muted)]">
                  ≈ {formatMoneyExact(eurPreview, 'EUR')}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(`${key}-eur`, String(eurPreview.toFixed(2)))}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text)]"
                  title="Copy EUR"
                >
                  <CopyIcon className="h-3.5 w-3.5" />
                  {copiedKey === `${key}-eur` ? 'Copied' : 'Copy'}
                </button>
              </div>

              {/* Gross (when available) */}
              {(f?.projected_gross_usd != null || f?.projected_gross_eur != null) && (
                <div className="mt-1 text-[10px] tabular-nums text-[var(--text-muted)]/80">
                  Gross: {formatMoneyExact(f?.projected_gross_usd ?? 0, 'USD')} / {formatMoneyExact(f?.projected_gross_eur ?? 0, 'EUR')}
                </div>
              )}

              {/* Notes (unchanged behavior, compact) */}
              {canEdit && (
                <textarea
                  value={notesStr}
                  onChange={(e) => setEditState((prev) => ({ ...prev, [key]: { netUsd: prev[key]?.netUsd ?? netUsdStr, notes: e.target.value } }))}
                  disabled={isLocked}
                  rows={1}
                  className="mt-2 w-full rounded border border-[var(--border)]/80 bg-[var(--bg)]/50 px-2 py-1 text-xs text-[var(--text)] placeholder:text-[var(--text-muted)]/60 outline-none disabled:opacity-70"
                  placeholder="Notes"
                />
              )}

              {/* Footer: Save pill + Lock toggle */}
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2">
                <button
                  type="button"
                  onClick={() => handleSave(scenario)}
                  disabled={busy || isLocked}
                  className="rounded-full bg-[var(--purple-500)]/90 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--purple-600)] disabled:opacity-50 disabled:hover:bg-[var(--purple-500)]/90"
                >
                  {saveBusy === key ? 'Saving…' : 'Save'}
                </button>
                {f ? (
                  <label className="group flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isLocked}
                      onChange={() => {}}
                      onClick={() => handleLockToggle(scenario)}
                      disabled={busy}
                      className="sr-only"
                    />
                    <span className="relative inline-block h-5 w-9 shrink-0 rounded-full">
                      <span className="absolute inset-0 rounded-full bg-white/10 transition-colors group-has-[:checked]:bg-[var(--accent)]/80" />
                      <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform group-has-[:checked]:translate-x-4" />
                    </span>
                    <span className="text-xs text-[var(--text-muted)]">Lock</span>
                  </label>
                ) : (
                  <span className="text-[10px] text-[var(--text-muted)]/60">Save to enable lock</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Weeks manager: add/edit/delete weeks overlapping the selected month. */
function WeeksManagerSection({
  weeks,
  monthKey,
  onAddWeek,
  onEditWeek,
  onDeleteWeek,
}: {
  weeks: WeekRow[];
  monthKey: string;
  onAddWeek: () => void;
  onEditWeek: () => void;
  onDeleteWeek: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [addStart, setAddStart] = useState('');
  const [addEnd, setAddEnd] = useState('');
  const [editWeek, setEditWeek] = useState<WeekRow | null>(null);
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [deleteWeek, setDeleteWeek] = useState<WeekRow | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const openAdd = () => {
    setAddStart('');
    setAddEnd('');
    setAddError(null);
    setAddOpen(true);
  };
  const openEdit = (w: WeekRow) => {
    setEditWeek(w);
    setEditStart(w.week_start);
    setEditEnd(w.week_end);
    setEditError(null);
  };

  const handleAdd = async (week_start: string, week_end: string) => {
    setAddError(null);
    setAddBusy(true);
    try {
      const res = await fetch('/api/weeks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ week_start, week_end }), // week_end accepted but ignored server-side
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAddError((data as { error?: string }).error ?? 'Create failed');
        return;
      }
      setAddOpen(false);
      onAddWeek();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setAddBusy(false);
    }
  };

  const handleEdit = async (weekId: string, week_start: string, week_end: string) => {
    setEditError(null);
    setEditBusy(true);
    try {
      const res = await fetch(`/api/weeks/${weekId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ week_start, week_end }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditError((data as { error?: string }).error ?? 'Update failed');
        return;
      }
      setEditWeek(null);
      onEditWeek();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setEditBusy(false);
    }
  };

  const handleDelete = async (weekId: string, force: boolean) => {
    setDeleteError(null);
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/weeks/${weekId}?force=${force}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeleteError((data as { error?: string }).error ?? 'Delete failed');
        return;
      }
      setDeleteWeek(null);
      onDeleteWeek();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)] px-5 py-4 shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">Weeks manager</h3>
        <button
          type="button"
          onClick={openAdd}
          className="btn-primary rounded-lg px-4 py-2 text-sm font-medium"
        >
          + Add week
        </button>
      </div>
      {weeks.length > 0 && (
        <div className="mt-3 space-y-2">
          {weeks.map((w) => {
            const label = formatWeekRange(w.week_start, w.week_end);
            return (
              <div
                key={w.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-4 py-2"
              >
                <div>
                  <span className="text-sm font-medium text-[var(--text)]">{label}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => openEdit(w)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-[var(--text)] transition hover:bg-white/10"
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => { setDeleteWeek(w); setDeleteError(null); }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(255,80,80,0.4)] bg-transparent px-3 py-1.5 text-sm font-medium text-[#ff5a5a] transition duration-150 hover:border-red-500 hover:bg-[rgba(255,80,80,0.08)] hover:shadow-[0_0_12px_rgba(255,80,80,0.15)]"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add week modal */}
      <SheetForm
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add week"
        subtitle="Enter start and end dates. Month links are computed automatically."
        footer={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleAdd(addStart, addEnd)}
              disabled={addBusy || !addStart || !addEnd || addEnd < addStart}
              className="btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50"
            >
              {addBusy ? 'Creating…' : 'Create'}
            </button>
            <button type="button" onClick={() => setAddOpen(false)} className="btn rounded-lg px-4 py-2 text-sm">
              Cancel
            </button>
            {addError && <p className="w-full text-xs text-[var(--red)]">{addError}</p>}
          </div>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Week start</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={addStart}
                onChange={(e) => setAddStart(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              />
              {addStart && (
                <span className="shrink-0 text-sm text-[var(--text-muted)]" aria-hidden>
                  {formatDateElGR(addStart)}
                </span>
              )}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Week end</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={addEnd}
                onChange={(e) => setAddEnd(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              />
              {addEnd && (
                <span className="shrink-0 text-sm text-[var(--text-muted)]" aria-hidden>
                  {formatDateElGR(addEnd)}
                </span>
              )}
            </div>
          </div>
        </div>
      </SheetForm>

      {/* Edit week modal */}
      {editWeek && (
        <SheetForm
          open={!!editWeek}
          onOpenChange={(open) => !open && setEditWeek(null)}
          title="Edit week"
          subtitle="Update start and end dates."
          footer={
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleEdit(editWeek.id, editStart, editEnd)}
                disabled={editBusy || !editStart || !editEnd || editStart > editEnd}
                className="btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50"
              >
                {editBusy ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={() => setEditWeek(null)} className="btn rounded-lg px-4 py-2 text-sm">
                Cancel
              </button>
              {editError && <p className="w-full text-xs text-[var(--red)]">{editError}</p>}
            </div>
          }
        >
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Week start (yyyy-mm-dd)</label>
              <input
                type="date"
                value={editStart}
                onChange={(e) => setEditStart(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Week end (yyyy-mm-dd)</label>
              <input
                type="date"
                value={editEnd}
                onChange={(e) => setEditEnd(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              />
            </div>
          </div>
        </SheetForm>
      )}

      {/* Delete confirm modal */}
      {deleteWeek && (
        <SheetForm
          open={!!deleteWeek}
          onOpenChange={(open) => !open && (setDeleteWeek(null), setDeleteError(null))}
          title="Delete week"
          subtitle={
            deleteError?.includes('weekly stats')
              ? 'This week has linked stats. Use "Delete week + its stats" to remove the week and all linked stats.'
              : 'Are you sure? This cannot be undone.'
          }
          footer={
            <div className="flex flex-wrap items-center gap-2">
              {deleteError?.includes('weekly stats') ? (
                <button
                  type="button"
                  onClick={() => handleDelete(deleteWeek.id, true)}
                  disabled={deleteBusy}
                  className="rounded-lg border border-[var(--red)] bg-[var(--red)]/20 px-4 py-2 text-sm font-medium text-[var(--red)] hover:bg-[var(--red)]/30 disabled:opacity-50"
                >
                  {deleteBusy ? 'Deleting…' : 'Delete week + its stats'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleDelete(deleteWeek.id, false)}
                  disabled={deleteBusy}
                  className="rounded-lg border border-[var(--red)] bg-[var(--red)]/20 px-4 py-2 text-sm font-medium text-[var(--red)] hover:bg-[var(--red)]/30 disabled:opacity-50"
                >
                  {deleteBusy ? 'Deleting…' : 'Delete week'}
                </button>
              )}
              <button
                type="button"
                onClick={() => (setDeleteWeek(null), setDeleteError(null))}
                disabled={deleteBusy}
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--border-subtle)] disabled:opacity-50"
              >
                Cancel
              </button>
              {deleteError && <p className="w-full text-xs text-[var(--red)]">{deleteError}</p>}
            </div>
          }
        >
          <p className="text-sm text-[var(--text-muted)]">
            Week: {formatWeekRange(deleteWeek.week_start, deleteWeek.week_end)}
          </p>
        </SheetForm>
      )}
    </div>
  );
}

function WeeklyStatForm({
  modelId,
  weekId,
  initial,
  onSave,
  onCancel,
  onBeforeSave,
}: {
  modelId: string;
  weekId: string;
  initial: { gross_revenue: number; net_revenue: number; amount_usd: number };
  onSave: (record: WeeklyStatRow) => void;
  onCancel: () => void;
  onBeforeSave?: () => void;
}) {
  // One of net or gross: pick based on which has value; default to net if both
  const hasNet = (initial.net_revenue ?? 0) > 0;
  const hasGross = (initial.gross_revenue ?? 0) > 0;
  const defaultMode: 'net' | 'gross' = hasNet ? 'net' : 'gross';
  const defaultVal = defaultMode === 'net' ? (initial.net_revenue ?? 0) : (initial.gross_revenue ?? 0);

  const [mode, setMode] = useState<'net' | 'gross'>(defaultMode);
  const [usd, setUsd] = useState(String(defaultVal || ''));
  const [fxRate, setFxRate] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/fx/usd-eur', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { rate?: number } | null) => {
        const rate = typeof data?.rate === 'number' && data.rate > 0 ? data.rate : null;
        setFxRate(rate);
      })
      .catch(() => setFxRate(null));
  }, []);

  const usdVal = Number(usd);
  const amountUsd = Number.isFinite(usdVal) && usdVal >= 0 ? usdVal : 0;
  const eurPreview = fxRate != null && fxRate > 0 && amountUsd > 0
    ? Math.round(amountUsd * fxRate * 100) / 100
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!Number.isFinite(usdVal) || usdVal < 0) {
      setError('Amount (USD) must be ≥ 0');
      return;
    }
    onBeforeSave?.();
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        model_id: modelId,
        week_id: weekId,
      };
      if (mode === 'net') body.net_revenue = usdVal;
      else body.gross_revenue = usdVal;

      const res = await fetch('/api/weekly-model-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error ?? 'Save failed');
        return;
      }
      const record = (data as { record?: WeeklyStatRow & { week_id: string } }).record;
      const computedGross = mode === 'gross' ? usdVal : Math.round((usdVal / 0.8) * 100) / 100;
      const computedNet = mode === 'net' ? usdVal : Math.round((usdVal * 0.8) * 100) / 100;
      if (record) {
        onSave({
          id: record.id,
          gross_revenue: record.gross_revenue ?? 0,
          net_revenue: record.net_revenue ?? 0,
          amount_usd: record.amount_usd ?? usdVal,
          amount_eur: record.amount_eur ?? eurPreview ?? 0,
          computed_gross_usd: record.computed_gross_usd ?? computedGross,
          computed_net_usd: record.computed_net_usd ?? computedNet,
        });
      } else {
        onSave({
          id: '',
          gross_revenue: mode === 'gross' ? usdVal : 0,
          net_revenue: mode === 'net' ? usdVal : 0,
          amount_usd: usdVal,
          amount_eur: eurPreview ?? 0,
          computed_gross_usd: computedGross,
          computed_net_usd: computedNet,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const controlClass =
    'h-12 w-full rounded-2xl bg-white/5 border border-white/10 px-4 text-white placeholder:text-white/30 outline-none transition focus:border-purple-400/60 focus:ring-2 focus:ring-purple-500/20';

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col gap-2 min-w-[120px]">
        <label className="text-xs uppercase tracking-wider text-white/50">Revenue type</label>
        <div className="relative">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as 'net' | 'gross')}
            className={`${controlClass} appearance-none pr-10`}
          >
            <option value="net">Net</option>
            <option value="gross">Gross</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
        </div>
      </div>
      <div className="flex flex-col gap-2 min-w-[160px]">
        <label className="text-xs uppercase tracking-wider text-white/50">
          {mode === 'net' ? 'Net' : 'Gross'} revenue (USD) *
        </label>
        <input
          type="number"
          step="any"
          min={0}
          value={usd}
          onChange={(e) => setUsd(e.target.value)}
          className={`${controlClass} text-lg font-medium tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
          required
        />
        <p className="text-xs text-white/35">USD amount (no rounding)</p>
      </div>
      {eurPreview != null && (
        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-wider text-white/50">EUR (preview)</span>
          <span className="tabular-nums text-sm font-medium text-white/90">{formatEurFull(eurPreview)}</span>
        </div>
      )}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy} className="btn-primary rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="btn rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--border-subtle)]">
          Cancel
        </button>
      </div>
      {error && <p className="w-full text-xs text-[var(--red)]">{error}</p>}
    </form>
  );
}

export default function WeeklyStatsPanel({
  modelId,
  canEdit,
  monthKey,
  months,
  monthId,
  setMonthId,
  weeks,
  stats,
  forecasts = {},
  loading,
  editingWeekId,
  setEditingWeekId,
  onLoad,
  onBeforeStatSave,
  onStatSaved,
}: WeeklyStatsPanelProps) {
  const monthLabel = formatMonthLabel(monthKey) || monthKey;

  const [selectedScenario, setSelectedScenario] = useState<ForecastScenario>('expected');
  const [forecast, setForecast] = useState<ModelForecastItem | null>(null);
  const [localNetUsd, setLocalNetUsd] = useState('');
  const [localGrossUsd, setLocalGrossUsd] = useState('');
  const [localNotes, setLocalNotes] = useState('');
  const [forecastLoadErr, setForecastLoadErr] = useState<string | null>(null);
  const [forecastSaveBusy, setForecastSaveBusy] = useState(false);
  const [forecastRecalcBusy, setForecastRecalcBusy] = useState(false);
  const [weeklyForecastSaveBusy, setWeeklyForecastSaveBusy] = useState<string | null>(null);
  const [weeklyForecastLockBusy, setWeeklyForecastLockBusy] = useState<string | null>(null);

  const fetchForecast = useCallback(async () => {
    if (!modelId || !monthId) {
      setForecast(null);
      return;
    }
    setForecastLoadErr(null);
    try {
      const res = await fetch(
        `/api/model-forecasts?model_id=${encodeURIComponent(modelId)}&month_id=${encodeURIComponent(monthId)}&scenario=${encodeURIComponent(selectedScenario)}`,
        { credentials: 'include' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setForecastLoadErr((data as { error?: string }).error ?? 'Failed to load forecast');
        setForecast(null);
        return;
      }
      const f = (data as { forecast?: ModelForecastItem | null }).forecast ?? null;
      setForecast(f);
      if (f) {
        setLocalNetUsd(String(f.projected_net_usd ?? ''));
        setLocalGrossUsd(String(f.projected_gross_usd ?? ''));
        setLocalNotes(f.notes ?? '');
      } else {
        setLocalNetUsd('');
        setLocalGrossUsd('');
        setLocalNotes('');
      }
    } catch (e) {
      setForecastLoadErr(e instanceof Error ? e.message : 'Failed to load forecast');
      setForecast(null);
    }
  }, [modelId, monthId, selectedScenario]);

  useEffect(() => {
    fetchForecast();
  }, [fetchForecast]);

  const isLocked = forecast?.is_locked ?? false;

  const handleRecalculate = async () => {
    if (!modelId || !monthId) return;
    setForecastRecalcBusy(true);
    setForecastLoadErr(null);
    try {
      const res = await fetch('/api/model-forecasts/recalculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ model_id: modelId, month_id: monthId, scenario: selectedScenario }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setForecastLoadErr('Forecast is locked. Unlock to recalculate.');
        return;
      }
      if (!res.ok) {
        setForecastLoadErr((data as { error?: string }).error ?? 'Recalculate failed');
        return;
      }
      const f = (data as { forecast?: ModelForecastItem }).forecast;
      if (f) {
        setForecast(f);
        setLocalNetUsd(String(f.projected_net_usd ?? ''));
        setLocalGrossUsd(String(f.projected_gross_usd ?? ''));
        setLocalNotes(f.notes ?? '');
      }
      await fetchForecast();
    } catch (e) {
      setForecastLoadErr(e instanceof Error ? e.message : 'Recalculate failed');
    } finally {
      setForecastRecalcBusy(false);
    }
  };

  const handleWeeklyRecalculate = useCallback(async () => {
    if (!modelId || !monthId) return;
    setForecastRecalcBusy(true);
    setForecastLoadErr(null);
    try {
      const res = await fetch(`/api/models/${encodeURIComponent(modelId)}/weekly-forecast/recalculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ month_id: monthId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setForecastLoadErr((data as { error?: string }).error ?? 'Recalculate failed');
        return;
      }
      onLoad();
    } catch (e) {
      setForecastLoadErr(e instanceof Error ? e.message : 'Recalculate failed');
    } finally {
      setForecastRecalcBusy(false);
    }
  }, [modelId, monthId, onLoad]);

  const handleSave = async () => {
    if (!modelId || !monthId) return;
    setForecastSaveBusy(true);
    setForecastLoadErr(null);
    try {
      const res = await fetch('/api/model-forecasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          model_id: modelId,
          month_id: monthId,
          scenario: selectedScenario,
          projected_net_usd: parseFloat(localNetUsd) || 0,
          projected_gross_usd: parseFloat(localGrossUsd) || 0,
          notes: localNotes,
          is_locked: isLocked,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setForecastLoadErr((data as { error?: string }).error ?? 'Save failed');
        return;
      }
      const f = (data as { forecast?: ModelForecastItem }).forecast;
      if (f) {
        setForecast(f);
        setLocalNetUsd(String(f.projected_net_usd ?? ''));
        setLocalGrossUsd(String(f.projected_gross_usd ?? ''));
        setLocalNotes(f.notes ?? '');
      }
      await fetchForecast();
    } catch (e) {
      setForecastLoadErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setForecastSaveBusy(false);
    }
  };

  const handleLockToggle = async () => {
    if (!modelId || !monthId || !forecast) return;
    setForecastSaveBusy(true);
    setForecastLoadErr(null);
    try {
      const res = await fetch('/api/model-forecasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          model_id: modelId,
          month_id: monthId,
          scenario: selectedScenario,
          projected_net_usd: forecast.projected_net_usd,
          projected_gross_usd: forecast.projected_gross_usd,
          notes: localNotes,
          is_locked: !forecast.is_locked,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setForecastLoadErr((data as { error?: string }).error ?? 'Update failed');
        return;
      }
      const f = (data as { forecast?: ModelForecastItem }).forecast;
      if (f) setForecast(f);
      await fetchForecast();
    } catch (e) {
      setForecastLoadErr(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setForecastSaveBusy(false);
    }
  };

  const totals = Object.values(stats).reduce(
    (acc, s) => {
      acc.computed_gross_usd += s.computed_gross_usd ?? 0;
      acc.computed_net_usd += s.computed_net_usd ?? 0;
      acc.amount_eur += s.amount_eur ?? 0;
      return acc;
    },
    { computed_gross_usd: 0, computed_net_usd: 0, amount_eur: 0 }
  );

  const monthOptions = [...months].sort((a, b) => (a.month_key ?? '').localeCompare(b.month_key ?? ''));

  return (
    <div className="space-y-6">
      {ENABLE_MONTHLY_FORECAST && (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)] px-6 py-5 shadow-[var(--shadow-sm)]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Monthly forecast
            </h2>
          </div>
          {!monthId ? (
            <p className="text-sm text-[var(--text-muted)]">Select a month to view or edit forecasts.</p>
          ) : (
            <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">Scenario</label>
                <SmartSelect
                  value={selectedScenario}
                  onChange={(v) => v && setSelectedScenario(v as ForecastScenario)}
                  options={[
                    { value: 'expected', label: 'Expected' },
                    { value: 'conservative', label: 'Conservative' },
                    { value: 'aggressive', label: 'Aggressive' },
                  ]}
                  placeholder="Select scenario"
                />
              </div>
              {canEdit && (
                <>
                  <button
                    type="button"
                    onClick={handleRecalculate}
                    disabled={forecastRecalcBusy || isLocked}
                    className="btn rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--border-subtle)] disabled:opacity-50"
                  >
                    {forecastRecalcBusy ? 'Recalculating…' : 'Recalculate'}
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={forecastSaveBusy}
                    className="btn-primary rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
                  >
                    {forecastSaveBusy ? 'Saving…' : 'Save'}
                  </button>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isLocked}
                      onChange={() => {}}
                      onClick={handleLockToggle}
                      disabled={forecastSaveBusy || !forecast}
                      className="h-4 w-4 rounded border-[var(--border)]"
                    />
                    <span className="text-sm text-[var(--text-muted)]">Lock</span>
                  </label>
                </>
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)]/50 px-4 py-3">
                <label className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">Projected net USD</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={localNetUsd}
                  onChange={(e) => setLocalNetUsd(e.target.value)}
                  disabled={!canEdit || isLocked}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm tabular-nums text-[var(--text)] disabled:opacity-70"
                />
              </div>
              <div className="flex flex-col gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)]/50 px-4 py-3">
                <label className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">Projected gross USD</label>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={localGrossUsd}
                  onChange={(e) => setLocalGrossUsd(e.target.value)}
                  disabled={!canEdit || isLocked}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm tabular-nums text-[var(--text)] disabled:opacity-70"
                />
              </div>
              <div className="flex flex-col gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)]/50 px-4 py-3">
                <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">Projected net EUR</span>
                <span className="tabular-nums text-sm font-medium text-[var(--text)]">
                  {forecast ? formatMoneyExact(forecast.projected_net_eur, 'EUR') : '—'}
                </span>
              </div>
              <div className="flex flex-col gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)]/50 px-4 py-3">
                <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">Projected gross EUR</span>
                <span className="tabular-nums text-sm font-medium text-[var(--text)]">
                  {forecast ? formatMoneyExact(forecast.projected_gross_eur, 'EUR') : '—'}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)]/50 px-4 py-3">
              <label className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">Notes</label>
              <textarea
                value={localNotes}
                onChange={(e) => setLocalNotes(e.target.value)}
                disabled={!canEdit}
                rows={2}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] disabled:opacity-70"
                placeholder="Optional notes"
              />
            </div>
            {forecastLoadErr && (
              <p className="text-sm text-[var(--red)]" role="alert">
                {forecastLoadErr}
              </p>
            )}
          </div>
        )}
        </div>
      )}

      {/* Header: month selector + recalculate weekly forecast */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-3 shadow-[var(--shadow-sm)]">
        <span className="text-sm font-medium text-[var(--text-muted)]">Month</span>
        <SmartSelect
          value={monthId}
          onChange={setMonthId}
          options={monthOptions.map((m) => ({ value: m.id, label: formatMonthLabel(m.month_key) || m.month_key || m.id }))}
          placeholder={months.length === 0 ? '—' : 'Select month'}
          disabled={months.length === 0}
        />
        {canEdit && monthId && (
          <button
            type="button"
            onClick={handleWeeklyRecalculate}
            disabled={forecastRecalcBusy}
            className="btn rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--border-subtle)] disabled:opacity-50"
          >
            {forecastRecalcBusy ? 'Recalculating…' : 'Recalculate weekly forecast'}
          </button>
        )}
      </div>

      {/* Weeks manager — above weekly breakdown */}
      {canEdit && (
        <WeeksManagerSection
          weeks={weeks}
          monthKey={monthKey}
          onAddWeek={onLoad}
          onEditWeek={onLoad}
          onDeleteWeek={onLoad}
        />
      )}

      {loading ? (
        <SkeletonTable cols={5} rows={4} hasFrozenCol />
      ) : weeks.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface)] px-6 py-10 shadow-[var(--shadow-sm)]">
          <p className="text-[var(--text-muted)]">
            {canEdit ? 'No weeks overlapping this month. Add a week above.' : 'No weeks overlapping this month.'}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {weeks.map((w, idx) => {
              const stat = stats[w.id];
              const isEditing = editingWeekId === w.id;
              const weekLabel = formatWeekRange(w.week_start, w.week_end);
              const subtitle = monthKey ? `overlaps ${monthLabel}` : '';

              return (
                <div
                  key={w.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface)] px-5 py-4 shadow-[var(--shadow-sm)]"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--text)]">
                      Week {idx + 1}
                      <span className="ml-2 font-normal text-[var(--text-muted)]">{weekLabel}</span>
                    </p>
                    {subtitle ? (
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">{subtitle}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-1 flex-wrap items-center gap-4">
                    {isEditing ? (
                      <WeeklyStatForm
                        modelId={modelId}
                        weekId={w.id}
                        initial={{
                          gross_revenue: stat?.gross_revenue ?? 0,
                          net_revenue: stat?.net_revenue ?? 0,
                          amount_usd: stat?.amount_usd ?? 0,
                        }}
                        onBeforeSave={onBeforeStatSave}
                        onSave={(record) => {
                          setEditingWeekId(null);
                          if (onStatSaved && record) {
                            onStatSaved({
                              ...record,
                              week_id: w.id,
                            });
                          } else {
                            onLoad();
                          }
                        }}
                        onCancel={() => setEditingWeekId(null)}
                      />
                    ) : stat ? (
                      <>
                        <span className="text-sm text-[var(--text-muted)]">Gross: {formatUsdFull(stat.computed_gross_usd ?? 0)}</span>
                        <span className="text-sm text-[var(--text-muted)]">Net: {formatUsdFull(stat.computed_net_usd ?? 0)}</span>
                        <span className="text-sm text-[var(--text-muted)]">EUR: {formatEurFull(stat.amount_eur ?? 0)}</span>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => setEditingWeekId(w.id)}
                            className="btn-primary rounded-lg px-4 py-2 text-sm font-medium"
                          >
                            Edit
                          </button>
                        )}
                      </>
                    ) : canEdit ? (
                      <button
                        type="button"
                        onClick={() => setEditingWeekId(w.id)}
                        className="btn-primary rounded-lg px-4 py-2 text-sm font-medium"
                      >
                        Add stats
                      </button>
                    ) : (
                      <span className="text-sm text-[var(--text-muted)]">No stats yet</span>
                    )}
                  </div>
                  {/* Weekly forecast: 3 scenarios per week */}
                  <WeeklyForecastSection
                    modelId={modelId}
                    weekId={w.id}
                    weekKey={w.week_key ?? `${w.week_start}_to_${w.week_end}`}
                    scenarios={['expected', 'conservative', 'aggressive']}
                    forecastsForWeek={forecasts[w.id] ?? {}}
                    canEdit={canEdit}
                    onSave={() => onLoad()}
                    saveBusy={weeklyForecastSaveBusy}
                    setSaveBusy={setWeeklyForecastSaveBusy}
                    lockBusy={weeklyForecastLockBusy}
                    setLockBusy={setWeeklyForecastLockBusy}
                  />
                </div>
              );
            })}
          </div>

          {/* Month total section */}
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-6 py-4 shadow-[var(--shadow-sm)]">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
              Month total (from overlapping weeks)
            </p>
            <div className="mt-2 flex flex-wrap gap-6">
              <div>
                <span className="text-xs text-[var(--text-muted)]">Gross USD: </span>
                <span className="tabular-nums font-semibold text-[var(--text)]">{formatUsdFull(totals.computed_gross_usd)}</span>
              </div>
              <div>
                <span className="text-xs text-[var(--text-muted)]">Net USD: </span>
                <span className="tabular-nums font-semibold text-[var(--text)]">{formatUsdFull(totals.computed_net_usd)}</span>
              </div>
              <div>
                <span className="text-xs text-[var(--text-muted)]">EUR: </span>
                <span className="tabular-nums font-semibold text-[var(--text)]">{formatEurFull(totals.amount_eur)}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
