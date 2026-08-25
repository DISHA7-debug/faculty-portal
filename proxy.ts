import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE } from '@/lib/auth/session';
import { safeNextPath } from '@/lib/safe-redirect';

/**
 * Route guards and the per-request CSP nonce.
 *
 * Next 16 renamed `middleware.ts` to `proxy.ts` and the export from `middleware` to
 * `proxy`. A file named `middleware.ts` is no longer picked up at all — it fails silently,
 * which for an auth guard means every protected route is simply unguarded.
 *
 * ── What this file is NOT ───────────────────────────────────────────────────────
 *
 * This is NOT the authorization layer. It performs a cookie-PRESENCE check only: it never
 * touches the database, never validates the session token, and never reads a role. A
 * forged or expired cookie sails straight through.
 *
 * That is deliberate. Running Prisma here would put a database round trip in front of
 * every asset request, and the guard would still have to be repeated server-side anyway.
 * Real authorization is `requireSession()` / `requireRole()` / `assertOwnsProfileRow()`
 * inside each Server Component, Server Action, and Route Handler
 * (docs/SECURITY.md §1.1). This file exists to turn "not signed in" into a tidy redirect
 * instead of a thrown error, and to issue the nonce.
 *
 * Never move an authorization decision into this file.
 *
 * ── There used to be a second redirect here: bounce a "signed-in" visitor away from
 * /login, /signup, /verify. It is gone on purpose. ─────────────────────────────────────
 *
 * It used the SAME presence-only signal in the opposite direction — "a cookie exists, so
 * treat this visitor as signed in" — and presence is not validity. A cookie that no longer
 * names a live session (expired, or revoked by sign-out / admin suspension / "log out
 * everywhere") would bounce a visitor from /login straight to /dashboard, where
 * `requireSessionOrRedirect()` correctly finds no valid session and sends them BACK to
 * /login — which this block would then bounce away AGAIN. An unauthenticated visitor
 * holding nothing but a stale cookie could not reach the sign-in form at all:
 * ERR_TOO_MANY_REDIRECTS, not a login screen.
 *
 * The fix is the same shape as the dashboard side: move the check to where a database
 * round trip is affordable. `login/page.tsx`, `signup/page.tsx`, and `verify/page.tsx` each
 * call `getOptionalSession()` themselves and redirect to `/dashboard` only for a session
 * that is ACTUALLY valid, not merely present. Do not restore a presence-only version of
 * this redirect here — it is the exact class of bug this comment is describing.
 */

/** Routes requiring a session. Everything else is public. */
const PROTECTED_PREFIXES = ['/dashboard', '/admin'] as const;

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Strict CSP for authenticated routes — docs/SECURITY.md §7.1.
 *
 * `script-src` carries a per-request nonce and NOT 'unsafe-inline'. These routes are
 * dynamic regardless (they read the session cookie), so a nonce costs no static
 * generation here — unlike the public pages, which stay static and therefore cannot use
 * one.
 *
 * Note that a browser ignores 'unsafe-inline' entirely when a nonce is present, so adding
 * it "just in case" would silently do nothing on modern browsers while weakening the
 * policy on old ones. Give the inline script the nonce instead.
 */
/**
 * Origin of the media host, for CSP `img-src`.
 *
 * R2_PUBLIC_URL may include a PATH — the dev MinIO value is
 * `http://localhost:9000/faculty-portal-media`, and a path-style CDN would look the same.
 * A CSP source expression carrying a path must match the request path EXACTLY, so passing
 * the full value blocks every image under it while looking correct. Only the origin
 * belongs in a source list.
 */
function mediaOrigin(): string {
  const raw = process.env.R2_PUBLIC_URL;
  if (!raw) return '';
  try {
    return new URL(raw).origin;
  } catch {
    return '';
  }
}

function authenticatedCsp(nonce: string, isDev: boolean): string {
  const cdnOrigin = mediaOrigin();

  return [
    "default-src 'self'",
    // 'strict-dynamic' lets a nonced loader pull in the chunks it needs without
    // enumerating them, which is how Next's runtime actually loads code.
    isDev
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // Styles keep 'unsafe-inline': Next injects inline critical CSS that is not nonced,
    // and style injection is not a script-execution vector.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' ${cdnOrigin} data: blob:`.replace(/\s+/g, ' ').trim(),
    "font-src 'self'",
    isDev ? "connect-src 'self' ws:" : "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

/**
 * 16 random bytes, base64.
 *
 * `crypto.getRandomValues` states the intent directly: this is a one-shot unguessable
 * value, not an identifier. 128 bits is the same entropy a UUIDv4 carries, without the
 * version and variant bits that make 6 of them constant, and without implying the value
 * means anything or should be stored.
 */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export default function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const isDev = process.env.NODE_ENV === 'development';

  // Presence only. This is not proof of a valid session — see the note above.
  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (isProtected(pathname) && !hasSessionCookie) {
    const login = new URL('/login', request.url);
    // Round-trip the intended destination so sign-in returns the user where they were
    // heading. Passed through safeNextPath even though it originates from nextUrl and is
    // therefore already same-origin: the value is validated identically at every point it
    // is produced or consumed, so no single call site has to be trusted to be the careful
    // one.
    login.searchParams.set('next', safeNextPath(`${pathname}${search}`));
    return NextResponse.redirect(login);
  }

  // Public routes keep the static-friendly policy set in next.config.ts.
  if (!isProtected(pathname)) return NextResponse.next();

  const nonce = generateNonce();
  const csp = authenticatedCsp(nonce, isDev);

  const requestHeaders = new Headers(request.headers);

  // For Server Components that render an inline <script> of their own.
  requestHeaders.set('x-nonce', nonce);

  // Also set the policy on the REQUEST, not just the response. This is how Next itself
  // learns the nonce: it parses `Content-Security-Policy` off the incoming headers and
  // stamps the value onto the bootstrap scripts it injects. Without this line those
  // scripts are emitted un-nonced and the browser blocks them —
  // `script-src-elem blocked inline` — which was observed before it was added.
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  // Overrides the public policy from next.config.ts for these paths.
  response.headers.set('Content-Security-Policy', csp);

  return response;
}

export const config = {
  /**
   * Skips static assets and the health probe.
   *
   * `_next/static` and `_next/image` are immutable build output with no session in them,
   * and running this on every asset would add a redirect check to hundreds of requests
   * per page load. `/api/health` is excluded so monitoring keeps working when signed out.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)',
  ],
};
