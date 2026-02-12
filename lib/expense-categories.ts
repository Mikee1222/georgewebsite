/**
 * Shared expense category config. Raw values match Airtable single-select options.
 * Use these when creating expense_entries to avoid INVALID_MULTIPLE_CHOICE.
 */

/** Chatting department (non–per-member) expense categories: value stored in Airtable, label for UI. */
export const CHATTING_DEPARTMENT_CATEGORIES = [
  { value: 'crm_cost', label: 'CRM Cost' },
  { value: 'bot_cost', label: 'Bot Cost' },
] as const;

export type ChattingDepartmentCategory = (typeof CHATTING_DEPARTMENT_CATEGORIES)[number]['value'];

/** Marketing/production (expense_entries only; not pnl_lines). Source of truth: category. Department set from form when creating. */
export const MARKETING_PRODUCTION_CATEGORIES = [
  { value: 'marketing_tools', label: 'Marketing tools' },
  { value: 'marketing_other', label: 'Marketing other' },
  { value: 'production_tools', label: 'Production tools' },
  { value: 'production_other', label: 'Production other' },
] as const;

export const MARKETING_PRODUCTION_CATEGORY_VALUES = MARKETING_PRODUCTION_CATEGORIES.map((c) => c.value);
export type MarketingProductionCategory = (typeof MARKETING_PRODUCTION_CATEGORIES)[number]['value'];

export function marketingProductionCategoryLabel(category: string): string {
  const found = MARKETING_PRODUCTION_CATEGORIES.find((c) => c.value === category);
  return found ? found.label : category;
}

export function departmentFromMarketingCategory(category: string): 'marketing' | 'production' {
  const c = (category ?? '').toLowerCase();
  return c.startsWith('production') ? 'production' : 'marketing';
}
