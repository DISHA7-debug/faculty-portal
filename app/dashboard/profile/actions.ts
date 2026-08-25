'use server';

import { revalidatePath } from 'next/cache';

import { assertOwnsProfileRow } from '@/lib/auth/ownership';
import { requireSession } from '@/lib/auth/session';
import { recomputeCompleteness } from '@/lib/completeness';
import { db } from '@/lib/db';
import { remove } from '@/lib/storage';
import {
  profileUpdateSchema,
  researchInterestsSchema,
} from '@/lib/validation/profile';

/**
 * Removing an uploaded file.
 *
 * Uploading goes through POST /api/upload (a Route Handler — binaries do not belong in the
 * RSC payload). Removal is a Server Action because it carries no payload at all.
 *
 * Order matters and mirrors the upload path in reverse: clear the reference FIRST, then
 * delete the object. A failure after the reference is cleared leaves an orphaned object,
 * which is invisible to users; the reverse leaves the profile pointing at something that
 * no longer exists.
 */

export type RemoveResult = { ok: true } | { ok: false; error: string };

export async function removeFileAction(kind: 'photo' | 'cv'): Promise<RemoveResult> {
  const session = await requireSession();
  await assertOwnsProfileRow({ profileId: session.profileId }, session);

  const profile = await db.profile.findUnique({
    where: { id: session.profileId },
    select: { photoKey: true, cvKey: true },
  });

  const key = kind === 'photo' ? profile?.photoKey : profile?.cvKey;
  if (!key) return { ok: true }; // already gone; idempotent

  await db.profile.update({
    where: { id: session.profileId },
    data: kind === 'photo' ? { photoKey: null } : { cvKey: null },
  });

  await remove(key).catch((error) => {
    console.error('[profile] failed to delete object', key, error);
  });
  await db.fileObject.deleteMany({ where: { key } });

  await recomputeCompleteness(session.profileId);
  revalidatePath('/dashboard/profile');

  return { ok: true };
}


export type UpdateProfileState = {
  ok?: true;
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

/**
 * Personal details.
 *
 * requireSession -> assertOwnsProfileRow -> .strict() parse, in that order, as with every
 * other mutation.
 *
 * The `data` object is written out field by field rather than spread from the parse
 * result. The schema already rejects unknown keys, so spreading would be safe TODAY —
 * but an allow-list that depends on the schema staying strict is one refactor away from
 * not being an allow-list. `role`, `status`, `userId`, `isPublished`, `completeness`,
 * `viewCount`, and `slug` are absent here on purpose.
 */
export async function updateProfileAction(
  _previous: UpdateProfileState,
  formData: FormData,
): Promise<UpdateProfileState> {
  const session = await requireSession();
  await assertOwnsProfileRow({ profileId: session.profileId }, session);

  const parsed = profileUpdateSchema.safeParse({
    fullName: String(formData.get('fullName') ?? ''),
    designation: String(formData.get('designation') ?? ''),
    officeNo: String(formData.get('officeNo') ?? ''),
    mobile: String(formData.get('mobile') ?? ''),
    altEmail: String(formData.get('altEmail') ?? ''),
    about: String(formData.get('about') ?? ''),
    personalPageUrl: String(formData.get('personalPageUrl') ?? ''),
    linkedinUrl: String(formData.get('linkedinUrl') ?? ''),
    orcid: String(formData.get('orcid') ?? ''),
    scopusId: String(formData.get('scopusId') ?? ''),
    googleScholarId: String(formData.get('googleScholarId') ?? ''),
    researcherId: String(formData.get('researcherId') ?? ''),
    // Unchecked checkboxes are simply absent from FormData.
    showMobile: formData.get('showMobile') === 'on',
    showAltEmail: formData.get('showAltEmail') === 'on',
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '_');
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { error: 'Check the highlighted fields.', fieldErrors };
  }

  const d = parsed.data;

  await db.profile.update({
    where: { id: session.profileId },
    data: {
      fullName: d.fullName,
      designation: d.designation,
      officeNo: d.officeNo,
      mobile: d.mobile,
      altEmail: d.altEmail,
      about: d.about,
      personalPageUrl: d.personalPageUrl,
      linkedinUrl: d.linkedinUrl,
      orcid: d.orcid,
      scopusId: d.scopusId,
      googleScholarId: d.googleScholarId,
      researcherId: d.researcherId,
      showMobile: d.showMobile,
      showAltEmail: d.showAltEmail,
    },
  });

  await recomputeCompleteness(session.profileId);
  revalidatePath('/dashboard/profile');
  revalidatePath('/dashboard');

  return { ok: true };
}

export type InterestsResult =
  | { ok: true; interests: string[] }
  | { ok: false; error: string };

/** Research interests. Capped server-side at the same 15 the UI shows. */
export async function setResearchInterestsAction(
  interests: string[],
): Promise<InterestsResult> {
  const session = await requireSession();
  await assertOwnsProfileRow({ profileId: session.profileId }, session);

  const parsed = researchInterestsSchema.safeParse({ interests });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'That list is not valid.' };
  }

  // De-duplicated case-insensitively, keeping the first spelling the person chose.
  const seen = new Set<string>();
  const unique = parsed.data.interests.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  await db.profile.update({
    where: { id: session.profileId },
    data: { researchInterests: unique },
  });

  await recomputeCompleteness(session.profileId);
  revalidatePath('/dashboard/profile');

  return { ok: true, interests: unique };
}
