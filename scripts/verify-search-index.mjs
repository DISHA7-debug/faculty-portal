#!/usr/bin/env node
/**
 * Confirms the directory search actually uses the GIN index on `searchVector` — and is
 * honest about when it does and doesn't.
 *
 * At the current seed size (~20 rows) Postgres's planner will almost always choose a
 * sequential scan over the GIN index, and CORRECTLY so: a seq scan over twenty rows is a
 * handful of microseconds, cheaper than an index lookup's overhead. That is not a bug and
 * not evidence the index is unused — it is the planner doing its job. Proving the index
 * works means proving three separate things:
 *
 *   1. It exists and is valid.
 *   2. The planner WILL choose it once a seq scan is no longer cheaper (forced via
 *      `enable_seqscan = off`, inside a transaction so nothing outside this script is
 *      affected).
 *   3. At a size closer to the documented target (500+ faculty, CLAUDE.md §1), the
 *      planner's OWN choice — not forced — actually uses it.
 *
 * Everything in step 3 runs inside a transaction that is rolled back at the end. No
 * synthetic row survives this script.
 */
import { Prisma } from '@prisma/client';

import { db } from '../lib/db.ts';

function printPlan(rows) {
  for (const r of rows) console.log('   ', r['QUERY PLAN']);
}

function usesIndex(rows) {
  return rows.some((r) => /Index Scan|Bitmap Index Scan/i.test(r['QUERY PLAN']));
}

/** Specifically the GIN index on searchVector, not just any index. */
function usesSearchVectorIndex(rows) {
  return rows.some((r) => /searchVector/i.test(r['QUERY PLAN']) && /Index/i.test(r['QUERY PLAN']));
}

const searchQuery = (term) => Prisma.sql`
  EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
  SELECT p.id FROM "Profile" p
  JOIN "User" u ON u.id = p."userId"
  WHERE p."isPublished" = true AND u."status" = 'ACTIVE'::"AccountStatus"
    AND p."searchVector" @@ websearch_to_tsquery('english', ${term})
  ORDER BY ts_rank(p."searchVector", websearch_to_tsquery('english', ${term})) DESC, p."fullName" ASC
  LIMIT 24 OFFSET 0
`;

/* ── 1. the index exists ──────────────────────────────────────────────────────────────── */

console.log('\n── 1. Index exists ──\n');
const indexes = await db.$queryRaw`
  SELECT indexname, indexdef FROM pg_indexes
  WHERE tablename = 'Profile' AND indexdef ILIKE '%gin%'
`;
if (indexes.length === 0) {
  console.error('  NO GIN INDEX FOUND on Profile. This is a real problem.');
  process.exit(1);
}
for (const idx of indexes) console.log(`   ${idx.indexname}\n     ${idx.indexdef}`);

/* ── 2. at current seed size, honest baseline ─────────────────────────────────────────── */

console.log('\n── 2. Current seed size — planner\'s own (unforced) choice ──\n');
const count = await db.$queryRaw`SELECT count(*)::int AS n FROM "Profile"`;
console.log(`   ${count[0].n} profiles in the table right now.\n`);
const baseline = await db.$queryRaw(searchQuery('machine learning'));
printPlan(baseline);
console.log(
  `\n   -> ${usesIndex(baseline) ? 'used the index' : 'chose a sequential scan'} — ` +
    (usesIndex(baseline)
      ? 'index used even at this size.'
      : 'expected at ~20 rows: a seq scan over twenty rows is cheaper than an index ' +
        'lookup, and the planner is right to prefer it.'),
);

/* ── 3. forced: proves the index is valid and selectable ─────────────────────────────── */

