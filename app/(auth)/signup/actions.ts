'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { signup } from '@/lib/auth/signup';
import { clientIpFromHeaders } from '@/lib/request-ip';

/**
 * Signup action.
 *
 * On success it redirects to /verify carrying the address, so that screen can name it
 * back. That is the address the person just typed, so echoing it reveals nothing they do
 * not already know — and seeing it is what lets them catch their own typo, the single most
 * common reason a code "never arrives".
 *
 * Success is reported identically whether or not the address was already registered
 * (docs/SECURITY.md §2.2), so this redirect happens either way.
 */

export type SignupState = {
  error?: string;
  retryAfterSeconds?: number;
  fieldErrors?: Record<string, string[]>;
  values?: { fullName?: string; email?: string; departmentId?: string };
};

function formatRetry(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? 'a minute' : `${minutes} minutes`;
}

export async function signupAction(
  _previous: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const values = {
    fullName: String(formData.get('fullName') ?? ''),
    email: String(formData.get('email') ?? ''),
    departmentId: String(formData.get('departmentId') ?? ''),
  };

  const ip = clientIpFromHeaders(await headers());

  const result = await signup(values, ip);

  if (!result.ok) {
    switch (result.reason) {
      case 'INVALID_INPUT':
        return { fieldErrors: result.fieldErrors, values };

      case 'DOMAIN_NOT_ALLOWED':
        return {
          fieldErrors: {
            email: [
              'Use your college email address. Personal addresses cannot be registered.',
            ],
          },
          values,
        };

      case 'DEPARTMENT_NOT_FOUND':
        return { fieldErrors: { departmentId: ['Select a department.'] }, values };

      case 'RATE_LIMITED':
        return {
          error: `Too many accounts have been created from this network. Try again in ${formatRetry(
            result.retryAfterSeconds,
          )}.`,
          retryAfterSeconds: result.retryAfterSeconds,
          values,
        };

      case 'SLUG_CONFLICT':
        // Genuinely rare: several people with the same display name registering at the
        // same instant. Reported honestly rather than as a false success, because a
        // person told "check your email" who has no account never recovers on their own.
        return {
          error:
            'We could not finish creating your account just now. Please try again — if ' +
            'it happens twice, contact your department administrator.',
          values,
        };
    }
  }

  // Straight to the code screen. Signing up sends a code, and entering it both verifies
  // the address and signs them in — there is no separate holding page any more.
  redirect(`/verify?email=${encodeURIComponent(values.email.trim().toLowerCase())}`);
}
