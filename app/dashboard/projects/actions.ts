'use server';

import { revalidatePath } from 'next/cache';

import { assertOwnsProfileRow } from '@/lib/auth/ownership';
import { requireSession } from '@/lib/auth/session';
import { recomputeCompleteness } from '@/lib/completeness';
import { db } from '@/lib/db';
import { researchProjectSchema, reorderSchema } from '@/lib/validation/sections';

/**
 * ResearchProject section mutations.
 *
 * Explicit per entity, not generated at runtime: an ownership check inside a factory is
 * one line nobody reads. The full rationale is at the top of
 * app/dashboard/academics/actions.ts.
 *
 * Order on every mutation: requireSession -> assertOwnsProfileRow -> .strict() parse.
 *
 * amountLakhs is Prisma Decimal in the database and is carried as a string at every boundary, so a float never rounds a funding figure.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export type ResearchProjectRow = {
  id: string;
  profileId: string;
  title: string;
  type: string;
  agency: string | null;
  amountLakhs: string | null;
  role: string | null;
  status: string;
  sortOrder: number;
};

const SELECT = {
  id: true,
  profileId: true,
  title: true,
  type: true,
  agency: true,
  amountLakhs: true,
  role: true,
  status: true,
  sortOrder: true,
} as const;

async function listFor(profileId: string): Promise<ResearchProjectRow[]> {
  const rows = await db.researchProject.findMany({
    where: { profileId },
    select: SELECT,
    orderBy: { sortOrder: 'asc' },
  });
  // Decimal -> string at the boundary, so no funding figure passes through a float.
  return rows.map((row) => ({ ...row, amountLakhs: row.amountLakhs?.toString() ?? null }));
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

export async function createResearchProjectAction(
  input: unknown,
): Promise<ActionResult<ResearchProjectRow[]>> {
  const session = await requireSession();
  await assertOwnsProfileRow({ profileId: session.profileId }, session);

  const parsed = researchProjectSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Check the highlighted fields.',
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  const last = await db.researchProject.findFirst({
    where: { profileId: session.profileId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });

  // Explicit field list. Never spread the parsed object — profileId and sortOrder are
  // server-owned and must stay unwritable from input.
  await db.researchProject.create({
    data: {
      profileId: session.profileId,
      title: parsed.data.title,
      type: parsed.data.type,
      agency: parsed.data.agency ?? null,
      amountLakhs: parsed.data.amountLakhs ?? null,
      role: parsed.data.role ?? null,
      status: parsed.data.status,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });

  await recomputeCompleteness(session.profileId);
  revalidatePath('/dashboard/projects');
  return { ok: true, data: await listFor(session.profileId) };
}

export async function updateResearchProjectAction(
  id: string,
  input: unknown,
): Promise<ActionResult<ResearchProjectRow[]>> {
  const session = await requireSession();

  const existing = await db.researchProject.findUnique({
    where: { id },
    select: { id: true, profileId: true },
  });

  // 404 for a row owned by someone else, indistinguishable from one that does not exist.
  // `id` came from the client, so this is the IDOR guard.
  await assertOwnsProfileRow(existing, session);

  const parsed = researchProjectSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Check the highlighted fields.',
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  await db.researchProject.update({
    where: { id },
    data: {
      title: parsed.data.title,
      type: parsed.data.type,
      agency: parsed.data.agency ?? null,
      amountLakhs: parsed.data.amountLakhs ?? null,
      role: parsed.data.role ?? null,
      status: parsed.data.status,
    },
  });

  await recomputeCompleteness(session.profileId);
  revalidatePath('/dashboard/projects');
  return { ok: true, data: await listFor(session.profileId) };
}

export async function deleteResearchProjectAction(
  id: string,
): Promise<ActionResult<ResearchProjectRow[]>> {
  const session = await requireSession();

  const existing = await db.researchProject.findUnique({
    where: { id },
    select: { id: true, profileId: true },
  });

  await assertOwnsProfileRow(existing, session);

  await db.researchProject.delete({ where: { id } });

  await recomputeCompleteness(session.profileId);
  revalidatePath('/dashboard/projects');
  return { ok: true, data: await listFor(session.profileId) };
}

/**
 * Reorder — a mutation on MANY rows.
 *
 * Every row is verified BEFORE any row is written. Checking inside the write loop would
 * leave the section half-reordered when the check fails partway through. The submitted set
 * must also match the owned set exactly, so ids cannot be omitted or repeated.
 */
export async function reorderResearchProjectAction(
  input: unknown,
): Promise<ActionResult<ResearchProjectRow[]>> {
  const session = await requireSession();

  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'That reordering was not valid.' };
  const { ids } = parsed.data;

  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: 'That reordering was not valid.' };
  }

  const owned = await db.researchProject.findMany({
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
      db.researchProject.update({ where: { id }, data: { sortOrder: index } }),
    ),
  );

  revalidatePath('/dashboard/projects');
  return { ok: true, data: await listFor(session.profileId) };
}

export async function listResearchProject(): Promise<ResearchProjectRow[]> {
  const session = await requireSession();
  return listFor(session.profileId);
}
