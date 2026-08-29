import { AccountStatus } from '@prisma/client';
import type { Metadata } from 'next';

import { requireSessionOrRedirect } from '@/lib/auth/session';
import { computeCompleteness } from '@/lib/completeness';
import { db } from '@/lib/db';

import { PublishToggle } from './publish-toggle';

export const metadata: Metadata = { title: 'Publish' };

export default async function PublishPage() {
  const session = await requireSessionOrRedirect('/dashboard/publish');

  const [profile, completeness] = await Promise.all([
    db.profile.findUnique({
      where: { id: session.profileId },
      select: { slug: true, isPublished: true, isPubliclyListed: true },
    }),
    computeCompleteness(session.profileId),
  ]);

  return (
    <main className="px-gutter py-10 sm:py-14">
      <div className="max-w-3xl">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
          Profile
        </p>
        <h1 className="mt-5 text-[2.5rem] leading-[1.08] tracking-[-0.015em]">Publish</h1>

        <div className="mt-10">
          <PublishToggle
            initialPublished={profile?.isPublished ?? false}
            initialListed={profile?.isPubliclyListed ?? true}
            canPublish={session.status === AccountStatus.ACTIVE}
            slug={profile?.slug ?? ''}
          />
        </div>

        <p className="measure mt-8 text-[0.9rem] leading-relaxed text-muted-foreground">
          Your profile is {completeness.score}% complete. You can publish at any level of
          completeness — a sparse page that exists is more useful to somebody searching for
          you than a perfect one that does not.
        </p>
      </div>
    </main>
  );
}
