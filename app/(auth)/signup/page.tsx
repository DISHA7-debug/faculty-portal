import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  AuthSplit,
  PanelHeading,
  PanelSteps,
} from '@/components/auth/auth-split';
import { getOptionalSession } from '@/lib/auth/session';
import { db } from '@/lib/db';

import { SignupForm } from './signup-form';

/**
 * Sets expectations before the form is submitted.
 *
 * The two-step gate — confirm your address, THEN wait for an administrator — is the part
 * people are most likely to read as a fault. Someone who signs up and sees nothing public
 * an hour later will assume it is broken unless they were told, in advance, that a human
 * review sits in the middle.
 */
function SignupPanel() {
  return (
    <>
      <PanelHeading>What happens next</PanelHeading>
      <PanelSteps
        steps={[
          {
            title: 'Confirm your email address',
            body: 'We email you a 6-digit code. Entering it both confirms your address and signs you in — there is no password to choose.',
          },
          {
            title: 'An administrator reviews your account',
            body: 'Your department administrator checks that the account belongs to a member of staff. This is a person, so it is not instant.',
          },
          {
            title: 'Your profile goes public',
            body: 'Once approved, you choose when to publish. You can fill everything in while the review is pending.',
          },
        ]}
      />
      <hr className="my-8 border-hairline" />
      <p className="text-[0.8rem] leading-relaxed text-muted-foreground">
        The review step exists because a college email address alone does not prove
        somebody is a member of staff.
      </p>
    </>
  );
}

/**
 * Must not be prerendered: the department list is read from the database, and a build-time
 * snapshot would omit any department added afterwards. The route table showed this page as
 * static (`○`) before this line was added.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Create an account',
  description: 'Register for a faculty profile with your college email address.',
  robots: { index: false, follow: false },
};

/** First configured domain, shown as a hint so the rule is visible before submitting. */
function emailDomainHint(): string | null {
  const first = process.env.ALLOWED_EMAIL_DOMAINS?.split(',')[0]?.trim();
  return first ? `@${first}` : null;
}

export default async function SignupPage() {
  // A REAL check, not proxy.ts's presence-only one — see the long comment there. Someone
  // already signed in has nothing to gain from the signup form; a stale, invalid cookie
  // must not block them from creating an account.
  if (await getOptionalSession()) redirect('/dashboard');

  // Department is required on Profile, so the list has to be loaded before the form can
  // be filled in — there is no valid signup without one.
  const departments = await db.department.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  return (
    <AuthSplit panel={<SignupPanel />}>
      <header>
        <h1 className="text-[2.75rem] leading-[1.06] tracking-[-0.015em] sm:text-5xl">
          Create an account
        </h1>
        <p className="measure mt-4 text-[0.95rem] leading-relaxed text-muted-foreground">
          For teaching and research staff. Takes about a minute.
        </p>
      </header>

      <div className="mt-10">
        {departments.length === 0 ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/35 bg-destructive/8 px-4 py-3 text-[0.875rem] leading-relaxed"
          >
            No departments have been set up yet, so accounts cannot be created. Contact
            the portal administrator.
          </p>
        ) : (
          <SignupForm departments={departments} emailDomainHint={emailDomainHint()} />
        )}
      </div>

      <hr className="mt-10 border-hairline" />

      <p className="mt-6 text-[0.875rem] leading-relaxed text-muted-foreground">
        Already registered?{' '}
        <Link
          href="/login"
          className="rounded-sm font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Sign in
        </Link>
        .
      </p>
    </AuthSplit>
  );
}
