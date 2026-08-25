import type { Metadata } from 'next';

import { listPosition } from './actions';
import { listMembership } from './membership-actions';
import { MembershipSection } from './memberships-section';
import { PositionSection } from './positions-section';

export const metadata: Metadata = { title: 'Positions' };

/** Two related sections on one page: roles held, and the bodies you belong to. */
export default async function PositionsPage() {
  const [positions, memberships] = await Promise.all([listPosition(), listMembership()]);

  return (
    <main className="px-gutter py-10 sm:py-14">
      <div className="max-w-3xl">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
          Profile
        </p>
        <h1 className="mt-5 text-[2.5rem] leading-[1.08] tracking-[-0.015em]">
          Positions
        </h1>
        <div className="mt-12 space-y-16">
          <PositionSection initialItems={positions} />
          <MembershipSection initialItems={memberships} />
        </div>
      </div>
    </main>
  );
}
