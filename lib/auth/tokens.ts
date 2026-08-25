import { createHash, randomBytes } from 'node:crypto';

import { Prisma, TokenType } from '@prisma/client';

import { hashOtpCode, OTP_MAX_ATTEMPTS, OTP_TTL_MS, otpDigestsMatch } from '@/lib/auth/otp';
import { db } from '@/lib/db';

/**
 * Single-use, expiring tokens.
 *
 * Two kinds share this table:
 *
 *   LOGIN_OTP      a 6-digit code emailed to prove control of an address. Used for both
 *                  first verification and every later sign-in — there is no password.
 *   EMAIL_CHANGE   a long random token in a link, as before.
 *
 * Neither is stored raw (CLAUDE.md §3.4). They are digested differently on purpose — see
 * hashFor() below.
 */

export type DbClient = typeof db | Prisma.TransactionClient;

/** TTLs — docs/SECURITY.md §2. */
export const TOKEN_TTL_MS: Record<TokenType, number> = {
  [TokenType.LOGIN_OTP]: OTP_TTL_MS,
  [TokenType.EMAIL_CHANGE]: 24 * 60 * 60 * 1000,
};

/** Long random token, for link-based flows. */
export function generateRawToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Digest appropriate to the token kind.
 *
 * A 32-byte random token is safe under plain SHA-256 — there is nothing to brute force.
 * A 6-digit code is not: a database dump plus one second of CPU recovers every
 * outstanding code. LOGIN_OTP is therefore keyed with AUTH_SECRET so the database alone
 * is insufficient. See the header of lib/auth/otp.ts.
 */
function hashFor(raw: string, type: TokenType): string {
  return type === TokenType.LOGIN_OTP
    ? hashOtpCode(raw)
    : createHash('sha256').update(raw).digest('hex');
}

/** Exposed for callers that need the digest of a long token. */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export type IssuedToken = { rawToken: string; expiresAt: Date };

/**
 * Issues a token, destroying any outstanding one of the same type for that user.
 *
 * Mandatory for codes, not merely tidy: several live codes would multiply the attacker's
 * chances per guess and let an attacker keep an old code alive by requesting new ones.
 * Newest request wins, everything before it dies.
 */
export async function issueToken(
  userId: string,
  type: TokenType,
  rawValue: string,
  payload?: string,
): Promise<IssuedToken> {
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS[type]);

  await db.$transaction([
    db.verificationToken.deleteMany({ where: { userId, type } }),
    db.verificationToken.create({
      data: {
        userId,
        type,
        payload: payload ?? null,
        tokenHash: hashFor(rawValue, type),
        expiresAt,
      },
    }),
  ]);

  return { rawToken: rawValue, expiresAt };
}

export type ConsumeResult =
  | { ok: true; userId: string; payload: string | null }
  | { ok: false; reason: 'INVALID' | 'EXPIRED' | 'ALREADY_USED' };

/**
 * Atomically validates and burns a long token (EMAIL_CHANGE).
 *
 * The `usedAt: null` predicate lives in the UPDATE's WHERE clause rather than in a prior
 * read, so two simultaneous requests cannot both succeed — the database serialises them
 * and exactly one matches.
 *
 * Pass a transaction client whenever the caller makes a dependent state change, so the
 * burn rolls back with it rather than stranding the user with a spent link.
 */
export async function consumeToken(
  rawToken: string,
  type: TokenType,
  client: DbClient = db,
): Promise<ConsumeResult> {
  const tokenHash = hashFor(rawToken, type);

  const { count } = await client.verificationToken.updateMany({
    where: { tokenHash, type, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });

  if (count === 1) {
    const token = await client.verificationToken.findFirst({
      where: { tokenHash, type },
      select: { userId: true, payload: true },
    });
    if (!token) return { ok: false, reason: 'INVALID' };
    return { ok: true, userId: token.userId, payload: token.payload };
  }

  const existing = await client.verificationToken.findFirst({
    where: { tokenHash, type },
    select: { usedAt: true, expiresAt: true },
  });

  if (!existing) return { ok: false, reason: 'INVALID' };
  if (existing.usedAt) return { ok: false, reason: 'ALREADY_USED' };
  if (existing.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'EXPIRED' };
  return { ok: false, reason: 'INVALID' };
}

export type ConsumeOtpResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'NO_CODE' | 'EXPIRED' | 'WRONG_CODE'; attemptsRemaining: number }
  | { ok: false; reason: 'TOO_MANY_ATTEMPTS'; attemptsRemaining: 0 };

/**
 * Verifies and burns a login code.
 *
 * Cannot reuse consumeToken's lookup-by-digest: a WRONG code digests to something that
 * matches no row, so there would be nothing to count the failed attempt against. The
 * outstanding code is therefore located by user, and its stored digest compared in
 * constant time.
 *
 * Everything happens in ONE transaction so a concurrent pair of guesses cannot both read
 * the same attempt count and each believe it had budget left.
 */
export async function consumeOtp(
  userId: string,
  submittedCode: string,
): Promise<ConsumeOtpResult> {
  return db.$transaction(async (tx) => {
    const token = await tx.verificationToken.findFirst({
      where: { userId, type: TokenType.LOGIN_OTP, usedAt: null },
      select: { id: true, tokenHash: true, attempts: true, expiresAt: true },
    });

    if (!token) return { ok: false, reason: 'NO_CODE', attemptsRemaining: 0 } as const;

    if (token.expiresAt.getTime() <= Date.now()) {
      await tx.verificationToken.delete({ where: { id: token.id } });
      return { ok: false, reason: 'EXPIRED', attemptsRemaining: 0 } as const;
    }

    // Count the attempt BEFORE comparing. Counting only failures would let an attacker
    // spend unlimited guesses if the comparison ever threw.
    const updated = await tx.verificationToken.update({
      where: { id: token.id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });

    // A request beyond the cap: the code should already be gone, so destroy and refuse
    // without even looking at what was submitted.
    if (updated.attempts > OTP_MAX_ATTEMPTS) {
      await tx.verificationToken.delete({ where: { id: token.id } });
      return { ok: false, reason: 'TOO_MANY_ATTEMPTS', attemptsRemaining: 0 } as const;
    }

    const correct = otpDigestsMatch(token.tokenHash, hashOtpCode(submittedCode));

    if (!correct) {
      // The cap counts CHECKED attempts, so the fifth guess is still compared — a correct
      // fifth guess must succeed. It is the fifth FAILURE that kills the code.
      //
      // Getting this boundary wrong is easy and quiet: comparing `> MAX` after the
      // increment leaves the code alive through five failures and only kills it on a sixth
      // request, silently granting an extra guess. That is a 20% larger search space for
      // an attacker and nothing visibly misbehaves.
      if (updated.attempts >= OTP_MAX_ATTEMPTS) {
        await tx.verificationToken.delete({ where: { id: token.id } });
        return { ok: false, reason: 'TOO_MANY_ATTEMPTS', attemptsRemaining: 0 } as const;
      }

      return {
        ok: false,
        reason: 'WRONG_CODE',
        attemptsRemaining: OTP_MAX_ATTEMPTS - updated.attempts,
      } as const;
    }

    await tx.verificationToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    });

    return { ok: true, userId } as const;
  });
}

/** Housekeeping. Expired and spent tokens have no further value. */
export async function purgeStaleTokens(): Promise<number> {
  const { count } = await db.verificationToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { usedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      ],
    },
  });
  return count;
}
