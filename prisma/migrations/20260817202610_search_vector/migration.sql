-- Full-text search support for Profile.
--
-- Promoted from the previously unapplied prisma/migrations/manual/001_search_vector.sql.
-- Specified in docs/PROJECT_PLAN.md §4.4.
--
-- The vector is maintained by a database trigger rather than in application code so it
-- stays correct even when a write bypasses the app layer — a seed script, a psql session,
-- or a future bulk import (§4.3).

-- Weighting: name matches outrank research interests, which outrank designation, which
-- outranks the free-text bio. That ordering is what makes ts_rank useful for the
-- directory search in Sprint 4.
CREATE OR REPLACE FUNCTION profile_search_trigger() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('english', coalesce(NEW."fullName", '')), 'A') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW."researchInterests", ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW."designation", '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW."about", '')), 'D');
  RETURN NEW;
END
$$ LANGUAGE plpgsql
-- Pinned search_path: without it, a role with a mutable search_path could shadow
-- to_tsvector or array_to_string and change what this trigger computes.
SET search_path = pg_catalog, public;

DROP TRIGGER IF EXISTS profile_search_update ON "Profile";

CREATE TRIGGER profile_search_update
  BEFORE INSERT OR UPDATE ON "Profile"
  FOR EACH ROW EXECUTE FUNCTION profile_search_trigger();

CREATE INDEX IF NOT EXISTS profile_search_idx ON "Profile" USING GIN ("searchVector");

-- Backfill. The trigger only fires on write, so any row that already exists would keep a
-- NULL vector and be invisible to search until someone happened to edit it. Harmless on a
-- fresh database, essential if this migration is ever applied to a populated one.
UPDATE "Profile" SET "updatedAt" = "updatedAt";
