import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ProfileView } from '@/components/public/profile-view';
import { requireSessionOrRedirect } from '@/lib/auth/session';
import { getOwnProfileForPreview } from '@/lib/public-profile';
import { db } from '@/lib/db';

/**
 * Preview of the public page, from draft data.
 *
 * ── It renders the same components, and that is the entire point ────────────────────────
 *
 * `<ProfileView>` here is byte-for-byte the one `/faculty/[slug]` renders. A preview that
 * reimplemented the layout would be a second thing to keep in step, and the copy that fell
 * behind would be the one telling a faculty member what their page "will" look like — the
 * worst possible place for a divergence, because it is only discovered after publishing.
 *
 * Two behaviours therefore come along for free rather than being re-derived:
 *   - `showMobile` / `showAltEmail` are honoured. A hidden number is hidden IN THE PREVIEW
 *     TOO, even though it is the owner's own. Showing it "because it's yours" would teach
 *     people the flag does not work.
 *   - Ongoing students appear as initials, via the same `displayStudentName()`.
 *
 * ── Whose profile ───────────────────────────────────────────────────────────────────────
 *
 * The session's own, always. This route takes NO id, no slug, and no search parameter, so
 * there is no identifier for an attacker to change — the IDOR that §3.1 is mostly about
 * cannot be expressed here. That is why it is a route with no parameters rather than
 * `/dashboard/preview/[id]` with an ownership check: a check that cannot be forgotten beats
 * one that must be remembered at 40 call sites.
 */

export const metadata: Metadata = { title: 'Preview' };

export default async function PreviewPage() {
  const session = await requireSessionOrRedirect('/dashboard/preview');

  const profile = await getOwnProfileForPreview(session.profileId);
  if (!profile) notFound();

  const state = await db.profile.findUnique({
    where: { id: session.profileId },
    select: { isPublished: true },
  });

  return (
    <div className="pb-16">
      {/*
        A banner, not a chrome-free page. Someone who lands here from a bookmark needs to
        know at a glance that this is a preview and whether it is live — otherwise the
        honest answer to "is my page up?" is a page that looks identical either way.
      */}
      <div className="border-b border-hairline bg-surface-sunken px-gutter py-3">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 text-[0.85rem]">
          <span className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-muted-foreground">
            Preview
          </span>
          <p className="text-muted-foreground">
            {state?.isPublished ? (
              <>
                This is your public page. Visitors see it at{' '}
                <Link
                  href={`/faculty/${profile.slug}`}
                  className="underline decoration-hairline underline-offset-4 hover:decoration-current"
                >
                  /faculty/{profile.slug}
                </Link>
                .
              </>
            ) : (
              <>
                Your profile is a draft — nobody else can see this yet. This is how it will
                look once you{' '}
                <Link
                  href="/dashboard/publish"
                  className="underline decoration-hairline underline-offset-4 hover:decoration-current"
                >
                  publish
                </Link>
                .
              </>
            )}
          </p>
        </div>
      </div>

      <ProfileView profile={profile} />
    </div>
  );
}
