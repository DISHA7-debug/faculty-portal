import { AccountStatus, Prisma } from '@prisma/client';

import { db } from '@/lib/db';
// The one in lib/validation/sections.ts — deliberately NOT reimplemented here. The editor
// previews with this exact function, so a name withheld in the editor is withheld here.
import { displayStudentName } from '@/lib/validation/sections';

/**
 * The public read path.
 *
 * ── Visibility is decided HERE, once ────────────────────────────────────────────────────
 *
 * Every other read in this app is scoped by ownership. This one is scoped by publication,
 * and it is the only query in the codebase that returns another person's profile to an
 * anonymous visitor. Two conditions gate it, and both are in the WHERE clause rather than
 * in a caller's `if`:
 *
 *   1. `isPublished` — the faculty member chose to be visible.
 *   2. `user.status === ACTIVE` — the institution still vouches for them.
 *
 * The second is not redundant. `assertCanPublishProfile` stops a PENDING_APPROVAL account
 * from publishing in the first place, but it says nothing about an account that published
 * while ACTIVE and was SUSPENDED afterwards — which is exactly the case where a page needs
 * to disappear immediately. Filtering on the live status means suspension takes effect on
 * the next render with no cleanup job and no chance of a missed row.
 *
 * Fetching (rather than filtering in the page) also means the private columns for a
 * withheld mobile number never leave Postgres. `showMobile: false` is applied by NOT
 * SELECTING the column, so it cannot leak through a serialised RSC payload, a debug dump,
 * or a future component that reads a field it was not supposed to.
 */

/** Sections in the order they appear on the page. The sub-nav is built from this. */
export const SECTION_ORDER = [
  'about',
  'research',
  'publications',
  'education',
  'positions',
  'projects',
  'guidance',
  'teaching',
  'awards',
  'memberships',
] as const;

export type SectionId = (typeof SECTION_ORDER)[number];

export const SECTION_LABELS: Record<SectionId, string> = {
  about: 'About',
  research: 'Research interests',
  publications: 'Publications',
  education: 'Education',
  positions: 'Positions',
  projects: 'Projects',
  guidance: 'Research guidance',
  teaching: 'Teaching',
  awards: 'Awards',
  memberships: 'Memberships',
};

/** Shorter labels for the sticky rail, where ten items have to fit on one line. */
export const SECTION_NAV_LABELS: Record<SectionId, string> = {
  ...SECTION_LABELS,
  research: 'Research',
  guidance: 'Guidance',
  memberships: 'Bodies',
};

const SECTIONS_SELECT = Prisma.validator<Prisma.ProfileSelect>()({
  educations: {
    orderBy: [{ sortOrder: 'asc' }, { yearTo: 'desc' }],
    select: {
      id: true,
      degree: true,
      level: true,
      field: true,
      institution: true,
      yearFrom: true,
      yearTo: true,
    },
  },
  publications: {
    // Newest first, then by the faculty member's own ordering within a year.
    orderBy: [{ year: 'desc' }, { sortOrder: 'asc' }],
    select: {
      id: true,
      type: true,
      title: true,
      authors: true,
      venue: true,
      volume: true,
      issue: true,
      pages: true,
      year: true,
      doi: true,
      url: true,
      publisher: true,
    },
  },
  positions: {
    orderBy: [{ sortOrder: 'asc' }],
    select: {
      id: true,
      title: true,
      organisation: true,
      startYear: true,
      endYear: true,
      isCurrent: true,
      description: true,
    },
  },
  awards: {
    orderBy: [{ sortOrder: 'asc' }],
    select: { id: true, title: true, awardedBy: true, year: true, description: true },
  },
  courses: {
    orderBy: [{ sortOrder: 'asc' }],
    select: { id: true, code: true, name: true, level: true, semester: true, year: true },
  },
  projects: {
    orderBy: [{ sortOrder: 'asc' }],
    select: {
      id: true,
      type: true,
      title: true,
      agency: true,
      role: true,
      status: true,
      startDate: true,
      endDate: true,
    },
  },
  guidances: {
    orderBy: [{ sortOrder: 'asc' }],
    // `studentName` IS selected, because displayStudentName() needs it to compute
    // initials. It is reduced to initials before it reaches any component — see
    // toPublicProfile() below, which is the only place raw names are handled.
    select: {
      id: true,
      studentName: true,
      nameDisplay: true,
      degree: true,
      topic: true,
      status: true,
      startYear: true,
      awardYear: true,
      coGuide: true,
    },
  },
  memberships: {
    orderBy: [{ sortOrder: 'asc' }],
    select: { id: true, body: true, membershipType: true, sinceYear: true },
  },
});

