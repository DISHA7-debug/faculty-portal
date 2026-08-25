import { Role } from '@prisma/client';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireSession } from '@/lib/auth/session';
import { db } from '@/lib/db';

import { LogsFilters } from './logs-filters';

export const metadata: Metadata = { title: 'Audit log' };

const PER_PAGE = 50;

type Params = { action?: string; from?: string; to?: string; page?: string };

/** `YYYY-MM-DD` from an `<input type="date">` has no timezone of its own — read as a UTC
 *  calendar day, consistently for `from` (start of day) and `to` (exclusive next day). This
 *  is a deliberate, documented choice, not an oversight: AuditLog.createdAt is already
 *  `timestamptz` (docs/RUNBOOK.md's "which world you are in" check), so the arithmetic
 *  itself is safe — the only ambiguity left is which timezone a bare calendar date MEANS,
 *  and UTC is the one that needs no further explanation anywhere else in this file. */
function parseDateBoundary(value: string | undefined, endOfDayExclusive: boolean): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDayExclusive) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const session = await requireSession();

  // SUPER_ADMIN only. The layout does not even link here for a DEPT_ADMIN (app/admin
  // /layout.tsx builds the nav server-side for exactly this reason), but the route itself
  // still has to refuse a direct hit — a hidden link is not the authorization.
  if (session.role !== Role.SUPER_ADMIN) notFound();

  const params = await searchParams;
  const action = params.action?.trim() ?? '';
  const from = parseDateBoundary(params.from, false);
  const to = parseDateBoundary(params.to, true);
  const page = Math.max(1, Number(params.page) || 1);

  const where = {
    ...(action ? { action } : {}),
    ...(from || to
      ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }
      : {}),
  };

  const [rows, total, distinctActions] = await Promise.all([
    db.auditLog.findMany({
      where,
      select: {
        id: true,
        action: true,
        entity: true,
        entityId: true,
        metadata: true,
        createdAt: true,
        user: { select: { email: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
    db.auditLog.count({ where }),
    // Derived from real data rather than a maintained constant — the same reasoning as
    // lib/directory.ts's directoryFacets(): a hardcoded list of action strings drifts the
    // moment somebody adds a new one and forgets to update it here too.
    db.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    }),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));

  const hrefFor = (targetPage: number) => {
    const next = new URLSearchParams();
    if (action) next.set('action', action);
    if (params.from) next.set('from', params.from);
    if (params.to) next.set('to', params.to);
    if (targetPage > 1) next.set('page', String(targetPage));
    const qs = next.toString();
    return qs ? `/admin/logs?${qs}` : '/admin/logs';
  };

  return (
    <main className="px-gutter py-10 sm:py-14">
      <div className="max-w-5xl">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
          Admin
        </p>
        <h1 className="mt-5 text-[2.5rem] leading-[1.08] tracking-[-0.015em]">Audit log</h1>
        <p className="measure mt-4 text-[0.95rem] leading-relaxed text-muted-foreground">
          {total.toLocaleString()} {total === 1 ? 'entry' : 'entries'}. Every admin action
          and every destructive user action writes one of these (CLAUDE.md §3.6).
        </p>

        <div className="mt-10">
          <LogsFilters
            action={action}
            from={params.from ?? ''}
            to={params.to ?? ''}
            actions={distinctActions.map((a) => a.action)}
          />
        </div>

        <div className="mt-6">
          {rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
              <p className="text-[0.95rem] text-muted-foreground">
                No log entries match these filters.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-hairline">
              <table className="w-full text-left text-[0.85rem]">
                <thead>
                  <tr className="border-b border-hairline bg-surface-sunken text-[0.7rem] text-muted-foreground uppercase tracking-[0.08em]">
                    <th className="px-4 py-3 font-medium">When</th>
                    <th className="px-4 py-3 font-medium">Actor</th>
                    <th className="px-4 py-3 font-medium">Action</th>
                    <th className="px-4 py-3 font-medium">Entity</th>
                    <th className="px-4 py-3 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        <time dateTime={row.createdAt.toISOString()}>
                          {row.createdAt.toISOString().replace('T', ' ').slice(0, 19)}
                          {' UTC'}
                        </time>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {row.user?.email ?? (
                          <span className="text-muted-foreground italic">
                            deleted account
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-[0.8rem] whitespace-nowrap">
                        {row.action}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        {row.entity}
                        {row.entityId ? (
                          <span className="ml-1 font-mono text-[0.75rem]">
                            {row.entityId.slice(0, 10)}…
                          </span>
                        ) : null}
                      </td>
                      <td className="max-w-[28ch] truncate px-4 py-3 font-mono text-[0.75rem] text-muted-foreground">
                        {row.metadata ? JSON.stringify(row.metadata) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {pageCount > 1 ? (
          <nav
            aria-label="Log pages"
            className="mt-8 flex items-center justify-between gap-4 border-t border-hairline pt-6"
          >
            {page > 1 ? (
              <Link
                href={hrefFor(page - 1)}
                className="inline-flex min-h-9 items-center rounded-md border border-border px-3.5 text-[0.85rem] transition-colors hover:bg-secondary"
              >
                ← Previous
              </Link>
            ) : (
              <span aria-hidden="true" />
            )}
            <p className="font-mono text-[0.76rem] text-muted-foreground tabular-nums">
              Page {page} of {pageCount}
            </p>
            {page < pageCount ? (
              <Link
                href={hrefFor(page + 1)}
                className="inline-flex min-h-9 items-center rounded-md border border-border px-3.5 text-[0.85rem] transition-colors hover:bg-secondary"
              >
                Next →
              </Link>
            ) : (
              <span aria-hidden="true" />
            )}
          </nav>
        ) : null}
      </div>
    </main>
  );
}
