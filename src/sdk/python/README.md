# JustAVPS Python SDK

Official Python client for the [JustAVPS API](https://justavps.com/api/docs). Auto-generated from the OpenAPI spec.

```
pip install just-avps-api-client
```

## Quick Start

```python
from just_avps_api_client import AuthenticatedClient

client = AuthenticatedClient(
    base_url="https://justavps.com/api/v1",
    token="sk_live_your_api_key"
)
```

## Machines

```python
from just_avps_api_client.api.machines import (
    get_api_v1_machines,
    post_api_v1_machines,
    get_api_v1_machines_id,
    delete_api_v1_machines_id,
    post_api_v1_machines_id_reboot,
)

with client as c:
    # List all machines
    response = get_api_v1_machines.sync_detailed(client=c)

    # Create a machine
    from just_avps_api_client.models import PostApiV1MachinesBody
    machine = post_api_v1_machines.sync(client=c, body=PostApiV1MachinesBody(
        provider="cloud", server_type="cpx32", region="hel1", name="my-dev-box",
    ))

    # Get / Reboot / Delete
    machine = get_api_v1_machines_id.sync(client=c, id=machine_id)
    post_api_v1_machines_id_reboot.sync(client=c, id=machine_id)
    delete_api_v1_machines_id.sync(client=c, id=machine_id)
```

## Toolbox: Filesystem

Read, write, search, and manage files on a running machine.

```python
from just_avps_api_client.api.toolbox_filesystem import (
    get_api_v_1_machines_machine_id_toolbox_files as list_files,
    get_api_v_1_machines_machine_id_toolbox_files_info as file_info,
    get_api_v_1_machines_machine_id_toolbox_files_exists as file_exists,
    get_api_v_1_machines_machine_id_toolbox_files_download as download_file,
    post_api_v_1_machines_machine_id_toolbox_files_upload as upload_file,
    post_api_v_1_machines_machine_id_toolbox_files_folder as create_folder,
    delete_api_v_1_machines_machine_id_toolbox_files as delete_file,
    post_api_v_1_machines_machine_id_toolbox_files_move as move_file,
    get_api_v_1_machines_machine_id_toolbox_files_find as find_text,
    post_api_v_1_machines_machine_id_toolbox_files_replace as replace_text,
    post_api_v_1_machines_machine_id_toolbox_files_permissions as set_permissions,
)

machine_id = "your-machine-uuid"

with client as c:
    # List files
    result = list_files.sync(client=c, machine_id=machine_id, path="/root")
    for entry in result.entries:
        print(f"  {entry.type:4s} {entry.mode_bits} {entry.size:>8d} {entry.name}")

    # Upload a file (auto-creates parent dirs)
    upload_file.sync(client=c, machine_id=machine_id, path="/root/app.py",
                     body="print('Hello from JustAVPS!')")

    # Download a file
    content = download_file.sync(client=c, machine_id=machine_id, path="/root/app.py")

    # Check existence
    result = file_exists.sync(client=c, machine_id=machine_id, path="/root/app.py")

    # File metadata
    info = file_info.sync(client=c, machine_id=machine_id, path="/root/app.py")

    # Create directory (mkdir -p)
    create_folder.sync(client=c, machine_id=machine_id, path="/root/project/src")

    # Search text in files (grep)
    result = find_text.sync(client=c, machine_id=machine_id,
                            path="/root/project", pattern="TODO|FIXME", include_="*.py")

    # Find and replace
    replace_text.sync(client=c, machine_id=machine_id,
                      body={"files": ["/root/app.py"], "pattern": "Hello", "new_value": "Hi"})

    # Move / rename
    move_file.sync(client=c, machine_id=machine_id,
                   source="/root/app.py", destination="/root/main.py")

    # Set permissions
    set_permissions.sync(client=c, machine_id=machine_id,
                         path="/root/main.py", body={"mode": "755"})

    # Delete
    delete_file.sync(client=c, machine_id=machine_id, path="/root/main.py")
```

## Toolbox: Process

Execute commands, run code, and manage processes on a running machine.

```python
from just_avps_api_client.api.toolbox_process import (
    post_api_v_1_machines_machine_id_toolbox_process_execute as execute,
    post_api_v_1_machines_machine_id_toolbox_process_code_run as code_run,
    get_api_v_1_machines_machine_id_toolbox_process_list as list_processes,
    post_api_v_1_machines_machine_id_toolbox_process_kill as kill_process,
)

with client as c:
    # Execute a shell command
    result = execute.sync(client=c, machine_id=machine_id,
                          body={"command": "ls -la /root", "timeout": 30})
    print(f"Exit: {result.exit_code}")
    print(result.stdout)

    # Execute with cwd + env vars
    result = execute.sync(client=c, machine_id=machine_id, body={
        "command": "npm install && npm run build",
        "cwd": "/root/project",
        "timeout": 120,
        "env": {"NODE_ENV": "production"},
    })

    # Run a code snippet
    result = code_run.sync(client=c, machine_id=machine_id,
                           body={"code": "print(2 + 2)", "language": "python"})
    print(result.stdout)  # "4\n"

    # List processes
    result = list_processes.sync(client=c, machine_id=machine_id)
    for proc in result.processes:
        print(f"  PID {proc.pid}: {proc.command}")

    # Kill a process
    kill_process.sync(client=c, machine_id=machine_id,
                      body={"pid": 1234, "signal": "SIGTERM"})
```

## Images, SSH Keys, API Keys, Webhooks, Server Types

```python
# Images
from just_avps_api_client.api.images import get_api_v1_images, delete_api_v1_images_id
from just_avps_api_client.api.machines import post_api_v1_machines_id_image

# SSH Keys
from just_avps_api_client.api.ssh_keys import get_api_v1_ssh_keys, post_api_v1_ssh_keys

# API Keys
from just_avps_api_client.api.api_keys import get_api_v1_api_keys, post_api_v1_api_keys

# Webhooks
from just_avps_api_client.api.webhooks import get_api_v1_webhooks, post_api_v1_webhooks

# Server Types
from just_avps_api_client.api.server_types import (
    get_api_v1_server_types,
    get_api_v1_server_types_providers,
    get_api_v1_server_types_regions,
)
```

## Async

Every method has an async variant:

```python
async with client as c:
    machines = await get_api_v1_machines.asyncio(client=c)
    result = await execute.asyncio(client=c, machine_id=mid, body={"command": "uptime"})
```

## API Reference

Full interactive docs: **[justavps.com/api/docs](https://justavps.com/api/docs)**
