-- Dynamic cluster registry: clusters can now be registered at runtime via
-- POST /admin/clusters without requiring an INCUS_CLUSTERS_JSON restart.
-- The `config` column stores the full IncusClusterConfig (certs paths,
-- SKU, channel, root pool, etc.) so the API can hydrate at request time.
ALTER TABLE "v2_incus"."clusters"
  ADD COLUMN IF NOT EXISTS "config" JSONB NOT NULL DEFAULT '{}';
