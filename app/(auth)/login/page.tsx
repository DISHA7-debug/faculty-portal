import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getOptionalSession } from '@/lib/auth/session';
import { safeNextPath } from '@/lib/safe-redirect';

import { ThemeToggle } from '@/components/theme-toggle';
import KnowledgeGlobe from './knowledge-globe';
import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to manage your faculty profile.',
  robots: {
    index: false,
    follow: false,
  },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string;
  }>;
}) {
  const params = await searchParams;

  // Check if user is already logged in
  if (await getOptionalSession()) {
    redirect('/dashboard');
  }

  // Validate redirect path
  const next = safeNextPath(params.next);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {/* =====================================================
          HEADER
      ====================================================== */}
      <header className="absolute left-6 right-6 top-6 z-30 flex items-center justify-between sm:left-10 sm:right-12 sm:top-10 lg:right-14">
        <Link
          href="/"
          className="group inline-flex items-center gap-2 text-[0.9rem] text-muted-foreground transition-colors hover:text-foreground"
        >
          <span
            aria-hidden="true"
            className="transition-transform duration-200 group-hover:-translate-x-1"
          >
            &larr;
          </span>
          Return to directory
        </Link>
        <ThemeToggle />
      </header>

      {/* =====================================================
          MAIN
      ====================================================== */}
      <main className="grid min-h-dvh lg:grid-cols-[0.85fr_1.15fr]">
        {/* ===================================================
            LEFT — LOGIN
        ==================================================== */}
        <section className="relative z-20 flex items-center bg-background px-6 py-28 sm:px-12 lg:px-20 xl:px-28">
          <div className="w-full max-w-[430px]">
            {/* =================================================
                BRAND
            ================================================= */}
            <div className="mb-10 text-center">
              {/* Faculty Portal badge */}
              <div className="mx-auto mb-6 inline-flex h-12 items-center justify-center rounded-full border border-hairline bg-surface-sunken px-4 font-mono text-[0.7rem] uppercase tracking-[0.15em] text-muted-foreground">
                <span
                  aria-hidden="true"
                  className="mr-2 flex size-1.5 rounded-full bg-primary"
                />
                Faculty Portal
              </div>

              {/* Heading */}
              <h1 className="font-display text-[2.75rem] leading-[1.06] tracking-[-0.015em] text-foreground sm:text-5xl">
                Sign in
              </h1>

              {/* Description */}
              <p className="mt-4 text-[0.95rem] leading-relaxed text-muted-foreground">
                Enter your college email address to receive a secure, one-time
                sign-in code.
              </p>
            </div>

            {/* =================================================
                LOGIN FORM
            ================================================= */}
            <LoginForm next={next} />

            {/* =================================================
                FOOTER MESSAGE
            ================================================= */}
            <p className="mt-8 text-center text-[0.85rem] text-muted-foreground/80">
              No passwords to remember. Simple and secure.
            </p>
          </div>
        </section>

        {/* ===================================================
            RIGHT — KNOWLEDGE NETWORK
        ==================================================== */}
        <section className="relative hidden overflow-hidden border-l border-hairline bg-[#080808] lg:block">
          {/* Subtle grid background */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.025]"
            style={{
              backgroundImage: `
                linear-gradient(
                  rgba(255,255,255,0.5) 1px,
                  transparent 1px
                ),
                linear-gradient(
                  90deg,
                  rgba(255,255,255,0.5) 1px,
                  transparent 1px
                )
              `,
              backgroundSize: '50px 50px',
            }}
          />

          {/* =================================================
              TOP INFORMATION
          ================================================= */}
          <div className="absolute left-10 right-10 top-10 z-20 flex items-start justify-between">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-[#d6b98c]">
                Academic Network
              </p>
              <p className="mt-2 text-xs text-white/30">
                Connecting knowledge across MUJ
              </p>
            </div>

            <div className="text-right font-mono text-[8px] uppercase leading-5 tracking-[0.2em] text-white/20">
              <p>MUJ / 2026</p>
              <p>FACULTY SYSTEM</p>
            </div>
          </div>

          {/* =================================================
              3D KNOWLEDGE SPHERE
          ================================================= */}
          <KnowledgeGlobe />

          {/* =================================================
              BOTTOM INFORMATION
          ================================================= */}
          <div className="absolute bottom-8 left-10 right-10 z-20 flex items-end justify-between">
            <div>
              <p className="font-mono text-[8px] uppercase tracking-[0.3em] text-white/20">
                Manipal University Jaipur
              </p>
              <p className="mt-2 text-xs text-white/25">
                Academia • Research • Innovation
              </p>
            </div>

            <div className="text-right font-mono text-[8px] uppercase leading-5 tracking-[0.2em] text-white/20">
              <p>26.8436° N</p>
              <p>75.5650° E</p>
              <p className="text-[#d6b98c]/50">Jaipur / India</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}