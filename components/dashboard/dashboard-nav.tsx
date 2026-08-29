'use client';

import { motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Dashboard section navigation.
 *
 * The active indicator is a single shared element animated between items with `layoutId`
 * (CLAUDE.md §7), so it slides rather than cutting. Under `prefers-reduced-motion` the
 * layout animation is disabled and the indicator simply appears in place.
 *
 * Only routes that EXIST are listed. Next prefetches every visible <Link>, so a link to
 * an unbuilt route produces a console 404 on page load — which is the first thing a
 * technical faculty member notices.
 */

import { AddCustomSectionDialog } from '@/components/dashboard/add-custom-section-dialog';

export type NavItem = { href: string; label: string; count?: number };

export const DASHBOARD_SECTIONS: NavItem[] = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/profile', label: 'Personal details' },
  { href: '/dashboard/academics', label: 'Education' },
  { href: '/dashboard/publications', label: 'Publications' },
  { href: '/dashboard/positions', label: 'Positions' },
  { href: '/dashboard/awards', label: 'Awards' },
  { href: '/dashboard/teaching', label: 'Teaching' },
  { href: '/dashboard/projects', label: 'Projects' },
  { href: '/dashboard/guidance', label: 'Guidance' },
  { href: '/dashboard/preview', label: 'Preview' },
  { href: '/dashboard/publish', label: 'Publish' },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardNav({
  counts,
  customSections = [],
}: {
  counts?: Record<string, number>;
  customSections?: Array<{ title: string; slug: string }>;
}) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();

  return (
    <nav aria-label="Profile sections" className="space-y-4">
      <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0">
        {DASHBOARD_SECTIONS.map((item) => {
          const active = isActive(pathname, item.href);
          const count = counts?.[item.href];

          return (
            <li key={item.href} className="relative shrink-0 lg:shrink">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`relative flex items-center justify-between gap-3 rounded-md px-3 py-2.5 text-[0.9rem] whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  active
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {active ? (
                  <motion.span
                    layoutId="dashboard-nav-indicator"
                    aria-hidden="true"
                    className="absolute inset-0 -z-10 rounded-md bg-secondary"
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : { type: 'spring', stiffness: 100, damping: 20 }
                    }
                  />
                ) : null}

                <span className={active ? 'font-medium' : undefined}>{item.label}</span>

                {typeof count === 'number' && count > 0 ? (
                  <span className="font-mono text-[0.7rem] text-muted-foreground">
                    {count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}

        {/* Dynamic Custom Sections */}
        {customSections.map((cs) => {
          const href = `/dashboard/custom/${cs.slug}`;
          const active = isActive(pathname, href);

          return (
            <li key={cs.slug} className="relative shrink-0 lg:shrink">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`relative flex items-center justify-between gap-3 rounded-md px-3 py-2.5 text-[0.9rem] whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  active
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {active ? (
                  <motion.span
                    layoutId="dashboard-nav-indicator"
                    aria-hidden="true"
                    className="absolute inset-0 -z-10 rounded-md bg-secondary"
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : { type: 'spring', stiffness: 100, damping: 20 }
                    }
                  />
                ) : null}

                <span className={active ? 'font-medium' : undefined}>{cs.title}</span>
                <span className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-primary/80 bg-primary/10 px-1.5 py-0.5 rounded">
                  Custom
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Add Custom Section Button */}
      <div className="pt-2 border-t border-hairline">
        <AddCustomSectionDialog />
      </div>
    </nav>
  );
}
