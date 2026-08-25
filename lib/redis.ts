import Redis from 'ioredis';

/**
 * Redis singleton.
 *
 * Same hot-reload guard as lib/db.ts: without it every edit in dev opens another
 * connection until Redis refuses new ones.
 *
 * Redis holds only ephemeral counters (docs/PROJECT_PLAN.md §4.1). Losing it costs
 * nothing but a reset of in-flight rate-limit windows — never user data.
 */
const globalForRedis = globalThis as unknown as { redis: Redis | undefined };

function createClient(): Redis {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';

  return new Redis(url, {
    // Fail fast rather than queueing commands forever behind a dead server; the
    // rate limiter needs a prompt answer so it can apply its own fail-open/closed policy.
    // Bound how long a caller waits before the fail-open/fail-closed policy in
    // lib/rate-limit.ts takes over.
    maxRetriesPerRequest: 2,
    connectTimeout: 3_000,

    // Connect on first command, not on import. Importing a module that merely *mentions*
    // rate limiting must not open a socket — otherwise a unit test that imports one pure
    // helper from lib/rate-limit hangs forever on an open handle, and every build step
    // that loads the module tree needs a live Redis.
    lazyConnect: true,

    // MUST stay true while lazyConnect is true. With lazyConnect there is no connection
    // when the first command is issued, so disabling the offline queue makes that command
    // fail instantly with "Stream isn't writeable" — every rate-limit check then takes the
    // Redis-unavailable branch and auth routes fail closed. The two options are only safe
    // together in the eager-connect configuration.
    enableOfflineQueue: true,

    retryStrategy: (times) => Math.min(times * 200, 2_000),
  });
}

export const redis = globalForRedis.redis ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}

// Without a listener, ioredis emits unhandled 'error' events that crash the process
// when Redis is briefly unavailable.
redis.on('error', (error: Error) => {
  console.error('[redis]', error.message);
});

/** Liveness probe for /api/health and diagnostics. */
export async function redisHealthy(): Promise<boolean> {
  try {
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  }
}
