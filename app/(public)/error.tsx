'use client';

import Link from 'next/link';

/**
 * Error boundary for the public site.
 *
 * Covers the routes an anonymous visitor can reach: landing, directory, department pages,
 * and profiles. `app/global-error.tsx` only catches a failure in the ROOT layout, which
 * leaves everything below it — a database that is down mid-query, a malformed search that
 * somehow reaches Postgres — falling through to the framework's default error screen.
 *
 * The message says nothing about what failed. `error.message` is replaced by Next with a
 * generic string in production anyway, but a component that renders it would print
 * internals verbatim to anyone who triggered the error on a locally-run production build.
 * The digest is what correlates a visitor's report with a server log line.
 *
 * Both a retry and a way out. A visitor who hit a transient database blip wants the button;
 * one who hit something persistent wants a link that goes somewhere else, and offering only
 * "Try again" strands them.
 */
export default function PublicError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  // Next 16 renamed this prop from `reset`; destructuring the old name silently yields
  // undefined and the button throws on click.
  retry: () => void;
}) {
  return (
    <main className="px-gutter py-20">
      <div className="mx-auto max-w-[52ch]">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
          Error
        </p>
        <h1 className="mt-4 font-display text-[clamp(2rem,5vw,2.8rem)] leading-[1.08] tracking-[-0.02em]">
          Something went wrong at our end.
        </h1>
        <p className="mt-5 text-[1rem] leading-[1.75] text-muted-foreground">
          This is not something you did. Try again in a moment — if it keeps happening, let
          the portal administrator know and quote the reference below.
        </p>

        {error.digest ? (
          <p className="mt-4 font-mono text-[0.78rem] text-muted-foreground">
            Reference: {error.digest}
          </p>
        ) : null}

        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={retry}
            className="inline-flex min-h-11 items-center rounded-md bg-primary px-5 text-[0.9rem] text-primary-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Try again
          </button>
          <Link
            href="/faculty"
            className="inline-flex min-h-11 items-center rounded-md border border-border px-5 text-[0.9rem] transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Go to the directory
          </Link>
        </div>
      </div>
    </main>
  );
}
