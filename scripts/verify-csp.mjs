#!/usr/bin/env node
/**
 * Loads /dashboard in a real browser with a real session and reports what the console
 * actually says.
 *
 * Written because `strict-dynamic` cannot be validated by reading headers: the question
 * is whether Next's chunk loader still executes under it, and only a browser answers
 * that. Reports CSP violations, console errors, page errors, and whether React hydrated.
 *
 * Usage: node scripts/verify-csp.mjs <baseUrl>
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:3131';

const { PrismaClient } = await import('@prisma/client');
const { createHash, randomBytes } = await import('node:crypto');

const db = new PrismaClient();

// Mint a session directly, so this does not depend on the login page existing yet.
const user = await db.user.findFirst({
  where: { status: 'ACTIVE', profile: { isNot: null } },
  include: { profile: true },
});
if (!user) {
  console.error('No ACTIVE user with a profile. Run: npm run db:seed');
  process.exit(2);
}

const rawToken = randomBytes(32).toString('base64url');
await db.session.create({
  data: {
    userId: user.id,
    tokenHash: createHash('sha256').update(rawToken).digest('hex'),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  },
});

const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true });

const url = new URL(BASE);
await context.addCookies([
  {
    name: '__Host-fp_session',
    value: rawToken,
    domain: url.hostname,
    path: '/',
    // The __Host- prefix REQUIRES Secure, and the browser rejects the cookie outright
    // without it. http://localhost counts as a trustworthy origin, so this is accepted
    // there — the same reason `npm run dev` works without TLS (docs/CUTOVER.md §5).
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
  },
]);

const page = await context.newPage();

const cspViolations = [];
const consoleErrors = [];
const consoleWarnings = [];
const pageErrors = [];
const failedRequests = [];

// The authoritative signal: the browser's own CSP violation event.
await page.addInitScript(() => {
  window.__cspViolations = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__cspViolations.push({
      directive: e.violatedDirective,
      blockedURI: e.blockedURI,
      sample: e.sample,
    });
  });
});

page.on('console', (msg) => {
  const text = msg.text();
  if (msg.type() === 'error') consoleErrors.push(text);
  if (msg.type() === 'warning') consoleWarnings.push(text);
  if (/Content Security Policy|Refused to/i.test(text)) cspViolations.push(text);
});
page.on('pageerror', (err) => pageErrors.push(err.message));
page.on('requestfailed', (req) =>
  failedRequests.push(`${req.url()} — ${req.failure()?.errorText}`),
);

const response = await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });

const cspHeader = response?.headers()['content-security-policy'] ?? '(none)';
const cacheControl = response?.headers()['cache-control'] ?? '(none)';

// Hydration check: React attaches this only after the client bundle runs. If
// strict-dynamic blocked the chunk loader, this stays false while the HTML still renders.
const hydrated = await page.evaluate(() => {
  const root = document.querySelector('main');
  if (!root) return false;
  const keys = Object.keys(root);
  return keys.some((k) => k.startsWith('__react')) || Boolean(window.next);
});

const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 400));
const inPageViolations = await page.evaluate(() => window.__cspViolations ?? []);

await browser.close();
await db.session.deleteMany({ where: { tokenHash: createHash('sha256').update(rawToken).digest('hex') } });
await db.$disconnect();

const line = (s) => console.log(s);
line('');
line(`  URL              ${BASE}/dashboard`);
line(`  HTTP status      ${response?.status()}`);
line(`  Cache-Control    ${cacheControl}`);
line(`  CSP              ${cspHeader.slice(0, 150)}${cspHeader.length > 150 ? '…' : ''}`);
line(`  React hydrated   ${hydrated ? 'YES' : 'NO'}`);
line('');
line(`  CSP violations   ${inPageViolations.length}`);
for (const v of inPageViolations) {
  line(`      ${v.directive} blocked ${v.blockedURI} ${v.sample ? `(${v.sample})` : ''}`);
}
line(`  Console errors   ${consoleErrors.length}`);
for (const e of consoleErrors.slice(0, 10)) line(`      ${e.slice(0, 200)}`);
line(`  Page errors      ${pageErrors.length}`);
for (const e of pageErrors.slice(0, 10)) line(`      ${e.slice(0, 200)}`);
line(`  Failed requests  ${failedRequests.length}`);
for (const f of failedRequests.slice(0, 10)) line(`      ${f.slice(0, 200)}`);
line('');
line(`  Rendered text    ${JSON.stringify(bodyText.slice(0, 160))}`);
line('');

const broken =
  inPageViolations.length > 0 || pageErrors.length > 0 || !hydrated;
line(broken ? '  RESULT: PROBLEMS FOUND' : '  RESULT: clean — no CSP violations, hydrated');
process.exit(broken ? 1 : 0);
