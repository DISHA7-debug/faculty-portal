import { createHash } from 'node:crypto';

import { redis } from '@/lib/redis';

/**
 * Redis rate limiting.
 *
 * ── Why login is NOT a per-email lockout ────────────────────────────────────────
 *
 * The obvious design — "5 failures for this email, then lock the account for 15
 * minutes" — is a denial-of-service vector *in this specific application*, because the
 * public faculty directory publishes every faculty member's email address. Those two
 * facts together mean an attacker can scrape 500 addresses and lock out the entire
 * faculty with a trivial script, indefinitely, without ever guessing a password. The
 * lockout becomes the attack.
 *
 * So throttling is keyed on (email, IP) with a progressive delay. One attacker on one
 * address slows to a crawl; a legitimate user elsewhere is unaffected, because their IP
 * differs. Account-wide `lockedUntil` is reserved for the signal that actually indicates
 * credential stuffing rather than nuisance: failures against one account from MANY
 * DISTINCT IPs, which a single blocked attacker cannot fake without a botnet — and if
 * they have one, locking the account is the correct response.
 *
 * See docs/SECURITY.md §3.
 */

// ---------------------------------------------------------------------------
// Core token bucket
// ---------------------------------------------------------------------------

export type RateLimitResult = {
  allowed: boolean;
  /** Attempts already consumed in the current window. */
  count: number;
  /** Seconds until the window resets. */
  retryAfterSeconds: number;
};

