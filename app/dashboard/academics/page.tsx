import type { Metadata } from 'next';

import { listEducation } from './actions';
import { EducationSection } from './education-section';

export const metadata: Metadata = { title: 'Academics' };

/**
 * Education editor.
 *
 * Data is fetched in this Server Component, never in a client effect (CLAUDE.md §6).
 * `listEducation` scopes to the session's own profile by construction, so there is no
 * id here for a caller to tamper with.
 */
export default async function AcademicsPage() {
  const education = await listEducation();

  return (
    <main className="px-gutter py-10 sm:py-14">
      <div className="max-w-3xl">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
          Profile
        </p>
        <h1 className="mt-5 text-[2.5rem] leading-[1.08] tracking-[-0.015em]">
          Academics
        </h1>

        <div className="mt-12">
          <EducationSection initialItems={education} />
        </div>
      </div>
    </main>
  );
}
