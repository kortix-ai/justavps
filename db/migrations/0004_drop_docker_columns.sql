-- Drop deprecated Docker workload columns from machines table.
-- These fields were accepted by the API but never acted on after cloud-init
-- Docker provisioning was removed. Cleaning up for real.

ALTER TABLE "machines" DROP COLUMN IF EXISTS "docker_image";
ALTER TABLE "machines" DROP COLUMN IF EXISTS "entrypoint";
ALTER TABLE "machines" DROP COLUMN IF EXISTS "docker_command";
