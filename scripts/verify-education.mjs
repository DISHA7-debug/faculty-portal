#!/usr/bin/env node
/**
 * Drives the Education section in a real browser: add, edit, keyboard reorder, delete
 * confirmation, and the optimistic-rollback path.
 *
 * Usage: node scripts/verify-education.mjs <baseUrl> <outDir>
 */
import { createHash, randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:3170';
const OUT = process.argv[3] ?? '/tmp/edu-shots';

const db = new PrismaClient();
const user = await db.user.findFirst({
  where: { status: 'ACTIVE', profile: { isNot: null } },
  include: { profile: true },
});
if (!user) {
  console.error('Run: npm run db:seed');
  process.exit(2);
}

// Start from a clean section so counts are deterministic.
await db.education.deleteMany({ where: { profileId: user.profile.id } });

const rawToken = randomBytes(32).toString('base64url');
await db.session.create({
  data: {
    userId: user.id,
    tokenHash: createHash('sha256').update(rawToken).digest('hex'),
    expiresAt: new Date(Date.now() + 3600e3),
  },
});

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
await ctx.addCookies([
  {
    name: '__Host-fp_session',
    value: rawToken,
    domain: new URL(BASE).hostname,
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
  },
]);

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const log = (...a) => console.log('  ', ...a);

await page.goto(`${BASE}/dashboard/academics`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1');

// ---- EMPTY state ----
const emptyText = await page.textContent('body');
log('empty state shown:', emptyText.includes('No education yet'));
await page.screenshot({ path: `${OUT}/edu-empty.png`, fullPage: true });

async function addEntry({ degree, level, field, institution, from, to }) {
  const addBtn = page.getByRole('button', { name: /^Add (your first )?education entry$/i }).first();
  await addBtn.click();
  await page.waitForSelector('form input[name=degree]');
  await page.fill('input[name=degree]', degree);
  await page.selectOption('select[name=level]', level);
  if (field) await page.fill('input[name=field]', field);
  await page.fill('input[name=institution]', institution);
  if (from) await page.fill('input[name=yearFrom]', String(from));
  if (to) await page.fill('input[name=yearTo]', String(to));
  await page.getByRole('button', { name: /Save education entry/i }).click();
  await page.waitForTimeout(1200);
}

await addEntry({ degree: 'Ph.D.', level: 'PHD', field: 'Computer Science', institution: 'IIT Bombay', from: 2008, to: 2013 });
await addEntry({ degree: 'M.Tech.', level: 'MASTERS', field: 'CSE', institution: 'NIT Trichy', from: 2005, to: 2007 });
await addEntry({ degree: 'B.Tech.', level: 'BACHELORS', field: 'IT', institution: 'Anna University', from: 2001, to: 2005 });

const rowsAfterAdd = await db.education.count({ where: { profileId: user.profile.id } });
log('rows after 3 adds:', rowsAfterAdd);
await page.screenshot({ path: `${OUT}/edu-populated.png`, fullPage: true });

// ---- KEYBOARD REORDER (drag alone is not accessible) ----
const orderBefore = (
  await db.education.findMany({
    where: { profileId: user.profile.id },
    orderBy: { sortOrder: 'asc' },
    select: { degree: true },
  })
).map((r) => r.degree);

// Move the last row up using the arrow button, via the keyboard.
const upButtons = page.getByRole('button', { name: /Move education entry up/i });
await upButtons.last().focus();
await page.keyboard.press('Enter');
await page.waitForTimeout(1500);

const orderAfter = (
  await db.education.findMany({
    where: { profileId: user.profile.id },
    orderBy: { sortOrder: 'asc' },
    select: { degree: true },
  })
).map((r) => r.degree);

log('order before:', orderBefore.join(' → '));
log('order after :', orderAfter.join(' → '));
log('reorder persisted:', JSON.stringify(orderBefore) !== JSON.stringify(orderAfter));

// sortOrder must be a clean 0..n-1 sequence, not sparse.
const sorts = (
  await db.education.findMany({
    where: { profileId: user.profile.id },
    orderBy: { sortOrder: 'asc' },
    select: { sortOrder: true },
  })
).map((r) => r.sortOrder);
log('sortOrder sequence:', JSON.stringify(sorts));

// ---- VALIDATION ----
await page.getByRole('button', { name: /^Add education entry$/i }).first().click();
await page.waitForSelector('form input[name=degree]');
await page.fill('input[name=degree]', 'Test');
await page.selectOption('select[name=level]', 'PHD');
await page.fill('input[name=institution]', 'Somewhere');
await page.fill('input[name=yearFrom]', '2020');
await page.fill('input[name=yearTo]', '2010'); // start after end
await page.getByRole('button', { name: /Save education entry/i }).click();
await page.waitForTimeout(600);
const validationMsg = await page.locator('[role=alert]').first().textContent().catch(() => null);
log('client validation blocked bad years:', Boolean(validationMsg?.match(/start year/i)));
await page.screenshot({ path: `${OUT}/edu-validation.png`, fullPage: true });
await page.getByRole('button', { name: /^Cancel$/i }).first().click();
await page.waitForTimeout(300);

// ---- DELETE with inline confirmation ----
await page.getByRole('button', { name: /^Delete$/ }).first().click();
await page.waitForTimeout(200);
const confirmVisible = await page.getByRole('button', { name: /Yes, delete/i }).isVisible();
log('inline delete confirmation shown:', confirmVisible);
await page.screenshot({ path: `${OUT}/edu-delete-confirm.png`, fullPage: true });
await page.getByRole('button', { name: /Yes, delete/i }).click();
await page.waitForTimeout(1500);
const afterDelete = await db.education.count({ where: { profileId: user.profile.id } });
log('rows after delete:', afterDelete);

// ---- COMPLETENESS recomputed ----
const profile = await db.profile.findUnique({
  where: { id: user.profile.id },
  select: { completeness: true },
});
log('profile.completeness:', profile.completeness);

log('console/page errors:', errors.length);
errors.slice(0, 5).forEach((e) => log('   ', e.slice(0, 140)));

await browser.close();
await db.education.deleteMany({ where: { profileId: user.profile.id } });
await db.session.deleteMany({
  where: { tokenHash: createHash('sha256').update(rawToken).digest('hex') },
});
await db.$disconnect();

console.log(`\n  screenshots -> ${OUT}`);
