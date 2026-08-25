import { AccountStatus, Prisma } from '@prisma/client';

import { db } from '@/lib/db';

/**
 * The faculty directory: listing, filtering, and full-text search.
 *
 * ── Why raw SQL here and nowhere else ───────────────────────────────────────────────────
 *
 * `Profile.searchVector` is `Unsupported("tsvector")`, so Prisma can store the column but
 * cannot query it — there is no `@@` operator and no `ts_rank` in the query builder. This
 * module is the one place that drops to SQL, and it does so through `Prisma.sql` tagged
 * templates, which parameterise every interpolated value. There is no string concatenation
 * of user input anywhere in this file, and there must never be: the search box is public,
 * unauthenticated, and reachable by anyone on the internet.
 *
 * ── websearch_to_tsquery, not to_tsquery ────────────────────────────────────────────────
 *
 * `to_tsquery` THROWS on input it cannot parse — a stray `&`, an unbalanced quote, the word
 * "and" on its own. Every one of those is a thing a person types into a search box, and each
 * would surface as a 500. `websearch_to_tsquery` accepts arbitrary text and interprets it
 * the way people expect from a search engine: quoted phrases, `or`, and a leading `-` to
 * exclude. It cannot fail on user input, which is the property that matters on a public
 * form.
 *
 * ── Ranking ─────────────────────────────────────────────────────────────────────────────
 *
 * The trigger in `prisma/migrations/.../search_vector` weights the vector A/B/C/D over
 * name, research interests, designation, and biography. So searching "machine learning"
 * puts someone whose listed interest IS machine learning above someone who mentions it once
 * in a paragraph about something else. Without ranking, a full-text search over a biography
 * field returns the longest biographies.
 */

/** Cards need far less than a profile page. Photos are keys, resolved by the component. */
export type DirectoryEntry = {
  id: string;
  slug: string;
  fullName: string;
  designation: string | null;
  photoKey: string | null;
  researchInterests: string[];
  departmentName: string;
  departmentSlug: string;
  departmentCode: string;
};

export type DirectoryQuery = {
  q?: string;
  department?: string;
  designation?: string;
  page?: number;
};

export type DirectoryResult = {
  entries: DirectoryEntry[];
  total: number;
  page: number;
  pageCount: number;
  perPage: number;
};

export const PER_PAGE = 24;

/**
 * The visibility rule, in one place.
 *
 * Identical to `getPublishedProfile` in lib/public-profile.ts: published AND the owner is
 * still ACTIVE. A suspended account has to vanish from the directory at the same moment it
 * vanishes from its own page — a listing that outlives the profile it links to is both a
 * broken link and a disclosure.
 */
const VISIBLE = Prisma.sql`p."isPublished" = true AND u."status" = ${AccountStatus.ACTIVE}::"AccountStatus"`;

function filters(query: DirectoryQuery): Prisma.Sql[] {
  const conditions = [VISIBLE];

  if (query.department) {
    conditions.push(Prisma.sql`d."slug" = ${query.department}`);
  }
  if (query.designation) {
    conditions.push(Prisma.sql`p."designation" = ${query.designation}`);
  }
  if (query.q?.trim()) {
    conditions.push(
      Prisma.sql`p."searchVector" @@ websearch_to_tsquery('english', ${query.q.trim()})`,
    );
  }

  return conditions;
}

/**
 * ── Why researchInterests is coalesced in the SQL ───────────────────────────────────────
 *
 * $queryRaw does NOT apply Prisma's coercions. `researchInterests` is declared `String[]`,
 * and the typed client silently turns a NULL text[] column into `[]`. Raw SQL returns the
 * actual NULL — so the TypeScript annotation `string[]` was simply false, and every card
 * for a profile that had never touched the field threw "Cannot read properties of null
 * (reading 'length')". One sparse profile took down the entire directory with a 500.
 *
 * Fixed in the query rather than with a guard in the component, so the type is true at the
 * point it is asserted. Any other raw select of a scalar list needs the same treatment.
 */
