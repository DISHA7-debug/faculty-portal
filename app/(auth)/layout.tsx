import { Providers } from '@/components/providers';

/**
 * Auth form routes: login, signup, forgot-password, reset-password.
 *
 * Thin on purpose. The two-column shell lives in components/auth/auth-split.tsx so each
 * page supplies its own right-hand panel — see the note there.
 *
 * No `headers()` in this subtree, so these pages serve under the public CSP and are not
 * forced dynamic by the layout (docs/SECURITY.md §7.1).
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <Providers>{children}</Providers>;
}
