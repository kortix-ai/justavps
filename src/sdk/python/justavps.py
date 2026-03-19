"""
JustAVPS Python SDK — Ergonomic wrapper.

Usage:
    from justavps import JustAVPS

    client = JustAVPS("sk_live_...")

    # Machines
    machines = client.machines.list()
    machine = client.machines.create(server_type="cpx32", region="hel1")
    client.machines.delete(machine["id"])

    # Toolbox (filesystem + process)
    tb = client.toolbox(machine["id"])
    tb.files.upload("/root/app.py", "print('hello')")
    content = tb.files.download("/root/app.py")
    result = tb.process.exec("python3 /root/app.py")
    print(result["stdout"])
"""

from __future__ import annotations

import httpx
from typing import Any
from urllib.parse import quote


class JustAVPSError(Exception):
    def __init__(self, message: str, status: int, body: dict | None = None):
        super().__init__(message)
        self.status = status
        self.body = body


class _Http:
    def __init__(self, api_key: str, base_url: str, timeout: float):
        self._client = httpx.Client(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=timeout,
        )

    def _check(self, resp: httpx.Response) -> httpx.Response:
        if resp.status_code >= 400:
            try:
                body = resp.json()
                msg = body.get("message") or body.get("error") or f"HTTP {resp.status_code}"
            except Exception:
                body = None
                msg = f"HTTP {resp.status_code}"
            raise JustAVPSError(msg, resp.status_code, body)
        return resp

    def get(self, path: str) -> dict:
        return self._check(self._client.get(path)).json()

    def post(self, path: str, json: Any = None) -> dict:
        return self._check(self._client.post(path, json=json)).json()

    def post_raw(self, path: str, content: str | bytes, content_type: str = "application/octet-stream") -> dict:
        return self._check(
            self._client.post(path, content=content if isinstance(content, bytes) else content.encode(), headers={"Content-Type": content_type})
        ).json()

    def delete(self, path: str) -> dict:
        return self._check(self._client.delete(path)).json()

    def get_raw(self, path: str) -> httpx.Response:
        return self._check(self._client.get(path))

    def close(self):
        self._client.close()


# ── Resource classes ─────────────────────────────────────────────────────


class _Machines:
    def __init__(self, http: _Http):
        self._http = http

    def list(self) -> list[dict]:
        return self._http.get("/machines")["machines"]

    def get(self, id: str) -> dict:
        return self._http.get(f"/machines/{id}")

    def create(self, server_type: str, region: str, **kwargs) -> dict:
        return self._http.post("/machines", {"server_type": server_type, "region": region, "provider": kwargs.get("provider", "cloud"), **kwargs})

    def delete(self, id: str) -> dict:
        return self._http.delete(f"/machines/{id}")

    def reboot(self, id: str) -> dict:
        return self._http.post(f"/machines/{id}/reboot")

    def resize(self, id: str, server_type: str) -> dict:
        return self._http.post(f"/machines/{id}/resize", {"server_type": server_type})

    def create_image(self, id: str, name: str) -> dict:
        return self._http.post(f"/machines/{id}/image", {"name": name})


class _Images:
    def __init__(self, http: _Http):
        self._http = http

    def list(self) -> list[dict]:
        return self._http.get("/images")["images"]

    def get(self, id: str) -> dict:
        return self._http.get(f"/images/{id}")

    def delete(self, id: str) -> dict:
        return self._http.delete(f"/images/{id}")


class _SSHKeys:
    def __init__(self, http: _Http):
        self._http = http

    def list(self) -> list[dict]:
        return self._http.get("/ssh-keys")["ssh_keys"]

    def create(self, name: str, public_key: str) -> dict:
        return self._http.post("/ssh-keys", {"name": name, "public_key": public_key})

    def delete(self, id: str) -> dict:
        return self._http.delete(f"/ssh-keys/{id}")


class _APIKeys:
    def __init__(self, http: _Http):
        self._http = http

    def list(self) -> list[dict]:
        return self._http.get("/api-keys")["api_keys"]

    def create(self, name: str) -> dict:
        return self._http.post("/api-keys", {"name": name})

    def delete(self, id: str) -> dict:
        return self._http.delete(f"/api-keys/{id}")


class _Webhooks:
    def __init__(self, http: _Http):
        self._http = http

    def list(self) -> list[dict]:
        return self._http.get("/webhooks")["webhooks"]

    def create(self, url: str, events: list[str]) -> dict:
        return self._http.post("/webhooks", {"url": url, "events": events})

    def delete(self, id: str) -> dict:
        return self._http.delete(f"/webhooks/{id}")


