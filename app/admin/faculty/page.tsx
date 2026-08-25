import { AccountStatus, Prisma, Role } from '@prisma/client';
import type { Metadata } from 'next';

import { scopedUserWhere } from '@/lib/auth/admin-scope';
import { requireSession } from '@/lib/auth/session';
import { db } from '@/lib/db';

import { FacultyFilters } from './faculty-filters';
import { FacultyTable } from './faculty-table';

export const metadata: Metadata = { title: 'Faculty' };

const VALID_STATUSES = new Set<string>(Object.values(AccountStatus));

type Params = { q?: string; status?: string; department?: string };

export default async function FacultyPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const session = await requireSession();
  const params = await searchParams;

  const q = params.q?.trim() ?? '';
  // Garbage in the URL must not reach Prisma as an enum value — an unvalidated
  // `status as AccountStatus` cast would throw at the database driver on anything that
  // is not a real member, turning a mistyped query string into a 500.
  const status = params.status && VALID_STATUSES.has(params.status) ? params.status : '';
  const isSuperAdmin = session.role === Role.SUPER_ADMIN;
  const departmentId = isSuperAdmin ? (params.department ?? '') : '';

  const scoped = scopedUserWhere(session);

  const [rows, departments] = await Promise.all([
    scoped
      ? db.user.findMany({
          where: {
            ...scoped,
            ...(status ? { status: status as AccountStatus } : {}),
            ...(departmentId ? { profile: { is: { departmentId } } } : {}),
            ...(q
              ? ({
                  OR: [
                    { email: { contains: q, mode: 'insensitive' } },
                    { profile: { is: { fullName: { contains: q, mode: 'insensitive' } } } },
                  ],
                } satisfies Prisma.UserWhereInput)
              : {}),
          },
          select: {
            id: true,
            email: true,
            role: true,
            status: true,
            profile: { select: { fullName: true, department: { select: { name: true } } } },
          },
          orderBy: { profile: { fullName: 'asc' } },
          // A hard ceiling, not pagination — at the documented scale (500 faculty,
          // CLAUDE.md §1) this table is meant to be searched, not paged through. If the
          // institution grows well past that, this becomes the next thing to revisit,
          // the same way the directory's own listing carries real pagination and this
          // deliberately does not yet.
          take: 500,
        })
      : Promise.resolve([]),
    isSuperAdmin
      ? db.department.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })
      : Promise.resolve(null),
  ]);

  const tableRows = rows.map((u) => ({
    id: u.id,
    email: u.email,
    fullName: u.profile?.fullName ?? '(no name on file)',
    departmentName: u.profile?.department.name ?? '—',
    role: u.role,
    status: u.status,
  }));

  return (
    <main className="px-gutter py-10 sm:py-14">
      <div className="max-w-5xl">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
          Admin
        </p>
        <h1 className="mt-5 text-[2.5rem] leading-[1.08] tracking-[-0.015em]">Faculty</h1>
        <p className="measure mt-4 text-[0.95rem] leading-relaxed text-muted-foreground">
          {isSuperAdmin
            ? 'Every account in the institution.'
            : 'Faculty in your department. Other administrators are managed by a super admin.'}
        </p>

        <div className="mt-10">
          <FacultyFilters
            q={q}
            status={status}
            departmentId={departmentId}
            departments={departments}
          />
        </div>

        <div className="mt-6">
          <FacultyTable
            initialRows={tableRows}
            viewerIsSuperAdmin={isSuperAdmin}
            viewerUserId={session.userId}
          />
        </div>
      </div>
    </main>
  );
}
