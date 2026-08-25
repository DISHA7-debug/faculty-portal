'use server';

import { revalidatePath } from 'next/cache';

import { assertOwnsProfileRow } from '@/lib/auth/ownership';
import { requireSession } from '@/lib/auth/session';
import { recomputeCompleteness } from '@/lib/completeness';
import { db } from '@/lib/db';
import { educationSchema, reorderSchema } from '@/lib/validation/education';

/**
 * Education section mutations.
 *
 * ── Why these are written out per entity rather than generated ───────────────────
 *
 * A generic `makeCrudActions(model, schema)` factory would remove perhaps forty lines of
 * repetition across the eight sections. It would also move the ownership check inside a
 * factory, where it becomes one line nobody reads, applied by a mechanism nobody traces,
 * to models nobody enumerates. That is precisely the shape of code that the check in
 * scripts/check-ownership.mjs exists to catch, and precisely the code an auditor cannot
 * confirm by reading.
 *
 * The repetition is the feature: every mutation shows requireSession, then
 * assertOwnsProfileRow, then a `.strict()` parse, in that order, in the same file as the
 * write it guards. The CLIENT side is where the genericity lives — see
 * components/dashboard/repeatable-section.tsx.
 *
 * ── The order matters ────────────────────────────────────────────────────────────
 *
 *   1. requireSession          — who is asking?
 *   2. assertOwnsProfileRow    — may they touch THIS row?  (404, never 403)
 *   3. schema.parse            — is the payload well formed?
 *
 * Validating before checking ownership would leak: a well-formed payload against a row
 * you do not own would return validation errors, while a malformed one against the same
 * row returns something else, and the difference reveals the row exists.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** Shape the client list renders. Ordered exactly as stored. */
export type EducationRow = {
  id: string;
  profileId: string;
  degree: string;
  level: string;
  field: string | null;
  institution: string;
  yearFrom: number | null;
  yearTo: number | null;
  sortOrder: number;
};

const SELECT = {
  id: true,
  profileId: true,
  degree: true,
  level: true,
  field: true,
  institution: true,
  yearFrom: true,
  yearTo: true,
  sortOrder: true,
} as const;

async function listFor(profileId: string): Promise<EducationRow[]> {
  return db.education.findMany({
    where: { profileId },
    select: SELECT,
    orderBy: { sortOrder: 'asc' },
  });
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

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createEducationAction(
  input: unknown,
): Promise<ActionResult<EducationRow[]>> {
  // 1. Authenticated?
  const session = await requireSession();

  // 2. Ownership. On create there is no existing row, so the row being created is
  //    synthesised against the session's own profile — the id is never taken from input.
  //    Routing it through the same helper keeps one code path for every mutation and
  //    satisfies the §1.4 check honestly rather than by exemption.
  await assertOwnsProfileRow({ profileId: session.profileId }, session);

  // 3. Validate.
  const parsed = educationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Check the highlighted fields.', fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const { degree, level, field, institution, yearFrom, yearTo } = parsed.data;

  // Append to the end. Computed server-side so the client cannot choose a position that
  // collides with another row.
  const last = await db.education.findFirst({
    where: { profileId: session.profileId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });

  await db.education.create({
    data: {
      profileId: session.profileId,
      degree,
      level,
      field: field?.trim() ? field.trim() : null,
      institution,
      yearFrom: yearFrom ?? null,
      yearTo: yearTo ?? null,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });

  await recomputeCompleteness(session.profileId);
  revalidatePath('/dashboard/academics');

  return { ok: true, data: await listFor(session.profileId) };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateEducationAction(
  id: string,
  input: unknown,
): Promise<ActionResult<EducationRow[]>> {
  const session = await requireSession();

  const existing = await db.education.findUnique({
    where: { id },
    select: { id: true, profileId: true },
  });

  // Raises 404 for a row owned by someone else, indistinguishably from one that does not
  // exist. This is the IDOR guard: `id` came from the client.
  await assertOwnsProfileRow(existing, session);

  const parsed = educationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Check the highlighted fields.', fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const { degree, level, field, institution, yearFrom, yearTo } = parsed.data;

  // Explicit field list. Never spread the parsed object — sortOrder and profileId must
  // not be writable from input even if the schema is later loosened.
  await db.education.update({
    where: { id },
    data: {
      degree,
      level,
      field: field?.trim() ? field.trim() : null,
      institution,
      yearFrom: yearFrom ?? null,
      yearTo: yearTo ?? null,
    },
  });

  await recomputeCompleteness(session.profileId);
  revalidatePath('/dashboard/academics');

  return { ok: true, data: await listFor(session.profileId) };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteEducationAction(
  id: string,
): Promise<ActionResult<EducationRow[]>> {
  const session = await requireSession();

  const existing = await db.education.findUnique({
    where: { id },
    select: { id: true, profileId: true },
  });

  await assertOwnsProfileRow(existing, session);

  await db.education.delete({ where: { id } });

  await recomputeCompleteness(session.profileId);
  revalidatePath('/dashboard/academics');

  return { ok: true, data: await listFor(session.profileId) };
}

// ---------------------------------------------------------------------------
// Reorder
// ---------------------------------------------------------------------------

/**
 * Reorder.
 *
 * This is a mutation on MANY rows, and the ownership check is therefore different in kind
 * from the single-row cases above. Two properties matter:
 *
 *   1. EVERY row is verified BEFORE ANY row is written. Checking inside the write loop
 *      would leave a partially reordered list when the check fails on row seven — the
 *      first six writes are already committed and the section is silently scrambled.
 *   2. The submitted set must match the owned set EXACTLY. Verifying only that each id is
 *      owned would still let a caller omit ids (leaving rows with stale positions) or
 *      repeat one. Comparing both directions closes that.
 */
export async function reorderEducationAction(
  input: unknown,
): Promise<ActionResult<EducationRow[]>> {
  const session = await requireSession();

  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'That reordering was not valid.' };
  }
  const { ids } = parsed.data;

  // Duplicate ids would assign two positions to one row.
  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: 'That reordering was not valid.' };
  }

  const owned = await db.education.findMany({
    where: { profileId: session.profileId },
    select: { id: true, profileId: true },
  });

  // Check every row up front. assertOwnsProfileRow raises 404 on the first foreign row,
  // before a single write has happened.
  const ownedById = new Map(owned.map((row) => [row.id, row]));
  for (const id of ids) {
    await assertOwnsProfileRow(ownedById.get(id) ?? null, session);
  }

  // Exact-set comparison. Same length plus every id owned implies a permutation.
  if (ids.length !== owned.length) {
    return { ok: false, error: 'The list changed while you were reordering. Refresh and try again.' };
  }

  // One transaction, so the section is never left half-reordered.
  await db.$transaction(
    ids.map((id, index) =>
      db.education.update({ where: { id }, data: { sortOrder: index } }),
    ),
  );

  revalidatePath('/dashboard/academics');

  // Reordering changes no counts, so completeness is unaffected and is not recomputed.
  return { ok: true, data: await listFor(session.profileId) };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** Server-component read. Scoped to the session's own profile by construction. */
export async function listEducation(): Promise<EducationRow[]> {
  const session = await requireSession();
  return listFor(session.profileId);
}
