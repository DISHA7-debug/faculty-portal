#!/usr/bin/env node
/**
 * Drives the directory, department pages, and landing page in a real browser.
 *
 * The checks that matter here are behavioural, not visual: does search actually filter,
 * does a filter survive into the URL, does the thing work with JavaScript turned off, and
 * does a suspended account stay out of every listing.
 */
import { chromium } from 'playwright';

/**
 * `domcontentloaded` plus an explicit wait for the thing being asserted — never
 * `networkidle`.
 *
 * In a production build Next enables <Link> prefetching, so a page with a dozen links keeps
 * issuing background RSC requests as they enter the viewport. "No network activity for
 * 500ms" then never becomes true and every navigation times out after 30s. It passed under
 * `next dev` purely because dev disables prefetch — a test that only works against the dev
 * server is worse than no test.
 */
async function open(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('main').first().waitFor({ state: 'visible' });

  // Wait for the SKELETON to go, not just for a <main> to exist. /faculty is dynamic and
  // streams `loading.tsx` first, so `main` is visible while the page still shows twelve
  // grey boxes — measuring geometry there reported a 419px-wide document and four
  // undersized controls that do not exist in the finished page.
  await page.locator('main[aria-busy="true"]').waitFor({ state: 'detached' }).catch(() => {});

  // And for the display serif. Text laid out in the fallback face measures differently, so
  // a width assertion taken before the swap is measuring a page nobody sees.
  await page.evaluate(() => document.fonts.ready);
}

const BASE = process.argv[2] ?? 'http://localhost:3000';

