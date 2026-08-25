#!/usr/bin/env node
/**
 * Captures every screen at two widths and two themes into docs/screenshots/.
 *
 * Run against the PRODUCTION server (`npm run build && npm start`), not `next dev` — the
 * dev overlay badge sits in the corner of every dev screenshot and is not part of the
 * design.
 *
 * Theme is driven by the OS preference (`colorScheme`), because the app is configured
 * `defaultTheme="system"`. No cookie or localStorage priming is needed.
 *
 *   node scripts/capture-screenshots.mjs [baseUrl]
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, rm, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';
import sharp from 'sharp';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const OUT = path.resolve('docs/screenshots');
const db = new PrismaClient();

const EMAIL_DOMAIN =
  process.env.SEED_EMAIL_DOMAIN?.trim() ||
  process.env.ALLOWED_EMAIL_DOMAINS?.split(',')[0]?.trim() ||
  'faculty.example.invalid';
const at = (local) => `${local}@${EMAIL_DOMAIN}`;

const VIEWPORTS = [
  { key: 'desktop', width: 1440, height: 900 },
  { key: 'mobile', width: 360, height: 780 },
];
const THEMES = ['light', 'dark'];

/** Mints a real session row and returns the raw cookie value. */
const minted = [];
async function sessionFor(email) {
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  const raw = randomBytes(32).toString('base64url');
  await db.session.create({
    data: {
      userId: user.id,
      tokenHash: createHash('sha256').update(raw).digest('hex'),
      expiresAt: new Date(Date.now() + 3600e3),
    },
  });
  minted.push(raw);
  return raw;
}

const cookieFor = (raw) => ({
  name: '__Host-fp_session',
  value: raw,
  domain: 'localhost',
  path: '/',
  secure: true,
  httpOnly: true,
  sameSite: 'Lax',
});

/**
 * Every screen. `as` names the seeded account whose session is used; `act` runs
 * interactions to reach a state that has no URL of its own (an open form, the cropper).
 */
