import type { Metadata } from 'next';
import Image from 'next/image';
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
      <section className="relative flex min-h-[calc(100vh-4.5rem)] flex-col items-center justify-center overflow-hidden border-b border-hairline px-gutter py-8 sm:py-12">
        <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-col items-center text-center">
          <h1 className="max-w-3xl text-balance text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.1] tracking-tight text-foreground">
            The brilliant minds who <em className="font-serif italic text-primary">inspire</em> and <em className="font-serif italic text-primary">innovate</em> here.
          </h1>

          <div className="mt-6 sm:mt-8 flex flex-col items-center gap-3">
            <div className="inline-flex items-center gap-2.5 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-[0.875rem] font-semibold text-primary">
              <span className="flex size-2 rounded-full bg-primary" />
              <span>Dedicated Faculty URL:</span>
              <code className="font-mono text-[0.8rem] font-semibold bg-primary text-primary-foreground px-2 py-0.5 rounded">
                /faculty/your-name
              </code>
            </div>
            <p className="max-w-xl text-[0.95rem] sm:text-[1.05rem] leading-relaxed text-muted-foreground">
              Search our faculty directory or sign in to claim and customize your dedicated profile link.
            </p>
          </div>

          <form method="get" action="/faculty" role="search" className="mt-8 w-full max-w-2xl relative">
            <label htmlFor="home-q" className="sr-only">
              Search faculty by name or research area
            </label>
            <div className="relative flex items-center">
              <svg
                className="absolute left-4 w-5 h-5 text-muted-foreground/60 pointer-events-none z-10"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth="2"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                id="home-q"
                name="q"
                type="search"
                placeholder="Search by name, discipline, or department..."
                className="h-14 w-full rounded-full border border-border bg-surface-raised pl-12 pr-32 text-[0.95rem] outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary shadow-xs"
              />
              <div className="absolute right-1.5 top-1.5 bottom-1.5">
                <button
                  type="submit"
                  className="h-full rounded-full bg-primary px-6 text-[0.875rem] font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                >
                  Search
                </button>
              </div>
            </div>
          </form>

          {/* Search Suggestions */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-[0.8rem]">
            <span className="mr-1 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">Try:</span>
            <span className="rounded-full border border-hairline bg-surface-sunken px-3 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground">Machine Learning</span>
            <span className="rounded-full border border-hairline bg-surface-sunken px-3 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground">Molecular Biology</span>
            <span className="rounded-full border border-hairline bg-surface-sunken px-3 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground">Comparative Literature</span>
          </div>

          {/* Directory Stats & Claim URL CTA */}
          <div className="mt-6 sm:mt-8 flex flex-col items-center gap-2.5">
            <div className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground/70">
              {total} SCHOLARS &nbsp;&bull;&nbsp; {departments.length} DEPARTMENTS
            </div>
            
            <Link 
              href="/login" 
              className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-5 py-2 text-[0.875rem] font-medium text-primary transition-all hover:bg-primary/20 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span>Faculty member? Claim your unique profile URL</span>
              <span aria-hidden="true">&rarr;</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Departments ───────────────────────────────────────────────────────────── */}
      <section
        id="departments"
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
                  className="flex items-center justify-between gap-4 rounded-xl border border-hairline bg-surface-raised px-6 py-5 transition-all duration-300 hover:border-border/60 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <span className="font-mono text-[0.65rem] font-semibold tracking-wider text-primary bg-primary/5 px-2.5 py-1 rounded-md shrink-0">
                      {d.code}
                    </span>
                    <span className="font-display text-[1.15rem] text-foreground truncate">
                      {d.name}
                    </span>
                  </div>
                  <span className="font-mono text-[0.75rem] tabular-nums text-muted-foreground shrink-0 bg-surface-sunken px-3 py-1 rounded-md">
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
