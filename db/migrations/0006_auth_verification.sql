ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "email_verified" timestamp;

UPDATE "users" SET "email_verified" = "created_at" WHERE "email_verified" IS NULL;

CREATE TABLE IF NOT EXISTS "auth_tokens" (
  "id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"       uuid        NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_sha256"  text        NOT NULL UNIQUE,
  "purpose"       text        NOT NULL CHECK ("purpose" IN ('email_verification', 'password_reset')),
  "expires_at"    timestamp   NOT NULL,
  "used_at"       timestamp,
  "created_at"    timestamp   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "auth_tokens_user_purpose_idx"
  ON "auth_tokens" ("user_id", "purpose");

CREATE INDEX IF NOT EXISTS "auth_tokens_expires_at_idx"
  ON "auth_tokens" ("expires_at")
  WHERE "used_at" IS NULL;
