import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Two-column shell for the auth FORM pages.
 *
 * The panel is a prop rather than layout-level content because each screen has to answer
 * a different question. On login it is "is this the real portal?"; on signup it is "what
 * happens after I submit?". A single shared panel would have to be vague enough to suit
 * both, which is how these columns end up holding decoration instead of information.
 *
 * At 360px the columns stack and the FORM comes first — the panel is context, not a
 * gate, and nobody should scroll past prose to reach the field they came for.
 */
export function AuthSplit({
  children,
  panel,
}: {
  children: ReactNode;
  panel: ReactNode;
}) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <main className="flex flex-col px-gutter py-10 sm:py-14">
        <Link
          href="/"
          className="inline-flex w-fit items-center gap-2 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span aria-hidden="true">&larr;</span>
          Faculty Portal
        </Link>

        <div className="flex flex-1 items-center py-10">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </main>

      <aside className="border-t border-hairline bg-surface-sunken px-gutter py-10 lg:border-l lg:border-t-0 lg:py-14">
        <div className="lg:sticky lg:top-14">{panel}</div>
      </aside>
    </div>
  );
}

/** Small heading used at the top of a panel. */
export function PanelHeading({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </p>
  );
}

/** Numbered step list, for panels that describe what happens next. */
export function PanelSteps({
  steps,
}: {
  steps: Array<{ title: string; body: string }>;
}) {
  return (
    <ol className="mt-6 space-y-5">
      {steps.map((step, index) => (
        <li key={step.title} className="flex gap-3.5">
          <span
            aria-hidden="true"
            className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border font-mono text-[0.7rem] text-muted-foreground"
          >
            {index + 1}
          </span>
          <div>
            <p className="text-[0.9rem] font-medium text-foreground">{step.title}</p>
            <p className="mt-1 text-[0.85rem] leading-relaxed text-muted-foreground">
              {step.body}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
