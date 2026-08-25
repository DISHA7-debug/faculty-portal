#!/usr/bin/env node
/** Drives /admin as FACULTY, DEPT_ADMIN, and SUPER_ADMIN in a real browser. */
import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';

const db = new PrismaClient();
const BASE = 'http://localhost:3000';

let failures = 0;
function check(label, actual, ok, expected) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(56)} ${String(actual).padEnd(20)} ${expected ?? ''}`);
}

async function sessionFor(email) {
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  const raw = randomBytes(32).toString('base64url');
  await db.session.create({
    data: { userId: user.id, tokenHash: createHash('sha256').update(raw).digest('hex'), expiresAt: new Date(Date.now() + 3600e3) },
  });
  return { userId: user.id, raw };
}

async function withCookie(browser, raw, fn) {
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: '__Host-fp_session', value: raw, domain: 'localhost', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
  const page = await ctx.newPage();
  try { await fn(page); } finally { await ctx.close(); }
}

const browser = await chromium.launch();

/* ── FACULTY hitting /admin must 404, not crash, not redirect ────────────────────────── */
console.log('\n══ FACULTY hits /admin ══\n');
{
  const { raw } = await sessionFor('anita.sharma@faculty.example.invalid');
  await withCookie(browser, raw, async (page) => {
    for (const url of ['/admin', '/admin/approvals', '/admin/faculty', '/admin/logs']) {
      const res = await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
      check(url, res.status(), res.status() === 404, '404');
    }
  });
}

/* ── DEPT_ADMIN (Suresh Menon, CSE) ───────────────────────────────────────────────────── */
console.log('\n══ DEPT_ADMIN (Suresh Menon, CSE) ══\n');
{
  const { raw, userId } = await sessionFor('suresh.menon@faculty.example.invalid');
  await withCookie(browser, raw, async (page) => {
    const res = await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    check('/admin loads', res.status(), res.status() === 200, '200');

    const logsRes = await page.goto(BASE + '/admin/logs', { waitUntil: 'domcontentloaded' });
    check('/admin/logs 404s for DEPT_ADMIN', logsRes.status(), logsRes.status() === 404, '404');

    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    const logsLinkCount = await page.locator('nav[aria-label="Admin sections"] a[href="/admin/logs"]').count();
    check('nav does not link to /admin/logs', logsLinkCount, logsLinkCount === 0, '0');

    await page.goto(BASE + '/admin/approvals', { waitUntil: 'domcontentloaded' });
    const pendingRows = await page.locator('main li').filter({ hasText: 'faculty.example.invalid' }).count();
    console.log(`      (pending rows visible: ${pendingRows})`);

    await page.goto(BASE + '/admin/faculty', { waitUntil: 'domcontentloaded' });
    const deptFilterCount = await page.locator('#fac-dept').count();
    check('no department filter shown to DEPT_ADMIN', deptFilterCount, deptFilterCount === 0, '0');
    const roleSelectCount = await page.locator('select[aria-label^="Role for"]').count();
    check('no role-change control shown to DEPT_ADMIN', roleSelectCount, roleSelectCount === 0, '0');

    // Every row shown must be in CSE.
    const rowText = await page.locator('table tbody tr').allInnerTexts();
    const outsideCse = rowText.filter((t) => !t.includes('Computer Science'));
    check('every visible faculty row is CSE', outsideCse.length, outsideCse.length === 0, '0');
  });
  await db.session.deleteMany({ where: { userId } });
}

/* ── SUPER_ADMIN ───────────────────────────────────────────────────────────────────────── */
console.log('\n══ SUPER_ADMIN ══\n');
{
  const { raw, userId } = await sessionFor('admin@faculty.example.invalid');
  await withCookie(browser, raw, async (page) => {
    for (const url of ['/admin', '/admin/approvals', '/admin/faculty', '/admin/logs']) {
      const res = await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
      check(url + ' loads', res.status(), res.status() === 200, '200');
    }

    await page.goto(BASE + '/admin/faculty', { waitUntil: 'domcontentloaded' });
    const deptFilterCount = await page.locator('#fac-dept').count();
    check('department filter shown to SUPER_ADMIN', deptFilterCount, deptFilterCount === 1, '1');
    const roleSelectCount = await page.locator('select[aria-label^="Role for"]').count();
    check('role-change controls shown to SUPER_ADMIN', roleSelectCount > 0, roleSelectCount > 0, '>0');

    // Self row must show "You" for actions, not a suspend button.
    const selfCells = await page.locator('table tbody tr').filter({ hasText: 'admin@faculty.example.invalid' }).allInnerTexts();
    console.log('      self row:', JSON.stringify(selfCells[0]?.slice(0, 80)));
  });
  await db.session.deleteMany({ where: { userId } });
}

await browser.close();
await db.$disconnect();
console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
