import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * Header for every public page.
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

          <nav aria-label="Site" className="flex items-center gap-3">
            <Link
              href="/faculty"
              className="rounded-md px-3 py-2 text-[0.85rem] transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Directory
            </Link>
            <ThemeToggle />
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
