import Link from 'next/link';

/**
 * Header for every public page.
 *
 * Until now a visitor arriving at `/faculty/[slug]` from a search result had no way to
 * reach anything else — no directory, no department, no home. Search engines send people
 * to deep pages far more often than to a home page, so for most visitors that WAS the site.
 *
 * Deliberately not sticky: the profile page has its own sticky section rail, and two
 * stacked sticky bars eat a third of a phone screen and make the anchor-offset arithmetic
 * a guess.
 */
export function SiteHeader() {
  return (
    <header className="border-b border-hairline">
      <div className="px-gutter">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 py-4">
          <Link
            href="/"
            className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Faculty Portal
          </Link>

          <nav aria-label="Site" className="flex items-center gap-1">
            <Link
              href="/faculty"
              className="rounded-md px-3 py-2 text-[0.85rem] transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Directory
            </Link>
            <Link
              href="/login"
              className="rounded-md px-3 py-2 text-[0.85rem] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Faculty sign in
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
