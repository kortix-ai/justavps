#!/usr/bin/env bash
set -euo pipefail

python3 - <<'PY'
import json
import os
import subprocess


def run(cmd):
    try:
        return subprocess.check_output(cmd, text=True).strip()
    except Exception:
        return None


def run_json(cmd):
    output = run(cmd)
    if not output:
        return None
    try:
        return json.loads(output)
    except Exception:
        return None


runnerd_version = None
try:
    with open('/opt/justavps-runnerd/package.json', 'r', encoding='utf-8') as fh:
        runnerd_version = json.load(fh).get('version')
except Exception:
    runnerd_version = None


required_projects = [
    os.getenv('JUSTAVPS_INCUS_PLATFORM_PROJECT', 'justavps-platform'),
    os.getenv('JUSTAVPS_INCUS_OPERATOR_PROJECT', 'justavps-operator'),
]

required_profiles = [
    os.getenv('JUSTAVPS_INCUS_CONTAINER_DEFAULT_PROFILE', 'platform-container-default'),
    os.getenv('JUSTAVPS_INCUS_CONTAINER_HARDENED_PROFILE', 'platform-container-hardened'),
    os.getenv('JUSTAVPS_INCUS_VM_DEFAULT_PROFILE', 'platform-vm-default'),
    os.getenv('JUSTAVPS_INCUS_WARM_POOL_PROFILE', 'platform-warm-pool'),
    os.getenv('JUSTAVPS_INCUS_OPERATOR_DEBUG_PROFILE', 'platform-operator-debug'),
]

projects = run_json(['incus', 'query', '/1.0/projects?recursion=1']) or {}
project_rows = projects.get('metadata', []) if isinstance(projects, dict) else []
project_names = sorted(row.get('name') for row in project_rows if isinstance(row, dict) and row.get('name'))

profiles = run_json(['incus', 'query', '/1.0/profiles?recursion=1']) or {}
profile_rows = profiles.get('metadata', []) if isinstance(profiles, dict) else []
profile_names = sorted(row.get('name') for row in profile_rows if isinstance(row, dict) and row.get('name'))

storage = run_json(['incus', 'query', '/1.0/storage-pools/default']) or {}
storage_meta = storage.get('metadata', {}) if isinstance(storage, dict) else {}
storage_cfg = storage_meta.get('config', {}) if isinstance(storage_meta, dict) else {}

os_security = run_json(['incus', 'query', '/os/1.0/system/security']) or {}
security_meta = os_security.get('metadata', {}) if isinstance(os_security, dict) else {}
security_state = security_meta.get('state', {}) if isinstance(security_meta, dict) else {}

print(json.dumps({
    'node_version': run(['node', '--version']),
    'incus_version': (run(['incus', 'version']) or '').replace('\n', ' ').strip() or None,
    'runnerd_version': runnerd_version,
    'runnerd_active': run(['systemctl', 'is-active', 'justavps-runnerd']),
    'incus_active': run(['systemctl', 'is-active', 'incus']),
    'docker_remote': run(['bash', '-lc', "incus remote list --format csv | grep '^docker,' || true"]) or None,
    'backup_timer': run(['systemctl', 'is-enabled', 'justavps-incus-db-backup.timer']),
    'incus_project': (os.getenv('INCUS_PROJECT', '').strip() or None),
    'storage_driver': storage_meta.get('driver') if isinstance(storage_meta, dict) else None,
    'storage_pool': storage_meta.get('name') if isinstance(storage_meta, dict) else None,
    'storage_source': storage_cfg.get('source') if isinstance(storage_cfg, dict) else None,
    'baseline_projects': project_names,
    'baseline_profiles': profile_names,
    'missing_projects': [name for name in required_projects if name not in project_names],
    'missing_profiles': [name for name in required_profiles if name not in profile_names],
    'secure_boot_enabled': security_state.get('secure_boot_enabled') if isinstance(security_state, dict) else None,
    'tpm_status': security_state.get('tpm_status') if isinstance(security_state, dict) else None,
}, indent=2))
PY
