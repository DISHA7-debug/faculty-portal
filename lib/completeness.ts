import { db } from '@/lib/db';

/**
 * Profile completeness, 0–100.
 *
 * Recomputed on every section mutation rather than derived at read time, because the
 * public directory sorts and filters on it and the dashboard shows it on every page —
 * both would otherwise repeat this aggregation on every request.
 *
 * The weights encode what makes a profile USEFUL to a visitor, not how much of the form
 * has been touched. A name and designation with nothing else is a stub; publications and
 * research interests are what someone actually came to find. Deliberately reaching 100
 * should require a profile that is genuinely worth reading.
 */

type Weights = {
  /** Field is present and non-empty. */
  key: string;
  points: number;
};

const PROFILE_FIELDS: Weights[] = [
  { key: 'fullName', points: 5 },
  { key: 'designation', points: 8 },
  { key: 'about', points: 12 },
  { key: 'photoKey', points: 10 },
  { key: 'officeNo', points: 3 },
  { key: 'cvKey', points: 5 },
  { key: 'orcid', points: 4 },
];

/** Sections score on a curve: the first entry is worth most, later ones taper. */
const SECTION_WEIGHTS = {
  researchInterests: { max: 12, target: 3 },
  educations: { max: 10, target: 3 },
  publications: { max: 18, target: 5 },
  positions: { max: 5, target: 2 },
  courses: { max: 4, target: 2 },
  awards: { max: 4, target: 2 },
} as const;

/**
 * Diminishing returns: the first entry earns most of the section's points and further
 * entries add less. A profile with one publication is enormously better than none; the
 * fortieth changes little for a visitor.
 */
function taperedScore(count: number, max: number, target: number): number {
  if (count <= 0) return 0;
  if (count >= target) return max;
  return Math.round(max * (Math.log1p(count) / Math.log1p(target)));
}

export type CompletenessBreakdown = {
  score: number;
  /** Ordered by points available, so the UI can nudge toward the biggest win first. */
  missing: Array<{ label: string; points: number }>;
};

/** Human labels for the nudges shown beside the meter. */
const LABELS: Record<string, string> = {
  designation: 'Add your designation',
  about: 'Write a short biography',
  photoKey: 'Upload a profile photo',
  officeNo: 'Add your office number',
  cvKey: 'Upload your CV',
  orcid: 'Add your ORCID iD',
  researchInterests: 'Add research interests',
  educations: 'Add your education history',
  publications: 'Add publications',
  positions: 'Add positions held',
  courses: 'Add courses taught',
  awards: 'Add awards and honours',
};

/**
 * Computes the score WITHOUT writing.
 *
 * Split from recomputeCompleteness so the dashboard meter, which renders on every page,
 * does not issue a write on every render — and so a read path can never be the thing that
 * mutates a row.
 */
export async function computeCompleteness(
  profileId: string,
): Promise<CompletenessBreakdown> {
  const profile = await db.profile.findUnique({
    where: { id: profileId },
    select: {
      fullName: true,
      designation: true,
      about: true,
      photoKey: true,
      officeNo: true,
      cvKey: true,
      orcid: true,
      researchInterests: true,
      _count: {
        select: {
          educations: true,
          publications: true,
          positions: true,
          courses: true,
          awards: true,
        },
      },
    },
  });

  if (!profile) return { score: 0, missing: [] };

  let score = 0;
  const missing: Array<{ label: string; points: number }> = [];

  for (const { key, points } of PROFILE_FIELDS) {
    const value = profile[key as keyof typeof profile];
    const filled = typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
    if (filled) score += points;
    else if (LABELS[key]) missing.push({ label: LABELS[key], points });
  }

  const counts: Record<keyof typeof SECTION_WEIGHTS, number> = {
    researchInterests: profile.researchInterests.length,
    educations: profile._count.educations,
    publications: profile._count.publications,
    positions: profile._count.positions,
    courses: profile._count.courses,
    awards: profile._count.awards,
  };

  for (const [key, weight] of Object.entries(SECTION_WEIGHTS)) {
    const count = counts[key as keyof typeof SECTION_WEIGHTS];
    const earned = taperedScore(count, weight.max, weight.target);
    score += earned;
    if (count === 0) missing.push({ label: LABELS[key], points: weight.max });
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));

  missing.sort((a, b) => b.points - a.points);
  return { score: clamped, missing };
}

/**
 * Computes the score and writes it back. Called by every section mutation.
 *
 * The stored value is what the public directory sorts and filters on, so it has to be
 * kept current at write time rather than derived on read.
 */
export async function recomputeCompleteness(
  profileId: string,
): Promise<CompletenessBreakdown> {
  const breakdown = await computeCompleteness(profileId);

  await db.profile.update({
    where: { id: profileId },
    data: { completeness: breakdown.score },
  });

  return breakdown;
}
