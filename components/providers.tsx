import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';

/**
 * Client-side providers, shared by every subtree layout.
 *
 * Deliberately NOT in the root layout. next-themes renders an inline script — the one
 * that reads the stored theme and sets the class before first paint, preventing a flash
 * of the wrong theme — and under the strict CSP on authenticated routes that script needs
 * the request nonce. Reading the nonce requires `headers()`, and calling `headers()` in
 * the ROOT layout marks every route in the application dynamic, including the public
 * landing page and directory. That was measured: `/` went from static to dynamic the
 * moment the root layout awaited headers().
 *
 * So the provider lives one level down instead:
 *
 *   app/(public)/layout.tsx   no nonce   — stays statically rendered; the public CSP
 *                                          allows 'unsafe-inline', so the script runs
 *   app/dashboard/layout.tsx  nonce      — already dynamic, so headers() costs nothing
 *
 * Public pages keep their LCP budget (PROJECT_PLAN §1.2) and authenticated pages keep a
 * nonce-based CSP with no un-nonced inline script.
 */
export function Providers({
  children,
  nonce,
}: {
  children: React.ReactNode;
  /** Omit on public routes; supply from `headers().get('x-nonce')` on authenticated ones. */
  nonce?: string;
}) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      nonce={nonce}
    >
      {children}
      <Toaster />
    </ThemeProvider>
  );
}
