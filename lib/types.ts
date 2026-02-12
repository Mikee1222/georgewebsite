/** Airtable record wrapper */
export interface AirtableRecord<T> {
  id: string;
  createdTime?: string;
  fields: T;
}

/** Settings table */
export interface SettingsRecord {
  setting_name: string;
  value: number;
  description?: string;
}

/** Models table */
export interface ModelsRecord {
  name?: string;
  status?: 'Active' | 'Inactive' | 'On Hold';
  /** Linked team_member (payee) record id(s). Used for payment methods lookup. */
  team_member?: string[];
  /** Exact Airtable select option labels; do not change. */
  compensation_type?: 'Salary' | 'Percentage' | 'Hybrid' | 'Tiered deal (threshold)';
  creator_payout_pct?: number;
  /** Base salary in EUR (for Salary / Hybrid). */
  salary_eur?: number;
  /** Base salary in USD (for Salary / Hybrid). Stored with salary_eur; both kept in sync via UI + fx. */
  salary_usd?: number;
  /** Tiered (cliff) deal: monthly threshold in USD, flat under threshold, % above. */
  deal_threshold?: number;
  /** Flat payout under threshold in EUR. */
  deal_flat_under_threshold?: number;
  /** Flat payout under threshold in USD. */
  deal_flat_under_threshold_usd?: number;
  deal_percent_above_threshold?: number;
  notes?: string;
  created_date?: string;
}

/** Months table */
export interface MonthsRecord {
  month_key: string;
  month_name?: string;
  year?: number;
  month_number?: number;
  is_future?: boolean;
}

/** Weeks table: week_start, week_end (dates), week_key derived in app. */
export interface WeeksRecord {
  week_id?: number;
  week_start?: string;
  week_end?: string;
  week_key?: string;
  months?: string[];
  weekly_model_stats?: string[];
}

/** Weekly model stats: per model per week. User fills one of gross_revenue or net_revenue. Airtable computes computed_gross_usd/computed_net_usd (OF fee 20%). amount_eur FX snapshot at save. */
export interface WeeklyModelStatsRecord {
  model?: string[];
  week?: string[];
  gross_revenue?: number;
  net_revenue?: number;
  amount_usd?: number;
  amount_eur?: number;
  /** Airtable formula: IF(gross_revenue,...) else ROUND(net_revenue/0.8,2) */
  computed_gross_usd?: number;
  /** Airtable formula: IF(net_revenue,...) else ROUND(gross_revenue*0.8,2) */
  computed_net_usd?: number;
}

/** model_forecasts table: hybrid forecast (auto + editable) per model/month/scenario. unique_key = model_id_lookup & "-" & month_key_lookup & "-" & scenario. */
export type ModelForecastScenario = 'expected' | 'conservative' | 'aggressive';
export type ModelForecastSourceType = 'auto' | 'manual' | 'hybrid';

/** weekly_model_forecasts: per model/week/scenario. unique_key = model_id-week_key-scenario (formula lookups). */
export interface WeeklyModelForecastRecord {
  model?: string[];
  week?: string[];
  scenario?: ModelForecastScenario;
  projected_net_usd?: number;
  projected_gross_usd?: number;
  projected_net_eur?: number;
  projected_gross_eur?: number;
  fx_rate_usd_eur?: number;
  source_type?: ModelForecastSourceType;
  is_locked?: boolean;
  notes?: string;
  unique_key?: string;
}

export interface ModelForecastRecord {
  model?: string[];
  month?: string[];
  scenario?: ModelForecastScenario;
  projected_net_usd?: number;
  projected_gross_usd?: number;
  projected_net_eur?: number;
  projected_gross_eur?: number;
  fx_rate_usd_eur?: number;
  source_type?: ModelForecastSourceType;
  is_locked?: boolean;
  notes?: string;
  updated_at?: string;
  unique_key?: string;
  model_id_lookup?: string | string[];
  month_key_lookup?: string | string[];
}

