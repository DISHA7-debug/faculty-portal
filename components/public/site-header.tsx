import Link from 'next/link';
import { Button } from '@/components/ui/button';

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
    <header className="sticky top-0 z-50 border-b border-hairline bg-background/70 backdrop-blur-lg">
      <div className="px-gutter">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 py-4">
          <Link
            href="/"
            className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Faculty Portal
          </Link>

          <nav aria-label="Site" className="flex items-center gap-2">
            <Link
              href="/faculty"
              className="rounded-md px-3 py-2 text-[0.85rem] transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Directory
            </Link>
            <Button asChild variant="default" size="sm">
              <Link href="/login">
                Faculty sign in
              </Link>
            </Button>
          </nav>
        </div>
      </div>
    </header>
  );
}
