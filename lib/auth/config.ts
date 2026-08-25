import { AccountStatus, TokenType } from '@prisma/client';

import { generateOtpCode, OTP_MAX_ATTEMPTS } from '@/lib/auth/otp';
import { createSession, type SessionContext } from '@/lib/auth/session';
import { consumeOtp, issueToken } from '@/lib/auth/tokens';
import { db } from '@/lib/db';
import { loginCodeEmail } from '@/lib/email-templates';
import { sendMail } from '@/lib/mailer';
import {
  OTP_REQUEST_EMAIL_WINDOW_SECONDS,
  RULES,
  clearLoginThrottle,
  emailKey,
  enforce,
  ipKey,
  mailRequestDelayMs,
  sleep,
  softThrottle,
} from '@/lib/rate-limit';

/**
 * Email one-time-code authentication.
 *
 * Identity is proven by demonstrating control of a college mailbox. There is no password:
 * nothing to hash, nothing to reset, nothing to leak in a dump, and no credential a
 * faculty member can reuse from an already-breached site.
 *
 * WHAT DID NOT CHANGE: everything after identity is proven. Sessions are still rows in the
 * Session table keyed by SHA-256 of a random cookie value, still revocable by deleting the
 * row, still carried in a __Host- cookie. The admin approval queue and account suspension
 * both depend on revoking a live session, which a stateless token cannot express.
 *
 * ── The two rate limits, and why they differ ────────────────────────────────────
 *
 * REQUESTING a code follows the standing principle (CLAUDE.md §3.7): hard cap on the IP,
 * which the requester owns; escalating delay on the email, which is published in the
 * faculty directory and must never become a lever for locking somebody out.
 *
 * VERIFYING a code is the opposite case and is capped HARD at 5 attempts. A 6-digit code
 * is one of a million, so an uncapped verify endpoint is brute-forceable in an afternoon.
 * The cap sits on the CODE, not the account — it destroys the attacker's target rather
 * than the victim's access, because a fresh code can always be requested.
 */

export type RequestCodeResult =
  | { ok: true }
  | { ok: false; reason: 'RATE_LIMITED'; retryAfterSeconds: number };

/**
 * Statuses permitted to request and use a code.
 *
 * PENDING_VERIFICATION is included deliberately: a brand-new account's first successful
 * code IS its email verification. That is how signup and sign-in collapse into one flow.
 */
const SIGN_IN_ELIGIBLE: readonly AccountStatus[] = [
  AccountStatus.ACTIVE,
  AccountStatus.PENDING_APPROVAL,
  AccountStatus.PENDING_VERIFICATION,
];

/**
 * Sends a login code, if the address belongs to an eligible account.
 *
 * Always reports success. "No account with that address" would turn this into a membership
 * oracle for a directory that publishes every faculty email (docs/SECURITY.md §2.2).
 */
export async function requestLoginCode(
  rawEmail: string,
  ip: string,
): Promise<RequestCodeResult> {
  const email = rawEmail.trim().toLowerCase();

  const perIp = await enforce(ipKey('otp-request', ip), RULES.otpRequestPerIp, 'closed');
  if (!perIp.allowed) {
    return { ok: false, reason: 'RATE_LIMITED', retryAfterSeconds: perIp.retryAfterSeconds };
  }

  // Escalating delay on the address — never a block, or anyone could stall a colleague's
  // ability to sign in at all simply by requesting codes for them.
  const pressure = await softThrottle(
    emailKey('otp-request', email),
    OTP_REQUEST_EMAIL_WINDOW_SECONDS,
    mailRequestDelayMs,
  );
  await sleep(pressure.delayMs);

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, status: true },
  });

  if (user && SIGN_IN_ELIGIBLE.includes(user.status)) {
    const code = generateOtpCode();
    await issueToken(user.id, TokenType.LOGIN_OTP, code);

    try {
      await sendMail(loginCodeEmail(email, code));
    } catch (error) {
      // Logged, never surfaced: reporting a send failure for one address and not another
      // would leak which addresses have accounts.
      console.error('[auth] login code failed to send:', error);
    }
  }

  return { ok: true };
}

export type VerifyCodeResult =
  | {
      ok: true;
      status: AccountStatus;
      firstSignIn: boolean;
      /**
       * Raw session token for the caller to put in a cookie.
       *
       * Returned rather than written here so this function stays callable outside a
       * request scope — `cookies()` throws anywhere else, which made the whole sign-in
       * path untestable. Mirrors createSession/setSessionCookie in lib/auth/session.ts.
       */
      session: { rawToken: string; expiresAt: Date };
    }
  | {
      ok: false;
      reason: 'WRONG_CODE' | 'NO_CODE' | 'EXPIRED' | 'TOO_MANY_ATTEMPTS' | 'NOT_ELIGIBLE';
      attemptsRemaining?: number;
    };

/**
 * Verifies a code and, on success, signs the user in.
 *
 * On a PENDING_VERIFICATION account the successful code doubles as email verification and
 * advances the account to PENDING_APPROVAL — never to ACTIVE. Approval stays an
 * administrator decision, because a college address alone does not prove somebody is
 * staff (docs/SECURITY.md §2.1).
 *
 * Does NOT write the cookie — it returns the session token for the caller to set, so this
 * remains callable from a test or a script.
 */
export async function verifyLoginCode(
  rawEmail: string,
  submittedCode: string,
  ip: string,
  context: SessionContext = {},
): Promise<VerifyCodeResult> {
  const email = rawEmail.trim().toLowerCase();

  // Hard cap on verification attempts from one source, on top of the per-code cap.
  const perIp = await enforce(ipKey('otp-verify', ip), RULES.otpVerifyPerIp, 'closed');
  if (!perIp.allowed) {
    return { ok: false, reason: 'TOO_MANY_ATTEMPTS', attemptsRemaining: 0 };
  }

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, status: true },
  });

  // No account: answer exactly as a wrong code does.
  if (!user) {
    return { ok: false, reason: 'WRONG_CODE', attemptsRemaining: OTP_MAX_ATTEMPTS };
  }

  if (!SIGN_IN_ELIGIBLE.includes(user.status)) {
    return { ok: false, reason: 'NOT_ELIGIBLE' };
  }

  const result = await consumeOtp(user.id, submittedCode);
  if (!result.ok) {
    return { ok: false, reason: result.reason, attemptsRemaining: result.attemptsRemaining };
  }

  const firstSignIn = user.status === AccountStatus.PENDING_VERIFICATION;
  const status = firstSignIn ? AccountStatus.PENDING_APPROVAL : user.status;

  await db.user.update({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(),
      ...(firstSignIn
        ? { status: AccountStatus.PENDING_APPROVAL, emailVerifiedAt: new Date() }
        : {}),
    },
  });

  // The session layer is untouched by this change.
  const session = await createSession(user.id, context);

  await clearLoginThrottle(email, ip);

  return { ok: true, status, firstSignIn, session };
}