/** PnL input fields (whitelist for PATCH) */
export const PNL_INPUT_FIELDS = [
  'gross_revenue',
  'net_revenue',
  'chatting_costs_team',
  'marketing_costs_team',
  'production_costs_team',
  'ads_spend',
  'other_marketing_costs',
  'salary',
  'affiliate_fee',
  'bonuses',
  'airbnbs',
  'softwares',
  'fx_withdrawal_fees',
  'other_costs',
  'notes_issues',
] as const;

export type PnlInputFieldName = (typeof PNL_INPUT_FIELDS)[number];

/**
 * Raw PnL from Airtable.
 * - model: link field -> models (array of one record id).
 * - month: link field -> months (array of one record id).
 * - unique_key: formula = model_id_lookup & "-" & month_key_lookup & "-" & status (identity for model-month-status).
 * - model_id_lookup, month_key_lookup: lookups from linked model/month.
 */
export interface PnlLinesRecordRaw {
  model?: string[];
  month?: string[];
  status?: 'actual' | 'forecast';
  unique_key?: string;
  model_id_lookup?: string | string[];
  month_key_lookup?: string | string[];
  creator_payout_pct?: number;
  gross_revenue?: number;
  net_revenue?: number;
  chatting_costs_team?: number;
  marketing_costs_team?: number;
  production_costs_team?: number;
  ads_spend?: number;
  other_marketing_costs?: number;
  salary?: number;
  affiliate_fee?: number;
  bonuses?: number;
  airbnbs?: number;
  softwares?: number;
  fx_withdrawal_fees?: number;
  other_costs?: number;
  notes_issues?: string;
}

/** PnL row with computed fields (for UI) */
export interface PnlRow {
  id: string;
  model_id: string;
  month_key: string;
  month_id?: string;
  status: 'actual' | 'forecast';
  month_name?: string;
  gross_revenue: number;
  of_fee: number;
  net_revenue: number;
  chatting_costs_team: number;
  marketing_costs_team: number;
  production_costs_team: number;
  ads_spend: number;
  other_marketing_costs: number;
  total_marketing_costs: number;
  salary: number;
  creator_payout_pct?: number;
  affiliate_fee: number;
  bonuses: number;
  airbnbs: number;
  softwares: number;
  fx_withdrawal_fees: number;
  other_costs: number;
  total_expenses: number;
  net_profit: number;
  profit_margin_pct: number;
  notes_issues: string;
}

/** Agency aggregate row (one per model per period). *_display from API for exact Airtable-style display. */
export interface AgencyRow {
  model_id: string;
  model_name: string;
  /** True when this row is an actual model (from models table); false for team member or synthetic rows. */
  is_model?: boolean;
  month_key: string;
  month_name?: string;
  net_revenue: number;
  total_expenses: number;
  net_profit: number;
  profit_margin_pct: number;
  total_marketing_costs: number;
  chatting_costs_team: number;
  marketing_costs_team: number;
  production_costs_team: number;
  ads_spend: number;
  /** Revenue USD (primary); from pnl_lines actuals. */
  revenue_usd?: number;
  /** Revenue EUR; from pnl or derived. */
  revenue_eur?: number;
  /** Expenses USD (canonical); from expense_entries. */
  expenses_usd?: number;
  /** Expenses EUR; from expense_entries. */
  expenses_eur?: number;
  /** Profit USD = revenue_usd - expenses_usd. */
  profit_usd?: number;
  /** Profit EUR. */
  profit_eur?: number;
  /** Payouts USD (owed or paid per toggle). */
  payout_usd?: number;
  /** Payouts EUR. */
  payout_eur?: number;
  /** Net after payouts USD = profit_usd - payout_usd. */
  net_after_payouts_usd?: number;
  net_after_payouts_eur?: number;
  payout_display?: string;
  net_revenue_display?: string;
  total_expenses_display?: string;
  net_profit_display?: string;
  total_marketing_costs_display?: string;
  chatting_costs_team_display?: string;
  marketing_costs_team_display?: string;
  production_costs_team_display?: string;
  ads_spend_display?: string;
}

