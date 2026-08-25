'use server';

import { revalidatePath } from 'next/cache';

import { assertOwnsProfileRow } from '@/lib/auth/ownership';
import { requireSession } from '@/lib/auth/session';
import { recomputeCompleteness } from '@/lib/completeness';
import { db } from '@/lib/db';
import { membershipSchema, reorderSchema } from '@/lib/validation/sections';

/**
 * Membership section mutations.
 *
 * Explicit per entity, not generated at runtime: an ownership check inside a factory is
 * one line nobody reads. The full rationale is at the top of
 * app/dashboard/academics/actions.ts.
 *
 * Order on every mutation: requireSession -> assertOwnsProfileRow -> .strict() parse.
 *
 * Membership numbers are personal identifiers, so they are stored but never surfaced on the public profile.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export type MembershipRow = {
  id: string;
  profileId: string;
  body: string;
  membershipType: string | null;
  sinceYear: number | null;
  membershipNo: string | null;
  sortOrder: number;
};

const SELECT = {
  id: true,
  profileId: true,
  body: true,
  membershipType: true,
  sinceYear: true,
  membershipNo: true,
  sortOrder: true,
} as const;

async function listFor(profileId: string): Promise<MembershipRow[]> {
  const rows = await db.membership.findMany({
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

export async function createMembershipAction(
  input: unknown,
): Promise<ActionResult<MembershipRow[]>> {
  const session = await requireSession();
  await assertOwnsProfileRow({ profileId: session.profileId }, session);

  const parsed = membershipSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Check the highlighted fields.',
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  const last = await db.membership.findFirst({
    where: { profileId: session.profileId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });

  // Explicit field list. Never spread the parsed object — profileId and sortOrder are
  // server-owned and must stay unwritable from input.
  await db.membership.create({
    data: {
      profileId: session.profileId,
      body: parsed.data.body,
      membershipType: parsed.data.membershipType ?? null,
      sinceYear: parsed.data.sinceYear ?? null,
      membershipNo: parsed.data.membershipNo ?? null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });

  await recomputeCompleteness(session.profileId);
  revalidatePath('/dashboard/positions');
  return { ok: true, data: await listFor(session.profileId) };
}

export async function updateMembershipAction(
  id: string,
  input: unknown,
): Promise<ActionResult<MembershipRow[]>> {
  const session = await requireSession();

  const existing = await db.membership.findUnique({
    where: { id },
    select: { id: true, profileId: true },
  });

  // 404 for a row owned by someone else, indistinguishable from one that does not exist.
  // `id` came from the client, so this is the IDOR guard.
  await assertOwnsProfileRow(existing, session);

  const parsed = membershipSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Check the highlighted fields.',
      fieldErrors: fieldErrorsFrom(parsed.error),
    };
  }

  await db.membership.update({
    where: { id },
    data: {
      body: parsed.data.body,
      membershipType: parsed.data.membershipType ?? null,
      sinceYear: parsed.data.sinceYear ?? null,
      membershipNo: parsed.data.membershipNo ?? null,
    },
  });

  await recomputeCompleteness(session.profileId);
  revalidatePath('/dashboard/positions');
  return { ok: true, data: await listFor(session.profileId) };
}

export async function deleteMembershipAction(
  id: string,
): Promise<ActionResult<MembershipRow[]>> {
  const session = await requireSession();

  const existing = await db.membership.findUnique({
    where: { id },
    select: { id: true, profileId: true },
  });

  await assertOwnsProfileRow(existing, session);

  await db.membership.delete({ where: { id } });

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
export async function reorderMembershipAction(
  input: unknown,
): Promise<ActionResult<MembershipRow[]>> {
  const session = await requireSession();

  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'That reordering was not valid.' };
  const { ids } = parsed.data;

  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: 'That reordering was not valid.' };
  }

  const owned = await db.membership.findMany({
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
      db.membership.update({ where: { id }, data: { sortOrder: index } }),
    ),
  );

  revalidatePath('/dashboard/positions');
  return { ok: true, data: await listFor(session.profileId) };
}

export async function listMembership(): Promise<MembershipRow[]> {
  const session = await requireSession();
  return listFor(session.profileId);
}
