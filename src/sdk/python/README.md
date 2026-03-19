# JustAVPS Python SDK

Official Python client for the [JustAVPS API](https://justavps.com/api/docs).

```
pip install kortix-justavps
```

## Quick Start

```python
from justavps import JustAVPS

client = JustAVPS("sk_live_...")
```

## Machines

```python
# List machines
machines = client.machines.list()

# Create a machine
machine = client.machines.create(server_type="starter", region="eu", name="my-box")
print(f"Created: {machine['id']} — {machine['slug']}")

# Get details
machine = client.machines.get(machine_id)
print(f"Status: {machine['status']}, IP: {machine['ip']}")

# Reboot / Resize / Delete
client.machines.reboot(machine_id)
client.machines.resize(machine_id, server_type="pro")
client.machines.delete(machine_id)
```

## Toolbox: Filesystem

Read, write, search, and manage files on a running machine.

```python
tb = client.toolbox(machine_id)

# List files
entries = tb.files.list("/root")
for e in entries:
    print(f"  {e['type']:4s} {e['mode_bits']} {e['size']:>8d} {e['name']}")

# Upload a file (auto-creates parent dirs)
tb.files.upload("/root/app.py", "print('hello')", mode="755")

# Download a file
content = tb.files.download("/root/app.py")

# Check existence
result = tb.files.exists("/root/app.py")
print(result["exists"], result["type"])

# File metadata
info = tb.files.info("/root/app.py")
print(f"Size: {info['size']}, Owner: {info['owner']}")

# Create directory (mkdir -p)
tb.files.mkdir("/root/project/src")

# Search text in files (grep)
result = tb.files.find("/root/project", r"TODO|FIXME", include="*.py")
for m in result["matches"]:
    print(f"  {m['file']}:{m['line']}: {m['content']}")

# Find and replace
tb.files.replace(["/root/app.py"], "hello", "goodbye")

# Move / rename
tb.files.move("/root/app.py", "/root/main.py")

# Set permissions
tb.files.chmod("/root/main.py", "755")

# Delete file
tb.files.remove("/root/main.py")

# Delete directory recursively
tb.files.remove("/root/project", recursive=True)
```

## Toolbox: Process

Execute commands, run code, and manage processes on a running machine.

```python
tb = client.toolbox(machine_id)

# Execute a shell command
result = tb.process.exec("ls -la /root")
print(f"Exit: {result['exit_code']}")
print(result["stdout"])

# Execute with cwd, timeout, env vars
result = tb.process.exec(
    "npm install && npm run build",
    cwd="/root/project",
    timeout=120,
    env={"NODE_ENV": "production"},
)

# Run a code snippet
result = tb.process.code_run("print(6 * 7)", language="python")
print(result["stdout"])  # "42\n"

# List running processes
processes = tb.process.list()
for p in processes:
    print(f"  PID {p['pid']}: {p['command']}")

# Kill a process
tb.process.kill(1234, signal="SIGTERM")
```

## Images

```python
# Create image from a running machine
image = client.machines.create_image(machine_id, name="my-snapshot")

# List / get / delete
images = client.images.list()
image = client.images.get(image_id)
client.images.delete(image_id)
```

## SSH Keys, API Keys, Webhooks

```python
# SSH Keys
keys = client.ssh_keys.list()
key = client.ssh_keys.create("laptop", "ssh-ed25519 AAAA...")
client.ssh_keys.delete(key["id"])

# API Keys
keys = client.api_keys.list()
key = client.api_keys.create("ci-deploy")
print(key["key"])  # Only shown once!
client.api_keys.delete(key["id"])

# Webhooks
hooks = client.webhooks.list()
hook = client.webhooks.create("https://example.com/hook", ["machine.ready", "machine.deleted"])
client.webhooks.delete(hook["id"])
```

## Server Types

```python
providers = client.server_types.providers()
regions = client.server_types.regions("cloud")
types = client.server_types.list("eu")
for t in types:
    print(f"  {t['name']}: {t['cores']} vCPU, {t['memory']}GB, ${t['price_monthly']}/mo")
```

## Context Manager

```python
with JustAVPS("sk_live_...") as client:
    machines = client.machines.list()
    # client.close() called automatically
```

## API Reference

Full interactive docs: **[justavps.com/api/docs](https://justavps.com/api/docs)**
