# JustAVPS V2 — Cookbook

Runnable examples that exercise the V2 API end-to-end via the official SDK.
Each script self-cleans (deletes the sandbox it created) so you can run them
repeatedly without leaving litter.

## Setup

```bash
export JUSTAVPS_API_URL=http://localhost:4200
export JUSTAVPS_TOKEN=<your-bearer-token>     # or run `pnpm justavps login`
```

## Recipes

| File | What it shows |
|------|---------------|
| `01-hello-world.ts` | Create a sandbox, exec a command, delete it. |
| `02-python-data-analysis.ts` | Spin up a sandbox with Python, run a small data analysis (matplotlib + pandas), pull the output PNG back to the host. |
| `03-files-roundtrip.ts` | Upload a file, mutate it from inside the sandbox, read it back. |
| `04-snapshot-rollback.ts` | Snapshot, mutate state, restore — proves the rollback semantics. |
| `05-parallel-sandboxes.ts` | Fan out N sandboxes in parallel, run a command on each, collect results, tear them all down. |

## Run one

```bash
pnpm tsx apps/v2-api/examples/cookbook/01-hello-world.ts
```

Each script logs its progress. Successful runs end with `✓ done` and a clean
exit code. Anything else means the sandbox was probably leaked — `pnpm justavps
machines list` then `pnpm justavps machines delete <id>` to clean up.
