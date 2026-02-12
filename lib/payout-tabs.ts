/**
 * Tab categories for payouts UI (Chatters | Managers | VAs | Models).
 * Client-safe: no server/airtable deps. Used to filter preview and saved lines by tab.
 */

export type PayoutCategory = 'chatter' | 'manager' | 'va' | 'model' | 'affiliate';

export type PayoutTabId = 'chatters' | 'managers' | 'vas' | 'models' | 'affiliates';

const ROLE_TO_CATEGORY: Record<string, PayoutCategory> = {
  chatter: 'chatter',
  chatting_manager: 'manager',
  va_manager: 'manager',
  marketing_manager: 'manager',
  editor: 'manager',
  va: 'va',
  production: 'manager',
  model: 'model',
  affiliator: 'affiliate',
  other: 'model',
};
const DEFAULT_CATEGORY: PayoutCategory = 'model';

/** Derive tab category from role/department. Use for preview lines and saved run lines. */
export function getPayoutCategory(role: string, department: string): PayoutCategory {
  const r = (role ?? '').toLowerCase().trim();
  const d = (department ?? '').toLowerCase().trim();
  if (r === 'chatter') return 'chatter';
  if (r === 'va') return 'va';
  if (r === 'affiliator' || d === 'affiliate') return 'affiliate';
  if (ROLE_TO_CATEGORY[r]) return ROLE_TO_CATEGORY[r];
  if (d === 'production') return 'manager';
  return DEFAULT_CATEGORY;
}

export const PAYOUT_TAB_IDS: PayoutTabId[] = ['chatters', 'managers', 'vas', 'models', 'affiliates'];

export function categoryForTab(tab: PayoutTabId): PayoutCategory {
  return tab === 'chatters' ? 'chatter' : tab === 'managers' ? 'manager' : tab === 'vas' ? 'va' : tab === 'affiliates' ? 'affiliate' : 'model';
}
