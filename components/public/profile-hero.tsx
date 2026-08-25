import { getPublicUrl } from '@/lib/storage';
import type { PublicProfile } from '@/lib/public-profile';

/**
 * Full-bleed hero: photo left, identity right.
 *
 * ── Why a plain <img> and not next/image ────────────────────────────────────────────────
 *
 * The upload pipeline already re-encodes every photo to exactly 512×512 WebP
 * (lib/uploads.ts). There is no larger original to downscale and no other format to
 * negotiate, so the optimiser would re-fetch a correctly-sized image from R2, spend CPU on
 * the VPS, and hand back the same bytes. `width`/`height` are set so the layout does not
 * shift, and `fetchPriority="high"` because this is the LCP element.
 *
 * ── Degradation ─────────────────────────────────────────────────────────────────────────
 *
 * A profile with only a name filled in must look finished, not broken. So: no photo draws a
 * monogram rather than a grey box with a broken-image glyph, and every optional line simply
 * does not render. What is left — a name and a department — reads as a deliberate, sparse
 * page, because the layout is built from what exists rather than from a fixed grid with
 * holes in it.
 */

/**
 * Two letters, not four.
 *
 * `toInitials()` is the guidance-name function and is correct for its job — "Dr. Rajalakshmi
 * Venkataraghavan Subramanian" gives "D. R. V. S.". Rendered at 4.5rem in a square box that
 * wraps onto a second line and reads as a layout fault. A monogram wants the first and last
 * initial of the actual NAME, so honorifics are dropped first.
 *
 * Deliberately local: this is a decorative crop, not the name policy, and reusing the
 * guidance helper for it would invite someone to "fix" that helper to suit this box.
 */
const HONORIFICS = /^(dr|prof|professor|mr|mrs|ms|shri|smt|sri|er)\.?$/i;

function monogramLetters(fullName: string): string {
  const words = fullName
    .trim()
    .split(/\s+/)
    .filter((w) => /[A-Za-z\u00C0-\u024F]/.test(w) && !HONORIFICS.test(w));

  if (words.length === 0) return '·';
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return `${first}${last}`.toUpperCase();
}

function Monogram({ name }: { name: string }) {
  return (
    <div
      aria-hidden="true"
      className="flex aspect-square w-full items-center justify-center rounded-lg border border-hairline bg-surface-sunken"
    >
      <span className="font-display text-[clamp(2.5rem,9vw,4.5rem)] leading-none tracking-[0.06em] text-muted-foreground/55">
        {monogramLetters(name)}
      </span>
    </div>
  );
}

export function ProfileHero({ profile }: { profile: PublicProfile }) {
  const photoUrl = profile.photoKey ? getPublicUrl(profile.photoKey) : null;

  return (
    <header className="border-b border-hairline bg-surface-raised">
      <div className="px-gutter py-12 sm:py-16">
        <div className="mx-auto grid max-w-5xl gap-8 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] sm:gap-12">
          <div className="w-40 sm:w-full">
            {photoUrl ? (
              /* Deliberate; see the note at the top of this file. The stored object is
                 already exactly 512x512 WebP, so next/image has nothing to optimise. */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoUrl}
                width={512}
                height={512}
                alt={`Portrait of ${profile.fullName}`}
                fetchPriority="high"
                decoding="async"
                className="aspect-square w-full rounded-lg border border-hairline object-cover"
              />
            ) : (
              <Monogram name={profile.fullName} />
            )}
          </div>

          {/*
            `sm:self-center` matters only for the sparse profile: with no designation and no
            interests the identity column is one line tall beside a 13rem photo, and
            top-aligning it leaves a large hole under the name that reads as missing content.
            On a full profile this column is taller than the photo, so centring is a no-op.
          */}
          <div className="min-w-0 sm:self-center">
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
              {profile.department.name}
              {profile.department.code ? ` · ${profile.department.code}` : ''}
            </p>

            {/* clamp() rather than breakpoints: a 60-character name and a 12-character one
                both have to sit on this line without a bespoke rule for each. */}
            <h1 className="mt-3 font-display text-[clamp(2.1rem,6vw,3.4rem)] leading-[1.05] tracking-[-0.02em] text-balance hyphens-auto">
              {profile.fullName}
            </h1>

            {profile.designation ? (
              <p className="mt-3 text-[1.05rem] leading-snug text-muted-foreground text-balance">
                {profile.designation}
              </p>
            ) : null}

            {profile.researchInterests.length > 0 ? (
              <ul aria-label="Research interests" className="mt-6 flex flex-wrap gap-2">
                {profile.researchInterests.map((interest) => (
                  <li
                    key={interest}
                    className="rounded-md border border-hairline bg-background px-2.5 py-1 text-[0.8rem] text-muted-foreground"
                  >
                    {interest}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
