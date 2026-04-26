# Bare-metal host SSH — canonical key

There is **one** SSH key that operates every JustAVPS bare-metal host:

- **Private key:** `~/.ssh/justavps_host`
- **Public key:** `~/.ssh/justavps_host.pub`
- **Fingerprint:** `SHA256:JEg3kRZ4k7dsd86GJ63IuT6vn+DzZtKl1IZKv68b8VQ`
- **Comment:** `justavps-host-20260407`
- **Key type:** `ed25519`

Public key value:

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMEXMvSElkld6uzCDIyIpEjWk9r9SCm0FfNqvqbIEy6H justavps-host-20260407
```

## Every bare-metal host authorizes this key

When a host is registered via the `/admin/fleet/hosts` → `/admin/fleet/hosts/{id}/register`
flow, cloud-init writes this public key into `root@host:~/.ssh/authorized_keys`.

Set `BAREMETAL_BOOTSTRAP_PUBLIC_KEY` in `.env` to the public key value above so
future procurements authorize the same key.

## How to SSH

```bash
ssh -i ~/.ssh/justavps_host root@<host-ip>
```

Set it as the default host config for any new host once you know the IP:

```bash
cat >> ~/.ssh/config <<'EOF'

Host justavps-*
  User root
  IdentityFile ~/.ssh/justavps_host
  IdentitiesOnly yes
EOF
```

Then `ssh justavps-hel1-1` (whatever you put in `HostName`) just works.

## Where runnerd's token lives on-host

`runnerd` runs as systemd unit `justavps-runnerd.service` and reads its env from:

```
/etc/justavps-runnerd.env
```

That file owns the `RUNNERD_TOKEN` the control-plane must match. Update the
token with:

```bash
ssh -i ~/.ssh/justavps_host root@<host-ip> \
  "sed -i 's|^RUNNERD_TOKEN=.*|RUNNERD_TOKEN=<new-token>|' /etc/justavps-runnerd.env \
   && systemctl restart justavps-runnerd"
```

Systemd drop-ins under `/etc/systemd/system/justavps-runnerd.service.d/` do
**not** override `/etc/justavps-runnerd.env` reliably — write the env file
directly.

## If a host refuses the canonical key

That host was provisioned outside the normal bootstrap flow and has a
different authorized_keys. Two options:

1. **Rescue & rebuild:** boot the host into Hetzner rescue, overwrite
   `/root/.ssh/authorized_keys` with `justavps_host.pub`, reboot.
2. **Retire it:** delete the row from `baremetal_hosts` and re-order a
   fresh box through the V2 admin procurement pipeline (apps/v2-api) — the
   new one will have the canonical key baked in automatically.

As of 2026-04-21:
- `135.181.129.188` (HEL1-DC4) — canonical key authorized ✓
- `65.109.65.169` (HEL1-DC5) — canonical key **not** authorized; rebuild or retire.
