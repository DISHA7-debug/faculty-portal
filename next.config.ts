import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV === 'development';

/**
 * CDN origin for profile photos and CVs (Cloudflare R2 in front of a custom domain).
 * Driven by env so a placeholder hostname can never reach production headers.
 */
const cdnOrigin = (() => {
  // Only the ORIGIN belongs in a CSP source list. R2_PUBLIC_URL may carry a path (the dev
  // MinIO value does), and a source expression with a path must match the request path
  // exactly — which silently blocks every image beneath it.
  const raw = process.env.R2_PUBLIC_URL;
  if (!raw) return '';
  try {
    return new URL(raw).origin;
  } catch {
    return '';
  }
})();

/**
 * Content-Security-Policy for PUBLIC routes — docs/SECURITY.md §7.
 *
 * The policy is split by route on purpose. This is the public half:
 * the landing page, directory, and profile pages are statically rendered,
 * and a nonce cannot be baked into a static document, so `script-src` keeps
 * 'unsafe-inline' here in exchange for keeping those pages static.
 *
 * The authenticated half (/dashboard, /admin) is dynamic anyway, so it gets a
 * strict nonce-based `script-src` set per-request in proxy.ts. That lands in
 * Sprint 2 alongside the route guards.
 *
 * Do not "fix" this by putting 'unsafe-inline' on the authenticated routes, and
 * do not try to remove it here without first making these routes dynamic —
 * read the rationale in docs/SECURITY.md §7 before changing either half.
 */
const publicCsp = [
  "default-src 'self'",
  isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' ${cdnOrigin} data: blob:`.replace(/\s+/g, ' ').trim(),
  "font-src 'self'",
  isDev ? "connect-src 'self' ws:" : "connect-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: publicCsp },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload',
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
];

const nextConfig: NextConfig = {
  // Required by the multi-stage Dockerfile, which copies .next/standalone.
  output: 'standalone',

  // Pin the file-tracing root to this project. Without it Next walks up, finds an
  // unrelated lockfile in the home directory, and roots the standalone bundle there —
  // which produces a broken image when the Dockerfile copies .next/standalone.
  outputFileTracingRoot: __dirname,

  reactStrictMode: true,

  // Never let a type error slip into a production build.
  // (Next 16 dropped the `eslint` config key along with `next lint`; linting is a
  // separate CI step — `npm run lint` — not part of `next build`.)
  typescript: { ignoreBuildErrors: false },

  // Don't advertise the framework version.
  poweredByHeader: false,

  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        /**
         * Authenticated areas must never be stored by a shared cache — a stored dashboard
         * could be served to the next person through the same proxy.
         *
         * This lives here rather than in proxy.ts because a header set on the proxy's
         * response is overwritten by Next's own `no-cache, must-revalidate` for dynamic
         * routes. That was observed, not assumed: the browser reported
         * `Cache-Control: no-cache, must-revalidate` with the proxy version in place.
         * `no-cache` forces revalidation but does NOT forbid storage; `no-store` does.
         */
        source: '/:path(dashboard|admin)/:rest*',
        headers: [
          { key: 'Cache-Control', value: 'private, no-store, max-age=0, must-revalidate' },
        ],
      },
    ];
  },
};

export default nextConfig;