/**
 * Columns rendered on a public page.
 *
 * NOTE what is absent: `viewCount`, `completeness`, `userId`, `isPublished`, `searchVector`.
 * Not sensitive individually, but a public read has no use for them, and a select list is
 * only an allow-list if it stays one.
 */
const PROFILE_SELECT = Prisma.validator<Prisma.ProfileSelect>()({
  id: true,
  slug: true,
  fullName: true,
  designation: true,
  photoKey: true,
  photoBlurhash: true,
  about: true,
  researchInterests: true,
  officeNo: true,
  personalPageUrl: true,
  linkedinUrl: true,
  orcid: true,
  scopusId: true,
  googleScholarId: true,
  researcherId: true,
  cvKey: true,
  publishedAt: true,
  updatedAt: true,
  department: { select: { name: true, slug: true, code: true } },
  user: { select: { email: true } },

  // Selected so the mapper can decide. They are stripped from PublicProfile by the Omit
  // below, so no component can reach a withheld number even by mistake.
  showMobile: true,
  showAltEmail: true,
  mobile: true,
  altEmail: true,

  ...SECTIONS_SELECT,
});

type RawProfile = Prisma.ProfileGetPayload<{ select: typeof PROFILE_SELECT }>;

type PrivateColumn = 'guidances' | 'user' | 'mobile' | 'altEmail' | 'showMobile' | 'showAltEmail';

export type PublicProfile = Omit<RawProfile, PrivateColumn> & {
  /** Already reduced to the chosen display form. The raw name does not survive this type. */
  guidances: Array<Omit<RawProfile['guidances'][number], 'studentName' | 'nameDisplay'> & {
    displayName: string;
  }>;
  contact: {
    email: string;
    /** Present only when the faculty member ticked the corresponding visibility box. */
    mobile: string | null;
    altEmail: string | null;
  };
};

/**
 * Applies the two field-level privacy flags and the guidance name policy.
 *
 * Shared by the published page and the dashboard preview so that what a faculty member
 * previews is what a visitor gets — including the withholding. A preview that showed a
 * hidden mobile number "because it's your own page" would teach people the flag does not
 * work.
 */
function toPublicProfile(row: RawProfile): PublicProfile {
  const { guidances, user, mobile, altEmail, showMobile, showAltEmail, ...rest } = row;

  return {
    ...rest,
    guidances: guidances.map(({ studentName, nameDisplay, ...g }) => ({
      ...g,
      displayName: displayStudentName({ studentName, nameDisplay }),
    })),
    contact: {
      email: user.email,
      mobile: showMobile ? mobile : null,
      altEmail: showAltEmail ? altEmail : null,
    },
  };
}

/**
 * Loads a published profile by slug, or null.
 *
 * `null` rather than a thrown 404 so the caller decides — the page 404s, `generateMetadata`
 * returns nothing, and the preview path uses a different loader entirely.
 */
export async function getPublishedProfile(slug: string): Promise<PublicProfile | null> {
  const row = await db.profile.findFirst({
    where: {
      slug,
      isPublished: true,
      user: { status: AccountStatus.ACTIVE },
    },
    select: PROFILE_SELECT,
  });

  return row ? toPublicProfile(row) : null;
}

/**
 * Loads a profile by its OWNER for the dashboard preview, published or not.
 *
 * Takes a profileId that the caller has already established belongs to the session — this
 * function performs no authorisation of its own and must never be reachable from a route
 * that accepts an id from the request.
 */
export async function getOwnProfileForPreview(
  profileId: string,
): Promise<PublicProfile | null> {
  const row = await db.profile.findUnique({
    where: { id: profileId },
    select: PROFILE_SELECT,
  });

  return row ? toPublicProfile(row) : null;
}

/** Slugs to pre-render at build time. */
export async function listPublishedSlugs(): Promise<string[]> {
  const rows = await db.profile.findMany({
    where: { isPublished: true, user: { status: AccountStatus.ACTIVE } },
    select: { slug: true },
  });
  return rows.map((r) => r.slug);
}

/** Which sections actually have something to show. Drives the sub-nav. */
export function presentSections(profile: PublicProfile): SectionId[] {
  const has: Record<SectionId, boolean> = {
    about: Boolean(profile.about?.trim()),
    research: profile.researchInterests.length > 0,
    publications: profile.publications.length > 0,
    education: profile.educations.length > 0,
    positions: profile.positions.length > 0,
    projects: profile.projects.length > 0,
    guidance: profile.guidances.length > 0,
    teaching: profile.courses.length > 0,
    awards: profile.awards.length > 0,
    memberships: profile.memberships.length > 0,
  };
  return SECTION_ORDER.filter((id) => has[id]);
}
