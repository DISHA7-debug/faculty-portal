import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AuthSplit, PanelHeading } from '@/components/auth/auth-split';
import { getOptionalSession } from '@/lib/auth/session';
import { safeNextPath } from '@/lib/safe-redirect';

import { LoginForm } from './login-form';

/** Answers "is this the real portal, and why can't I publish yet?". */
function LoginPanel() {
  return (
    <>
      <PanelHeading>About this portal</PanelHeading>
      <p className="measure mt-5 text-[0.95rem] leading-relaxed text-muted-foreground">
        There is no password. Enter your college address and we email you a short code that
        works once and expires in ten minutes.
      </p>
      <p className="measure mt-4 text-[0.95rem] leading-relaxed text-muted-foreground">
        Nothing to remember, nothing to reset, and nothing worth stealing from our database
        — a code that has been used is worthless.
      </p>
      <hr className="my-8 border-hairline" />
      <p className="text-[0.8rem] leading-relaxed text-muted-foreground">
        Codes arrive from the portal within a minute or two. Institutional mail servers
        sometimes queue them, so check spam before requesting another.
      </p>
    </>
  );
}

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to manage your faculty profile.',
  // A login page has no business in search results.
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;

  // A REAL check, not proxy.ts's presence-only one — see the long comment there for why
  // that distinction is load-bearing. A visitor already holding a valid session has no
  // reason to see this form; one holding only a stale, invalid cookie is exactly who must
  // still be able to reach it.
  if (await getOptionalSession()) redirect('/dashboard');

  // Validated here as well as in the action. The value reaches this page from the URL,
  // so it is attacker-controlled at both points and is checked at both.
  const next = safeNextPath(params.next);

  return (
    <AuthSplit panel={<LoginPanel />}>
      <header>
        <h1 className="text-[2.75rem] leading-[1.06] tracking-[-0.015em] sm:text-5xl">
          Sign in
        </h1>
        <p className="measure mt-4 text-[0.95rem] leading-relaxed text-muted-foreground">
          Enter your college email address and we will send you a sign-in code.
        </p>
      </header>

      <div className="mt-10">
        <LoginForm next={next} />
      </div>

    </AuthSplit>
  );
}
