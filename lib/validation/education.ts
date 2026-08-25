import { DegreeLevel } from '@prisma/client';
import { z } from 'zod';

/**
 * Education entries.
 *
 * `.strict()` so an unknown key is a rejection, not something quietly dropped — this is
 * what stops `{ ..., profileId: '<someone else>' }` from being partially honoured if a
 * handler ever spreads the parsed result (CLAUDE.md §3.3).
 *
 * Note what is NOT here: `profileId`, `sortOrder`, and `id`. Those are set by the server
 * from the session and from existing state. A client that supplies them is rejected.
 */

const currentYear = new Date().getFullYear();

/** Academic years, bounded so a typo cannot produce a year 12 digits long. */
const yearSchema = z
  .number()
  .int()
  .min(1900, 'Enter a year after 1900.')
  // A little headroom for an in-progress degree with an expected completion date.
  .max(currentYear + 10, `Enter a year up to ${currentYear + 10}.`);

export const educationSchema = z
  .object({
    degree: z
      .string()
      .trim()
      .min(1, 'Enter the degree, for example "Ph.D."')
      .max(120, 'Degree must be at most 120 characters.'),
    level: z.enum(DegreeLevel),
    field: z
      .string()
      .trim()
      .max(160, 'Field must be at most 160 characters.')
      .optional()
      .or(z.literal('')),
    institution: z
      .string()
      .trim()
      .min(1, 'Enter the awarding institution.')
      .max(200, 'Institution must be at most 200 characters.'),
    yearFrom: yearSchema.optional().nullable(),
    yearTo: yearSchema.optional().nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.yearFrom == null || value.yearTo == null || value.yearFrom <= value.yearTo,
    { message: 'The start year cannot be after the end year.', path: ['yearFrom'] },
  );

export type EducationInput = z.infer<typeof educationSchema>;

/**
 * Reorder payload: the full ordered list of row ids.
 *
 * The whole list rather than a moved-item delta, so the server can verify that the set
 * being written matches exactly the set the profile owns — a delta would let a caller
 * splice an id they do not own into someone else's ordering.
 */
export const reorderSchema = z
  .object({
    ids: z.array(z.cuid()).min(1).max(500),
  })
  .strict();
