CREATE TABLE IF NOT EXISTS control_plane_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  priority integer NOT NULL DEFAULT 100,
  attempt integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  lease_owner text,
  lease_expires_at timestamp,
  run_after timestamp NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL,
  result jsonb,
  error text,
  last_attempt_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS control_plane_jobs_type_idempotency_uidx ON control_plane_jobs (job_type, idempotency_key);
CREATE INDEX IF NOT EXISTS control_plane_jobs_type_run_after_idx ON control_plane_jobs (job_type, status, run_after);
CREATE INDEX IF NOT EXISTS control_plane_jobs_status_run_after_idx ON control_plane_jobs (status, run_after);
CREATE INDEX IF NOT EXISTS control_plane_jobs_subject_idx ON control_plane_jobs (subject_type, subject_id);

ALTER TABLE machines ADD COLUMN IF NOT EXISTS vcpu integer;
ALTER TABLE machines ADD COLUMN IF NOT EXISTS ram_gb integer;
ALTER TABLE machines ADD COLUMN IF NOT EXISTS disk_gb integer;

-- Backfill columns that older prods missed because `accounts` was rolled in
-- via drizzle push, never a migration file. FKs intentionally omitted —
-- indexes only need the column to exist.
ALTER TABLE machines ADD COLUMN IF NOT EXISTS account_id uuid;
ALTER TABLE images ADD COLUMN IF NOT EXISTS account_id uuid;
ALTER TABLE machine_events ADD COLUMN IF NOT EXISTS account_id uuid;
ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS account_id uuid;

CREATE INDEX IF NOT EXISTS images_account_status_created_idx ON images (account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS machines_account_deleted_created_idx ON machines (account_id, deleted_at, created_at DESC);
CREATE INDEX IF NOT EXISTS machines_status_deleted_idx ON machines (status, deleted_at);
CREATE INDEX IF NOT EXISTS machines_provider_region_status_deleted_idx ON machines (provider, region, status, deleted_at);
CREATE INDEX IF NOT EXISTS machines_provider_server_id_idx ON machines (provider_server_id);
CREATE INDEX IF NOT EXISTS machines_last_heartbeat_at_idx ON machines (last_heartbeat_at);
CREATE INDEX IF NOT EXISTS machine_events_machine_created_idx ON machine_events (machine_id, created_at DESC);
CREATE INDEX IF NOT EXISTS machine_events_account_created_idx ON machine_events (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS baremetal_hosts_region_status_host_class_idx ON baremetal_hosts (region, status, host_class);
CREATE INDEX IF NOT EXISTS baremetal_hosts_status_updated_at_idx ON baremetal_hosts (status, updated_at);
CREATE INDEX IF NOT EXISTS webhooks_account_active_idx ON webhooks (account_id, active);

ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS payload_version integer NOT NULL DEFAULT 1;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'queued';
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS next_attempt_at timestamp;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS last_attempt_at timestamp;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS delivered_at timestamp;
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS dead_lettered_at timestamp;
ALTER TABLE webhook_deliveries ALTER COLUMN attempt SET DEFAULT 0;

UPDATE webhook_deliveries
SET status = CASE WHEN success THEN 'delivered' ELSE 'dead_lettered' END
WHERE status IS NULL;

UPDATE webhook_deliveries
SET next_attempt_at = created_at
WHERE next_attempt_at IS NULL;

CREATE INDEX IF NOT EXISTS webhook_deliveries_webhook_created_idx ON webhook_deliveries (webhook_id, created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_deliveries_status_next_attempt_idx ON webhook_deliveries (status, next_attempt_at);
