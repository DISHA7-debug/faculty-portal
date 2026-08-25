'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Field, inputClass } from '@/components/auth/field';

import { signupAction, type SignupState } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-5 text-[0.95rem] font-medium text-primary-foreground transition-[background-color,opacity] outline-none hover:bg-primary/92 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-70"
    >
      <span aria-live="polite">{pending ? 'Creating account…' : 'Create account'}</span>
    </button>
  );
}

export function SignupForm({
  departments,
  emailDomainHint,
}: {
  departments: Array<{ id: string; name: string }>;
  emailDomainHint: string | null;
}) {
  const [state, formAction] = useActionState<SignupState, FormData>(signupAction, {});

  return (
    <form action={formAction} noValidate className="space-y-6">
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

      <Field id="fullName" label="Full name" errors={state.fieldErrors?.fullName}>
        {(props) => (
          <input
            {...props}
            name="fullName"
            type="text"
            autoComplete="name"
            required
            defaultValue={state.values?.fullName}
            className={inputClass}
          />
        )}
      </Field>

      <Field
        id="email"
        label="College email address"
        hint={
          emailDomainHint
            ? `Must end in ${emailDomainHint}. Personal addresses cannot be registered.`
            : 'Use your college address. Personal addresses cannot be registered.'
        }
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
            defaultValue={state.values?.email}
            className={inputClass}
          />
        )}
      </Field>

      {/*
        A native <select> rather than a custom listbox: it is keyboard- and
        screen-reader-correct with no work, and on a phone it opens the OS picker, which
        is far better at 360px than a scrolling popover.
      */}
      <Field
        id="departmentId"
        label="Department"
        hint="Determines which administrator reviews your account."
        errors={state.fieldErrors?.departmentId}
      >
        {(props) => (
          <select
            {...props}
            name="departmentId"
            required
            defaultValue={state.values?.departmentId ?? ''}
            className={`${inputClass} appearance-none bg-[length:1.1rem] bg-[right_0.9rem_center] bg-no-repeat pr-10`}
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%236B6B63' stroke-width='1.6'%3E%3Cpath d='M6 8l4 4 4-4'/%3E%3C/svg%3E\")",
            }}
          >
            <option value="" disabled>
              Select your department
            </option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
      </Field>

      <SubmitButton />
    </form>
  );
}
