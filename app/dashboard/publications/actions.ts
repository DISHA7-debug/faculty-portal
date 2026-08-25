'use server';

import { revalidatePath } from 'next/cache';

import { assertOwnsProfileRow } from '@/lib/auth/ownership';
import { requireSession } from '@/lib/auth/session';
import { recomputeCompleteness } from '@/lib/completeness';
import { db } from '@/lib/db';
import { publicationSchema } from '@/lib/validation/publication';
import { reorderSchema } from '@/lib/validation/education';

/**
 * Publication section mutations.
 *
 * Written out explicitly for the same reason as Education: an ownership check hidden in a
 * factory is unauditable. See the note at the top of app/dashboard/academics/actions.ts.
 *
 * Order on every mutation: requireSession -> assertOwnsProfileRow -> .strict() parse.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export type PublicationRow = {
  id: string;
  profileId: string;
  type: string;
  title: string;
  authors: string;
  venue: string | null;
  year: number | null;
  doi: string | null;
  url: string | null;
  publisher: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  sortOrder: number;
};

const SELECT = {
  id: true, profileId: true, type: true, title: true, authors: true,
  venue: true, year: true, doi: true, url: true, publisher: true,
  volume: true, issue: true, pages: true, sortOrder: true,
} as const;

async function listFor(profileId: string): Promise<PublicationRow[]> {
  return db.publication.findMany({
    where: { profileId },
    select: SELECT,
    // Newest first is the academic convention; sortOrder breaks ties and honours
    // manual reordering.
    orderBy: [{ sortOrder: 'asc' }],
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

/**
 * Turns a `@@unique([profileId, doi])` violation into a message that names the paper it
 * collided with.
 *
 * "A publication with this DOI already exists" is not actionable: the user cannot tell
 * whether they genuinely added the paper twice, or mistyped one digit of a DIFFERENT
 * paper's DOI and hit an unrelated entry. Naming the existing title answers that
 * immediately.
 *
 * Safe to disclose: the conflicting row is looked up scoped to the caller's OWN profile,
 * so it is always a paper they entered themselves.
 */
async function doiConflictMessage(
  profileId: string,
  doi: string | null,
  excludeId?: string,
): Promise<string> {
  if (!doi) {
    // A DOI-less collision should be impossible — NULLs are distinct in Postgres — so if
    // this is ever reached, the normalisation in lib/validation/publication.ts has
    // regressed and '' is being stored instead of NULL.
    return 'That publication conflicts with an existing entry.';
  }

  const existing = await db.publication.findFirst({
    where: { profileId, doi, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { title: true },
  });

  if (!existing) {
    return `A publication with DOI ${doi} already exists in your profile.`;
  }

  return (
    `You have already added a publication with DOI ${doi}: “${existing.title}”. ` +
    `If this is a different paper, check the DOI for a typo.`
  );
}

function isDoiConflict(error: unknown): boolean {
  const e = error as { code?: string; meta?: { target?: unknown } };
  if (e?.code !== 'P2002') return false;
  const raw = e.meta?.target;
  const fields = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : [];
  return fields.join(',').toLowerCase().includes('doi');
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createPublicationAction(
  input: unknown,
): Promise<ActionResult<PublicationRow[]>> {
  const session = await requireSession();
  await assertOwnsProfileRow({ profileId: session.profileId }, session);

  const parsed = publicationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Check the highlighted fields.', fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  const last = await db.publication.findFirst({
    where: { profileId: session.profileId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });

  try {
    await db.publication.create({
      data: {
        profileId: session.profileId,
        type: parsed.data.type,
        title: parsed.data.title,
        authors: parsed.data.authors,
        venue: parsed.data.venue,
        year: parsed.data.year ?? null,
        doi: parsed.data.doi,
        url: parsed.data.url,
        publisher: parsed.data.publisher,
        volume: parsed.data.volume,
        issue: parsed.data.issue,
        pages: parsed.data.pages,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
  } catch (error) {
    if (isDoiConflict(error)) {
      const message = await doiConflictMessage(session.profileId, parsed.data.doi);
      return { ok: false, error: message, fieldErrors: { doi: [message] } };
    }
    throw error;
  }

  await recomputeCompleteness(session.profileId);
  revalidatePath('/dashboard/publications');

  return { ok: true, data: await listFor(session.profileId) };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updatePublicationAction(
  id: string,
  input: unknown,
): Promise<ActionResult<PublicationRow[]>> {
  const session = await requireSession();

  const existing = await db.publication.findUnique({
    where: { id },
    select: { id: true, profileId: true },
  });

  await assertOwnsProfileRow(existing, session);

  const parsed = publicationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Check the highlighted fields.', fieldErrors: fieldErrorsFrom(parsed.error) };
  }

  try {
    await db.publication.update({
      where: { id },
      data: {
        type: parsed.data.type,
        title: parsed.data.title,
        authors: parsed.data.authors,
        venue: parsed.data.venue,
        year: parsed.data.year ?? null,
        doi: parsed.data.doi,
        url: parsed.data.url,
        publisher: parsed.data.publisher,
        volume: parsed.data.volume,
        issue: parsed.data.issue,
        pages: parsed.data.pages,
      },
    });
  } catch (error) {
    if (isDoiConflict(error)) {
      // Exclude this row, so editing a publication without changing its DOI cannot
      // report a conflict with itself.
      const message = await doiConflictMessage(session.profileId, parsed.data.doi, id);
      return { ok: false, error: message, fieldErrors: { doi: [message] } };
    }
    throw error;
  }

  await recomputeCompleteness(session.profileId);
  revalidatePath('/dashboard/publications');

  return { ok: true, data: await listFor(session.profileId) };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deletePublicationAction(
  id: string,
): Promise<ActionResult<PublicationRow[]>> {
  const session = await requireSession();

  const existing = await db.publication.findUnique({
    where: { id },
    select: { id: true, profileId: true },
  });

  await assertOwnsProfileRow(existing, session);

  await db.publication.delete({ where: { id } });

  await recomputeCompleteness(session.profileId);
  revalidatePath('/dashboard/publications');

  return { ok: true, data: await listFor(session.profileId) };
}

// ---------------------------------------------------------------------------
// Reorder
// ---------------------------------------------------------------------------

/** Every row verified BEFORE any write — see the note in the Education action. */
export async function reorderPublicationAction(
  input: unknown,
): Promise<ActionResult<PublicationRow[]>> {
  const session = await requireSession();

  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'That reordering was not valid.' };
  const { ids } = parsed.data;

  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: 'That reordering was not valid.' };
  }

  const owned = await db.publication.findMany({
    where: { profileId: session.profileId },
    select: { id: true, profileId: true },
  });

  const ownedById = new Map(owned.map((row) => [row.id, row]));
  for (const id of ids) {
    await assertOwnsProfileRow(ownedById.get(id) ?? null, session);
  }

  if (ids.length !== owned.length) {
    return { ok: false, error: 'The list changed while you were reordering. Refresh and try again.' };
  }

  await db.$transaction(
    ids.map((id, index) =>
      db.publication.update({ where: { id }, data: { sortOrder: index } }),
    ),
  );

  revalidatePath('/dashboard/publications');
  return { ok: true, data: await listFor(session.profileId) };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function listPublications(): Promise<PublicationRow[]> {
  const session = await requireSession();
  return listFor(session.profileId);
}
