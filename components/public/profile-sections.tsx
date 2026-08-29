import type { PublicationType } from '@prisma/client';

import {
  COURSE_LEVEL_LABELS,
  DEGREE_LEVEL_LABELS,
  GUIDANCE_DEGREE_LABELS,
  GUIDANCE_STATUS_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECT_TYPE_LABELS,
  PUBLICATION_TYPE_LABELS,
  PUBLICATION_TYPE_PLURALS,
  labelOf,
} from '@/lib/labels';
import {
  SECTION_LABELS,
  type PublicProfile,
  type SectionId,
} from '@/lib/public-profile';

/**
 * The ten content sections of a public profile.
 *
 * ── Designing for the long tail, not the demo profile ───────────────────────────────────
 *
 * Three cases decide this layout, and none of them is the tidy three-publication profile
 * that a screenshot is taken of:
 *
 *   A 200-WORD PUBLICATION TITLE. Titles are set at body size in the sans face, not in the
 *   display serif, and not larger than the surrounding text. A serif display title looks
 *   excellent for eight words and becomes an unreadable paragraph at two hundred. Every
 *   long string carries `hyphens-auto` and `break-words` so a single unbroken chemical name
 *   or URL cannot widen the column and set the whole page scrolling sideways.
 *
 *   SIXTY PUBLICATIONS. Not paginated — an academic list is a record, and a visitor
 *   checking whether a 2019 paper is listed should be able to use Ctrl-F. Instead it is
 *   GROUPED BY YEAR with the year in a left rail, which turns a wall into something
 *   scannable and gives the eye a fixed landmark every few entries. The section header
 *   carries a count so the length is stated rather than discovered by scrolling.
 *
 *   A PROFILE WITH ONLY A NAME. Every section is omitted entirely when empty — no headings
 *   over blank space, no "None listed", no skeleton. The sub-nav is built from the same
 *   list, so it shrinks in step. A one-line profile renders as a hero and nothing else,
 *   which reads as sparse rather than broken. The dashboard is where a faculty member is
 *   told their profile is thin; their public page should not editorialise about them.
 *
 * ── Punctuation ────────────────────────────────────────────────────────────────────────
 *
 * Metadata lines are assembled by filtering out the absent parts and joining, never by
 * template string. A template leaves the stranded separators — "Journal ·  · " — that make
 * a page look unfinished, and with this many optional columns that case is the norm.
 */

function joinParts(parts: Array<string | number | null | undefined>): string {
  return parts
    .filter((p) => p !== null && p !== undefined && String(p).trim() !== '')
    .join(' · ');
}

/** "2019 – 2023", "2019 – present", "2019", or nothing. */
function yearRange(
  from: number | null | undefined,
  to: number | null | undefined,
  ongoing = false,
): string | null {
  if (from && to) return `${from} – ${to}`;
  if (from && ongoing) return `${from} – present`;
  if (from) return String(from);
  if (to) return String(to);
  return ongoing ? 'Present' : null;
}

