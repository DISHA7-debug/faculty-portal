import { Prisma, Role } from '@prisma/client';

import type { AppSession } from '@/lib/auth/session';

/**
 * Department scoping for the admin panel's LIST queries.
 *
 * `assertOwnsProfileRow` and `canAdminister` (lib/auth/rbac.ts) answer "may this session
 * act on THIS ONE row" — the check belongs on the mutation. The admin panel's list screens
 * need the same scope applied to a WHERE clause before any row is even fetched: a
 * DEPT_ADMIN's `/admin/approvals` and `/admin/faculty` queries must never touch a row
 * outside their department in the first place, so that a foreign-department account is
 * absent from the list the same way a nonexistent one would be — not present-but-hidden by
 * a UI check.
 *
 * ── Why role, not just department, is part of the scope ─────────────────────────────────
 *
 * A DEPT_ADMIN is also a faculty member with their own profile, and profiles are not
 * unique to FACULTY-role accounts — the seed data gives the SUPER_ADMIN account's own
 * profile a departmentId too (`admin@…`'s profile sits in CSE). Scoping by department
 * alone would let a CSE department admin suspend or reactivate the super-admin account
 * itself, purely because their profiles happen to share a department — a real escalation
 * path, not a hypothetical one, and the same class of bug CLAUDE.md §3.2 already warns
 * about for `administersDepartmentId`. A DEPT_ADMIN's queries are therefore additionally
 * restricted to `role: FACULTY`: they administer the faculty in their department, never
 * another admin, whatever department that admin's own profile happens to list.
 */

export type AdminScope =
  | { kind: 'GLOBAL' }
  | { kind: 'DEPARTMENT'; departmentId: string }
  /** A DEPT_ADMIN with no assigned department. Every scoped query must return nothing. */
  | { kind: 'NONE' };

export function adminScope(session: AppSession): AdminScope {
  if (session.role === Role.SUPER_ADMIN) return { kind: 'GLOBAL' };

  if (session.role === Role.DEPT_ADMIN) {
    return session.administersDepartmentId
      ? { kind: 'DEPARTMENT', departmentId: session.administersDepartmentId }
      : { kind: 'NONE' };
  }

  return { kind: 'NONE' };
}

/**
 * The `where` fragment for a `db.user.findMany` / `findUnique` scoped to this admin's
 * authority, or `null` if the scope is `NONE` — callers must check for `null` and skip the
 * query entirely rather than pass it through, the same "fail closed, do not guess" rule
 * `canAdminister` follows for a DEPT_ADMIN with no assigned department.
 */
export function scopedUserWhere(session: AppSession): Prisma.UserWhereInput | null {
  const scope = adminScope(session);

  switch (scope.kind) {
    case 'GLOBAL':
      return {};
    case 'DEPARTMENT':
      return { role: Role.FACULTY, profile: { is: { departmentId: scope.departmentId } } };
    case 'NONE':
      return null;
  }
}
