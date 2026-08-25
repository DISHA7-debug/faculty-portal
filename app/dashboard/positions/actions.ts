'use server';

import { revalidatePath } from 'next/cache';

import { assertOwnsProfileRow } from '@/lib/auth/ownership';
import { requireSession } from '@/lib/auth/session';
import { recomputeCompleteness } from '@/lib/completeness';
import { db } from '@/lib/db';
import { positionSchema, reorderSchema } from '@/lib/validation/sections';

/**
 * Position section mutations.
 *
 * Explicit per entity, not generated at runtime: an ownership check inside a factory is
 * one line nobody reads. The full rationale is at the top of
 * app/dashboard/academics/actions.ts.
 *
 * Order on every mutation: requireSession -> assertOwnsProfileRow -> .strict() parse.
 *
 * Positions are ordered by the faculty member, not by date: many hold several concurrently and the order they want shown is a judgement call.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export type PositionRow = {
  id: string;
  profileId: string;
  title: string;
  organisation: string | null;
  startYear: number | null;
  endYear: number | null;
  isCurrent: boolean;
  description: string | null;
  sortOrder: number;
};

const SELECT = {
  id: true,
  profileId: true,
  title: true,
  organisation: true,
  startYear: true,
  endYear: true,
  isCurrent: true,
  description: true,
  sortOrder: true,
} as const;

async function listFor(profileId: string): Promise<PositionRow[]> {
  const rows = await db.position.findMany({
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

export async function createPositionAction(
  input: unknown,
): Promise<ActionResult<PositionRow[]>> {
  const session = await requireSession();
  await assertOwnsProfileRow({ profileId: session.profileId }, session);

  const parsed = positionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Check the highlighted fields.',
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  const last = await db.position.findFirst({
    where: { profileId: session.profileId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });

  // Explicit field list. Never spread the parsed object — profileId and sortOrder are
  // server-owned and must stay unwritable from input.
  await db.position.create({
    data: {
      profileId: session.profileId,
      title: parsed.data.title,
      organisation: parsed.data.organisation ?? null,
      startYear: parsed.data.startYear ?? null,
      endYear: parsed.data.endYear ?? null,
      isCurrent: parsed.data.isCurrent ?? false,
      description: parsed.data.description ?? null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });

  await recomputeCompleteness(session.profileId);
  revalidatePath('/dashboard/positions');
  return { ok: true, data: await listFor(session.profileId) };
}

export async function updatePositionAction(
  id: string,
  input: unknown,
): Promise<ActionResult<PositionRow[]>> {
  const session = await requireSession();

  const existing = await db.position.findUnique({
    where: { id },
    select: { id: true, profileId: true },
  });

  // 404 for a row owned by someone else, indistinguishable from one that does not exist.
  // `id` came from the client, so this is the IDOR guard.
  await assertOwnsProfileRow(existing, session);

  const parsed = positionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Check the highlighted fields.',
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  await db.position.update({
    where: { id },
    data: {
      title: parsed.data.title,
      organisation: parsed.data.organisation ?? null,
      startYear: parsed.data.startYear ?? null,
      endYear: parsed.data.endYear ?? null,
      isCurrent: parsed.data.isCurrent ?? false,
      description: parsed.data.description ?? null,
    },
  });

  await recomputeCompleteness(session.profileId);
  revalidatePath('/dashboard/positions');
  return { ok: true, data: await listFor(session.profileId) };
}

export async function deletePositionAction(
  id: string,
): Promise<ActionResult<PositionRow[]>> {
  const session = await requireSession();

  const existing = await db.position.findUnique({
    where: { id },
    select: { id: true, profileId: true },
  });

  await assertOwnsProfileRow(existing, session);

  await db.position.delete({ where: { id } });

  await recomputeCompleteness(session.profileId);
  revalidatePath('/dashboard/positions');
  return { ok: true, data: await listFor(session.profileId) };
}

/**
 * Reorder — a mutation on MANY rows.
 *
 * Every row is verified BEFORE any row is written. Checking inside the write loop would
 * leave the section half-reordered when the check fails partway through. The submitted set
 * must also match the owned set exactly, so ids cannot be omitted or repeated.
 */
export async function reorderPositionAction(
  input: unknown,
): Promise<ActionResult<PositionRow[]>> {
  const session = await requireSession();

  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'That reordering was not valid.' };
  const { ids } = parsed.data;

  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: 'That reordering was not valid.' };
  }

  const owned = await db.position.findMany({
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
      db.position.update({ where: { id }, data: { sortOrder: index } }),
    ),
  );

  revalidatePath('/dashboard/positions');
  return { ok: true, data: await listFor(session.profileId) };
}

export async function listPosition(): Promise<PositionRow[]> {
  const session = await requireSession();
  return listFor(session.profileId);
}
