/**
 * Airtable REST API client (fetch-based, server-only).
 * Never expose AIRTABLE_TOKEN to the client.
 */

import type { AirtableRecord } from './types';
import type {
  SettingsRecord,
  ModelsRecord,
  MonthsRecord,
  WeeksRecord,
  WeeklyModelStatsRecord,
  WeeklyModelForecastRecord,
  PnlLinesRecordRaw,
  ModelForecastRecord,
  UsersRecord,
  ExpenseEntryRecord,
  RevenueEntryRecord,
  TeamMemberRecord,
  ModelAssignmentRecord,
  AffiliateModelDealRecord,
  TeamMemberPaymentMethodRecord,
  MonthlyMemberBasisRecord,
  AgencyRevenuesRecord,
  PayoutRunRecord,
  PayoutLineRecord,
} from './types';
import type { ModelForecastScenario, ModelForecastSourceType } from './types';
import type { TeamMemberPaymentMethod } from './types';
import type { Role } from './types';

const BASE_URL = 'https://api.airtable.com/v0';

/** Escape a value for safe use inside filterByFormula double-quoted strings. */
function escapeFormulaValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Build Airtable filter formula for linked record field: "field contains recordId".
 * Use this instead of {field}="recXXX" which fails for linked fields.
 * Formula: FIND(recordId & ",", ARRAYJOIN({fieldName}, ",") & ",") > 0
 */
function linkedHasId(fieldName: string, recordId: string): string {
  const escaped = escapeFormulaValue(recordId.trim() + ',');
  return `FIND("${escaped}", ARRAYJOIN({${fieldName}}, ",") & ",") > 0`;
}

/**
 * Build formula for linked record field containing recordId.
 * Note: In Airtable formulas, {model}/{month} may return primary field values (names), not record IDs.
 * For expense_entries we use fetch+filter in code; this helper is for tables where formula works.
 */
function buildLinkedRecordContains(fieldName: string, recordId: string): string {
  const escaped = escapeFormulaValue(recordId.trim());
  return `FIND("${escaped}", ARRAYJOIN({${fieldName}}, ",")) > 0`;
}

function getConfig(): { token: string; baseId: string } {
  const token = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!token || !baseId) throw new Error('AIRTABLE_TOKEN and AIRTABLE_BASE_ID are required');
  return { token, baseId };
}

/**
 * Resolve Airtable table name. No pluralization; case-sensitive.
 * AIRTABLE_TABLE_USERS defaults to literal "users" when unset.
 * AIRTABLE_VIEW_* is never used for user-count checks.
 */
function tableName(key: string): string {
  const envKey = `AIRTABLE_TABLE_${key.toUpperCase()}`;
  const env = process.env[envKey];
  if (env != null && typeof env === 'string' && env.trim() !== '') return env.trim();
  const defaults: Record<string, string> = {
    settings: 'settings',
    models: 'models',
    months: 'months',
    pnl_lines: 'pnl_lines',
    audit_log: 'audit_log',
    users: 'users',
    team_members: process.env.AIRTABLE_TABLE_TEAM_MEMBERS ?? 'team_members',
    expense_entries: process.env.AIRTABLE_TABLE_EXPENSE_ENTRIES ?? 'expense_entries',
    revenue_entries: process.env.AIRTABLE_TABLE_REVENUE_ENTRIES ?? 'revenue_entries',
    monthly_member_basis: process.env.AIRTABLE_TABLE_MONTHLY_MEMBER_BASIS ?? 'monthly_member_basis',
    agency_revenues: process.env.AIRTABLE_TABLE_AGENCY_REVENUES ?? 'agency_revenues', // table name from AIRTABLE_TABLE_AGENCY_REVENUES only
    payout_runs: process.env.AIRTABLE_TABLE_PAYOUT_RUNS ?? 'payout_runs',
    payout_lines: process.env.AIRTABLE_TABLE_PAYOUT_LINES ?? 'payout_lines',
    team_member_payment_methods: process.env.AIRTABLE_TABLE_TEAM_MEMBER_PAYMENT_METHODS ?? 'team_member_payment_methods',
    weeks: process.env.AIRTABLE_TABLE_WEEKS ?? 'weeks',
    weekly_model_stats: process.env.AIRTABLE_TABLE_WEEKLY_MODEL_STATS ?? 'weekly_model_stats',
    weekly_model_forecasts: process.env.AIRTABLE_TABLE_WEEKLY_MODEL_FORECASTS ?? 'weekly_model_forecasts',
    model_forecasts: process.env.AIRTABLE_TABLE_MODEL_FORECASTS ?? 'model_forecasts',
    model_assignments: process.env.AIRTABLE_TABLE_MODEL_ASSIGNMENTS ?? 'model_assignments',
    affiliate_model_deals: process.env.AIRTABLE_TABLE_AFFILIATE_MODEL_DEALS ?? 'affiliate_model_deals',
  };
  return defaults[key] ?? key;
}

/** Resolve Airtable table name for a given key (e.g. for smoke tests / diagnostics). */
export function getTableName(key: string): string {
  return tableName(key);
}

/** Table key for agency_revenues; use this instead of hardcoded strings. */
export const AGENCY_REVENUES_TABLE_KEY = 'agency_revenues';

/** Keys that must never be written to Airtable (avoid INVALID_MULTIPLE_CHOICE_OPTIONS for "eur"/"usd"). */
const CURRENCY_KEYS_BLOCKLIST = new Set([
  'currency',
  'base_currency',
  'display_currency',
  'payout_currency',
]);

/** Allowed field names per table for writes. Unknown keys are dropped; currency keys always dropped. */
const ALLOWED_KEYS_BY_TABLE: Record<string, Set<string>> = {
  team_members: new Set([
   'name',
   'email',
   'role',
   'department',
   'status',
   'notes',
   'monthly_cost',
   'model',
   'linked_models',
   'affiliator_percentage',
   'payout_type',
   'payout_percentage',
   'payout_percentage_chatters',
   'payout_flat_fee',
   'payout_frequency',
   'models_scope',
   'chatting_percentage',
   'chatting_percentage_messages_tips',
   'gunzo_percentage',
   'gunzo_percentage_messages_tips',
   'include_webapp_basis',
   'payout_scope',
  ]),
  model_assignments: new Set(['team_member', 'model']),
  affiliate_model_deals: new Set([
    'team_member', 'model', 'percentage', 'basis', 'is_active', 'start_month', 'end_month', 'notes',
  ]),
  payout_runs: new Set(['month', 'status', 'locked_at', 'paid_at', 'notes']),
  payout_lines: new Set([
    'payout_run', 'team_member', 'model', 'role', 'department',
    'basis_webapp_amount', 'basis_manual_amount', 'bonus_amount', 'adjustments_amount', 'basis_total',
    'payout_type', 'payout_percentage', 'payout_flat_fee', 'payout_amount',
    'amount_usd', 'amount_eur',
    'breakdown_json',
    'gross_usd', 'base_payout_usd', 'bonus_total_usd', 'fine_total_usd',
    'final_payout_usd', 'final_payout_eur', 'fx_rate_usd_eur',
    'paid_status', 'paid_at',
  ]),
  monthly_member_basis: new Set([
    'month', 'team_member', 'basis_type', 'amount', 'amount_usd', 'amount_eur',
    'notes',
  ]),
  weekly_model_stats: new Set([
    'model', 'week', 'gross_revenue', 'net_revenue', 'amount_usd', 'amount_eur',
  ]),
  weeks: new Set(['week_start', 'months']), // week_end is computed in Airtable — never write it
  pnl_lines: new Set([
    'model', 'month', 'status',
    'gross_revenue', 'net_revenue', 'chatting_costs_team', 'marketing_costs_team', 'production_costs_team',
    'ads_spend', 'other_marketing_costs', 'salary', 'affiliate_fee', 'bonuses',
    'airbnbs', 'softwares', 'fx_withdrawal_fees', 'other_costs', 'notes_issues',
  ]),
  team_member_payment_methods: new Set([
    'team_member', 'method_label', 'payout_method', 'beneficiary_name', 'iban_or_account',
    'revtag', 'status', 'notes', 'is_default',
  ]),
  weekly_model_forecasts: new Set([
    'model', 'week', 'scenario', 'projected_net_usd', 'projected_gross_usd',
    'projected_net_eur', 'projected_gross_eur', 'fx_rate_usd_eur', 'source_type', 'is_locked', 'notes',
  ]),
  model_forecasts: new Set([
    'model', 'month', 'scenario', 'projected_net_usd', 'projected_gross_usd',
    'projected_net_eur', 'projected_gross_eur', 'fx_rate_usd_eur', 'source_type', 'is_locked', 'notes', 'updated_at',
  ]),
};

/**
 * Before sending to Airtable: drop unknown keys for this table and always drop any currency select key.
 * Prevents INVALID_MULTIPLE_CHOICE_OPTIONS when Airtable has no "eur"/"usd" option.
 */
export function pickKnownFields(tableKey: string, payload: Record<string, unknown>): Record<string, unknown> {
  const allowed = ALLOWED_KEYS_BY_TABLE[tableKey];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (CURRENCY_KEYS_BLOCKLIST.has(k)) continue;
    if (allowed && !allowed.has(k)) continue;
    out[k] = v;
  }
  return out;
}

/** Payout tables must NEVER receive amount or currency. Hard guard before any create/update. */
const PAYOUT_TABLE_KEYS = new Set(['payout_runs', 'payout_lines']);

function stripPayoutLegacyFields(tableKey: string, payload: Record<string, unknown>): void {
  if (PAYOUT_TABLE_KEYS.has(tableKey)) {
    delete payload.amount;
    delete payload.currency;
  }
}

async function airtableFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<{ records: AirtableRecord<T>[]; offset?: string }> {
  const { token, baseId } = getConfig();
  const url = `${BASE_URL}/${baseId}/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable ${res.status}: ${text}`);
  }
  return res.json();
}

const AIRTABLE_DISPLAY_LOCALE = 'en-US';
const AIRTABLE_DISPLAY_TIMEZONE = 'Europe/Athens';

/** GET list with optional filterByFormula and pagination. Optional cellFormat=string returns user-facing strings (requires userLocale + timeZone). */
export async function listRecords<T>(
  tableKey: string,
  opts: {
    view?: string;
    filterByFormula?: string;
    sort?: { field: string; direction?: 'asc' | 'desc' }[];
    maxRecords?: number;
    fields?: string[];
    cellFormat?: 'json' | 'string';
    userLocale?: string;
    timeZone?: string;
  } = {}
): Promise<AirtableRecord<T>[]> {
  const table = tableName(tableKey);
  const params = new URLSearchParams();
  if (opts.view) params.set('view', opts.view);
  if (opts.filterByFormula) params.set('filterByFormula', opts.filterByFormula);
  if (opts.maxRecords) params.set('maxRecords', String(opts.maxRecords));
  if (opts.fields?.length) {
    for (const f of opts.fields) params.append('fields[]', f);
  }
  if (opts.sort?.length) {
    params.set('sort[0][field]', opts.sort[0].field);
    params.set('sort[0][direction]', opts.sort[0].direction ?? 'asc');
  }
  if (opts.cellFormat === 'string') {
    params.set('cellFormat', 'string');
    params.set('userLocale', opts.userLocale ?? AIRTABLE_DISPLAY_LOCALE);
    params.set('timeZone', opts.timeZone ?? AIRTABLE_DISPLAY_TIMEZONE);
  }
  const query = params.toString();
  const path = `${encodeURIComponent(table)}${query ? `?${query}` : ''}`;
  const out: AirtableRecord<T>[] = [];
  let offset: string | undefined;
  do {
    const url = offset ? `${path}${path.includes('?') ? '&' : '?'}offset=${offset}` : path;
    const data = await airtableFetch<T>(url);
    out.push(...data.records);
    offset = data.offset;
  } while (offset);
  return out;
}

/** GET single record by id. Optional cellFormat=string returns user-facing strings (requires userLocale + timeZone). */
export async function getRecord<T>(
  tableKey: string,
  recordId: string,
  opts: { cellFormat?: 'json' | 'string'; userLocale?: string; timeZone?: string } = {}
): Promise<AirtableRecord<T> | null> {
  const table = tableName(tableKey);
  const { token, baseId } = getConfig();
  const params = new URLSearchParams();
  if (opts.cellFormat === 'string') {
    params.set('cellFormat', 'string');
    params.set('userLocale', opts.userLocale ?? AIRTABLE_DISPLAY_LOCALE);
    params.set('timeZone', opts.timeZone ?? AIRTABLE_DISPLAY_TIMEZONE);
  }
  const query = params.toString();
  const url = `${BASE_URL}/${baseId}/${encodeURIComponent(table)}/${recordId}${query ? `?${query}` : ''}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
  return res.json();
}

/** PATCH update record (partial fields). Payload is filtered via pickKnownFields before send. */
export async function updateRecord(
  tableKey: string,
  recordId: string,
  fields: Record<string, unknown>
): Promise<AirtableRecord<unknown>> {
  const table = tableName(tableKey);
  const safeFields = pickKnownFields(tableKey, fields);
  stripPayoutLegacyFields(tableKey, safeFields);
  const { token, baseId } = getConfig();
  const res = await fetch(`${BASE_URL}/${baseId}/${encodeURIComponent(table)}/${recordId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: safeFields }),
  });
  if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
  return res.json();
}

