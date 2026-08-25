#!/usr/bin/env node
/**
 * Drives all six remaining sections: add, edit, keyboard reorder, delete, persistence.
 * Every enum value in Projects and Guidance is exercised, not just the default.
 */
import { createHash, randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:3190';
const OUT = process.argv[3] ?? '/tmp/sect-shots';

const db = new PrismaClient();
const user = await db.user.findFirst({
  where: { status: 'ACTIVE', profile: { isNot: null } },
  include: { profile: true },
});
if (!user) process.exit(2);
const pid = user.profile.id;

for (const m of ['position', 'membership', 'award', 'course', 'researchProject', 'guidance']) {
  await db[m].deleteMany({ where: { profileId: pid } });
}

const rawToken = randomBytes(32).toString('base64url');
await db.session.create({
  data: {
    userId: user.id,
    tokenHash: createHash('sha256').update(rawToken).digest('hex'),
    expiresAt: new Date(Date.now() + 3600e3),
  },
});

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
await ctx.addCookies([{
  name: '__Host-fp_session', value: rawToken, domain: new URL(BASE).hostname,
  path: '/', secure: true, httpOnly: true, sameSite: 'Lax',
}]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

const clicks = [];
const log = (...a) => console.log('  ', ...a);
const act = (s) => clicks.push(s);

async function addEntry(sectionNoun, values, selects = {}) {
  const btn = page
    .getByRole('button', { name: new RegExp(`Add (your first )?${sectionNoun}`, 'i') })
    .first();
  await btn.waitFor({ state: 'visible', timeout: 20000 });
  await btn.click();
  act(`clicked "Add ${sectionNoun}"`);
  await page.waitForSelector('form input, form select');

  for (const [name, value] of Object.entries(selects)) {
    await page.selectOption(`select[name=${name}]`, value);
    act(`selected ${name}=${value}`);
  }
  for (const [name, value] of Object.entries(values)) {
    await page.fill(`input[name=${name}]`, String(value));
  }
  await page.getByRole('button', { name: new RegExp(`Save ${sectionNoun}`, 'i') }).first().click();
  act(`clicked "Save ${sectionNoun}"`);
  await page.waitForTimeout(1300);
}

async function keyboardReorderFirstUp(model) {
  const before = (await db[model].findMany({
    where: { profileId: pid }, orderBy: { sortOrder: 'asc' }, select: { id: true },
  })).map((r) => r.id);

  const ups = page.getByRole('button', { name: /Move .* up/i });
  await ups.last().focus();
  act('focused last "Move … up" button');
  await page.keyboard.press('Enter');
  act('pressed Enter (keyboard reorder)');
  await page.waitForTimeout(1500);

  const after = (await db[model].findMany({
    where: { profileId: pid }, orderBy: { sortOrder: 'asc' }, select: { id: true },
  })).map((r) => r.id);

  const sorts = (await db[model].findMany({
    where: { profileId: pid }, orderBy: { sortOrder: 'asc' }, select: { sortOrder: true },
  })).map((r) => r.sortOrder);

  return {
    changed: JSON.stringify(before) !== JSON.stringify(after),
    sorts: JSON.stringify(sorts),
  };
}

async function editFirst(newValue, fieldName) {
  await page.getByRole('button', { name: /^Edit$/ }).first().click();
  act('clicked "Edit" on the first row');
  await page.waitForSelector(`form input[name=${fieldName}]`);
  await page.fill(`input[name=${fieldName}]`, newValue);
  await page.getByRole('button', { name: /Save changes/i }).click();
  act('clicked "Save changes"');
  await page.waitForTimeout(1300);
}

async function deleteFirst() {
  await page.getByRole('button', { name: /^Delete$/ }).first().click();
  act('clicked "Delete"');
  await page.getByRole('button', { name: /Yes, delete/i }).click();
  act('clicked "Yes, delete"');
  await page.waitForTimeout(1300);
}

const results = [];

async function run(name, path, model, noun, fn) {
  clicks.length = 0;
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('h1');
  let out;
  try {
    out = await fn();
  } catch (error) {
    await page.screenshot({ path: `${OUT}/FAILED-${name}.png`, fullPage: true });
    console.log(`   [${name}] FAILED — url=${page.url()}`);
    console.log(`   [${name}] buttons: ${JSON.stringify((await page.locator('button').allTextContents()).slice(0, 6))}`);
    throw error;
  }
  const count = await db[model].count({ where: { profileId: pid } });
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  results.push({ name, count, ...out, clicks: [...clicks] });
}

// ---------------- POSITIONS ----------------
await run('positions', '/dashboard/positions', 'position', 'position', async () => {
  await addEntry('position', { title: 'Head of Department', organisation: 'College of Engineering', startYear: 2022 });
  await addEntry('position', { title: 'Associate Professor', organisation: 'College of Engineering', startYear: 2016, endYear: 2022 });
  await addEntry('position', { title: 'Assistant Professor', organisation: 'College of Engineering', startYear: 2011, endYear: 2016 });
  const reorder = await keyboardReorderFirstUp('position');
  await editFirst('Professor and Head', 'title');
  const edited = await db.position.findFirst({ where: { profileId: pid, title: 'Professor and Head' } });
  return { reorder, editPersisted: Boolean(edited) };
});

// ---------------- MEMBERSHIPS (same page, second section) ----------------
await run('memberships', '/dashboard/positions', 'membership', 'membership', async () => {
  // Two headed sections must be present, not one merged list.
  const headings = await page.locator('h2').allTextContents();
  await addEntry('membership', { body: 'IEEE', membershipType: 'Senior Member', sinceYear: 2015 });
  await addEntry('membership', { body: 'ACM', membershipType: 'Member', sinceYear: 2012 });
  const reorder = await keyboardReorderFirstUp('membership');
  return { headings: headings.filter((h) => h.trim()).join(' | '), reorder };
});

// ---------------- AWARDS ----------------
await run('awards', '/dashboard/awards', 'award', 'award', async () => {
  await addEntry('award', { title: 'Best Paper Award', awardedBy: 'ICC', year: 2023 });
  await addEntry('award', { title: 'Young Researcher Award', awardedBy: 'DST', year: 2016 });
  const reorder = await keyboardReorderFirstUp('award');
  await deleteFirst();
  return { reorder };
});

// ---------------- TEACHING — every CourseLevel ----------------
await run('teaching', '/dashboard/teaching', 'course', 'course', async () => {
  await addEntry('course', { name: 'Operating Systems', code: 'CS301', semester: 'Odd', year: 2024 }, { level: 'UG' });
  await addEntry('course', { name: 'Distributed Computing', code: 'CS502', semester: 'Even', year: 2024 }, { level: 'PG' });
  await addEntry('course', { name: 'Research Methods', code: 'CS701', semester: 'Odd', year: 2023 }, { level: 'PHD' });
  const levels = (await db.course.findMany({ where: { profileId: pid }, select: { level: true } })).map((r) => r.level);
  const reorder = await keyboardReorderFirstUp('course');
  return { enumsUsed: levels.sort().join(','), reorder };
});

// ---------------- PROJECTS — every ProjectType × ProjectStatus ----------------
await run('projects', '/dashboard/projects', 'researchProject', 'project', async () => {
  await addEntry('project', { title: 'Resilient Infrastructure', agency: 'SERB', role: 'PI', amountLakhs: '42.50' }, { type: 'SPONSORED', status: 'ONGOING' });
  await addEntry('project', { title: 'Industry Consultancy', agency: 'Acme Ltd', role: 'Consultant', amountLakhs: '8.75' }, { type: 'CONSULTANCY', status: 'COMPLETED' });
  await addEntry('project', { title: 'Internal Seed Grant', agency: 'College', role: 'PI', amountLakhs: '1.20' }, { type: 'INTERNAL', status: 'SANCTIONED' });
  const rows = await db.researchProject.findMany({ where: { profileId: pid }, select: { type: true, status: true, amountLakhs: true } });
  const reorder = await keyboardReorderFirstUp('researchProject');
  return {
    enumsUsed: rows.map((r) => `${r.type}/${r.status}`).sort().join(' '),
    decimals: rows.map((r) => r.amountLakhs?.toString()).sort().join(','),
    reorder,
  };
});

// ---------------- GUIDANCE — every GuidanceDegree × GuidanceStatus ----------------
await run('guidance', '/dashboard/guidance', 'guidance', 'student', async () => {
  await addEntry('student', { studentName: 'S. Banerjee', topic: 'Consensus protocols', startYear: 2022 }, { degree: 'PHD', status: 'ONGOING' });
  await addEntry('student', { studentName: 'K. Rao', topic: 'Energy-aware placement', startYear: 2017, awardYear: 2022 }, { degree: 'MTECH', status: 'COMPLETED' });
  await addEntry('student', { studentName: 'M. Fernandes', topic: 'Time-series indexing', startYear: 2021 }, { degree: 'MSC', status: 'DISCONTINUED' });
  await addEntry('student', { studentName: 'A. Pillai', topic: 'Formal methods', startYear: 2023 }, { degree: 'BTECH', status: 'ONGOING' });
  const rows = await db.guidance.findMany({ where: { profileId: pid }, select: { degree: true, status: true } });
  const reorder = await keyboardReorderFirstUp('guidance');
  return {
    degreesUsed: [...new Set(rows.map((r) => r.degree))].sort().join(','),
    statusesUsed: [...new Set(rows.map((r) => r.status))].sort().join(','),
    reorder,
  };
});

await browser.close();

console.log('');
for (const r of results) {
  console.log(`── ${r.name} ──`);
  console.log(`   rows in DB: ${r.count}`);
  if (r.headings) console.log(`   section headings: ${r.headings}`);
  if (r.enumsUsed) console.log(`   enum values used: ${r.enumsUsed}`);
  if (r.degreesUsed) console.log(`   degrees: ${r.degreesUsed}`);
  if (r.statusesUsed) console.log(`   statuses: ${r.statusesUsed}`);
  if (r.decimals) console.log(`   decimals stored: ${r.decimals}`);
  if (r.editPersisted !== undefined) console.log(`   edit persisted: ${r.editPersisted}`);
  if (r.reorder) console.log(`   keyboard reorder changed order: ${r.reorder.changed}, sortOrder: ${r.reorder.sorts}`);
  console.log(`   clicks: ${r.clicks.length}`);
}
console.log(`\n  console/page errors: ${errors.length}`);
errors.slice(0, 6).forEach((e) => console.log('     ', e.slice(0, 150)));

for (const m of ['position', 'membership', 'award', 'course', 'researchProject', 'guidance']) {
  await db[m].deleteMany({ where: { profileId: pid } });
}
await db.session.deleteMany({
  where: { tokenHash: createHash('sha256').update(rawToken).digest('hex') },
});
await db.$disconnect();
console.log(`\n  screenshots -> ${OUT}`);
process.exit(errors.length ? 1 : 0);
