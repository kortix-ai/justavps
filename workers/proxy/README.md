# Kortix Cloud Proxy Worker

Cloudflare Worker that serves as the auth proxy gateway for `*.kortix.cloud` domains.

## Overview

This Worker handles authentication and proxying for VPS instances, routing requests from `*.kortix.cloud` to the appropriate backend servers.

## Features

- **Hostname Parsing**: Extracts slug and port from subdomains
  - `abc123.kortix.cloud` → slug: `abc123`, port: `8080`
  - `3000.abc123.kortix.cloud` → slug: `abc123`, port: `3000`
  - PTY WebSocket support via `/_pty` path

- **Multi-method Authentication**:
  - Bearer tokens: `Authorization: Bearer sk_live_xxx`
  - JWT cookies: `__session` cookie
  - Query parameters: `?token=xxx`

- **Secure Proxying**:
  - HTTP/HTTPS transparent proxy
  - WebSocket upgrades
  - SSE stream passthrough
  - Binary data handling
  - CORS preflight support

- **Authorization**:
  - KV-based machine ownership validation
  - Machine status checks (must be "running")

## KV Store Schema

```typescript
// API Keys
apikey:{hash} → { owner_id: string, name: string }

// Machines
machine:{slug} → { 
  owner_id: string, 
  ip: string, 
  status: string, 
  server_type: string 
}
```

## Request Flow

1. Parse hostname → extract `slug` and `port`
2. Handle CORS preflight (OPTIONS before auth)
3. Extract auth (Bearer/JWT/query param)
4. Validate auth against KV store
5. Check machine ownership and status
6. Proxy request to `VPS_IP:port`

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Development server
npm run dev

# Deploy to Cloudflare
npm run deploy
```

## Testing

- **37 tests** covering all functionality
- Unit tests for each module
- Integration tests for complete flow
- Mocked KV store for reliable testing

## Configuration

Update `wrangler.toml` with your KV namespace IDs:

```toml
[[kv_namespaces]]
binding = "KV"
preview_id = "YOUR_PREVIEW_KV_ID"
id = "YOUR_PRODUCTION_KV_ID"
```

## Error Handling

- **400**: Invalid hostname format
- **401**: Authentication failed
- **302**: Browser redirect to login (on auth failure)
- **500**: Internal server errors
- **502**: Proxy request failures

## Security Features

- Hop-by-hop header stripping
- Reserved subdomain blocking (`www`, `api`, etc.)
- Proper CORS handling
- Machine ownership validation
- Status-based access control