import type { Metadata } from 'next';

import { listAward } from './actions';
import { AwardSection } from './awards-section';

export const metadata: Metadata = { title: 'Awards' };

export default async function AwardPage() {
  const items = await listAward();

  return (
    <main className="px-gutter py-10 sm:py-14">
      <div className="max-w-3xl">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
          Profile
        </p>
        <h1 className="mt-5 text-[2.5rem] leading-[1.08] tracking-[-0.015em]">
          Awards
        </h1>
        <div className="mt-12">
          <AwardSection initialItems={items} />
        </div>
      </div>
    </main>
  );
}
