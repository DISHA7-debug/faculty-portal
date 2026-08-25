#!/usr/bin/env node
/** Drives the Publications section: DOI canonicalisation, the NULL case, and the conflict message. */
import { createHash, randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:3180';
const OUT = process.argv[3] ?? '/tmp/pub-shots';

const db = new PrismaClient();
const user = await db.user.findFirst({
  where: { status: 'ACTIVE', profile: { isNot: null } },
  include: { profile: true },
});
if (!user) process.exit(2);
await db.publication.deleteMany({ where: { profileId: user.profile.id } });

const rawToken = randomBytes(32).toString('base64url');
await db.session.create({
  data: {
    userId: user.id,
    tokenHash: createHash('sha256').update(rawToken).digest('hex'),
    expiresAt: new Date(Date.now() + 3600e3),
  },
});

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
await ctx.addCookies([{
  name: '__Host-fp_session', value: rawToken, domain: new URL(BASE).hostname,
  path: '/', secure: true, httpOnly: true, sameSite: 'Lax',
}]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const log = (...a) => console.log('  ', ...a);

await page.goto(`${BASE}/dashboard/publications`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1');

async function add({ title, authors, doi }) {
  await page.getByRole('button', { name: /^Add (your first )?publication$/i }).first().click();
  await page.waitForSelector('form input[name=title]');
  await page.selectOption('select[name=type]', 'JOURNAL');
  await page.fill('input[name=title]', title);
  await page.fill('input[name=authors]', authors);
  if (doi !== undefined) await page.fill('input[name=doi]', doi);
  await page.getByRole('button', { name: /Save publication/i }).click();
  await page.waitForTimeout(1400);
}

// 1. Two publications with NO doi — the regression case.
await add({ title: 'First paper with no DOI', authors: 'A. Author' });
await add({ title: 'Second paper with no DOI', authors: 'B. Author' });
const noDoiCount = await db.publication.count({
  where: { profileId: user.profile.id, doi: null },
});
log('two DOI-less publications both saved:', noDoiCount === 2, `(count=${noDoiCount})`);

// 2. DOI pasted as a full resolver URL — stored canonical.
await add({
  title: 'Paper with a resolver-URL DOI',
  authors: 'C. Author',
  doi: 'https://doi.org/10.1109/TPDS.2024.999',
});
const stored = await db.publication.findFirst({
  where: { profileId: user.profile.id, title: 'Paper with a resolver-URL DOI' },
  select: { doi: true },
});
log('resolver URL canonicalised to:', JSON.stringify(stored?.doi));

// 3. The SAME paper pasted in a different format — must be caught as a duplicate.
await add({
  title: 'Same paper, different DOI format',
  authors: 'C. Author',
  doi: 'doi: 10.1109/TPDS.2024.999',
});
await page.waitForTimeout(600);
const conflictMsg = await page
  .locator('[data-testid=section-error]')
  .first()
  .textContent()
  .catch(() => null);
log('conflict message:', JSON.stringify(conflictMsg?.trim()?.slice(0, 160)));
log('names the conflicting title:', Boolean(conflictMsg?.includes('resolver-URL')));
await page.screenshot({ path: `${OUT}/pub-doi-conflict.png`, fullPage: true });

const total = await db.publication.count({ where: { profileId: user.profile.id } });
log('total publications (duplicate rejected):', total);

log('console/page errors:', errors.length);
errors.slice(0, 4).forEach((e) => log('   ', e.slice(0, 140)));

await page.screenshot({ path: `${OUT}/pub-list.png`, fullPage: true });
await browser.close();
await db.publication.deleteMany({ where: { profileId: user.profile.id } });
await db.session.deleteMany({
  where: { tokenHash: createHash('sha256').update(rawToken).digest('hex') },
});
await db.$disconnect();
console.log(`\n  screenshots -> ${OUT}`);
