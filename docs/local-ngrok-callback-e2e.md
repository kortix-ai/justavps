# Local ngrok callback flow for real-host E2E

Use ngrok for remote machine callbacks when running JustAVPS locally on port `4100`.

## One-command dev start

```bash
pnpm dev:ngrok
```

That command:

1. verifies ngrok is installed and authenticated
2. starts or reuses a local ngrok tunnel for `http://127.0.0.1:4100`
3. writes the current public callback URL into `.env.local`
4. starts the Next.js dev server on `http://localhost:4100`

## Manual tunnel management

```bash
pnpm callback:ngrok
pnpm callback:ngrok:url
pnpm callback:ngrok:doctor
pnpm callback:ngrok:stop
```

The generated `.env.local` block is intentionally small and only manages callback overrides:

```dotenv
# BEGIN JUSTAVPS_NGROK_CALLBACK
MACHINE_CALLBACK_URL=https://<current-ngrok-subdomain>.ngrok.app
NGROK_CALLBACK_URL=https://<current-ngrok-subdomain>.ngrok.app
NGROK_CALLBACK_MODE=ephemeral
# END JUSTAVPS_NGROK_CALLBACK
```

If the local machine has a reserved ngrok URL, export it before starting the tunnel:

```bash
export NGROK_RESERVED_URL=https://justavps-callback.ngrok.app
pnpm callback:ngrok
```

When the reserved URL is accepted, the generated block will preserve it and set `NGROK_CALLBACK_MODE=reserved`. If ngrok rejects the requested URL, the script now falls back to an ephemeral tunnel and records that mode honestly.

## Real-host V2 E2E

With the local app already running:

```bash
pnpm callback:ngrok
pnpm e2e:v2:baremetal
```

## Important caveat

This setup is repeatable, but the callback hostname is only stable if the ngrok account has a reserved domain configured and exposed via `NGROK_RESERVED_URL`. In this environment the ngrok agent is authenticated, but stable-host capability is still external to this repo. `pnpm callback:ngrok:doctor` reports the current callback mode and whether a reserved URL has been configured.
