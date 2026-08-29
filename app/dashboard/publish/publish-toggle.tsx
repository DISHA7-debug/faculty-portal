'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { setPublishedAction, setVisibilityAction } from './actions';

export function PublishToggle({
  initialPublished,
  initialListed,
  canPublish,
  slug,
}: {
  initialPublished: boolean;
  initialListed: boolean;
  canPublish: boolean;
  slug: string;
}) {
  const [isPublished, setIsPublished] = useState(initialPublished);
  const [isListed, setIsListed] = useState(initialListed);
  const [pending, startTransition] = useTransition();

  function togglePublish(next: boolean) {
    const previous = isPublished;
    setIsPublished(next);

    startTransition(async () => {
      const result = await setPublishedAction(next);
      if (result.ok) {
        toast.success(next ? 'Your profile is now public.' : 'Your profile is no longer public.');
        return;
      }
      setIsPublished(previous);
      toast.error(result.error);
    });
  }

  function toggleList(next: boolean) {
    const previous = isListed;
    setIsListed(next);

    startTransition(async () => {
      const result = await setVisibilityAction(next);
      if (result.ok) {
        toast.success(next ? 'Profile listed in directory.' : 'Profile is now unlisted.');
        return;
      }
      setIsListed(previous);
      toast.error(result.error);
    });
  }

  if (!canPublish && !isPublished) {
    return (
      <div className="rounded-lg border border-border bg-surface-raised p-5 sm:p-6">
        <h2 className="text-[1.35rem] leading-snug">Not yet publishable</h2>
        <p className="measure mt-3 text-[0.95rem] leading-relaxed text-muted-foreground">
          Your profile is complete enough to publish, but the account is still waiting for
          an administrator to approve it. Nothing you can do speeds this up — and nothing
          is lost by continuing to fill it in.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-surface-raised p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-[1.35rem] leading-snug">
              {isPublished ? 'Your profile is live' : 'Your profile is a draft'}
            </h2>
            <p className="measure mt-2 text-[0.95rem] leading-relaxed text-muted-foreground">
              {isPublished ? (
                <>
                  It is available on the internet at{' '}
                  <code className="font-mono text-[0.85rem]">/faculty/{slug}</code>.
                </>
              ) : (
                'Only you can see it. It is not accessible to the public.'
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={() => togglePublish(!isPublished)}
            disabled={pending}
            aria-pressed={isPublished}
            className={`inline-flex min-h-11 shrink-0 items-center justify-center rounded-md px-5 text-[0.9rem] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-70 ${
              isPublished
                ? 'border border-border bg-surface-raised text-foreground hover:bg-secondary'
                : 'bg-primary text-primary-foreground hover:bg-primary/92'
            }`}
          >
            <span aria-live="polite">
              {pending ? 'Saving…' : isPublished ? 'Take offline' : 'Publish profile'}
            </span>
          </button>
        </div>
      </div>

      {isPublished ? (
        <div className="rounded-lg border border-border bg-surface-raised p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-[1.35rem] leading-snug">Directory Visibility</h2>
              <p className="measure mt-2 text-[0.95rem] leading-relaxed text-muted-foreground">
                {isListed
                  ? 'Your profile appears in the college directory and search engines.'
                  : 'Your profile is unlisted. It is hidden from the directory and search engines, but anyone with your direct link can still view it.'}
              </p>
            </div>

            <button
              type="button"
              onClick={() => toggleList(!isListed)}
              disabled={pending}
              aria-pressed={isListed}
              className={`inline-flex min-h-11 shrink-0 items-center justify-center rounded-md px-5 text-[0.9rem] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-70 border border-border bg-surface-raised text-foreground hover:bg-secondary`}
            >
              <span aria-live="polite">
                {pending ? 'Saving…' : isListed ? 'Hide from directory' : 'Show in directory'}
              </span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