/** Agency master API response: totals + models array. */
export interface AgencyMasterResponse {
  totals: {
    revenue_usd: number;
    revenue_eur: number;
    expenses_usd: number;
    expenses_eur: number;
    profit_usd: number;
    profit_eur: number;
    margin_pct: number;
    payout_usd: number;
    payout_eur: number;
    net_after_payouts_usd: number;
    net_after_payouts_eur: number;
  };
  models: AgencyRow[];
}

/** Settings map by name */
export interface SettingsMap {
  of_fee_pct: number;
  green_threshold: number;
  yellow_threshold_low: number;
  forecast_months_ahead: number;
}

export type Role = 'admin' | 'finance' | 'viewer';

/** Users table (Airtable): email, role, is_active, password_hash, password_salt, allowed_model_ids, last_login_at, created_at */
export interface UsersRecord {
  email?: string;
  role?: Role;
  is_active?: boolean;
  password_hash?: string;
  password_salt?: string;
  allowed_model_ids?: string;
  last_login_at?: string;
  created_at?: string;
}

export interface SessionUser {
  email: string;
  role: Role;
}

/** Team members table (Airtable): name (primary), role, department, status, notes + payout fields */
export type TeamMemberRole =
  | 'chatter'
  | 'chatting_manager'
  | 'va'
  | 'va_manager'
  | 'marketing_manager'
  | 'editor'
  | 'other';
export type TeamMemberDepartment = 'chatting' | 'marketing' | 'production' | 'ops' | 'affiliate';
export type TeamMemberStatus = 'active' | 'inactive';

export type PayoutType = 'percentage' | 'flat_fee' | 'hybrid' | 'none';
export type PayoutFrequency = 'weekly' | 'monthly';

/** Basis type for monthly_member_basis (manual inputs). Manager/production use agency revenue; only chatters use chatter_sales. Fines stored with negative amounts. */
export type MonthlyBasisType = 'chatter_sales' | 'bonus' | 'adjustment' | 'fine' | 'hourly';

/** Agency identifier for monthly agency revenue (chatting vs gunzo). Used by team_member payout percentages. */
export type AgencyId = 'chatting_agency' | 'gunzo_agency';

