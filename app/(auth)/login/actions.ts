'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { requestLoginCode } from '@/lib/auth/config';
import { clientIpFromHeaders } from '@/lib/request-ip';
import { safeNextPath } from '@/lib/safe-redirect';
import { requestCodeSchema } from '@/lib/validation/auth';

/**
 * Step one of sign-in: send a code to an address.
 *
 * Always proceeds to the code screen, whether or not an account exists. A "no account
 * with that address" response would turn this form into a membership oracle for a
 * directory that publishes every faculty email (docs/SECURITY.md §2.2).
 *
 * The client IP comes from clientIpFromHeaders, never from the form — a body-supplied
 * address would let an attacker rotate it and walk through every IP-keyed limit.
 */

export type RequestCodeState = {
  error?: string;
  fieldErrors?: { email?: string[] };
  email?: string;
};

export async function requestCodeAction(
  _previous: RequestCodeState,
  formData: FormData,
): Promise<RequestCodeState> {
  const rawEmail = String(formData.get('email') ?? '');
  const next = safeNextPath(String(formData.get('next') ?? ''));

  const parsed = requestCodeSchema.safeParse({ email: rawEmail });
  if (!parsed.success) {
    return {
      fieldErrors: { email: parsed.error.issues.map((i) => i.message) },
      email: rawEmail,
    };
  }

  const result = await requestLoginCode(
    parsed.data.email,
    clientIpFromHeaders(await headers()),
  );

  if (!result.ok) {
    const minutes = Math.ceil(result.retryAfterSeconds / 60);
    return {
      error: `Too many sign-in requests from this network. Try again in about ${minutes} minute${
        minutes === 1 ? '' : 's'
      }.`,
      email: rawEmail,
    };
  }

  redirect(
    `/verify?email=${encodeURIComponent(parsed.data.email)}&next=${encodeURIComponent(next)}`,
  );
}
