#!/usr/bin/env node
/**
 * /dashboard/preview must render the SAME page as /faculty/[slug], from draft data.
 *
 * The check that matters is a comparison, not an inspection: the section text of the
 * preview and of the published page are diffed. A preview that merely "looks right" is how
 * the two drift apart in the first place.
 */
import { createHash, randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const db = new PrismaClient();

/**
 * Same derivation as prisma/seed.ts and scripts/seed-stress-profiles.mjs — SEED_EMAIL_DOMAIN, else the first
 * ALLOWED_EMAIL_DOMAINS entry, else an RFC 2606 `.invalid` host that can never resolve or
 * receive mail. Hardcoding a college domain here would also fail `npm run check:hostnames`,
 * which is the point of that check: cutover must be config-only.
 */
const EMAIL_DOMAIN =
  process.env.SEED_EMAIL_DOMAIN?.trim() ||
  process.env.ALLOWED_EMAIL_DOMAINS?.split(',')[0]?.trim() ||
  'faculty.example.invalid';

const fixtureEmail = (name) => `stress-${name}@${EMAIL_DOMAIN}`;


let failures = 0;
function check(label, actual, ok, expected) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(48)} ${String(actual).padEnd(26)} ${expected ?? ''}`);
}

async function sessionCookieFor(email) {
  const user = await db.user.findUnique({ where: { email } });
  const raw = randomBytes(32).toString('base64url');
  await db.session.create({
    data: {
      userId: user.id,
      tokenHash: createHash('sha256').update(raw).digest('hex'),
      expiresAt: new Date(Date.now() + 3600e3),
    },
  });
  return { raw, name: '__Host-fp_session' };
}

/** Local part only — the fixture's alt-email domain is env-derived. */
const ALT_EMAIL_LOCALPART = 'r.subramanian.personal';

const browser = await chromium.launch();

/* ── 1. published owner: preview must equal the public page ───────────────────────── */

const heavy = await sessionCookieFor(fixtureEmail('heavy'));
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([
  // A `__Host-` cookie must be Secure with Path=/. Playwright's `url:` form derives the
  // path but not `secure`, and Chrome rejects the pair outright; the explicit
  // domain+path+secure form is the one CDP accepts. Secure is permitted on localhost.
  { name: heavy.name, value: heavy.raw, domain: 'localhost', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
]);
const page = await ctx.newPage();

const readSections = async (url) => {
  await page.goto(url, { waitUntil: 'networkidle' });
  return page.evaluate(() => {
    const ids = [...document.querySelectorAll('section[id]')].map((s) => s.id);
    const text = ids.map((id) => document.getElementById(id).innerText.replace(/\s+/g, ' ').trim());
    return { ids, text, nav: [...document.querySelectorAll('nav[aria-label="Sections of this profile"] a')].map((a) => a.textContent.trim()) };
  });
};

console.log('\n══ preview vs published ══\n');

const published = await readSections(`${BASE}/faculty/stress-heavy`);
const preview = await readSections(`${BASE}/dashboard/preview`);

check('same sections, same order', preview.ids.join(','), preview.ids.join(',') === published.ids.join(','), published.ids.join(','));
check('same sub-nav', preview.nav.join('|'), preview.nav.join('|') === published.nav.join('|'));

const differing = preview.text
  .map((t, i) => (t === published.text[i] ? null : published.ids[i]))
  .filter(Boolean);
check('every section renders identical text', differing.length, differing.length === 0, differing.join(','));

/* ── 2. the visibility flags survive into the preview ─────────────────────────────── */

const html = await page.content();
check(
  'withheld alt email is withheld in the preview too',
  html.includes(ALT_EMAIL_LOCALPART) ? 'LEAKED' : 'absent',
  !html.includes(ALT_EMAIL_LOCALPART),
  'absent',
);
check('shown mobile is present', html.includes('98765 43210'), html.includes('98765 43210'));
check(
  'ongoing student stays initials in the preview',
  html.includes('Sunita Banerjee') ? 'LEAKED' : 'S. B.',
  !html.includes('Sunita Banerjee') && html.includes('S. B.'),
);

/* ── 3. the rail hides itself here and shows elsewhere ────────────────────────────── */

const railOnPreview = await page.locator('aside:has-text("Your public page")').count();
check('preview rail hidden on /dashboard/preview', railOnPreview, railOnPreview === 0, '0');

await page.goto(`${BASE}/dashboard/profile`, { waitUntil: 'networkidle' });
const railOnEditor = await page.locator('aside:has-text("Your public page")').count();
check('preview rail present on an editor page', railOnEditor, railOnEditor === 1, '1');

/* ── 4. an UNPUBLISHED owner can still preview ────────────────────────────────────── */

console.log('\n══ draft owner ══\n');

const draft = await sessionCookieFor(fixtureEmail('draft'));
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx2.addCookies([
  { name: draft.name, value: draft.raw, domain: 'localhost', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' },
]);
const page2 = await ctx2.newPage();

const res = await page2.goto(`${BASE}/dashboard/preview`, { waitUntil: 'networkidle' });
check('draft profile previews (does not 404)', res.status(), res.status() === 200, '200');

const banner = await page2.locator('text=Your profile is a draft').count();
check('banner says it is not live', banner, banner >= 1, '>=1');

const publicRes = await page2.goto(`${BASE}/faculty/stress-draft`, { waitUntil: 'domcontentloaded' });
check('but the public URL still 404s', publicRes.status(), publicRes.status() === 404, '404');

/* ── 5. signed out ─────────────────────────────────────────────────────────────────── */

const anon = await browser.newContext();
const page3 = await anon.newPage();
const anonRes = await page3.goto(`${BASE}/dashboard/preview`, { waitUntil: 'domcontentloaded' });
check('signed out is redirected to login', new URL(page3.url()).pathname, new URL(page3.url()).pathname.startsWith('/login'), '/login');
void anonRes;

await db.session.deleteMany({
  where: {
    tokenHash: {
      in: [heavy.raw, draft.raw].map((r) => createHash('sha256').update(r).digest('hex')),
    },
  },
});
await browser.close();
await db.$disconnect();

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
