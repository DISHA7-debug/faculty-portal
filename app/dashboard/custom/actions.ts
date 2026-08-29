'use server';

import { revalidatePath } from 'next/cache';

import { assertOwnsProfileRow } from '@/lib/auth/ownership';
import { requireSession } from '@/lib/auth/session';
import { db } from '@/lib/db';

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/**
 * Creates a new custom section (e.g., "Patents", "Certifications") for the session's profile.
 */
export async function createCustomSectionAction(
  title: string,
  columns: string[],
): Promise<ActionResult<{ slug: string }>> {
  const session = await requireSession();
  await assertOwnsProfileRow({ profileId: session.profileId }, session);

  const cleanTitle = title.trim();
  if (!cleanTitle) {
    return { ok: false, error: 'Section title is required.' };
  }

  const cleanCols = columns.map((c) => c.trim()).filter(Boolean);
  if (cleanCols.length === 0) {
    return { ok: false, error: 'At least one column header is required.' };
  }

  const baseSlug = cleanTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const slug = baseSlug || 'custom-section';

  const existing = await db.customSection.findUnique({
    where: { profileId_slug: { profileId: session.profileId, slug } },
  });

  if (existing) {
    return { ok: false, error: `A section named "${cleanTitle}" already exists.` };
  }

  const lastSection = await db.customSection.findFirst({
    where: { profileId: session.profileId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });

  await db.customSection.create({
    data: {
      profileId: session.profileId,
      title: cleanTitle,
      slug,
      columns: cleanCols,
      sortOrder: (lastSection?.sortOrder ?? -1) + 1,
    },
  });

  revalidatePath('/dashboard');
  revalidatePath(`/dashboard/custom/${slug}`);

  return { ok: true, data: { slug } };
}

/**
 * Deletes an entire custom section.
 */
export async function deleteCustomSectionAction(
  sectionId: string,
): Promise<ActionResult> {
  const session = await requireSession();

  const section = await db.customSection.findUnique({
    where: { id: sectionId },
    select: { id: true, profileId: true },
  });

  if (!section) return { ok: false, error: 'Section not found.' };
  await assertOwnsProfileRow({ profileId: section.profileId }, session);

  await db.customSection.delete({ where: { id: sectionId } });

  revalidatePath('/dashboard');
  return { ok: true };
}

/**
 * Adds an item row to a custom section.
 */
export async function createCustomItemAction(
  sectionId: string,
  values: Record<string, string>,
): Promise<ActionResult> {
  const session = await requireSession();

  const section = await db.customSection.findUnique({
    where: { id: sectionId },
    select: { id: true, profileId: true, slug: true },
  });

  if (!section) return { ok: false, error: 'Section not found.' };
  await assertOwnsProfileRow({ profileId: section.profileId }, session);

  const lastItem = await db.customItem.findFirst({
    where: { customSectionId: sectionId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });

  await db.customItem.create({
    data: {
      customSectionId: sectionId,
      values,
      sortOrder: (lastItem?.sortOrder ?? -1) + 1,
    },
  });

  revalidatePath(`/dashboard/custom/${section.slug}`);
  return { ok: true };
}

/**
 * Deletes a row item from a custom section.
 */
export async function deleteCustomItemAction(
  itemId: string,
): Promise<ActionResult> {
  const session = await requireSession();

  const item = await db.customItem.findUnique({
    where: { id: itemId },
    select: { id: true, customSection: { select: { profileId: true, slug: true } } },
  });

  if (!item) return { ok: false, error: 'Item not found.' };
  await assertOwnsProfileRow({ profileId: item.customSection.profileId }, session);

  await db.customItem.delete({ where: { id: itemId } });

  revalidatePath(`/dashboard/custom/${item.customSection.slug}`);
  return { ok: true };
}
