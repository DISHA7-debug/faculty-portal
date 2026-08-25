import type { CompletenessBreakdown } from '@/lib/completeness';

/**
 * Profile completeness, with the nudges that follow from it.
 *
 * A bare percentage is a scold. The number is only useful next to the specific next thing
 * worth doing, ordered by how much it is worth — so the top suggestion is always the
 * biggest single improvement to how the profile reads to a visitor.
 *
 * Deliberately not a progress bar racing to 100: the weighting in lib/completeness.ts is
 * built so that reaching 100 requires a profile genuinely worth reading, and most complete
 * profiles will sit in the eighties.
 */
export function CompletenessMeter({
  breakdown,
  /** Compact form for the sidebar; full form on the overview page. */
  variant = 'compact',
}: {
  breakdown: CompletenessBreakdown;
  variant?: 'compact' | 'full';
}) {
  const { score, missing } = breakdown;
  const suggestions = missing.slice(0, variant === 'full' ? 4 : 2);

  return (
    <section
      aria-labelledby="completeness-heading"
      className={variant === 'full' ? 'rounded-lg border border-border bg-surface-raised p-5 sm:p-6' : ''}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id="completeness-heading"
          className={
            variant === 'full'
              ? 'text-[1.35rem] leading-snug'
              : 'font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground'
          }
        >
          {variant === 'full' ? 'Profile completeness' : 'Completeness'}
        </h2>
        <p className="font-mono text-[0.95rem] tabular-nums">
          {score}
          <span className="text-muted-foreground">%</span>
        </p>
      </div>

      {/*
        role="img" with a label rather than a native <progress>: the visual is decorative
        and the number above already carries the value, so this avoids a screen reader
        announcing the same figure twice in two different phrasings.
      */}
      <div
        role="img"
        aria-label={`Profile is ${score} percent complete`}
        className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500"
          style={{ width: `${Math.max(score, 2)}%` }}
        />
      </div>

      {suggestions.length > 0 ? (
        <>
          <p className="mt-4 text-[0.8rem] text-muted-foreground">
            {variant === 'full' ? 'Biggest improvements available' : 'Next up'}
          </p>
          <ul className="mt-2 space-y-1.5">
            {suggestions.map((item) => (
              <li
                key={item.label}
                className="flex items-baseline justify-between gap-3 text-[0.85rem]"
              >
                <span className="text-foreground">{item.label}</span>
                <span className="shrink-0 font-mono text-[0.72rem] text-muted-foreground">
                  +{item.points}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-4 text-[0.85rem] leading-relaxed text-muted-foreground">
          Everything we prompt for is filled in. Keep publications current and the profile
          stays useful.
        </p>
      )}
    </section>
  );
}