/** agency_revenues: one record per month. month (link), chatting_agency/gunzo_agency (number), *_amount_usd/eur, notes. Do not write revenue_type or created_at. */
export interface AgencyRevenuesRecord {
  month?: string[];
  chatting_agency?: number;
  gunzo_agency?: number;
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

/** GET /api/agency-revenue response: ok, requestId, month_id, month_key, exists, recordId?, amounts, chatting_agency?, gunzo_agency?. */
export interface AgencyRevenuesApiResponse {
  ok: boolean;
  requestId: string;
  month_id: string;
  month_key: string;
  exists: boolean;
  recordId?: string;
  chatting_amount_usd: number | null;
  chatting_amount_eur: number | null;
  gunzo_amount_usd: number | null;
  gunzo_amount_eur: number | null;
  chatting_msgs_tips_net_usd: number | null;
  chatting_msgs_tips_net_eur: number | null;
  gunzo_msgs_tips_net_usd: number | null;
  gunzo_msgs_tips_net_eur: number | null;
  chatting_agency?: number | null;
  gunzo_agency?: number | null;
  notes?: string | null;
}

/** monthly_member_basis: one row per month per member per basis type. Airtable fields: month, team_member, department, basis_type, amount, amount_usd, amount_eur, currency, notes. */
export interface MonthlyMemberBasisRecord {
  month?: string[];
  team_member?: string[];
  department?: string;
  basis_type?: MonthlyBasisType;
  amount?: number;
  amount_usd?: number;
  amount_eur?: number;
  currency?: 'eur' | 'usd';
  notes?: string;
  created_at?: string;
}

/** payout_runs: run metadata. Month-bucketed via month link to months. No period_start/period_end. */
export interface PayoutRunRecord {
  month?: string[];
  status?: 'draft' | 'locked' | 'paid';
  locked_at?: string;
  paid_at?: string;
  notes?: string;
}

/** payout_lines: per team_member per run (or model). Dual-amount only (amount_eur, amount_usd). model = linked record for model lines. */
export interface PayoutLineRecord {
  payout_run?: string[];
  team_member?: string[];
  model?: string[];
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
  payout_amount?: number;
  amount?: number;
  amount_eur?: number;
  amount_usd?: number;
  breakdown_json?: string;
  /** Summary fields (compute-and-save). */
  gross_usd?: number;
  base_payout_usd?: number;
  bonus_total_usd?: number;
  fine_total_usd?: number;
  final_payout_usd?: number;
  final_payout_eur?: number;
  fx_rate_usd_eur?: number;
  paid_status?: 'pending' | 'paid';
  paid_at?: string;
}

/** model_assignments: join table (team_member, model). One record per assignment. */
export interface ModelAssignmentRecord {
  team_member?: string[];
  model?: string[];
}

/** Raw Airtable team_members fields (linked records as string[]). member_id = numeric id for legacy payout_lines resolution. */
export interface TeamMemberRecord {
  name?: string;
  /** Numeric member id; used to resolve payout_lines.team_member when stored as number. */
  member_id?: number;
  email?: string;
  role?: TeamMemberRole;
  department?: TeamMemberDepartment;
  status?: TeamMemberStatus;
  notes?: string;
  monthly_cost?: number;
  model?: string[];
  /** Linked models (multi-select). Used for affiliator, chatter, marketing. */
  linked_models?: string[];
  payout_type?: PayoutType;
  payout_percentage?: number;
  payout_flat_fee?: number;
  payout_frequency?: PayoutFrequency;
  models_scope?: string[];
  /** Affiliator: % (optional). */
  affiliator_percentage?: number;
  /** Agency-based payout: % of chatting agency revenue (managers/production). */
  chatting_percentage?: number;
  /** Agency-based payout: % of gunzo agency revenue (managers/production). */
  gunzo_percentage?: number;
  include_webapp_basis?: boolean;
  payout_scope?: 'agency_total_net' | 'messages_tips_net';
}

/** Airtable affiliate_model_deals: deal per affiliator + model. Percentage/basis stored here, not on team_members. Link field is team_member. */
export interface AffiliateModelDealRecord {
  team_member?: string[];
  model?: string[];
  percentage?: number;
  basis?: 'net' | 'gross';
  is_active?: boolean;
  start_month?: string[];
  end_month?: string[];
  notes?: string;
  unique_key?: string;
}

/** API/UI shape for one affiliate deal */
export interface AffiliateModelDeal {
  id: string;
  affiliator_id: string;
  model_id: string;
  percentage: number;
  basis: 'net' | 'gross';
  is_active: boolean;
  start_month_id?: string;
  end_month_id?: string;
  notes?: string;
}

/** API/UI shape: payout as explicit fields + models_scope array */
export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: TeamMemberRole | string;
  department: TeamMemberDepartment | string;
  status: TeamMemberStatus | string;
  notes: string;
  monthly_cost?: number;
  model_id?: string;
  /** Linked models (multi-select). */
  linked_models?: string[];
  /** Model IDs from model_assignments (affiliate only). */
  assigned_model_ids?: string[];
  payout_type: PayoutType;
  payout_percentage?: number;
  payout_flat_fee?: number;
  payout_frequency: PayoutFrequency;
  models_scope: string[];
  affiliator_percentage?: number;
  chatting_percentage?: number;
  gunzo_percentage?: number;
  include_webapp_basis?: boolean;
  payout_scope?: 'agency_total_net' | 'messages_tips_net';
}

/** Expense entries: month (link), amount, amount_usd, amount_eur, category, department, cost_owner_type, model (link optional), team_member (link optional), description, vendor, date, created_by, receipt_url, created_at */
export type ExpenseDepartment = 'models' | 'chatting' | 'marketing' | 'production' | 'ops';
export type CostOwnerType = 'model' | 'team_member' | 'agency';

