import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * One-time login codes.
 *
 * ── Why HMAC and not the plain SHA-256 the other tokens use ─────────────────────
 *
 * DELIBERATE DEVIATION, flagged because it contradicts "hashed at rest exactly like
 * current tokens".
 *
 * The existing tokens are 32 random bytes — 2^256 possibilities — so SHA-256 of one is
 * not reversible by any means. A login code is SIX DIGITS: one million possibilities.
 * An attacker holding a database dump can hash all one million candidates in well under a
 * second on a laptop and read every outstanding code directly. Plain SHA-256 of a
 * low-entropy secret is not a hash in any protective sense; it is an encoding.
 *
 * Keying the digest with AUTH_SECRET means the database alone is not enough — the
 * attacker also needs the application secret, which lives in the server's environment and
 * not in Postgres. That is the whole property "hashed at rest" is supposed to buy, and
 * plain SHA-256 does not buy it here.
 *
 * This is the same intent as the existing scheme (never store the raw value, compare by
 * digest), applied to a secret with a millionth of the entropy.
 */

/** 10 minutes. Long enough for a slow institutional mail queue, short enough to matter. */
export const OTP_TTL_MS = 10 * 60 * 1000;

/**
 * Attempts allowed against one code before it is destroyed.
 *
 * With 5 attempts per code, guessing a 6-digit code costs an expected 100,000 code
 * requests — and code requests are themselves throttled per IP and delayed per email.
 * Raising this materially weakens the whole scheme: the code length is fixed, so the
 * attempt cap IS the security parameter.
 */
export const OTP_MAX_ATTEMPTS = 5;

export const OTP_LENGTH = 6;

/**
 * Generates a cryptographically random 6-digit code.
 *
 * `crypto.randomInt` rather than `Math.random`: the latter is seeded predictably and is
 * not a security primitive. Leading zeros are preserved by padding, so `000123` is a
 * valid code and the space really is 10^6 rather than 9·10^5.
 */
export function generateOtpCode(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value?.trim()) {
    // Fail loudly. A missing key would silently degrade every code digest to a constant
    // keying, which is worse than plain SHA-256 because it looks safe.
    throw new Error('AUTH_SECRET is not set — cannot hash login codes.');
  }
  return value;
}

/** Keyed digest of a code. The only form ever stored. */
export function hashOtpCode(code: string): string {
  return createHmac('sha256', secret()).update(code).digest('hex');
}

/**
 * Constant-time comparison of two hex digests.
 *
 * A plain `===` on the digest leaks, through timing, how many leading characters matched.
 * That is not enough to recover a code on its own, but it is free to avoid.
 */
export function otpDigestsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Accepts what a person actually types: spaces, dashes, or a pasted code. */
export function normaliseOtpInput(raw: string): string {
  return raw.replace(/[\s-]/g, '').trim();
}

export function isWellFormedOtp(code: string): boolean {
  return new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code);
}

/** Formats for display in an email: `123 456` is easier to transcribe than `123456`. */
export function formatOtpForDisplay(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}
