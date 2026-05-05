CREATE TABLE IF NOT EXISTS "v2_core"."users" (
  "id" TEXT PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "email_verified" TIMESTAMPTZ,
  "password_hash" TEXT,
  "github_id" TEXT UNIQUE,
  "name" TEXT,
  "stripe_customer_id" TEXT,
  "default_account_id" TEXT,
  "is_admin" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "v2_core"."accounts" (
  "id" TEXT PRIMARY KEY,
  "type" TEXT NOT NULL DEFAULT 'personal',
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "personal_for_user_id" TEXT UNIQUE,
  "billing_email" TEXT,
  "stripe_customer_id" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "deleted_at" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS "accounts_type_deleted_at_idx" ON "v2_core"."accounts" ("type", "deleted_at");

CREATE TABLE IF NOT EXISTS "v2_core"."account_memberships" (
  "id" TEXT PRIMARY KEY,
  "account_id" TEXT NOT NULL REFERENCES "v2_core"."accounts"("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL REFERENCES "v2_core"."users"("id") ON DELETE CASCADE,
  "role" TEXT NOT NULL DEFAULT 'member',
  "created_by_user_id" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "account_memberships_account_user_uidx" UNIQUE ("account_id", "user_id")
);

CREATE INDEX IF NOT EXISTS "account_memberships_user_id_idx" ON "v2_core"."account_memberships" ("user_id");

CREATE TABLE IF NOT EXISTS "v2_core"."account_invitations" (
  "id" TEXT PRIMARY KEY,
  "account_id" TEXT NOT NULL REFERENCES "v2_core"."accounts"("id") ON DELETE CASCADE,
  "email" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'member',
  "token_sha256" TEXT NOT NULL UNIQUE,
  "invited_by_user_id" TEXT NOT NULL REFERENCES "v2_core"."users"("id") ON DELETE CASCADE,
  "accepted_by_user_id" TEXT REFERENCES "v2_core"."users"("id"),
  "expires_at" TIMESTAMPTZ NOT NULL,
  "accepted_at" TIMESTAMPTZ,
  "revoked_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "account_invitations_account_email_idx" ON "v2_core"."account_invitations" ("account_id", "email");
CREATE INDEX IF NOT EXISTS "account_invitations_expires_at_idx" ON "v2_core"."account_invitations" ("expires_at");

CREATE TABLE IF NOT EXISTS "v2_core"."account_limits" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT UNIQUE,
  "account_id" TEXT UNIQUE,
  "max_machines" INTEGER NOT NULL DEFAULT 5,
  "max_images" INTEGER NOT NULL DEFAULT 10,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "v2_core"."machine_backup_policies" (
  "id" TEXT PRIMARY KEY,
  "account_id" TEXT NOT NULL,
  "machine_id" TEXT NOT NULL UNIQUE,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "cadence" TEXT NOT NULL DEFAULT 'daily',
  "interval_hours" INTEGER NOT NULL DEFAULT 24,
  "retention_days" INTEGER NOT NULL DEFAULT 7,
  "retention_count" INTEGER NOT NULL DEFAULT 7,
  "last_backup_at" TIMESTAMPTZ,
  "next_backup_at" TIMESTAMPTZ,
  "status" TEXT NOT NULL DEFAULT 'active',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "machine_backup_policies_account_enabled_idx" ON "v2_core"."machine_backup_policies" ("account_id", "enabled");
CREATE INDEX IF NOT EXISTS "machine_backup_policies_enabled_next_backup_at_idx" ON "v2_core"."machine_backup_policies" ("enabled", "next_backup_at");

INSERT INTO "v2_core"."accounts" ("id", "type", "name", "slug", "billing_email")
VALUES ('system', 'organization', 'System', 'system', NULL)
ON CONFLICT ("id") DO NOTHING;