function Section({
  id,
  count,
  children,
}: {
  id: SectionId;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    // scroll-mt clears the sticky sub-nav — without it an anchor jump parks the heading
    // underneath the bar and the section looks like it starts at its second line.
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-20 py-12 sm:py-16">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2
          id={`${id}-heading`}
          className="font-display text-[1.75rem] leading-tight tracking-[-0.01em]"
        >
          {SECTION_LABELS[id]}
        </h2>
        {count !== undefined && count > 3 ? (
          <span className="font-mono text-[0.72rem] tabular-nums text-muted-foreground">
            {count}
          </span>
        ) : null}
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

/** One entry: title line, then a muted metadata line. Used by most sections. */
function Entry({
  title,
  meta,
  children,
}: {
  title: React.ReactNode;
  meta?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <li className="border-t border-hairline py-4 first:border-t-0 first:pt-0">
      <p className="text-[0.95rem] leading-relaxed font-medium hyphens-auto break-words">
        {title}
      </p>
      {meta ? (
        <p className="mt-1 text-[0.85rem] leading-relaxed text-muted-foreground break-words">
          {meta}
        </p>
      ) : null}
      {children}
    </li>
  );
}

function List({ children }: { children: React.ReactNode }) {
  return <ul className="max-w-[68ch] min-w-0">{children}</ul>;
}

/* ── About ─────────────────────────────────────────────────────────────────────────── */

function About({ about }: { about: string }) {
  return (
    <Section id="about">
      {/*
        Rendered as TEXT, split on blank lines — never dangerouslySetInnerHTML.
        `about` is free text a faculty member typed, it is 5000 characters long, and it is
        displayed to anonymous visitors. That is the exact shape of a stored-XSS sink
        (CLAUDE.md §8). Paragraph splitting gives the formatting people actually need
        without opening the hole; rich text, if it is ever wanted, arrives with a sanitiser
        and its own review.
      */}
      <div className="max-w-[68ch] space-y-4">
        {about
          .split(/\n{2,}/)
          .map((para) => para.trim())
          .filter(Boolean)
          .map((para, i) => (
            <p key={i} className="text-[1rem] leading-[1.75] text-pretty">
              {para}
            </p>
          ))}
      </div>
    </Section>
  );
}

/* ── Research interests ────────────────────────────────────────────────────────────── */

function Research({ interests }: { interests: string[] }) {
  return (
    <Section id="research">
      <ul className="flex max-w-[68ch] flex-wrap gap-2">
        {interests.map((interest) => (
          <li
            key={interest}
            className="rounded-md border border-hairline bg-surface-raised px-3 py-1.5 text-[0.88rem]"
          >
            {interest}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* ── Publications ──────────────────────────────────────────────────────────────────── */

function Publications({ items }: { items: PublicProfile['publications'] }) {
  // Already ordered year-desc by the query; this only partitions, preserving that order.
  const groups: Array<{ year: number | null; items: typeof items }> = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.year === item.year) last.items.push(item);
    else groups.push({ year: item.year, items: [item] });
  }

  const byType = items.reduce<Partial<Record<PublicationType, number>>>((acc, p) => {
    acc[p.type] = (acc[p.type] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Section id="publications" count={items.length}>
      {items.length > 8 ? (
        <p className="mb-8 max-w-[68ch] text-[0.85rem] leading-relaxed text-muted-foreground">
          {joinParts(
            (Object.keys(byType) as PublicationType[])
              .sort((a, b) => (byType[b] ?? 0) - (byType[a] ?? 0))
              .map((t) => {
                const n = byType[t] ?? 0;
                const label =
                  n === 1
                    ? labelOf(PUBLICATION_TYPE_LABELS, t)
                    : labelOf(PUBLICATION_TYPE_PLURALS, t);
                return `${n} ${label.toLowerCase()}`;
              }),
          )}
        </p>
      ) : null}

      <div className="space-y-10">
        {groups.map((group) => (
          <div
            key={group.year ?? 'undated'}
            // Year rail on the left at sm+, stacked heading below that. The rail is what
            // makes sixty entries navigable by eye.
            className="sm:grid sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:gap-6"
          >
            <h3 className="mb-3 font-mono text-[0.78rem] tabular-nums text-muted-foreground sm:sticky sm:top-20 sm:mb-0 sm:self-start sm:pt-1">
              {group.year ?? 'Undated'}
            </h3>
            <ul className="max-w-[68ch]">
              {group.items.map((p) => (
                <li
                  key={p.id}
                  className="border-t border-hairline py-4 first:border-t-0 first:pt-0"
                >
                  <p className="text-[0.95rem] leading-relaxed hyphens-auto break-words text-pretty">
                    {p.title}
                  </p>
                  <p className="mt-1.5 text-[0.85rem] leading-relaxed text-muted-foreground break-words">
                    {p.authors}
                  </p>
                  <p className="mt-1 text-[0.82rem] leading-relaxed text-muted-foreground break-words">
                    {joinParts([
                      p.venue,
                      p.publisher,
                      p.volume ? `vol. ${p.volume}` : null,
                      p.issue ? `no. ${p.issue}` : null,
                      p.pages ? `pp. ${p.pages}` : null,
                      labelOf(PUBLICATION_TYPE_LABELS, p.type),
                    ])}
                  </p>
                  {p.doi || p.url ? (
                    <p className="mt-1.5 text-[0.82rem] break-all">
                      <a
                        href={p.doi ? `https://doi.org/${p.doi}` : (p.url as string)}
                        target="_blank"
                        rel="noopener noreferrer external"
                        className="underline decoration-hairline underline-offset-4 hover:decoration-current focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        {p.doi ? `doi:${p.doi}` : 'Link'}
                      </a>
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ── The remaining sections ────────────────────────────────────────────────────────── */

function Education({ items }: { items: PublicProfile['educations'] }) {
  return (
    <Section id="education" count={items.length}>
      <List>
        {items.map((e) => (
          <Entry
            key={e.id}
            title={joinParts([e.degree, e.field])}
            meta={joinParts([
              e.institution,
              labelOf(DEGREE_LEVEL_LABELS, e.level),
              yearRange(e.yearFrom, e.yearTo),
            ])}
          />
        ))}
      </List>
    </Section>
  );
}

function Positions({ items }: { items: PublicProfile['positions'] }) {
  return (
    <Section id="positions" count={items.length}>
      <List>
        {items.map((p) => (
          <Entry
            key={p.id}
            title={p.title}
            meta={joinParts([
              p.organisation,
              yearRange(p.startYear, p.endYear, p.isCurrent),
            ])}
          >
            {p.description ? (
              <p className="mt-2 text-[0.88rem] leading-relaxed text-pretty">
                {p.description}
              </p>
            ) : null}
          </Entry>
        ))}
      </List>
    </Section>
  );
}

function Projects({ items }: { items: PublicProfile['projects'] }) {
  // Deliberately no funding amount. `amountLakhs` is in the schema for the faculty
  // member's own records and for future internal reporting; a grant figure beside a named
  // individual on a public page is an invitation nobody asked for. It is not selected by
  // the public query either, so this is a statement of intent, not the enforcement.
  return (
    <Section id="projects" count={items.length}>
      <List>
        {items.map((p) => (
          <Entry
            key={p.id}
            title={p.title}
            meta={joinParts([
              p.agency,
              p.role,
              labelOf(PROJECT_TYPE_LABELS, p.type),
              labelOf(PROJECT_STATUS_LABELS, p.status),
              yearRange(
                p.startDate?.getUTCFullYear(),
                p.endDate?.getUTCFullYear(),
                p.status === 'ONGOING',
              ),
            ])}
          />
        ))}
      </List>
    </Section>
  );
}

function GuidanceSection({ items }: { items: PublicProfile['guidances'] }) {
  return (
    <Section id="guidance" count={items.length}>
      <List>
        {items.map((g) => (
          <Entry
            key={g.id}
            // `displayName` was computed by displayStudentName() in the query layer. This
            // component never sees `studentName`, so it cannot publish a withheld name even
            // by accident. docs/SECURITY.md §11.
            title={g.displayName}
            meta={joinParts([
              labelOf(GUIDANCE_DEGREE_LABELS, g.degree),
              labelOf(GUIDANCE_STATUS_LABELS, g.status),
              yearRange(g.startYear, g.awardYear, g.status === 'ONGOING'),
              g.coGuide ? `with ${g.coGuide}` : null,
            ])}
          >
            {g.topic ? (
              <p className="mt-2 text-[0.88rem] leading-relaxed text-muted-foreground text-pretty">
                {g.topic}
              </p>
            ) : null}
          </Entry>
        ))}
      </List>
    </Section>
  );
}

function Teaching({ items }: { items: PublicProfile['courses'] }) {
  return (
    <Section id="teaching" count={items.length}>
      <List>
        {items.map((c) => (
          <Entry
            key={c.id}
            title={joinParts([c.code, c.name])}
            meta={joinParts([labelOf(COURSE_LEVEL_LABELS, c.level), c.semester, c.year])}
          />
        ))}
      </List>
    </Section>
  );
}

function Awards({ items }: { items: PublicProfile['awards'] }) {
  return (
    <Section id="awards" count={items.length}>
      <List>
        {items.map((a) => (
          <Entry key={a.id} title={a.title} meta={joinParts([a.awardedBy, a.year])}>
            {a.description ? (
              <p className="mt-2 text-[0.88rem] leading-relaxed text-pretty">
                {a.description}
              </p>
            ) : null}
          </Entry>
        ))}
      </List>
    </Section>
  );
}

function Memberships({ items }: { items: PublicProfile['memberships'] }) {
  return (
    <Section id="memberships" count={items.length}>
      <List>
        {items.map((m) => (
          <Entry
            key={m.id}
            title={m.body}
            meta={joinParts([
              m.membershipType,
              m.sinceYear ? `since ${m.sinceYear}` : null,
            ])}
          />
        ))}
      </List>
    </Section>
  );
}

/**
 * Renders exactly the sections in `sections`, in that order.
 *
 * The caller passes the list from `presentSections()`, the same call that builds the
 * sub-nav — so a nav item without a section, or a section the nav cannot reach, is not
 * expressible.
 */
export function ProfileSections({
  profile,
  sections,
}: {
  profile: PublicProfile;
  sections: SectionId[];
}) {
  const render: Record<SectionId, () => React.ReactNode> = {
    about: () => <About about={profile.about as string} />,
    research: () => <Research interests={profile.researchInterests} />,
    publications: () => <Publications items={profile.publications} />,
    education: () => <Education items={profile.educations} />,
    positions: () => <Positions items={profile.positions} />,
    projects: () => <Projects items={profile.projects} />,
    guidance: () => <GuidanceSection items={profile.guidances} />,
    teaching: () => <Teaching items={profile.courses} />,
    awards: () => <Awards items={profile.awards} />,
    memberships: () => <Memberships items={profile.memberships} />,
  };

  return (
    <div className="divide-y divide-hairline">
      {sections.map((id) => (
        <div key={id}>{render[id]()}</div>
      ))}

      {profile.customSections?.map((cs) => {
        if (!cs.items || cs.items.length === 0) return null;
        return (
          <section key={cs.id} id={`custom-${cs.slug}`} className="scroll-mt-20 py-12 sm:py-16">
            <h2 className="font-display text-[1.75rem] leading-tight tracking-[-0.01em]">
              {cs.title}
            </h2>
            <div className="mt-6 overflow-x-auto rounded-xl border border-hairline bg-background shadow-xs">
              <table className="w-full text-left text-[0.85rem]">
                <thead className="border-b border-hairline bg-surface-sunken font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">#</th>
                    {cs.columns.map((col) => (
                      <th key={col} className="px-4 py-3 font-medium">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {cs.items.map((item, idx) => {
                    const values = (item.values as Record<string, string>) || {};
                    return (
                      <tr key={item.id}>
                        <td className="px-4 py-3 font-mono text-[0.75rem] text-muted-foreground">
                          {idx + 1}
                        </td>
                        {cs.columns.map((col) => (
                          <td key={col} className="px-4 py-3 text-foreground font-medium">
                            {values[col] || '—'}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/*
 * On the LAST section reaching the top of the sticky bar when clicked or scroll-spied:
 *
 * An earlier version forced a full `100dvh` minimum height onto the final section so the
 * page always had enough travel to bring it flush under the nav. That produced a wall of
 * empty space under a short last section on every profile — worse than the problem it
 * solved, and now that `app/(public)/layout.tsx` renders `<SiteFooter>` after this
 * component, the page is no longer short of content below it anyway.
 *
 * What actually makes the last item correct is in `profile-nav.tsx`: `recompute()` checks
 * whether the viewport has reached `document.documentElement.scrollHeight` and, if so,
 * activates the last section unconditionally — independent of where that section's own top
 * happens to land. A short final section that cannot be scrolled flush to the bar still
 * gets highlighted correctly, because "the page is scrolled to its end" is the actual signal
 * for "the visitor is reading the last thing", not "this heading is exactly under the nav".
 */
