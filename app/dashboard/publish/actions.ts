'use server';

import { revalidatePath } from 'next/cache';

import { assertCanPublishProfile } from '@/lib/auth/rbac';
import { ForbiddenError, requireSession } from '@/lib/auth/session';
import { db } from '@/lib/db';

/**
 * Draft / published toggle.
 *
 * The gate is `assertCanPublishProfile`, which enforces two separate things:
 *
 *   - the ACTING account must be ACTIVE. A PENDING_APPROVAL user may edit everything and
 *     publish nothing, which is the entire point of the approval gate (docs/SECURITY.md
 *     §2.1) — a college address plus a working mailbox does not prove somebody is staff.
 *   - the TARGET profile must be theirs, or within a department they administer. Denial
 *     there is a 404, not a 403, matching every other cross-profile check.
 *
 * Unpublishing is deliberately NOT gated on account status. Someone suspended mid-way, or
 * who simply wants their page down, must always be able to take it down; requiring an
 * ACTIVE account to retract something would be the wrong failure direction.
 */

export type PublishResult =
  | { ok: true; isPublished: boolean }
  | { ok: false; error: string };

export async function setPublishedAction(
  isPublished: boolean,
): Promise<PublishResult> {
  const session = await requireSession();

  const profile = await db.profile.findUnique({
    where: { id: session.profileId },
    select: { id: true, slug: true, departmentId: true, isPublished: true, publishedAt: true },
  });

  if (!profile) return { ok: false, error: 'Profile not found.' };

  if (isPublished) {
    try {
      assertCanPublishProfile(session, profile);
    } catch (error) {
      if (error instanceof ForbiddenError) return { ok: false, error: error.message };
      throw error; // notFound() and anything unexpected propagate
    }
  }

  await db.profile.update({
    where: { id: profile.id },
    data: {
      isPublished,
      // Set once, on first publish. It records when the profile first became public,
      // which is also what freezes the slug (PROJECT_PLAN §4.3.1) — so it must not be
      // rewritten by a later unpublish/republish cycle.
      publishedAt: isPublished ? (profile.publishedAt ?? new Date()) : profile.publishedAt,
    },
  });

  // Publishing is consequential and reversible-but-visible: it puts a person's name and
  // work on the public internet. docs/SECURITY.md §9 requires an audit row.
  await db.auditLog.create({
    data: {
      userId: session.userId,
      action: isPublished ? 'profile.publish' : 'profile.unpublish',
      entity: 'Profile',
      entityId: profile.id,
      metadata: { from: profile.isPublished, to: isPublished },
    },
  });

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/publish');

  // The public page is statically rendered on a 300s interval. That interval is fine for
  // adding a publication and NOT fine for taking a page down: an unpublish that stayed live
  // for five more minutes is the user asking to be invisible and not being. Purging the
  // path here makes both directions immediate, and the interval goes back to being the
  // safety net it was meant to be rather than the mechanism.
  revalidatePath(`/faculty/${profile.slug}`);

  return { ok: true, isPublished };
}