export type RateLimitRule = {
  /** Attempts permitted per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
};

/**
 * Fixed-window counter.
 *
 * A sliding window would be more precise, but at 500 users the extra Redis round trips
 * buy nothing. INCR + EXPIRE in one pipeline is atomic enough: the first caller to
 * create the key sets its TTL.
 */
export async function consume(
  key: string,
  rule: RateLimitRule,
): Promise<RateLimitResult> {
  const redisKey = `rl:${key}`;

  const pipeline = redis.pipeline();
  pipeline.incr(redisKey);
  pipeline.ttl(redisKey);
  const results = await pipeline.exec();

  if (!results) throw new Error('Redis pipeline returned no result');

  const count = Number(results[0]?.[1] ?? 0);
  let ttl = Number(results[1]?.[1] ?? -1);

  // -1 means the key exists without a TTL (first INCR, or a lost expiry). Set one.
  if (ttl < 0) {
    await redis.expire(redisKey, rule.windowSeconds);
    ttl = rule.windowSeconds;
  }

  return {
    allowed: count <= rule.limit,
    count,
    retryAfterSeconds: ttl,
  };
}

/** Clears a counter. Called on successful login so a user is not punished for a typo. */
export async function reset(key: string): Promise<void> {
  await redis.del(`rl:${key}`);
}

/**
 * Applies a rule, converting Redis failure into an explicit policy decision.
 *
 * `failMode: 'closed'` for auth routes — if the limiter is down we would rather refuse
 * logins than serve an unlimited brute-force window. `failMode: 'open'` for the public
 * API, where availability matters more than throttling (docs/SECURITY.md §3).
 */
export async function enforce(
  key: string,
  rule: RateLimitRule,
  failMode: 'open' | 'closed',
): Promise<RateLimitResult> {
  try {
    return await consume(key, rule);
  } catch (error) {
    console.error('[rate-limit] Redis unavailable:', error);
    return failMode === 'closed'
      ? { allowed: false, count: rule.limit + 1, retryAfterSeconds: rule.windowSeconds }
      : { allowed: true, count: 0, retryAfterSeconds: 0 };
  }
}

// ---------------------------------------------------------------------------
// Key construction
// ---------------------------------------------------------------------------

/**
 * Emails are hashed into keys rather than embedded.
 *
 * Redis is not the system of record and is not encrypted at rest here; `INCR
 * rl:login:anita.sharma@faculty.example.invalid` would turn a `KEYS *` on a compromised or
 * misconfigured instance into a roster of who has been signing in.
 */
function hashIdentifier(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex').slice(0, 32);
}

export function loginKey(email: string, ip: string): string {
  return `login:${hashIdentifier(email)}:${hashIdentifier(ip)}`;
}

export function ipKey(action: string, ip: string): string {
  return `${action}:ip:${hashIdentifier(ip)}`;
}

export function emailKey(action: string, email: string): string {
  return `${action}:email:${hashIdentifier(email)}`;
}

// ---------------------------------------------------------------------------
// Rules — docs/SECURITY.md §3
// ---------------------------------------------------------------------------

export const RULES = {
  /** Per (email, IP). Progressive delay applies on top; see loginThrottle(). */
  loginPerEmailIp: { limit: 5, windowSeconds: 15 * 60 },
  /** Per IP across all emails — catches spraying many accounts from one host. */
  loginPerIp: { limit: 20, windowSeconds: 15 * 60 },
  signupPerIp: { limit: 3, windowSeconds: 60 * 60 },

  /** Requesting a login code. Hard on the IP, which the requester owns. */
  otpRequestPerIp: { limit: 15, windowSeconds: 60 * 60 },
  /**
   * VERIFYING a code. Hard, and deliberately tight.
   *
   * This is the one place the "delay, do not block" principle does not apply. A 6-digit
   * code has a million possibilities, so an attacker with an uncapped verify endpoint
   * guesses it in an afternoon. Blocking the IP costs the attacker their own address; the
   * victim can still request a fresh code from anywhere else.
   */
  otpVerifyPerIp: { limit: 30, windowSeconds: 15 * 60 },
  passwordResetPerEmail: { limit: 3, windowSeconds: 60 * 60 },
  passwordResetPerIp: { limit: 10, windowSeconds: 60 * 60 },
  verificationResendPerEmail: { limit: 3, windowSeconds: 60 * 60 },
  uploadPerUser: { limit: 20, windowSeconds: 60 * 60 },
  publicApiPerIp: { limit: 60, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Window for the per-email code-request DELAY.
 *
 * Deliberately not in RULES: it is not a limit and nothing blocks on it. Keeping it out
 * of that object stops it being wired into `enforce()` by someone reasonably assuming
 * everything in RULES is a cap.
 */
export const OTP_REQUEST_EMAIL_WINDOW_SECONDS = 60 * 60;

// ---------------------------------------------------------------------------
// Progressive delay
// ---------------------------------------------------------------------------

/**
 * Delay in milliseconds for the nth consecutive failure on an (email, IP) pair.
 *
 * 0, 0, 0.5s, 1s, 2s, 4s, 8s, capped at 8s. The first two failures are free — real
 * people mistype passwords — and the cost then rises fast enough that an online guessing
 * attack from one address becomes pointless, without ever denying service to anyone else.
 */
export function progressiveDelayMs(failureCount: number): number {
  if (failureCount <= 2) return 0;
  return Math.min(500 * 2 ** (failureCount - 3), 8_000);
}

export async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Soft throttling — delay instead of denial
// ---------------------------------------------------------------------------

/**
 * Counts an event and returns a DELAY rather than a denial.
 *
 * Used wherever the key is an identifier an attacker knows but does not own — an email
 * address from the public directory, most of all. A hard block on such a key is a weapon:
 * anyone can spend a stranger's budget and deny them the service. A delay costs the
 * attacker real time per attempt while leaving the legitimate owner able to get through,
 * just slower.
 *
 * Hard limits stay on keys the attacker actually controls, above all their own IP.
 */
export async function softThrottle(
  key: string,
  windowSeconds: number,
  delayFor: (count: number) => number,
): Promise<{ count: number; delayMs: number }> {
  try {
    const redisKey = `soft:${key}`;
    const pipeline = redis.pipeline();
    pipeline.incr(redisKey);
    pipeline.ttl(redisKey);
    const results = await pipeline.exec();

    const count = Number(results?.[0]?.[1] ?? 0);
    if (Number(results?.[1]?.[1] ?? -1) < 0) {
      await redis.expire(redisKey, windowSeconds);
    }
    return { count, delayMs: delayFor(count) };
  } catch (error) {
    console.error('[rate-limit] soft throttle unavailable:', error);
    // No counter means no basis for a delay. The hard IP limit still applies.
    return { count: 0, delayMs: 0 };
  }
}

export async function clearSoftThrottle(key: string): Promise<void> {
  await redis.del(`soft:${key}`).catch(() => {});
}

/**
 * Delay for repeated verification/signup mail requests against ONE address.
 *
 * Free for the first three — a real person resending because the first mail went to spam
 * must not be punished — then rising. Never blocks, so an attacker cannot use this to
 * stop a faculty member completing onboarding.
 */
export function mailRequestDelayMs(count: number): number {
  if (count <= 3) return 0;
  return Math.min(1_000 * 2 ** (count - 4), 15_000);
}

// ---------------------------------------------------------------------------
// Credential-stuffing detection
// ---------------------------------------------------------------------------

/**
 * Distinct IPs failing against ONE account within the window, above which the response
 * escalates.
 *
 * There is deliberately NO hard account lock any more. Renting 8 addresses costs cents,
 * so a hard threshold would just relocate the denial-of-service from "5 failed logins" to
 * "8 cheap proxies" — the same own-goal, one step further away. An escalating delay has
 * no such cliff: it degrades smoothly, costs the attacker time proportional to their
 * effort, and always leaves the real owner a (slower) way in.
 */
const STUFFING_DELAY_FLOOR = 8;
const DISTINCT_IP_WINDOW_SECONDS = 60 * 60;

/**
 * Delay applied to an account showing distributed-failure patterns.
 *
 * 8 distinct IPs -> 1s, doubling per doubling of sources, capped at 10s. The cap matters:
 * an unbounded delay is a hard lock wearing a disguise, and would hand back the exact DoS
 * this design exists to avoid.
 */
export function stuffingDelayMs(distinctIps: number): number {
  if (distinctIps < STUFFING_DELAY_FLOOR) return 0;
  const doublings = Math.floor(Math.log2(distinctIps / STUFFING_DELAY_FLOOR));
  return Math.min(1_000 * 2 ** doublings, 10_000);
}

/** Records a failure source and returns how many distinct sources have been seen. */
export async function recordFailureAndDetectStuffing(
  email: string,
  ip: string,
): Promise<{ distinctIps: number; delayMs: number }> {
  const key = `stuff:${hashIdentifier(email)}`;

  try {
    const pipeline = redis.pipeline();
    pipeline.sadd(key, hashIdentifier(ip));
    pipeline.scard(key);
    pipeline.expire(key, DISTINCT_IP_WINDOW_SECONDS);
    const results = await pipeline.exec();

    const distinctIps = Number(results?.[1]?.[1] ?? 0);
    return { distinctIps, delayMs: stuffingDelayMs(distinctIps) };
  } catch (error) {
    console.error('[rate-limit] stuffing detection unavailable:', error);
    return { distinctIps: 0, delayMs: 0 };
  }
}

/** Reads the distinct-source count without recording a new one. */
export async function peekDistinctIps(email: string): Promise<number> {
  try {
    return await redis.scard(`stuff:${hashIdentifier(email)}`);
  } catch {
    return 0;
  }
}

/** Clears stuffing state after a successful login. */
export async function clearStuffingState(email: string): Promise<void> {
  await redis.del(`stuff:${hashIdentifier(email)}`).catch(() => {});
}

/**
 * Full login throttle. Hard limits are IP-keyed only; everything email-keyed is a delay.
 */
export async function loginThrottle(
  email: string,
  ip: string,
): Promise<{ allowed: boolean; retryAfterSeconds: number; delayMs: number }> {
  const perPair = await enforce(loginKey(email, ip), RULES.loginPerEmailIp, 'closed');
  const perIp = await enforce(ipKey('login', ip), RULES.loginPerIp, 'closed');

  if (!perPair.allowed || !perIp.allowed) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(perPair.retryAfterSeconds, perIp.retryAfterSeconds),
      delayMs: 0,
    };
  }

  // The (email, IP) pair is half attacker-controlled, so blocking it is safe: the
  // attacker can only lock out the pairing of a victim's email with the ATTACKER's own
  // address, which costs the victim nothing.
  const pairDelay = progressiveDelayMs(perPair.count);
  const stuffingDelay = stuffingDelayMs(await peekDistinctIps(email));

  return {
    allowed: true,
    retryAfterSeconds: 0,
    delayMs: Math.max(pairDelay, stuffingDelay),
  };
}

/** Clears login throttle state for a pair. Call on success. */
export async function clearLoginThrottle(email: string, ip: string): Promise<void> {
  await reset(loginKey(email, ip));
  await clearStuffingState(email);
}
