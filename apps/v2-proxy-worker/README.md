# JustAVPS V2 Proxy Worker

Fresh V2-only Cloudflare Worker for UUID-addressed sandbox HTTP proxying.

This intentionally does **not** share code or deployment config with `apps/proxy-worker` (legacy V1). V1 remains responsible for the existing production proxy. V2 uses this worker plus V2 API KV sync.

## Identity rule

The sandbox UUID is the only identity used for CRUD/routing.

```text
{uuid}.kortix-dev.cloud
{port}--{uuid}.kortix-dev.cloud
```

Display names never appear in routing or CRUD URLs.

## Auth model

V2 starts with proxy-token auth only:

- V2 API writes `machine:{uuid-slug}` KV records.
- V2 API writes `pt:{sha256}` KV records.
- Worker accepts `X-Proxy-Token`, `?__proxy_token=pt_...`, or `__justavps_v2_pt` cookie.
- First browser GET with `?__proxy_token=` sets the cookie and redirects to the clean URL.

No V1 API-key/JWT/login behavior is included here. Add V2-native account auth later if needed.

## Dev domain policy

- `kortix.cloud` is production-only.
- Local/dev/staging defaults to isolated `kortix-dev.cloud`.
- Override with `PROXY_DOMAINS` in `wrangler.toml` and `V2_PROXY_DOMAIN` in `apps/v2-api` when using a new domain.

## Deploy checklist

1. Create a V2-only KV namespace.
2. Bind it in `wrangler.toml` as `KV` for the target env.
3. Add a Worker route for the chosen wildcard domain.
4. Set `V2_PROXY_DOMAIN` and `CF_KV_NAMESPACE_ID` in `apps/v2-api` to match.
5. Create a sandbox via v2-api and confirm returned `machine.id` is a UUID.
6. Create a proxy token and open the returned `proxy_url`.

## Commands

```bash
pnpm --dir apps/v2-proxy-worker typecheck
pnpm --dir apps/v2-proxy-worker test
pnpm --dir apps/v2-proxy-worker deploy:dev
```
