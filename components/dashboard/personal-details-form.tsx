'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Field, inputClass } from '@/components/auth/field';
import {
  updateProfileAction,
  type UpdateProfileState,
} from '@/app/dashboard/profile/actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 text-[0.95rem] font-medium text-primary-foreground transition-colors outline-none hover:bg-primary/92 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-70"
    >
      <span aria-live="polite">{pending ? 'Saving…' : 'Save details'}</span>
    </button>
  );
}

export type ProfileValues = {
  fullName: string;
  designation: string;
  officeNo: string;
  mobile: string;
  phoneExt: string;
  altEmail: string;
  about: string;
  personalPageUrl: string;
  linkedinUrl: string;
  orcid: string;
  scopusId: string;
  googleScholarId: string;
  researcherId: string;
  showMobile: boolean;
  showPhoneExt: boolean;
  showAltEmail: boolean;
};

/**
 * Visibility toggle.
 *
 * The label states the PUBLIC consequence, not the mechanism. "Show my mobile number on
 * my public profile" is checkable without thinking; "showMobile" is not, and a checkbox
 * whose effect is unclear gets left at whatever it defaulted to.
 */
function VisibilityToggle({
  name,
  defaultChecked,
  label,
  onDescription,
  offDescription,
}: {
  name: string;
  defaultChecked: boolean;
  label: string;
  onDescription: string;
  offDescription: string;
}) {
  return (
    <div className="flex gap-3 rounded-md border border-border bg-surface-raised p-4">
      <input
        id={name}
        name={name}
        type="checkbox"
        defaultChecked={defaultChecked}
        aria-describedby={`${name}-desc`}
        className="mt-0.5 size-5 shrink-0 rounded border-input accent-[var(--primary)] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />
      <div>
        <label htmlFor={name} className="block text-[0.95rem] font-medium">
          {label}
        </label>
        <p id={`${name}-desc`} className="mt-1 text-[0.82rem] leading-relaxed text-muted-foreground">
          Ticked: {onDescription} Unticked: {offDescription}
        </p>
      </div>
    </div>
  );
}

export function PersonalDetailsForm({ initial }: { initial: ProfileValues }) {
  const [state, formAction] = useActionState<UpdateProfileState, FormData>(
    updateProfileAction,
    {},
  );

  const text = (
    name: keyof ProfileValues,
    label: string,
    opts: { hint?: string; placeholder?: string; type?: string; required?: boolean } = {},
  ) => (
    <Field id={name} label={label} hint={opts.hint} errors={state.fieldErrors?.[name]}>
      {(props) => (
        <input
          {...props}
          name={name}
          type={opts.type ?? 'text'}
          required={opts.required}
          placeholder={opts.placeholder}
          defaultValue={String(initial[name] ?? '')}
          className={inputClass}
        />
      )}
    </Field>
  );

  return (
    <form action={formAction} noValidate className="space-y-8">
      {state.error ? (
        <p
          role="alert"
          data-testid="profile-error"
          tabIndex={-1}
          className="rounded-md border border-destructive/35 bg-destructive/8 px-4 py-3 text-[0.875rem] leading-relaxed"
        >
          {state.error}
        </p>
      ) : null}

      {state.ok ? (
        <p role="status" className="rounded-md border border-border bg-surface-raised px-4 py-3 text-[0.875rem]">
          Saved.
        </p>
      ) : null}

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="sm:col-span-2">
          {text('fullName', 'Full name', { required: true })}
        </div>
        {text('designation', 'Designation', { placeholder: 'Assistant Professor' })}
        {text('officeNo', 'Office', { placeholder: 'Room 214' })}
      </div>

      <Field
        id="about"
        label="About"
        hint="A short biography for your public page. Plain text."
        errors={state.fieldErrors?.about}
      >
        {(props) => (
          <textarea
            {...props}
            name="about"
            rows={6}
            defaultValue={initial.about}
            className={`${inputClass} resize-y`}
          />
        )}
      </Field>

      <fieldset className="space-y-6">
        <legend className="text-[1.1rem] font-medium">Contact</legend>
        <div className="grid gap-6 sm:grid-cols-2">
          {text('mobile', 'Mobile number', { type: 'tel', placeholder: '+91 90000 00000' })}
          {text('phoneExt', 'Phone / Extension', { placeholder: '+91 141 3999100 ext. 214' })}
          <div className="sm:col-span-2">
            {text('altEmail', 'Alternative email', { type: 'email' })}
          </div>
        </div>

        <VisibilityToggle
          name="showMobile"
          defaultChecked={initial.showMobile}
          label="Show my mobile number on my public profile"
          onDescription="anyone visiting your page can see it."
          offDescription="it is stored but never shown publicly."
        />
        <VisibilityToggle
          name="showPhoneExt"
          defaultChecked={initial.showPhoneExt}
          label="Show my phone / extension number on my public profile"
          onDescription="anyone visiting your page can see it."
          offDescription="it is stored but never shown publicly."
        />
        <VisibilityToggle
          name="showAltEmail"
          defaultChecked={initial.showAltEmail}
          label="Show my alternative email on my public profile"
          onDescription="anyone visiting your page can see it."
          offDescription="it is stored but never shown publicly."
        />
      </fieldset>

      <fieldset className="space-y-6">
        <legend className="text-[1.1rem] font-medium">Academic identifiers</legend>
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="sm:col-span-2">
            {text('orcid', 'ORCID iD', {
              placeholder: '0000-0002-1825-0097',
              hint: 'Checked against its check digit — a wrong iD on a public page points visitors at the wrong researcher. A full orcid.org link is fine.',
            })}
          </div>
          {text('scopusId', 'Scopus Author ID')}
          {text('googleScholarId', 'Google Scholar ID')}
          {text('researcherId', 'ResearcherID')}
          {text('personalPageUrl', 'Personal page', { placeholder: 'https://…' })}
          <div className="sm:col-span-2">
            {text('linkedinUrl', 'LinkedIn', { placeholder: 'https://www.linkedin.com/in/…' })}
          </div>
        </div>
      </fieldset>

      <SubmitButton />
    </form>
  );
}
