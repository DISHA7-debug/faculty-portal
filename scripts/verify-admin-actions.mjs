#!/usr/bin/env node
/**
 * Exercises the admin panel's actual mutations through a real browser — approve, reject,
 * suspend, reactivate, role-change, the self-action guards, and the cross-department scope
 * — not just page loads. Everything it creates is disposable and deleted at the end;
 * `pending.cse@`/`pending.mech@` and the other named seed fixtures (documented in
 * docs/WALKTHROUGH.md as the admin-approval demo accounts) are never touched.
 */
import { createHash, randomBytes } from 'node:crypto';

import { AccountStatus, PrismaClient, Role } from '@prisma/client';
import { chromium } from 'playwright';

const db = new PrismaClient();
const BASE = 'http://localhost:3000';
const MAILPIT = 'http://localhost:8025';

let failures = 0;
function check(label, actual, ok, expected) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(60)} ${String(actual).padEnd(24)} ${expected ?? ''}`);
}

async function mailpitClear() {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' }).catch(() => {});
}
async function mailpitLatestTo(address) {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`);
  const json = await res.json();
  return json.messages?.[0] ?? null;
}

async function sessionFor(userId) {
  const raw = randomBytes(32).toString('base64url');
  await db.session.create({
    data: { userId, tokenHash: createHash('sha256').update(raw).digest('hex'), expiresAt: new Date(Date.now() + 3600e3) },
  });
  return raw;
}

/* ── disposable fixtures ─────────────────────────────────────────────────────────────── */

const cse = await db.department.findFirstOrThrow({ where: { code: 'CSE' } });
const me = await db.department.findFirstOrThrow({ where: { code: 'ME' } });
const stamp = Date.now();

async function makeUser({ email, fullName, departmentId, status, role = Role.FACULTY }) {
  return db.user.create({
    data: {
      email,
      role,
      status,
      emailVerifiedAt: new Date(),
      profile: {
        create: { fullName, slug: `verify-admin-${stamp}-${Math.random().toString(36).slice(2, 8)}`, departmentId, researchInterests: [] },
      },
    },
  });
}

const pendingCse = await makeUser({
  email: `verify.admin.pending.cse.${stamp}@faculty.example.invalid`,
  fullName: 'Verify PendingCSE',
  departmentId: cse.id,
  status: AccountStatus.PENDING_APPROVAL,
});
const pendingMe = await makeUser({
  email: `verify.admin.pending.me.${stamp}@faculty.example.invalid`,
  fullName: 'Verify PendingME',
  departmentId: me.id,
  status: AccountStatus.PENDING_APPROVAL,
});
const rejectTarget = await makeUser({
  email: `verify.admin.reject.${stamp}@faculty.example.invalid`,
  fullName: 'Verify RejectMe',
  departmentId: cse.id,
  status: AccountStatus.PENDING_APPROVAL,
});
const activeCse = await makeUser({
  email: `verify.admin.active.${stamp}@faculty.example.invalid`,
  fullName: 'Verify ActiveCSE',
  departmentId: cse.id,
  status: AccountStatus.ACTIVE,
});

const deptAdmin = await db.user.findUniqueOrThrow({ where: { email: 'suresh.menon@faculty.example.invalid' } });
const superAdmin = await db.user.findUniqueOrThrow({ where: { email: 'admin@faculty.example.invalid' } });

const cleanupIds = [pendingCse.id, pendingMe.id, rejectTarget.id, activeCse.id];

const browser = await chromium.launch();
async function withCookie(raw, fn) {
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: '__Host-fp_session', value: raw, domain: 'localhost', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
  const page = await ctx.newPage();
  try {
    await fn(page);
  } finally {
    await ctx.close();
  }
}