console.log('\n── 3. Forced (enable_seqscan = off) — proves the index CAN be used ──\n');
await db.$executeRaw`BEGIN`;
try {
  await db.$executeRaw`SET LOCAL enable_seqscan = off`;
  const forced = await db.$queryRaw(searchQuery('machine learning'));
  printPlan(forced);
  // At this row count Postgres may satisfy `enable_seqscan = off` via a DIFFERENT, smaller
  // index (e.g. the isPublished/fullName b-tree) rather than the GIN one, simply because
  // it is even cheaper on a twenty-row table — that still proves "an index path exists and
  // works", just not specifically the GIN path. Reported honestly either way; step 4 is
  // the one that isolates the GIN index specifically, by making it the clearly best choice.
  if (usesSearchVectorIndex(forced)) {
    console.log('\n   -> GIN index on searchVector confirmed usable.');
  } else if (usesIndex(forced)) {
    console.log(
      '\n   -> an index path is usable, but the planner preferred a DIFFERENT (smaller)\n' +
        '      index over the GIN one at this row count — expected, not a problem. Step 4\n' +
        '      isolates the GIN index specifically.',
    );
  } else {
    console.log('\n   -> STILL no index at all — the GIN index itself may be broken.');
    process.exitCode = 1;
  }
} finally {
  await db.$executeRaw`ROLLBACK`;
}

/* ── 4. at documented production scale, unforced ──────────────────────────────────────── */

const TARGET = 5000;
console.log(`\n── 4. At ${TARGET.toLocaleString()} profiles — planner's own choice, no forcing ──\n`);
console.log('   Inserting synthetic rows inside a transaction that gets rolled back...');

