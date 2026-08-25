import { PublicationType } from '@prisma/client';
import { z } from 'zod';

/**
 * Publications.
 *
 * The DOI handling below lives in the SCHEMA rather than in the server action on purpose.
 * Sprint 5 adds ORCID sync, CrossRef import, and BibTeX upload (PROJECT_PLAN §3.5), and
 * every one of those writes publications without going near the form's action. Anything
 * enforced only in the action is enforced only for hand-typed entries.
 */

const currentYear = new Date().getFullYear();

/**
 * Canonicalises a DOI, or returns null.
 *
 * Exported so the Sprint 5 importers call the same function rather than reimplementing
 * it — the whole point of `@@unique([profileId, doi])` is dedup across those paths.
 *
 * Two distinct jobs:
 *
 *  1. EMPTY STRING -> NULL. An untouched DOI input submits `''`, and `''` is a value:
 *     Postgres treats two empty strings as equal, so the SECOND publication without a DOI
 *     would violate the unique constraint and be reported as a duplicate DOI on two
 *     papers that have no DOI at all. NULL is the only value Postgres treats as distinct
 *     from itself, which is exactly the "no DOI" semantics wanted here.
 *
 *  2. STRIP PREFIXES AND CASE. The same paper is pasted as
 *         https://doi.org/10.1109/TPDS.2024.123
 *         doi:10.1109/TPDS.2024.123
 *         10.1109/tpds.2024.123
 *     Without canonicalisation those are three distinct strings, the unique constraint
 *     never fires, and the dedup it exists for catches nothing. DOIs are
 *     case-insensitive by specification, so lowercasing is safe.
 */
export function canonicaliseDoi(value: string | null | undefined): string | null {
  if (value == null) return null;

  let doi = value.trim();
  if (doi === '') return null;

  // Resolver URLs, in the forms people actually paste.
  doi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  doi = doi.replace(/^https?:\/\/doi\.org\//i, '');
  // `doi:` / `DOI:` / `doi: ` prefixes.
  doi = doi.replace(/^doi:\s*/i, '');
  // Some exports wrap it in angle brackets.
  doi = doi.replace(/^<|>$/g, '');

  doi = doi.trim().toLowerCase();

  return doi === '' ? null : doi;
}

/**
 * A DOI is `10.<registrant>/<suffix>`. Validated after canonicalisation so a pasted
 * resolver URL is accepted, and kept loose on the suffix, which may contain almost
 * anything.
 */
const DOI_SHAPE = /^10\.\d{4,9}\/\S+$/;

export const doiField = z
  .string()
  .max(300, 'DOI must be at most 300 characters.')
  .optional()
  .nullable()
  .transform(canonicaliseDoi)
  .refine((value) => value === null || DOI_SHAPE.test(value), {
    message:
      'That does not look like a DOI. Expected something like 10.1109/TPDS.2024.123 — ' +
      'a full doi.org link is fine too.',
  });

/** Optional free text: empty string becomes null so it is not stored as ''. */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .max(max, `${label} must be at most ${max} characters.`)
    .optional()
    .nullable()
    .transform((value) => {
      const trimmed = value?.trim() ?? '';
      return trimmed === '' ? null : trimmed;
    });

const yearField = z
  .number()
  .int()
  .min(1800, 'Enter a year after 1800.')
  .max(currentYear + 5, `Enter a year up to ${currentYear + 5}.`)
  .optional()
  .nullable();

export const publicationSchema = z
  .object({
    type: z.enum(PublicationType),
    title: z
      .string()
      .trim()
      .min(1, 'Enter the title.')
      .max(500, 'Title must be at most 500 characters.'),
    authors: z
      .string()
      .trim()
      .min(1, 'Enter the authors, as they appear on the paper.')
      .max(1000, 'Authors must be at most 1000 characters.'),
    venue: optionalText(300, 'Venue'),
    year: yearField,
    doi: doiField,
    url: optionalText(500, 'URL').refine(
      (value) => value === null || /^https:\/\//i.test(value),
      { message: 'Links must start with https://' },
    ),
    publisher: optionalText(200, 'Publisher'),
    volume: optionalText(40, 'Volume'),
    issue: optionalText(40, 'Issue'),
    pages: optionalText(40, 'Pages'),
  })
  .strict();

export type PublicationInput = z.infer<typeof publicationSchema>;
