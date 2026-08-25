'use server';

import { revalidatePath } from 'next/cache';

import { assertOwnsProfileRow } from '@/lib/auth/ownership';
import { requireSession } from '@/lib/auth/session';
import { recomputeCompleteness } from '@/lib/completeness';
import { db } from '@/lib/db';
import { awardSchema, reorderSchema } from '@/lib/validation/sections';

/**
 * Award section mutations.
 *
 * Explicit per entity, not generated at runtime: an ownership check inside a factory is
 * one line nobody reads. The full rationale is at the top of
 * app/dashboard/academics/actions.ts.
 *
 * Order on every mutation: requireSession -> assertOwnsProfileRow -> .strict() parse.

 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export type AwardRow = {
  id: string;
  profileId: string;
  title: string;
  awardedBy: string | null;
  year: number | null;
  description: string | null;
  sortOrder: number;
};

const SELECT = {
  id: true,
  profileId: true,
  title: true,
  awardedBy: true,
  year: true,
  description: true,
  sortOrder: true,
} as const;

async function listFor(profileId: string): Promise<AwardRow[]> {
  const rows = await db.award.findMany({
    where: { profileId },
    select: SELECT,
    orderBy: { sortOrder: 'asc' },
  });
  return rows;
}

function fieldErrorsFrom(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '_');
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export async function createAwardAction(
  input: unknown,
): Promise<ActionResult<AwardRow[]>> {
  const session = await requireSession();
  await assertOwnsProfileRow({ profileId: session.profileId }, session);

  const parsed = awardSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Check the highlighted fields.',
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  const last = await db.award.findFirst({
    where: { profileId: session.profileId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });

  // Explicit field list. Never spread the parsed object — profileId and sortOrder are
  // server-owned and must stay unwritable from input.
  await db.award.create({
    data: {
      profileId: session.profileId,
      title: parsed.data.title,
      awardedBy: parsed.data.awardedBy ?? null,
      year: parsed.data.year ?? null,
      description: parsed.data.description ?? null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });

  await recomputeCompleteness(session.profileId);
  revalidatePath('/dashboard/awards');
  return { ok: true, data: await listFor(session.profileId) };
}

export async function updateAwardAction(
  id: string,
  input: unknown,
): Promise<ActionResult<AwardRow[]>> {
  const session = await requireSession();

  const existing = await db.award.findUnique({
    where: { id },
    select: { id: true, profileId: true },
  });

  // 404 for a row owned by someone else, indistinguishable from one that does not exist.
  // `id` came from the client, so this is the IDOR guard.
  await assertOwnsProfileRow(existing, session);

  const parsed = awardSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Check the highlighted fields.',
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  await db.award.update({
    where: { id },
    data: {
      title: parsed.data.title,
      awardedBy: parsed.data.awardedBy ?? null,
      year: parsed.data.year ?? null,
      description: parsed.data.description ?? null,
    },
  });

  await recomputeCompleteness(session.profileId);
  revalidatePath('/dashboard/awards');
  return { ok: true, data: await listFor(session.profileId) };
}

export async function deleteAwardAction(
  id: string,
): Promise<ActionResult<AwardRow[]>> {
  const session = await requireSession();

  const existing = await db.award.findUnique({
    where: { id },
    select: { id: true, profileId: true },
  });

  await assertOwnsProfileRow(existing, session);

  await db.award.delete({ where: { id } });

  await recomputeCompleteness(session.profileId);
  revalidatePath('/dashboard/awards');
  return { ok: true, data: await listFor(session.profileId) };
}

/**
 * Reorder — a mutation on MANY rows.
 *
 * Every row is verified BEFORE any row is written. Checking inside the write loop would
 * leave the section half-reordered when the check fails partway through. The submitted set
 * must also match the owned set exactly, so ids cannot be omitted or repeated.
 */
export async function reorderAwardAction(
  input: unknown,
): Promise<ActionResult<AwardRow[]>> {
  const session = await requireSession();

  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'That reordering was not valid.' };
  const { ids } = parsed.data;

  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: 'That reordering was not valid.' };
  }

  const owned = await db.award.findMany({
    where: { profileId: session.profileId },
    select: { id: true, profileId: true },
  });

  const ownedById = new Map(owned.map((row) => [row.id, row]));
  for (const id of ids) {
    await assertOwnsProfileRow(ownedById.get(id) ?? null, session);
  }

  if (ids.length !== owned.length) {
    return {
      ok: false,
      error: 'The list changed while you were reordering. Refresh and try again.',
    };
  }

  await db.$transaction(
    ids.map((id, index) =>
      db.award.update({ where: { id }, data: { sortOrder: index } }),
    ),
  );

  revalidatePath('/dashboard/awards');
  return { ok: true, data: await listFor(session.profileId) };
}

export async function listAward(): Promise<AwardRow[]> {
  const session = await requireSession();
  return listFor(session.profileId);
}