class _ServerTypes:
    def __init__(self, http: _Http):
        self._http = http

    def list(self, region: str, provider: str = "cloud") -> list[dict]:
        return self._http.get(f"/server-types?provider={provider}&region={region}")["server_types"]

    def providers(self) -> list[dict]:
        return self._http.get("/server-types/providers")["providers"]

    def regions(self, provider: str = "cloud") -> list[dict]:
        return self._http.get(f"/server-types/regions?provider={provider}")["regions"]


# ── Toolbox ──────────────────────────────────────────────────────────────


class _ToolboxFiles:
    def __init__(self, http: _Http, machine_id: str):
        self._http = http
        self._base = f"/machines/{machine_id}/toolbox"

    def list(self, path: str = "/root", depth: int = 1) -> list[dict]:
        return self._http.get(f"{self._base}/files?path={quote(path)}&depth={depth}")["entries"]

    def info(self, path: str) -> dict:
        return self._http.get(f"{self._base}/files/info?path={quote(path)}")

    def exists(self, path: str) -> dict:
        return self._http.get(f"{self._base}/files/exists?path={quote(path)}")

    def download(self, path: str) -> str:
        return self._http.get_raw(f"{self._base}/files/download?path={quote(path)}").text

    def upload(self, path: str, content: str | bytes, mode: str = "644") -> dict:
        return self._http.post_raw(f"{self._base}/files/upload?path={quote(path)}&mode={mode}", content)

    def mkdir(self, path: str, mode: str = "755") -> dict:
        return self._http.post(f"{self._base}/files/folder?path={quote(path)}&mode={mode}")

    def remove(self, path: str, recursive: bool = False) -> dict:
        r = "&recursive=true" if recursive else ""
        return self._http.delete(f"{self._base}/files?path={quote(path)}{r}")

    def move(self, source: str, destination: str) -> dict:
        return self._http.post(f"{self._base}/files/move?source={quote(source)}&destination={quote(destination)}")

    def find(self, path: str, pattern: str, include: str | None = None, max_results: int = 100) -> dict:
        q = f"path={quote(path)}&pattern={quote(pattern)}&max_results={max_results}"
        if include:
            q += f"&include={quote(include)}"
        return self._http.get(f"{self._base}/files/find?{q}")

    def replace(self, files: list[str], pattern: str, new_value: str) -> dict:
        return self._http.post(f"{self._base}/files/replace", {"files": files, "pattern": pattern, "new_value": new_value})

    def chmod(self, path: str, mode: str) -> dict:
        return self._http.post(f"{self._base}/files/permissions?path={quote(path)}", {"mode": mode})


class _ToolboxProcess:
    def __init__(self, http: _Http, machine_id: str):
        self._http = http
        self._base = f"/machines/{machine_id}/toolbox"

    def exec(self, command: str, cwd: str | None = None, timeout: int = 60, env: dict[str, str] | None = None) -> dict:
        body: dict[str, Any] = {"command": command, "timeout": timeout}
        if cwd:
            body["cwd"] = cwd
        if env:
            body["env"] = env
        return self._http.post(f"{self._base}/process/execute", body)

    def code_run(self, code: str, language: str | None = None, timeout: int = 30) -> dict:
        body: dict[str, Any] = {"code": code, "timeout": timeout}
        if language:
            body["language"] = language
        return self._http.post(f"{self._base}/process/code-run", body)

    def list(self) -> list[dict]:
        return self._http.get(f"{self._base}/process/list")["processes"]

    def kill(self, pid: int, signal: str = "SIGTERM") -> dict:
        return self._http.post(f"{self._base}/process/kill", {"pid": pid, "signal": signal})


class _Toolbox:
    def __init__(self, http: _Http, machine_id: str):
        self.files = _ToolboxFiles(http, machine_id)
        self.process = _ToolboxProcess(http, machine_id)


# ── Main client ──────────────────────────────────────────────────────────


class JustAVPS:
    """JustAVPS Python SDK.

    Args:
        api_key: Your API key (sk_live_...)
        base_url: API base URL (default: https://justavps.com/api/v1)
        timeout: Request timeout in seconds (default: 30)
    """

    def __init__(self, api_key: str, base_url: str = "https://justavps.com/api/v1", timeout: float = 30):
        self._http = _Http(api_key, base_url, timeout)
        self.machines = _Machines(self._http)
        self.images = _Images(self._http)
        self.ssh_keys = _SSHKeys(self._http)
        self.api_keys = _APIKeys(self._http)
        self.webhooks = _Webhooks(self._http)
        self.server_types = _ServerTypes(self._http)

    def toolbox(self, machine_id: str) -> _Toolbox:
        """Get a toolbox interface for a machine (filesystem + process APIs)."""
        return _Toolbox(self._http, machine_id)

    def close(self):
        """Close the underlying HTTP client."""
        self._http.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
