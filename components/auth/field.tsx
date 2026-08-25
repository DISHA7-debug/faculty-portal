import type { ReactNode } from 'react';

/**
 * Labelled form field with accessible error wiring.
 *
 * Exists so accessibility is structural rather than remembered per form: the label is
 * always bound via htmlFor/id, the error is always announced through aria-describedby and
 * role="alert", and aria-invalid is always set when there is one. A form that composes
 * this cannot forget them.
 */
export function Field({
  id,
  label,
  hint,
  errors,
  children,
}: {
  id: string;
  label: string;
  /** Static help, always announced — placeholders are not a substitute for this. */
  hint?: ReactNode;
  errors?: string[];
  children: (props: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': boolean | undefined;
  }) => ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = errors?.length ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        className="block text-sm font-medium text-foreground"
      >
        {label}
      </label>

      {hint ? (
        <p id={hintId} className="text-[0.8rem] leading-relaxed text-muted-foreground">
          {hint}
        </p>
      ) : null}

      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': errors?.length ? true : undefined,
      })}

      {errors?.length ? (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-1.5 text-[0.8rem] leading-relaxed text-destructive"
        >
          <span aria-hidden="true" className="mt-[0.15em]">
            &#9679;
          </span>
          <span>{errors.join(' ')}</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Shared input styling.
 *
 * A 2px focus ring at a 2px offset, not a removed outline — a keyboard user must be able
 * to see where they are (CLAUDE.md §6). `min-h-11` keeps the touch target at 44px, which
 * is what makes this usable at 360px.
 */
export const inputClass =
  'w-full min-h-11 rounded-md border border-input bg-surface-raised px-3.5 py-2.5 ' +
  'text-[0.95rem] text-foreground placeholder:text-muted-foreground/70 ' +
  'transition-colors outline-none ' +
  'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35 ' +
  'aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/25 ' +
  'disabled:cursor-not-allowed disabled:opacity-60';
