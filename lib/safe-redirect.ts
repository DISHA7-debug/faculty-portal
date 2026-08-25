/**
 * Validation for the `?next=` return-path parameter.
 *
 * An unvalidated `next` is an open redirect, and an open redirect on a login page is a
 * phishing primitive: the attacker sends a link to the REAL portal — correct domain,
 * correct certificate, correct login form — and the victim is bounced to a copy after
 * authenticating. The domain in the address bar is what people check, and it is genuine
 * right up to the redirect.
 *
 * The naive check, `value.startsWith('/')`, is not enough. `//evil.com` starts with a
 * slash and is a protocol-relative URL that browsers resolve to `https://evil.com`.
 * `/\evil.com` is normalised to `//evil.com` by browsers because backslashes are treated
 * as separators in URLs. Percent-encoding hides both from anything that inspects only the
 * raw string.
 *
 * Everything here fails closed to a known-good path.
 */

/** Where an invalid or missing `next` sends the user. */
export const DEFAULT_NEXT = '/dashboard';

/**
 * Redirecting to an auth page after sign-in is at best a loop and at worst a way to
 * bounce a freshly-authenticated user back to a form that looks like it failed.
 */
const AUTH_PATHS = [
  '/login',
  '/signup',
  '/verify',
  '/forgot-password',
  '/reset-password',
  '/check-email',
  '/logout',
];

/**
 * Control characters, whitespace, and DEL. These smuggle values past naive checks:
 * a tab inside a scheme, a newline splitting a header, or a leading space hiding
 * "//evil.com" from a startsWith test.
 */
const CONTROL_OR_SPACE = /[\u0000-\u0020\u007f]/;

/** Decodes repeatedly so `%252f%252f` cannot hide behind a single decode. */
function fullyDecode(value: string): string | null {
  let current = value;
  for (let i = 0; i < 4; i++) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      // Malformed encoding — nothing legitimate produces this.
      return null;
    }
    if (next === current) return current;
    current = next;
  }
  // Still changing after four passes: pathological, reject.
  return null;
}

function isRejected(candidate: string): boolean {
  if (!candidate.startsWith('/')) return true; // absolute URL or relative path
  if (candidate.startsWith('//')) return true; // protocol-relative -> //evil.com
  if (candidate.startsWith('/\\')) return true; // browsers normalise \ to /
  if (candidate.includes('\\')) return true; // any backslash at all
  if (CONTROL_OR_SPACE.test(candidate)) return true;

  // A colon in the PATH means a scheme or userinfo. Query strings may legitimately
  // contain one (`?at=10:30`), so only the path portion is checked.
  const path = candidate.split(/[?#]/, 1)[0];
  if (path.includes(':')) return true;

  // `/./` and `/../` can climb out of an intended prefix once normalised.
  if (path.split('/').some((segment) => segment === '.' || segment === '..')) return true;

  return false;
}

/**
 * Returns a safe same-origin path, or the fallback.
 *
 * Both the raw and the fully-decoded forms must pass, because the browser acts on the
 * decoded value while a naive check reads the raw one.
 */
export function safeNextPath(
  raw: string | null | undefined,
  fallback: string = DEFAULT_NEXT,
): string {
  if (typeof raw !== 'string') return fallback;
  if (raw.length === 0 || raw.length > 512) return fallback;

  const decoded = fullyDecode(raw);
  if (decoded === null) return fallback;

  if (isRejected(raw) || isRejected(decoded)) return fallback;

  // Never bounce back into the auth flow.
  const path = decoded.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
  if (AUTH_PATHS.some((auth) => path === auth || path.startsWith(`${auth}/`))) {
    return fallback;
  }

  return raw;
}
