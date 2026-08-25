import type { Metadata } from 'next';

import { DirectoryFilters } from '@/components/public/directory-filters';
import {
  DirectoryEmpty,
  FacultyGrid,
  Pagination,
} from '@/components/public/faculty-grid';
import { directoryFacets, listFaculty } from '@/lib/directory';

/**
 * The faculty directory.
 *
 * ── This route is dynamic, and that is a decision, not an oversight ─────────────────────
 *
 * Every other public route is statically rendered. This one reads `searchParams`, so it is
 * server-rendered per request. The alternatives were both worse:
 *
 *   - Ship all 500 profiles to the browser and filter client-side. It moves the whole
 *     directory onto the visitor's phone before they see anything, and it throws away
 *     Postgres full-text ranking — the search would degrade to substring matching.
 *   - Enable Partial Prerendering to keep a static shell. It is experimental, and this is a
 *     production system for an institution that will not have a Next.js specialist on hand.
 *
 * The cost is bounded: one indexed query and one count against a GIN index, both on a
 * table of 500 rows. The pages that carry the LCP budget — landing and profiles — stay
 * static.
 *
 * ── There is deliberately NO loading.tsx here ───────────────────────────────────────────
 *
 * One was written and then removed. `loading.tsx` wraps the route in a Suspense boundary,
 * and React streams late-arriving Suspense content inside a hidden container that an inline
 * script moves into place. With JavaScript disabled that script never runs: the skeleton
 * stays up permanently, and the real listing — search box included — sits in the DOM
 * unreachable. Adding a loading state broke the no-JS path that the GET form in
 * `directory-filters.tsx` exists to provide.
 *
 * Blocking is the right trade here. The query is one indexed lookup plus a count over ~500
 * rows on an always-on VPS with a warm connection pool — single-digit milliseconds, so the
 * skeleton would essentially never be seen by anyone with JavaScript either.
 *
 * If this page ever does get slow, the fix is a faster query or harder pagination. Putting
 * the Suspense boundary back means accepting that the directory stops working without
 * JavaScript, which for a public institutional site is a real cost, not a technicality.
 */

export const metadata: Metadata = {
  title: 'Faculty directory',
  description:
    'Browse and search faculty by name, research interest, department, and designation.',
  alternates: { canonical: '/faculty' },
};

/** Only what the page understands. Anything else in the URL is ignored, not echoed. */
type Params = {
  q?: string;
  department?: string;
  designation?: string;
  page?: string;
};

export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;

  const q = params.q?.trim() ?? '';
  const department = params.department ?? '';
  const designation = params.designation ?? '';

  // `Number('abc')` is NaN and `Number('')` is 0, so both fall back to page 1 rather than
  // reaching the query as a NaN offset. `?page=-5` and `?page=1e9` are clamped by
  // listFaculty; an out-of-range page renders an empty grid, which is honest.
  const page = Math.max(1, Number(params.page) || 1);

  const [result, facets] = await Promise.all([
    listFaculty({ q, department, designation, page }),
    directoryFacets(),
  ]);

  const hasFilters = Boolean(q || department || designation);

  /** Preserves the current filters when changing page. */
  const hrefFor = (target: number) => {
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (department) next.set('department', department);
    if (designation) next.set('designation', designation);
    if (target > 1) next.set('page', String(target));
    const qs = next.toString();
    return qs ? `/faculty?${qs}` : '/faculty';
  };

  return (
    <main className="px-gutter py-12 sm:py-16">
      <div className="mx-auto max-w-5xl">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
          Directory
        </p>
        <h1 className="mt-4 font-display text-[clamp(2.2rem,6vw,3.2rem)] leading-[1.05] tracking-[-0.02em]">
          Faculty
        </h1>
        <p className="measure mt-4 text-[1rem] leading-relaxed text-muted-foreground">
          Search by name, research area, or department. Each profile is written and
          published by the person it describes.
        </p>

        <div className="mt-10">
          <DirectoryFilters
            q={q}
            department={department}
            designation={designation}
            departments={facets.departments}
            designations={facets.designations}
            total={result.total}
          />
        </div>

        <div className="mt-10">
          {result.entries.length > 0 ? (
            <FacultyGrid entries={result.entries} />
          ) : (
            <DirectoryEmpty q={q} hasFilters={hasFilters} />
          )}
        </div>

        <Pagination page={result.page} pageCount={result.pageCount} hrefFor={hrefFor} />
      </div>
    </main>
  );
}
