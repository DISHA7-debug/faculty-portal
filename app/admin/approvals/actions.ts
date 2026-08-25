'use server';

import { AccountStatus, Role } from '@prisma/client';
import { revalidatePath } from 'next/cache';

import { scopedUserWhere } from '@/lib/auth/admin-scope';
import { ForbiddenError, requireSession } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { approvalEmail, rejectionEmail } from '@/lib/email-templates';
import { sendMail } from '@/lib/mailer';
import { rejectAccountSchema, targetUserSchema } from '@/lib/validation/admin';

/**
 * Approve / reject a pending account.
 *
 * ── The scoping pattern used throughout this file ───────────────────────────────────────
 *
 * `assertOwnsProfileRow` (lib/auth/ownership.ts) is for PROFILE-OWNED rows — it does not
 * apply here, because these actions mutate `User`, which carries no `profileId`. The
 * equivalent guarantee — "a row outside my authority is INDISTINGUISHABLE from a row that
 * does not exist" — is produced instead by folding `scopedUserWhere(session)` into the
 * lookup's `where` clause. A DEPT_ADMIN targeting a userId from another department, or a
 * FACULTY/DEPT_ADMIN/SUPER_ADMIN account (scopedUserWhere restricts a DEPT_ADMIN's queries
 * to `role: FACULTY` — see the comment there for why), gets a `findFirst` miss and the
 * exact same "Account not found." any genuinely-missing id would produce. No branch of
 * this code can tell the two cases apart, which is the property CLAUDE.md §3.1 asks for.
 */

export type AdminActionResult = { ok: true } | { ok: false; error: string };

async function requireAdmin() {
  const session = await requireSession();
  if (session.role !== Role.DEPT_ADMIN && session.role !== Role.SUPER_ADMIN) {
    // Mirrors admin/layout.tsx's reasoning: no ForbiddenError-shaped message here either.
    // This can only be reached by a crafted request past a UI that never renders these
    // controls for a non-admin session, so the caller gets the same "not found" shape as
    // every other authorization miss in this file rather than a message confirming the
    // action exists.
    throw new ForbiddenError('Account not found.');
  }
  return session;
}

export async function approveAction(userIdRaw: string): Promise<AdminActionResult> {
  const session = await requireAdmin();
  const parsed = targetUserSchema.safeParse({ userId: userIdRaw });
  if (!parsed.success) return { ok: false, error: 'Invalid request.' };

  const where = scopedUserWhere(session);
  if (!where) return { ok: false, error: 'Account not found.' };

  const target = await db.user.findFirst({
    where: { id: parsed.data.userId, ...where, status: AccountStatus.PENDING_APPROVAL },
    select: { id: true, email: true, profile: { select: { fullName: true } } },
  });
  if (!target) return { ok: false, error: 'Account not found.' };

  await db.user.update({ where: { id: target.id }, data: { status: AccountStatus.ACTIVE } });

  await db.auditLog.create({
    data: {
      userId: session.userId,
      action: 'user.approve',
      entity: 'User',
      entityId: target.id,
      metadata: { from: AccountStatus.PENDING_APPROVAL, to: AccountStatus.ACTIVE },
    },
  });

  // Best-effort: a mail-relay hiccup must not undo an approval decision an admin already
  // made and that is now correctly reflected in the database and the audit trail. The
  // faculty member will notice they can publish next time they open the dashboard even if
  // this particular email never lands.
  await sendMail(approvalEmail(target.email, target.profile?.fullName ?? 'there')).catch(
    (error) => console.error('[admin] approval email failed', target.id, error),
  );

  revalidatePath('/admin/approvals');
  return { ok: true };
}

export async function rejectAction(
  userIdRaw: string,
  reasonRaw: string,
): Promise<AdminActionResult> {
  const session = await requireAdmin();
  const parsed = rejectAccountSchema.safeParse({ userId: userIdRaw, reason: reasonRaw });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request.' };
  }

  const where = scopedUserWhere(session);
  if (!where) return { ok: false, error: 'Account not found.' };

  const target = await db.user.findFirst({
    where: { id: parsed.data.userId, ...where, status: AccountStatus.PENDING_APPROVAL },
    select: { id: true, email: true },
  });
  if (!target) return { ok: false, error: 'Account not found.' };

  await db.user.update({ where: { id: target.id }, data: { status: AccountStatus.REJECTED } });

  await db.auditLog.create({
    data: {
      userId: session.userId,
      action: 'user.reject',
      entity: 'User',
      entityId: target.id,
      metadata: {
        from: AccountStatus.PENDING_APPROVAL,
        to: AccountStatus.REJECTED,
        reason: parsed.data.reason,
      },
    },
  });

  await sendMail(rejectionEmail(target.email, parsed.data.reason)).catch((error) =>
    console.error('[admin] rejection email failed', target.id, error),
  );

  revalidatePath('/admin/approvals');
  return { ok: true };
}
