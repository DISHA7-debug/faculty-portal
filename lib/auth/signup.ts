import { AccountStatus, Role } from '@prisma/client';

import { requestLoginCode } from '@/lib/auth/config';
import { db } from '@/lib/db';
import {
  RULES,
  emailKey,
  enforce,
  ipKey,
  mailRequestDelayMs,
  sleep,
  softThrottle,
} from '@/lib/rate-limit';
import { isAllowedEmailDomain, signupSchema } from '@/lib/validation/auth';

/**
 * Signup.
 *
 * The security-critical path (docs/PROJECT_PLAN.md §5.1). Three properties matter more
 * than anything else here, and each is easy to lose in a refactor:
 *
 *  1. The response is IDENTICAL whether or not the email is already registered. Signup on
 *     a published faculty directory is otherwise a membership oracle: submit an address,
 *     read the error, learn whether that person has an account. See §2.2.
 *     With codes this is easier to hold than it was with passwords: BOTH paths end by
 *     sending a code to the address and showing the same code-entry screen, so the two
 *     cases are genuinely identical rather than merely made to look alike.
 *  2. Status starts at PENDING_VERIFICATION and NOTHING here can set it higher. Approval
 *     is an administrator action, and students hold college addresses too (§2.1).
 *  3. User and Profile are created in ONE transaction. A User without a Profile cannot
 *     hold a session (see session.ts), so a partial write would produce an account that
 *     can never sign in and cannot be recovered by retrying — the email is taken.
 */

export type SignupResult =
  | { ok: true }
  | { ok: false; reason: 'RATE_LIMITED'; retryAfterSeconds: number }
  | { ok: false; reason: 'INVALID_INPUT'; fieldErrors: Record<string, string[]> }
  | { ok: false; reason: 'DOMAIN_NOT_ALLOWED' }
  | { ok: false; reason: 'DEPARTMENT_NOT_FOUND' }
  | { ok: false; reason: 'SLUG_CONFLICT' };

/**
 * Derives a unique URL slug from a display name.
 *
 * Policy in docs/PROJECT_PLAN.md §4.3.1: lowercase, transliterate, strip non-alphanumeric,
 * hyphenate, append -2, -3 on collision. Editable until first publish, immutable after.
 */
export async function deriveUniqueSlug(fullName: string): Promise<string> {
  return (await deriveSlugCandidates(fullName))[0];
}

/**
 * Produces an ordered list of slug candidates.
 *
 * More than one because uniqueness cannot be reserved ahead of the insert: between the
 * availability check and the INSERT, another signup can take the same slug. The caller
 * walks this list on collision instead of failing the signup.
 */
export async function deriveSlugCandidates(
  fullName: string,
  count = 3,
): Promise<string[]> {
  const base =
    fullName
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '') // strip combining accents
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'faculty';

  // Reserved words must never shadow a route segment (§4.3.1).
  const RESERVED = new Set([
    'admin', 'api', 'dashboard', 'faculty', 'departments', 'login', 'signup',
    'verify', 'reset-password', 'logout', 'search', 'about', 'settings', '_next',
  ]);

  const root = RESERVED.has(base) ? `${base}-profile` : base;

  const taken = new Set(
    (
      await db.profile.findMany({
        where: { slug: { startsWith: root } },
        select: { slug: true },
      })
    ).map((p) => p.slug),
  );

  const candidates: string[] = [];
  for (let suffix = 1; candidates.length < count && suffix < 200; suffix++) {
    const candidate = suffix === 1 ? root : `${root}-${suffix}`;
    if (!taken.has(candidate)) candidates.push(candidate);
  }

  // Last-resort candidate that cannot collide, so the retry loop always terminates.
  candidates.push(`${root}-${Date.now().toString(36)}`);
  return candidates;
}

