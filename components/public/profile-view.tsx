import Link from 'next/link';

import { ProfileAside } from '@/components/public/profile-aside';
import { ProfileHero } from '@/components/public/profile-hero';
import { ProfileNav } from '@/components/public/profile-nav';
import { ProfileSections } from '@/components/public/profile-sections';
import { presentSections, type PublicProfile } from '@/lib/public-profile';

/**
 * The whole public profile, hero to footer rule.
 *
 * This component is the contract between `/faculty/[slug]` and `/dashboard/preview`. Both
 * routes do nothing but load a profile and hand it here, which is the only way the preview
 * can be trusted: the moment the preview has its own layout, it starts drifting from the
 * page it claims to preview, and the divergence is invisible to the person relying on it.
 * See the note against Sprint 3 in docs/SPRINTS.md.
 *
 * `backTo` is passed ONLY by the public `/faculty/[slug]` route. `/dashboard/preview`
 * leaves it undefined: a faculty member previewing their own draft is already inside the
 * dashboard chrome (sidebar, "Preview" nav item) and a "← Faculty Directory" link there
 * would point them at a page most of whose links (sign-in, other profiles) make no sense
 * mid-edit.
 */
export function ProfileView({
  profile,
  backTo,
}: {
  profile: PublicProfile;
  backTo?: { href: string; label: string };
}) {
  const sections = presentSections(profile);

  return (
    <>
      {backTo ? (
        <div className="border-b border-hairline px-gutter py-2.5">
          <div className="mx-auto max-w-5xl">
            <Link
              href={backTo.href}
              className="inline-flex items-center gap-1.5 text-[0.82rem] text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span aria-hidden="true">←</span> {backTo.label}
            </Link>
          </div>
        </div>
      ) : null}

      <ProfileHero profile={profile} />
      <ProfileNav sections={sections} />

      <main className="px-gutter pb-24">
        {/*
          `minmax(0,1fr)` at EVERY breakpoint, not just lg.
          A grid column defaults to `auto`, which is `minmax(min-content, max-content)` — so
          the column is at least as wide as its widest unbreakable content, and a single
          85-character token in one publication title stretched the whole column to 544px
          inside a 360px viewport, taking the contact card and the entire page sideways with
          it. `minmax(0, …)` sets the floor to zero and lets `break-words` do its job.
          `min-w-0` on the children is the same defence one level down.
        */}
        <div className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-x-12 lg:grid-cols-[minmax(0,1fr)_15rem]">
          {/*
            DOM order puts contact first, so on a phone the thing a visitor most often came
            for is above the fold rather than below sixty publications. At lg it is placed
            into the right column and made sticky, which is where the eye expects it in an
            editorial layout. Grid placement rather than `order`, so the reading order the
            screen reader follows is the DOM order in both cases.
          */}
          <div className="min-w-0 border-b border-hairline py-8 lg:col-start-2 lg:row-start-1 lg:border-b-0 lg:py-16">
            <ProfileAside profile={profile} />
          </div>

          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            {sections.length > 0 ? (
              <ProfileSections profile={profile} sections={sections} />
            ) : (
              /*
                The name-only profile. One quiet line, not an apology and not a set of empty
                headings. A visitor learns what the page can tell them — who this is and how
                to reach them — and the absence reads as a page that is new rather than one
                that is broken.
              */
              <p className="max-w-[52ch] py-16 text-[0.95rem] leading-relaxed text-muted-foreground">
                This profile has not been filled in beyond the details above.
              </p>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
