import { AccountStatus } from '@prisma/client';
import { headers } from 'next/headers';
import Link from 'next/link';

import { AwaitingApproval } from '@/components/auth/awaiting-approval';
import { SignOutButton } from '@/components/dashboard/sign-out-button';
import { CompletenessMeter } from '@/components/dashboard/completeness-meter';
import { DashboardNav } from '@/components/dashboard/dashboard-nav';
import { PreviewRail } from '@/components/dashboard/preview-rail';
import { Providers } from '@/components/providers';
import { getOptionalSession } from '@/lib/auth/session';
import { computeCompleteness } from '@/lib/completeness';
import { db } from '@/lib/db';

/**
 * Dashboard shell.
 *
 * Reads the per-request nonce issued by proxy.ts and hands it to next-themes, whose inline
 * anti-flash script would otherwise be blocked by the strict CSP here. `headers()` costs
 * nothing extra on these routes — they read the session cookie and are dynamic regardless.
 * It must NOT move to the root layout: see docs/SECURITY.md §7.2.
 *
 * The split pane the design calls for is form left, public-page rail right. The rail hides
 * itself on /dashboard/preview — see components/dashboard/preview-rail.tsx for why.
 */
export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const session = await getOptionalSession();

  // proxy.ts only checks that a cookie is present. A forged or expired one lands here,
  // and each PAGE performs its own requireSessionOrRedirect() and sends the visitor to
  // /login — this shell has no page-specific route to redirect back to, so it just
  // renders without the profile furniture rather than guessing at one.
  if (!session) {
    return <Providers nonce={nonce}>{children}</Providers>;
  }

  const [profile, department, completeness] = await Promise.all([
    db.profile.findUnique({
      where: { id: session.profileId },
      select: { fullName: true, designation: true, slug: true, isPublished: true },
    }),
    db.department.findUnique({
      where: { id: session.departmentId },
      select: { name: true },
    }),
    computeCompleteness(session.profileId),
  ]);

  const awaitingApproval = session.status === AccountStatus.PENDING_APPROVAL;

  return (
    <Providers nonce={nonce}>
      <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
        {/* SIDEBAR — becomes a stacked header below lg, so the nav is never behind a tap. */}
        <aside className="border-b border-hairline bg-surface-sunken px-gutter py-6 lg:border-r lg:border-b-0 lg:py-8">
          <div className="lg:sticky lg:top-8 lg:space-y-8">
            <div>
              <Link
                href="/"
                className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Faculty Portal
              </Link>
              <p className="mt-3 text-[1.15rem] leading-snug font-display">
                {profile?.fullName ?? 'Your profile'}
              </p>
              <p className="mt-0.5 text-[0.85rem] text-muted-foreground">
                {[profile?.designation, department?.name].filter(Boolean).join(' · ') ||
                  'Profile not yet complete'}
              </p>

              <p className="mt-3 inline-flex items-center gap-1.5 text-[0.75rem] text-muted-foreground">
                <span
                  aria-hidden="true"
                  className={`size-1.5 rounded-full ${
                    profile?.isPublished ? 'bg-success' : 'bg-muted-foreground/50'
                  }`}
                />
                {profile?.isPublished ? 'Published' : 'Not published'}
              </p>

              {/*
                Deliberately OUTSIDE <DashboardNav>. That list is a horizontally-scrolling
                rail below `lg` (see the comment in dashboard-nav.tsx), and burying the one
                control that ends a session inside a scroller with no scroll affordance is
                how it goes unnoticed. This sits in the header block of the sidebar, which
                is fully visible at every width — never scrolled, never collapsed.
              */}
              <div className="mt-3">
                <SignOutButton />
              </div>
            </div>

            <div className="mt-6 lg:mt-0">
              <CompletenessMeter breakdown={completeness} />
            </div>

            <div className="mt-6 lg:mt-0">
              <DashboardNav />
            </div>
          </div>
        </aside>

        {/* MAIN + placeholder preview column. */}
        <div className="min-w-0">
          {awaitingApproval ? (
            <div className="px-gutter pt-8">
              <AwaitingApproval variant="banner" departmentName={department?.name ?? null} />
            </div>
          ) : null}

          <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
            <div className="min-w-0">{children}</div>

            <PreviewRail
              isPublished={profile?.isPublished ?? false}
              slug={profile?.slug ?? null}
            />
          </div>
        </div>
      </div>
    </Providers>
  );
}
