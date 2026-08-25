import {
  CourseLevel,
  GuidanceDegree,
  GuidanceNameDisplay,
  GuidanceStatus,
  ProjectStatus,
  ProjectType,
} from '@prisma/client';
import { z } from 'zod';

/**
 * Schemas for the remaining repeatable sections.
 *
 * Grouped in one file because they share the same small vocabulary of helpers; the SERVER
 * ACTIONS stay one file per entity, where the ownership check has to be legible.
 *
 * Every object is `.strict()`. Blank optional text becomes `null` rather than `''`, for
 * the same reason as the DOI field: an empty string is a value, and storing one makes
 * "not provided" indistinguishable from "provided as empty" in every later query.
 */

const currentYear = new Date().getFullYear();

export const optionalText = (max: number, label: string) =>
  z
    .string()
    .max(max, `${label} must be at most ${max} characters.`)
    .optional()
    .nullable()
    .transform((value) => {
      const trimmed = value?.trim() ?? '';
      return trimmed === '' ? null : trimmed;
    });

export const optionalYear = (label = 'Year') =>
  z
    .number()
    .int()
    .min(1800, `${label} must be after 1800.`)
    .max(currentYear + 10, `${label} must be at most ${currentYear + 10}.`)
    .optional()
    .nullable();

const requiredText = (max: number, message: string) =>
  z.string().trim().min(1, message).max(max);

/** Shared reorder payload — the full ordered id list. */
export const reorderSchema = z
  .object({ ids: z.array(z.cuid()).min(1).max(500) })
  .strict();

// ---------------------------------------------------------------------------

export const positionSchema = z
  .object({
    title: requiredText(200, 'Enter the position title.'),
    organisation: optionalText(200, 'Organisation'),
    startYear: optionalYear('Start year'),
    endYear: optionalYear('End year'),
    isCurrent: z.boolean().optional().default(false),
    description: optionalText(1000, 'Description'),
  })
  .strict()
  .refine(
    (v) => v.startYear == null || v.endYear == null || v.startYear <= v.endYear,
    { message: 'The start year cannot be after the end year.', path: ['startYear'] },
  );

export const awardSchema = z
  .object({
    title: requiredText(200, 'Enter the award title.'),
    awardedBy: optionalText(200, 'Awarding body'),
    year: optionalYear(),
    description: optionalText(1000, 'Description'),
  })
  .strict();

export const courseSchema = z
  .object({
    name: requiredText(200, 'Enter the course name.'),
    code: optionalText(40, 'Course code'),
    level: z.enum(CourseLevel),
    semester: optionalText(40, 'Semester'),
    year: optionalYear(),
  })
  .strict();

export const researchProjectSchema = z
  .object({
    title: requiredText(500, 'Enter the project title.'),
    type: z.enum(ProjectType),
    agency: optionalText(200, 'Funding agency'),
    // Kept as a string through validation and converted at the boundary: Prisma's Decimal
    // is exact, and routing money through a JS float first would defeat that.
    amountLakhs: z
      .string()
      .optional()
      .nullable()
      .transform((v) => {
        const trimmed = v?.trim() ?? '';
        return trimmed === '' ? null : trimmed;
      })
      .refine((v) => v === null || /^\d{1,9}(\.\d{1,2})?$/.test(v), {
        message: 'Enter an amount in lakhs, for example 42.50',
      }),
    role: optionalText(120, 'Role'),
    status: z.enum(ProjectStatus),
  })
  .strict();

/**
 * Renders a student's name as initials: "Sunita Banerjee" -> "S. B."
 *
 * Exported so the public profile in Sprint 4 uses the same function the editor previews
 * with — two implementations would eventually disagree, and the one that disagreed in the
 * public direction would publish a name that was meant to be withheld.
 */
export function toInitials(fullName: string): string {
  const parts = fullName
    .trim()
    .split(/\s+/)
    .filter((p) => /[A-Za-z\u00C0-\u024F]/.test(p));

  if (parts.length === 0) return '—';

  return parts
    .map((part) => `${part.replace(/[^A-Za-z\u00C0-\u024F]/g, '').charAt(0).toUpperCase()}.`)
    .filter((p) => p !== '.')
    .join(' ');
}

/** How a supervised student's name appears publicly. See docs/SECURITY.md §11. */
export function displayStudentName(row: {
  studentName: string;
  nameDisplay: string;
}): string {
  return row.nameDisplay === GuidanceNameDisplay.FULL_NAME
    ? row.studentName
    : toInitials(row.studentName);
}

/**
 * Default display form when the caller does not choose one.
 *
 * INITIALS for a CURRENT student, whose supervision is ongoing and who has agreed to
 * nothing; FULL_NAME once COMPLETED, matching normal academic practice for a finished
 * thesis, which is a published document naming its author. DISCONTINUED stays initials —
 * that is the most sensitive case of all.
 */
export function defaultNameDisplay(status: string): GuidanceNameDisplay {
  return status === GuidanceStatus.COMPLETED
    ? GuidanceNameDisplay.FULL_NAME
    : GuidanceNameDisplay.INITIALS;
}

export const guidanceSchema = z
  .object({
    studentName: requiredText(160, "Enter the student's name."),
    // Optional: omitted means "use the default for this status", computed server-side.
    nameDisplay: z.enum(GuidanceNameDisplay).optional(),
    degree: z.enum(GuidanceDegree),
    topic: optionalText(500, 'Topic'),
    status: z.enum(GuidanceStatus),
    startYear: optionalYear('Start year'),
    awardYear: optionalYear('Award year'),
    coGuide: optionalText(160, 'Co-guide'),
  })
  .strict()
  .refine(
    (v) => v.startYear == null || v.awardYear == null || v.startYear <= v.awardYear,
    { message: 'The start year cannot be after the award year.', path: ['startYear'] },
  );

export const membershipSchema = z
  .object({
    body: requiredText(200, 'Enter the professional body.'),
    membershipType: optionalText(120, 'Membership type'),
    sinceYear: optionalYear('Year'),
    membershipNo: optionalText(80, 'Membership number'),
  })
  .strict();
