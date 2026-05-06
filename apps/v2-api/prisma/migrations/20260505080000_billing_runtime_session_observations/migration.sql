ALTER TABLE "v2_ops"."sandbox_usage_sessions"
  ADD COLUMN IF NOT EXISTS "last_observed_at" TIMESTAMP(3);

UPDATE "v2_ops"."sandbox_usage_sessions"
SET "last_observed_at" = COALESCE("updated_at", "started_at", "created_at", NOW())
WHERE "last_observed_at" IS NULL;

ALTER TABLE "v2_ops"."sandbox_usage_sessions"
  ALTER COLUMN "last_observed_at" SET NOT NULL,
  ALTER COLUMN "last_observed_at" SET DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "sandbox_usage_sessions_machine_last_observed_idx"
  ON "v2_ops"."sandbox_usage_sessions"("machine_id", "last_observed_at");

WITH ranked_open_sessions AS (
  SELECT "id",
         ROW_NUMBER() OVER (PARTITION BY "machine_id" ORDER BY "created_at" DESC, "started_at" DESC, "id" DESC) AS rn
  FROM "v2_ops"."sandbox_usage_sessions"
  WHERE "ended_at" IS NULL AND "state" = 'running'
)
UPDATE "v2_ops"."sandbox_usage_sessions" AS s
SET "ended_at" = GREATEST(s."started_at", s."last_observed_at"),
    "state" = 'billing_gap_duplicate_closed'
FROM ranked_open_sessions r
WHERE s."id" = r."id" AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "sandbox_usage_sessions_one_open_running_per_machine_idx"
  ON "v2_ops"."sandbox_usage_sessions"("machine_id")
  WHERE "ended_at" IS NULL AND "state" = 'running';