try {
  /* ── DEPT_ADMIN (CSE) approves a CSE pending account ──────────────────────────────── */
  console.log('\n══ approve (DEPT_ADMIN, own department) ══\n');
  {
    await mailpitClear();
    const raw = await sessionFor(deptAdmin.id);
    await withCookie(raw, async (page) => {
      await page.goto(`${BASE}/admin/approvals`, { waitUntil: 'domcontentloaded' });

      const row = page.locator('li').filter({ hasText: pendingCse.email });
      check('pending CSE account is listed', await row.count(), (await row.count()) === 1, '1');

      // The cross-department account must NOT be visible to a CSE admin at all.
      const foreignRow = page.locator('li').filter({ hasText: pendingMe.email });
      check('pending ME account is NOT listed to CSE admin', await foreignRow.count(), (await foreignRow.count()) === 0, '0');

      await row.getByRole('button', { name: 'Approve' }).click();
      await page.waitForTimeout(800);
      // Wait for the exit animation to actually finish rather than a fixed sleep racing it.
      await page.locator('li').filter({ hasText: pendingCse.email }).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      const stillThere = await page.locator('li').filter({ hasText: pendingCse.email }).count();
      check('row disappears from the list after approval', stillThere, stillThere === 0, '0');
    });

    const after = await db.user.findUniqueOrThrow({ where: { id: pendingCse.id } });
    check('status is ACTIVE in the database', after.status, after.status === AccountStatus.ACTIVE, 'ACTIVE');

    const log = await db.auditLog.findFirst({
      where: { action: 'user.approve', entityId: pendingCse.id },
      orderBy: { createdAt: 'desc' },
    });
    check('AuditLog row written', Boolean(log), Boolean(log));
    check('AuditLog actor is the approving admin', log?.userId, log?.userId === deptAdmin.id, deptAdmin.id);

    const mail = await mailpitLatestTo(pendingCse.email);
    check('approval email sent', Boolean(mail), Boolean(mail));
  }

  /* ── DEPT_ADMIN rejects, with a reason, and the applicant is emailed it ─────────────── */
  console.log('\n══ reject (DEPT_ADMIN, own department) ══\n');
  {
    await mailpitClear();
    const raw = await sessionFor(deptAdmin.id);
    const REASON = 'Could not confirm an active appointment in this department for the term given.';
    await withCookie(raw, async (page) => {
      await page.goto(`${BASE}/admin/approvals`, { waitUntil: 'domcontentloaded' });
      const row = page.locator('li').filter({ hasText: rejectTarget.email });
      await row.getByRole('button', { name: 'Reject' }).click();
      await page.getByLabel('Reason for rejection').fill(REASON);
      await page.getByRole('button', { name: 'Reject and notify' }).click();
      await page.waitForTimeout(800);
    });

    const after = await db.user.findUniqueOrThrow({ where: { id: rejectTarget.id } });
    check('status is REJECTED', after.status, after.status === AccountStatus.REJECTED, 'REJECTED');

    const log = await db.auditLog.findFirst({ where: { action: 'user.reject', entityId: rejectTarget.id } });
    check('AuditLog metadata carries the reason', log?.metadata?.reason, log?.metadata?.reason === REASON);

    const mail = await mailpitLatestTo(rejectTarget.email);
    check('rejection email sent', Boolean(mail), Boolean(mail));
  }

  /* ── The reason field enforces its own minimum — cannot submit a 3-word blow-off ────── */
  console.log('\n══ reject reason is actually required, not just present in the form ══\n');
  {
    const raw = await sessionFor(deptAdmin.id);
    // Fresh disposable target so this doesn't collide with the row already rejected above.
    const shortReasonTarget = await makeUser({
      email: `verify.admin.shortreason.${stamp}@faculty.example.invalid`,
      fullName: 'Verify ShortReason',
      departmentId: cse.id,
      status: AccountStatus.PENDING_APPROVAL,
    });
    cleanupIds.push(shortReasonTarget.id);

    await withCookie(raw, async (page) => {
      await page.goto(`${BASE}/admin/approvals`, { waitUntil: 'domcontentloaded' });
      const row = page.locator('li').filter({ hasText: shortReasonTarget.email });
      await row.getByRole('button', { name: 'Reject' }).click();
      await page.getByLabel('Reason for rejection').fill('too short');
      const submitBtn = page.getByRole('button', { name: 'Reject and notify' });
      check('submit is disabled under the minimum length', await submitBtn.isDisabled(), await submitBtn.isDisabled());
    });

    const stillPending = await db.user.findUniqueOrThrow({ where: { id: shortReasonTarget.id } });
    check('nothing changed server-side', stillPending.status, stillPending.status === AccountStatus.PENDING_APPROVAL, 'PENDING_APPROVAL');
  }

  /* ── Suspend / reactivate, and the immediate session kill ───────────────────────────── */
  console.log('\n══ suspend destroys sessions immediately; reactivate restores access ══\n');
  {
    const targetSessionRaw = await sessionFor(activeCse.id); // the TARGET's own live session
    const adminRaw = await sessionFor(deptAdmin.id);

    const beforeCount = await db.session.count({ where: { userId: activeCse.id } });
    check('target has a live session before suspension', beforeCount, beforeCount > 0);

    await withCookie(adminRaw, async (page) => {
      page.on('dialog', (d) => d.accept()); // the confirm() before suspend
      await page.goto(`${BASE}/admin/faculty?q=${encodeURIComponent(activeCse.email)}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Suspend' }).click();
      await page.waitForTimeout(800);
      const badge = await page.locator('tr', { hasText: activeCse.email }).innerText();
      check('badge flips to Suspended in the UI', badge.includes('Suspended'), badge.includes('Suspended'));
    });

    const afterSuspend = await db.user.findUniqueOrThrow({ where: { id: activeCse.id } });
    check('status is SUSPENDED', afterSuspend.status, afterSuspend.status === AccountStatus.SUSPENDED, 'SUSPENDED');

    const sessionsAfter = await db.session.count({ where: { userId: activeCse.id } });
    check('every session for the target was destroyed', sessionsAfter, sessionsAfter === 0, '0');

    // The target's OWN (now-dead) cookie must be rejected by the app, not just absent
    // from the database in isolation.
    await withCookie(targetSessionRaw, async (page) => {
      const res = await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
      const finalPath = new URL(page.url()).pathname;
      check('suspended user is bounced to /login on next request', finalPath, finalPath === '/login', '/login');
      void res;
    });

    await withCookie(adminRaw, async (page) => {
      await page.goto(`${BASE}/admin/faculty?q=${encodeURIComponent(activeCse.email)}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Reactivate' }).click();
      await page.waitForTimeout(800);
    });

    const afterReactivate = await db.user.findUniqueOrThrow({ where: { id: activeCse.id } });
    check('status is ACTIVE again', afterReactivate.status, afterReactivate.status === AccountStatus.ACTIVE, 'ACTIVE');
  }

  /* ── Self-guards ──────────────────────────────────────────────────────────────────── */
  console.log('\n══ self-action guards ══\n');
  {
    // A DEPT_ADMIN's own row can never appear in THEIR OWN faculty list in the first
    // place — scopedUserWhere restricts a DEPT_ADMIN's queries to role: FACULTY
    // (docs/SECURITY.md §1.5), and Suresh Menon is DEPT_ADMIN, not FACULTY. That is a
    // stronger property than "the button is disabled": there is no row to click at all.
    // The server-side self-suspend guard in suspendAction() is verified as defense in
    // depth (it would matter if that scoping ever changed), not exercised through the UI
    // here, because the UI cannot reach it.
    const adminRaw = await sessionFor(deptAdmin.id);
    await withCookie(adminRaw, async (page) => {
      await page.goto(`${BASE}/admin/faculty?q=${encodeURIComponent('suresh.menon')}`, { waitUntil: 'domcontentloaded' });
      const rowCount = await page.locator('tr', { hasText: 'suresh.menon@faculty.example.invalid' }).count();
      check('DEPT_ADMIN does not appear in their own scoped faculty list', rowCount, rowCount === 0, '0');
      const emptyState = await page.getByText('No accounts match these filters.').count();
      check('search for their own name shows the empty state', emptyState, emptyState === 1, '1');
    });
    const stillActive = await db.user.findUniqueOrThrow({ where: { id: deptAdmin.id } });
    check('DEPT_ADMIN account itself is untouched', stillActive.status, stillActive.status === AccountStatus.ACTIVE, 'ACTIVE');
  }

  /* ── Role change: SUPER_ADMIN only ───────────────────────────────────────────────── */
  console.log('\n══ role change is SUPER_ADMIN-only ══\n');
  {
    const superRaw = await sessionFor(superAdmin.id);
    await withCookie(superRaw, async (page) => {
      await page.goto(`${BASE}/admin/faculty?q=${encodeURIComponent('verify.admin.active')}`, { waitUntil: 'domcontentloaded' });
      const selectLoc = page.locator('select[aria-label^="Role for"]').first();
      const has = await selectLoc.count();
      check('SUPER_ADMIN sees a role selector', has, has > 0);
      if (has > 0) {
        // A fixed settle window before interacting, not just domcontentloaded: this
        // <select> only does anything once React has hydrated and attached its onChange
        // listener, and selectOption()+dispatchEvent('change') fired before that point
        // lands on a native element with nobody listening yet — confirmed by tracing
        // network requests, where the exact same interaction sequence produced a POST
        // reliably once given time to hydrate first, and produced none without it. A real
        // visitor's click always arrives well after hydration; this exists only to make a
        // scripted interaction wait for the same thing a human's reaction time gives it
        // for free.
        await page.waitForTimeout(500);
        await selectLoc.selectOption('DEPT_ADMIN');
        await selectLoc.dispatchEvent('change');
        await page.waitForTimeout(800);
      }
    });

    const afterRoleChange = await db.user.findUniqueOrThrow({ where: { id: activeCse.id } });
    check('role actually changed to DEPT_ADMIN', afterRoleChange.role, afterRoleChange.role === Role.DEPT_ADMIN, 'DEPT_ADMIN');

    const log = await db.auditLog.findFirst({ where: { action: 'user.role_change', entityId: activeCse.id } });
    check('AuditLog role_change row written', Boolean(log), Boolean(log));

    // Change it back so cleanup deletes a plain FACULTY row like it expects.
    await db.user.update({ where: { id: activeCse.id }, data: { role: Role.FACULTY } });
  }

  /* ── SUPER_ADMIN cannot change their own role ────────────────────────────────────── */
  console.log('\n══ SUPER_ADMIN cannot demote themself ══\n');
  {
    const superRaw = await sessionFor(superAdmin.id);
    await withCookie(superRaw, async (page) => {
      await page.goto(`${BASE}/admin/faculty?q=${encodeURIComponent('admin@faculty')}`, { waitUntil: 'domcontentloaded' });
      const selfRow = page.locator('tr', { hasText: 'admin@faculty.example.invalid' });
      const select = selfRow.locator('select[aria-label^="Role for"]');
      const disabled = await select.isDisabled().catch(() => null);
      check('own role selector is disabled', disabled, disabled === true, 'true');
    });
    const stillSuper = await db.user.findUniqueOrThrow({ where: { id: superAdmin.id } });
    check('SUPER_ADMIN account itself is untouched', stillSuper.role, stillSuper.role === Role.SUPER_ADMIN, 'SUPER_ADMIN');
  }
} finally {
  await browser.close();
  await db.session.deleteMany({ where: { userId: { in: [...cleanupIds, deptAdmin.id, superAdmin.id] } } });
  await db.profile.deleteMany({ where: { userId: { in: cleanupIds } } });
  await db.auditLog.deleteMany({ where: { entityId: { in: cleanupIds } } });
  await db.user.deleteMany({ where: { id: { in: cleanupIds } } });
  await db.$disconnect();
  console.log(`\nDisposable fixtures cleaned up (${cleanupIds.length} accounts).`);
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
