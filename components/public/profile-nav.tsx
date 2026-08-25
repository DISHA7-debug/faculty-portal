'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

import { SECTION_NAV_LABELS, type SectionId } from '@/lib/public-profile';

/**
 * Sticky in-page sub-nav with scroll-spy.
 *
 * ── How the highlight is decided ────────────────────────────────────────────────────────
 *
 * The current section is THE LAST ONE WHOSE TOP HAS PASSED UNDER THE STICKY BAR. That is a
 * position computation, not a visibility one, and the distinction is the whole reason this
 * component was rewritten once.
 *
 * The first version used IntersectionObserver over a narrow band below the bar and took the
 * top-most intersecting section. It is cheaper — the observer runs off the main thread and
 * fires only on crossings — and it is wrong at exactly the moment a visitor notices. Click
 * "Publications" and the page scrolls so that heading sits under the bar; the tail of the
 * PRECEDING section still clips the top of the band, it is earlier in document order, so it
 * wins and the highlight reads "Research". Every anchor click lit the previous item.
 *
 * The cost of doing it properly is ten `getBoundingClientRect()` reads per animation frame
 * while scrolling. That is not free, but it is small, bounded by the section count, and
 * rAF-throttled so it happens once per frame however many scroll events arrive. Correctness
 * on a control whose only job is to say where you are was worth more than the saving.
 *
 * ── This is a nav, so it is links ───────────────────────────────────────────────────────
 *
 * `<a href="#id">` inside a `<nav>`, not buttons with scroll handlers. Keyboard users get
 * Tab and Enter for free, the URL updates so a section is linkable, and it works before
 * hydration. The scroll-spy only ever adds a highlight; it never provides the navigation.
 */

export function ProfileNav({ sections }: { sections: SectionId[] }) {
  const [active, setActive] = useState<SectionId | null>(sections[0] ?? null);
  const reduceMotion = useReducedMotion();
  const listRef = useRef<HTMLUListElement | null>(null);
  // The most recent explicit nav click: which section, and when. Read by recompute()
  // below — see the "closest upcoming" comment for why a click can outrank the fallback.
  const lastClickAtRef = useRef(0);
  const lastClickedIdRef = useRef<SectionId | null>(null);

  useEffect(() => {
    if (sections.length === 0) return;

    let frame = 0;

    /**
     * The threshold each section is measured against: its OWN `scroll-margin-top`.
     *
     * That value is what the browser uses to park a section when you follow `#id`, so it is
     * by definition the resting position of a section a visitor just navigated to. Deriving
     * the line from anything else — the nav's height, a round number — puts it a few pixels
     * above where anchors actually land, and every click then highlights the PREVIOUS item,
     * which is precisely the bug this replaced. Read once here rather than per frame;
     * getComputedStyle forces style resolution and this value does not move.
     */
    const restingTop = new Map<SectionId, number>();
    for (const id of sections) {
      const el = document.getElementById(id);
      if (el) restingTop.set(id, parseFloat(getComputedStyle(el).scrollMarginTop) || 0);
    }

    const recompute = () => {
      frame = 0;

      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;

      // Two passes in one loop:
      //   `current`         the LAST section whose top has already passed its own resting
      //                     position — the normal, correct answer while there is room to
      //                     scroll.
      //   `closestUpcoming` among sections that have NOT yet reached their resting
      //                     position, the one nearest to it (smallest top). Only matters
      //                     when the page has run out of room to scroll further.
      let current = sections[0];
      let closestUpcoming: SectionId | null = null;
      let closestUpcomingTop = Infinity;

      for (const id of sections) {
        const top = document.getElementById(id)?.getBoundingClientRect().top;
        if (top === undefined) continue;
        // +2 for sub-pixel scroll positions and fractional device pixel ratios.
        const threshold = (restingTop.get(id) ?? 0) + 2;
        if (top <= threshold) {
          current = id;
        } else if (top < closestUpcomingTop) {
          closestUpcomingTop = top;
          closestUpcoming = id;
        }
      }

      /**
       * `closestUpcoming` exists for the case where the true last section can never reach
       * its own resting threshold — there is not enough trailing content to scroll it
       * there — so the strict pass above stalls on whatever earlier section last
       * legitimately satisfied it, and the section plainly on screen never lights up.
       * `bottom of page highlights the last item` is that case: scroll (not click) all the
       * way down, and the last section should light up even though it never goes flush.
       *
       * A recent nav click can point at EITHER side of this, and both are real:
       *
       *   Click "Awards" on a short page — Awards satisfies its own threshold just fine
       *   (the strict pass already finds it), but Memberships, after it, permanently falls
       *   short of ITS threshold and so also qualifies as "closest upcoming". Applying the
       *   override here would silently replace the section the visitor asked for with the
       *   one after it, the moment the page runs out of room.
       *
       *   Click "Memberships" itself (the true last item) on that same short page — it can
       *   never reach its own threshold either, so the strict pass stalls on Awards, and
       *   WITHOUT the override the visitor's own click target would never light up.
       *
       * The distinguishing fact is whether the click's target already IS the strict pass's
       * answer. If it is (Awards), that click has been satisfied — trust it, skip the
       * override. If it is not (Memberships, whose own click could never be satisfied by
       * definition), the override is what makes that click work at all, so it must run.
       */
      const recentClickId =
        Date.now() - lastClickAtRef.current < 900 ? lastClickedIdRef.current : null;
      const clickAlreadySatisfied = recentClickId !== null && current === recentClickId;

      if (atBottom && closestUpcoming && !clickAlreadySatisfied) {
        current = closestUpcoming;
      }

      setActive(current);
    };

    // rAF-throttled: scroll fires far more often than the screen repaints, and the reads
    // below force layout. One computation per frame is the most that can ever be useful.
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(recompute);
    };

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    recompute(); // a page opened at #memberships fires no scroll event

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [sections]);

  // On a narrow screen the rail scrolls horizontally; keep the active item in view.
  useEffect(() => {
    if (!active || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-nav="${active}"]`);
    el?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  }, [active, reduceMotion]);

  if (sections.length === 0) return null;

  return (
    <nav
      aria-label="Sections of this profile"
      className="sticky top-0 z-30 border-b border-hairline bg-background/85 backdrop-blur-md"
    >
      <div className="px-gutter">
        <ul
          ref={listRef}
          // `scrollbar-none` plus horizontal scroll: ten items do not fit at 360px, and a
          // wrapped two-row sticky bar eats a third of a phone screen.
          className="-mb-px flex gap-1 overflow-x-auto scrollbar-none"
        >
          {sections.map((id) => {
            const isActive = active === id;
            return (
              <li key={id} className="shrink-0">
                <a
                  href={`#${id}`}
                  data-nav={id}
                  aria-current={isActive ? 'location' : undefined}
                  onClick={() => {
                    lastClickAtRef.current = Date.now();
                    lastClickedIdRef.current = id;
                    setActive(id);
                  }}
                  className={`relative block px-3 py-3.5 text-[0.82rem] whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
                    isActive
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {SECTION_NAV_LABELS[id]}
                  {isActive ? (
                    <motion.span
                      layoutId="profile-nav-indicator"
                      aria-hidden="true"
                      className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
                      transition={
                        reduceMotion
                          ? { duration: 0 }
                          : { type: 'spring', stiffness: 100, damping: 20 }
                      }
                    />
                  ) : null}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
