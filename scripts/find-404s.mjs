#!/usr/bin/env node
/** Captures every non-200 response on a page load, from the very first request. */
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:3150';
const PATHS = process.argv.slice(3).length ? process.argv.slice(3) : ['/login', '/'];

const browser = await chromium.launch();

for (const path of PATHS) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const bad = [];

  // Registered BEFORE goto, so the document request itself is covered.
  page.on('response', (r) => {
    if (r.status() >= 400) bad.push(`${r.status()} ${r.request().resourceType()} ${r.url()}`);
  });
  page.on('requestfailed', (r) =>
    bad.push(`FAILED ${r.resourceType()} ${r.url()} — ${r.failure()?.errorText}`),
  );

  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  console.log(`\n  ${path} — ${bad.length} problem response(s)`);
  for (const b of bad) console.log(`      ${b}`);
  await ctx.close();
}

await browser.close();
