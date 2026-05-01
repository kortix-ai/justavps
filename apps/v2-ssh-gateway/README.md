# JustAVPS V2 SSH Gateway

Token-authenticated SSH gateway for V2 machines. This follows Daytona's model:

```text
ssh client / VS Code Remote SSH
  -> v2-ssh-gateway
  -> v2-api /internal/ssh/validate
  -> guest sshd on the target machine
```

The SSH username is the short-lived token returned by `POST /ssh-tokens`.

```bash
ssh -o HostKeyAlias=justavps-v2-ssh-localhost-2222 -o StrictHostKeyChecking=accept-new -p 2222 st_xxx@localhost
```

Required environment:

- `V2_API_URL` — e.g. `http://localhost:4200`
- `V2_API_TOKEN` or `V2_ADMIN_TOKEN` — bearer token used to validate SSH tokens
- `V2_SSH_GATEWAY_PRIVATE_KEY` or `V2_SSH_GATEWAY_PRIVATE_KEY_FILE` — private key used by the gateway to SSH into guests
- `V2_SSH_GATEWAY_HOST_KEY` or `V2_SSH_GATEWAY_HOST_KEY_FILE` — stable SSH host key presented to clients
- `V2_SSH_GATEWAY_PORT` — listen port, default `2222`

The matching public key must be supplied to v2-api as `V2_SSH_GATEWAY_PUBLIC_KEY` so
`POST /ssh-tokens` can install it into the target guest's `authorized_keys`.

SSH access is feature-flagged while the gateway is being operationalized:

- v2-api: `V2_SSH_GATEWAY_ENABLED=true`
- admin-web: `NEXT_PUBLIC_V2_SSH_GATEWAY_ENABLED=true`

The gateway refuses to start without `V2_SSH_GATEWAY_HOST_KEY` by default because
ephemeral host keys trigger `REMOTE HOST IDENTIFICATION HAS CHANGED` in SSH clients.
For throwaway local testing only, set `V2_SSH_GATEWAY_ALLOW_EPHEMERAL_HOST_KEY=true`.
