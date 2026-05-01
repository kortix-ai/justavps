-- node_provisioning_runs was missed from earlier migrations even though
-- the Prisma schema defines it. Adding it now so the runner + tickNodeProvisioning
-- query stops crashing.
CREATE TABLE IF NOT EXISTS "v2_ops"."node_provisioning_runs" (
  "id"                       TEXT      NOT NULL,
  "cluster_id"               TEXT      NOT NULL,
  "source"                   TEXT      NOT NULL,
  "target_os"                TEXT      NOT NULL DEFAULT 'ubuntu-incus',
  "ssh_host"                 TEXT,
  "ssh_user"                 TEXT      NOT NULL DEFAULT 'root',
  "ssh_port"                 INTEGER   NOT NULL DEFAULT 22,
  "hetzner_server_number"    INTEGER,
  "status"                   TEXT      NOT NULL DEFAULT 'pending',
  "current_step"             TEXT,
  "last_error"               TEXT,
  "steps"                    JSONB     NOT NULL DEFAULT '[]',
  "metadata"                 JSONB     NOT NULL DEFAULT '{}',
  "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at"               TIMESTAMP(3),
  "ended_at"                 TIMESTAMP(3),
  CONSTRAINT "node_provisioning_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "node_provisioning_runs_cluster_id_status_idx"
  ON "v2_ops"."node_provisioning_runs"("cluster_id", "status");
