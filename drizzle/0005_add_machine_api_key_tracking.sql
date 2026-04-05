-- Add API-key attribution columns to `machines`.
--
-- These three columns are referenced by the Drizzle schema
-- (src/server/db/schema.ts) and by the list-machines handler
-- (src/server/routes/v1/machines.ts), but were never added to
-- prod, causing:
--   column "created_by_api_key_id" does not exist
--
-- All three columns are nullable, so this is strictly additive —
-- no default backfill, no data migration, no risk to existing rows.
--
-- Apply manually against prod (do NOT run `drizzle-kit push` —
-- the local schema has drifted in other ways and push would
-- try to drop baremetal_procurements / baremetal_hosts /
-- email_verification_tokens tables and google_id / email_verified
-- columns on users):
--
--   psql "$DATABASE_URL" -f drizzle/0005_add_machine_api_key_tracking.sql

ALTER TABLE "machines"
  ADD COLUMN IF NOT EXISTS "created_by_api_key_id"     uuid,
  ADD COLUMN IF NOT EXISTS "created_by_api_key_name"   text,
  ADD COLUMN IF NOT EXISTS "created_by_api_key_prefix" text;
