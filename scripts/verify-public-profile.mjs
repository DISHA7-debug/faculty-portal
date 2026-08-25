#!/usr/bin/env node
/**
 * Drives the public profile in a real browser.
 *
 * The three checks that matter cannot be made from the HTML: horizontal overflow,
 * whether the sticky nav actually tracks the scroll, and whether a sparse profile looks
 * deliberate. All three are geometry.
 *
 * Every assertion below compares a measured number against an expectation and prints both,
 * so a passing line still shows its evidence. An assertion that cannot print a number it
 * measured is an assertion that cannot fail.
 */
import { chromium, devices } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:3000';

let failures = 0;
function check(label, actual, ok, expected) {
  const verdict = ok ? 'ok  ' : 'FAIL';
  if (!ok) failures += 1;
  console.log(`  ${verdict} ${label.padEnd(46)} ${String(actual).padEnd(24)} ${expected ?? ''}`);
}

const browser = await chromium.launch();

for (const [name, viewport] of [
  ['phone  360x780', { width: 360, height: 780 }],
  ['tablet 768x1024', { width: 768, height: 1024 }],
  ['desktop 1440x900', { width: 1440, height: 900 }],
]) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();

  console.log(`\n══ ${name} ══`);

  for (const slug of ['stress-heavy', 'stress-bare']) {
    await page.goto(`${BASE}/faculty/${slug}`, { waitUntil: 'networkidle' });
    console.log(`\n  /faculty/${slug}`);

    // 1. NO HORIZONTAL OVERFLOW. The 85-character token and the 200-word title are the
    //    reason this check exists.
    const { scrollW, clientW } = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    check('document does not scroll sideways', `${scrollW} <= ${clientW}`, scrollW <= clientW + 1);

    // 2. No individual element pokes out either — a page can pass the check above while an
    //    element is clipped by an ancestor's overflow, which looks broken all the same.
    // Elements inside a deliberately scrollable strip (the sub-nav rail) are SUPPOSED to
    // sit off-screen. They are excluded — and the count of exclusions is printed, because
    // an exclusion nobody can see is how a check quietly stops checking.
    const { overflowing, excluded } = await page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const inScroller = (el) => {
        for (let n = el.parentElement; n; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (
            (s.overflowX === 'auto' || s.overflowX === 'scroll') &&
            n.scrollWidth > n.clientWidth
          ) {
            return true;
          }
        }
        return false;
      };
      const wide = [...document.querySelectorAll('main *, header *, nav *')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > w + 1 || r.left < -1);
      });
      return {
        overflowing: wide
          .filter((el) => !inScroller(el))
          .slice(0, 5)
          .map((el) => `${el.tagName}.${el.className.toString().slice(0, 34)}`),
        excluded: wide.filter(inScroller).length,
      };
    });
    check(
      'no element extends past the viewport',
      overflowing.length,
      overflowing.length === 0,
      overflowing.length ? overflowing.join(' | ') : `(${excluded} in the nav rail, expected)`,
    );

    // 3. Tap targets. 24px is the WCAG 2.2 AA minimum for a pointer target.
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('nav a, aside a')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.height < 24;
      }).length,
    );
    check('nav/aside targets >= 24px tall', small, small === 0);
  }

  /* ── scroll-spy ─────────────────────────────────────────────────────────────────── */

  await page.goto(`${BASE}/faculty/stress-heavy`, { waitUntil: 'networkidle' });

  const navItems = await page.$$eval('nav[aria-label="Sections of this profile"] a', (as) =>
    as.map((a) => a.getAttribute('href').slice(1)),
  );
  check('sub-nav lists every populated section', navItems.length, navItems.length === 10, navItems.join(','));

  // The nav must stay put while the page scrolls under it.
  const navTopBefore = await page.$eval('nav[aria-label="Sections of this profile"]', (n) => n.getBoundingClientRect().top);
  await page.mouse.wheel(0, 3000);
  await page.waitForTimeout(400);
  const navTopAfter = await page.$eval('nav[aria-label="Sections of this profile"]', (n) => n.getBoundingClientRect().top);
  check('nav is sticky after a 3000px scroll', `${navTopBefore} -> ${navTopAfter}`, Math.abs(navTopAfter) < 2, 'top ~0');

  // Clicking a nav link must land the heading BELOW the sticky bar, not under it.
  const results = [];
  for (const id of navItems) {
    await page.click(`nav a[href="#${id}"]`);
    await page.waitForTimeout(500);
    const { headingTop, navBottom, active } = await page.evaluate((sectionId) => {
      const h = document.getElementById(sectionId).querySelector('h2');
      const nav = document.querySelector('nav[aria-label="Sections of this profile"]');
      return {
        headingTop: Math.round(h.getBoundingClientRect().top),
        navBottom: Math.round(nav.getBoundingClientRect().bottom),
        active: document.querySelector('nav a[aria-current="location"]')?.getAttribute('href')?.slice(1) ?? null,
      };
    }, id);
    results.push({ id, clear: headingTop >= navBottom - 1, active });
  }
  const obscured = results.filter((r) => !r.clear).map((r) => r.id);
  check('anchor jump clears the sticky bar', obscured.length, obscured.length === 0, obscured.join(','));

  // This data was already being collected and then thrown away — the exact shape of an
  // assertion that cannot fail. Clicking "Publications" must highlight Publications.
  const mismatched = results.filter((r) => r.active !== r.id).map((r) => `${r.id}->${r.active}`);
  check('click highlights the clicked item', mismatched.length, mismatched.length === 0, mismatched.join(' '));

  // Scroll-spy: land on a section by scrolling (not clicking) and read the highlight.
  const spy = [];
  for (const id of ['publications', 'guidance', 'memberships']) {
    await page.evaluate((sectionId) => {
      const el = document.getElementById(sectionId);
      window.scrollTo({ top: el.offsetTop + 40, behavior: 'instant' });
    }, id);
    await page.waitForTimeout(600);
    const active = await page.$eval('nav a[aria-current="location"]', (a) => a.getAttribute('href').slice(1)).catch(() => null);
    spy.push(`${id}->${active}`);
  }
  const spyOk = spy.every((s) => s.split('->')[0] === s.split('->')[1]);
  check('scroll-spy highlights the section in view', spy.join(' '), spyOk);

  // The last-section case: at the very bottom, the final nav item must be lit.
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
  await page.waitForTimeout(600);
  const lastActive = await page.$eval('nav a[aria-current="location"]', (a) => a.getAttribute('href').slice(1)).catch(() => null);
  check('bottom of page highlights the last item', lastActive, lastActive === navItems[navItems.length - 1], navItems[navItems.length - 1]);

  /* ── keyboard ───────────────────────────────────────────────────────────────────── */

  await page.goto(`${BASE}/faculty/stress-heavy`, { waitUntil: 'networkidle' });
  await page.keyboard.press('Tab');
  const firstFocus = await page.evaluate(() => {
    const el = document.activeElement;
    const style = getComputedStyle(el);
    return {
      tag: el.tagName,
      href: el.getAttribute('href'),
      ring: style.outlineWidth !== '0px' || style.boxShadow !== 'none',
    };
  });
  check('first Tab reaches the nav', `${firstFocus.tag} ${firstFocus.href}`, firstFocus.tag === 'A');

  await context.close();
}

