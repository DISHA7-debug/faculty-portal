'use client';

import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { setResearchInterestsAction } from '@/app/dashboard/profile/actions';

/**
 * Research interests.
 *
 * Fully keyboard operable, for the same reason the photo cropper is: a control that only
 * works with a mouse excludes anyone using a keyboard, a screen reader, or voice input.
 *
 *   type + Enter or comma   commit the current text as a tag
 *   Backspace on empty      focus the last tag (does not delete blind)
 *   ArrowLeft / ArrowRight  move between tags
 *   Backspace / Delete      remove the focused tag
 *   Escape                  return to the text field
 *
 * Backspace-on-empty deliberately FOCUSES the last tag rather than deleting it. Deleting
 * on the first press is a well-known way to lose a tag you did not mean to touch; making
 * the first press a selection and the second a deletion costs one keystroke and removes
 * the surprise.
 */

const MAX = 15;

export function TagInput({ initial }: { initial: string[] }) {
  const [tags, setTags] = useState<string[]>(initial);
  const [draft, setDraft] = useState('');
  const [focusedTag, setFocusedTag] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const inputRef = useRef<HTMLInputElement | null>(null);
  const tagRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function persist(next: string[]) {
    const snapshot = tags;
    setTags(next);
    setError(null);

    startTransition(async () => {
      const result = await setResearchInterestsAction(next);
      if (result.ok) {
        setTags(result.interests); // converge on server truth (it de-duplicates)
        return;
      }
      setTags(snapshot); // visible rollback
      setError(result.error);
      toast.error(result.error);
    });
  }

  function commit(raw: string) {
    const value = raw.trim().replace(/,+$/, '').trim();
    if (!value) return;

    if (tags.length >= MAX) {
      setError(`You can list up to ${MAX} research interests.`);
      return;
    }
    if (tags.some((t) => t.toLowerCase() === value.toLowerCase())) {
      setError(`“${value}” is already listed.`);
      setDraft('');
      return;
    }
    if (value.length > 60) {
      setError('Each interest must be at most 60 characters.');
      return;
    }

    setDraft('');
    persist([...tags, value]);
  }

  function removeAt(index: number) {
    const next = tags.filter((_, i) => i !== index);
    persist(next);

    // Keep focus somewhere sensible rather than dumping it on <body>.
    const target = Math.min(index, next.length - 1);
    requestAnimationFrame(() => {
      if (target >= 0) tagRefs.current[target]?.focus();
      else inputRef.current?.focus();
    });
    setFocusedTag(target >= 0 ? target : null);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit(draft);
      return;
    }
    if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
      event.preventDefault();
      const last = tags.length - 1;
      setFocusedTag(last);
      tagRefs.current[last]?.focus();
    }
  }

  function onTagKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      removeAt(index);
      return;
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      setFocusedTag(index - 1);
      tagRefs.current[index - 1]?.focus();
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (index < tags.length - 1) {
        setFocusedTag(index + 1);
        tagRefs.current[index + 1]?.focus();
      } else {
        setFocusedTag(null);
        inputRef.current?.focus();
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setFocusedTag(null);
      inputRef.current?.focus();
    }
  }

  const remaining = MAX - tags.length;

  return (
    <section aria-labelledby="interests-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="interests-heading" className="text-[1.1rem] leading-snug font-medium">
          Research interests
        </h3>
        <p
          className="font-mono text-[0.75rem] text-muted-foreground tabular-nums"
          aria-live="polite"
        >
          {tags.length} of {MAX}
        </p>
      </div>

      <p id="interests-hint" className="text-[0.8rem] leading-relaxed text-muted-foreground">
        These drive search and the directory filters. Press Enter or comma to add one.
        Use the arrow keys to move between them and Backspace to remove one.
      </p>

      {error ? (
        <p
          role="alert"
          data-testid="interests-error"
          className="text-[0.85rem] leading-relaxed text-destructive"
        >
          {error}
        </p>
      ) : null}

      <div className="rounded-md border border-input bg-surface-raised p-2">
        <ul className="flex flex-wrap gap-2" role="list">
          {tags.map((tag, index) => (
            <li key={`${tag}-${index}`}>
              <button
                ref={(el) => {
                  tagRefs.current[index] = el;
                }}
                type="button"
                onKeyDown={(e) => onTagKeyDown(e, index)}
                onClick={() => removeAt(index)}
                onFocus={() => setFocusedTag(index)}
                aria-label={`${tag}. Press Backspace or Enter to remove.`}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-md border px-2.5 text-[0.85rem] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  focusedTag === index
                    ? 'border-ring bg-secondary'
                    : 'border-border bg-background hover:bg-secondary'
                }`}
              >
                {tag}
                <span aria-hidden="true" className="text-muted-foreground">
                  &times;
                </span>
              </button>
            </li>
          ))}

          <li className="min-w-[10rem] flex-1">
            <input
              ref={inputRef}
              id="interest-input"
              type="text"
              value={draft}
              disabled={tags.length >= MAX}
              aria-describedby="interests-hint"
              aria-label={
                tags.length >= MAX
                  ? `Maximum of ${MAX} interests reached`
                  : 'Add a research interest'
              }
              placeholder={
                tags.length >= MAX
                  ? `Maximum ${MAX} reached`
                  : remaining === MAX
                    ? 'Distributed Systems'
                    : 'Add another…'
              }
              onChange={(e) => {
                setError(null);
                // Typing a comma commits, so a pasted comma-separated list works too.
                if (e.target.value.includes(',')) {
                  const parts = e.target.value.split(',');
                  const last = parts.pop() ?? '';
                  parts.forEach((part) => commit(part));
                  setDraft(last);
                  return;
                }
                setDraft(e.target.value);
              }}
              onKeyDown={onInputKeyDown}
              onBlur={() => commit(draft)}
              className="min-h-9 w-full bg-transparent px-2 text-[0.9rem] outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed"
            />
          </li>
        </ul>
      </div>

      {pending ? (
        <p role="status" className="text-[0.8rem] text-muted-foreground">
          Saving…
        </p>
      ) : null}
    </section>
  );
}
