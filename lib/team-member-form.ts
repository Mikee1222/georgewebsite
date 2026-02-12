/**
 * Frontend-only: role → department and compensation config for Add/Edit Team Member form.
 * No Airtable schema changes; used for dynamic form UI and validation.
 */

export const ROLES = [
  'affiliator',
  'chatter',
  'chatting_manager',
  'marketing',
  'marketing_manager',
  'production',
  'va',
  'va_manager',
  'editor',
  'other',
] as const;

export type RoleValue = (typeof ROLES)[number];

export const DEPARTMENTS = ['chatting', 'marketing', 'production', 'ops', 'affiliate'] as const;

export type DepartmentValue = (typeof DEPARTMENTS)[number];

/** Role → department (auto-derived, disabled in form). */
const ROLE_TO_DEPARTMENT_MAP: Record<string, DepartmentValue> = {
  affiliator: 'affiliate',
  chatter: 'chatting',
  chatting_manager: 'chatting',
  marketing: 'marketing',
  marketing_manager: 'marketing',
  production: 'production',
  va: 'ops',
  va_manager: 'ops',
  editor: 'production',
  other: 'ops',
};

export type CompensationKind = 'percentage' | 'flat_fee' | 'hybrid';

export interface RoleCompensationConfig {
  kind: CompensationKind;
  percentage: boolean;
  flat_fee: boolean;
  models_scope: boolean;
}

/** Which compensation fields to show per role. Affiliator: no payout type. */
const ROLE_COMPENSATION_MAP: Record<string, RoleCompensationConfig> = {
  affiliator: { kind: 'percentage', percentage: false, flat_fee: false, models_scope: true },
  chatter: { kind: 'percentage', percentage: true, flat_fee: false, models_scope: false },
  chatting_manager: { kind: 'percentage', percentage: true, flat_fee: false, models_scope: true },
  marketing: { kind: 'percentage', percentage: true, flat_fee: false, models_scope: false },
  marketing_manager: { kind: 'percentage', percentage: true, flat_fee: false, models_scope: false },
  production: { kind: 'hybrid', percentage: true, flat_fee: true, models_scope: false },
  va: { kind: 'flat_fee', percentage: false, flat_fee: true, models_scope: false },
  va_manager: { kind: 'flat_fee', percentage: false, flat_fee: true, models_scope: false },
  editor: { kind: 'hybrid', percentage: true, flat_fee: true, models_scope: false },
  other: { kind: 'flat_fee', percentage: false, flat_fee: false, models_scope: false },
};

export function getDepartmentForRole(role: string): DepartmentValue {
  return ROLE_TO_DEPARTMENT_MAP[role] ?? 'ops';
}

export function getCompensationConfigForRole(role: string): RoleCompensationConfig {
  return ROLE_COMPENSATION_MAP[role] ?? ROLE_COMPENSATION_MAP.other;
}

export function roleHasCompensationSection(role: string): boolean {
  const c = getCompensationConfigForRole(role);
  return c.percentage || c.flat_fee;
}

/** Show "Linked models (optional)" when: affiliator, chatter, or va/manager/editor/other with department === marketing. */
export function showLinkedModels(role: string, department: string): boolean {
  if (role === 'affiliator' || role === 'chatter') return true;
  if (department === 'marketing') {
    return ['va', 'va_manager', 'chatting_manager', 'marketing_manager', 'editor', 'other'].includes(role);
  }
  return false;
}

/** Show "Affiliator percentage (%)" only when role === affiliator. */
export function showAffiliatorPercentage(role: string): boolean {
  return role === 'affiliator';
}

/** Show "Affiliate" section (affiliator_percentage + assigned models) when department === affiliate OR role === affiliator. */
export function showAffiliateSection(role: string, department: string): boolean {
  return department === 'affiliate' || role === 'affiliator';
}
