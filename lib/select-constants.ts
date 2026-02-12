/**
 * Radix Select.Item value must NEVER be "" (causes runtime error).
 * Use these constants for "All" / "None" options; map to undefined/empty when building API queries.
 */
export const SELECT_ALL = 'all';
export const SELECT_NONE = '__none__';
export const UNSET = 'unset';

export function isAll(value: string): boolean {
  return value === SELECT_ALL;
}

export function isNone(value: string): boolean {
  return value === SELECT_NONE;
}

/** For query params: all/unset -> undefined (omit filter), __none__ -> '' or undefined as needed */
export function selectValueForQuery(value: string | null | undefined): string | undefined {
  if (value == null || value === SELECT_ALL || value === UNSET || value === '') return undefined;
  if (value === SELECT_NONE) return '';
  return value;
}

/** Ensure Select value is never undefined: use for controlled Select. Returns a valid string. */
export function normalizeSelectValue(
  value: string | null | undefined,
  fallback: string = SELECT_ALL
): string {
  if (value != null && typeof value === 'string') return value;
  return fallback;
}
