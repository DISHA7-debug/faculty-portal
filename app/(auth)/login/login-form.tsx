'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Field, inputClass } from '@/components/auth/field';

import { requestCodeAction, type RequestCodeState } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-5 text-[0.95rem] font-medium text-primary-foreground transition-colors outline-none hover:bg-primary/92 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-70"
    >
      <span aria-live="polite">{pending ? 'Sending code…' : 'Email me a sign-in code'}</span>
    </button>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useActionState<RequestCodeState, FormData>(
    requestCodeAction,
    {},
  );

  return (
    <form action={formAction} noValidate className="space-y-6">
      <input type="hidden" name="next" value={next} />

      {state.error ? (
        <div
          role="alert"
          data-testid="form-error"
          tabIndex={-1}
          className="rounded-md border border-destructive/35 bg-destructive/8 px-4 py-3 text-[0.875rem] leading-relaxed text-foreground"
        >
          {state.error}
        </div>
      ) : null}

      <Field
        id="email"
        label="College email address"
        hint="We email you a 6-digit code. There is no password to remember."
        errors={state.fieldErrors?.email}
      >
        {(props) => (
          <input
            {...props}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            placeholder="e.g. first.last@jaipur.manipal.edu"
            defaultValue={state.email}
            className={inputClass}
          />
        )}
      </Field>

      <SubmitButton />

      <p className="text-center text-[0.875rem] text-muted-foreground">
        No account yet?{' '}
        <Link
          href="/signup"
          className="rounded-sm underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Create one
        </Link>
      </p>
    </form>
  );
}