const SCREENS = [
  // ── Public ──────────────────────────────────────────────────────────────────────────
  { id: '01-landing', group: 'Public', url: '/', note: 'Landing page: search, departments with live counts, and a few profiles.' },
  { id: '01b-directory', group: 'Public', url: '/faculty', note: 'The faculty directory — search, department and designation filters, card grid.' },
  { id: '01c-directory-search', group: 'Public', url: '/faculty?q=machine+learning', note: 'A ranked full-text search. Name and research interests are weighted above biography.' },
  { id: '01d-directory-empty', group: 'Public', url: '/faculty?q=qwertyuiop', note: 'The empty state — says what to change, not just that there is nothing.' },
  { id: '01e-department', group: 'Public', url: '/departments/computer-science-engineering', note: 'A department page. Its own URL, title and description, not a redirect to a filtered query.' },
  { id: '02-profile-full', group: 'Public', url: '/faculty/anita-sharma', note: 'A seeded faculty profile — the normal case.' },
  { id: '03-profile-long', group: 'Public', url: '/faculty/stress-heavy', full: false, note: '60 publications and a 200-word title. Viewport crop, not full page.' },
  { id: '04-profile-long-pubs', group: 'Public', url: '/faculty/stress-heavy#publications', full: false, note: 'The publications section of the same profile, scrolled to.' },
  { id: '05-profile-sparse', group: 'Public', url: '/faculty/stress-bare', note: 'A profile with only a name — no sections, no sub-nav.' },
  { id: '06-not-found', group: 'Public', url: '/faculty/no-such-person', note: 'The designed 404. Draft, pending and suspended profiles render this too — deliberately indistinguishable from a slug that never existed.' },

  // ── Auth ────────────────────────────────────────────────────────────────────────────
  { id: '10-login', group: 'Auth', url: '/login', note: 'Ask for a sign-in code. There is no password field anywhere in this app.' },
  {
    id: '11-login-sending', group: 'Auth', url: '/login',
    note: 'The pending state. Sending is deliberately not instant — the per-address throttle is a delay rather than a lockout, because the public directory publishes every faculty email.',
    async act(page) {
      await page.fill('input[type="email"]', at('anita.sharma'));
      await page.click('button[type="submit"]');
      await page.waitForTimeout(900);
    },
  },
  {
    id: '12-login-error', group: 'Auth', url: '/login',
    note: 'Rejected input — an address outside the college domain.',
    async act(page) {
      await page.fill('input[type="email"]', 'someone@gmail.com');
      await page.click('button[type="submit"]');
      await page.waitForTimeout(2500);
    },
  },
  {
    id: '13-verify-code', group: 'Auth',
    url: `/verify?email=${encodeURIComponent(at('anita.sharma'))}`,
    note: 'Code entry. This is where /login sends you; the code itself is in Mailpit at http://localhost:8025.',
  },
  {
    id: '14-verify-wrong-code', group: 'Auth',
    url: `/verify?email=${encodeURIComponent(at('anita.sharma'))}`,
    note: 'A wrong code. Five wrong attempts destroy the code — that cap is the security parameter, since the code space is fixed at a million.',
    async act(page) {
      await page.fill('input[name="code"]', '000000');
      await page.click('button[type="submit"]');
      await page.waitForTimeout(3000);
    },
  },
  { id: '15-verify-no-address', group: 'Auth', url: '/verify', note: 'The same page reached without an address in the URL — it says so rather than showing an unusable form.' },
  { id: '16-signup', group: 'Auth', url: '/signup', note: 'Registration. Department is mandatory; approval is a separate gate.' },
  { id: '17-awaiting-approval', group: 'Auth', url: '/awaiting-approval', note: 'What a verified but unapproved account is shown.' },

  // ── Dashboard ───────────────────────────────────────────────────────────────────────
  { id: '20-dashboard', group: 'Dashboard', as: 'anita.sharma', url: '/dashboard', note: 'Overview: completeness, shell, sidebar nav, right-hand rail.' },
  { id: '21-personal-details', group: 'Dashboard', as: 'anita.sharma', url: '/dashboard/profile', note: 'Personal details, visibility toggles, research-interest tags, photo and CV upload.' },
  { id: '22-academics', group: 'Dashboard', as: 'anita.sharma', url: '/dashboard/academics', note: 'Education — the generic repeatable section.' },
  { id: '23-publications', group: 'Dashboard', as: 'anita.sharma', url: '/dashboard/publications', note: 'Publications.' },
  {
    id: '24-publications-form', group: 'Dashboard', as: 'anita.sharma', url: '/dashboard/publications',
    note: 'The inline add form open — this is what all eight editors look like while editing.',
    async act(page) {
      await page.getByRole('button', { name: /add/i }).first().click();
      await page.waitForTimeout(700);
    },
  },
  { id: '25-positions', group: 'Dashboard', as: 'anita.sharma', url: '/dashboard/positions', note: 'Positions and Memberships — two headed sections on one page.' },
  { id: '26-awards', group: 'Dashboard', as: 'anita.sharma', url: '/dashboard/awards', note: 'Awards.' },
  { id: '27-awards-empty', group: 'Dashboard', as: 'deepa.krishnan', url: '/dashboard/awards', note: 'The empty state — a seeded account deliberately has no awards.' },
  { id: '28-teaching', group: 'Dashboard', as: 'anita.sharma', url: '/dashboard/teaching', note: 'Courses.' },
  { id: '29-projects', group: 'Dashboard', as: 'anita.sharma', url: '/dashboard/projects', note: 'Research projects — two enums, type and status.' },
  { id: '30-guidance', group: 'Dashboard', as: 'anita.sharma', url: '/dashboard/guidance', note: 'Research guidance, including the per-student name-display control.' },
  { id: '31-publish', group: 'Dashboard', as: 'anita.sharma', url: '/dashboard/publish', note: 'Draft / published toggle.' },
  { id: '32-preview', group: 'Dashboard', as: 'anita.sharma', url: '/dashboard/preview', note: 'The public page rendered from draft data, in the dashboard.' },
  { id: '33-dashboard-pending', group: 'Dashboard', as: 'pending.cse', url: '/dashboard', note: 'The same shell for a PENDING_APPROVAL account — editable, with the approval banner.' },
  { id: '34-publish-pending', group: 'Dashboard', as: 'pending.cse', url: '/dashboard/publish', note: 'Publishing refused until an admin approves the account.' },

  // ── Upload flow ─────────────────────────────────────────────────────────────────────
  {
    id: '40-photo-cropper', group: 'Upload', as: 'anita.sharma', url: '/dashboard/profile',
    note: 'The square cropper, after choosing a non-square image. Arrow keys nudge; it can be skipped.',
    async act(page) {
      // Patterned, not a flat colour: against a solid fill the crop window is invisible
      // and the screenshot shows nothing about the control it is meant to document.
      const w = 1600, h = 900;
      const px = Buffer.alloc(w * h * 3);
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const i = (y * w + x) * 3;
          const grid = (x % 200 < 4 || y % 200 < 4) ? 70 : 0;
          px[i] = Math.min(255, 30 + (x / w) * 190 + grid);
          px[i + 1] = Math.min(255, 60 + (y / h) * 120 + grid);
          px[i + 2] = Math.min(255, 150 - (x / w) * 60 + grid);
        }
      }
      const jpeg = await sharp(px, { raw: { width: w, height: h, channels: 3 } })
        .jpeg({ quality: 92 })
        .toBuffer();
      await page.setInputFiles('input[type="file"][accept*="image"]', {
        name: 'wide-photo.jpg',
        mimeType: 'image/jpeg',
        buffer: jpeg,
      });
      await page.waitForTimeout(1200);
    },
  },
  {
    id: '41-upload-rejected', group: 'Upload', as: 'anita.sharma', url: '/dashboard/profile',
    note: 'A rejected file — a PDF offered where a photo is expected.',
    async act(page) {
      await page.setInputFiles('input[type="file"][accept*="image"]', {
        name: 'not-a-photo.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.7\ntrailer\n%%EOF\n'),
      });
      await page.waitForTimeout(1200);
    },
  },
];

