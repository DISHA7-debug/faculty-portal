-- CreateEnum
CREATE TYPE "GuidanceNameDisplay" AS ENUM ('INITIALS', 'FULL_NAME');

-- DropIndex
DROP INDEX "profile_search_idx";

-- AlterTable
ALTER TABLE "Guidance" ADD COLUMN     "nameDisplay" "GuidanceNameDisplay" NOT NULL DEFAULT 'INITIALS';

-- Backfill: apply the same rule to rows that already exist.
--
-- The column default is INITIALS, which is the private-by-default choice and the right
-- one for a CURRENT student. Completed students are named in full, matching normal
-- academic practice for a finished thesis. Without this, every pre-existing completed
-- supervision would silently switch to initials on deploy.
UPDATE "Guidance" SET "nameDisplay" = 'FULL_NAME' WHERE "status" = 'COMPLETED';
