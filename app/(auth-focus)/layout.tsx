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
      <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background">
        
        {/* Subtle background glow effect using safe opacity classes */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[30rem] w-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary opacity-10 blur-3xl" aria-hidden="true" />

        <header className="absolute left-6 top-6 sm:left-10 sm:top-10">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-[0.9rem] text-muted-foreground transition-colors hover:text-foreground"
          >
            <span aria-hidden="true">&larr;</span>
            Faculty Portal
          </Link>
        </header>

        <main className="w-full max-w-md px-6 py-8">
          {/* Glassmorphism Card */}
          <div className="relative rounded-3xl border border-hairline bg-surface-sunken p-8 shadow-2xl backdrop-blur-md sm:p-10">
            {children}
          </div>
        </main>
      </div>
    </Providers>
  );
}
