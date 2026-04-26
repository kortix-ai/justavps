# JustAVPS V1 API

Standalone legacy API process for the current V1 web/API split.

```bash
pnpm v1api:dev
```

By default it listens on `:4101`. The web app proxies `/api/*` to `V1_API_URL` or `http://localhost:4101`.

Legacy server code lives in `apps/v1-api/src/server`. Root `tsconfig.json` maps `@/server/*` here so existing V1 imports remain stable while the Next.js web app no longer owns the server tree.
