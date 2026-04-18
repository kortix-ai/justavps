ALTER TABLE "auth_tokens"
  ADD COLUMN IF NOT EXISTS "binding_sha256" text;