let failures = 0;
function check(label, actual, ok, expected) {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(50)} ${String(actual).padEnd(26)} ${expected ?? ''}`);
}

const browser = await chromium.launch();
const cards = (page) => page.locator('main ul li a[href^="/faculty/"]');

/* ── landing ───────────────────────────────────────────────────────────────────────── */

{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await open(page, BASE);
  console.log('\n══ landing ══\n');

  const stale = await page.getByText(/Sprint 1|arrives in Sprint/i).count();
  check('no leftover sprint scaffolding text', stale, stale === 0, '0');

  const deptLinks = await page.locator('a[href^="/departments/"]').count();
  check('department links present', deptLinks, deptLinks >= 4);

  // The hero search must reach the directory with the term in the URL.
  await page.fill('#home-q', 'heat transfer');
  await page.click('form[role="search"] button[type="submit"]');
  await page.waitForURL('**/faculty?*');
  const url = new URL(page.url());
  check('hero search lands on /faculty with ?q', url.pathname + '?' + url.searchParams, url.pathname === '/faculty' && url.searchParams.get('q') === 'heat transfer');
  const n = await cards(page).count();
  check('  …and it actually filtered', n, n === 1 && n > 0, '1');
  await ctx.close();
}

/* ── directory ─────────────────────────────────────────────────────────────────────── */

{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  console.log('\n══ directory ══\n');

  await open(page, `${BASE}/faculty`);
  const all = await cards(page).count();
  check('unfiltered listing renders cards', all, all === 13, '13');

  const names = await cards(page).locator('p').first().allInnerTexts().catch(() => []);
  void names;

  // Suspended / pending / draft must be absent from every listing, not just their own page.
  const html = await page.content();
  for (const [needle, who] of [
    ['stress-suspended', 'suspended account'],
    ['stress-pending', 'pending account'],
    ['stress-draft', 'unpublished draft'],
  ]) {
    check(`${who} absent from the directory`, html.includes(needle) ? 'PRESENT' : 'absent', !html.includes(needle), 'absent');
  }

  // Changing a select must submit and put the choice in the URL.
  await page.selectOption('#department', 'mechanical-engineering');
  await page.waitForURL((u) => u.searchParams.get('department') === 'mechanical-engineering');
  const filtered = await cards(page).count();
  check('select filters and updates the URL', filtered, filtered === 2, '2');

  // The URL is the thing people share, so it should carry the choice and nothing else.
  const params = [...new URL(page.url()).searchParams.keys()];
  check('URL carries only the chosen filter', params.join(',') || '(none)', params.join(',') === 'department', 'department');

  // Filters must be shareable — a cold load of the same URL gives the same result.
  const shared = await ctx.newPage();
  await open(shared, page.url());
  const sharedCount = await cards(shared).count();
  check('the filtered URL is shareable', sharedCount, sharedCount === filtered, String(filtered));
  await shared.close();

  // Changing a filter from page 2 must not strand you on an empty page.
  await open(page, `${BASE}/faculty?page=2`);
  await page.selectOption('#department', 'mathematics-computing');
  await page.waitForURL((u) => u.searchParams.get('department') === 'mathematics-computing');
  const afterRefilter = new URL(page.url()).searchParams.get('page');
  check('changing a filter resets to page 1', afterRefilter ?? '(absent)', afterRefilter === null, '(absent)');
  const refiltered = await cards(page).count();
  check('  …and shows results, not an empty page', refiltered, refiltered > 0);

  // Empty state.
  await open(page, `${BASE}/faculty?q=qwertyuiop`);
  const empty = await page.getByText(/Nothing matches/i).count();
  check('empty state explains itself', empty, empty === 1, '1');
  const clear = await page.locator('a[href="/faculty"]').count();
  check('  …and offers a way out', clear, clear > 0);

  // Hostile search input must not 500.
  for (const bad of ["' OR 1=1 --", '& | ! ( )', '"unclosed', ':*', '<script>alert(1)</script>']) {
    const res = await page.goto(`${BASE}/faculty?q=${encodeURIComponent(bad)}`, { waitUntil: 'domcontentloaded' });
    const reflected = (await page.content()).includes('<script>alert(1)</script>');
    check(`hostile query ${JSON.stringify(bad).slice(0, 22)}`, `${res.status()}${reflected ? ' REFLECTED' : ''}`, res.status() === 200 && !reflected, '200');
  }

  await ctx.close();
}

/* ── department page ───────────────────────────────────────────────────────────────── */

{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  console.log('\n══ department ══\n');

  await open(page, `${BASE}/departments/computer-science-engineering`);
  const shown = await cards(page).count();
  const stated = Number((await page.locator('main p').filter({ hasText: /profiles?/ }).first().innerText()).match(/(\d+)/)?.[1] ?? -1);
  check('stated count equals the cards shown', `${stated} stated / ${shown} shown`, stated === shown);

  const footerCount = await page.locator('footer a[href="/departments/computer-science-engineering"] + span').innerText();
  check('footer count agrees with the page', `${footerCount.trim()} / ${shown}`, Number(footerCount.trim()) === shown);

  const res = await page.goto(`${BASE}/departments/not-a-department`, { waitUntil: 'domcontentloaded' });
  check('unknown department 404s', res.status(), res.status() === 404, '404');
  await ctx.close();
}

/* ── no JavaScript ─────────────────────────────────────────────────────────────────── */

{
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  console.log('\n══ JavaScript disabled ══\n');

  await page.goto(`${BASE}/faculty`, { waitUntil: 'domcontentloaded' });
  const noJsCards = await cards(page).count();
  check('directory renders without JS', noJsCards, noJsCards === 13, '13');

  // COUNTING IS NOT SEEING. The check above passed while every card was at opacity 0,
  // because a Playwright locator counts elements in the DOM whether or not a human could
  // read them. Framer Motion server-renders `initial`, so a reveal animation had made the
  // entire no-JS directory blank and a green test said otherwise.
  const invisible = await page.evaluate(
    () =>
      [...document.querySelectorAll('main ul li')].filter((el) => {
        const s = getComputedStyle(el);
        return Number(s.opacity) < 0.1 || s.visibility === 'hidden' || s.display === 'none';
      }).length,
  );
  check('  …and the cards are actually VISIBLE', invisible, invisible === 0, '0 invisible');

  await page.fill('#q', 'VLSI');
  await page.click('form[role="search"] button[type="submit"]');
  await page.waitForURL('**/faculty?*');
  const noJsFiltered = await cards(page).count();
  check('search works without JS (real GET form)', noJsFiltered, noJsFiltered === 1, '1');

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const landing = await page.locator('a[href^="/departments/"]').count();
  check('landing renders without JS', landing, landing >= 4);

  const landingInvisible = await page.evaluate(
    () =>
      [...document.querySelectorAll('main ul li')].filter(
        (el) => Number(getComputedStyle(el).opacity) < 0.1,
      ).length,
  );
  check('  …with nothing hidden behind an animation', landingInvisible, landingInvisible === 0, '0');
  await ctx.close();
}

/* ── layout at 360 ─────────────────────────────────────────────────────────────────── */

{
  console.log('\n══ 360px ══\n');
  for (const url of ['/', '/faculty', '/departments/computer-science-engineering']) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 } });
    const page = await ctx.newPage();
    await open(page, `${BASE}${url}`);
    const { scrollW, clientW } = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    check(`${url} does not scroll sideways`, `${scrollW} <= ${clientW}`, scrollW <= clientW + 1);

    const small = await page.evaluate(() =>
      [...document.querySelectorAll('main a, main button, main select, main input')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.height < 24;
      }).length,
    );
    check(`${url} controls >= 24px tall`, small, small === 0);
    await ctx.close();
  }
}

await browser.close();
console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
