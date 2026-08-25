'use server';

import { AccountStatus, Role } from '@prisma/client';
import { revalidatePath } from 'next/cache';

import { scopedUserWhere } from '@/lib/auth/admin-scope';
import { destroyAllSessionsForUser, ForbiddenError, requireSession } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { changeRoleSchema, targetUserSchema } from '@/lib/validation/admin';

/**
 * Suspend / reactivate / change-role for an existing account.
 *
 * Scoping follows the same pattern as app/admin/approvals/actions.ts: `scopedUserWhere`
 * folded into the lookup so an out-of-authority target is indistinguishable from a
 * nonexistent one. See the comment there for the full reasoning.
 */

export type AdminActionResult = { ok: true } | { ok: false; error: string };

async function requireAdmin() {
  const session = await requireSession();
  if (session.role !== Role.DEPT_ADMIN && session.role !== Role.SUPER_ADMIN) {
    throw new ForbiddenError('Account not found.');
  }
  return session;
}

/**
 * Loads a target scoped to the acting admin's authority. Shared by suspend/reactivate;
 * role-change has its own stricter lookup (SUPER_ADMIN-only, see changeRoleAction).
 */
async function loadScopedTarget(session: Awaited<ReturnType<typeof requireAdmin>>, userId: string) {
  const where = scopedUserWhere(session);
  if (!where) return null;
  return db.user.findFirst({
    where: { id: userId, ...where },
    select: { id: true, status: true },
  });
}

export async function suspendAction(userIdRaw: string): Promise<AdminActionResult> {
  const session = await requireAdmin();
  const parsed = targetUserSchema.safeParse({ userId: userIdRaw });
  if (!parsed.success) return { ok: false, error: 'Invalid request.' };

  // An admin suspending their OWN account would destroy their own session mid-click and
  // lock themselves out of the panel that could undo it — recoverable only through
  // scripts/break-glass.ts. Refuse before it happens rather than document the recovery.
  if (parsed.data.userId === session.userId) {
    return { ok: false, error: 'You cannot suspend your own account.' };
  }

  const target = await loadScopedTarget(session, parsed.data.userId);
  if (!target) return { ok: false, error: 'Account not found.' };

  await db.user.update({
    where: { id: target.id },
    data: { status: AccountStatus.SUSPENDED },
  });

  // Immediate, not eventual — a suspension that waits for a token to expire is not a
  // suspension. This is the entire reason sessions are database rows and not JWTs
  // (CLAUDE.md §2, "Why Auth.js is not used").
  const destroyed = await destroyAllSessionsForUser(target.id);

  await db.auditLog.create({
    data: {
      userId: session.userId,
      action: 'user.suspend',
      entity: 'User',
      entityId: target.id,
      metadata: { from: target.status, to: AccountStatus.SUSPENDED, sessionsDestroyed: destroyed },
    },
  });

  revalidatePath('/admin/faculty');
  return { ok: true };
}

export async function reactivateAction(userIdRaw: string): Promise<AdminActionResult> {
  const session = await requireAdmin();
  const parsed = targetUserSchema.safeParse({ userId: userIdRaw });
  if (!parsed.success) return { ok: false, error: 'Invalid request.' };

  const target = await loadScopedTarget(session, parsed.data.userId);
  if (!target) return { ok: false, error: 'Account not found.' };

  // Reactivate is specifically "undo a suspension", not "undo a rejection" — those are
  // different admin decisions (a rejected applicant was never approved in the first
  // place) and conflating them would let this one button silently do two different things
  // depending on which status the target happened to be in.
  if (target.status !== AccountStatus.SUSPENDED) {
    return { ok: false, error: 'Only a suspended account can be reactivated.' };
  }

  await db.user.update({ where: { id: target.id }, data: { status: AccountStatus.ACTIVE } });

  await db.auditLog.create({
    data: {
      userId: session.userId,
      action: 'user.reactivate',
      entity: 'User',
      entityId: target.id,
      metadata: { from: AccountStatus.SUSPENDED, to: AccountStatus.ACTIVE },
    },
  });

  revalidatePath('/admin/faculty');
  return { ok: true };
}

/**
 * Role changes are SUPER_ADMIN-only, full stop — narrower than "may administer this
 * department" and deliberately so.
 *
 * `Role` is the primary privilege axis in this whole system. `administersDepartmentId` is
 * documented as writable only by SUPER_ADMIN precisely so a DEPT_ADMIN cannot widen their
 * own scope (CLAUDE.md §3.2) — a DEPT_ADMIN able to set someone's ROLE to SUPER_ADMIN
 * would bypass that restriction entirely rather than respect it: grant the target global
 * authority directly, department scoping never even consulted. Department-scoping this
 * action the way suspend/reactivate are scoped would not close that hole, so it is not
 * attempted; the role check below is the whole control.
 */
export async function changeRoleAction(
  userIdRaw: string,
  roleRaw: string,
): Promise<AdminActionResult> {
  const session = await requireSession();
  if (session.role !== Role.SUPER_ADMIN) {
    throw new ForbiddenError('Account not found.');
  }

  const parsed = changeRoleSchema.safeParse({ userId: userIdRaw, role: roleRaw });
  if (!parsed.success) return { ok: false, error: 'Invalid request.' };

  if (parsed.data.userId === session.userId) {
    return { ok: false, error: 'You cannot change your own role.' };
  }

  const target = await db.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, role: true },
  });
  if (!target) return { ok: false, error: 'Account not found.' };
  if (target.role === parsed.data.role) return { ok: true }; // no-op, nothing to log

  await db.user.update({ where: { id: target.id }, data: { role: parsed.data.role } });

  await db.auditLog.create({
    data: {
      userId: session.userId,
      action: 'user.role_change',
      entity: 'User',
      entityId: target.id,
      metadata: { from: target.role, to: parsed.data.role },
    },
  });

  revalidatePath('/admin/faculty');
  return { ok: true };
}
