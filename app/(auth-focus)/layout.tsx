import Link from 'next/link';

import { Providers } from '@/components/providers';

/**
 * Single-column shell for the outcome screens: check-your-email, verify,
 * awaiting-approval.
 *
 * Deliberately NOT the split used by the form pages. These screens are read, not filled
 * in, and each carries exactly one message plus one next action. A second column here
 * would compete with the thing the person actually needs to read — which on
 * check-your-email is the address the mail went to.
 *
 * A route group, so URLs are unaffected: /check-email, /verify, /awaiting-approval.
 */
export default function AuthFocusLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <Providers>
      {/*
        The back link shares the content column's width and centring rather than sitting
        at the page gutter, so the eye follows a single left edge down the screen instead
        of jumping inward at the heading.
      */}
      <div className="min-h-dvh px-gutter py-10 sm:py-14">
        <div className="mx-auto max-w-xl">
          <Link
            href="/"
            className="inline-flex w-fit items-center gap-2 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span aria-hidden="true">&larr;</span>
            Faculty Portal
          </Link>

          <main className="flex flex-col justify-center py-12 sm:py-16">{children}</main>
        </div>
      </div>
    </Providers>
  );
}
