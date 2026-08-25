import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getOptionalSession } from '@/lib/auth/session';
import { safeNextPath } from '@/lib/safe-redirect';
import { emailSchema } from '@/lib/validation/auth';

import { CodeForm } from './code-form';

export const metadata: Metadata = {
  title: 'Enter your code',
  robots: { index: false, follow: false },
};

/**
 * Code entry — the single screen where both signing up and signing in converge.
 *
 * This replaced three pages: the old check-your-email holding screen, the link-based
 * verification result, and the password reset form. Entering a code verifies the address
 * AND signs the person in, so there is nothing left to hold them between steps.
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; next?: string }>;
}) {
  const params = await searchParams;

  // A REAL check, not proxy.ts's presence-only one — see the long comment there. Once a
  // session genuinely exists this screen has nothing left to do (the code that would have
  // been entered here already signed the person in); a stale, invalid cookie must not
  // block someone who is mid-way through requesting a fresh code.
  if (await getOptionalSession()) redirect('/dashboard');

  // Validated before display. It arrives from the URL, and while it is the person's own
  // address in the normal flow, it must not be echoed unchecked.
  const parsed = emailSchema.safeParse(params.email ?? '');
  const email = parsed.success ? parsed.data : null;
  const next = safeNextPath(params.next);

  if (!email) {
    return (
      <>
        <h1 className="text-[2.5rem] leading-[1.08] tracking-[-0.015em] sm:text-[3rem]">
          Which address?
        </h1>
        <p className="measure mt-5 text-[1.05rem] leading-relaxed">
          This page needs to know where your code was sent. Start again from the sign-in
          page.
        </p>
        <div className="mt-9">
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-5 text-[0.95rem] font-medium text-primary-foreground transition-colors outline-none hover:bg-primary/92 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Go to sign in
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
        Check your email
      </p>

      <h1 className="mt-5 text-[2.5rem] leading-[1.08] tracking-[-0.015em] sm:text-[3rem]">
        Enter your code
      </h1>

      <p className="mt-5 text-[1.05rem] leading-relaxed">
        We sent a 6-digit code to{' '}
        <strong className="font-medium break-all">{email}</strong>.
      </p>
      <p className="measure mt-3 text-[0.95rem] leading-relaxed text-muted-foreground">
        It expires in 10 minutes and can be used once.
      </p>

      <div className="mt-10">
        <CodeForm email={email} next={next} />
      </div>

      <hr className="my-9 border-hairline" />

      <p className="text-[0.875rem] leading-relaxed text-muted-foreground">
        Wrong address?{' '}
        <Link
          href="/login"
          className="rounded-sm font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Start again
        </Link>
        .
      </p>
    </>
  );
}
