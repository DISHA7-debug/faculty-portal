import { notFound } from 'next/navigation';

import { db } from '@/lib/db';
import type { AppSession } from '@/lib/auth/session';
import { canAdminister, isSuperAdmin } from '@/lib/auth/rbac';

/**
 * The ownership check that every mutation on a profile-owned row must call.
 *
 * This is the single most exploitable bug class in this application: `DELETE
 * /api/publications/abc123` that only checks "is logged in" lets any faculty member
 * delete any other's records by editing the URL (CLAUDE.md §3.1, docs/SECURITY.md §1.1).
 *
 * Always 404, never 403. A 403 confirms the row exists and turns the ID space into an
 * enumeration oracle; a 404 is indistinguishable from "never existed".
 */

/** Anything owned by a profile. Every repeatable section row satisfies this. */
export type ProfileOwnedRow = { profileId: string };

export type OwnershipOptions = {
  /**
   * Optional override for the owning profile's department.
   *
   * Omit it and the helper loads the department itself from `row.profileId`. That is the
   * default because this check is called from roughly forty Sprint 3 mutation sites, and
   * a design that depends on every one of them sourcing this correctly will eventually
   * meet one that does not.
   *
   * MUST come from a trusted database read of the row's OWNER. Never pass a value taken
   * from the request — a department id from a form field or query string would let the
   * caller nominate the scope its own authorization is checked against, converting a
   * department admin into an institution-wide one.
   */
  ownerDepartmentId?: string;

  /**
   * Test seam: replaces the database lookup. Production code should not pass this.
   */
  loadOwnerDepartmentId?: (profileId: string) => Promise<string | null>;
};

/** Default department resolver: authoritative, straight from the owning Profile row. */
async function loadDepartmentFromDb(profileId: string): Promise<string | null> {
  const profile = await db.profile.findUnique({
    where: { id: profileId },
    select: { departmentId: true },
  });
  return profile?.departmentId ?? null;
}

/**
 * Asserts the session may act on this row, or raises 404.
 *
 * DELIBERATE DIVERGENCE from the snippet in CLAUDE.md §3.1, which reads:
 *
 *     if (isAdmin(session)) return row;   // admins bypass, but see 3.2
 *
 * That bypass is unsafe as written. `isAdmin` is true for DEPT_ADMIN, so a department
 * admin would pass this check for ANY row in the institution — including profiles in
 * departments they do not administer — which silently contradicts §3.2 one section
 * later. The comment acknowledges the gap without closing it.
 *
 * Here, only SUPER_ADMIN bypasses unconditionally. A DEPT_ADMIN must supply the owning
 * profile's department, and is then checked against `administersDepartmentId`.
 */
export async function assertOwnsProfileRow<T extends ProfileOwnedRow>(
  row: T | null | undefined,
  session: AppSession,
  options: OwnershipOptions = {},
): Promise<T> {
  // Missing row and foreign row are indistinguishable to the caller, by design.
  if (!row) notFound();

  // Global scope. The only unconditional bypass.
  if (isSuperAdmin(session)) return row;

  // The owner, acting on their own row: the overwhelmingly common case.
  if (row.profileId === session.profileId) return row;

  // Department admin acting on someone else's row within their department.
  if (session.role === 'DEPT_ADMIN') {
    // Resolve the owning profile's department here rather than trusting the caller to
    // supply it. The override exists for callers that already hold a trusted value.
    const ownerDepartmentId =
      options.ownerDepartmentId ??
      (await (options.loadOwnerDepartmentId ?? loadDepartmentFromDb)(row.profileId));

    // Fail closed: an unresolvable department (deleted profile, dangling reference)
    // must deny rather than fall through to a broader branch.
    if (!ownerDepartmentId) notFound();

    if (canAdminister(session, { departmentId: ownerDepartmentId })) return row;
    notFound();
  }

  // FACULTY, and any future role, acting on a row they do not own.
  notFound();
}

/**
 * Non-throwing variant, for deciding whether to render a control.
 *
 * Rendering is not authorization: a UI that hides a button must still be backed by
 * assertOwnsProfileRow on the mutation itself (CLAUDE.md §3.1).
 */
export async function ownsProfileRow<T extends ProfileOwnedRow>(
  row: T | null | undefined,
  session: AppSession,
  options: OwnershipOptions = {},
): Promise<boolean> {
  if (!row) return false;
  if (isSuperAdmin(session)) return true;
  if (row.profileId === session.profileId) return true;

  if (session.role === 'DEPT_ADMIN') {
    const ownerDepartmentId =
      options.ownerDepartmentId ??
      (await (options.loadOwnerDepartmentId ?? loadDepartmentFromDb)(row.profileId));
    if (!ownerDepartmentId) return false;
    return canAdminister(session, { departmentId: ownerDepartmentId });
  }

  return false;
}

/**
 * Ownership check for a Profile row itself, which carries `id` rather than `profileId`.
 * Adapts the shape so profile-level mutations use the same code path as section rows.
 */
export async function assertOwnsProfile<
  T extends { id: string; departmentId: string },
>(profile: T | null | undefined, session: AppSession): Promise<T> {
  if (!profile) notFound();

  await assertOwnsProfileRow({ profileId: profile.id }, session, {
    ownerDepartmentId: profile.departmentId,
  });

  return profile;
}
