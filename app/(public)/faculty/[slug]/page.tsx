import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ProfileView } from '@/components/public/profile-view';
import { getPublishedProfile, listPublishedSlugs } from '@/lib/public-profile';

/**
 * The public faculty profile.
 *
 * ── Static, and what that costs ────────────────────────────────────────────────────────
 *
 * Pre-rendered at build time for every published profile, then revalidated on an interval.
 * 500 faculty pages served as static HTML from a single VPS is a non-problem; the same 500
 * rendered per request, each running ten Prisma queries, is a capacity plan.
 *
 * The cost is staleness: an edit takes up to `revalidate` seconds to appear. That is
 * acceptable for publication lists and wrong for withdrawal, so the two paths that must be
 * immediate call `revalidatePath('/faculty/<slug>')` directly — publish/unpublish, and any
 * admin suspension. The interval is the safety net for everything else, not the mechanism.
 *
 * No `headers()`, `cookies()`, or `searchParams` anywhere in this subtree. Any one of them
 * would silently flip these pages to dynamic — as measured in Sprint 2, where a `headers()`
 * call in the root layout turned every static route into `ƒ` (docs/SECURITY.md §7.1).
 */

export const revalidate = 300;

/**
 * `true`, and this one is not the security-flavoured default.
 *
 * `dynamicParams: false` is tempting — an unknown slug would 404 from the route table
 * without touching Postgres, so nobody could drive database load by requesting random
 * paths. It is also WRONG here, and the reason is worth writing down because the safer-
 * sounding option is the broken one:
 *
 * `generateStaticParams` runs at BUILD time. A faculty member who publishes on Tuesday is
 * not in Monday's build, and `revalidatePath` cannot create a route the router has been
 * told does not exist. Their page would 404 until the next deploy — for a portal where
 * publishing is a self-service action, that is a defect, not a hardening measure.
 *
 * So unknown slugs do reach the database. The exposure is one indexed lookup on a unique
 * column, behind the same rate limiting as everything else, returning 404. That is a cost
 * worth paying for "publish means published".
 */
export const dynamicParams = true;

export async function generateStaticParams() {
  return (await listPublishedSlugs()).map((slug) => ({ slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const profile = await getPublishedProfile(slug);

  // No profile: return the bare minimum. Throwing here would produce a 500 on a path that
  // is about to legitimately 404.
  if (!profile) return { title: 'Profile not found' };

  const description = [
    profile.designation,
    profile.department.name,
    profile.researchInterests.slice(0, 4).join(', '),
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    title: profile.fullName,
    description: description || undefined,
    alternates: { canonical: `/faculty/${profile.slug}` },
    openGraph: {
      type: 'profile',
      title: profile.fullName,
      description: description || undefined,
    },
    // A public directory of named individuals should not be feeding contact-scraping
    // datasets. Indexable, but not archived or snippet-expanded beyond the description.
    robots: { index: true, follow: true, noarchive: true },
  };
}

export default async function FacultyProfilePage({ params }: Props) {
  const { slug } = await params;
  const profile = await getPublishedProfile(slug);

  // 404 covers all three of: no such slug, a draft profile, and a profile whose owner is
  // PENDING_APPROVAL or SUSPENDED. The distinction is not the visitor's business, and
  // distinguishing them would confirm which college emails hold unpublished profiles.
  if (!profile) notFound();

  return <ProfileView profile={profile} backTo={{ href: '/faculty', label: 'Faculty Directory' }} />;
}
