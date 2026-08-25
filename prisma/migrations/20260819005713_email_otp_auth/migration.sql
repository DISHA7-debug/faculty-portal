-- Switch authentication from passwords to emailed one-time codes.
--
-- Written by hand rather than generated, because every step here is destructive and each
-- one deserves to be read before it runs.
--
-- What is NOT touched: the Session table, its token hashing, and the __Host- cookie.
-- Identity is proven differently; what happens afterwards is unchanged, because the admin
-- approval queue and account suspension both need revocable sessions.

-- 1. Discard every outstanding token.
--    They are all of types that are about to stop existing, and they are all short-lived
--    by design. Anyone mid-flow simply requests a new code.
DELETE FROM "VerificationToken";

-- 2. Per-token attempt counter.
--    Durable rather than Redis-backed: a 6-digit code has a million possibilities, so this
--    cap is the primary brute-force defence, and Redis is explicitly disposable
--    (PROJECT_PLAN §4.1) — a restart would hand an attacker a fresh budget.
ALTER TABLE "VerificationToken" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;

-- 3. Replace the TokenType enum.
--    Postgres cannot remove a value from an enum in place, so the type is rebuilt.
--    EMAIL_VERIFICATION disappears because verification and sign-in are now the same act;
--    PASSWORD_RESET disappears because there is no password to reset.
ALTER TYPE "TokenType" RENAME TO "TokenType_old";
CREATE TYPE "TokenType" AS ENUM ('LOGIN_OTP', 'EMAIL_CHANGE');
ALTER TABLE "VerificationToken"
  ALTER COLUMN "type" TYPE "TokenType" USING ("type"::text::"TokenType");
DROP TYPE "TokenType_old";

-- 4. Drop the password.
--    Irreversible, and intended to be: there is no code path left that reads or writes it,
--    and a column of argon2 hashes that nothing verifies is a liability with no benefit.
ALTER TABLE "User" DROP COLUMN "passwordHash";
