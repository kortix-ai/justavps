-- V2: Store actual allocated resources on each machine
-- serverType remains for V1 backward compat but V2 machines store 'custom'
ALTER TABLE machines ADD COLUMN IF NOT EXISTS vcpu integer;
ALTER TABLE machines ADD COLUMN IF NOT EXISTS ram_gb integer;
ALTER TABLE machines ADD COLUMN IF NOT EXISTS disk_gb integer;
