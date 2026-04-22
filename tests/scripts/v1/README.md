# V1 script flows

These are the preserved V1 script-based flows.

## Single entrypoint

Run all V1 script flows that have the required credentials:

```bash
pnpm e2e:v1:all
```

Or pass toolbox SSH args directly:

```bash
bash tests/scripts/v1/run-all.sh <machine_ip> <ssh_key_path>
```

## Individual commands

### 01. Billing

```bash
pnpm e2e:v1:billing
```

### 02. Direct checkout

```bash
pnpm e2e:v1:direct-checkout
```

### 03. Full live machine flow

```bash
pnpm e2e:v1:full-live
```

### 04. Proxy flow

```bash
pnpm e2e:v1:proxy
```

### 05. Toolbox API flow

```bash
pnpm e2e:v1:toolbox-api
```

### 06. Toolbox direct flow

```bash
pnpm e2e:v1:toolbox -- <machine_ip> <ssh_key_path>
```

## Notes

- V1 browser coverage still lives in `pnpm e2e:v1:ui`.
- This folder is for **scripted V1 flows only**.
- The V2 numbered flow lives in `tests/scripts/v2/README.md`.
