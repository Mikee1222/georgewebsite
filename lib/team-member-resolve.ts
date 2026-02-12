/**
 * Resolve payout_lines.team_member (linked or legacy numeric) to a display name and stable row key.
 * Used by agency master so lines without a model show the team member name instead of "Unassigned".
 */

export interface TeamMemberLookup {
  byId: Map<string, { name: string; member_id?: number }>;
  byMemberId: Map<number, { id: string; name: string }>;
}

/** Build lookup maps from team_members records (id, name, member_id). */
export function buildTeamMemberLookup(
  records: Array<{ id: string; fields: { name?: string; member_id?: number } }>
): TeamMemberLookup {
  const byId = new Map<string, { name: string; member_id?: number }>();
  const byMemberId = new Map<number, { id: string; name: string }>();
  for (const r of records) {
    const name = (r.fields.name ?? '').trim() || '(no name)';
    const memberId = r.fields.member_id;
    byId.set(r.id, { name, member_id: memberId });
    if (typeof memberId === 'number' && Number.isFinite(memberId)) {
      byMemberId.set(memberId, { id: r.id, name });
    }
  }
  return { byId, byMemberId };
}

/** Payout line shape: team_member can be linked record id(s) or legacy numeric. */
export interface PayoutLineTeamMemberLike {
  fields: { team_member?: (string | number)[] };
}

/**
 * Resolve team member display name and a stable row key for agency aggregation.
 * - If team_member is a linked record id (rec...) -> use that record's name.
 * - Else if team_member is numeric (or string number) -> lookup team_members by member_id, use that name.
 * - Else -> "Unassigned" or "unassigned (id: <raw>)" and rowKey _unassigned or _unassigned_<raw>.
 */
export function resolveTeamMemberName(
  line: PayoutLineTeamMemberLike,
  lookup: TeamMemberLookup
): { displayName: string; rowKey: string } {
  const raw = line.fields.team_member;
  const first = Array.isArray(raw) && raw.length > 0 ? raw[0] : undefined;
  if (first === undefined || first === null || first === '') {
    return { displayName: 'Unassigned', rowKey: '_unassigned' };
  }
  const str = String(first).trim();
  if (str.startsWith('rec')) {
    const found = lookup.byId.get(str);
    if (found) return { displayName: found.name, rowKey: str };
    if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
      console.log('[team-member-resolve] linked id not found in team_members', { team_member: str });
    }
    return { displayName: `unassigned (id: ${str})`, rowKey: `_unassigned_${str}` };
  }
  const num = typeof first === 'number' ? first : parseInt(str, 10);
  if (Number.isFinite(num)) {
    const found = lookup.byMemberId.get(num);
    if (found) return { displayName: found.name, rowKey: `_tm_${found.id}` };
    if (process.env.NODE_ENV === 'development' && typeof console !== 'undefined') {
      console.log('[team-member-resolve] member_id not matched in team_members', { member_id: num });
    }
    return { displayName: `unassigned (id: ${num})`, rowKey: `_unassigned_${num}` };
  }
  return { displayName: `unassigned (id: ${str})`, rowKey: `_unassigned_${str}` };
}

/** Build map member_id (number) -> team_members record id for autofix. */
export function getMemberIdToRecordIdMap(lookup: TeamMemberLookup): Map<number, string> {
  const m = new Map<number, string>();
  for (const [num, v] of lookup.byMemberId) m.set(num, v.id);
  return m;
}

/**
 * Resolve numeric team_member_id to a team_members record id for autofix on save-computed.
 * Returns the record id if found, otherwise null (caller keeps original).
 */
export function resolveNumericTeamMemberToRecordId(
  teamMemberId: string,
  memberIdToRecordId: Map<number, string>
): string | null {
  if (!teamMemberId || teamMemberId.startsWith('rec') || teamMemberId.startsWith('model-')) return null;
  const num = parseInt(teamMemberId, 10);
  if (!Number.isFinite(num)) return null;
  return memberIdToRecordId.get(num) ?? null;
}