/* ── capture ────────────────────────────────────────────────────────────────────────── */

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const sessions = new Map();
for (const who of new Set(SCREENS.map((s) => s.as).filter(Boolean))) {
  sessions.set(who, await sessionFor(at(who)));
}

const captured = [];
let failed = 0;

for (const theme of THEMES) {
  for (const vp of VIEWPORTS) {
    for (const screen of SCREENS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 2,
        colorScheme: theme,
        // Screenshots of spring animations mid-flight look like rendering faults.
        reducedMotion: 'reduce',
      });
      if (screen.as) await context.addCookies([cookieFor(sessions.get(screen.as))]);

      const page = await context.newPage();
      const file = `${screen.id}-${vp.key}-${theme}.png`;
      try {
        await page.goto(`${BASE}${screen.url}`, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(500);
        if (screen.act) await screen.act(page);
        await page.waitForTimeout(400);
        await page.screenshot({
          path: path.join(OUT, file),
          fullPage: screen.full !== false,
        });
        captured.push({ ...screen, file, viewport: vp.key, theme });
      } catch (error) {
        failed += 1;
        console.log(`  FAIL ${file}: ${String(error).split('\n')[0]}`);
      }
      await context.close();
    }
  }
}

await db.session.deleteMany({
  where: { tokenHash: { in: minted.map((r) => createHash('sha256').update(r).digest('hex')) } },
});
await browser.close();
await db.$disconnect();

/* ── index ──────────────────────────────────────────────────────────────────────────── */

const files = await readdir(OUT);
let bytes = 0;
for (const f of files) bytes += (await stat(path.join(OUT, f))).size;

const groups = [...new Set(SCREENS.map((s) => s.group))];
const lines = [
  '# Screenshots',
  '',
  `Every screen at 1440px and 360px, light and dark. Generated by \`npm run screenshots\``,
  'against a production build — `next dev` overlays a badge on every capture.',
  '',
  `${files.length} images, ${(bytes / 1024 / 1024).toFixed(1)} MB. Regenerate rather than edit.`,
  '',
  '> Captured with `prefers-reduced-motion: reduce`, so nothing is frozen mid-animation.',
  '> Full-page captures except where noted.',
  '',
];

for (const group of groups) {
  lines.push(`## ${group}`, '');
  for (const screen of SCREENS.filter((s) => s.group === group)) {
    lines.push(`### ${screen.id.replace(/^\d+-/, '').replace(/-/g, ' ')}`, '');
    lines.push(screen.note, '');
    if (screen.as) lines.push(`Signed in as \`${at(screen.as)}\`.`, '');
    lines.push(`\`${screen.url}\``, '');
    lines.push('| | Light | Dark |');
    lines.push('|---|---|---|');
    for (const vp of VIEWPORTS) {
      const cells = THEMES.map((t) => {
        const f = `${screen.id}-${vp.key}-${t}.png`;
        return files.includes(f) ? `[![${f}](${f})](${f})` : '—';
      });
      lines.push(`| **${vp.key}** | ${cells[0]} | ${cells[1]} |`);
    }
    lines.push('');
  }
}

await writeFile(path.join(OUT, 'README.md'), lines.join('\n'));

console.log(`\n${captured.length} captured, ${failed} failed → ${OUT}`);
console.log(`${(bytes / 1024 / 1024).toFixed(1)} MB total\n`);
process.exit(failed === 0 ? 0 : 1);