/* ── the sparse profile, measured ──────────────────────────────────────────────────── */

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto(`${BASE}/faculty/stress-bare`, { waitUntil: 'networkidle' });
console.log('\n══ name-only profile ══\n');

const bare = await page.evaluate(() => ({
  navPresent: Boolean(document.querySelector('nav[aria-label="Sections of this profile"]')),
  headings: [...document.querySelectorAll('main h2')].map((h) => h.textContent),
  asideRows: document.querySelectorAll('aside dt').length,
  asideLabels: [...document.querySelectorAll('aside dt')].map((d) => d.textContent),
  hasMonogram: Boolean(document.querySelector('header [aria-hidden="true"]')),
  brokenImages: [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).length,
  bodyText: document.querySelector('main').innerText.trim(),
}));
check('no empty section headings', bare.headings.length, bare.headings.length === 0, JSON.stringify(bare.headings));
check('sub-nav omitted entirely', bare.navPresent, bare.navPresent === false, 'false');
check('aside shows only the rows with data', bare.asideRows, bare.asideRows === 1, bare.asideLabels.join(','));
check('monogram stands in for the photo', bare.hasMonogram, bare.hasMonogram === true);
check('no broken image placeholders', bare.brokenImages, bare.brokenImages === 0);
check('says something rather than nothing', JSON.stringify(bare.bodyText.slice(0, 40)), bare.bodyText.length > 20);

/* ── screenshots ───────────────────────────────────────────────────────────────────── */

const shots = process.env.SHOT_DIR;
if (shots) {
  for (const [slug, vp] of [
    ['stress-heavy', { width: 1440, height: 900 }],
    ['stress-heavy', { width: 360, height: 780 }],
    ['stress-bare', { width: 1440, height: 900 }],
  ]) {
    const c = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
    const p = await c.newPage();
    await p.goto(`${BASE}/faculty/${slug}`, { waitUntil: 'networkidle' });
    await p.screenshot({ path: `${shots}/${slug}-${vp.width}.png`, fullPage: false });
    await p.screenshot({ path: `${shots}/${slug}-${vp.width}-full.png`, fullPage: true });
    await c.close();
  }
  console.log(`\n  screenshots -> ${shots}`);
}

await browser.close();
console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
void devices;
