import { PrismaClient } from '@prisma/client';

/**
 * Prisma singleton.
 *
 * Next.js dev mode hot-reloads modules on every edit. Without this guard each
 * reload constructs another PrismaClient, and each client opens its own pool —
 * Postgres runs out of connections within a few minutes of editing. Stashing the
 * instance on globalThis (which survives hot reload) keeps it to exactly one.
 *
 * The pool size itself is capped via `connection_limit=15` on DATABASE_URL —
 * see .env.example and docs/SECURITY.md §8.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Query logging in dev only; it is noisy and leaks parameter values into logs.
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['error'],
  });

// Deliberately not assigned in production: there is one long-lived process there,
// and keeping the reference off globalThis avoids retaining it across a graceful shutdown.
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}
