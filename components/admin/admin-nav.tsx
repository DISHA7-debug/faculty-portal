'use client';

import { motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Admin section navigation. Same `layoutId`-animated indicator as `DashboardNav`
 * (components/dashboard/dashboard-nav.tsx) — one shared visual language across both shells.
 *
 * `/admin/logs` is only ever passed in for a SUPER_ADMIN — see admin/layout.tsx, which
 * builds this list once, server-side, rather than have this component decide for itself
 * and risk a DEPT_ADMIN briefly seeing a link to a page that immediately 404s.
 */
export type AdminNavItem = { href: string; label: string; count?: number };

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();

  return (
    <nav aria-label="Admin sections">
      <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href} className="relative shrink-0 lg:shrink">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`relative flex items-center justify-between gap-3 rounded-md px-3 py-2.5 text-[0.9rem] whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {active ? (
                  <motion.span
                    layoutId="admin-nav-indicator"
                    aria-hidden="true"
                    className="absolute inset-0 -z-10 rounded-md bg-secondary"
                    transition={
                      reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 100, damping: 20 }
                    }
                  />
                ) : null}
                <span className={active ? 'font-medium' : undefined}>{item.label}</span>
                {typeof item.count === 'number' && item.count > 0 ? (
                  <span className="rounded-full bg-primary px-1.5 py-0.5 font-mono text-[0.68rem] text-primary-foreground tabular-nums">
                    {item.count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
