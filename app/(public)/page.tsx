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
      <section className="relative flex min-h-hero flex-col items-center justify-center overflow-hidden border-b border-hairline px-gutter py-[3dvh] sm:py-[4dvh]">
        <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-col items-center text-center">
          <div className="mb-[2dvh] inline-flex items-center gap-2 rounded-full border border-hairline bg-surface-sunken px-3 py-1.5 font-mono text-[0.7rem] uppercase tracking-[0.15em] text-muted-foreground">
            <span className="flex size-1.5 rounded-full bg-primary" />
            Official Directory
          </div>

          <h1 className="max-w-[20ch] text-balance font-display text-[clamp(2.6rem,8vw,4.6rem)] leading-[0.95] tracking-[-0.02em] text-foreground">
            The brilliant minds who <em className="pr-1 font-serif italic text-primary">inspire</em> and <em className="pr-1 font-serif italic text-primary">innovate</em> here.
          </h1>

          <p className="mt-[2dvh] max-w-[50ch] text-balance text-[0.95rem] leading-[1.5] text-muted-foreground sm:text-[1rem]">
            Search the full faculty by name, department, or research focus. A single register for every scholar.
          </p>

          <form method="get" action="/faculty" role="search" className="mt-[3dvh] w-full max-w-2xl relative">
            <label htmlFor="home-q" className="sr-only">
              Search faculty by name or research area
            </label>
            <div className="relative flex items-center">
              <svg
                className="absolute left-5 size-5 text-muted-foreground/60"
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
                className="h-14 w-full rounded-full border border-border bg-surface-raised pl-13 pr-32 text-[1rem] outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary"
              />
              <div className="absolute right-1.5 top-1.5 bottom-1.5">
                <button
                  type="submit"
                  className="h-full rounded-full bg-primary px-6 text-[0.9rem] font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                >
                  Search
                </button>
              </div>
            </div>
          </form>

          <div className="mt-[1.5dvh] flex flex-wrap items-center justify-center gap-2 text-[0.8rem]">
            <span className="mr-2 font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted-foreground">Try:</span>
            <span className="rounded-full border border-hairline bg-surface-sunken px-3 py-1 text-muted-foreground transition-colors hover:text-foreground">Machine Learning</span>
            <span className="rounded-full border border-hairline bg-surface-sunken px-3 py-1 text-muted-foreground transition-colors hover:text-foreground">Molecular Biology</span>
            <span className="rounded-full border border-hairline bg-surface-sunken px-3 py-1 text-muted-foreground transition-colors hover:text-foreground">Comparative Literature</span>
          </div>


          <div className="mt-[4dvh] flex flex-col items-center">
            <div className="font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground/70">
              {total} SCHOLARS &nbsp;&bull;&nbsp; {departments.length} DEPARTMENTS
            </div>
            
            <Link 
              href="/login" 
              className="mt-8 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-5 py-2.5 text-[0.85rem] font-medium text-primary transition-colors hover:bg-primary/20 hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span>Faculty member? Sign in to manage your profile</span>
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
