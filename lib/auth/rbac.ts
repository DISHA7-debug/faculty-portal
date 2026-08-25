import { AccountStatus, Role } from '@prisma/client';
import { notFound } from 'next/navigation';

import { ForbiddenError, type AppSession } from '@/lib/auth/session';

/**
 * Named role sets for route guards.
 *
 * Hand-rolled arrays at call sites are how an admin gets locked out of the dashboard:
 * someone writes `requireRole(session, [Role.FACULTY])` on `/dashboard`, forgetting that
 * DEPT_ADMIN and SUPER_ADMIN are faculty members too and must reach their own profile
 * editor. `requireRole` has no implicit hierarchy by design, so the sets have to be
 * spelled out somewhere — once, here.
 */
export const ROLES = {
  /** Anyone signed in. Use for /dashboard — admins have profiles to maintain too. */
  ANY_AUTHENTICATED: [Role.FACULTY, Role.DEPT_ADMIN, Role.SUPER_ADMIN],
  /** Either admin tier. Use for /admin. Department scoping is still enforced per row. */
  ADMIN: [Role.DEPT_ADMIN, Role.SUPER_ADMIN],
  /** Global-only actions: department CRUD, role changes, audit log. */
  SUPER_ADMIN_ONLY: [Role.SUPER_ADMIN],
} as const satisfies Record<string, readonly Role[]>;

/**
 * Role and capability decisions.
 *
 * Pure functions over a session. No database access, so every check is cheap enough to
 * call on any code path and trivial to test exhaustively.
 */

// ---------------------------------------------------------------------------
// Role predicates
// ---------------------------------------------------------------------------

export function isSuperAdmin(session: AppSession): boolean {
  return session.role === Role.SUPER_ADMIN;
}

export function isDeptAdmin(session: AppSession): boolean {
  return session.role === Role.DEPT_ADMIN;
}

/** Either admin tier. Deliberately NOT sufficient on its own to act on a row — see canAdminister. */
export function isAdmin(session: AppSession): boolean {
  return isSuperAdmin(session) || isDeptAdmin(session);
}

// ---------------------------------------------------------------------------
// Department scope
// ---------------------------------------------------------------------------

/**
 * May this session administer a profile in this department?
 *
 * Compares against `session.administersDepartmentId`, which lives on `User` and is
 * writable only by SUPER_ADMIN — NEVER against `session.departmentId`, which is the
 * admin's own profile department and is editable by the admin themself.
 *
 * A DEPT_ADMIN is also a faculty member with their own profile. If scope were derived
 * from that editable field, an admin could grant themself authority over any department
 * by editing their own profile's department — a one-field privilege escalation.
 * See docs/SECURITY.md §1.3 and CLAUDE.md §3.2.
 */
export function canAdminister(
  session: AppSession,
  profile: { departmentId: string | null },
): boolean {
  if (isSuperAdmin(session)) return true;
  if (!isDeptAdmin(session)) return false;

  // A DEPT_ADMIN with no assigned department administers nothing. Fail closed:
  // null === null must never read as a match.
  if (!session.administersDepartmentId) return false;
  if (!profile.departmentId) return false;

  return profile.departmentId === session.administersDepartmentId;
}

/** Throwing form, for use at the top of an admin action. */
export function assertCanAdminister(
  session: AppSession,
  profile: { departmentId: string | null },
): AppSession {
  if (!canAdminister(session, profile)) {
    throw new ForbiddenError(
      'This profile is outside the department you administer.',
    );
  }
  return session;
}

// ---------------------------------------------------------------------------
// Publish capability
// ---------------------------------------------------------------------------

/**
 * A session that has been proven publish-capable.
 *
 * The brand exists so the type system carries the check. A publish helper takes
 * `PublishCapableSession`, so passing a plain `AppSession` is a compile error rather
 * than a silently missing runtime guard — the requirement that publish rejection lives
 * in the primitives and not in every caller.
 */
export type PublishCapableSession = AppSession & {
  readonly __publishChecked: unique symbol;
};

/**
 * Only ACTIVE accounts may publish.
 *
 * PENDING_APPROVAL users can sign in and build a complete draft profile — that is the
 * intended onboarding experience — but nothing they own becomes publicly visible until
 * an admin approves them.
 *
 * This gate is why the approval step cannot be skipped: students hold college email
 * addresses too, so domain matching alone would let a student publish a fake professor
 * page on the college domain (docs/SECURITY.md §2.1, CLAUDE.md §8).
 */
export function canPublish(session: AppSession): boolean {
  return session.status === AccountStatus.ACTIVE;
}

/**
 * Publish guard. Returns a branded session so downstream publish code can require proof
 * that this ran.
 */
export function assertCanPublish(session: AppSession): PublishCapableSession {
  if (!canPublish(session)) {
    throw new ForbiddenError(
      session.status === AccountStatus.PENDING_APPROVAL
        ? 'Your account is awaiting administrator approval. You can keep editing your ' +
          'profile, but it cannot be published yet.'
        : `An account with status ${session.status} cannot publish.`,
    );
  }
  return session as PublishCapableSession;
}

/**
 * Publish/unpublish a specific profile — own profile, or an admin acting on another's.
 *
 * Ownership is decided by profile IDENTITY, never by department equality. Sharing a
 * department with someone is not a relationship that grants any authority over their
 * profile; every faculty member in CSE shares CSE with every other.
 */
export function assertCanPublishProfile(
  session: AppSession,
  profile: { id: string; departmentId: string | null },
): PublishCapableSession {
  // The acting account must itself be approved, whoever the target is.
  //
  // This one stays a ForbiddenError rather than a 404: the user demonstrably owns or
  // administers the profile, and the reason for refusal is their own account status.
  // Telling them "you are awaiting approval" leaks nothing and is the only way they can
  // understand why the button did not work.
  const publishable = assertCanPublish(session);

  // Own profile.
  if (profile.id === session.profileId) return publishable;

  // Someone else's: requires admin authority scoped to that profile's department.
  //
  // Denial here is a 404, not a 403, matching every other cross-profile check in this
  // codebase (docs/SECURITY.md §1.2). A 403 would confirm that a profile with this id
  // exists in a department the caller cannot see.
  if (!canAdminister(session, profile)) notFound();

  return publishable;
}

// ---------------------------------------------------------------------------
// Account state
// ---------------------------------------------------------------------------

/** Awaiting an admin decision: full dashboard access, nothing public. */
export function isAwaitingApproval(session: AppSession): boolean {
  return session.status === AccountStatus.PENDING_APPROVAL;
}

/** May edit their own profile. Both eligible statuses may; publishing is separate. */
export function canEditOwnProfile(session: AppSession): boolean {
  return (
    session.status === AccountStatus.ACTIVE ||
    session.status === AccountStatus.PENDING_APPROVAL
  );
}
