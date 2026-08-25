'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Field, inputClass } from '@/components/auth/field';

import { resendCodeAction, verifyCodeAction, type VerifyState } from './actions';

const COOLDOWN_SECONDS = 45;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-5 text-[0.95rem] font-medium text-primary-foreground transition-colors outline-none hover:bg-primary/92 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-70"
    >
      <span aria-live="polite">{pending ? 'Checking…' : 'Sign in'}</span>
    </button>
  );
}

function ResendButton({ email }: { email: string }) {
  const [state, formAction] = useActionState<VerifyState, FormData>(resendCodeAction, {});
  const [remaining, setRemaining] = useState(0);
  const { pending } = useFormStatus();

  useEffect(() => {
    if (!state.resent) return;
    const deadline = Date.now() + COOLDOWN_SECONDS * 1000;
    const update = () =>
      setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    const immediate = setTimeout(update, 0);
    const timer = setInterval(update, 1000);
    return () => {
      clearTimeout(immediate);
      clearInterval(timer);
    };
  }, [state.resent]);

  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="email" value={email} />
      <button
        type="submit"
        disabled={pending || remaining > 0}
        className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface-raised px-4 text-[0.9rem] font-medium transition-colors outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
      >
        {/* Countdown in the label, not a tooltip — a disabled control with no stated
            reason is the most frustrating thing on a screen someone is stuck on. */}
        <span aria-live="polite">
          {remaining > 0 ? `New code in ${remaining}s` : 'Send a new code'}
        </span>
      </button>

      {state.resent ? (
        <p role="status" className="text-[0.85rem] text-muted-foreground">
          Sent. The previous code no longer works.
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-[0.85rem] text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function CodeForm({ email, next }: { email: string; next: string }) {
  const [state, formAction] = useActionState<VerifyState, FormData>(verifyCodeAction, {});

  return (
    <div className="space-y-8">
      <form action={formAction} noValidate className="space-y-6">
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="next" value={next} />

        {state.error ? (
          <div
            role="alert"
            data-testid="form-error"
            tabIndex={-1}
            className="rounded-md border border-destructive/35 bg-destructive/8 px-4 py-3 text-[0.875rem] leading-relaxed text-foreground"
          >
            <p>{state.error}</p>
            {typeof state.attemptsRemaining === 'number' && state.attemptsRemaining > 0 ? (
              <p className="mt-1 text-muted-foreground">
                {state.attemptsRemaining} attempt
                {state.attemptsRemaining === 1 ? '' : 's'} left before this code is
                cancelled.
              </p>
            ) : null}
          </div>
        ) : null}

        <Field id="code" label="6-digit code" hint="From the email we just sent.">
          {(props) => (
            <input
              {...props}
              name="code"
              type="text"
              /* `one-time-code` is what lets iOS and Android offer the code from the
                 notification, which removes the transcription step entirely. */
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9 -]*"
              maxLength={9}
              required
              autoFocus
              placeholder="123456"
              className={`${inputClass} text-center font-mono text-[1.6rem] tracking-[0.35em]`}
            />
          )}
        </Field>

        <SubmitButton />
      </form>

      <div className="border-t border-hairline pt-6">
        <p className="text-[0.875rem] text-muted-foreground">
          {state.needsNewCode
            ? 'Request a fresh code to continue.'
            : 'Not arrived? Check spam, then request another.'}
        </p>
        <div className="mt-3">
          <ResendButton email={email} />
        </div>
      </div>
    </div>
  );
}
