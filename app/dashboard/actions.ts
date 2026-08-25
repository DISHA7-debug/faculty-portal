'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { clearSessionCookie, destroySession, SESSION_COOKIE } from '@/lib/auth/session';

/**
 * Ends the current session. This did not exist anywhere in the app — nothing in the UI
 * could end a session, so the only way to stop being signed in was to delete the cookie by
 * hand in DevTools. Logged as a gap in docs/SPRINTS.md; this closes it.
 *
 * A plain form action rather than a client-side handler: `<form action={signOutAction}>`
 * works with JavaScript disabled and needs no `useTransition`/toast plumbing for something
 * that immediately navigates away regardless of how it's called.
 *
 * Reads the raw token from the cookie to find the row (destroySession hashes it internally
 * — the hash is never handled here), deletes that Session row, clears the cookie, and
 * redirects. The delete happens server-side and immediately, matching the rest of this
 * app's session model: revocation is a row delete, not a client-side forget.
 */
export async function signOutAction(): Promise<void> {
  const store = await cookies();
  const rawToken = store.get(SESSION_COOKIE)?.value;

  if (rawToken) {
    await destroySession(rawToken);
  }
  await clearSessionCookie();

  redirect('/login');
}