export async function listFaculty(query: DirectoryQuery): Promise<DirectoryResult> {
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const where = Prisma.join(filters(query), ' AND ');
  const term = query.q?.trim();

  // Ranked when there is a query, alphabetical when there is not. Ranking an unfiltered
  // list would order 500 people by a rank of 0.0 — that is, arbitrarily.
  const order = term
    ? Prisma.sql`ORDER BY ts_rank(p."searchVector", websearch_to_tsquery('english', ${term})) DESC, p."fullName" ASC`
    : Prisma.sql`ORDER BY p."fullName" ASC`;

  const [rows, counted] = await Promise.all([
    db.$queryRaw<DirectoryEntry[]>`
      SELECT
        p."id", p."slug", p."fullName", p."designation", p."photoKey",
        coalesce(p."researchInterests", '{}') AS "researchInterests",
        d."name" AS "departmentName",
        d."slug" AS "departmentSlug",
        d."code" AS "departmentCode"
      FROM "Profile" p
      JOIN "Department" d ON d."id" = p."departmentId"
      JOIN "User" u ON u."id" = p."userId"
      WHERE ${where}
      ${order}
      LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}
    `,
    db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count
      FROM "Profile" p
      JOIN "Department" d ON d."id" = p."departmentId"
      JOIN "User" u ON u."id" = p."userId"
      WHERE ${where}
    `,
  ]);

  // Postgres `count(*)` is bigint, which arrives as a JS BigInt and is not JSON
  // serialisable — passing it to a Client Component throws at the RSC boundary.
  const total = Number(counted[0]?.count ?? 0);

  return {
    entries: rows,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PER_PAGE)),
    perPage: PER_PAGE,
  };
}

export type Facet = { value: string; label: string; count: number };

/**
 * Filter options, each carrying how many people it would show.
 *
 * Counts are computed against the CURRENTLY VISIBLE set rather than the whole table, so a
 * department whose only member is unpublished does not advertise "1" and then show an empty
 * page. A filter that leads somewhere empty is worse than a filter that is not offered.
 */
export async function directoryFacets(): Promise<{
  departments: Facet[];
  designations: Facet[];
}> {
  const [departments, designations] = await Promise.all([
    db.$queryRaw<Array<{ value: string; label: string; count: bigint }>>`
      SELECT d."slug" AS value, d."name" AS label, count(*) AS count
      FROM "Profile" p
      JOIN "Department" d ON d."id" = p."departmentId"
      JOIN "User" u ON u."id" = p."userId"
      WHERE ${VISIBLE}
      GROUP BY d."slug", d."name"
      ORDER BY d."name" ASC
    `,
    db.$queryRaw<Array<{ value: string; label: string; count: bigint }>>`
      SELECT p."designation" AS value, p."designation" AS label, count(*) AS count
      FROM "Profile" p
      JOIN "User" u ON u."id" = p."userId"
      WHERE ${VISIBLE} AND p."designation" IS NOT NULL AND p."designation" <> ''
      GROUP BY p."designation"
      ORDER BY count(*) DESC, p."designation" ASC
    `,
  ]);

  const toFacet = (r: { value: string; label: string; count: bigint }): Facet => ({
    value: r.value,
    label: r.label,
    count: Number(r.count),
  });

  return {
    departments: departments.map(toFacet),
    designations: designations.map(toFacet),
  };
}

/**
 * Departments with their visible-profile counts, for the landing page and nav.
 *
 * The count comes from a LATERAL subquery reusing `VISIBLE` verbatim rather than from a
 * LEFT JOIN with the conditions inlined. That is not style. The first version wrote
 * `LEFT JOIN "User" u ON u."id" = p."userId" AND u."status" = 'ACTIVE'`, which does NOT
 * exclude anybody: a non-ACTIVE owner simply makes `u` null and the profile is still
 * counted. It reported 8 for a department whose listing returns 6 — the two extra being a
 * suspended and a pending account, so the number on the page was quietly disclosing how
 * many hidden profiles a department holds.
 *
 * A count and a listing that can disagree will disagree. Sharing one definition of
 * "visible" is what stops it.
 */
export async function listDepartments() {
  const rows = await db.$queryRaw<
    Array<{ slug: string; name: string; code: string; about: string | null; count: bigint }>
  >`
    SELECT d."slug", d."name", d."code", d."about", c."count"
    FROM "Department" d
    LEFT JOIN LATERAL (
      SELECT count(*) AS count
      FROM "Profile" p
      JOIN "User" u ON u."id" = p."userId"
      WHERE p."departmentId" = d."id" AND ${VISIBLE}
    ) c ON true
    ORDER BY d."name" ASC
  `;

  return rows.map((r) => ({ ...r, count: Number(r.count) }));
}

export async function getDepartment(slug: string) {
  return db.department.findUnique({
    where: { slug },
    select: { name: true, code: true, slug: true, about: true },
  });
}

export async function listDepartmentSlugs(): Promise<string[]> {
  const rows = await db.department.findMany({ select: { slug: true } });
  return rows.map((r) => r.slug);
}

/** Total visible faculty, for the landing page. */
export async function countVisibleFaculty(): Promise<number> {
  const rows = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*) AS count
    FROM "Profile" p
    JOIN "User" u ON u."id" = p."userId"
    WHERE ${VISIBLE}
  `;
  return Number(rows[0]?.count ?? 0);
}
