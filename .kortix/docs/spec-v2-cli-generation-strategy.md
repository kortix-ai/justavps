# JustAVPS V2 CLI generation strategy

Status: proposed  
Date: 2026-04-19  
Owner: platform / DX

---

## 1. Goal

The V2 CLI should be **mostly generated from OpenAPI**, the same way the SDK is generated from OpenAPI.

The CLI should not become a giant handwritten parallel surface that drifts from the API.

---

## 2. Source of truth

The source of truth is:

1. V2 route definitions
2. generated OpenAPI V2 spec
3. generated SDK / thin client wrappers

The CLI should sit **on top of that**, not beside it.

---

## 3. Desired split

### Auto-generated / OpenAPI-driven

- command groups from tags + path prefixes
- command names from path + method classification
- help text from `summary` / `description`
- required path params
- whether a request body is expected
- generic JSON invocation for CRUD-style commands

### Hand-authored overrides

Some commands should stay manual because they need better UX than raw JSON:

- `machines create`
- `machines exec`
- later `machines files *`
- later `machines terminal`
- later streaming/watch commands

This gives us the right balance:

- generated boring commands
- hand-crafted interaction commands

---

## 4. Runtime model

The CLI should:

1. resolve API base URL
2. load `openapi-v2.json` if present locally
3. otherwise fetch `/api/docs/openapi-v2.json`
4. build an operation manifest
5. expose those operations as CLI commands

That means the CLI can stay aligned with the API as the spec evolves.

---

## 5. Command shape

Canonical generated command shape:

```bash
justavps-v2 <resource> <action> [path params...] [--json '{...}' | --file body.json]
```

Examples:

```bash
pnpm cli:v2 -- machines list
pnpm cli:v2 -- machines get <id>
pnpm cli:v2 -- machines start <id>
pnpm cli:v2 -- snapshots create <machineId> --json '{}'
```

Manual UX overrides can still exist for nicer commands.

---

## 6. Why this is better

- less drift between REST API and CLI
- easier to expand as V2 gains endpoints
- no need to hand-code every CRUD command
- help output stays derived from the API contract
- higher confidence that CLI parity tracks API parity

---

## 7. Current implementation stance

The current V2 CLI should be treated as:

- **OpenAPI-driven skeleton for standard commands**
- **manual overrides for create/exec**

That is the intended direction, not a temporary hack.
