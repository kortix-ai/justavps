# Operator Runbook — Scaling Hosts and Backups

## Purpose
This runbook describes how to operate JustAVPS as a real multi-node VPS control plane:
- adding more bare-metal hosts
- understanding storage locality and image locality
- backup strategy and recovery model
- what is and is not shared across nodes

## 1. Control-plane architecture
The control plane is centralised:
- JustAVPS app/API/frontend
- Postgres
- Cloudflare KV / DNS / Worker auth

Each compute node is independent and runs:
- Incus
- ZFS pool
- runnerd
- nginx host reverse proxy
- warm reserve VMs

## 2. How a new node is added
1. Order or provision a new bare-metal host
2. Bootstrap host OS + Incus + ZFS + runnerd + nginx
3. Register host in `baremetal_hosts`
4. runnerd fills warm reserve buckets
5. scheduler starts placing new machines there

## 3. How scheduling scales
The scheduler picks a host by:
- region
- active status
- enough free CPU/RAM/disk
- warm reserve availability

Practical scaling policy:
- keep 1–2 host classes only at first
- bin-pack onto fewer hosts before spreading
- drain hosts explicitly before maintenance

## 4. Storage model across many hosts
Important: storage is **host-local**.
There is no shared block storage and no live migration.

That means:
- each host has its own ZFS pool
- each host has its own image cache
- each host has its own warm reserve inventory
- a VM lives on exactly one host at a time

## 5. Can a machine move to another host?
Not automatically today.

Current realistic model:
- restore from image / backup onto a different host
- not live migration
- not seamless host failover

This is intentional for simplicity and reliability.

## 6. User image locality
A user-created image exists logically in the control plane, but physically it may only be cached on one host.

Recommended policy:
- prefer placing new machines on a host that already has the image cached
- if no host has the image cached, import/copy it lazily to the chosen host
- do not replicate all images to all hosts by default

## 7. Backup model
There are three backup/recovery layers:

### A. Machine images / snapshots
Used for user-controlled restore points and fast cloning.
This is not sufficient as the only disaster-recovery mechanism.

### B. Host-local ZFS snapshots
Good for operator safety and quick rollback on a single host.
Still not enough as sole DR because the host itself can die.

### C. Off-host backups (required for real VPS service)
For actual durable recovery we need off-host backup of at least:
- critical machine images / snapshots
- Postgres database
- reserve image metadata / machine metadata

## 8. Recommended backup policy
### Database
- frequent off-host dumps / streaming backup of Postgres
- this is non-negotiable

### Machine data
- user-visible snapshots/images remain in Incus/ZFS
- selected snapshots/images should be exported off-host on schedule or on demand

### Host config
- backup runnerd/nginx/Incus host config so new host bootstrap is reproducible

## 9. Failure model
### Host failure
If a host dies:
- mark host unschedulable / draining
- affected machines become unavailable
- restore from image/snapshot/backup onto a new host

### Control-plane DB failure
If Postgres dies:
- restore from backup
- machine metadata, auth, billing state depend on it

### DNS/Worker failure
If Cloudflare path fails:
- origin SSH still provides break-glass access
- direct host debugging still works

## 10. What infinite scale really means here
It does **not** mean one giant shared storage cluster.
It means many independent nodes under one scheduler.

The scalable unit is:
- one host
- one ZFS pool
- one runnerd
- one nginx
- one warm reserve set

Add more units as demand grows.

## 11. Current product-ready runtime model
### Fast path
- warm reserve by CPU bucket

### Slow path
- cold boot from golden image

This is intentionally simple.

## 12. Future improvements
- automate host bootstrap fully from code
- host draining UI + API
- image locality-aware scheduler
- off-host machine snapshot export/import pipeline
- explicit paid reserves for custom images
- later, if needed, a different substrate for sub-second arbitrary-image boot
