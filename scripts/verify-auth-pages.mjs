#!/usr/bin/env node
/**
 * Drives every auth screen in a real browser: screenshots at 360px and desktop, plus the
 * signup -> check-email -> verify -> awaiting-approval flow against real services.
 *
 * Usage: node scripts/verify-auth-pages.mjs <baseUrl> <outDir>
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:3160';
const OUT = process.argv[3] ?? '/tmp/auth-shots';
const MAILPIT = 'http://localhost:8025';
const DOMAIN =
  process.env.ALLOWED_EMAIL_DOMAINS?.split(',')[0]?.trim() ?? 'faculty.example.invalid';

const stamp = Date.now();
const EMAIL = `pages.test.${stamp}@${DOMAIN}`;
const PASSWORD = 'correct-horse-battery-7';

const browser = await chromium.launch();
const problems = [];

async function shot(name, path, { width = 1280, height = 900, theme = 'light' } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    colorScheme: theme,
  });
  const page = await ctx.newPage();
  const bad = [];
  page.on('response', (r) => r.status() >= 400 && bad.push(`${r.status()} ${r.url()}`));
  page.on('pageerror', (e) => bad.push(`pageerror ${e.message}`));

  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1', { timeout: 15000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

  const h1 = (await page.textContent('h1'))?.trim();
  if (bad.length) problems.push(`${path}: ${bad.join(' | ')}`);
  console.log(`  ${path.padEnd(24)} h1=${JSON.stringify(h1)}  problems=${bad.length}`);
  await ctx.close();
  return { bad };
}

console.log('\n— static screens —');
await shot('signup-desktop', '/signup');
await shot('signup-mobile', '/signup', { width: 360, height: 900 });
await shot('forgot-desktop', '/forgot-password');
await shot('reset-no-token', '/reset-password');
await shot('verify-no-token', '/verify');
await shot('verify-invalid', '/verify?token=not-a-real-token');
await shot('check-email', `/check-email?email=${encodeURIComponent(EMAIL)}`);
await shot('check-email-mobile', `/check-email?email=${encodeURIComponent(EMAIL)}`, {
  width: 360,
  height: 900,
});
await shot('awaiting-approval', '/awaiting-approval');
await shot('awaiting-approval-dark', '/awaiting-approval', { theme: 'dark' });

// ---- real signup -> verify flow ----
console.log('\n— signup flow —');
await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' }).catch(() => {});

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => problems.push(`signup flow pageerror: ${e.message}`));

await page.goto(`${BASE}/signup`, { waitUntil: 'domcontentloaded' });
await page.fill('#fullName', 'Dr. Pages Test');
await page.fill('#email', EMAIL);
await page.fill('#password', PASSWORD);
await page.selectOption('#departmentId', { index: 1 });
await page.click('button[type=submit]');
await page.waitForURL((u) => u.pathname === '/check-email', { timeout: 30000 });
console.log(`  signup -> ${new URL(page.url()).pathname}`);

const shown = await page.textContent('h1');
const addressShown = await page.evaluate(() => document.body.innerText.includes(location.search.split('email=')[1] ? decodeURIComponent(location.search.split('email=')[1]) : ''));
console.log(`  check-email h1=${JSON.stringify(shown?.trim())} names the address=${addressShown}`);

// resend + cooldown
await page.click('form button[type=submit]');
await page.waitForTimeout(1800);
const cooldownLabel = (await page.textContent('form button[type=submit]'))?.trim();
const disabled = await page.getAttribute('form button[type=submit]', 'disabled');
console.log(`  resend button -> ${JSON.stringify(cooldownLabel)} disabled=${disabled !== null}`);
await page.screenshot({ path: `${OUT}/check-email-cooldown.png`, fullPage: true });

// verify via the emailed link
const search = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(EMAIL)}`)).json();
const msg = await (await fetch(`${MAILPIT}/api/v1/message/${search.messages[0].ID}`)).json();
const token = /[?&]token=([A-Za-z0-9_-]+)/.exec(`${msg.Text}\n${msg.HTML}`)?.[1];
console.log(`  verification email received=${search.messages.length > 0} token=${Boolean(token)}`);

await page.goto(`${BASE}/verify?token=${token}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1');
const verifyH1 = (await page.textContent('h1'))?.trim();
await page.screenshot({ path: `${OUT}/verify-success.png`, fullPage: true });
console.log(`  verify -> ${JSON.stringify(verifyH1)}`);

// second use of the same link
await page.goto(`${BASE}/verify?token=${token}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1');
const reuseH1 = (await page.textContent('h1'))?.trim();
await page.screenshot({ path: `${OUT}/verify-already-used.png`, fullPage: true });
console.log(`  verify again -> ${JSON.stringify(reuseH1)}`);

await ctx.close();
await browser.close();

console.log(`\n  screenshots -> ${OUT}`);
if (problems.length) {
  console.log(`\n  PROBLEMS (${problems.length}):`);
  for (const p of problems) console.log(`      ${p}`);
} else {
  console.log('\n  RESULT: no 4xx responses and no page errors on any screen');
}
process.exit(problems.length ? 1 : 0);
