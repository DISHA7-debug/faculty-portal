import { AccountStatus, Role } from '@prisma/client';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { type AdminNavItem, AdminNav } from '@/components/admin/admin-nav';
import { SignOutButton } from '@/components/dashboard/sign-out-button';
import { Providers } from '@/components/providers';
import { adminScope, scopedUserWhere } from '@/lib/auth/admin-scope';
import { requireSessionOrRedirect } from '@/lib/auth/session';
import { db } from '@/lib/db';

/**
 * Admin shell — role gate, sidebar, and the pending-approvals badge.
 *
 * ── The role gate ────────────────────────────────────────────────────────────────────
 *
 * `requireSessionOrRedirect('/admin')` handles "not signed in at all" the same way the
 * dashboard shell does (see the long comment on `UnauthenticatedError` in
 * lib/auth/session.ts): a real redirect, not an uncaught throw.
 *
 * A signed-in FACULTY session reaching `/admin` is a DIFFERENT failure, and deliberately
 * gets a different response: `notFound()`, not a redirect and not a "not authorized"
 * message. CLAUDE.md §3.1's reasoning for 404-over-403 on a single row applies just as
 * much to a whole admin section — telling a faculty member "you're not allowed here"
 * confirms the section exists and is worth probing; a 404 does not. `requireRole` /
 * `ForbiddenError` are not used here for the same reason `assertOwnsProfileRow` never lets
 * `ForbiddenError` reach a page: nothing in this codebase should render a 403.
 */
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const session = await requireSessionOrRedirect('/admin');

  if (session.role !== Role.DEPT_ADMIN && session.role !== Role.SUPER_ADMIN) {
    notFound();
  }

  const scope = adminScope(session);
  const where = scopedUserWhere(session);

  const [pendingCount, departmentName] = await Promise.all([
    // `where` is null only for a DEPT_ADMIN with no assigned department — scopedUserWhere's
    // contract is "skip the query, do not guess", so the count is 0, not an empty-object
    // query that would silently return everyone.
    where ? db.user.count({ where: { ...where, status: AccountStatus.PENDING_APPROVAL } }) : 0,
    scope.kind === 'DEPARTMENT'
      ? db.department.findUnique({ where: { id: scope.departmentId }, select: { name: true } })
      : null,
  ]);

  const navItems: AdminNavItem[] = [
    { href: '/admin/approvals', label: 'Approvals', count: pendingCount },
    { href: '/admin/faculty', label: 'Faculty' },
    // Built server-side rather than left for AdminNav to filter, so a DEPT_ADMIN never
    // even receives the link in the response — not just has it hidden by CSS.
    ...(session.role === Role.SUPER_ADMIN
      ? [{ href: '/admin/logs', label: 'Audit log' }]
      : []),
  ];

  return (
    <Providers nonce={nonce}>
      <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
        <aside className="border-b border-hairline bg-surface-sunken px-gutter py-6 lg:border-r lg:border-b-0 lg:py-8">
          <div className="lg:sticky lg:top-8 lg:space-y-8">
            <div>
              <Link
                href="/"
                className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Faculty Portal
              </Link>
              <p className="mt-3 text-[1.15rem] leading-snug font-display">Administration</p>
              <p className="mt-0.5 text-[0.85rem] text-muted-foreground">
                {scope.kind === 'GLOBAL'
                  ? 'All departments'
                  : (departmentName?.name ?? 'No department assigned')}
              </p>

              <div className="mt-3">
                <SignOutButton />
              </div>
            </div>

            <div className="mt-6 lg:mt-0">
              <AdminNav items={navItems} />
            </div>

            <p className="mt-6 hidden text-[0.78rem] leading-relaxed text-muted-foreground lg:mt-0 lg:block">
              <Link
                href="/dashboard"
                className="underline decoration-hairline underline-offset-4 transition-colors hover:decoration-current"
              >
                ← Back to your own profile
              </Link>
            </p>
          </div>
        </aside>

        <div className="min-w-0">{children}</div>
      </div>
    </Providers>
  );
}
