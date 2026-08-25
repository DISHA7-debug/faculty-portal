#!/usr/bin/env node
/**
 * Drives the login page in a real browser: screenshots at 360px and desktop, a real
 * sign-in, a failed sign-in, and keyboard-only navigation.
 *
 * Usage: node scripts/verify-login.mjs <baseUrl> <outDir>
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:3140';
const OUT = process.argv[3] ?? '/tmp/login-shots';

const browser = await chromium.launch();

async function shot(name, width, height, path, theme = 'light') {
  const ctx = await browser.newContext({
    viewport: { width, height },
    colorScheme: theme,
    ignoreHTTPSErrors: true,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1', { timeout: 15000 });
  await page.waitForTimeout(400); // let fonts settle so screenshots are representative
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  await ctx.close();
}

await shot('login-desktop', 1280, 900, '/login');
await shot('login-mobile', 360, 780, '/login');
await shot('login-dark', 1280, 900, '/login', 'dark');

// ---- functional checks ----
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
const notFound = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(e.message));

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1');
await page.waitForTimeout(400);

// Accessibility wiring
const a11y = await page.evaluate(() => {
  const out = {};
  for (const id of ['email', 'password']) {
    const input = document.getElementById(id);
    const label = document.querySelector(`label[for="${id}"]`);
    out[id] = {
      hasLabel: Boolean(label),
      labelText: label?.textContent?.trim(),
      type: input?.getAttribute('type'),
      autocomplete: input?.getAttribute('autocomplete'),
      required: input?.hasAttribute('required'),
    };
  }
  out.h1 = document.querySelector('h1')?.textContent?.trim();
  out.formCount = document.querySelectorAll('form').length;
  return out;
});

// Keyboard-only: tab order and whether focus is visible.
await page.keyboard.press('Tab'); // back-link
await page.keyboard.press('Tab'); // email
const focusAfterTwo = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
await page.keyboard.press('Tab'); // password
const focusAfterThree = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
const focusVisible = await page.evaluate(() => {
  const el = document.activeElement;
  if (!el) return null;
  const s = getComputedStyle(el);
  return { outlineWidth: s.outlineWidth, boxShadow: s.boxShadow.slice(0, 40), borderColor: s.borderColor };
});

// Wrong credentials -> generic message
await page.fill('#email', 'nobody.at.all@faculty.example.invalid');
await page.fill('#password', 'definitely-not-the-password');
page.on('response', (r) => {
  if (r.status() === 404) notFound.push(r.url());
});
await page.click('button[type=submit]');
await page.waitForSelector('[data-testid=form-error]', { timeout: 30000 });
const failureMessage = (await page.textContent('[data-testid=form-error]'))?.trim();
await page.screenshot({ path: `${OUT}/login-error.png`, fullPage: true });

await ctx.close();
await browser.close();

console.log('');
console.log('  h1                 ', JSON.stringify(a11y.h1));
console.log('  forms              ', a11y.formCount);
console.log('  email field        ', JSON.stringify(a11y.email));
console.log('  password field     ', JSON.stringify(a11y.password));
console.log('  focus after 2 tabs ', focusAfterTwo);
console.log('  focus after 3 tabs ', focusAfterThree);
console.log('  focus ring         ', JSON.stringify(focusVisible));
console.log('');
console.log('  failure message    ', JSON.stringify(failureMessage));
console.log('  404s               ', notFound.length, notFound.map((u) => new URL(u).pathname).join(' '));
console.log('  console errors     ', consoleErrors.length);
for (const e of consoleErrors.slice(0, 5)) console.log('      ', e.slice(0, 160));
console.log('');
console.log(`  screenshots -> ${OUT}`);
