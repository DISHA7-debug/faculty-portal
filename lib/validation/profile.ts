import { z } from 'zod';

import { checkOrcid } from '@/lib/validation/orcid';

/**
 * Personal details.
 *
 * The allow-list IS this schema. `.strict()` rejects any key not named here, so the fields
 * a profile update must never be able to set — `role`, `status`, `userId`, `isPublished`,
 * `completeness`, `viewCount`, `slug` — are unsettable by construction rather than by a
 * handler remembering to filter them (CLAUDE.md §3.3).
 *
 * `slug` is excluded deliberately even though the faculty member may legitimately change
 * it before first publish: it has its own guarded path (PROJECT_PLAN §4.3.1), because
 * after `publishedAt` is set it is frozen and only a SUPER_ADMIN may override, with an
 * audit row. Folding that into the general update would lose the guard.
 */

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

/** Optional https URL. Blank becomes null rather than an empty string. */
const optionalHttpsUrl = (label: string) =>
  optionalText(300, label).refine(
    (value) => value === null || /^https:\/\/\S+\.\S+/.test(value),
    { message: `${label} must be a full https:// address.` },
  );

export const profileUpdateSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, 'Enter your full name.')
      .max(120, 'Name must be at most 120 characters.'),

    designation: optionalText(120, 'Designation'),
    officeNo: optionalText(60, 'Office'),

    mobile: optionalText(30, 'Mobile number').refine(
      (value) => value === null || /^[\d+\s()-]{7,20}$/.test(value),
      { message: 'Enter a valid phone number, or leave it blank.' },
    ),

    altEmail: optionalText(254, 'Alternative email').refine(
      (value) => value === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
      { message: 'Enter a valid email address, or leave it blank.' },
    ),

    about: optionalText(5000, 'Biography'),
    personalPageUrl: optionalHttpsUrl('Personal page'),
    linkedinUrl: optionalHttpsUrl('LinkedIn'),

    /**
     * ORCID, validated by CHECK DIGIT and not merely by shape.
     *
     * Stored in canonical hyphenated form, so a pasted orcid.org URL and a bare identifier
     * end up identical. See lib/validation/orcid.ts for why the checksum matters on a
     * public page.
     */
    orcid: optionalText(60, 'ORCID')
      .transform((value) => {
        if (value === null) return null;
        const result = checkOrcid(value);
        return result.valid ? result.formatted : value;
      })
      .refine((value) => value === null || checkOrcid(value).valid, {
        message:
          'That ORCID is not valid — check the digits. An incorrect iD on a public ' +
          'profile points visitors at the wrong researcher.',
      }),

    scopusId: optionalText(40, 'Scopus ID'),
    googleScholarId: optionalText(40, 'Google Scholar ID'),
    researcherId: optionalText(40, 'ResearcherID'),

    /** Field-level privacy. Defaults match the schema: mobile hidden, alt email shown. */
    showMobile: z.boolean(),
    showAltEmail: z.boolean(),
  })
  .strict();

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

/**
 * Research interests.
 *
 * Capped at 15 by the same rule the UI shows, so a client that bypasses the tag input
 * cannot store 500 of them.
 */
export const researchInterestsSchema = z
  .object({
    interests: z
      .array(
        z
          .string()
          .trim()
          .min(1, 'An interest cannot be blank.')
          .max(60, 'Each interest must be at most 60 characters.'),
      )
      .max(15, 'Up to 15 research interests.'),
  })
  .strict();
