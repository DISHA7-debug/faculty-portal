import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';

import { getOptionalSession } from '@/lib/auth/session';
import { safeNextPath } from '@/lib/safe-redirect';

import { LoginForm } from './login-form';

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

  // A REAL check, not proxy.ts's presence-only one
  if (await getOptionalSession()) redirect('/dashboard');

  // Validated here as well as in the action.
  const next = safeNextPath(params.next);

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="absolute left-6 top-6 sm:left-10 sm:top-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-[0.9rem] text-muted-foreground transition-colors hover:text-foreground"
        >
          <span aria-hidden="true">&larr;</span>
          Return to directory
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col justify-center px-6 py-12">
        <div className="mb-10 text-center">
          <div className="mx-auto mb-6 inline-flex h-12 items-center justify-center rounded-full border border-hairline bg-surface-sunken px-4 font-mono text-[0.7rem] uppercase tracking-[0.15em] text-muted-foreground">
             <span className="mr-2 flex size-1.5 rounded-full bg-primary" />
             Faculty Portal
          </div>
          <h1 className="font-display text-[2.75rem] leading-[1.06] tracking-[-0.015em] sm:text-5xl">
            Sign in
          </h1>
          <p className="mt-4 text-[0.95rem] leading-relaxed text-muted-foreground">
            Enter your college email address to receive a secure, one-time sign-in code.
          </p>
        </div>

        <LoginForm next={next} />
        
        <p className="mt-8 text-center text-[0.85rem] text-muted-foreground/80">
          No passwords to remember. Simple and secure.
        </p>
      </main>
    </div>
  );
}
