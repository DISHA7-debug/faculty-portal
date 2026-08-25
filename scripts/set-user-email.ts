/**
 * Repoints an existing account at a different email address.
 *
 *   npm run set-user-email -- <current-email> <new-email>
 *
 * ── What this is for ────────────────────────────────────────────────────────────────────
 *
 * The seed deliberately creates accounts on an RFC 2606 `.invalid` domain, which can never
 * resolve and can never receive mail — so a seed run pointed at a real SMTP relay cannot
 * email a stranger. That safety property is worth keeping. When you need ONE account to
 * receive a real message (testing live delivery, demonstrating the portal), move that one
 * account rather than reseeding the whole database against live domains.
 *
 * ── Why this is a script and not an admin screen ────────────────────────────────────────
 *
 * Changing the address on an account is changing WHO CAN SIGN IN AS IT — there is no
 * password, so the mailbox is the entire credential. In the product that must be a verified
 * flow: prove control of the new address before the old one stops working, which is what
 * the email-change token in the schema is for. This script skips all of that, so it lives
 * on the server behind shell access, like scripts/break-glass.ts, and writes an AuditLog
 * row on every use.
 *
 * It refuses to run against anything but a local database, for the same reason.
 */
import { createInterface } from 'node:readline/promises';

import { PrismaClient } from '@prisma/client';

import { isAllowedEmailDomain } from '@/lib/validation/auth';

const db = new PrismaClient();

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(2);
}

async function main() {
  const [current, next] = process.argv.slice(2);

  if (!current || !next) {
    fail('Usage: npm run set-user-email -- <current-email> <new-email>');
  }

  const url = process.env.DATABASE_URL ?? '';
  if (!/@(localhost|127\.0\.0\.1|postgres)[:/]/.test(url)) {
    fail('Refusing to run: DATABASE_URL is not a local database.');
  }

  const from = current.trim().toLowerCase();
  const to = next.trim().toLowerCase();

  const user = await db.user.findUnique({
    where: { email: from },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      profile: { select: { fullName: true, slug: true, isPublished: true } },
    },
  });
  if (!user) fail(`No account with the address ${from}.`);

  const clash = await db.user.findUnique({ where: { email: to }, select: { id: true } });
  if (clash) fail(`${to} is already in use by another account.`);

  // Warn but do not block. Moving an account to an address outside ALLOWED_EMAIL_DOMAINS
  // is occasionally what you want (a departing member of staff), but it means they can no
  // longer request a sign-in code, because the login path checks the domain too. Saying so
  // out loud beats discovering it at the login screen.
  const allowed = isAllowedEmailDomain(to);

  console.log('\n  Account');
  console.log(`    name    ${user.profile?.fullName ?? '(no profile)'}`);
  console.log(`    slug    ${user.profile?.slug ?? '—'}`);
  console.log(`    role    ${user.role}   status  ${user.status}`);
  console.log(`\n    ${from}`);
  console.log(`      -> ${to}${allowed ? '' : '   ⚠ OUTSIDE ALLOWED_EMAIL_DOMAINS — this account will not be able to sign in'}`);

  // The login address doubles as the public contact email on a PUBLISHED profile
  // (lib/public-profile.ts: `contact.email: user.email`, by design — CLAUDE.md §7,
  // profile-aside.tsx). That is correct for a real institutional address. It is very much
  // NOT correct for a throwaway or personal address used to test mail delivery — that
  // exact mistake shipped a personal test address onto a live public profile once already.
  // Fail closed here: a published profile needs a SECOND confirmation, spelled out, so
  // repointing one is never the accidental side effect of testing something else.
  if (user.profile?.isPublished) {
    console.log(
      `\n  ⚠ ${user.profile.fullName ?? from}'s profile is PUBLISHED. The address you set here\n` +
        '    will appear on their public page as the contact email — not just the login.',
    );
    const rlPublished = createInterface({ input: process.stdin, output: process.stdout });
    const confirmPublished = (
      await rlPublished.question('  Type PUBLISH to confirm this should be publicly visible: ')
    ).trim();
    rlPublished.close();
    if (confirmPublished !== 'PUBLISH') {
      fail('Did not match. Nothing was changed.');
    }
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('\n  Type the new address again to confirm: ')).trim().toLowerCase();
  rl.close();

  if (answer !== to) fail('Did not match. Nothing was changed.');

  // Audit BEFORE the change and in the same transaction, so a crash mid-way cannot leave
  // an unrecorded credential move. Same ordering rule as scripts/break-glass.ts.
  await db.$transaction([
    db.auditLog.create({
      data: {
        userId: user.id,
        action: 'user.email.change.cli',
        entity: 'User',
        entityId: user.id,
        metadata: { from, to, via: 'scripts/set-user-email.ts', allowedDomain: allowed },
      },
    }),
    db.user.update({ where: { id: user.id }, data: { email: to } }),
    // Every live session was authenticated against the OLD address. Dropping them forces
    // the next sign-in to prove control of the new mailbox, which is the one property this
    // script would otherwise throw away.
    db.session.deleteMany({ where: { userId: user.id } }),
  ]);

  console.log(`\n  Done. ${to} can now request a sign-in code.`);
  console.log('  All existing sessions for this account were revoked.\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
