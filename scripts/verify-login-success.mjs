#!/usr/bin/env node
/** Signs in as a seeded user and confirms the redirect + session actually work. */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:3142';
const DOMAIN =
  process.env.ALLOWED_EMAIL_DOMAINS?.split(',')[0]?.trim() ?? 'faculty.example.invalid';
const EMAIL = `anita.sharma@${DOMAIN}`;
const PASSWORD = 'DevPassword123!';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// Arrive via the proxy redirect, so `next` round-trips exactly as a real user would hit it.
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
const landedOn = new URL(page.url());
console.log('  redirected to      ', landedOn.pathname + landedOn.search);

await page.waitForSelector('#email');
await page.fill('#email', EMAIL);
await page.fill('#password', PASSWORD);
await page.click('button[type=submit]');

await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
await page.waitForSelector('h1', { timeout: 15000 });

const finalUrl = new URL(page.url());
const heading = await page.textContent('h1');
const cookies = await ctx.cookies();
const session = cookies.find((c) => c.name === '__Host-fp_session');
const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 200));

console.log('  after sign-in      ', finalUrl.pathname);
console.log('  heading            ', JSON.stringify(heading?.trim()));
console.log('  session cookie     ', session ? 'set' : 'MISSING');
if (session) {
  console.log(
    '  cookie flags       ',
    `httpOnly=${session.httpOnly} secure=${session.secure} sameSite=${session.sameSite} path=${session.path}`,
  );
}
console.log('  page errors        ', errors.length);
console.log('  body               ', JSON.stringify(bodyText.slice(0, 120)));

await browser.close();

const ok =
  finalUrl.pathname === '/dashboard' && Boolean(session) && errors.length === 0;
console.log(ok ? '\n  RESULT: sign-in works end to end' : '\n  RESULT: PROBLEM');
process.exit(ok ? 0 : 1);
