import type { Metadata } from 'next';

import { listResearchProject } from './actions';
import { ResearchProjectSection } from './projects-section';

export const metadata: Metadata = { title: 'Projects' };

export default async function ResearchProjectPage() {
  const items = await listResearchProject();

  return (
    <main className="px-gutter py-10 sm:py-14">
      <div className="max-w-3xl">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
          Profile
        </p>
        <h1 className="mt-5 text-[2.5rem] leading-[1.08] tracking-[-0.015em]">
          Projects
        </h1>
        <div className="mt-12">
          <ResearchProjectSection initialItems={items} />
        </div>
      </div>
    </main>
  );
}
