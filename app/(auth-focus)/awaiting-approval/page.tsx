import type { Metadata } from 'next';

import { AwaitingApproval } from '@/components/auth/awaiting-approval';
import { getOptionalSession } from '@/lib/auth/session';
import { db } from '@/lib/db';

export const metadata: Metadata = {
  title: 'Awaiting approval',
  robots: { index: false, follow: false },
};

/**
 * Standalone awaiting-approval screen.
 *
 * Reachable directly as well as immediately after verification, so someone who signed out
 * and came back can re-read what they are waiting for. Names the reviewing department when
 * a session is available.
 */
export default async function AwaitingApprovalPage() {
  const session = await getOptionalSession();

  const department = session
    ? await db.department.findUnique({
        where: { id: session.departmentId },
        select: { name: true },
      })
    : null;

  return <AwaitingApproval variant="screen" departmentName={department?.name ?? null} />;
}
