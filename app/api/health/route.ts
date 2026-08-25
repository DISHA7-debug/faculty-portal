import { NextResponse } from 'next/server';

import { db } from '@/lib/db';

/**
 * Liveness + DB connectivity probe.
 *
 * Consumed by the docker-compose healthcheck and by external uptime monitoring
 * (docs/PROJECT_PLAN.md §7). Must never be cached — a cached 200 would mask a
 * dead database, which is the exact failure this endpoint exists to catch.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const startedAt = Date.now();

  try {
    await db.$queryRaw`SELECT 1`;

    return NextResponse.json(
      {
        status: 'ok',
        database: 'up',
        latencyMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    // Deliberately does not echo the driver error: connection strings and
    // internal hostnames leak through Prisma messages, and this route is public.
    return NextResponse.json(
      {
        status: 'error',
        database: 'down',
        latencyMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