/** POST create record. Payload is filtered via pickKnownFields before send. */
export async function createRecord(
  tableKey: string,
  fields: Record<string, unknown>
): Promise<AirtableRecord<unknown>> {
  const table = tableName(tableKey);
  const safeFields = pickKnownFields(tableKey, fields);
  stripPayoutLegacyFields(tableKey, safeFields);
  const { token, baseId } = getConfig();
  const res = await fetch(`${BASE_URL}/${baseId}/${encodeURIComponent(table)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: safeFields }),
  });
  if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.records?.[0] ?? data;
}

// --- Settings cache (one record per setting_name; key-value pairs) ---
let settingsCache: { rows: SettingsRecord[]; ts: number } | null = null;
const SETTINGS_CACHE_MS = 5 * 60 * 1000; // 5 min

/** Settings table: one record per setting_name. Fetched once and cached server-side. Returns [] if no records. */
export async function getSettings(): Promise<SettingsRecord[]> {
  const now = Date.now();
  if (settingsCache && now - settingsCache.ts < SETTINGS_CACHE_MS) {
    return settingsCache.rows;
  }
  const records = await listRecords<SettingsRecord>('settings');
  const rows = records.map((r) => r.fields);
  settingsCache = { rows, ts: now };
  return rows;
}

/** Models table. Returns [] if no records. */
export async function getModels(): Promise<AirtableRecord<ModelsRecord>[]> {
  return listRecords<ModelsRecord>('models', { sort: [{ field: 'name', direction: 'asc' }] });
}

export async function getModel(recordId: string): Promise<AirtableRecord<ModelsRecord> | null> {
  return getRecord<ModelsRecord>('models', recordId);
}

export async function createModel(fields: {
  name: string;
  status?: string;
  compensation_type?: string;
  creator_payout_pct?: number;
  salary_eur?: number;
  salary_usd?: number;
  deal_threshold?: number;
  deal_flat_under_threshold?: number;
  deal_flat_under_threshold_usd?: number;
  deal_percent_above_threshold?: number;
  notes?: string;
}): Promise<AirtableRecord<ModelsRecord>> {
  const payload: Record<string, unknown> = { name: fields.name };
  if (fields.status != null) payload.status = fields.status;
  if (fields.compensation_type != null) payload.compensation_type = fields.compensation_type;
  if (fields.creator_payout_pct != null) payload.creator_payout_pct = fields.creator_payout_pct;
  if (fields.salary_eur != null) payload.salary_eur = fields.salary_eur;
  if (fields.salary_usd != null) payload.salary_usd = fields.salary_usd;
  if (fields.deal_threshold != null) payload.deal_threshold = fields.deal_threshold;
  if (fields.deal_flat_under_threshold != null) payload.deal_flat_under_threshold = fields.deal_flat_under_threshold;
  if (fields.deal_flat_under_threshold_usd != null) payload.deal_flat_under_threshold_usd = fields.deal_flat_under_threshold_usd;
  if (fields.deal_percent_above_threshold != null) payload.deal_percent_above_threshold = fields.deal_percent_above_threshold;
  if (fields.notes != null) payload.notes = fields.notes;
  return createRecord('models', payload) as Promise<AirtableRecord<ModelsRecord>>;
}

export async function updateModel(
  recordId: string,
  fields: Partial<{ name: string; status: string; compensation_type: string; creator_payout_pct: number; salary_eur: number; salary_usd: number; deal_threshold: number; deal_flat_under_threshold: number; deal_flat_under_threshold_usd: number; deal_percent_above_threshold: number; notes: string }>
): Promise<AirtableRecord<ModelsRecord>> {
  return updateRecord('models', recordId, fields as Record<string, unknown>) as Promise<AirtableRecord<ModelsRecord>>;
}

/**
 * Months table. Used by pnl_lines (month link), expense_entries (month link), and agency/overview.
 * Returns [] if no records.
 */
export async function getMonths(): Promise<AirtableRecord<MonthsRecord>[]> {
  return listRecords<MonthsRecord>('months', { sort: [{ field: 'month_key', direction: 'asc' }] });
}

/**
 * Month keys in range (inclusive). Queries months table; returns sorted month_key strings.
 * Returns [] if from/to empty or no months in range (no crash).
 */
export async function getMonthKeysInRange(
  from_month_key: string,
  to_month_key: string
): Promise<string[]> {
  if (!from_month_key?.trim() || !to_month_key?.trim()) return [];
  const records = await getMonths();
  const from = from_month_key.trim();
  const to = to_month_key.trim();
  const keys = records
    .map((r) => r.fields.month_key ?? '')
    .filter((k) => k >= from && k <= to)
    .sort((a, b) => a.localeCompare(b));
  return keys;
}

/**
 * Month record ids in range (for expense_entries/revenue_entries month link filter).
 * Returns [] if from/to empty or no months in range (no crash).
 */
export async function getMonthRecordIdsInRange(
  from_month_key: string,
  to_month_key: string
): Promise<string[]> {
  if (!from_month_key?.trim() || !to_month_key?.trim()) return [];
  const records = await getMonths();
  const from = from_month_key.trim();
  const to = to_month_key.trim();
  const inRange = records.filter((r) => {
    const k = r.fields.month_key ?? '';
    return k >= from && k <= to;
  });
  return inRange.map((r) => r.id);
}

/**
 * Derive week_key from week_start/week_end (app-side; avoids Airtable formula #error).
 * Format: "2026-01-29_to_2026-02-04" or "2026-w05 (jan 29 - feb 04)".
 */
export function deriveWeekKey(weekStart: string | undefined, weekEnd: string | undefined): string {
  const start = weekStart?.trim();
  const end = weekEnd?.trim();
  if (!start || !end) return start || end || '';
  return `${start}_to_${end}`;
}

/**
 * Get month date range from month_key (yyyy-mm). Returns ISO date strings.
 */
function monthKeyToRange(monthKey: string): { start: string; end: string } | null {
  const m = monthKey?.trim();
  if (!m || !/^\d{4}-\d{2}$/.test(m)) return null;
  const [y, mo] = m.split('-').map(Number);
  const start = `${y}-${String(mo).padStart(2, '0')}-01`;
  const lastDay = new Date(y, mo, 0);
  const end = `${y}-${String(mo).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;
  return { start, end };
}

/** Airtable field keys for weeks (read-only). week_key derived in app. */
const WEEKS_READ_KEYS = ['week_start', 'week_end'] as const;

/**
 * Weeks overlapping a month. Fetches all weeks, filters in app.
 * Week overlaps month if week_start <= month_end AND week_end >= month_start.
 */
export async function getWeeksOverlappingMonth(monthKey: string): Promise<Array<{ id: string; week_start: string; week_end: string; week_key: string }>> {
  if (process.env.NODE_ENV === 'development') {
    console.log('[airtable] weeks READ keys:', WEEKS_READ_KEYS.join(', '));
  }
  const range = monthKeyToRange(monthKey);
  if (!range) return [];
  const records = await listRecords<WeeksRecord>('weeks', {
    sort: [{ field: 'week_start', direction: 'asc' }],
  });
  const out: Array<{ id: string; week_start: string; week_end: string; week_key: string }> = [];
  for (const r of records) {
    const start = r.fields.week_start?.trim();
    const end = r.fields.week_end?.trim();
    if (!start || !end) continue;
    if (start <= range.end && end >= range.start) {
      out.push({
        id: r.id,
        week_start: start,
        week_end: end,
        week_key: deriveWeekKey(start, end),
      });
    }
  }
  return out;
}

/**
 * Month record IDs that overlap a week date range. Week overlaps month if
 * week_start <= month_end AND week_end >= month_start.
 */
export async function getMonthIdsOverlappingWeekRange(
  weekStart: string,
  weekEnd: string
): Promise<string[]> {
  const start = weekStart?.trim();
  const end = weekEnd?.trim();
  if (!start || !end || start > end) return [];
  const records = await getMonths();
  const out: string[] = [];
  for (const r of records) {
    const range = monthKeyToRange(r.fields.month_key ?? '');
    if (!range) continue;
    if (start <= range.end && end >= range.start) out.push(r.id);
  }
  return out;
}

/** Derive week_end from week_start (week_start + 6 days). Used for overlap calculations only. */
function deriveWeekEndFromStart(weekStart: string): string {
  const d = new Date(weekStart.trim() + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}

/**
 * Create a week record. Only sends week_start to Airtable (week_end is computed).
 * Derives week_end in code for overlap calculations.
 */
export async function createWeek(weekStart: string): Promise<AirtableRecord<WeeksRecord>> {
  const start = weekStart?.trim();
  if (!start) throw new Error('week_start is required');
  const end = deriveWeekEndFromStart(start);
  if (!end || start > end) throw new Error('Invalid week_start');
  const monthIds = await getMonthIdsOverlappingWeekRange(start, end);
  const payload: Record<string, unknown> = { week_start: start };
  if (monthIds.length > 0) payload.months = monthIds;
  const created = await createRecord('weeks', payload);
  return created as AirtableRecord<WeeksRecord>;
}

/**
 * Update a week record. Only sends week_start to Airtable (week_end is computed).
 * Accepts week_end in fields but ignores it; derives from week_start for overlap calculations.
 */
export async function updateWeek(
  weekId: string,
  fields: { week_start?: string; week_end?: string }
): Promise<AirtableRecord<WeeksRecord>> {
  const existing = await getRecord<WeeksRecord>('weeks', weekId);
  if (!existing) throw new Error('Week not found');
  const finalStart = fields.week_start?.trim() ?? existing.fields.week_start?.trim() ?? '';
  if (!finalStart) throw new Error('week_start is required');
  const finalEnd = deriveWeekEndFromStart(finalStart);
  if (!finalEnd || finalStart > finalEnd) throw new Error('Invalid week_start');
  const monthIds = await getMonthIdsOverlappingWeekRange(finalStart, finalEnd);
  const payload: Record<string, unknown> = {
    week_start: finalStart,
    months: monthIds.length > 0 ? monthIds : [],
  };
  const updated = await updateRecord('weeks', weekId, payload);
  return updated as AirtableRecord<WeeksRecord>;
}

/**
 * Count weekly_model_stats records linked to a week.
 */
export async function countWeeklyStatsForWeek(weekId: string): Promise<number> {
  if (!weekId?.trim()) return 0;
  const records = await getWeeklyStatsForWeeks([weekId]);
  return records.length;
}

/**
 * Delete all weekly_model_stats records linked to a week.
 */
export async function deleteWeeklyStatsForWeek(weekId: string): Promise<number> {
  if (!weekId?.trim()) return 0;
  const records = await getWeeklyStatsForWeeks([weekId]);
  let deleted = 0;
  for (const r of records) {
    await deleteRecordById('weekly_model_stats', r.id);
    deleted++;
  }
  return deleted;
}

/**
 * Delete a week record. Throws if weekly_model_stats exist unless force=true.
 */
export async function deleteWeek(weekId: string, force = false): Promise<void> {
  const count = await countWeeklyStatsForWeek(weekId);
  if (count > 0 && !force) {
    throw new Error(`Cannot delete: ${count} weekly stats linked to this week. Use force=true to delete week and its stats.`);
  }
  if (count > 0 && force) {
    await deleteWeeklyStatsForWeek(weekId);
  }
  await deleteRecordById('weeks', weekId);
}

/**
 * All weekly_model_stats for weeks in weekIds. Used for bulk forecast projection.
 * OR formula limited to ~100 weeks to stay under Airtable formula length.
 */
export async function getWeeklyStatsForWeeks(
  weekIds: string[]
): Promise<AirtableRecord<WeeklyModelStatsRecord>[]> {
  const ids = [...new Set(weekIds.map((id) => id.trim()).filter(Boolean))].slice(0, 100);
  if (ids.length === 0) return [];
  const orClauses = ids.map((id) => linkedHasId('week', id)).join(', ');
  const formula = `OR(${orClauses})`;
  if (process.env.NODE_ENV === 'development') {
    console.log('[airtable getWeeklyStatsForWeeks] filterByFormula:', formula);
  }
  return listRecords<WeeklyModelStatsRecord>('weekly_model_stats', {
    filterByFormula: formula,
    sort: [{ field: 'week', direction: 'asc' }],
  });
}

/** Airtable field keys for weekly_model_stats: read and write. */
const WEEKLY_STATS_READ_KEYS = ['model', 'week', 'gross_revenue', 'net_revenue', 'amount_usd', 'amount_eur'] as const;
const WEEKLY_STATS_WRITE_KEYS = ['model', 'week', 'gross_revenue', 'net_revenue', 'amount_usd', 'amount_eur'] as const;

/** Normalize linked-record fields: model and week are string[] (never Number/parseInt). */
function normalizeWeeklyModelStatsFields(fields: Record<string, unknown>): WeeklyModelStatsRecord {
  const model = Array.isArray(fields.model) ? (fields.model as string[]) : [];
  const week = Array.isArray(fields.week) ? (fields.week as string[]) : [];
  return {
    ...fields,
    model,
    week,
  } as WeeklyModelStatsRecord;
}

/**
 * Weekly model stats for a model and weeks. Fetches by week IDs (getWeeklyStatsForWeeks);
 * filters in Node by modelId === fields.model?.[0] and weekId in weekIds. Stats key = week record id.
 */
export async function getWeeklyStatsByModelAndWeeks(
  modelId: string,
  weekIds: string[]
): Promise<AirtableRecord<WeeklyModelStatsRecord>[]> {
  if (!modelId?.trim()) return [];
  const weekIdSet = new Set(weekIds.map((id) => id.trim()).filter(Boolean));
  if (weekIdSet.size === 0) return [];
  let rawRecords = await getWeeklyStatsForWeeks([...weekIdSet]);
  if (rawRecords.length === 0 && weekIdSet.size > 0) {
    rawRecords = await listRecords<WeeklyModelStatsRecord>('weekly_model_stats', {
      sort: [{ field: 'week', direction: 'asc' }],
      fields: [...WEEKLY_STATS_READ_KEYS],
      maxRecords: 1000,
    });
    if (process.env.NODE_ENV === 'development' && rawRecords.length > 0) {
      console.log('[airtable getWeeklyStatsByModelAndWeeks] fallback: no formula, fetched', rawRecords.length, 'records');
    }
  }
  if (process.env.NODE_ENV === 'development') {
    console.log('[airtable getWeeklyStatsByModelAndWeeks] raw records from Airtable (before filter):', rawRecords.length);
    rawRecords.slice(0, 3).forEach((r, i) => {
      console.log(`  [${i}] id=${r.id} model=${JSON.stringify(r.fields?.model)} week=${JSON.stringify(r.fields?.week)}`);
    });
  }
  const normalized = rawRecords.map((r) => ({
    ...r,
    fields: normalizeWeeklyModelStatsFields(r.fields as Record<string, unknown>),
  })) as AirtableRecord<WeeklyModelStatsRecord>[];
  const modelIdTrim = modelId.trim();
  const filtered = normalized.filter((r) => {
    const weekId = r.fields.week?.[0] ?? null;
    const recordModelId = r.fields.model?.[0] ?? null;
    return recordModelId === modelIdTrim && weekId !== null && weekIdSet.has(weekId);
  });
  if (rawRecords.length > 0 && filtered.length === 0 && process.env.NODE_ENV === 'development') {
    const sampleWeekIds = normalized.slice(0, 5).map((r) => r.fields.week?.[0] ?? '(missing)');
    console.warn('[airtable getWeeklyStatsByModelAndWeeks] records returned > 0 but after filter = 0; sample week ids:', sampleWeekIds, 'requested modelId:', modelIdTrim, 'weekIdSet size:', weekIdSet.size);
  }
  return filtered;
}

/**
 * Find weekly_model_stats by model + week. Returns null if not found.
 */
export async function getWeeklyStatByModelAndWeek(
  modelId: string,
  weekId: string
): Promise<AirtableRecord<WeeklyModelStatsRecord> | null> {
  if (!modelId?.trim() || !weekId?.trim()) return null;
  const formula = `AND(${linkedHasId('model', modelId.trim())}, ${linkedHasId('week', weekId.trim())})`;
  if (process.env.NODE_ENV === 'development') {
    console.log('[airtable getWeeklyStatByModelAndWeek] filterByFormula:', formula);
  }
  const records = await listRecords<WeeklyModelStatsRecord>('weekly_model_stats', {
    filterByFormula: formula,
    maxRecords: 1,
  });
  return records[0] ?? null;
}

/**
 * Upsert weekly_model_stats: update if exists, else create.
 * gross_revenue/net_revenue can be null to clear (when user provides only the other).
 */
export async function upsertWeeklyModelStats(
  modelId: string,
  weekId: string,
  fields: { gross_revenue?: number | null; net_revenue?: number | null; amount_usd?: number; amount_eur?: number }
): Promise<AirtableRecord<WeeklyModelStatsRecord>> {
  if (process.env.NODE_ENV === 'development') {
    console.log('[airtable] weekly_model_stats WRITE keys:', WEEKLY_STATS_WRITE_KEYS.join(', '));
  }
  const existing = await getWeeklyStatByModelAndWeek(modelId, weekId);
  const payload: Record<string, unknown> = {
    model: [modelId],
    week: [weekId],
    ...fields,
  };
  if (existing) {
    const updated = await updateRecord('weekly_model_stats', existing.id, payload);
    return updated as AirtableRecord<WeeklyModelStatsRecord>;
  }
  const created = await createRecord('weekly_model_stats', payload);
  return created as AirtableRecord<WeeklyModelStatsRecord>;
}

/** Allowed scenario and source_type values for weekly_model_forecasts (do not create new Airtable options). */
const WEEKLY_FORECAST_SCENARIOS = new Set<string>(['expected', 'conservative', 'aggressive']);
const WEEKLY_FORECAST_SOURCE_TYPES = new Set<string>(['auto', 'manual', 'hybrid']);

/**
 * Fetch weekly_model_forecasts for model and weeks. Filter by model in Airtable (or fetch all and filter in code).
 */
export async function getWeeklyForecastsByModelAndWeeks(
  modelId: string,
  weekIds: string[]
): Promise<AirtableRecord<WeeklyModelForecastRecord>[]> {
  if (!modelId?.trim()) return [];
  const weekIdSet = new Set(weekIds.map((id) => id.trim()).filter(Boolean));
  if (weekIdSet.size === 0) return [];
  const modelIdTrim = modelId.trim();
  let rawRecords: AirtableRecord<WeeklyModelForecastRecord>[];
  const formulaByModel = linkedHasId('model', modelIdTrim);
  rawRecords = await listRecords<WeeklyModelForecastRecord>('weekly_model_forecasts', {
    filterByFormula: formulaByModel,
    sort: [{ field: 'week', direction: 'asc' }],
  });
  if (rawRecords.length === 0 && weekIdSet.size > 0) {
    rawRecords = await listRecords<WeeklyModelForecastRecord>('weekly_model_forecasts', {
      sort: [{ field: 'week', direction: 'asc' }],
      maxRecords: 1000,
    });
    if (process.env.NODE_ENV === 'development' && rawRecords.length > 0) {
      console.log('[airtable getWeeklyForecastsByModelAndWeeks] formula returned 0, fallback fetched', rawRecords.length);
    }
  }
  return rawRecords.filter((r) => {
    const weekId = Array.isArray(r.fields.week) ? r.fields.week[0] : undefined;
    const recordModelId = Array.isArray(r.fields.model) ? r.fields.model[0] : undefined;
    return recordModelId === modelIdTrim && weekId && weekIdSet.has(weekId);
  });
}

/**
 * Find weekly_model_forecasts record by unique_key (model_id-week_key-scenario).
 */
export async function getWeeklyForecastByUniqueKey(
  uniqueKey: string
): Promise<AirtableRecord<WeeklyModelForecastRecord> | null> {
  if (!uniqueKey?.trim()) return null;
  const records = await listRecords<WeeklyModelForecastRecord>('weekly_model_forecasts', {
    filterByFormula: `ARRAYJOIN({unique_key},"")="${escapeFormulaValue(uniqueKey.trim())}"`,
    maxRecords: 1,
  });
  return records[0] ?? null;
}

/**
 * Upsert weekly_model_forecasts: one row per (model, week, scenario). unique_key = modelId-weekKey-scenario.
 */
export async function upsertWeeklyForecast(
  modelId: string,
  weekId: string,
  weekKey: string,
  scenario: string,
  payload: {
    projected_net_usd?: number;
    projected_gross_usd?: number | null;
    projected_net_eur?: number;
    projected_gross_eur?: number | null;
    fx_rate_usd_eur?: number;
    source_type?: string;
    is_locked?: boolean;
    notes?: string;
  }
): Promise<AirtableRecord<WeeklyModelForecastRecord>> {
  const scenarioVal = WEEKLY_FORECAST_SCENARIOS.has(scenario) ? scenario : 'expected';
  const uniqueKey = `${modelId.trim()}-${weekKey.trim()}-${scenarioVal}`;
  const existing = await getWeeklyForecastByUniqueKey(uniqueKey);
  const safePayload: Record<string, unknown> = {
    model: [modelId.trim()],
    week: [weekId.trim()],
    scenario: scenarioVal,
  };
  if (payload.projected_net_usd != null && Number.isFinite(payload.projected_net_usd)) safePayload.projected_net_usd = Math.round(payload.projected_net_usd * 100) / 100;
  if (payload.projected_gross_usd != null && Number.isFinite(payload.projected_gross_usd)) safePayload.projected_gross_usd = Math.round(payload.projected_gross_usd * 100) / 100;
  if (payload.projected_net_eur != null && Number.isFinite(payload.projected_net_eur)) safePayload.projected_net_eur = Math.round(payload.projected_net_eur * 100) / 100;
  if (payload.projected_gross_eur != null && Number.isFinite(payload.projected_gross_eur)) safePayload.projected_gross_eur = Math.round(payload.projected_gross_eur * 100) / 100;
  if (payload.fx_rate_usd_eur != null && Number.isFinite(payload.fx_rate_usd_eur)) safePayload.fx_rate_usd_eur = Math.round(payload.fx_rate_usd_eur * 1e6) / 1e6;
  if (payload.source_type != null && WEEKLY_FORECAST_SOURCE_TYPES.has(payload.source_type)) safePayload.source_type = payload.source_type;
  if (payload.is_locked != null) safePayload.is_locked = Boolean(payload.is_locked);
  if (payload.notes !== undefined) safePayload.notes = typeof payload.notes === 'string' ? payload.notes : '';

  const filtered = pickKnownFields('weekly_model_forecasts', safePayload);
  if (existing) {
    const updated = await updateRecord('weekly_model_forecasts', existing.id, filtered);
    return updated as AirtableRecord<WeeklyModelForecastRecord>;
  }
  const created = await createRecord('weekly_model_forecasts', filtered);
  return created as AirtableRecord<WeeklyModelForecastRecord>;
}

/**
 * PnL lines for a model. pnl_lines.month links to months table.
 * Guard: returns [] if modelId is empty or status is invalid.
 */
export async function getPnlForModel(
  modelId: string,
  status: 'actual' | 'forecast'
): Promise<AirtableRecord<PnlLinesRecordRaw>[]> {
  if (!modelId?.trim()) return [];
  if (status !== 'actual' && status !== 'forecast') return [];
  const formula = `AND(ARRAYJOIN({model_id_lookup},"")="${escapeFormulaValue(modelId.trim())}", {status}="${escapeFormulaValue(status)}")`;
  return listRecords<PnlLinesRecordRaw>('pnl_lines', {
    filterByFormula: formula,
    sort: [{ field: 'month_key_lookup', direction: 'asc' }],
  });
}

/**
 * PnL lines in month range. pnl_lines.month_key_lookup from months.
 * Optional status: 'actual' | 'forecast' to filter by status only.
 * Guard: returns [] if fromMonth or toMonth is empty.
 */
export async function getPnlInRange(
  fromMonth: string,
  toMonth: string,
  opts?: { status?: 'actual' | 'forecast' }
): Promise<AirtableRecord<PnlLinesRecordRaw>[]> {
  if (!fromMonth?.trim() || !toMonth?.trim()) return [];
  const parts = [
    `ARRAYJOIN({month_key_lookup},"")>="${escapeFormulaValue(fromMonth.trim())}"`,
    `ARRAYJOIN({month_key_lookup},"")<="${escapeFormulaValue(toMonth.trim())}"`,
  ];
  if (opts?.status) parts.push(`{status}="${escapeFormulaValue(opts.status)}"`);
  const formula = `AND(${parts.join(', ')})`;
  return listRecords<PnlLinesRecordRaw>('pnl_lines', {
    filterByFormula: formula,
    sort: [{ field: 'month_key_lookup', direction: 'asc' }],
  });
}

/**
 * Find pnl_lines record by unique_key. pnl_lines identity: model-month-status.
 * Guard: returns null if uniqueKey is empty.
 */
export async function getPnlByUniqueKey(uniqueKey: string): Promise<AirtableRecord<PnlLinesRecordRaw> | null> {
  if (!uniqueKey?.trim()) return null;
  const records = await listRecords<PnlLinesRecordRaw>('pnl_lines', {
    filterByFormula: `ARRAYJOIN({unique_key},"")="${escapeFormulaValue(uniqueKey.trim())}"`,
    maxRecords: 1,
  });
  return records[0] ?? null;
}

/**
 * Find model_forecasts record by unique_key (model_id_lookup & "-" & month_key_lookup & "-" & scenario).
 * Guard: returns null if uniqueKey is empty.
 */
export async function getModelForecastByUniqueKey(
  uniqueKey: string
): Promise<AirtableRecord<ModelForecastRecord> | null> {
  if (!uniqueKey?.trim()) return null;
  const records = await listRecords<ModelForecastRecord>('model_forecasts', {
    filterByFormula: `ARRAYJOIN({unique_key},"")="${escapeFormulaValue(uniqueKey.trim())}"`,
    maxRecords: 1,
  });
  return records[0] ?? null;
}

/**
 * Upsert model_forecasts: update if exists (by unique_key), else create.
 * unique_key = model_id_lookup & "-" & month_key_lookup & "-" & scenario (built from modelId, monthKey, scenario).
 */
export async function upsertModelForecast(params: {
  modelId: string;
  monthId: string;
  monthKey: string;
  scenario: ModelForecastScenario;
  projected_net_usd?: number;
  projected_gross_usd?: number;
  projected_net_eur?: number;
  projected_gross_eur?: number;
  fx_rate_usd_eur?: number;
  source_type?: ModelForecastSourceType;
  is_locked?: boolean;
  notes?: string;
}): Promise<AirtableRecord<ModelForecastRecord>> {
  const { modelId, monthId, monthKey, scenario } = params;
  if (!modelId?.trim() || !monthId?.trim() || !monthKey?.trim()) {
    throw new Error('modelId, monthId, and monthKey are required');
  }
  const uniqueKey = `${modelId.trim()}-${monthKey.trim()}-${scenario}`;
  const existing = await getModelForecastByUniqueKey(uniqueKey);
  const payload: Record<string, unknown> = {
    model: [modelId.trim()],
    month: [monthId.trim()],
    scenario,
    ...(params.projected_net_usd != null && { projected_net_usd: params.projected_net_usd }),
    ...(params.projected_gross_usd != null && { projected_gross_usd: params.projected_gross_usd }),
    ...(params.projected_net_eur != null && { projected_net_eur: params.projected_net_eur }),
    ...(params.projected_gross_eur != null && { projected_gross_eur: params.projected_gross_eur }),
    ...(params.fx_rate_usd_eur != null && { fx_rate_usd_eur: params.fx_rate_usd_eur }),
    ...(params.source_type != null && { source_type: params.source_type }),
    ...(params.is_locked != null && { is_locked: params.is_locked }),
    ...(params.notes !== undefined && { notes: params.notes ?? '' }),
  };
  if (existing) {
    payload.updated_at = new Date().toISOString();
    const updated = await updateRecord('model_forecasts', existing.id, payload);
    return updated as AirtableRecord<ModelForecastRecord>;
  }
  const created = await createRecord('model_forecasts', payload);
  return created as AirtableRecord<ModelForecastRecord>;
}

/**
 * List model_forecasts for a model and month (by link fields). Returns up to 3 (expected, conservative, aggressive).
 */
export async function listModelForecastsForModelMonth(
  modelId: string,
  monthId: string
): Promise<AirtableRecord<ModelForecastRecord>[]> {
  if (!modelId?.trim() || !monthId?.trim()) return [];
  const formula = `AND(FIND("${escapeFormulaValue(modelId.trim())}", ARRAYJOIN({model},""))>0, FIND("${escapeFormulaValue(monthId.trim())}", ARRAYJOIN({month},""))>0)`;
  return listRecords<ModelForecastRecord>('model_forecasts', {
    filterByFormula: formula,
    sort: [{ field: 'scenario', direction: 'asc' }],
  });
}

/** List all users (for admin team hub). No view; fetches all. */
export async function listUsers(): Promise<AirtableRecord<UsersRecord>[]> {
  return listRecords<UsersRecord>('users', { sort: [{ field: 'email', direction: 'asc' }] });
}

export async function getUser(recordId: string): Promise<AirtableRecord<UsersRecord> | null> {
  return getRecord<UsersRecord>('users', recordId);
}

/** Get user by email from users table. Returns null if email is empty. */
export async function getUserByEmail(email: string): Promise<AirtableRecord<UsersRecord> | null> {
  const trimmed = email?.trim();
  if (!trimmed) return null;
  const escaped = escapeFormulaValue(trimmed.toLowerCase());
  const formula = `LOWER(TRIM({email})) = "${escaped}"`;
  const records = await listRecords<UsersRecord>('users', {
    filterByFormula: formula,
    maxRecords: 1,
  });
  return records[0] ?? null;
}

export async function createUser(fields: {
  email: string;
  role: Role;
  is_active: boolean;
  password_hash: string;
  password_salt: string;
  allowed_model_ids?: string;
}): Promise<AirtableRecord<UsersRecord>> {
  const payload: Record<string, unknown> = {
    email: fields.email.trim().toLowerCase(),
    role: fields.role,
    is_active: fields.is_active,
    password_hash: fields.password_hash,
    password_salt: fields.password_salt,
  };
  if (fields.allowed_model_ids != null) payload.allowed_model_ids = fields.allowed_model_ids;
  return createRecord('users', payload) as Promise<AirtableRecord<UsersRecord>>;
}

export async function updateUser(
  recordId: string,
  fields: Partial<{ email: string; role: Role; is_active: boolean; allowed_model_ids: string }>
): Promise<AirtableRecord<UsersRecord>> {
  const payload: Record<string, unknown> = {};
  if (fields.email !== undefined) payload.email = fields.email.trim().toLowerCase();
  if (fields.role !== undefined) payload.role = fields.role;
  if (fields.is_active !== undefined) payload.is_active = fields.is_active;
  if (fields.allowed_model_ids !== undefined) payload.allowed_model_ids = fields.allowed_model_ids;
  return updateRecord('users', recordId, payload) as Promise<AirtableRecord<UsersRecord>>;
}

/** Update user last_login_at. */
export async function updateUserLastLogin(recordId: string, isoDate: string): Promise<void> {
  await updateRecord('users', recordId, { last_login_at: isoDate });
}

/** Airtable list response shape (records may have id and fields). */
interface AirtableListRecord {
  id?: string;
  fields?: Record<string, unknown>;
}

/**
 * Single fetch to users table: maxRecords=1, NO view.
 * Used for bootstrap check and (dev-only) diagnostics.
 * AIRTABLE_VIEW_USERS is never used.
 */
async function fetchUsersTableForBootstrap(): Promise<{
  recordCount: number;
  baseId: string;
  usersTableName: string;
  firstRecordId: string | null;
}> {
  const table = tableName('users');
  const { token, baseId } = getConfig();
  const path = `${encodeURIComponent(table)}?maxRecords=1`;
  const url = `${BASE_URL}/${baseId}/${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { records?: AirtableListRecord[] };
  const records = Array.isArray(data?.records) ? data.records : [];
  const firstRecordId = records[0]?.id ?? null;
  return { recordCount: records.length, baseId, usersTableName: table, firstRecordId };
}

/**
 * Check if any users exist (for bootstrap). Bulletproof:
 * - Queries the users table only (table name from tableName('users'), default "users").
 * - No view parameter (AIRTABLE_VIEW_USERS is ignored).
 * - maxRecords=1 only; returns true ONLY if records.length > 0.
 */
export async function hasAnyUser(): Promise<boolean> {
  const { recordCount } = await fetchUsersTableForBootstrap();
  return recordCount > 0;
}

/** Dev-only: same fetch as hasAnyUser, with diagnostics (no secrets). */
export async function getBootstrapDiagnostics(): Promise<{
  hasUsers: boolean;
  baseId: string;
  usersTableName: string;
  recordCount: number;
  firstRecordId: string | null;
}> {
  const { recordCount, baseId, usersTableName, firstRecordId } = await fetchUsersTableForBootstrap();
  return { hasUsers: recordCount > 0, baseId, usersTableName, recordCount, firstRecordId };
}

/**
 * Dev-only: fetch users table with maxRecords=5, no view. Returns ids and emails (no secrets).
 */
export async function getUsersSampleForDebug(): Promise<{
  baseId: string;
  usersTableName: string;
  records: { id: string; email: string | null }[];
}> {
  const table = tableName('users');
  const { token, baseId } = getConfig();
  const path = `${encodeURIComponent(table)}?maxRecords=5`;
  const url = `${BASE_URL}/${baseId}/${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { records?: AirtableListRecord[] };
  const records = Array.isArray(data?.records) ? data.records : [];
  const list = records.map((r) => ({
    id: r?.id ?? '',
    email: (r?.fields?.email != null ? String(r.fields.email) : null) as string | null,
  }));
  return { baseId, usersTableName: table, records: list };
}

/** Write audit log entry. Airtable audit_log uses field: user_email (not user).
 * Non-blocking: on failure logs in dev only and does not throw. */
export async function writeAuditLog(entry: {
  user_email: string;
  table: string;
  record_id: string;
  field_name: string;
  old_value: string;
  new_value: string;
  model_name?: string;
}): Promise<void> {
  try {
    await createRecord('audit_log', {
      timestamp: new Date().toISOString(),
      user_email: entry.user_email,
      table: entry.table,
      record_id: entry.record_id,
      field_name: entry.field_name,
      old_value: entry.old_value,
      new_value: entry.new_value,
      model_name: entry.model_name ?? '',
    });
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[writeAuditLog]', { error: err instanceof Error ? err.message : String(err), table: entry.table, record_id: entry.record_id });
    }
  }
}

// --- Expense entries (model + month are links). expense_entries.month links to months table. ---

/** Minimal fields for expense_entries list (model, month are linked record id arrays in API response). */
const EXPENSE_ENTRIES_FIELDS = [
  'category', 'amount', 'amount_usd', 'amount_eur', 'description', 'vendor', 'date',
  'model', 'month', 'team_member', 'created_by', 'receipt_url', 'department', 'cost_owner_type',
] as const;

/**
 * List expense entries for model + month. Airtable formulas use primary field values (names) for
 * linked fields, not record ids, so we fetch broadly and filter in code using API-returned arrays.
 */
export async function listExpenseEntries(
  modelId: string,
  monthId: string
): Promise<AirtableRecord<ExpenseEntryRecord>[]> {
  if (!modelId?.trim() || !monthId?.trim()) return [];
  const mId = modelId.trim();
  const moId = monthId.trim();

  const fetched = await listRecords<ExpenseEntryRecord>('expense_entries', {
    sort: [{ field: 'date', direction: 'desc' }],
    maxRecords: 200,
    fields: [...EXPENSE_ENTRIES_FIELDS],
  });

  const records = fetched.filter((r) => {
    const matchesModel = Array.isArray(r.fields.model) && r.fields.model.includes(mId);
    const matchesMonth = Array.isArray(r.fields.month) && r.fields.month.includes(moId);
    return matchesModel && matchesMonth;
  });

  if (process.env.NODE_ENV === 'development') {
    console.log('[airtable listExpenseEntries] fetched', fetched.length, ', afterFilter', records.length);
  }
  return records;
}

/** Alias for apply-expenses route: expense entries for model + month (link id). */
export const listExpenseEntriesByMonth = listExpenseEntries;

/**
 * List expense_entries for a single month (by linked month record id).
 * Uses filterByFormula: FIND(monthRecordId, ARRAYJOIN({month}, ",")) > 0 (linked field is array; do not use {month}="id").
 * Returns records with model, amount_usd, amount_eur, amount for in-memory aggregation by model (no N+1).
 */
export async function listExpenseEntriesForMonth(
  monthId: string
): Promise<AirtableRecord<ExpenseEntryRecord>[]> {
  if (!monthId?.trim()) return [];
  const moId = monthId.trim();
  const formula = buildLinkedRecordContains('month', moId);
  return listRecords<ExpenseEntryRecord>('expense_entries', {
    filterByFormula: formula,
    sort: [{ field: 'date', direction: 'desc' }],
    fields: ['model', 'amount_usd', 'amount_eur', 'amount'],
  });
}

/**
 * Resolve month_key (e.g. "2026-02") to months table record id. Returns null if not found.
 */
async function resolveMonthIdByKey(month_key: string): Promise<string | null> {
  if (!month_key?.trim()) return null;
  const key = month_key.trim();
  const escaped = escapeFormulaValue(key);
  const records = await listRecords<MonthsRecord>('months', {
    maxRecords: 1,
    filterByFormula: `{month_key} = "${escaped}"`,
  });
  return records[0]?.id ?? null;
}

/**
 * List expense_entries for a single month by month_key string (e.g. "2026-02").
 * Resolves month_key → month record id, then filters expense_entries by linked month id (not by month_key).
 */
export async function listExpenseEntriesForMonthByKey(
  month_key: string
): Promise<AirtableRecord<ExpenseEntryRecord>[]> {
  const monthId = await resolveMonthIdByKey(month_key);
  if (!monthId) return [];

  const formula = buildLinkedRecordContains('month', monthId);
  const records = await listRecords<ExpenseEntryRecord>('expense_entries', {
    filterByFormula: formula,
    sort: [{ field: 'date', direction: 'desc' }],
    fields: ['model', 'team_member', 'category', 'amount_usd', 'amount_eur', 'amount', 'month', 'department', 'cost_owner_type'],
  });
  if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
    const sample = records.slice(0, 3).map((r) => ({
      id: r.id,
      month: r.fields.month,
      model: r.fields.model,
    }));
    console.log('[airtable listExpenseEntriesForMonthByKey]', {
      month_key: month_key.trim(),
      monthId,
      filterByFormula: formula,
      count: records.length,
      sample,
    });
  }
  return records;
}

/**
 * List expense_entries for a month range (from_month_key to to_month_key inclusive).
 * Fetches per month by month_key (Airtable formula uses primary field text, not record ids) and concatenates.
 */
export async function listExpenseEntriesInRange(
  from_month_key: string,
  to_month_key: string
): Promise<AirtableRecord<ExpenseEntryRecord>[]> {
  const from = from_month_key.trim();
  const to = to_month_key.trim();
  const monthsRecords = await getMonths();
  const inRange = monthsRecords
    .filter((r) => {
      const k = r.fields.month_key ?? '';
      return k >= from && k <= to;
    })
    .sort((a, b) => (a.fields.month_key ?? '').localeCompare(b.fields.month_key ?? ''));
  const monthKeys = inRange.map((r) => r.fields.month_key).filter((k): k is string => typeof k === 'string');
  if (monthKeys.length === 0) return [];
  const batches = await Promise.all(monthKeys.map((key) => listExpenseEntriesForMonthByKey(key)));
  const out = batches.flat();
  if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
    console.log('[airtable listExpenseEntriesInRange]', {
      from,
      to,
      resolved_month_keys: monthKeys,
      resolved_month_ids: inRange.map((r) => r.id),
      expense_entries_count: out.length,
    });
  }
  return out;
}

export async function createExpenseEntry(
  modelId: string,
  monthId: string,
  fields: {
    category: string;
    amount: number;
    amount_usd?: number;
    amount_eur?: number;
    description?: string;
    vendor?: string;
    date?: string;
    created_by: string;
    receipt_url?: string;
  }
): Promise<AirtableRecord<ExpenseEntryRecord>> {
  const base: Record<string, unknown> = {
    model: [modelId],
    month: [monthId],
    category: fields.category,
    amount: fields.amount,
    description: fields.description ?? '',
    vendor: fields.vendor ?? '',
    date: fields.date ?? new Date().toISOString().slice(0, 10),
    created_by: fields.created_by,
    receipt_url: fields.receipt_url ?? '',
  };
  if (typeof fields.amount_usd === 'number') base.amount_usd = fields.amount_usd;
  if (typeof fields.amount_eur === 'number') base.amount_eur = fields.amount_eur;
  return createRecord('expense_entries', base) as Promise<AirtableRecord<ExpenseEntryRecord>>;
}

export async function updateExpenseEntry(
  recordId: string,
  fields: Partial<{
    amount: number;
    amount_usd: number;
    amount_eur: number;
    description: string;
    vendor: string;
    date: string;
    receipt_url: string;
    category: string;
  }>
): Promise<AirtableRecord<ExpenseEntryRecord>> {
  return updateRecord('expense_entries', recordId, fields as Record<string, unknown>) as Promise<
    AirtableRecord<ExpenseEntryRecord>
  >;
}

export async function deleteExpenseEntry(recordId: string): Promise<void> {
  return deleteRecordById('expense_entries', recordId);
}

/** PATCH pnl_lines record with only input fields (no formula/computed). Caller must pass allowlisted fields only. */
export async function updatePnlLine(
  recordId: string,
  fields: Record<string, unknown>
): Promise<AirtableRecord<unknown>> {
  return updateRecord('pnl_lines', recordId, fields);
}

/** Delete pnl_lines record by id. */
export async function deletePnlLine(recordId: string): Promise<void> {
  return deleteRecordById('pnl_lines', recordId);
}

/** List pnl_lines for model + month + status. Returns [] if not found. */
export async function listPnlLinesByModelAndMonth(
  modelId: string,
  monthId: string,
  status?: 'actual' | 'forecast'
): Promise<AirtableRecord<PnlLinesRecordRaw>[]> {
  if (!modelId?.trim() || !monthId?.trim()) return [];
  const records = await getPnlForModel(modelId.trim(), status ?? 'actual');
  const monthIdTrim = monthId.trim();
  return records.filter((r) => (r.fields.month?.[0] ?? '') === monthIdTrim);
}

/** Create pnl_lines record. model, month are linked; status = actual|forecast. */
export async function createPnlLine(payload: {
  model_id: string;
  month_id: string;
  status: 'actual' | 'forecast';
  fields: Record<string, unknown>;
}): Promise<AirtableRecord<PnlLinesRecordRaw>> {
  const { model_id, month_id, status, fields } = payload;
  const rec = await createRecord('pnl_lines', {
    model: [model_id.trim()],
    month: [month_id.trim()],
    status,
    ...fields,
  });
  return rec as AirtableRecord<PnlLinesRecordRaw>;
}

export async function deleteRecordById(tableKey: string, recordId: string): Promise<void> {
  const table = tableName(tableKey);
  const { token, baseId } = getConfig();
  const res = await fetch(`${BASE_URL}/${baseId}/${encodeURIComponent(table)}/${recordId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
}

// --- Revenue entries (model + month are links). revenue_entries.month links to months table. ---

/** Guard: returns [] if modelId or monthId is empty. Filter by model_id_lookup (not linked {model}) and month record ID so Airtable relation works. */
export async function listRevenueEntries(
  modelId: string,
  monthId: string
): Promise<AirtableRecord<RevenueEntryRecord>[]> {
  if (!modelId?.trim() || !monthId?.trim()) return [];
  const formula = `AND(ARRAYJOIN({model_id_lookup},"")="${escapeFormulaValue(modelId.trim())}", ${linkedHasId('month', monthId.trim())})`;
  return listRecords<RevenueEntryRecord>('revenue_entries', {
    filterByFormula: formula,
    sort: [{ field: 'amount', direction: 'desc' }],
  });
}

export const listRevenueEntriesByMonth = listRevenueEntries;

export async function createRevenueEntry(
  modelId: string,
  monthId: string,
  fields: {
    type: string;
    amount: number;
    amount_usd?: number;
    amount_eur?: number;
    description?: string;
    date?: string;
    created_by: string;
  }
): Promise<AirtableRecord<RevenueEntryRecord>> {
  const base: Record<string, unknown> = {
    model: [modelId],
    month: [monthId],
    type: fields.type,
    amount: fields.amount,
    description: fields.description ?? '',
    date: fields.date ?? new Date().toISOString().slice(0, 10),
    created_by: fields.created_by,
  };
  if (typeof fields.amount_usd === 'number') base.amount_usd = fields.amount_usd;
  if (typeof fields.amount_eur === 'number') base.amount_eur = fields.amount_eur;
  return createRecord('revenue_entries', base) as Promise<AirtableRecord<RevenueEntryRecord>>;
}

export async function updateRevenueEntry(
  recordId: string,
  fields: Partial<{ amount: number; amount_usd: number; amount_eur: number; description: string; type: string; date: string }>
): Promise<AirtableRecord<RevenueEntryRecord>> {
  return updateRecord('revenue_entries', recordId, fields as Record<string, unknown>) as Promise<
    AirtableRecord<RevenueEntryRecord>
  >;
}

export async function deleteRevenueEntry(recordId: string): Promise<void> {
  return deleteRecordById('revenue_entries', recordId);
}

// --- Team members ---

export interface ListTeamMembersFilters {
  q?: string;
  department?: string;
  role?: string;
  status?: string;
  /** When set, filter by team_members.member_id (use this for dedupe/lookup; do not use {team_member} on team_members table). */
  member_id?: string;
}

export async function listTeamMembers(filters: ListTeamMembersFilters = {}): Promise<AirtableRecord<TeamMemberRecord>[]> {
  const opts: { sort: { field: string; direction: 'asc' }[]; filterByFormula?: string; maxRecords?: number } = {
    sort: [{ field: 'name', direction: 'asc' }],
  };
  if (filters.member_id?.trim()) {
    opts.filterByFormula = `{member_id} = "${escapeFormulaValue(filters.member_id.trim())}"`;
    opts.maxRecords = 10;
  }
  const records = await listRecords<TeamMemberRecord>('team_members', opts);
  let out = records;
  if (filters.department?.trim()) {
    const dept = filters.department.trim().toLowerCase();
    out = out.filter((r) => ((r.fields.department ?? '') as string).toLowerCase() === dept);
  }
  if (filters.role?.trim()) {
    const role = filters.role.trim().toLowerCase();
    out = out.filter((r) => ((r.fields.role ?? '') as string).toLowerCase() === role);
  }
  if (filters.status?.trim()) {
    const status = filters.status.trim().toLowerCase();
    out = out.filter((r) => ((r.fields.status ?? '') as string).toLowerCase() === status);
  }
  if (filters.q?.trim()) {
    const q = filters.q.trim().toLowerCase();
    out = out.filter((r) => {
      const name = ((r.fields.name ?? '') as string).toLowerCase();
      const email = ((r.fields.email ?? '') as string).toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }
  return out;
}

export async function getTeamMember(recordId: string): Promise<AirtableRecord<TeamMemberRecord> | null> {
  return getRecord<TeamMemberRecord>('team_members', recordId);
}

/** Lookup team_members by member_id (unique id field). Use this for dedupe; do not use {team_member} on team_members table. */
export async function getTeamMemberByMemberId(memberId: string): Promise<AirtableRecord<TeamMemberRecord> | null> {
  if (!memberId?.trim()) return null;
  const records = await listRecords<TeamMemberRecord>('team_members', {
    filterByFormula: `{member_id} = "${escapeFormulaValue(memberId.trim())}"`,
    maxRecords: 1,
  });
  return records[0] ?? null;
}

export async function createTeamMember(fields: {
  name: string;
  email?: string;
  role?: string;
  department?: string;
  status?: string;
  notes?: string;
  monthly_cost?: number;
  model_id?: string;
  linked_models?: string[];
  affiliator_percentage?: number;
  payout_type?: string;
  payout_frequency?: string;
  payout_percentage_chatters?: number;
  chatting_percentage?: number;
  chatting_percentage_messages_tips?: number;
  gunzo_percentage?: number;
  gunzo_percentage_messages_tips?: number;
  payout_flat_fee?: number;
  models_scope?: string[];
  payout_scope?: 'agency_total_net' | 'messages_tips_net';
}): Promise<AirtableRecord<TeamMemberRecord>> {
  const payload: Record<string, unknown> = {
    name: fields.name,
    role: fields.role ?? '',
    department: fields.department ?? '',
    status: fields.status ?? 'active',
    notes: fields.notes ?? '',
    payout_type: String(fields.payout_type ?? 'none'),
    payout_frequency: String(fields.payout_frequency ?? 'monthly'),
  };
  if (fields.email != null) payload.email = fields.email;
  if (fields.monthly_cost != null) payload.monthly_cost = Number(fields.monthly_cost);
  if (typeof fields.model_id === 'string' && fields.model_id.trim()) payload.model = [fields.model_id.trim()];
  if (Array.isArray(fields.linked_models) && fields.linked_models.length > 0) {
    payload.linked_models = fields.linked_models.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
  }
  if (typeof fields.affiliator_percentage === 'number' && Number.isFinite(fields.affiliator_percentage)) {
    payload.affiliator_percentage = fields.affiliator_percentage;
  }
  const pctChatters = fields.payout_percentage_chatters;
  if (pctChatters != null && String(pctChatters).trim() !== '') {
    payload.payout_percentage_chatters = Number(pctChatters);
  }
  const chattingPct = fields.chatting_percentage;
  if (chattingPct != null && String(chattingPct).trim() !== '') {
    payload.chatting_percentage = Number(chattingPct);
  }
  const chattingMsgsPct = fields.chatting_percentage_messages_tips;
  if (chattingMsgsPct != null && String(chattingMsgsPct).trim() !== '') {
    payload.chatting_percentage_messages_tips = Number(chattingMsgsPct);
  }
  const gunzoPct = fields.gunzo_percentage;
  if (gunzoPct != null && String(gunzoPct).trim() !== '') {
    payload.gunzo_percentage = Number(gunzoPct);
  }
  const gunzoMsgsPct = fields.gunzo_percentage_messages_tips;
  if (gunzoMsgsPct != null && String(gunzoMsgsPct).trim() !== '') {
    payload.gunzo_percentage_messages_tips = Number(gunzoMsgsPct);
  }
  const flat = fields.payout_flat_fee;
  if (flat != null && String(flat).trim() !== '') payload.payout_flat_fee = Number(flat);
  if (Array.isArray(fields.models_scope) && fields.models_scope.length > 0) payload.models_scope = fields.models_scope.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
  if (fields.payout_scope) payload.payout_scope = fields.payout_scope;
  if (process.env.NODE_ENV === 'development') {
    // Dev-only: inspect the exact Airtable payload for team_members create
    console.log('[airtable] createTeamMember payload fields:', Object.keys(payload));
  }
  delete (payload as Record<string, unknown>).model_id;
  return createRecord('team_members', payload) as Promise<AirtableRecord<TeamMemberRecord>>;
}

export async function updateTeamMember(
  recordId: string,
  fields: Partial<{
    name: string;
    email: string;
    role: string;
    department: string;
    status: string;
    notes: string;
    monthly_cost: number;
    model_id: string | null;
    linked_models: string[];
    affiliator_percentage: number;
    payout_type: string;
    payout_percentage: number;
    payout_flat_fee: number;
    payout_frequency: string;
    models_scope: string[];
    chatting_percentage: number;
    gunzo_percentage: number;
    include_webapp_basis: boolean;
    payout_scope: 'agency_total_net' | 'messages_tips_net';
  }>
): Promise<AirtableRecord<TeamMemberRecord>> {
  const payload: Record<string, unknown> = {};
  if (fields.name !== undefined) payload.name = fields.name;
  if (fields.email !== undefined) payload.email = fields.email;
  if (fields.role !== undefined) payload.role = fields.role;
  if (fields.department !== undefined) payload.department = fields.department;
  if (fields.status !== undefined) payload.status = fields.status;
  if (fields.notes !== undefined) payload.notes = fields.notes;
  if (fields.monthly_cost !== undefined) payload.monthly_cost = Number(fields.monthly_cost);
  if ('model_id' in fields) payload.model = fields.model_id ? [fields.model_id] : [];
  if ('linked_models' in fields) payload.linked_models = Array.isArray(fields.linked_models) ? fields.linked_models.filter((id): id is string => typeof id === 'string' && id.trim().length > 0) : [];
  if (fields.affiliator_percentage !== undefined) payload.affiliator_percentage = Number(fields.affiliator_percentage);
  if (fields.payout_type !== undefined) payload.payout_type = String(fields.payout_type);
  if (fields.payout_frequency !== undefined) payload.payout_frequency = String(fields.payout_frequency);
  if (fields.payout_percentage !== undefined) payload.payout_percentage = Number(fields.payout_percentage);
  if (fields.payout_flat_fee !== undefined) payload.payout_flat_fee = Number(fields.payout_flat_fee);
  if ('models_scope' in fields) payload.models_scope = Array.isArray(fields.models_scope) ? fields.models_scope.filter((id): id is string => typeof id === 'string' && id.trim().length > 0) : [];
  if (fields.chatting_percentage !== undefined) payload.chatting_percentage = Number(fields.chatting_percentage);
  if (fields.gunzo_percentage !== undefined) payload.gunzo_percentage = Number(fields.gunzo_percentage);
  if (fields.include_webapp_basis !== undefined) payload.include_webapp_basis = Boolean(fields.include_webapp_basis);
  if (fields.payout_scope !== undefined) payload.payout_scope = fields.payout_scope;
  delete (payload as Record<string, unknown>).model_id;
  return updateRecord('team_members', recordId, payload) as Promise<
    AirtableRecord<TeamMemberRecord>
  >;
}

export async function deleteTeamMember(recordId: string): Promise<void> {
  return deleteRecordById('team_members', recordId);
}

// --- model_assignments: join table (team_member, model) for affiliate assigned models. ---

/**
 * List model_assignments for a team member. Returns record ids and model ids.
 * Uses filterByFormula with linked record id; Airtable may return primary values for {team_member}, so we fetch and filter by id in code if needed.
 */
export async function listModelAssignmentsByTeamMember(
  teamMemberId: string
): Promise<AirtableRecord<ModelAssignmentRecord>[]> {
  if (!teamMemberId?.trim()) return [];
  const formula = linkedHasId('team_member', teamMemberId.trim());
  const records = await listRecords<ModelAssignmentRecord>('model_assignments', {
    filterByFormula: formula,
    maxRecords: 500,
  });
  return records;
}

/**
 * Create one model_assignment record (team_member, model).
 */
export async function createModelAssignment(
  teamMemberId: string,
  modelId: string
): Promise<AirtableRecord<ModelAssignmentRecord>> {
  const tm = teamMemberId?.trim();
  const mid = modelId?.trim();
  if (!tm || !mid) throw new Error('model_assignments: team_member and model are required');
  const payload: Record<string, unknown> = {
    team_member: [tm],
    model: [mid],
  };
  return createRecord('model_assignments', payload) as Promise<AirtableRecord<ModelAssignmentRecord>>;
}

/**
 * Fetch all model_assignments in one paginated request, then return a map of team_member id -> model ids
 * for the given teamMemberIds. Used to batch-load assigned models when listing team members.
 */
export async function getModelAssignmentIdsByTeamMemberIds(
  teamMemberIds: string[]
): Promise<Record<string, string[]>> {
  const idSet = new Set(teamMemberIds.map((id) => id?.trim()).filter((id): id is string => Boolean(id)));
  if (idSet.size === 0) return {};
  const records = await listRecords<ModelAssignmentRecord>('model_assignments', {
    maxRecords: 5000,
  });
  const out: Record<string, string[]> = {};
  for (const rec of records) {
    const tm = Array.isArray(rec.fields.team_member) && rec.fields.team_member[0] ? rec.fields.team_member[0] : '';
    const mid = Array.isArray(rec.fields.model) && rec.fields.model[0] ? rec.fields.model[0] : '';
    if (idSet.has(tm) && mid) {
      if (!out[tm]) out[tm] = [];
      out[tm].push(mid);
    }
  }
  return out;
}

/**
 * Upsert model_assignments for a team member: add missing (team_member, model) records, remove unselected.
 * Does not change team_members table.
 */
export async function upsertModelAssignments(
  teamMemberId: string,
  modelIds: string[]
): Promise<void> {
  const tm = teamMemberId?.trim();
  if (!tm) return;
  const desired = new Set(
    modelIds.map((id) => id?.trim()).filter((id): id is string => Boolean(id))
  );
  const existing = await listModelAssignmentsByTeamMember(tm);
  const existingByModel = new Map<string, AirtableRecord<ModelAssignmentRecord>>();
  for (const rec of existing) {
    const mid = Array.isArray(rec.fields.model) && rec.fields.model[0] ? rec.fields.model[0] : '';
    if (mid) existingByModel.set(mid, rec);
  }
  for (const mid of desired) {
    if (!existingByModel.has(mid)) {
      await createModelAssignment(tm, mid);
    }
  }
  for (const [mid, rec] of existingByModel) {
    if (!desired.has(mid)) {
      await deleteRecordById('model_assignments', rec.id);
    }
  }
}

// --- affiliate_model_deals: affiliator + model + percentage/basis (affiliate config, not on team_members). ---

export function toAffiliateModelDeal(rec: AirtableRecord<AffiliateModelDealRecord>): { id: string; affiliator_id: string; model_id: string; percentage: number; basis: 'net' | 'gross'; is_active: boolean; start_month_id?: string; end_month_id?: string; notes?: string } {
  const f = rec.fields;
  const affiliatorId = Array.isArray(f.team_member) && f.team_member[0] ? String(f.team_member[0]) : '';
  const modelId = Array.isArray(f.model) && f.model[0] ? String(f.model[0]) : '';
  const basis = (f.basis === 'gross' || f.basis === 'net' ? f.basis : 'net') as 'net' | 'gross';
  return {
    id: rec.id,
    affiliator_id: affiliatorId,
    model_id: modelId,
    percentage: typeof f.percentage === 'number' && Number.isFinite(f.percentage) ? f.percentage : 0,
    basis,
    is_active: f.is_active !== false,
    start_month_id: Array.isArray(f.start_month) && f.start_month[0] ? String(f.start_month[0]) : undefined,
    end_month_id: Array.isArray(f.end_month) && f.end_month[0] ? String(f.end_month[0]) : undefined,
    notes: typeof f.notes === 'string' ? f.notes : undefined,
  };
}

export async function listAffiliateModelDeals(): Promise<AirtableRecord<AffiliateModelDealRecord>[]> {
  return listRecords<AffiliateModelDealRecord>('affiliate_model_deals', {
    sort: [{ field: 'team_member', direction: 'asc' }],
  });
}

export async function getAffiliateModelDeal(recordId: string): Promise<AirtableRecord<AffiliateModelDealRecord> | null> {
  return getRecord<AffiliateModelDealRecord>('affiliate_model_deals', recordId);
}

/** Find existing deal by affiliator + model (for upsert). */
export async function findAffiliateModelDealByAffiliatorAndModel(
  affiliatorId: string,
  modelId: string
): Promise<AirtableRecord<AffiliateModelDealRecord> | null> {
  const all = await listAffiliateModelDeals();
  const a = affiliatorId?.trim();
  const m = modelId?.trim();
  if (!a || !m) return null;
  return all.find((rec) => {
    const fa = Array.isArray(rec.fields.team_member) && rec.fields.team_member[0] ? String(rec.fields.team_member[0]) : '';
    const fm = Array.isArray(rec.fields.model) && rec.fields.model[0] ? String(rec.fields.model[0]) : '';
    return fa === a && fm === m;
  }) ?? null;
}

export async function createAffiliateModelDeal(fields: {
  affiliator_id: string;
  model_id: string;
  percentage: number;
  basis?: 'net' | 'gross';
  is_active?: boolean;
  start_month_id?: string;
  end_month_id?: string;
  notes?: string;
}): Promise<AirtableRecord<AffiliateModelDealRecord>> {
  const payload: Record<string, unknown> = {
    team_member: [fields.affiliator_id.trim()],
    model: [fields.model_id.trim()],
    percentage: Number(fields.percentage),
    basis: fields.basis ?? 'net',
    is_active: fields.is_active !== false,
  };
  if (fields.start_month_id?.trim()) payload.start_month = [fields.start_month_id.trim()];
  if (fields.end_month_id?.trim()) payload.end_month = [fields.end_month_id.trim()];
  if (fields.notes !== undefined) payload.notes = String(fields.notes ?? '');
  if (process.env.NODE_ENV === 'development') {
    console.log('[AIRTABLE affiliate_model_deals] create payload', payload);
  }
  return createRecord('affiliate_model_deals', payload) as Promise<AirtableRecord<AffiliateModelDealRecord>>;
}

export async function updateAffiliateModelDeal(
  recordId: string,
  fields: Partial<{
    affiliator_id: string;
    model_id: string;
    percentage: number;
    basis: 'net' | 'gross';
    is_active: boolean;
    start_month_id: string | null;
    end_month_id: string | null;
    notes: string;
  }>
): Promise<AirtableRecord<AffiliateModelDealRecord>> {
  const payload: Record<string, unknown> = {};
  if (fields.affiliator_id !== undefined) payload.team_member = fields.affiliator_id ? [fields.affiliator_id] : [];
  if (fields.model_id !== undefined) payload.model = fields.model_id ? [fields.model_id] : [];
  if (fields.percentage !== undefined) payload.percentage = Number(fields.percentage);
  if (fields.basis !== undefined) payload.basis = fields.basis;
  if (fields.is_active !== undefined) payload.is_active = Boolean(fields.is_active);
  if (fields.start_month_id !== undefined) payload.start_month = fields.start_month_id ? [fields.start_month_id] : [];
  if (fields.end_month_id !== undefined) payload.end_month = fields.end_month_id ? [fields.end_month_id] : [];
  if (fields.notes !== undefined) payload.notes = String(fields.notes ?? '');
  return updateRecord('affiliate_model_deals', recordId, payload) as Promise<AirtableRecord<AffiliateModelDealRecord>>;
}

export async function deleteAffiliateModelDeal(recordId: string): Promise<void> {
  return deleteRecordById('affiliate_model_deals', recordId);
}

// --- team_member_payment_methods (read-only for payments tab). team_member links to team_members. ---

const PAYMENT_METHODS_FIELDS = [
  'team_member',
  'method_label',
  'payout_method',
  'beneficiary_name',
  'iban_or_account',
  'revtag',
  'status',
  'notes',
  'is_default',
  'created_at',
] as const;

const PAYMENT_METHODS_MAX_RECORDS = 1000;

function sortPaymentMethodRecords<T extends AirtableRecord<TeamMemberPaymentMethodRecord>>(records: T[]): T[] {
  const out = [...records];
  out.sort((a, b) => {
    if (Boolean(a.fields.is_default) && !Boolean(b.fields.is_default)) return -1;
    if (!Boolean(a.fields.is_default) && Boolean(b.fields.is_default)) return 1;
    const order = (r: AirtableRecord<TeamMemberPaymentMethodRecord>) =>
      r.fields.method_label === 'primary' ? 0 : r.fields.method_label === 'secondary' ? 1 : 2;
    if (order(a) !== order(b)) return order(a) - order(b);
    return (a.fields.created_at ?? a.createdTime ?? '').localeCompare(b.fields.created_at ?? b.createdTime ?? '');
  });
  return out;
}

/**
 * List all payment method records without filterByFormula (linked fields in formulas
 * can evaluate to primary values, so filtering by record id in Airtable often fails).
 * Caller should filter in code by record.fields.team_member / record.fields.model arrays.
 */
export async function listAllTeamMemberPaymentMethods(
  maxRecords: number = PAYMENT_METHODS_MAX_RECORDS
): Promise<AirtableRecord<TeamMemberPaymentMethodRecord>[]> {
  const records = await listRecords<TeamMemberPaymentMethodRecord>('team_member_payment_methods', {
    maxRecords,
    fields: [...PAYMENT_METHODS_FIELDS],
  });
  return sortPaymentMethodRecords(records);
}

/**
 * List payment methods for the given team member record ids.
 * Uses fetch-all then filter in code so linked record id matching is reliable.
 */
export async function listTeamMemberPaymentMethods(
  teamMemberIds: string[]
): Promise<AirtableRecord<TeamMemberPaymentMethodRecord>[]> {
  const ids = new Set(teamMemberIds.map((id) => id?.trim()).filter((id): id is string => Boolean(id)));
  if (ids.size === 0) return [];
  const all = await listAllTeamMemberPaymentMethods();
  const teamMemberArr = (r: AirtableRecord<TeamMemberPaymentMethodRecord>) =>
    Array.isArray(r.fields.team_member) ? r.fields.team_member : [];
  return all.filter((rec) => teamMemberArr(rec).some((tid) => ids.has(String(tid).trim())));
}

/** Unset is_default on all other payment methods for this team_member_id. */
async function unsetOtherDefaultsForMember(teamMemberId: string, excludeRecordId?: string): Promise<void> {
  const existing = await listTeamMemberPaymentMethods([teamMemberId]);
  for (const rec of existing) {
    if (rec.id === excludeRecordId) continue;
    if (!rec.fields.is_default) continue;
    await updateRecord('team_member_payment_methods', rec.id, { is_default: false });
  }
}

export async function createTeamMemberPaymentMethod(fields: {
  team_member_id: string;
  method_label?: string;
  payout_method?: string;
  beneficiary_name?: string;
  iban_or_account?: string;
  revtag?: string;
  status?: string;
  notes?: string;
  is_default?: boolean;
}): Promise<AirtableRecord<TeamMemberPaymentMethodRecord>> {
  if (fields.is_default) await unsetOtherDefaultsForMember(fields.team_member_id);
  const payload: Record<string, unknown> = {
    team_member: [fields.team_member_id],
    method_label: fields.method_label ?? '',
    payout_method: fields.payout_method ?? '',
    beneficiary_name: fields.beneficiary_name ?? '',
    iban_or_account: fields.iban_or_account ?? '',
    revtag: fields.revtag ?? '',
    status: fields.status ?? '',
    notes: fields.notes ?? '',
    is_default: Boolean(fields.is_default),
  };
  return createRecord('team_member_payment_methods', payload) as Promise<AirtableRecord<TeamMemberPaymentMethodRecord>>;
}

export async function updateTeamMemberPaymentMethod(
  recordId: string,
  fields: Partial<{
    method_label: string;
    payout_method: string;
    beneficiary_name: string;
    iban_or_account: string;
    revtag: string;
    status: string;
    notes: string;
    is_default: boolean;
  }>
): Promise<AirtableRecord<TeamMemberPaymentMethodRecord>> {
  const rec = await getRecord<TeamMemberPaymentMethodRecord>('team_member_payment_methods', recordId);
  if (!rec) throw new Error('Payment method not found');
  const teamMemberId = Array.isArray(rec.fields.team_member) && rec.fields.team_member[0] ? rec.fields.team_member[0] : '';
  if (fields.is_default === true && teamMemberId) await unsetOtherDefaultsForMember(teamMemberId, recordId);
  const payload: Record<string, unknown> = {};
  if (fields.method_label !== undefined) payload.method_label = fields.method_label;
  if (fields.payout_method !== undefined) payload.payout_method = fields.payout_method;
  if (fields.beneficiary_name !== undefined) payload.beneficiary_name = fields.beneficiary_name;
  if (fields.iban_or_account !== undefined) payload.iban_or_account = fields.iban_or_account;
  if (fields.revtag !== undefined) payload.revtag = fields.revtag;
  if (fields.status !== undefined) payload.status = fields.status;
  if (fields.notes !== undefined) payload.notes = fields.notes;
  if (fields.is_default !== undefined) payload.is_default = fields.is_default;
  if (Object.keys(payload).length === 0) return rec;
  return updateRecord('team_member_payment_methods', recordId, payload) as Promise<AirtableRecord<TeamMemberPaymentMethodRecord>>;
}

export async function deleteTeamMemberPaymentMethod(recordId: string): Promise<void> {
  return deleteRecordById('team_member_payment_methods', recordId);
}

// --- Global expenses. expense_entries.month link; month_id/month_ids are months record ids. ---

export interface ListExpensesFilters {
  month_id?: string;
  month_ids?: string[]; // OR of month record ids (for agency range)
  /** Period: when both set, resolves to month_ids via getMonthRecordIdsInRange (takes precedence over month_id/month_ids). */
  from_month_key?: string;
  to_month_key?: string;
  department?: string; // 'models'|'chatting'|'marketing'|'production'|'ops'|'combined' (combined = marketing OR production)
  /** When set, filter by category IN these values (e.g. marketing_tools, production_other). Category is source of truth; department not required. */
  categories?: string[];
  owner_type?: string; // cost_owner_type: model|team_member|agency
  model_id?: string;
  team_member_id?: string;
}

export interface ListExpensesOptions {
  /** Optional request id for dev-only logging on failure. */
  requestId?: string;
}

/** Only non-empty filter values are applied. When from_month_key+to_month_key provided, resolves to month_ids. Returns [] if no records or on Airtable error (dev log with requestId). */
export async function listExpenses(
  filters: ListExpensesFilters = {},
  opts?: ListExpensesOptions
): Promise<AirtableRecord<ExpenseEntryRecord>[]> {
  let resolvedFilters = { ...filters };
  if (filters.from_month_key != null && filters.to_month_key != null && filters.from_month_key !== '' && filters.to_month_key !== '') {
    const monthIds = await getMonthRecordIdsInRange(filters.from_month_key, filters.to_month_key);
    resolvedFilters = { ...filters, month_ids: monthIds.length > 0 ? monthIds : undefined, month_id: undefined };
    delete (resolvedFilters as Record<string, unknown>).from_month_key;
    delete (resolvedFilters as Record<string, unknown>).to_month_key;
  }

  // expense_entries: Airtable formulas on linked {month} return primary field value (month_key), not record ids. Filter by month_key.
  const parts: string[] = [];
  if (resolvedFilters.month_id?.trim()) {
    const monthKey = await getMonthKeyFromId(resolvedFilters.month_id.trim());
    if (monthKey) {
      parts.push(`FIND("${escapeFormulaValue(monthKey)}", ARRAYJOIN({month}, ",")) > 0`);
    }
  }
  if (resolvedFilters.month_ids && resolvedFilters.month_ids.length > 0) {
    const ids = resolvedFilters.month_ids.map((id) => id?.trim()).filter((id): id is string => Boolean(id));
    if (ids.length > 0) {
      const monthKeys = (await Promise.all(ids.map((id) => getMonthKeyFromId(id)))).filter((k): k is string => k != null && k.trim() !== '');
      if (monthKeys.length > 0) {
        const monthOr = monthKeys.map((k) => `FIND("${escapeFormulaValue(k)}", ARRAYJOIN({month}, ",")) > 0`).join(', ');
        parts.push(`OR(${monthOr})`);
      }
    }
  }
  const dept = resolvedFilters.department;
  if (dept !== undefined && dept !== null && dept !== '' && dept !== 'all') {
    if (dept === 'combined') {
      parts.push(`OR({department}="marketing", {department}="production")`);
    } else if (String(dept).trim()) {
      parts.push(`{department}="${escapeFormulaValue(String(dept).trim())}"`);
    }
  }
  if (resolvedFilters.owner_type?.trim()) {
    parts.push(`{cost_owner_type}="${escapeFormulaValue(resolvedFilters.owner_type.trim())}"`);
  }
  if (resolvedFilters.model_id?.trim()) {
    parts.push(`ARRAYJOIN({model_id_lookup},"")="${escapeFormulaValue(resolvedFilters.model_id.trim())}"`);
  }
  if (resolvedFilters.team_member_id?.trim()) {
    parts.push(`ARRAYJOIN({team_member},"")="${escapeFormulaValue(resolvedFilters.team_member_id.trim())}"`);
  }
  const cats = resolvedFilters.categories;
  if (cats && cats.length > 0) {
    const catParts = cats.filter((c) => c != null && String(c).trim()).map((c) => `{category}="${escapeFormulaValue(String(c).trim())}"`);
    if (catParts.length > 0) parts.push(`OR(${catParts.join(', ')})`);
  }
  const formula = parts.length ? `AND(${parts.join(', ')})` : undefined;
  const tableKey = 'expense_entries';
  const table = tableName(tableKey);
  try {
    return await listRecords<ExpenseEntryRecord>(tableKey, {
      filterByFormula: formula,
      sort: [{ field: 'date', direction: 'desc' }],
    });
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      const reqId = opts?.requestId ?? 'none';
      console.warn('[airtable listExpenses]', {
        requestId: reqId,
        tableName: table,
        filterByFormula: formula ?? '(none)',
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
    return [];
  }
}

export async function createExpense(fields: {
  month_id: string;
  amount: number;
  amount_usd?: number;
  amount_eur?: number;
  category: string;
  department: string;
  cost_owner_type: 'model' | 'team_member' | 'agency';
  model_id?: string;
  team_member_id?: string;
  description?: string;
  vendor?: string;
  date?: string;
  created_by: string;
  receipt_url?: string;
}): Promise<AirtableRecord<ExpenseEntryRecord>> {
  const base: Record<string, unknown> = {
    month: [fields.month_id],
    amount: fields.amount,
    category: fields.category,
    department: fields.department,
    cost_owner_type: fields.cost_owner_type,
    description: fields.description ?? '',
    vendor: fields.vendor ?? '',
    date: fields.date ?? new Date().toISOString().slice(0, 10),
    created_by: fields.created_by,
    receipt_url: fields.receipt_url ?? '',
  };
  if (typeof fields.amount_usd === 'number') base.amount_usd = fields.amount_usd;
  if (typeof fields.amount_eur === 'number') base.amount_eur = fields.amount_eur;
  if (fields.cost_owner_type === 'model' && fields.model_id) base.model = [fields.model_id];
  if (fields.cost_owner_type === 'team_member' && fields.team_member_id) base.team_member = [fields.team_member_id];
  return createRecord('expense_entries', base) as Promise<AirtableRecord<ExpenseEntryRecord>>;
}

export async function updateExpense(
  recordId: string,
  fields: Partial<{
    amount: number;
    amount_usd: number;
    amount_eur: number;
    category: string;
    department: string;
    cost_owner_type: string;
    model_id: string;
    team_member_id: string;
    description: string;
    vendor: string;
    date: string;
    receipt_url: string;
  }>
): Promise<AirtableRecord<ExpenseEntryRecord>> {
  const payload: Record<string, unknown> = {};
  if (fields.amount !== undefined) payload.amount = fields.amount;
  if (fields.amount_usd !== undefined) payload.amount_usd = fields.amount_usd;
  if (fields.amount_eur !== undefined) payload.amount_eur = fields.amount_eur;
  if (fields.category !== undefined) payload.category = fields.category;
  if (fields.department !== undefined) payload.department = fields.department;
  if (fields.cost_owner_type !== undefined) payload.cost_owner_type = fields.cost_owner_type;
  if (fields.model_id !== undefined) payload.model = fields.model_id ? [fields.model_id] : [];
  if (fields.team_member_id !== undefined) payload.team_member = fields.team_member_id ? [fields.team_member_id] : [];
  if (fields.description !== undefined) payload.description = fields.description;
  if (fields.vendor !== undefined) payload.vendor = fields.vendor;
  if (fields.date !== undefined) payload.date = fields.date;
  if (fields.receipt_url !== undefined) payload.receipt_url = fields.receipt_url;
  return updateRecord('expense_entries', recordId, payload) as Promise<AirtableRecord<ExpenseEntryRecord>>;
}

export async function deleteExpense(recordId: string): Promise<void> {
  return deleteRecordById('expense_entries', recordId);
}

// --- Global revenue (all revenue_entries with filters). revenue_entries.month links to months. ---

export interface ListRevenueFilters {
  month_id?: string;
  month_ids?: string[]; // OR of month record ids (for agency range)
  /** Period: when both set, resolves to month_ids via getMonthRecordIdsInRange (takes precedence over month_id/month_ids). */
  from_month_key?: string;
  to_month_key?: string;
  model_id?: string;
}

/** Only non-empty filter values are applied. When from_month_key+to_month_key provided, resolves to month_ids. Returns [] if no records. */
export async function listRevenue(filters: ListRevenueFilters = {}): Promise<AirtableRecord<RevenueEntryRecord>[]> {
  let resolvedFilters = { ...filters };
  if (filters.from_month_key != null && filters.to_month_key != null && filters.from_month_key !== '' && filters.to_month_key !== '') {
    const monthIds = await getMonthRecordIdsInRange(filters.from_month_key, filters.to_month_key);
    resolvedFilters = { ...filters, month_ids: monthIds.length > 0 ? monthIds : undefined, month_id: undefined };
    delete (resolvedFilters as Record<string, unknown>).from_month_key;
    delete (resolvedFilters as Record<string, unknown>).to_month_key;
  }

  const parts: string[] = [];
  if (resolvedFilters.month_id?.trim()) {
    const id = escapeFormulaValue(resolvedFilters.month_id.trim());
    parts.push(`FIND("${id},", ARRAYJOIN({month}, ",") & ",") > 0`);
  }
  if (resolvedFilters.month_ids && resolvedFilters.month_ids.length > 0) {
    const ids = resolvedFilters.month_ids.map((id) => id?.trim()).filter((id): id is string => Boolean(id));
    if (ids.length > 0) {
      const monthOr = ids.map((id) => `FIND("${escapeFormulaValue(id)},", ARRAYJOIN({month}, ",") & ",") > 0`).join(', ');
      parts.push(`OR(${monthOr})`);
    }
  }
  if (resolvedFilters.model_id?.trim()) {
    parts.push(`ARRAYJOIN({model_id_lookup},"")="${escapeFormulaValue(resolvedFilters.model_id.trim())}"`);
  }
  const formula = parts.length ? `AND(${parts.join(', ')})` : undefined;
  if (process.env.NODE_ENV === 'development' && formula) {
    console.log('[airtable listRevenue] formula', formula);
  }
  return listRecords<RevenueEntryRecord>('revenue_entries', {
    filterByFormula: formula,
    sort: [{ field: 'amount', direction: 'desc' }],
  });
}

export async function createRevenue(fields: {
  model_id: string;
  month_id: string;
  type: string;
  amount: number;
  amount_usd?: number;
  amount_eur?: number;
  description?: string;
  date?: string;
  created_by: string;
}): Promise<AirtableRecord<RevenueEntryRecord>> {
  const base: Record<string, unknown> = {
    model: [fields.model_id],
    month: [fields.month_id],
    type: fields.type,
    amount: fields.amount,
    description: fields.description ?? '',
    date: fields.date ?? new Date().toISOString().slice(0, 10),
    created_by: fields.created_by,
  };
  if (typeof fields.amount_usd === 'number') base.amount_usd = fields.amount_usd;
  if (typeof fields.amount_eur === 'number') base.amount_eur = fields.amount_eur;
  return createRecord('revenue_entries', base) as Promise<AirtableRecord<RevenueEntryRecord>>;
}

// --- monthly_member_basis (manual basis inputs for payouts) ---

export interface ListMonthlyBasisFilters {
  month_id?: string;
  /** Month key string (e.g. "2026-01") for scalar {month} field. */
  month_key?: string;
  team_member_id?: string;
  /** Numeric or string id for scalar {team_member} field. */
  team_member_numeric?: number | string;
  basis_type?: string;
}

/** Build filterByFormula for monthly_member_basis. Supports both linked (month/team_member as record id arrays) and scalar (month as "2026-01", team_member as number or string). */
export function buildMonthlyMemberBasisFormula(filters: ListMonthlyBasisFilters = {}): string | undefined {
  const parts: string[] = [];

  // Month: OR(linked match, scalar match) when both id and key provided; otherwise single shape.
  const monthId = filters.month_id?.trim();
  const monthKey = filters.month_key?.trim();
  if (monthId && monthKey) {
    const linkedMonth = `FIND("${escapeFormulaValue(monthId)},", ARRAYJOIN({month}, ",") & ",") > 0`;
    const scalarMonth = `{month} = "${escapeFormulaValue(monthKey)}"`;
    parts.push(`OR(${linkedMonth}, ${scalarMonth})`);
  } else if (monthKey) {
    parts.push(`{month} = "${escapeFormulaValue(monthKey)}"`);
  } else if (monthId) {
    parts.push(`FIND("${escapeFormulaValue(monthId)},", ARRAYJOIN({month}, ",") & ",") > 0`);
  }

  // Team member: OR(linked, scalar) when both provided; otherwise single shape.
  const teamId = filters.team_member_id?.trim();
  const teamNum = filters.team_member_numeric;
  const hasTeamNum = teamNum !== undefined && teamNum !== null && teamNum !== '';
  if (teamId && hasTeamNum) {
    const linkedTeam = `FIND("${escapeFormulaValue(teamId)},", ARRAYJOIN({team_member}, ",") & ",") > 0`;
    const scalarTeam = typeof teamNum === 'number' ? `{team_member} = ${teamNum}` : `{team_member} = "${escapeFormulaValue(String(teamNum))}"`;
    parts.push(`OR(${linkedTeam}, ${scalarTeam})`);
  } else if (hasTeamNum) {
    if (typeof teamNum === 'number') {
      parts.push(`{team_member} = ${teamNum}`);
    } else {
      parts.push(`{team_member} = "${escapeFormulaValue(String(teamNum))}"`);
    }
  } else if (teamId) {
    parts.push(`FIND("${escapeFormulaValue(teamId)},", ARRAYJOIN({team_member}, ",") & ",") > 0`);
  }

  if (filters.basis_type?.trim()) {
    parts.push(`{basis_type}="${escapeFormulaValue(filters.basis_type.trim())}"`);
  }
  return parts.length ? `AND(${parts.join(', ')})` : undefined;
}

/** List monthly_member_basis rows. Optional month_id and/or team_member_id. */
export async function listMonthlyMemberBasis(
  filters: ListMonthlyBasisFilters = {}
): Promise<AirtableRecord<MonthlyMemberBasisRecord>[]> {
  const formula = buildMonthlyMemberBasisFormula(filters);
  return listRecords<MonthlyMemberBasisRecord>('monthly_member_basis', {
    filterByFormula: formula,
  });
}

/** List monthly_member_basis for a single month (convenience). */
export async function listMonthlyMemberBasisByMonth(monthId: string): Promise<AirtableRecord<MonthlyMemberBasisRecord>[]> {
  if (!monthId?.trim()) return [];
  return listMonthlyMemberBasis({ month_id: monthId.trim() });
}

const MONTHLY_MEMBER_BASIS_ALLOWED = ALLOWED_KEYS_BY_TABLE.monthly_member_basis!;

function assertMonthlyMemberBasisPayload(payload: Record<string, unknown>): void {
  for (const key of Object.keys(payload)) {
    if (!MONTHLY_MEMBER_BASIS_ALLOWED.has(key)) {
      throw new Error(`monthly_member_basis: unknown field "${key}" would be sent to Airtable. Allowed: ${[...MONTHLY_MEMBER_BASIS_ALLOWED].join(', ')}`);
    }
  }
}

export async function createMonthlyMemberBasis(fields: {
  month_id?: string;
  month_key?: string;
  team_member_id?: string;
  team_member_numeric?: number | string;
  basis_type: string;
  amount: number;
  amount_usd?: number;
  amount_eur?: number;
  notes?: string;
}): Promise<AirtableRecord<MonthlyMemberBasisRecord>> {
  const monthId = fields.month_id?.trim();
  const monthKey = fields.month_key?.trim();
  const teamMemberId = fields.team_member_id?.trim();
  const teamNum = fields.team_member_numeric;
  const hasMonth = Boolean(monthId) || Boolean(monthKey);
  const hasTeam = Boolean(teamMemberId) || (teamNum !== undefined && teamNum !== null && teamNum !== '');
  if (!hasMonth) throw new Error('month_id or month_key is required for monthly_member_basis');
  if (!hasTeam) throw new Error('team_member_id or team_member_numeric is required for monthly_member_basis');

  // Linked fields in Airtable must always be arrays of record IDs.
  // We never want to send raw strings, numbers, or objects for {month} / {team_member}.
  if (!monthId) {
    throw new Error('monthly_member_basis: month_id is required to write linked month field');
  }
  if (!teamMemberId) {
    throw new Error('monthly_member_basis: team_member_id is required to write linked team_member field');
  }

  const monthField = Array.isArray(monthId) ? monthId : [monthId];
  const memberField = Array.isArray(teamMemberId) ? teamMemberId : [teamMemberId];

  // Sanitize select fields: never send empty string; omit if missing (Airtable would try to create new option).
  const basisTypeVal = fields.basis_type != null ? String(fields.basis_type).trim() : '';

  const rawPayload: Record<string, unknown> = {
    month: monthField,
    team_member: memberField,
    amount: typeof fields.amount_eur === 'number' ? fields.amount_eur : fields.amount,
    notes: typeof fields.notes === 'string' ? fields.notes : (fields.notes ?? ''),
  };
  if (basisTypeVal !== '') rawPayload.basis_type = basisTypeVal;
  if (typeof fields.amount_usd === 'number') rawPayload.amount_usd = fields.amount_usd;
  if (typeof fields.amount_eur === 'number') rawPayload.amount_eur = fields.amount_eur;

  const ALLOWED_FIELDS: Array<'month' | 'team_member' | 'basis_type' | 'amount_usd' | 'amount_eur' | 'amount' | 'notes'> = [
    'month',
    'team_member',
    'basis_type',
    'amount_usd',
    'amount_eur',
    'amount',
    'notes',
  ];

  const payload: Record<string, unknown> = {};
  for (const key of ALLOWED_FIELDS) {
    if (rawPayload[key] !== undefined) {
      payload[key] = rawPayload[key];
    }
  }

  if (typeof console !== 'undefined' && console.log) {
    console.log('[monthly_member_basis] fields sent to Airtable', JSON.stringify(payload));
  }

  assertMonthlyMemberBasisPayload(payload);
  return createRecord('monthly_member_basis', payload) as Promise<AirtableRecord<MonthlyMemberBasisRecord>>;
}

export async function updateMonthlyMemberBasis(
  recordId: string,
  fields: Partial<{ amount: number; amount_usd: number; amount_eur: number; notes: string; team_member: string[] }>
): Promise<AirtableRecord<MonthlyMemberBasisRecord>> {
  const payload: Record<string, unknown> = {};
  if (fields.amount !== undefined) payload.amount = fields.amount;
  if (fields.amount_usd !== undefined) payload.amount_usd = fields.amount_usd;
  if (fields.amount_eur !== undefined) {
    payload.amount_eur = fields.amount_eur;
    payload.amount = fields.amount_eur;
  }
  if (fields.notes !== undefined) payload.notes = fields.notes;
  if (fields.team_member !== undefined && Array.isArray(fields.team_member) && fields.team_member.length > 0) {
    payload.team_member = fields.team_member;
  }
  assertMonthlyMemberBasisPayload(payload);
  return updateRecord('monthly_member_basis', recordId, payload) as Promise<AirtableRecord<MonthlyMemberBasisRecord>>;
}

export async function deleteMonthlyMemberBasis(recordId: string): Promise<void> {
  return deleteRecordById('monthly_member_basis', recordId);
}

/** True if this basis row is an hourly payout (stored as basis_type=bonus with payout_type in notes). */
export function isHourlyBasisRecord(r: { fields: { notes?: unknown } }): boolean {
  try {
    const n = r.fields.notes;
    if (typeof n !== 'string' || !n.trim()) return false;
    const j = JSON.parse(n) as { payout_type?: string };
    return j != null && j.payout_type === 'hourly';
  } catch {
    return false;
  }
}

/** List monthly_member_basis rows that are hourly for this member+month (duplicate check). Identified via notes.payout_type === 'hourly'. */
export async function listHourlyBasisForMemberMonth(
  monthId: string,
  teamMemberId: string
): Promise<AirtableRecord<MonthlyMemberBasisRecord>[]> {
  if (!monthId?.trim() || !teamMemberId?.trim()) return [];
  const all = await listMonthlyMemberBasis({
    month_id: monthId.trim(),
    team_member_id: teamMemberId.trim(),
  });
  return all.filter((r) => isHourlyBasisRecord(r));
}

/** Create one hourly payout record in monthly_member_basis. Uses existing select option basis_type=bonus. Hourly-specific data in notes as JSON. (Table has no department field.) */
export async function createHourlyPayoutBasis(payload: {
  month_id: string;
  team_member_id: string;
  hours_worked: number;
  hourly_rate_eur: number;
  amount_eur: number;
  amount_usd: number;
  fx_rate: number;
}): Promise<AirtableRecord<MonthlyMemberBasisRecord>> {
  const month_id = String(payload.month_id ?? '').trim();
  const team_member_id = String(payload.team_member_id ?? '').trim();
  const total_eur = typeof payload.amount_eur === 'number' ? payload.amount_eur : 0;
  const notes = JSON.stringify({
    hours_worked: payload.hours_worked,
    hourly_rate_eur: payload.hourly_rate_eur,
    total_eur,
    fx_rate: payload.fx_rate,
    payout_type: 'hourly',
  });
  const fieldsToSend = {
    month_id,
    team_member_id,
    basis_type: 'bonus',
    amount: total_eur,
    amount_eur: total_eur,
    amount_usd: payload.amount_usd,
    notes,
  };
  if (typeof console !== 'undefined' && console.log) {
    console.log('[api/payout-lines/hourly] Airtable fields', JSON.stringify(fieldsToSend));
  }
  return createMonthlyMemberBasis(fieldsToSend);
}

// --- agency_revenues: one record per month; lookup by month_key (cell displays month_key). Do not write revenue_type or created_at. ---

/** Resolve month_key from month_id via months table. Returns null if month not found. */
export async function getMonthKeyFromId(month_id: string): Promise<string | null> {
  if (!month_id?.trim()) return null;
  const rec = await getRecord<MonthsRecord>('months', month_id.trim());
  const key = rec?.fields?.month_key;
  return typeof key === 'string' && key.trim() ? key.trim() : null;
}

/** Normalize a single agency_revenues record to API shape (includes legacy chatting_agency, gunzo_agency). */
function normalizeAgencyRevenuesRecord(
  r: AirtableRecord<AgencyRevenuesRecord>,
  month_id: string,
  month_key: string
): {
  id: string;
  month_id: string;
  month_key: string;
  chatting_agency: number | null;
  gunzo_agency: number | null;
  chatting_amount_usd: number | null;
  chatting_amount_eur: number | null;
  gunzo_amount_usd: number | null;
  gunzo_amount_eur: number | null;
  chatting_msgs_tips_net_usd: number | null;
  chatting_msgs_tips_net_eur: number | null;
  gunzo_msgs_tips_net_usd: number | null;
  gunzo_msgs_tips_net_eur: number | null;
  notes: string | null;
} {
  const f = r.fields;
  return {
    id: r.id,
    month_id,
    month_key,
    chatting_agency: typeof f.chatting_agency === 'number' ? f.chatting_agency : null,
    gunzo_agency: typeof f.gunzo_agency === 'number' ? f.gunzo_agency : null,
    chatting_amount_usd: typeof f.chatting_amount_usd === 'number' ? f.chatting_amount_usd : null,
    chatting_amount_eur: typeof f.chatting_amount_eur === 'number' ? f.chatting_amount_eur : null,
    gunzo_amount_usd: typeof f.gunzo_amount_usd === 'number' ? f.gunzo_amount_usd : null,
    gunzo_amount_eur: typeof f.gunzo_amount_eur === 'number' ? f.gunzo_amount_eur : null,
    chatting_msgs_tips_net_usd: typeof f.chatting_msgs_tips_net_usd === 'number' ? f.chatting_msgs_tips_net_usd : null,
    chatting_msgs_tips_net_eur: typeof f.chatting_msgs_tips_net_eur === 'number' ? f.chatting_msgs_tips_net_eur : null,
    gunzo_msgs_tips_net_usd: typeof f.gunzo_msgs_tips_net_usd === 'number' ? f.gunzo_msgs_tips_net_usd : null,
    gunzo_msgs_tips_net_eur: typeof f.gunzo_msgs_tips_net_eur === 'number' ? f.gunzo_msgs_tips_net_eur : null,
    notes: typeof f.notes === 'string' ? f.notes : null,
  };
}

/** Fetch agency_revenues record for a month. Resolves month_key from month_id, then filters by {month} = month_key (cell displays month_key). If multiple exist, picks newest and logs warning. */
export async function getAgencyRevenuesForMonth(month_id: string): Promise<{
  id: string;
  month_id: string;
  month_key: string;
  chatting_agency: number | null;
  gunzo_agency: number | null;
  chatting_amount_usd: number | null;
  chatting_amount_eur: number | null;
  gunzo_amount_usd: number | null;
  gunzo_amount_eur: number | null;
  chatting_msgs_tips_net_usd: number | null;
  chatting_msgs_tips_net_eur: number | null;
  gunzo_msgs_tips_net_usd: number | null;
  gunzo_msgs_tips_net_eur: number | null;
  notes: string | null;
} | null> {
  if (!month_id?.trim()) return null;
  const monthId = month_id.trim();
  const month_key = await getMonthKeyFromId(monthId);
  if (!month_key) return null;
  const formula = `{month} = "${escapeFormulaValue(month_key)}"`;
  const tableNameUsed = getTableName(AGENCY_REVENUES_TABLE_KEY);
  const records = await listRecords<AgencyRevenuesRecord>(AGENCY_REVENUES_TABLE_KEY, {
    filterByFormula: formula,
    maxRecords: 10,
  });
  if (process.env.NODE_ENV === 'development') {
    console.log('[agency_revenues] table:', tableNameUsed, 'filterByFormula:', formula, 'recordsReturned:', records.length);
    if (records.length > 1) {
      console.warn('[agency_revenues] duplicate records for month', month_key, 'recordIds:', records.map((r) => r.id));
    }
  }
  if (records.length === 0) return null;
  const rec = records.length === 1
    ? records[0]
    : records.slice().sort((a, b) => (b.createdTime ?? '').localeCompare(a.createdTime ?? ''))[0];
  return normalizeAgencyRevenuesRecord(rec, monthId, month_key);
}

/** Upsert agency_revenues for a month: first get existing by month_key; if found update, else create. Never write revenue_type or created_at. */
export async function upsertAgencyRevenuesForMonth(
  month_id: string,
  payload: {
    chatting_amount_usd?: number;
    chatting_amount_eur?: number;
    gunzo_amount_usd?: number;
    gunzo_amount_eur?: number;
    chatting_msgs_tips_net_usd?: number;
    chatting_msgs_tips_net_eur?: number;
    gunzo_msgs_tips_net_usd?: number;
    gunzo_msgs_tips_net_eur?: number;
    notes?: string;
  }
): Promise<AirtableRecord<AgencyRevenuesRecord>> {
  const existing = await getAgencyRevenuesForMonth(month_id);
  const fields: Record<string, unknown> = {};
  if (payload.chatting_amount_usd !== undefined) fields.chatting_amount_usd = payload.chatting_amount_usd;
  if (payload.chatting_amount_eur !== undefined) fields.chatting_amount_eur = payload.chatting_amount_eur;
  if (payload.gunzo_amount_usd !== undefined) fields.gunzo_amount_usd = payload.gunzo_amount_usd;
  if (payload.gunzo_amount_eur !== undefined) fields.gunzo_amount_eur = payload.gunzo_amount_eur;
  if (payload.chatting_msgs_tips_net_usd !== undefined) fields.chatting_msgs_tips_net_usd = payload.chatting_msgs_tips_net_usd;
  if (payload.chatting_msgs_tips_net_eur !== undefined) fields.chatting_msgs_tips_net_eur = payload.chatting_msgs_tips_net_eur;
  if (payload.gunzo_msgs_tips_net_usd !== undefined) fields.gunzo_msgs_tips_net_usd = payload.gunzo_msgs_tips_net_usd;
  if (payload.gunzo_msgs_tips_net_eur !== undefined) fields.gunzo_msgs_tips_net_eur = payload.gunzo_msgs_tips_net_eur;
  if (payload.notes !== undefined) fields.notes = payload.notes;

  if (existing) {
    const updated = await updateRecord(AGENCY_REVENUES_TABLE_KEY, existing.id, fields);
    return updated as AirtableRecord<AgencyRevenuesRecord>;
  }
  const createFields: Record<string, unknown> = { month: [month_id.trim()], ...fields };
  return createRecord(AGENCY_REVENUES_TABLE_KEY, createFields) as Promise<AirtableRecord<AgencyRevenuesRecord>>;
}

// --- payout_runs (month-bucketed via month link; no period_start/period_end) ---

const PAYOUT_RUN_ALLOWED_KEYS = new Set(['month', 'status', 'locked_at', 'paid_at', 'notes']);

export async function listPayoutRuns(month_id?: string): Promise<AirtableRecord<PayoutRunRecord>[]> {
  const sortNewestFirst = (arr: AirtableRecord<PayoutRunRecord>[]) =>
    arr.slice().sort((a, b) => (b.createdTime ?? '').localeCompare(a.createdTime ?? ''));

  if (!month_id?.trim()) {
    const all = await listRecords<PayoutRunRecord>('payout_runs', {});
    return sortNewestFirst(all);
  }

  const mid = month_id.trim();
  const escaped = escapeFormulaValue(mid);
  const formula = `FIND("${escaped}", ARRAYJOIN({month})) > 0`;
  const runs = await listRecords<PayoutRunRecord>('payout_runs', {
    filterByFormula: formula,
  });

  if (runs.length > 0) return sortNewestFirst(runs);

  // Fallback: formula may not match if Airtable returns primary field for {month}; filter in memory
  const all = await listRecords<PayoutRunRecord>('payout_runs', {});
  const filtered = all.filter((r) => (r.fields.month ?? []).includes(mid));
  return sortNewestFirst(filtered);
}

/** Alias for listPayoutRuns filtered by month. */
export async function listPayoutRunsByMonth(monthId: string): Promise<AirtableRecord<PayoutRunRecord>[]> {
  return listPayoutRuns(monthId?.trim() || undefined);
}

export async function getPayoutRun(recordId: string): Promise<AirtableRecord<PayoutRunRecord> | null> {
  return getRecord<PayoutRunRecord>('payout_runs', recordId);
}

/** Get existing payout run for month or create a new draft run. */
export async function getOrCreatePayoutRun(monthId: string): Promise<AirtableRecord<PayoutRunRecord>> {
  if (!monthId?.trim()) throw new Error('monthId is required');
  const runs = await listPayoutRuns(monthId.trim());
  if (runs.length > 0) {
    // If multiple runs exist for the same month, prefer the newest by createdTime.
    const newest = runs.reduce((acc, run) => {
      if (!acc) return run;
      const runCreated = run.createdTime ?? '';
      const accCreated = acc.createdTime ?? '';
      return runCreated > accCreated ? run : acc;
    }, runs[0] as AirtableRecord<PayoutRunRecord> | null)!;
    if (process.env.NODE_ENV === 'development' && runs.length > 1 && typeof console !== 'undefined' && console.warn) {
      console.warn('[getOrCreatePayoutRun] multiple payout_runs for month; using newest by createdTime', {
        monthId: monthId.trim(),
        allRunIds: runs.map((r) => r.id),
        chosenRunId: newest.id,
      });
    }
    return newest;
  }
  return createPayoutRun({ month_id: monthId.trim(), status: 'draft' });
}

export async function createPayoutRun(fields: {
  month_id: string;
  status?: 'draft' | 'locked' | 'paid';
  locked_at?: string;
  paid_at?: string;
  notes?: string;
}): Promise<AirtableRecord<PayoutRunRecord>> {
  const runFields: Record<string, unknown> = {
    month: [fields.month_id],
    status: fields.status ?? 'draft',
  };
  if (fields.notes !== undefined && fields.notes !== '') runFields.notes = fields.notes;
  if (fields.locked_at !== undefined) runFields.locked_at = fields.locked_at;
  if (fields.paid_at !== undefined) runFields.paid_at = fields.paid_at;
  if (process.env.NODE_ENV === 'development') {
    console.log('[payout run] fields keys', Object.keys(runFields));
  }
  return createRecord('payout_runs', runFields) as Promise<AirtableRecord<PayoutRunRecord>>;
}

export async function updatePayoutRun(
  recordId: string,
  fields: Partial<{ status: 'draft' | 'locked' | 'paid'; locked_at: string; paid_at: string; notes: string }>
): Promise<AirtableRecord<PayoutRunRecord>> {
  const payload: Record<string, unknown> = {};
  const allowed = PAYOUT_RUN_ALLOWED_KEYS;
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.has(k) && v !== undefined) payload[k] = v;
  }
  return updateRecord('payout_runs', recordId, payload) as Promise<AirtableRecord<PayoutRunRecord>>;
}

export async function deletePayoutRun(recordId: string): Promise<void> {
  return deleteRecordById('payout_runs', recordId);
}

// --- payout_lines ---

export async function listPayoutLines(run_id: string): Promise<AirtableRecord<PayoutLineRecord>[]> {
  if (!run_id?.trim()) return [];
  const runId = run_id.trim();
  const escaped = escapeFormulaValue(runId);
  const formula = `FIND("${escaped}", ARRAYJOIN({payout_run})) > 0`;
  const records = await listRecords<PayoutLineRecord>('payout_lines', {
    filterByFormula: formula,
    sort: [{ field: 'team_member', direction: 'asc' }],
  });
  if (records.length > 0) return records;
  const all = await listRecords<PayoutLineRecord>('payout_lines', {});
  const filtered = all.filter((r) => (r.fields.payout_run ?? []).includes(runId));
  return filtered.sort((a, b) => {
    const ta = a.fields.team_member?.[0] ?? '';
    const tb = b.fields.team_member?.[0] ?? '';
    return ta.localeCompare(tb);
  });
}

/**
 * Payout runs whose month is in [from_month_key, to_month_key].
 */
export async function getPayoutRunsInRange(
  from_month_key: string,
  to_month_key: string
): Promise<AirtableRecord<PayoutRunRecord>[]> {
  const monthIds = await getMonthRecordIdsInRange(from_month_key.trim(), to_month_key.trim());
  if (monthIds.length === 0) return [];
  const allRuns = await listRecords<PayoutRunRecord>('payout_runs', {});
  return allRuns.filter((r) => {
    const mid = Array.isArray(r.fields.month) ? r.fields.month[0] : undefined;
    return mid && monthIds.includes(mid);
  });
}

export type PayoutLinesRangeOpts = {
  /** live = all runs in range; locked = only runs with status in ['locked','paid'] */
  source: 'live' | 'locked';
  /** owed = all lines in scope; paid = only lines from runs with status 'paid' (or line paid_status 'paid') */
  mode: 'owed' | 'paid';
};

/**
 * List payout_lines for a month range. Filters by runs in range, then by source (live vs locked) and mode (owed vs paid).
 */
export async function listPayoutLinesInRange(
  from_month_key: string,
  to_month_key: string,
  opts: PayoutLinesRangeOpts
): Promise<AirtableRecord<PayoutLineRecord>[]> {
  const runs = await getPayoutRunsInRange(from_month_key, to_month_key);
  let runIds = runs.map((r) => r.id);
  const runStatusById = new Map(runs.map((r) => [r.id, r.fields.status ?? 'draft']));
  if (opts.source === 'locked') {
    runIds = runIds.filter((id) => {
      const s = runStatusById.get(id);
      return s === 'locked' || s === 'paid';
    });
  }
  if (opts.mode === 'paid') {
    runIds = runIds.filter((id) => runStatusById.get(id) === 'paid');
  }
  if (runIds.length === 0) return [];
  const runIdSet = new Set(runIds);
  const allLines = await listRecords<PayoutLineRecord>('payout_lines', { maxRecords: 1000 });
  return allLines.filter((r) => {
    const rid = Array.isArray(r.fields.payout_run) ? r.fields.payout_run[0] : undefined;
    return rid != null && runIdSet.has(rid);
  });
}

export async function createPayoutLine(fields: {
  payout_run_id: string;
  /** Required for non-model lines; optional for model lines (use payee if present). */
  team_member_id?: string;
  /** Model record id for model lines. When set, department should be "models" and role "model". */
  model_id?: string;
  department?: string;
  role?: string;
  payout_type?: string;
  payout_percentage?: number;
  payout_flat_fee?: number;
  basis_webapp_amount?: number;
  basis_manual_amount?: number;
  bonus_amount?: number;
  adjustments_amount?: number;
  basis_total?: number;
  payout_amount: number;
  amount_eur?: number;
  amount_usd?: number;
  fx_rate_usd_eur?: number;
  breakdown_json?: string;
  paid_status?: string;
  paid_at?: string | null;
}): Promise<AirtableRecord<PayoutLineRecord>> {
  const amountEur = fields.amount_eur ?? fields.payout_amount;
  const lineFields: Record<string, unknown> = {
    payout_run: [fields.payout_run_id],
    team_member: fields.team_member_id ? [fields.team_member_id] : [],
    role: fields.role ?? '',
    department: fields.department ?? '',
    basis_webapp_amount: fields.basis_webapp_amount ?? 0,
    basis_manual_amount: fields.basis_manual_amount ?? 0,
    bonus_amount: fields.bonus_amount ?? 0,
    adjustments_amount: fields.adjustments_amount ?? 0,
    basis_total: fields.basis_total ?? 0,
    payout_type: fields.payout_type ?? 'none',
    payout_percentage: fields.payout_percentage ?? 0,
    payout_flat_fee: fields.payout_flat_fee ?? 0,
    payout_amount: fields.payout_amount,
    amount_eur: amountEur,
  };
  if (typeof fields.amount_usd === 'number') lineFields.amount_usd = fields.amount_usd;
  if (typeof fields.fx_rate_usd_eur === 'number' && Number.isFinite(fields.fx_rate_usd_eur)) {
    lineFields.fx_rate_usd_eur = Math.round(fields.fx_rate_usd_eur * 1e6) / 1e6;
  }
  if (fields.breakdown_json != null) lineFields.breakdown_json = fields.breakdown_json;
  if (fields.paid_status !== undefined) lineFields.paid_status = fields.paid_status;
  if (fields.paid_at !== undefined) lineFields.paid_at = fields.paid_at;
  if (fields.model_id?.trim()) lineFields.model = [fields.model_id.trim()];
  if (process.env.NODE_ENV === 'development') {
    console.log('[payout line] fields keys', Object.keys(lineFields));
  }
  return createRecord('payout_lines', lineFields) as Promise<AirtableRecord<PayoutLineRecord>>;
}

export async function deletePayoutLine(recordId: string): Promise<void> {
  return deleteRecordById('payout_lines', recordId);
}

/** Update payout_line by id. Only provided fields are written. */
export async function updatePayoutLine(
  recordId: string,
  fields: Partial<{
    paid_status: string;
    paid_at: string | null;
    gross_usd: number;
    base_payout_usd: number;
    bonus_total_usd: number;
    fine_total_usd: number;
    final_payout_usd: number;
    final_payout_eur: number;
    fx_rate_usd_eur: number;
    payout_percentage: number;
    payout_amount: number;
    amount_usd: number;
    amount_eur: number;
    basis_manual_amount: number;
    bonus_amount: number;
    adjustments_amount: number;
    basis_total: number;
  }>
): Promise<AirtableRecord<PayoutLineRecord>> {
  const payload: Record<string, unknown> = {};
  if (fields.paid_status !== undefined) payload.paid_status = fields.paid_status;
  if (fields.paid_at !== undefined) payload.paid_at = fields.paid_at;
  if (typeof fields.gross_usd === 'number') payload.gross_usd = fields.gross_usd;
  if (typeof fields.base_payout_usd === 'number') payload.base_payout_usd = fields.base_payout_usd;
  if (typeof fields.bonus_total_usd === 'number') payload.bonus_total_usd = fields.bonus_total_usd;
  if (typeof fields.fine_total_usd === 'number') payload.fine_total_usd = fields.fine_total_usd;
  if (typeof fields.final_payout_usd === 'number') payload.final_payout_usd = fields.final_payout_usd;
  if (typeof fields.final_payout_eur === 'number') payload.final_payout_eur = fields.final_payout_eur;
  if (typeof fields.fx_rate_usd_eur === 'number') payload.fx_rate_usd_eur = fields.fx_rate_usd_eur;
  if (typeof fields.payout_percentage === 'number') payload.payout_percentage = fields.payout_percentage;
  if (typeof fields.payout_amount === 'number') payload.payout_amount = fields.payout_amount;
  if (typeof fields.amount_usd === 'number') payload.amount_usd = fields.amount_usd;
  if (typeof fields.amount_eur === 'number') payload.amount_eur = fields.amount_eur;
  if (typeof fields.basis_manual_amount === 'number') payload.basis_manual_amount = fields.basis_manual_amount;
  if (typeof fields.bonus_amount === 'number') payload.bonus_amount = fields.bonus_amount;
  if (typeof fields.adjustments_amount === 'number') payload.adjustments_amount = fields.adjustments_amount;
  if (typeof fields.basis_total === 'number') payload.basis_total = fields.basis_total;
  if (Object.keys(payload).length === 0) return getRecord<PayoutLineRecord>('payout_lines', recordId) as Promise<AirtableRecord<PayoutLineRecord>>;
  return updateRecord('payout_lines', recordId, payload) as Promise<AirtableRecord<PayoutLineRecord>>;
}

/** Upsert payout_lines from summary (compute-and-save). Updates existing lines with computed fields only; never overwrites paid_status/paid_at. Creates new lines with paid_status=pending. */
export async function upsertPayoutLinesFromSummary(
  runId: string,
  lines: Array<{
    team_member_id: string;
    gross_usd: number;
    payout_percentage: number;
    base_payout_usd: number;
    bonus_total_usd: number;
    fine_total_usd: number;
    final_payout_usd: number;
    final_payout_eur: number;
    fx_rate_usd_eur: number;
  }>
): Promise<AirtableRecord<PayoutLineRecord>[]> {
  if (!runId?.trim()) return [];
  const existing = await listPayoutLines(runId.trim());
  const byTeamMember = new Map<string, AirtableRecord<PayoutLineRecord>>();
  for (const rec of existing) {
    const tmId = rec.fields.team_member?.[0] ?? '';
    if (tmId) byTeamMember.set(tmId, rec);
  }
  const result: AirtableRecord<PayoutLineRecord>[] = [];
  for (const line of lines) {
    const rec = byTeamMember.get(line.team_member_id);
    if (rec) {
      const updated = await updatePayoutLine(rec.id, {
        gross_usd: line.gross_usd,
        payout_percentage: line.payout_percentage,
        base_payout_usd: line.base_payout_usd,
        bonus_total_usd: line.bonus_total_usd,
        fine_total_usd: line.fine_total_usd,
        final_payout_usd: line.final_payout_usd,
        final_payout_eur: line.final_payout_eur,
        fx_rate_usd_eur: line.fx_rate_usd_eur,
        payout_amount: line.final_payout_usd,
        amount_usd: line.final_payout_usd,
        amount_eur: line.final_payout_eur,
        basis_manual_amount: line.base_payout_usd,
        bonus_amount: line.bonus_total_usd,
        adjustments_amount: line.fine_total_usd,
        basis_total: line.base_payout_usd + line.bonus_total_usd - line.fine_total_usd,
      });
      result.push(updated);
    } else {
      const created = await createPayoutLine({
        payout_run_id: runId.trim(),
        team_member_id: line.team_member_id,
        department: 'chatting',
        role: 'chatter',
        payout_type: 'percentage',
        payout_percentage: line.payout_percentage,
        basis_webapp_amount: 0,
        basis_manual_amount: line.base_payout_usd,
        bonus_amount: line.bonus_total_usd,
        adjustments_amount: line.fine_total_usd,
        basis_total: line.base_payout_usd + line.bonus_total_usd - line.fine_total_usd,
        payout_amount: line.final_payout_usd,
        amount_eur: line.final_payout_eur,
        amount_usd: line.final_payout_usd,
        paid_status: 'pending',
      });
      const withSummary = await updatePayoutLine(created.id, {
        gross_usd: line.gross_usd,
        base_payout_usd: line.base_payout_usd,
        bonus_total_usd: line.bonus_total_usd,
        fine_total_usd: line.fine_total_usd,
        final_payout_usd: line.final_payout_usd,
        final_payout_eur: line.final_payout_eur,
        fx_rate_usd_eur: line.fx_rate_usd_eur,
      });
      result.push(withSummary);
    }
  }
  return result;
}

/** Replace all payout_lines for a run: delete existing then create new. Supports team_member lines and model lines (model_id + department "models"). */
export async function upsertPayoutLines(
  runId: string,
  lines: Array<{
    team_member_id?: string;
    model_id?: string;
    department?: string;
    role?: string;
    payout_type?: string;
    payout_percentage?: number;
    payout_flat_fee?: number;
    basis_webapp_amount?: number;
    basis_manual_amount?: number;
    bonus_amount?: number;
    adjustments_amount?: number;
    basis_total?: number;
    payout_amount: number;
    amount_eur?: number;
    amount_usd?: number;
    fx_rate_usd_eur?: number;
    breakdown_json?: string;
  }>
): Promise<AirtableRecord<PayoutLineRecord>[]> {
  if (!runId?.trim()) return [];
  const existing = await listPayoutLines(runId.trim());
  for (const rec of existing) {
    await deletePayoutLine(rec.id);
  }
  const created: AirtableRecord<PayoutLineRecord>[] = [];
  for (const line of lines) {
    const rec = await createPayoutLine({
      payout_run_id: runId.trim(),
      team_member_id: line.team_member_id,
      model_id: line.model_id,
      department: line.department,
      role: line.role,
      payout_type: line.payout_type,
      payout_percentage: line.payout_percentage,
      payout_flat_fee: line.payout_flat_fee,
      basis_webapp_amount: line.basis_webapp_amount,
      basis_manual_amount: line.basis_manual_amount,
      bonus_amount: line.bonus_amount,
      adjustments_amount: line.adjustments_amount,
      basis_total: line.basis_total,
      payout_amount: line.payout_amount,
      amount_eur: line.amount_eur,
      amount_usd: line.amount_usd,
      fx_rate_usd_eur: line.fx_rate_usd_eur,
      breakdown_json: line.breakdown_json,
    });
    created.push(rec);
  }
  return created;
}
