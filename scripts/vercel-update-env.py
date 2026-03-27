#!/usr/bin/env python3
"""
Update HETZNER_BASE_SNAPSHOT_ID in all Vercel environments via the Vercel API.
Usage: python3 scripts/vercel-update-env.py <snapshot_id>
Env:   VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID
"""

import json, os, sys, urllib.request, urllib.error

snap_id = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("SNAP_ID", "")
token = os.environ["VERCEL_TOKEN"]
team_id = os.environ["VERCEL_ORG_ID"]
project_id = os.environ["VERCEL_PROJECT_ID"]

if not snap_id:
    print("Usage: vercel-update-env.py <snapshot_id>", file=sys.stderr)
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


# Fetch all env vars for this project
envs, status = api("GET", f"/v9/projects/{project_id}/env")
if status != 200:
    print(f"Failed to fetch env vars: {status}", file=sys.stderr)
    sys.exit(1)

existing = [e for e in envs.get("envs", []) if e["key"] == KEY]
print(f"Found {len(existing)} existing {KEY} records")

updated = 0
for e in existing:
    result, code = api(
        "PATCH", f"/v9/projects/{project_id}/env/{e['id']}", {"value": snap_id}
    )
    target = e.get("target", "?")
    if code in (200, 201):
        print(f"  ✓ Updated [{target}] = {snap_id}")
        updated += 1
    else:
        print(f"  ✗ Failed [{target}]: {code} {result}")

if updated == 0:
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

print(f"Done — {KEY} = {snap_id} across all Vercel environments")
