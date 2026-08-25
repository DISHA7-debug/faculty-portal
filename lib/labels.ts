import type {
  CourseLevel,
  DegreeLevel,
  GuidanceDegree,
  GuidanceNameDisplay,
  GuidanceStatus,
  ProjectStatus,
  ProjectType,
  PublicationType,
} from '@prisma/client';

/**
 * Human labels for every enum, in ONE place.
 *
 * These started as private constants inside each dashboard section. The public profile
 * needs the same strings, and a second copy would eventually disagree — a faculty member
 * selecting "Journal article" in the editor and seeing "JOURNAL" on their public page is
 * the mild version; "Discontinued" rendering as "Completed" is the version that matters.
 *
 * Records are exhaustive by type, so adding an enum value to the schema fails typecheck
 * here rather than falling through to a raw SCREAMING_CASE string on a public page.
 */

export const PUBLICATION_TYPE_LABELS: Record<PublicationType, string> = {
  JOURNAL: 'Journal article',
  CONFERENCE: 'Conference paper',
  BOOK: 'Book',
  BOOK_CHAPTER: 'Book chapter',
  PATENT: 'Patent',
  OTHER: 'Other',
};

/** Plural forms, for the group headings on the public profile. */
export const PUBLICATION_TYPE_PLURALS: Record<PublicationType, string> = {
  JOURNAL: 'Journal articles',
  CONFERENCE: 'Conference papers',
  BOOK: 'Books',
  BOOK_CHAPTER: 'Book chapters',
  PATENT: 'Patents',
  OTHER: 'Other publications',
};

export const DEGREE_LEVEL_LABELS: Record<DegreeLevel, string> = {
  BACHELORS: "Bachelor's",
  MASTERS: "Master's",
  MPHIL: 'M.Phil.',
  PHD: 'Ph.D.',
  POSTDOC: 'Postdoctoral',
  DIPLOMA: 'Diploma',
  OTHER: 'Other',
};

export const COURSE_LEVEL_LABELS: Record<CourseLevel, string> = {
  UG: 'Undergraduate',
  PG: 'Postgraduate',
  PHD: 'Doctoral',
};

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  SPONSORED: 'Sponsored',
  CONSULTANCY: 'Consultancy',
  INTERNAL: 'Internal',
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  ONGOING: 'Ongoing',
  COMPLETED: 'Completed',
  SANCTIONED: 'Sanctioned',
};

export const GUIDANCE_DEGREE_LABELS: Record<GuidanceDegree, string> = {
  PHD: 'Ph.D.',
  MTECH: 'M.Tech.',
  MSC: 'M.Sc.',
  BTECH: 'B.Tech.',
};

export const GUIDANCE_STATUS_LABELS: Record<GuidanceStatus, string> = {
  ONGOING: 'Ongoing',
  COMPLETED: 'Completed',
  DISCONTINUED: 'Discontinued',
};

export const GUIDANCE_NAME_DISPLAY_LABELS: Record<GuidanceNameDisplay, string> = {
  INITIALS: 'Initials only (S. B.)',
  FULL_NAME: 'Full name',
};

/** `Record` lookup that tolerates a value the database has but the app has not shipped yet. */
export function labelOf<T extends string>(map: Record<T, string>, value: string): string {
  return (map as Record<string, string>)[value] ?? value;
}
