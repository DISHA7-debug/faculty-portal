-- Convert every application timestamp column to TIMESTAMPTZ.
--
-- ── Why this migration is hand-written ──────────────────────────────────────────
--
-- Prisma generated these ALTERs with NO `USING` clause. Postgres then interprets each
-- existing naive value in the SESSION timezone. Prisma has always written UTC into these
-- columns, and the server here runs at +05:30, so applying Prisma's version verbatim
-- would have silently shifted every timestamp in the database by five and a half hours:
-- sessions expiring early, login codes expiring before they arrive, audit times wrong.
--
-- `USING "col" AT TIME ZONE 'UTC'` states the interpretation explicitly: read the stored
-- naive value AS UTC, then store the resulting absolute instant. The wall-clock values are
-- unchanged; only their type gains an unambiguous meaning.
--
-- ── Why do it at all ────────────────────────────────────────────────────────────
--
-- With `timestamp without time zone`, any query doing date arithmetic against now() has
-- to remember `at time zone 'utc'` or produce confidently wrong answers. That trap already
-- produced one false alarm during break-glass verification. Sprint 4 adds reporting
-- queries, which is precisely where a silent 5.5-hour skew would go unnoticed.
-- Removing the trap beats documenting it.


-- AllowedEmail
ALTER TABLE "AllowedEmail" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "AllowedEmail" ALTER COLUMN "usedAt" TYPE TIMESTAMPTZ(3) USING "usedAt" AT TIME ZONE 'UTC';

-- AuditLog
ALTER TABLE "AuditLog" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

-- Department
ALTER TABLE "Department" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

-- FileObject
ALTER TABLE "FileObject" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

-- Profile
ALTER TABLE "Profile" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "Profile" ALTER COLUMN "publishedAt" TYPE TIMESTAMPTZ(3) USING "publishedAt" AT TIME ZONE 'UTC';
ALTER TABLE "Profile" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- Publication
ALTER TABLE "Publication" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';

-- ResearchProject
ALTER TABLE "ResearchProject" ALTER COLUMN "endDate" TYPE TIMESTAMPTZ(3) USING "endDate" AT TIME ZONE 'UTC';
ALTER TABLE "ResearchProject" ALTER COLUMN "startDate" TYPE TIMESTAMPTZ(3) USING "startDate" AT TIME ZONE 'UTC';

-- Session
ALTER TABLE "Session" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "Session" ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(3) USING "expiresAt" AT TIME ZONE 'UTC';

-- User
ALTER TABLE "User" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "User" ALTER COLUMN "emailVerifiedAt" TYPE TIMESTAMPTZ(3) USING "emailVerifiedAt" AT TIME ZONE 'UTC';
ALTER TABLE "User" ALTER COLUMN "lastLoginAt" TYPE TIMESTAMPTZ(3) USING "lastLoginAt" AT TIME ZONE 'UTC';
ALTER TABLE "User" ALTER COLUMN "lockedUntil" TYPE TIMESTAMPTZ(3) USING "lockedUntil" AT TIME ZONE 'UTC';
ALTER TABLE "User" ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- VerificationToken
ALTER TABLE "VerificationToken" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "VerificationToken" ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(3) USING "expiresAt" AT TIME ZONE 'UTC';
ALTER TABLE "VerificationToken" ALTER COLUMN "usedAt" TYPE TIMESTAMPTZ(3) USING "usedAt" AT TIME ZONE 'UTC';
