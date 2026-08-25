'use server';

import { revalidatePath } from 'next/cache';

import { assertOwnsProfileRow } from '@/lib/auth/ownership';
import { requireSession } from '@/lib/auth/session';
import { recomputeCompleteness } from '@/lib/completeness';
import { db } from '@/lib/db';
import {
  defaultNameDisplay,
  guidanceSchema,
  reorderSchema,
} from '@/lib/validation/sections';

/**
 * Guidance section mutations.
 *
 * Explicit per entity, not generated at runtime: an ownership check inside a factory is
 * one line nobody reads. The full rationale is at the top of
 * app/dashboard/academics/actions.ts.
 *
 * Order on every mutation: requireSession -> assertOwnsProfileRow -> .strict() parse.
 *
 * Student names are personal data about a third party; only what a public academic profile needs is collected (docs/SECURITY.md §11).
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export type GuidanceRow = {
  id: string;
  profileId: string;
  studentName: string;
  nameDisplay: string;
  degree: string;
  topic: string | null;
  status: string;
  startYear: number | null;
  awardYear: number | null;
  coGuide: string | null;
  sortOrder: number;
};

const SELECT = {
  id: true,
  profileId: true,
  studentName: true,
  nameDisplay: true,
  degree: true,
  topic: true,
  status: true,
  startYear: true,
  awardYear: true,
  coGuide: true,
  sortOrder: true,
} as const;

async function listFor(profileId: string): Promise<GuidanceRow[]> {
  const rows = await db.guidance.findMany({
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

export async function createGuidanceAction(
  input: unknown,
): Promise<ActionResult<GuidanceRow[]>> {
  const session = await requireSession();
  await assertOwnsProfileRow({ profileId: session.profileId }, session);

  const parsed = guidanceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Check the highlighted fields.',
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  const last = await db.guidance.findFirst({
    where: { profileId: session.profileId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });

  // Explicit field list. Never spread the parsed object — profileId and sortOrder are
  // server-owned and must stay unwritable from input.
  await db.guidance.create({
    data: {
      profileId: session.profileId,
      studentName: parsed.data.studentName,
      // Private-by-default: an omitted choice resolves to INITIALS unless the supervision
      // is COMPLETED. docs/SECURITY.md §11.
      nameDisplay: parsed.data.nameDisplay ?? defaultNameDisplay(parsed.data.status),
      degree: parsed.data.degree,
      topic: parsed.data.topic ?? null,
      status: parsed.data.status,
      startYear: parsed.data.startYear ?? null,
      awardYear: parsed.data.awardYear ?? null,
      coGuide: parsed.data.coGuide ?? null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });

  await recomputeCompleteness(session.profileId);
  revalidatePath('/dashboard/guidance');
  return { ok: true, data: await listFor(session.profileId) };
}

export async function updateGuidanceAction(
  id: string,
  input: unknown,
): Promise<ActionResult<GuidanceRow[]>> {
  const session = await requireSession();

  const existing = await db.guidance.findUnique({
    where: { id },
    select: { id: true, profileId: true },
  });

  // 404 for a row owned by someone else, indistinguishable from one that does not exist.
  // `id` came from the client, so this is the IDOR guard.
  await assertOwnsProfileRow(existing, session);

  const parsed = guidanceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Check the highlighted fields.',
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  await db.guidance.update({
    where: { id },
    data: {
      studentName: parsed.data.studentName,
      // Private-by-default: an omitted choice resolves to INITIALS unless the supervision
      // is COMPLETED. docs/SECURITY.md §11.
      nameDisplay: parsed.data.nameDisplay ?? defaultNameDisplay(parsed.data.status),
      degree: parsed.data.degree,
      topic: parsed.data.topic ?? null,
      status: parsed.data.status,
      startYear: parsed.data.startYear ?? null,
      awardYear: parsed.data.awardYear ?? null,
      coGuide: parsed.data.coGuide ?? null,
    },
  });

  await recomputeCompleteness(session.profileId);
  revalidatePath('/dashboard/guidance');
  return { ok: true, data: await listFor(session.profileId) };
}

export async function deleteGuidanceAction(
  id: string,
): Promise<ActionResult<GuidanceRow[]>> {
  const session = await requireSession();

  const existing = await db.guidance.findUnique({
    where: { id },
    select: { id: true, profileId: true },
  });

  await assertOwnsProfileRow(existing, session);

  await db.guidance.delete({ where: { id } });

  await recomputeCompleteness(session.profileId);
  revalidatePath('/dashboard/guidance');
  return { ok: true, data: await listFor(session.profileId) };
}

/**
 * Reorder — a mutation on MANY rows.
 *
 * Every row is verified BEFORE any row is written. Checking inside the write loop would
 * leave the section half-reordered when the check fails partway through. The submitted set
 * must also match the owned set exactly, so ids cannot be omitted or repeated.
 */
export async function reorderGuidanceAction(
  input: unknown,
): Promise<ActionResult<GuidanceRow[]>> {
  const session = await requireSession();

  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'That reordering was not valid.' };
  const { ids } = parsed.data;

  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: 'That reordering was not valid.' };
  }

  const owned = await db.guidance.findMany({
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
      db.guidance.update({ where: { id }, data: { sortOrder: index } }),
    ),
  );

  revalidatePath('/dashboard/guidance');
  return { ok: true, data: await listFor(session.profileId) };
}

export async function listGuidance(): Promise<GuidanceRow[]> {
  const session = await requireSession();
  return listFor(session.profileId);
}
