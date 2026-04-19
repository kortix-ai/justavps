#!/usr/bin/env python3
"""
Update HETZNER_BASE_SNAPSHOT_ID in specific Vercel environments via the Vercel API.

Usage:
  python3 scripts/vercel-update-env.py <snapshot_id> [--target=production|preview|all]

  --target=production   Update only production (justavps.com)
  --target=preview      Update only preview (dev.justavps.com)
  --target=all          Update all environments (default)

Env: VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID
"""

import json, os, sys, urllib.request, urllib.error

snap_id = ""
target_filter = "all"

for arg in sys.argv[1:]:
    if arg.startswith("--target="):
        target_filter = arg.split("=", 1)[1]
    elif not snap_id:
        snap_id = arg

snap_id = snap_id or os.environ.get("SNAP_ID", "")
token = os.environ["VERCEL_TOKEN"]
team_id = os.environ["VERCEL_ORG_ID"]
project_id = os.environ["VERCEL_PROJECT_ID"]

if not snap_id:
    print(
        "Usage: vercel-update-env.py <snapshot_id> [--target=production|preview|all]",
        file=sys.stderr,
    )
    sys.exit(1)

KEY = "HETZNER_BASE_SNAPSHOT_ID"
headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def api(method, path, body=None):
    url = f"https://api.vercel.com{path}?teamId={team_id}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read()), r.status
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode() or "{}"), e.code


def matches_target(env_target):
    """Check if this env record matches our target filter."""
    t = env_target if isinstance(env_target, list) else [env_target]
    t = [str(x).strip("[]'\"") for x in t]
    if target_filter == "all":
        return True
    if target_filter == "production":
        return "production" in t
    if target_filter == "preview":
        return "preview" in t or "development" in t
    return True


# Fetch all env vars for this project
envs, status = api("GET", f"/v9/projects/{project_id}/env")
if status != 200:
    print(f"Failed to fetch env vars: {status}", file=sys.stderr)
    sys.exit(1)

existing = [e for e in envs.get("envs", []) if e["key"] == KEY]
print(f"Found {len(existing)} existing {KEY} records (filter: {target_filter})")

updated = 0
for e in existing:
    if not matches_target(e.get("target", "")):
        print(f"  ⊘ Skipped [{e.get('target', '?')}] (not in target={target_filter})")
        continue
    result, code = api(
        "PATCH", f"/v9/projects/{project_id}/env/{e['id']}", {"value": snap_id}
    )
    target = e.get("target", "?")
    if code in (200, 201):
        print(f"  ✓ Updated [{target}] = {snap_id}")
        updated += 1
    else:
        print(f"  ✗ Failed [{target}]: {code} {result}")

if updated == 0 and target_filter == "all":
    # No existing records — create for all environments
    for target in ["production", "preview", "development"]:
        result, code = api(
            "POST",
            f"/v9/projects/{project_id}/env",
            {
                "key": KEY,
                "value": snap_id,
                "type": "encrypted",
                "target": [target],
            },
        )
        if code in (200, 201):
            print(f"  ✓ Created [{target}] = {snap_id}")
        else:
            print(f"  ✗ Failed [{target}]: {code} {result}")

print(f"Done — {KEY} = {snap_id} (target={target_filter})")
