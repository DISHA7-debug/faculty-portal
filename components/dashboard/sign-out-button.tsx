import { signOutAction } from '@/app/dashboard/actions';

/**
 * Ends the current session.
 *
 * Plain `<form action={signOutAction}>` — no client component, no confirmation dialog.
 * Signing out is instantly and completely reversible (sign back in with a fresh code), so a
 * confirmation step would cost a click on every use to guard against a mistake that costs
 * nothing to undo.
 */
export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="inline-flex min-h-8 items-center rounded-md border border-border bg-background px-2.5 text-[0.78rem] text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        Sign out
      </button>
    </form>
  );
}