export interface ExpenseEntryRecord {
  month?: string[];
  amount?: number;
  amount_usd?: number;
  amount_eur?: number;
  category?: string;
  department?: ExpenseDepartment;
  cost_owner_type?: CostOwnerType;
  model?: string[];
  team_member?: string[];
  description?: string;
  vendor?: string;
  date?: string;
  created_by?: string;
  receipt_url?: string;
  created_at?: string;
}

/** UI shape for expense entry */
export interface ExpenseEntry {
  id: string;
  month_id: string;
  amount: number;
  amount_usd?: number;
  amount_eur?: number;
  category: string;
  department: string;
  cost_owner_type: CostOwnerType;
  model_id: string;
  team_member_id: string;
  description: string;
  vendor: string;
  date: string;
  created_by: string;
  receipt_url: string;
  created_at?: string;
}

/** Revenue entries: model (link), month (link), amount, amount_usd, amount_eur, type, description, date, created_by, created_at */
export interface RevenueEntryRecord {
  model?: string[];
  month?: string[];
  type?: string;
  amount?: number;
  amount_usd?: number;
  amount_eur?: number;
  description?: string;
  date?: string;
  created_by?: string;
  created_at?: string;
}

/** UI shape for revenue entry */
export interface RevenueEntry {
  id: string;
  model_id: string;
  month_id: string;
  type: string;
  amount: number;
  amount_usd?: number;
  amount_eur?: number;
  description: string;
  date: string;
  created_by: string;
}

/** Audit log table: timestamp, user_email, table, record_id, field_name, old_value, new_value, model_name */
export interface AuditLogRecord {
  timestamp?: string;
  user_email?: string;
  user?: string; // legacy; prefer user_email
  table?: string;
  record_id?: string;
  field_name?: string;
  old_value?: string;
  new_value?: string;
  model_name?: string;
}

/** Payout run with lines (API shape). */
export interface PayoutRunWithLines {
  run: { id: string; month_id: string; month_key?: string; status: string; notes?: string };
  lines: PayoutLine[];
}

/** Single payout line (API/UI shape). */
export interface PayoutLine {
  id: string;
  team_member_id: string;
  team_member_name: string;
  department: string;
  role: string;
  payout_type: string;
  payout_percentage?: number;
  payout_flat_fee?: number;
  basis_webapp_amount: number;
  basis_manual_amount: number;
  bonus_amount: number;
  adjustments_amount: number;
  basis_total: number;
  payout_amount: number;
  currency: string;
  breakdown_json?: string;
}

/** team_member_payment_methods: one record per method; team_member links to team_members; model optional. */
export interface TeamMemberPaymentMethodRecord {
  team_member?: string[];
  model?: string[];
  method_label?: string;
  payout_method?: string;
  beneficiary_name?: string;
  iban_or_account?: string;
  revtag?: string;
  status?: string;
  notes?: string;
  is_default?: boolean;
  created_at?: string;
}

/** API shape for a single payment method (read-only). Linked fields normalized to arrays of record ids. */
export interface TeamMemberPaymentMethod {
  id: string;
  team_member_id: string;
  /** team_member linked field as array of record ids (first = primary). */
  team_member?: string[];
  /** model linked field as array of record ids, when present. */
  model?: string[];
  method_type?: string;
  label?: string;
  method_label?: string;
  payout_method?: string;
  beneficiary_name?: string;
  iban_or_account?: string;
  revtag?: string;
  status?: string;
  notes?: string;
  is_default?: boolean;
  created_at?: string;
}

/** GET /api/team-members/payment-methods response: map team_member_id -> { default?, methods[] }. */
export interface TeamMemberPaymentMethodsResponse {
  [team_member_id: string]: {
    default: TeamMemberPaymentMethod | null;
    methods: TeamMemberPaymentMethod[];
  };
}
