import { AccountStatus } from '@prisma/client';
import type { Metadata } from 'next';
import Link from 'next/link';

import { CompletenessMeter } from '@/components/dashboard/completeness-meter';
import { DASHBOARD_SECTIONS } from '@/components/dashboard/dashboard-nav';
import { requireSessionOrRedirect } from '@/lib/auth/session';
import { computeCompleteness } from '@/lib/completeness';
import { db } from '@/lib/db';

export const metadata: Metadata = { title: 'Overview' };

/**
 * Dashboard overview.
 *
 * The awaiting-approval banner is NOT rendered here — the shell owns it, so it appears on
 * every dashboard page rather than only on the one a pending user might not visit.
 */
export default async function DashboardPage() {
  // The shell (dashboard/layout.tsx) renders without furniture for an invalid session; the
  // page itself still demands a real one, and redirects to /login rather than throwing —
  // proxy.ts only guards against a MISSING cookie, not one that no longer names a live
  // session (see the comment on UnauthenticatedError).
  const session = await requireSessionOrRedirect('/dashboard');

  const [completeness, counts] = await Promise.all([
    computeCompleteness(session.profileId),
    db.profile.findUnique({
      where: { id: session.profileId },
      select: {
        _count: {
          select: {
            educations: true,
            publications: true,
            positions: true,
            awards: true,
            courses: true,
            projects: true,
            guidances: true,
            memberships: true,
          },
        },
      },
    }),
  ]);

  const c = counts?._count;
  const sectionCounts: Array<{ href: string; label: string; count: number }> = [
    { href: '/dashboard/academics', label: 'Education', count: c?.educations ?? 0 },
    { href: '/dashboard/publications', label: 'Publications', count: c?.publications ?? 0 },
    { href: '/dashboard/positions', label: 'Positions', count: c?.positions ?? 0 },
    { href: '/dashboard/awards', label: 'Awards', count: c?.awards ?? 0 },
    { href: '/dashboard/teaching', label: 'Courses', count: c?.courses ?? 0 },
    { href: '/dashboard/projects', label: 'Projects', count: c?.projects ?? 0 },
    { href: '/dashboard/guidance', label: 'Guidance', count: c?.guidances ?? 0 },
  ];
  void DASHBOARD_SECTIONS;

  return (
    <main className="px-gutter py-10 sm:py-14">
      <div className="max-w-3xl">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
          {session.status === AccountStatus.ACTIVE ? 'Your profile' : 'Draft profile'}
        </p>
        <h1 className="mt-5 text-[2.5rem] leading-[1.08] tracking-[-0.015em]">Overview</h1>

        <div className="mt-10">
          <CompletenessMeter breakdown={completeness} variant="full" />
        </div>

        <h2 className="mt-14 text-[1.35rem] leading-snug">Sections</h2>
        <ul className="mt-5 divide-y divide-hairline border-y border-hairline">
          {sectionCounts.map((section) => (
            <li key={section.href}>
              <Link
                href={section.href}
                className="flex items-center justify-between gap-4 py-3.5 text-[0.95rem] transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span>{section.label}</span>
                <span className="font-mono text-[0.8rem] text-muted-foreground tabular-nums">
                  {section.count === 0 ? 'none yet' : section.count}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