await db.$executeRaw`BEGIN`;
let crossoverRows = null;
try {
  const dept = await db.$queryRaw`SELECT id FROM "Department" LIMIT 1`;
  if (dept.length === 0) throw new Error('No department to attach synthetic rows to.');
  const deptId = dept[0].id;

  // Two-statement writable CTE — a data-modifying statement (the User insert) cannot sit
  // inside a JOIN LATERAL, only inside a WITH clause feeding a second insert. Each row gets
  // a distinct email/slug (both unique) and realistic-ish text so the tsvector isn't blank;
  // the BEFORE INSERT trigger from the search_vector migration populates searchVector
  // automatically — nothing here does that by hand.
  await db.$executeRaw`
    WITH new_users AS (
      INSERT INTO "User" (id, email, role, status, "createdAt", "updatedAt")
      SELECT
        'synth_user_' || gs::text,
        'synthetic.' || gs::text || '@bench.invalid',
        'FACULTY'::"Role",
        'ACTIVE'::"AccountStatus",
        now(),
        now()
      FROM generate_series(1, ${TARGET}) AS gs
      RETURNING id, (regexp_replace(id, '^synth_user_', ''))::int AS gs
    )
    INSERT INTO "Profile" (
      id, "userId", "departmentId", "fullName", slug, designation, about,
      "researchInterests", "isPublished", "completeness", "viewCount",
      "createdAt", "updatedAt"
    )
    SELECT
      'synthetic_' || nu.gs::text,
      nu.id,
      ${deptId},
      'Synthetic Faculty ' || nu.gs::text,
      'synthetic-faculty-' || nu.gs::text,
      (ARRAY['Professor','Associate Professor','Assistant Professor'])[1 + (nu.gs % 3)],
      'Research in ' || (ARRAY[
        'computational biology and genomics',
        'renewable energy systems',
        'urban transportation planning',
        'materials science for aerospace',
        'natural language processing'
      ])[1 + (nu.gs % 5)] || '.',
      ARRAY[(ARRAY['Robotics','Genomics','Photonics','Economics','Linguistics'])[1 + (nu.gs % 5)]],
      true,
      50,
      0,
      now(),
      now()
    FROM new_users nu
  `;

  // A handful of NEEDLE rows with a distinctive phrase found nowhere else. This is the
  // realistic case a directory search actually serves — "find the one or two people who
  // work on X" — and it is also the case that makes a GIN index worth its overhead. The
  // five generic phrases above each match ~20% of 5,000 rows; an earlier version of this
  // script searched one of THOSE and reported the index "confirmed" — it wasn't, the
  // planner correctly chose a seq scan for a query matching a fifth of the table, and the
  // check only looked like a pass because `usesIndex()` had matched the UNRELATED
  // `User_pkey` join elsewhere in the same plan. That is the same shape of false-positive
  // flagged elsewhere in this codebase (the GPSLatitudeRef check, docs/SPRINTS.md): a
  // check that cannot fail is not a check.
  const NEEDLE_COUNT = 5;
  await db.$executeRaw`
    WITH new_users AS (
      INSERT INTO "User" (id, email, role, status, "createdAt", "updatedAt")
      SELECT
        'synth_needle_user_' || gs::text,
        'synthetic.needle.' || gs::text || '@bench.invalid',
        'FACULTY'::"Role",
        'ACTIVE'::"AccountStatus",
        now(),
        now()
      FROM generate_series(1, ${NEEDLE_COUNT}) AS gs
      RETURNING id, (regexp_replace(id, '^synth_needle_user_', ''))::int AS gs
    )
    INSERT INTO "Profile" (
      id, "userId", "departmentId", "fullName", slug, designation, about,
      "researchInterests", "isPublished", "completeness", "viewCount",
      "createdAt", "updatedAt"
    )
    SELECT
      'synthetic_needle_' || nu.gs::text,
      nu.id,
      ${deptId},
      'Needle Faculty ' || nu.gs::text,
      'synthetic-needle-faculty-' || nu.gs::text,
      'Professor',
      'Research in photoacoustic xenobiotic tomography.',
      ARRAY['Photoacoustic Xenobiotic Tomography'],
      true,
      50,
      0,
      now(),
      now()
    FROM new_users nu
  `;

  const newCount = await db.$queryRaw`SELECT count(*)::int AS n FROM "Profile"`;
  console.log(
    `   ${newCount[0].n} profiles now present (inside the transaction only) — ` +
      `${NEEDLE_COUNT} of them the only ones matching the search term below.`,
  );

  // Without this, the planner costs the query against whatever row count the last REAL
  // ANALYZE saw — the original ~20-row table — because autovacuum has had no chance to run
  // on data that has existed for milliseconds inside an open, uncommitted transaction. It
  // then has no idea the table just grew 250x and keeps costing a seq scan as if it still
  // only had to skip twenty rows. ANALYZE is transaction-scoped like everything else here
  // and vanishes on the ROLLBACK below, same as the data it describes.
  await db.$executeRaw`ANALYZE "Profile"`;
  await db.$executeRaw`ANALYZE "User"`;

  // GIN indexes default to `fastupdate = on`: a bulk INSERT lands in an unsorted PENDING
  // LIST first rather than the main index structure, and any scan using the index must
  // also walk that list — so immediately after a large insert, the GIN index offers no
  // advantage over a seq scan until the pending list is flushed. Normally autovacuum does
  // this in the background; there is no "background" inside one open transaction, so it is
  // flushed explicitly. This is a real operational fact about the index, not a workaround
  // for this script — the same lag applies in production after a burst of real signups,
  // which is exactly why `deploy/backup.sh`-adjacent maintenance should not assume a GIN
  // index is instantly optimal the moment rows land.
  await db.$executeRaw`SELECT gin_clean_pending_list('"Profile_searchVector_idx"')`;
  console.log('   ANALYZE run and the GIN pending list flushed, so the planner sees reality.\n');

  // "genomics" was tried first and matched ~1,000 of 5,000 rows (~20%) — a seq scan
  // correctly won, and reporting that as "confirmed" would have been the exact vacuous
  // pass this whole script exists to avoid; `usesIndex()` had even matched on the
  // UNRELATED User_pkey join in that plan, not on searchVector at all. "xenobiotic" is
  // the honest test: distinctive, present in exactly 5 of 5,020 rows (0.1%).
  const atScale = await db.$queryRaw(searchQuery('xenobiotic'));
  printPlan(atScale);
  crossoverRows = usesSearchVectorIndex(atScale);
  console.log(
    `\n   -> ${crossoverRows ? 'GIN INDEX SCAN on searchVector — the planner switched on its own.' : 'still a seq scan even for a selective term at this size.'}`,
  );
} finally {
  await db.$executeRaw`ROLLBACK`;
  const after = await db.$queryRaw`SELECT count(*)::int AS n FROM "Profile"`;
  console.log(`\n   Rolled back. ${after[0].n} profiles remain (back to the real count).`);
}

console.log('\n' + '─'.repeat(70));
console.log(
  crossoverRows === true
    ? `RESULT: confirmed — the GIN index is used by the planner's own cost estimate at ${TARGET.toLocaleString()} rows.`
    : `RESULT: index is valid and usable (step 3), but the planner still preferred a seq\n` +
      `scan at ${TARGET.toLocaleString()} rows for this term's selectivity. Not a defect — see the note in the report.`,
);
console.log('─'.repeat(70) + '\n');

await db.$disconnect();
