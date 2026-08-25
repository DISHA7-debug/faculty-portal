#!/usr/bin/env node
/** Drives signup -> code -> session, and the wrong-code path, in a real browser. */
import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:3200';
const OUT = process.argv[3] ?? '/tmp/otp-shots';
const MAILPIT = 'http://localhost:8025';
const DOMAIN =
  process.env.ALLOWED_EMAIL_DOMAINS?.split(',')[0]?.trim() ?? 'faculty.example.invalid';

const db = new PrismaClient();
const stamp = Date.now();
const EMAIL = `otpflow.${stamp}@${DOMAIN}`;

async function codeFor(address) {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(address)}`);
  const { messages } = await res.json();
  if (!messages?.length) throw new Error('no code email');
  const msg = await (await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`)).json();
  const m = /\b(\d{3})\s?(\d{3})\b/.exec(`${msg.Subject}\n${msg.Text}`);
  return `${m[1]}${m[2]}`;
}

await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' }).catch(() => {});

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const log = (...a) => console.log('  ', ...a);

// ---- SIGN UP (no password field) ----
await page.goto(`${BASE}/signup`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h1');
const hasPasswordField = (await page.locator('input[type=password]').count()) > 0;
log('signup shows a password field:', hasPasswordField, '(must be false)');
await page.screenshot({ path: `${OUT}/signup.png`, fullPage: true });

await page.fill('input[name=fullName]', 'Dr. Otp Flow');
await page.fill('input[name=email]', EMAIL);
await page.selectOption('select[name=departmentId]', { index: 1 });
await page.click('button[type=submit]');
await page.waitForURL((u) => u.pathname === '/verify', { timeout: 30000 });
log('signup landed on:', new URL(page.url()).pathname);
log('code screen names the address:', (await page.textContent('body')).includes(EMAIL));
await page.screenshot({ path: `${OUT}/verify.png`, fullPage: true });

// ---- WRONG CODE ----
await page.fill('input[name=code]', '000000');
await page.click('button[type=submit]');
await page.waitForSelector('[data-testid=form-error]', { timeout: 20000 });
const wrongMsg = (await page.textContent('[data-testid=form-error]')).replace(/\s+/g, ' ').trim();
log('wrong code message:', JSON.stringify(wrongMsg));
await page.screenshot({ path: `${OUT}/wrong-code.png`, fullPage: true });

// ---- CORRECT CODE, typed with a space to prove normalisation ----
const code = await codeFor(EMAIL);
log('code from email:', code);
await page.fill('input[name=code]', `${code.slice(0, 3)} ${code.slice(3)}`);
await page.click('button[type=submit]');
await page.waitForURL((u) => !u.pathname.startsWith('/verify'), { timeout: 30000 });
await page.waitForSelector('h1');
log('after correct code ->', new URL(page.url()).pathname);
log('heading:', JSON.stringify((await page.textContent('h1')).trim()));

const cookies = await ctx.cookies();
const session = cookies.find((c) => c.name === '__Host-fp_session');
log('session cookie set:', Boolean(session));
if (session) {
  log(`  flags: httpOnly=${session.httpOnly} secure=${session.secure} sameSite=${session.sameSite}`);
}

const user = await db.user.findUnique({ where: { email: EMAIL } });
log('account status:', user?.status, '(must be PENDING_APPROVAL, never ACTIVE)');
log('emailVerifiedAt set:', Boolean(user?.emailVerifiedAt));
const sessionRows = await db.session.count({ where: { userId: user.id } });
log('DB session rows:', sessionRows, '(revocable — not a JWT)');
await page.screenshot({ path: `${OUT}/signed-in.png`, fullPage: true });

// ---- code is single-use ----
await page.goto(`${BASE}/verify?email=${encodeURIComponent(EMAIL)}`, { waitUntil: 'domcontentloaded' });
const redirected = new URL(page.url()).pathname;
log('signed-in user visiting /verify ->', redirected);

log('console/page errors:', errors.length);
errors.slice(0, 5).forEach((e) => log('   ', e.slice(0, 140)));

await browser.close();
await db.user.deleteMany({ where: { email: EMAIL } });
await db.$disconnect();
console.log(`\n  screenshots -> ${OUT}`);
process.exit(errors.length || hasPasswordField ? 1 : 0);
