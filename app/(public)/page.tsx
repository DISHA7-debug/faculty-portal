import type { Metadata } from 'next';
import Link from 'next/link';

import { FacultyGrid } from '@/components/public/faculty-grid';
import { countVisibleFaculty, listDepartments, listFaculty } from '@/lib/directory';

/**
 * Landing page.
 *
 * Replaces the Sprint 1 placeholder, which was still telling visitors that "authentication
 * arrives in Sprint 2" — a scaffold left facing the public long after it stopped being
 * true. It was also three shadcn cards, which is the card-soup the design direction
 * explicitly rejects (CLAUDE.md §7).
 *
 * Static. The one interactive element is a GET form pointing at `/faculty`, so the front
 * door needs no JavaScript and no per-request rendering: the search itself happens on the
 * directory route, which is dynamic anyway.
 */

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Faculty Portal',
  description:
    'Academic profiles, research interests, and publications of the faculty. Search by name or research area.',
  alternates: { canonical: '/' },
};

export default async function Home() {
  const [total, departments, recent] = await Promise.all([
    countVisibleFaculty(),
    listDepartments(),
    // Six people, so the page shows what a profile IS rather than describing it. Ordered by
    // name for stability: a "recently updated" row would reshuffle the front page every
    // time somebody fixed a typo.
    listFaculty({ page: 1 }).then((r) => r.entries.slice(0, 6)),
  ]);

  return (
    <main>
      {/* ── Hero ──────────────────────────────────────────────────────────────────── */}
      <section className="border-b border-hairline px-gutter py-16 sm:py-24">
        <div className="mx-auto max-w-5xl">
          <h1 className="max-w-[16ch] font-display text-[clamp(2.6rem,8vw,4.6rem)] leading-[1.02] tracking-[-0.025em] text-balance">
            The people who teach and research here.
          </h1>

          <p className="measure mt-6 text-[1.1rem] leading-[1.7] text-muted-foreground">
            {total} faculty profiles across {departments.length} departments — each one
            written, maintained, and published by the person it describes.
          </p>

          {/* Points at /faculty, so it works without JavaScript and the query lands in a
              shareable URL rather than in component state. */}
          <form method="get" action="/faculty" role="search" className="mt-10 max-w-xl">
            <label htmlFor="home-q" className="sr-only">
              Search faculty by name or research area
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                id="home-q"
                name="q"
                type="search"
                placeholder="Machine learning, VLSI, heat transfer…"
                className="min-h-12 flex-1 rounded-md border border-input bg-surface-raised px-4 text-[1rem] outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button
                type="submit"
                className="min-h-12 shrink-0 rounded-md bg-primary px-6 text-[0.95rem] text-primary-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                Search
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* ── Departments ───────────────────────────────────────────────────────────── */}
      <section
        aria-labelledby="departments-heading"
        className="border-b border-hairline px-gutter py-14 sm:py-20"
      >
        <div className="mx-auto max-w-5xl">
          <h2
            id="departments-heading"
            className="font-display text-[1.75rem] leading-tight tracking-[-0.01em]"
          >
            Departments
          </h2>

          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {departments.map((d) => (
              <li key={d.slug}>
                <Link
                  href={`/departments/${d.slug}`}
                  className="flex items-baseline justify-between gap-4 rounded-lg border border-hairline bg-surface-raised px-5 py-4 transition-colors hover:border-border hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <span className="min-w-0">
                    <span className="block text-[1rem] leading-snug text-balance">
                      {d.name}
                    </span>
                    <span className="mt-0.5 block font-mono text-[0.68rem] uppercase tracking-[0.14em] text-muted-foreground">
                      {d.code}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[0.8rem] tabular-nums text-muted-foreground">
                    {/* The same count the department page will show — one definition of
                        "visible", so the number cannot promise more than the listing. */}
                    {d.count}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── A few profiles ────────────────────────────────────────────────────────── */}
      {recent.length > 0 ? (
        <section aria-labelledby="faculty-heading" className="px-gutter py-14 sm:py-20">
          <div className="mx-auto max-w-5xl">
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <h2
                id="faculty-heading"
                className="font-display text-[1.75rem] leading-tight tracking-[-0.01em]"
              >
                Faculty
              </h2>
              <Link
                href="/faculty"
                className="inline-block py-1 text-[0.9rem] underline decoration-hairline underline-offset-4 transition-colors hover:decoration-current focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                See all {total} →
              </Link>
            </div>

            <div className="mt-8">
              <FacultyGrid entries={recent} />
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