export async function signup(
  input: unknown,
  ip: string,
): Promise<SignupResult> {
  // 1. Throttle by IP before any work. Signup is unauthenticated and creates rows.
  const limit = await enforce(ipKey('signup', ip), RULES.signupPerIp, 'closed');
  if (!limit.allowed) {
    return { ok: false, reason: 'RATE_LIMITED', retryAfterSeconds: limit.retryAfterSeconds };
  }

  // 2. Validate. `.strict()` rejects unknown keys, so `role` or `status` cannot ride along.
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'INVALID_INPUT',
      fieldErrors: z_flatten(parsed.error),
    };
  }
  const { fullName, email, departmentId } = parsed.data;

  // 3. Domain gate. Necessary, never sufficient — the approval gate is what stops a
  //    student publishing a professor page.
  if (!isAllowedEmailDomain(email)) {
    return { ok: false, reason: 'DOMAIN_NOT_ALLOWED' };
  }

  // 4. Per-email pressure is a DELAY, never a block.
  //
  //    A hard per-email limit here would let an attacker exhaust a real faculty member's
  //    verification-mail budget and stall their onboarding — the same shape of own-goal
  //    as the old per-email login lockout, aimed at an address the public directory hands
  //    out. The hard cap stays on the IP, which the attacker actually owns.
  const emailPressure = await softThrottle(
    emailKey('signup', email),
    RULES.verificationResendPerEmail.windowSeconds,
    mailRequestDelayMs,
  );

  const department = await db.department.findUnique({
    where: { id: departmentId },
    select: { id: true },
  });
  if (!department) return { ok: false, reason: 'DEPARTMENT_NOT_FOUND' };

  // 5. TIMING EQUALISATION — do the expensive work BEFORE branching on existence.
  //
  //    Slug derivation costs a query. Doing it only on the new-account path would make
  //    response time an oracle for whether an address is registered.
  //
  //    The argon2 hashing that used to dominate this equalisation is gone with passwords,
  //    which removes both the cost and the largest source of timing variance — but the
  //    ordering still matters and is kept.
  const slugCandidates = await deriveSlugCandidates(fullName);

  await sleep(emailPressure.delayMs);

  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true, status: true },
  });

  if (existing) {
    // Do NOT report that the address is taken. Send a code to the address that already
    // owns the account — the only party entitled to know it exists. From the browser this
    // is indistinguishable from a fresh signup, and for the legitimate owner it is simply
    // a sign-in.
    await requestLoginCode(email, ip);
    return { ok: true };
  }

  return createAccount({ email, fullName, departmentId, slugCandidates, ip });
}

/**
 * Creates the user + profile, retrying on slug collision.
 *
 * Slug and email are separate unique constraints and must be handled separately:
 *
 *   - email collision  -> another signup for the same address won the race. Report
 *                         success, exactly as the existence branch above does.
 *   - slug collision   -> two DIFFERENT people with the same display name signed up at
 *                         once. Treating this as success would tell a real faculty member
 *                         their account was created when it was not, with no account and
 *                         no email to explain it. Retry with the next candidate, then
 *                         fail loudly.
 */
async function createAccount(args: {
  email: string;
  fullName: string;
  departmentId: string;
  slugCandidates: string[];
  ip: string;
}): Promise<SignupResult> {
  const { email, fullName, departmentId, slugCandidates, ip } = args;

  for (const [attempt, slug] of slugCandidates.entries()) {
    try {
      await db.user.create({
        data: {
          email,
          role: Role.FACULTY, // never from input
          status: AccountStatus.PENDING_VERIFICATION, // never from input
          profile: {
            create: { fullName, slug, departmentId, researchInterests: [] },
          },
        },
        select: { id: true },
      });

      // Sends the first code. That code doubles as email verification, which is what
      // collapses signup and sign-in into one flow.
      await requestLoginCode(email, ip);
      return { ok: true };
    } catch (error) {
      const conflict = uniqueConflictTarget(error);

      if (conflict === 'email') {
        // Lost a race for the address. Indistinguishable response, as above.
        return { ok: true };
      }

      if (conflict === 'slug') {
        // Two different people, same name, same instant. Try the next candidate.
        console.warn(
          `[signup] slug collision on attempt ${attempt + 1} for "${fullName}" ` +
            `(slug "${slug}") — retrying with the next candidate.`,
        );
        continue;
      }

      throw error;
    }
  }

  // Every candidate collided. Fail loudly rather than silently reporting success —
  // a user told "check your email" who has no account never recovers on their own.
  console.error(
    `[signup] exhausted all slug candidates for "${fullName}"; account NOT created.`,
  );
  return { ok: false, reason: 'SLUG_CONFLICT' };
}

/**
 * Identifies WHICH unique constraint a Prisma P2002 refers to.
 *
 * Treating every P2002 the same is how a slug collision gets reported as a successful
 * signup. `meta.target` names the columns; it can be an array or a string depending on
 * the connector, so both shapes are handled.
 */
function uniqueConflictTarget(error: unknown): 'email' | 'slug' | 'other' | null {
  const e = error as { code?: string; meta?: { target?: unknown } };
  if (e?.code !== 'P2002') return null;

  const raw = e.meta?.target;
  const fields = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === 'string'
      ? [raw]
      : [];
  const joined = fields.join(',').toLowerCase();

  if (joined.includes('email')) return 'email';
  if (joined.includes('slug')) return 'slug';
  return 'other';
}

/** Field errors without importing Zod's internals into the return type. */
function z_flatten(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '_');
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
