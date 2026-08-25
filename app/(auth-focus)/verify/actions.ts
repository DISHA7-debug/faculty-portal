'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { requestLoginCode, verifyLoginCode } from '@/lib/auth/config';
import { setSessionCookie } from '@/lib/auth/session';
import { clientIpFromHeaders } from '@/lib/request-ip';
import { safeNextPath } from '@/lib/safe-redirect';
import { verifyCodeSchema } from '@/lib/validation/auth';

/**
 * Step two: verify the code and sign in.
 *
 * Unlike the credential errors this replaced, the failures here CAN be distinguished
 * safely. Every one of them presupposes an outstanding code for this address, which the
 * person only learns about by receiving the email — so "that code has expired" reveals
 * nothing to somebody who never had it, and telling the real user which of expired,
 * mistyped, or exhausted applies is the difference between one more try and giving up.
 *
 * The one case that is deliberately blurred: an address with NO account answers exactly
 * as a wrong code does (handled in verifyLoginCode), because that distinction WOULD leak.
 */

export type VerifyState = {
  error?: string;
  /** Shown beside the field so a mistyped digit is obviously recoverable. */
  attemptsRemaining?: number;
  /** True once the code is dead and a fresh one is needed. */
  needsNewCode?: boolean;
  resent?: boolean;
};

export async function verifyCodeAction(
  _previous: VerifyState,
  formData: FormData,
): Promise<VerifyState> {
  const email = String(formData.get('email') ?? '');
  const next = safeNextPath(String(formData.get('next') ?? ''));

  const parsed = verifyCodeSchema.safeParse({
    email,
    code: String(formData.get('code') ?? ''),
  });

  if (!parsed.success) {
    return { error: 'Enter the 6-digit code from your email.' };
  }

  const requestHeaders = await headers();
  const ip = clientIpFromHeaders(requestHeaders);

  const result = await verifyLoginCode(parsed.data.email, parsed.data.code, ip, {
    userAgent: requestHeaders.get('user-agent'),
    ipAddress: ip,
  });

  if (!result.ok) {
    switch (result.reason) {
      case 'WRONG_CODE':
        return {
          error: 'That code is not right.',
          attemptsRemaining: result.attemptsRemaining,
        };
      case 'EXPIRED':
        return {
          error: 'That code has expired. Codes last 10 minutes.',
          needsNewCode: true,
        };
      case 'NO_CODE':
        return {
          error: 'There is no code waiting for this address. Request a new one.',
          needsNewCode: true,
        };
      case 'TOO_MANY_ATTEMPTS':
        return {
          error:
            'Too many incorrect attempts, so that code has been cancelled. Request a new one.',
          needsNewCode: true,
        };
      case 'NOT_ELIGIBLE':
        // Suspended or rejected. Says nothing about why, and offers the one route that
        // can actually help.
        return {
          error:
            'This account cannot sign in. Contact your department administrator.',
        };
    }
  }

  // Cookie is written here, in the request scope that owns it.
  await setSessionCookie(result.session.rawToken, result.session.expiresAt);

  // A first sign-in has just verified the address and moved the account to
  // PENDING_APPROVAL — send them somewhere that explains that, rather than to a dashboard
  // whose publish controls will not work yet.
  redirect(result.firstSignIn ? '/awaiting-approval' : next);
}

/** Sends a fresh code to the same address. */
export async function resendCodeAction(
  _previous: VerifyState,
  formData: FormData,
): Promise<VerifyState> {
  const email = String(formData.get('email') ?? '');
  const result = await requestLoginCode(email, clientIpFromHeaders(await headers()));

  if (!result.ok) {
    const minutes = Math.ceil(result.retryAfterSeconds / 60);
    return {
      error: `Too many requests from this network. Try again in about ${minutes} minute${
        minutes === 1 ? '' : 's'
      }.`,
    };
  }

  return { resent: true };
}
