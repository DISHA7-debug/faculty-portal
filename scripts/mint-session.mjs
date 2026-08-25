#!/usr/bin/env node
/**
 * Prints a raw session token for a seeded ACTIVE user. Development diagnostics only —
 * it mints a real session, so never point it at production.
 */
import { createHash, randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

const user = await db.user.findFirst({
  where: { status: 'ACTIVE', profile: { isNot: null } },
});
if (!user) {
  console.error('No ACTIVE user with a profile. Run: npm run db:seed');
  process.exit(2);
}

const rawToken = randomBytes(32).toString('base64url');
await db.session.create({
  data: {
    userId: user.id,
    tokenHash: createHash('sha256').update(rawToken).digest('hex'),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  },
});

process.stdout.write(rawToken);
await db.$disconnect();
