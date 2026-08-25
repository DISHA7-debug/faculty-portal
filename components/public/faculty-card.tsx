'use client';

import { motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';

import type { DirectoryEntry } from '@/lib/directory';

/**
 * One person in the directory grid.
 *
 * ── The whole card is the link ──────────────────────────────────────────────────────────
 *
 * A single `<a>` wrapping everything, not a card with a "View profile" link inside it. A
 * nested-link card gives a screen reader two targets for one destination and a mouse user a
 * large area that looks clickable and is not. The tradeoff is that nothing else inside can
 * be interactive — which is correct here, because nothing else should be.
 *
 * ── Motion, and why there is no fade ────────────────────────────────────────────────────
 *
 * `whileInView` with `once: true`, so the grid reveals as you scroll and re-scrolling past
 * does not re-animate. Under `prefers-reduced-motion` the variants collapse to no movement
 * at all — not a shorter duration, since the setting is about vestibular discomfort.
 *
 * The reveal moves but does NOT fade, and that is the important part.
 *
 * Framer Motion server-renders `initial` as an inline style. With `initial={{ opacity: 0 }}`
 * every card ships to the browser at `opacity: 0` and only JavaScript ever brings it back —
 * so with JavaScript disabled the whole directory rendered as a blank page. Measured: 13 of
 * 13 cards at computed opacity 0. The GET form two files over exists precisely so this page
 * works without JavaScript; hiding the results behind an animation undid that.
 *
 * A y-offset has no such failure mode. If nothing ever animates, the cards sit 14px lower
 * than they otherwise would — uniformly, so the grid is merely 14px down and completely
 * readable. Any future reveal on public content must satisfy the same test: with scripts
 * off, is the content still visible?
 */
export function FacultyCard({
  entry,
  photoUrl,
  index,
}: {
  entry: DirectoryEntry;
  /** Resolved on the server; this component never touches the storage adapter. */
  photoUrl: string | null;
  index: number;
}) {
  const reduceMotion = useReducedMotion();

  const initials = entry.fullName
    .replace(/^(dr|prof|professor|mr|mrs|ms|shri|smt|sri|er)\.?\s+/i, '')
    .split(/\s+/)
    .filter((w) => /[A-Za-z]/.test(w))
    .map((w) => w[0])
    .filter((_, i, a) => i === 0 || i === a.length - 1)
    .join('')
    .toUpperCase();

  return (
    <motion.li
      initial={reduceMotion ? false : { y: 14 }}
      whileInView={{ y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={
        reduceMotion
          ? { duration: 0 }
          : {
              type: 'spring',
              stiffness: 100,
              damping: 20,
              // Staggered by position rather than by a parent container, because the grid
              // is server-rendered and its children arrive as a flat list.
              delay: Math.min(index, 11) * 0.035,
            }
      }
    >
      <motion.div
        whileHover={reduceMotion ? undefined : { y: -3 }}
        transition={{ type: 'spring', stiffness: 300, damping: 24 }}
        className="h-full"
      >
        <Link
          href={`/faculty/${entry.slug}`}
          className="flex h-full flex-col rounded-lg border border-hairline bg-surface-raised p-5 transition-colors hover:border-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
        >
          {photoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={photoUrl}
              width={512}
              height={512}
              alt=""
              loading="lazy"
              decoding="async"
              // alt="" and aria-hidden: the name is right below it in text, so announcing
              // "photo of X" then "X" makes a screen reader say the name twice.
              aria-hidden="true"
              className="mb-4 size-16 rounded-md border border-hairline object-cover"
            />
          ) : (
            <div
              aria-hidden="true"
              className="mb-4 flex size-16 items-center justify-center rounded-md border border-hairline bg-surface-sunken font-display text-[1.4rem] tracking-[0.05em] text-muted-foreground/60"
            >
              {initials || '·'}
            </div>
          )}

          <p className="font-display text-[1.2rem] leading-tight tracking-[-0.01em] text-balance">
            {entry.fullName}
          </p>

          {entry.designation ? (
            <p className="mt-1.5 text-[0.85rem] leading-snug text-muted-foreground text-balance">
              {entry.designation}
            </p>
          ) : null}

          <p className="mt-1 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-muted-foreground">
            {entry.departmentCode}
          </p>

          {entry.researchInterests.length > 0 ? (
            <p className="mt-4 text-[0.8rem] leading-relaxed text-muted-foreground">
              {/* Three, then a count. A card that lists fifteen interests is not a card. */}
              {entry.researchInterests.slice(0, 3).join(' · ')}
              {entry.researchInterests.length > 3
                ? ` +${entry.researchInterests.length - 3}`
                : ''}
            </p>
          ) : null}
        </Link>
      </motion.div>
    </motion.li>
  );
}
