/**
 * Determining the real client IP behind Caddy.
 *
 * Every IP-keyed control in lib/rate-limit.ts is only as trustworthy as this function.
 * If a client can choose the IP the server attributes to them, they can rotate it freely
 * and the login throttle, signup limit, and stuffing detection all become decorative.
 *
 * ── Why the RIGHTMOST X-Forwarded-For entry ─────────────────────────────────────
 *
 * `X-Forwarded-For` is APPENDED to, not replaced. A proxy adds the address it personally
 * observed to the end of whatever the client sent. So for a request arriving at Caddy
 * carrying a forged header:
 *
 *     client sends:  X-Forwarded-For: 1.2.3.4          (attacker-chosen)
 *     Caddy appends: X-Forwarded-For: 1.2.3.4, 203.0.113.9
 *                                     ^forged   ^what Caddy actually saw
 *
 * The conventional "take the first entry" reads the attacker's value. The last entry is
 * the only one written by our own infrastructure. With N trusted proxies in front, the
 * client is N entries from the right; everything to the left of that is client-supplied
 * and must be treated as hostile.
 *
 * Caddy is additionally configured to overwrite `X-Real-IP` with the observed peer
 * (see deploy/Caddyfile), which cannot be forged at all — that is the preferred source,
 * and the XFF walk is the fallback.
 */

/**
 * Number of reverse proxies between the internet and the app.
 *
 * 1 for the standard deployment (Caddy only). Raise it if a CDN is put in front, or the
 * function will attribute traffic to the CDN's egress IP and rate-limit the whole
 * internet as one client.
 */
const TRUSTED_PROXY_COUNT = Number(process.env.TRUSTED_PROXY_COUNT ?? 1);

/** Used when no trusted header is present. Aggregates rather than opening a hole. */
export const UNKNOWN_IP = 'unknown';

function isPlausibleIp(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 45) return false;
  // IPv4, IPv6, or IPv4-mapped. Deliberately permissive — this is a sanity filter to keep
  // junk out of Redis keys, not a validator. Trust comes from WHERE the value was read.
  return /^[0-9a-fA-F:.]+$/.test(v) && /[0-9a-fA-F]/.test(v);
}

/** Strips a `:port` suffix and IPv6 brackets. */
function normalise(value: string): string {
  let v = value.trim();
  if (v.startsWith('[')) {
    const close = v.indexOf(']');
    if (close !== -1) return v.slice(1, close);
  }
  // Only strip a port from IPv4 (a bare IPv6 has many colons).
  const parts = v.split(':');
  if (parts.length === 2) v = parts[0];
  return v;
}

/**
 * Resolves the client IP from request headers.
 *
 * Order of preference:
 *   1. `X-Real-IP` — Caddy overwrites this with the observed peer, so it is unforgeable.
 *   2. `X-Forwarded-For`, counted from the RIGHT by trusted-proxy depth.
 *   3. UNKNOWN_IP.
 */
export function clientIpFromHeaders(
  headers: Headers,
  trustedProxyCount: number = TRUSTED_PROXY_COUNT,
): string {
  // Normalise BEFORE validating: a bracketed IPv6 literal (`[2001:db8::1]`) fails the
  // character check while still bracketed, and would be discarded as junk.
  const realIp = headers.get('x-real-ip');
  if (realIp) {
    const normalised = normalise(realIp);
    if (isPlausibleIp(normalised)) return normalised;
  }

  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const entries = forwarded
      .split(',')
      .map((e) => normalise(e))
      .filter((e) => isPlausibleIp(e));

    if (entries.length > 0) {
      // Walk in from the right by the number of proxies we control. Clamp so a short
      // header (fewer hops than configured) yields the leftmost real entry rather than
      // undefined — never an attacker-chosen one, because a short header means no
      // attacker prefix survived.
      const index = Math.max(0, entries.length - Math.max(1, trustedProxyCount));
      return entries[index];
    }
  }

  if (process.env.NODE_ENV === 'production') {
    // In production every request arrives through Caddy, which always sets X-Real-IP.
    // Missing headers mean the app is exposed directly — a deployment fault that also
    // breaks __Host- cookies (docs/CUTOVER.md §5).
    console.error(
      '[request-ip] No trusted proxy header. Is the app exposed without Caddy? ' +
        'All such requests share one rate-limit bucket.',
    );
  }

  return UNKNOWN_IP;
}

/** Convenience for Route Handlers and Server Actions. */
export function clientIp(request: { headers: Headers }): string {
  return clientIpFromHeaders(request.headers);
}
