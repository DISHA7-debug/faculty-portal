import { createHash, randomBytes } from 'node:crypto';

import { AccountStatus, type Role } from '@prisma/client';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { db } from '@/lib/db';
import { safeNextPath } from '@/lib/safe-redirect';

/**
 * Database-backed session layer.
 *
 * The `Session` table is authoritative. Deleting a row ends that session on the very
 * next request — which is what makes admin suspension and "log out everywhere" work,
 * and is why this is not a stateless JWT (CLAUDE.md §8).
 *
 * The cookie carries 32 random bytes. The database stores only SHA-256 of that value,
 * so a database disclosure does not hand an attacker usable session cookies
 * (docs/SECURITY.md §2). The raw token exists in exactly two places: the Set-Cookie
 * header at creation, and the browser.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * `__Host-` is not decoration. It binds the cookie to this exact origin: the browser
 * refuses it unless Secure is set, Path is `/`, and NO Domain attribute is present.
 * That makes it impossible for a subdomain — including one an attacker might obtain
 * on a shared institutional domain — to write a session cookie our server will honour.
 *
 * It requires HTTPS. `http://localhost` counts as a secure context in Chrome, Firefox,
 * and Safari 16.4+, so `npm run dev` works unchanged; there is deliberately no
 * insecure-cookie fallback, because a dev/prod split here is exactly how a Secure flag
 * goes missing in production.
 */
export const SESSION_COOKIE = process.env.NODE_ENV !== 'development' ? '__Host-fp_session' : 'fp_session';

const SESSION_TTL_DAYS = Number(process.env.SESSION_MAX_AGE_DAYS ?? 7);
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * Rolling refresh threshold. The expiry is only extended once the session is more than
 * a day old, so an active user writes to the session table at most once per day rather
 * than on every request.
 */
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

/** Statuses permitted to hold a session at all. */
const SESSION_ELIGIBLE_STATUSES: readonly AccountStatus[] = [
  AccountStatus.ACTIVE,
  // Verified but not yet approved: may sign in and edit a draft profile, may not publish.
  // The publish restriction is enforced by rbac.assertCanPublish, not here.
  AccountStatus.PENDING_APPROVAL,
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Everything an authorization decision needs, resolved in ONE query at session lookup.
 * Sprint 3 (ownership checks on every mutation) and Sprint 4 (department-scoped admin
 * queues) both read these fields on every request; re-querying per check would put an
 * extra round trip in front of every mutation.
 */
export type AppSession = {
  sessionId: string;
  userId: string;
  profileId: string;
  role: Role;
  status: AccountStatus;
  /** The profile's OWN department. User-editable. Never use this for admin scope. */
  departmentId: string;
  /**
   * The department this user administers, for DEPT_ADMIN. Writable only by SUPER_ADMIN.
   * This — never `departmentId` — is what canAdminister() compares against. See rbac.ts.
   */
  administersDepartmentId: string | null;
  expiresAt: Date;
};

/**
 * Thrown when no valid session exists.
 *
 * proxy.ts redirects when the session COOKIE IS ABSENT — it does a presence check only,
 * never a database round trip (see the comment there). A cookie that IS present but no
 * longer names a live session — expired, or revoked out from under the visitor by a
 * sign-out, an admin suspension, or a "log out everywhere" — sails straight past that
 * guard and reaches the page. This error is what a Server Component sees at that point.
 *
 * A page must not let it surface uncaught: `requireSession()` throwing this from inside a
 * page render is an unhandled exception with no boundary set up to catch it, which shows
 * the visitor a raw error screen instead of sending them back to sign in — for a routine,
 * expected condition, not an edge case. Pages call `requireSessionOrRedirect()` instead,
 * precisely to turn this into a real redirect. `requireSession()` itself stays throw-based
 * because Route Handlers (app/api/upload/route.ts) need the exception to translate into a
 * 401 JSON response, where a redirect would be meaningless to a fetch() caller.
 */
export class UnauthenticatedError extends Error {
  readonly status = 401;
  constructor(message = 'Authentication required.') {
    super(message);
    this.name = 'UnauthenticatedError';
  }
}

/** Thrown when a session exists but lacks the required role. */
export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = 'Insufficient permissions.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

/** 32 random bytes, URL-safe. This is the only form the browser ever sees. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 of the raw token. The only form the database ever sees. */
export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export type SessionContext = {
  userAgent?: string | null;
  ipAddress?: string | null;
  /**
   * Override the session lifetime, in milliseconds.
   *
   * Exists for the break-glass path (scripts/break-glass.ts), which mints a deliberately
   * short-lived administrator session during a mail outage. Normal sign-in never passes
   * this and gets the standard 7 days.
   */
  ttlMs?: number;
};

/**
 * Creates a session row and returns the RAW token for the caller to put in a cookie.
 * The raw value is never persisted and is not recoverable afterwards.
 */
export async function createSession(
  userId: string,
  context: SessionContext = {},
): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = generateSessionToken();
  const expiresAt = new Date(Date.now() + (context.ttlMs ?? SESSION_TTL_MS));

  await db.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(rawToken),
      userAgent: context.userAgent?.slice(0, 500) ?? null,
      ipAddress: context.ipAddress ?? null,
      expiresAt,
    },
  });

  return { rawToken, expiresAt };
}

