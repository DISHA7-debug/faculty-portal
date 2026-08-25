import { AccountStatus, Role } from '@prisma/client';
import type { Metadata } from 'next';

import { scopedUserWhere } from '@/lib/auth/admin-scope';
import { requireSession } from '@/lib/auth/session';
import { db } from '@/lib/db';

import { ApprovalsList } from './approvals-list';

export const metadata: Metadata = { title: 'Approvals' };

/**
 * Pending-approval queue.
 *
 * The layout has already confirmed this session is DEPT_ADMIN or SUPER_ADMIN
 * (app/admin/layout.tsx) — this page only needs `requireSession()` to get the session
 * object back, not to re-check the role.
 */
export default async function ApprovalsPage() {
  const session = await requireSession();
  const where = scopedUserWhere(session);

  // `null` only for a DEPT_ADMIN with no assigned department — see scopedUserWhere's
  // contract. Skip the query rather than pass an empty filter through by accident.
  const pending = where
    ? await db.user.findMany({
        where: { ...where, status: AccountStatus.PENDING_APPROVAL },
        select: {
          id: true,
          email: true,
          createdAt: true,
          profile: { select: { fullName: true, department: { select: { name: true } } } },
        },
        // Oldest first: the person who has been waiting longest is the one an admin
        // should see first, not buried under everyone who signed up five minutes ago.
        orderBy: { createdAt: 'asc' },
      })
    : [];

  const rows = pending.map((u) => ({
    id: u.id,
    email: u.email,
    fullName: u.profile?.fullName ?? '(no name on file)',
    departmentName: u.profile?.department.name ?? '—',
    signedUpAt: u.createdAt.toISOString(),
  }));

  return (
    <main className="px-gutter py-10 sm:py-14">
      <div className="max-w-3xl">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
          Admin
        </p>
        <h1 className="mt-5 text-[2.5rem] leading-[1.08] tracking-[-0.015em]">Approvals</h1>
        <p className="measure mt-4 text-[0.95rem] leading-relaxed text-muted-foreground">
          {session.role === Role.SUPER_ADMIN
            ? 'Every department. A domain-matching email address only proves someone can receive mail there — approval is what confirms they belong.'
            : 'Your department. Approving gives a faculty member the ability to publish their profile; nothing they do before this is visible publicly.'}
        </p>

        <div className="mt-10">
          <ApprovalsList initialRows={rows} />
        </div>
      </div>
    </main>
  );
}
