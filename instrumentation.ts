/**
 * Next.js startup hook. Runs once per server process, before any request is served.
 * Used here to refuse to boot a misconfigured production deployment.
 */
export async function register() {
  // Only the Node runtime has the full env; skip on edge.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { assertProductionEnv } = await import('./lib/env');
  assertProductionEnv();
}
