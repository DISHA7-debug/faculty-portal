'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { setPublishedAction } from './actions';

/**
 * Publish control.
 *
 * When publishing is blocked by account status the button is NOT rendered disabled with a
 * tooltip — it is replaced by a plain statement of what is being waited on. A greyed-out
 * control reads as "you did something wrong"; this reads as "we are waiting on somebody
 * else", which is the truth (components/auth/awaiting-approval.tsx makes the same choice).
 */
export function PublishToggle({
  initialPublished,
  canPublish,
  slug,
}: {
  initialPublished: boolean;
  canPublish: boolean;
  slug: string;
}) {
  const [isPublished, setIsPublished] = useState(initialPublished);
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
    const previous = isPublished;
    setIsPublished(next); // optimistic

    startTransition(async () => {
      const result = await setPublishedAction(next);
      if (result.ok) {
        toast.success(next ? 'Your profile is now public.' : 'Your profile is no longer public.');
        return;
      }
      setIsPublished(previous); // visible rollback
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
    <div className="rounded-lg border border-border bg-surface-raised p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[1.35rem] leading-snug">
            {isPublished ? 'Your profile is public' : 'Your profile is a draft'}
          </h2>
          <p className="measure mt-2 text-[0.95rem] leading-relaxed text-muted-foreground">
            {isPublished ? (
              <>
                Anyone can find it in the directory, at{' '}
                <code className="font-mono text-[0.85rem]">/faculty/{slug}</code>.
              </>
            ) : (
              'Only you can see it. It does not appear in the directory or in search.'
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={() => toggle(!isPublished)}
          disabled={pending}
          aria-pressed={isPublished}
          className={`inline-flex min-h-11 items-center justify-center rounded-md px-5 text-[0.9rem] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-70 ${
            isPublished
              ? 'border border-border bg-surface-raised text-foreground hover:bg-secondary'
              : 'bg-primary text-primary-foreground hover:bg-primary/92'
          }`}
        >
          <span aria-live="polite">
            {pending ? 'Saving…' : isPublished ? 'Unpublish' : 'Publish my profile'}
          </span>
        </button>
      </div>
    </div>
  );
}