/** Writes the session cookie. Only valid in a Route Handler or Server Action. */
export async function setSessionCookie(
  rawToken: string,
  expiresAt: Date,
): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, rawToken, {
    httpOnly: true, // unreadable from JavaScript, so XSS cannot exfiltrate it
    secure: process.env.NODE_ENV !== 'development', // required by the __Host- prefix
    sameSite: 'lax', // blocks cross-site POST CSRF while keeping normal inbound links working
    path: '/', // required by the __Host- prefix
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV !== 'development',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

/** Ends one session. Idempotent — deleting an already-deleted session is not an error. */
export async function destroySession(rawToken: string): Promise<void> {
  await db.session.deleteMany({ where: { tokenHash: hashSessionToken(rawToken) } });
}

/**
 * Ends EVERY session for a user.
 *
 * Required on password reset and on admin suspension (docs/SECURITY.md §2). This is the
 * operation a stateless JWT cannot express, and the reason this layer exists.
 */
export async function destroyAllSessionsForUser(userId: string): Promise<number> {
  const { count } = await db.session.deleteMany({ where: { userId } });
  return count;
}

/** Housekeeping for expired rows. Safe to run on a schedule. */
export async function purgeExpiredSessions(): Promise<number> {
  const { count } = await db.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Resolves the current session, or null.
 *
 * Status is re-read from the User row on every request rather than trusted from the
 * cookie, so an admin suspending an account takes effect on that account's next request
 * — no waiting for a token to expire.
 */
export async function getOptionalSession(): Promise<AppSession | null> {
  const store = await cookies();
  const rawToken = store.get(SESSION_COOKIE)?.value;
  if (!rawToken) return null;

  const row = await db.session.findUnique({
    where: { tokenHash: hashSessionToken(rawToken) },
    include: { user: { include: { profile: true } } },
  });

  if (!row) return null;

  // Expired: delete rather than merely reject, so the table self-cleans on use.
  if (row.expiresAt.getTime() <= Date.now()) {
    await db.session.delete({ where: { id: row.id } }).catch(() => {});
    return null;
  }

  const { user } = row;

  // Suspended, rejected, or reverted to unverified: revoke every session immediately.
  // Fail closed — an unrecognised future status lands here too.
  if (!SESSION_ELIGIBLE_STATUSES.includes(user.status)) {
    await destroyAllSessionsForUser(user.id);
    return null;
  }

  // Invariant: every account-creation path creates a Profile in the same transaction.
  // If that is ever violated the session is refused rather than papered over with a
  // partial object, because departmentId and profileId gate authorization downstream.
  if (!user.profile) {
    console.error(
      `[auth] User ${user.id} has no Profile; refusing session. ` +
        `Every signup path must create a Profile atomically.`,
    );
    return null;
  }

  await maybeExtendSession(row.id, row.expiresAt);

  return {
    sessionId: row.id,
    userId: user.id,
    profileId: user.profile.id,
    role: user.role,
    status: user.status,
    departmentId: user.profile.departmentId,
    administersDepartmentId: user.administersDepartmentId,
    expiresAt: row.expiresAt,
  };
}

/**
 * Rolling refresh: extends expiry for an actively used session.
 *
 * Only the database row is extended here. The cookie is re-issued by write-capable
 * contexts (Route Handlers / Server Actions) via refreshSessionCookie(), because a
 * Server Component is not permitted to set cookies and calling cookies().set() from one
 * throws.
 */
async function maybeExtendSession(
  sessionId: string,
  expiresAt: Date,
): Promise<void> {
  const issuedAgo = Date.now() - expiresAt.getTime() + SESSION_TTL_MS;
  if (issuedAgo < REFRESH_AFTER_MS) return;

  await db.session
    .update({
      where: { id: sessionId },
      data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    })
    .catch(() => {
      // A concurrent logout may have deleted the row. Not worth failing the request.
    });
}

/**
 * Re-issues the cookie so the browser's copy tracks the extended database expiry.
 * Call only from a Route Handler or Server Action.
 */
export async function refreshSessionCookie(): Promise<void> {
  const store = await cookies();
  const rawToken = store.get(SESSION_COOKIE)?.value;
  if (!rawToken) return;

  const row = await db.session.findUnique({
    where: { tokenHash: hashSessionToken(rawToken) },
    select: { expiresAt: true },
  });
  if (!row) return;

  await setSessionCookie(rawToken, row.expiresAt);
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * The authenticated-session guard.
 *
 * Throws rather than redirecting so it stays usable from Route Handlers, Server Actions,
 * and Server Components alike. Page routes are guarded earlier by proxy.ts, so a throw
 * here is a backstop that should never fire in normal operation — which is precisely why
 * it must exist (docs/SECURITY.md §1.1: hiding the button is not authorization).
 */
export async function requireSession(): Promise<AppSession> {
  const session = await getOptionalSession();
  if (!session) throw new UnauthenticatedError();
  return session;
}

/**
 * The page-rendering counterpart to `requireSession()`: redirects to `/login` instead of
 * throwing. See the note on `UnauthenticatedError` for why both forms exist.
 *
 * `currentPath` is round-tripped as `?next=` so sign-in returns the visitor where they were
 * headed, exactly like proxy.ts's own redirect for a missing cookie — passed through
 * `safeNextPath` for the same reason proxy.ts does: the value is validated identically at
 * every point it is produced or consumed, not just the one call site presumed careful.
 * Callers pass the page's own known-static route rather than this trying to sniff the
 * current URL out of `headers()`, which Server Components have no first-class access to.
 */
export async function requireSessionOrRedirect(currentPath?: string): Promise<AppSession> {
  const session = await getOptionalSession();
  if (session) return session;
  redirect(currentPath ? `/login?next=${encodeURIComponent(safeNextPath(currentPath))}` : '/login');
}

/**
 * Role guard. Accepts a session so it composes with requireSession() without a second
 * database round trip.
 */
export function requireRole(
  session: AppSession,
  allowed: readonly Role[],
): AppSession {
  if (!allowed.includes(session.role)) {
    throw new ForbiddenError(
      `Requires one of: ${allowed.join(', ')}. Session holds: ${session.role}.`,
    );
  }
  return session;
}

/** Convenience: authenticate and authorize in one call. */
export async function requireSessionWithRole(
  allowed: readonly Role[],
): Promise<AppSession> {
  return requireRole(await requireSession(), allowed);
}
