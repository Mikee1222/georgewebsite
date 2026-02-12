/**
 * Edge-safe auth: session cookie signed with HMAC.
 * Roles and allowed_model_ids come from Airtable users table (no env-based role lists).
 */

import type { Role } from './types';

const COOKIE_NAME = 'agency_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be at least 32 chars');
  return s;
}

/** Sign payload with HMAC-SHA256 (edge-safe). */
async function sign(payload: string): Promise<string> {
  const secret = getSecret();
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/** Verify signature. */
async function verify(payload: string, signature: string): Promise<boolean> {
  const expected = await sign(payload);
  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export interface SessionPayload {
  email: string;
  role: Role;
  allowed_model_ids: string[];
  exp: number;
}

export async function createSession(
  email: string,
  role: Role,
  allowed_model_ids: string[]
): Promise<string> {
  const payload: SessionPayload = {
    email: email.trim().toLowerCase(),
    role,
    allowed_model_ids: Array.isArray(allowed_model_ids) ? allowed_model_ids : [],
    exp: Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE,
  };
  const payloadStr = JSON.stringify(payload);
  const sig = await sign(payloadStr);
  const bytes = new TextEncoder().encode(payloadStr);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64}.${sig}`;
}

export async function parseSession(cookieHeader: string | null): Promise<SessionPayload | null> {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  const value = match?.[1];
  if (!value) return null;
  const [b64, sig] = value.split('.');
  if (!b64 || !sig) return null;
  let payloadStr: string;
  try {
    const base64 = b64.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    payloadStr = new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
  const ok = await verify(payloadStr, sig);
  if (!ok) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(payloadStr) as SessionPayload;
  } catch {
    return null;
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (!payload.allowed_model_ids) payload.allowed_model_ids = [];
  return payload;
}

export function sessionCookieValue(value: string): string {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** Use in API route handlers to get session from request. */
export async function getSessionFromRequest(cookieHeader: string | null): Promise<SessionPayload | null> {
  return parseSession(cookieHeader);
}

/** Check if user can edit (admin or finance). */
export function canEdit(role: Role): boolean {
  return role === 'admin' || role === 'finance';
}

/** Finance: can edit only models in allowed_model_ids. Admin: all. Empty allowed_model_ids = all models. */
export function financeCanEditModel(
  role: Role,
  modelId: string,
  allowed_model_ids: string[] | undefined
): boolean {
  if (role === 'admin') return true;
  if (role !== 'finance') return false;
  const ids = Array.isArray(allowed_model_ids) ? allowed_model_ids : [];
  if (ids.length === 0) return true;
  return ids.includes(modelId);
}

/** Admin only for team_members write. */
export function canManageTeamMembers(role: Role): boolean {
  return role === 'admin';
}

/** Admin only for users table create/update/deactivate. */
export function canManageUsers(role: Role): boolean {
  return role === 'admin';
}

/** Admin only for models table create/update. Finance read-only. */
export function canManageModels(role: Role): boolean {
  return role === 'admin';
}

/** Can write expense: admin always; finance for agency/team_member always; finance for model only if model in allowed_model_ids (or empty allowed = all). */
export function canWriteExpense(
  role: Role,
  cost_owner_type: 'model' | 'team_member' | 'agency',
  modelId: string | undefined,
  allowed_model_ids: string[] | undefined
): boolean {
  if (role === 'admin') return true;
  if (role !== 'finance') return false;
  if (cost_owner_type === 'agency' || cost_owner_type === 'team_member') return true;
  return financeCanEditModel(role, modelId ?? '', allowed_model_ids);
}

/** Can write revenue: admin always; finance if model in allowed_model_ids or empty allowed. */
export function canWriteRevenue(
  role: Role,
  modelId: string,
  allowed_model_ids: string[] | undefined
): boolean {
  return canEdit(role) && (role === 'admin' || financeCanEditModel(role, modelId, allowed_model_ids));
}
