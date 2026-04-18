# Broker Deploy

The shared broker runs on standalone servers and is deployed by GitHub Actions.

- `main` -> GitHub `Preview` environment -> `broker.kortix-dev.cloud`
- `production` -> GitHub `Production` environment -> `broker.kortix.cloud`

Required GitHub environment secrets:

- `BROKER_HOST`
- `BROKER_USER`
- `BROKER_SSH_PRIVATE_KEY`
- `BROKER_SHARED_SECRET`
- `BROKER_TLS_CERT_B64`
- `BROKER_TLS_KEY_B64`

Workflow:

- `.github/workflows/deploy-broker.yml`

The workflow builds `daemon/cmd/broker`, uploads the binary plus service/install files,
rewrites `/etc/kortix-broker.env`, restarts `kortix-broker`, and verifies `http://127.0.0.1/healthz` on the target host.

Broker hosts expose both `/health` and `/healthz`, and terminate TLS on `:443` using Cloudflare Origin CA certificates.
