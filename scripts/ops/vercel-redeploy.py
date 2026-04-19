#!/usr/bin/env python3
"""
Trigger a Vercel production redeploy.
Usage: python3 scripts/vercel-redeploy.py
Env:   VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID
"""

import json, os, urllib.request, urllib.error

token = os.environ["VERCEL_TOKEN"]
team_id = os.environ["VERCEL_ORG_ID"]
project_id = os.environ["VERCEL_PROJECT_ID"]
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


# Get latest production deployment
deps, status = api(
    "GET", f"/v6/deployments?projectId={project_id}&target=production&limit=1"
)
if status != 200 or not deps.get("deployments"):
    print("No production deployments found — skipping redeploy")
    exit(0)

latest = deps["deployments"][0]
dep_id = latest["uid"]
dep_url = latest.get("url", "")
print(f"Latest production deploy: {dep_id} ({dep_url})")

result, code = api(
    "POST",
    f"/v13/deployments?forceNew=1",
    {
        "name": project_id,
        "deploymentId": dep_id,
        "target": "production",
    },
)
if code in (200, 201):
    new_url = result.get("url", "")
    new_id = result.get("id", result.get("uid", "?"))
    print(f"✓ Redeploy triggered: {new_id} ({new_url})")
else:
    print(f"⚠ Redeploy API returned {code}: {result}")
    print("  The env change will take effect on the next deployment.")
