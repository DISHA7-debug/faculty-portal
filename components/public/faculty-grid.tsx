import Link from 'next/link';

import { FacultyCard } from '@/components/public/faculty-card';
import type { DirectoryEntry } from '@/lib/directory';
import { getPublicUrl } from '@/lib/storage';

/**
 * The responsive grid. Shared by the directory and by department pages.
 *
 * A Server Component that resolves photo keys to URLs before handing entries to the client
 * card — so `lib/storage.ts` and its env vars stay on the server, and the card cannot be
 * the thing that hardcodes a bucket URL.
 */
export function FacultyGrid({ entries }: { entries: DirectoryEntry[] }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map((entry, index) => (
        <FacultyCard
          key={entry.id}
          entry={entry}
          photoUrl={entry.photoKey ? getPublicUrl(entry.photoKey) : null}
          index={index}
        />
      ))}
    </ul>
  );
}

/**
 * The four states every list needs (CLAUDE.md §6). Loading is handled by `loading.tsx`;
 * this covers empty, and the caller renders the grid when populated.
 *
 * The empty state says what to change, not just that there is nothing. "No results" leaves
 * a visitor to guess whether they mistyped, whether the filter is too narrow, or whether
 * the portal is broken.
 */
export function DirectoryEmpty({
  q,
  hasFilters,
}: {
  q: string;
  hasFilters: boolean;
}) {
  return (
    <div className="max-w-[52ch] rounded-lg border border-dashed border-border px-6 py-12">
      <p className="font-display text-[1.4rem] leading-tight">
        {q ? <>Nothing matches “{q}”.</> : <>Nothing matches these filters.</>}
      </p>
      <p className="mt-3 text-[0.9rem] leading-relaxed text-muted-foreground">
        Search covers names, research interests, designations, and biographies. Try a
        broader term — “systems” rather than “distributed systems infrastructure” — or
        {hasFilters ? ' remove a filter.' : ' check the spelling.'}
      </p>
      {hasFilters ? (
        <p className="mt-4 text-[0.9rem]">
          <Link
            href="/faculty"
            className="inline-block py-1 underline decoration-hairline underline-offset-4 transition-colors hover:decoration-current focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Clear all filters
          </Link>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Pagination as links.
 *
 * Prev/next plus a page count, not a numbered strip — with 500 faculty and 24 per page that
 * is 21 numbers, which is a worse control than two arrows and a position.
 *
 * `next/link`, which renders a real `<a href>` underneath — so each page stays a shareable,
 * bookmarkable, crawlable URL (how a directory gets indexed at all) AND navigates on the
 * client. An earlier version used a bare `<a>` on the theory that Link would cost the real
 * href; it does not.
 */
export function Pagination({
  page,
  pageCount,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
}) {
  if (pageCount <= 1) return null;

  const linkClass =
    'inline-flex min-h-11 items-center rounded-md border border-border px-4 text-[0.88rem] transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

  return (
    <nav
      aria-label="Directory pages"
      className="mt-12 flex items-center justify-between gap-4 border-t border-hairline pt-8"
    >
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} rel="prev" className={linkClass}>
          ← Previous
        </Link>
      ) : (
        // A disabled span rather than a greyed link: there is nothing to activate, so
        // there should be nothing focusable.
        <span aria-hidden="true" />
      )}

      <p className="font-mono text-[0.78rem] tabular-nums text-muted-foreground">
        Page {page} of {pageCount}
      </p>

      {page < pageCount ? (
        <Link href={hrefFor(page + 1)} rel="next" className={linkClass}>
          Next →
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
    </nav>
  );
}
