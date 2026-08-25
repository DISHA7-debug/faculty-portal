'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The right-hand rail of the dashboard split pane.
 *
 * Hides itself on `/dashboard/preview`, because that page IS the preview and rendering a
 * 22rem "preview" column beside a full-width public profile would squeeze the thing being
 * previewed into a shape no visitor will ever see — a preview that misrepresents the page
 * is worse than no preview.
 *
 * A client component purely to read the pathname. The layout that hosts it stays a Server
 * Component, so nothing else moves to the client.
 */
export function PreviewRail({ isPublished, slug }: { isPublished: boolean; slug: string | null }) {
  const pathname = usePathname();
  if (pathname === '/dashboard/preview') return null;

  return (
    <aside className="hidden border-l border-hairline px-6 py-14 xl:block">
      <div className="sticky top-14">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
          Your public page
        </p>

        <div className="mt-4 rounded-lg border border-border px-4 py-5">
          <p className="text-[0.85rem] leading-relaxed text-muted-foreground">
            {isPublished
              ? 'Your profile is live. Changes appear on it within a few minutes.'
              : 'Your profile is a draft. Only you can see it.'}
          </p>

          <Link
            href="/dashboard/preview"
            className="mt-4 inline-flex min-h-9 items-center rounded-md border border-border bg-background px-3 text-[0.85rem] transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Preview it
          </Link>

          {isPublished && slug ? (
            <p className="mt-3 text-[0.78rem] leading-relaxed break-words text-muted-foreground">
              <Link
                href={`/faculty/${slug}`}
                className="underline decoration-hairline underline-offset-4 hover:decoration-current"
              >
                /faculty/{slug}
              </Link>
            </p>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
