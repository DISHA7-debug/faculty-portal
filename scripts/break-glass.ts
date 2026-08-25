#!/usr/bin/env node
/**
 * BREAK GLASS — mint an administrator session without email.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────────
 *
 * Authentication is by emailed one-time code. That means email is on the critical path
 * for EVERY sign-in, and a mail outage is a total authentication outage: nobody can get
 * in, including the administrator who would diagnose the mail problem, and including
 * anyone who could approve pending accounts. The system deadlocks while appearing healthy
 * — the site serves, the database is fine, and no one can log in.
 *
 * This script is the way out. It is the direct and deliberate cost of choosing codes over
 * passwords (PROJECT_PLAN §7).
 *
 * ── Why it is not a backdoor ────────────────────────────────────────────────────
 *
 * It requires a shell on the production host. Anyone who has that already has the
 * database, the .env file, AUTH_SECRET, and the ability to run arbitrary SQL — including
 * simply inserting a Session row by hand, which is all this does. It therefore adds no
 * attack surface beyond what SSH access already implies.
 *
 * What it DOES add is an audit trail and a short expiry, which hand-written SQL would not
 * have.
 *
 * ── Do not remove this ──────────────────────────────────────────────────────────
 *
 * Deleting it during a security review does not close a hole; it reintroduces a
 * total-lockout deadlock with no recovery path short of editing the database directly
 * during an incident, at speed, under pressure. See docs/SECURITY.md §2.5.
 *
 * Usage, on the server:
 *   docker compose -f docker-compose.prod.yml exec app \
 *     node --import tsx scripts/break-glass.ts admin@<domain>
 */
import { AccountStatus, Role } from '@prisma/client';

import { SESSION_COOKIE, createSession } from '@/lib/auth/session';
import { db } from '@/lib/db';

/**
 * 30 minutes, not the usual 7 days.
 *
 * Long enough to diagnose a mail problem, short enough that a token pasted into a chat
 * window or left in shell history stops working before the incident is over.
 */
const BREAK_GLASS_TTL_MS = 30 * 60 * 1000;

function fail(message: string): never {
  console.error(`\n  BREAK GLASS REFUSED\n  ${message}\n`);
  process.exit(1);
}

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();

  if (!email) {
    fail('Usage: node --import tsx scripts/break-glass.ts <super-admin-email>');
  }

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true, role: true, status: true },
  });

  // Every refusal below is loud and specific. This runs on a console, by an operator who
  // already has host access — there is nothing to withhold, and a vague error during an
  // outage is actively harmful.
  if (!user) fail(`No account exists for ${email}.`);

  if (user.role !== Role.SUPER_ADMIN) {
    fail(
      `${email} has role ${user.role}, not SUPER_ADMIN.\n` +
        '  Break glass is restricted to SUPER_ADMIN so a compromised department admin\n' +
        '  account cannot be escalated by anyone who reaches this script.',
    );
  }

  if (user.status !== AccountStatus.ACTIVE) {
    fail(
      `${email} has status ${user.status}, not ACTIVE.\n` +
        '  A suspended or rejected account must not be revivable by this route — that\n' +
        '  would make suspension meaningless for exactly the most privileged accounts.',
    );
  }

  const session = await createSession(user.id, {
    userAgent: 'break-glass-cli',
    ipAddress: null,
    ttlMs: BREAK_GLASS_TTL_MS,
  });

  // AUDIT BEFORE PRINTING.
  //
  // Written unconditionally and before the token reaches the operator's terminal, so a
  // use cannot be hidden by killing the process at the right moment. If this write fails,
  // the whole command fails and no token is disclosed — an unaudited break-glass use is
  // worse than a failed one.
  await db.auditLog.create({
    data: {
      userId: user.id,
      action: 'auth.break_glass',
      entity: 'Session',
      entityId: null,
      ipAddress: null,
      metadata: {
        email: user.email,
        reason: 'CLI break-glass session minted — email delivery presumed unavailable',
        ttlMinutes: BREAK_GLASS_TTL_MS / 60_000,
        expiresAt: session.expiresAt.toISOString(),
        invokedAt: new Date().toISOString(),
        // Deliberately NOT the raw token, and not its hash either: the audit row must
        // record that a session was minted, never provide a means of using it.
      },
    },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://<your-domain>';
  const host = (() => {
    try {
      return new URL(appUrl).host;
    } catch {
      return '<your-domain>';
    }
  })();

  console.log(`
  ────────────────────────────────────────────────────────────────────────
  BREAK-GLASS SESSION MINTED
  ────────────────────────────────────────────────────────────────────────

  Account   ${user.email}  (${user.role})
  Expires   ${session.expiresAt.toISOString()}  (${BREAK_GLASS_TTL_MS / 60_000} minutes)
  Audited   auth.break_glass written before this was printed

  ── Set the cookie ──────────────────────────────────────────────────────

  1. Open ${appUrl} in a browser.
  2. Open developer tools → Console.
  3. The cookie is httpOnly, so it CANNOT be set from the console. Use the
     Application/Storage → Cookies panel instead, and add:

        Name      ${SESSION_COOKIE}
        Value     ${session.rawToken}
        Domain    ${host}
        Path      /
        Secure    true
        HttpOnly  true
        SameSite  Lax

  4. Reload. You are signed in as ${user.email}.

  ── Or, with curl ───────────────────────────────────────────────────────

     curl -b '${SESSION_COOKIE}=${session.rawToken}' ${appUrl}/api/health

  ── Afterwards ──────────────────────────────────────────────────────────

  This session expires on its own. To end it sooner, delete the row:

     DELETE FROM "Session" WHERE "userId" = '${user.id}';

  That also signs out every other session for this account, which is the
  right move if you suspect the token was exposed.
  ────────────────────────────────────────────────────────────────────────
`);
}

main()
  .catch((error) => {
    console.error('\n  BREAK GLASS FAILED\n', error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
