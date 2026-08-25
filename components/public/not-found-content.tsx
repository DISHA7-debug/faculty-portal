import Link from 'next/link';

/**
 * The 404 body — no header, no footer, so it can be dropped into either shell that needs
 * one (see the two `not-found.tsx` files that use it).
 *
 * ── Two files render this, and why there are two ────────────────────────────────────────
 *
 * `app/(public)/not-found.tsx` covers every `notFound()` call inside the public route
 * tree — an unpublished/nonexistent faculty slug, a department that doesn't exist. It is
 * nested inside `app/(public)/layout.tsx`, which already supplies `<SiteHeader>` and
 * `<SiteFooter>`, so it renders just this component.
 *
 * `app/not-found.tsx` (root) catches everything ELSE — a URL that doesn't match any route
 * at all, e.g. a typo at the top level. Nothing above the root layout provides header or
 * footer, so that file wraps this same component in its own copy of the shell. Splitting
 * the CONTENT out here means both paths show identical wording and design; only the
 * surrounding chrome differs, and only because it structurally has to.
 *
 * A search box, not just links: someone who mistyped a name is one keystroke from finding
 * the person they were actually looking for, and a 404 that only offers "go home" makes
 * them start over from scratch.
 */
export function NotFoundContent() {
  return (
    <main className="px-gutter py-20 sm:py-28">
      <div className="mx-auto max-w-[52ch]">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
          404
        </p>
        <h1 className="mt-4 font-display text-[clamp(2.1rem,6vw,3.2rem)] leading-[1.08] tracking-[-0.02em] text-balance">
          We couldn&rsquo;t find that page.
        </h1>
        <p className="mt-5 text-[1rem] leading-[1.7] text-muted-foreground">
          The address may be mistyped, or it may point to a profile that hasn&rsquo;t been
          published — a page that once existed here can look identical to one that never
          did, which is deliberate: it isn&rsquo;t this page&rsquo;s business to say which.
        </p>

        <form method="get" action="/faculty" role="search" className="mt-8">
          <label htmlFor="nf-q" className="sr-only">
            Search the faculty directory
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="nf-q"
              name="q"
              type="search"
              placeholder="Search by name or research area…"
              className="min-h-11 flex-1 rounded-md border border-input bg-surface-raised px-3.5 text-[0.95rem] outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="submit"
              className="min-h-11 shrink-0 rounded-md bg-primary px-5 text-[0.9rem] text-primary-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Search
            </button>
          </div>
        </form>

        <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[0.9rem]">
          <Link
            href="/faculty"
            className="inline-block py-1 underline decoration-hairline underline-offset-4 transition-colors hover:decoration-current focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Browse the directory
          </Link>
          <Link
            href="/"
            className="inline-block py-1 underline decoration-hairline underline-offset-4 transition-colors hover:decoration-current focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Go to the homepage
          </Link>
        </div>
      </div>
    </main>
  );
}
