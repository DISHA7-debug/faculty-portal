/**
 * Production environment assertions.
 *
 * Called once from instrumentation.ts when the server boots. The point is to fail
 * loudly at startup rather than silently serving a half-configured production site —
 * a broken deploy that refuses to start is recoverable; one that starts and serves
 * placeholder config to real faculty is not.
 */

/**
 * Placeholder fragments that ship in .env.example and must never reach production.
 * `.invalid` is a reserved TLD (RFC 2606) and can never resolve, so it is the safe
 * shape for a placeholder host. Older markers are kept so a stale .env copied from
 * an earlier revision is still caught.
 */
const PLACEHOLDER_MARKERS = [
  'example.invalid',
  'account_id',
  'replace-me',
  'yourcollege', // hostname-check-ignore — a marker to detect, not a host to use
  '<account>',
] as const;

type EnvCheck = {
  key: string;
  /** Required in production — must be present and non-empty. */
  required?: boolean;
};

const PRODUCTION_CHECKS: EnvCheck[] = [
  { key: 'R2_PUBLIC_URL', required: true },
  { key: 'R2_ENDPOINT', required: true },
  { key: 'AUTH_SECRET', required: true },
  { key: 'DATABASE_URL', required: true },
  { key: 'NEXT_PUBLIC_APP_URL', required: true },
  { key: 'MAIL_FROM', required: true },
];

export function assertProductionEnv(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_ENV !== 'production') return;

  const problems: string[] = [];

  for (const { key, required } of PRODUCTION_CHECKS) {
    const value = env[key];

    if (required && !value?.trim()) {
      problems.push(`${key} is required in production but is empty or unset.`);
      continue;
    }
    if (!value) continue;

    const marker = PLACEHOLDER_MARKERS.find((m) =>
      value.toLowerCase().includes(m),
    );
    if (marker) {
      problems.push(
        `${key} still contains the placeholder "${marker}" — it was never changed from .env.example.`,
      );
    }
  }

  // The approval gate is the one setting a well-meaning operator is most likely to
  // disable to "make signup work". docs/SECURITY.md §2.1 — students hold college
  // email addresses, so domain matching alone lets a student publish a fake
  // professor page on the college domain.
  if (env.REQUIRE_ADMIN_APPROVAL === 'false') {
    problems.push(
      'REQUIRE_ADMIN_APPROVAL=false is not permitted in production (docs/SECURITY.md §2.1).',
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `Refusing to start: production environment is misconfigured.\n` +
        problems.map((p) => `  - ${p}`).join('\n'),
    );
  }
}
