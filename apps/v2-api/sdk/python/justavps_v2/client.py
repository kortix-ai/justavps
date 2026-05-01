# This file is auto-generated from sdk/openapi.json. Do not edit by hand.
from __future__ import annotations

import json
from typing import Any, Mapping, Optional
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError

OPERATIONS = json.loads("{\n  \"get_health\": {\n    \"method\": \"GET\",\n    \"path\": \"/health\",\n    \"summary\": \"Liveness + configuration probe\",\n    \"tags\": [\n      \"System\"\n    ],\n    \"has_body\": false\n  },\n  \"get_regions\": {\n    \"method\": \"GET\",\n    \"path\": \"/regions\",\n    \"summary\": \"List available regions\",\n    \"tags\": [\n      \"System\"\n    ],\n    \"has_body\": false\n  },\n  \"get_images\": {\n    \"method\": \"GET\",\n    \"path\": \"/images\",\n    \"summary\": \"List image catalog\",\n    \"tags\": [\n      \"Images\"\n    ],\n    \"has_body\": false\n  },\n  \"post_images\": {\n    \"method\": \"POST\",\n    \"path\": \"/images\",\n    \"summary\": \"Create / pull an image\",\n    \"tags\": [\n      \"Images\"\n    ],\n    \"has_body\": true\n  },\n  \"get_machines\": {\n    \"method\": \"GET\",\n    \"path\": \"/machines\",\n    \"summary\": \"List machines\",\n    \"tags\": [\n      \"Machines\"\n    ],\n    \"has_body\": false\n  },\n  \"post_machines\": {\n    \"method\": \"POST\",\n    \"path\": \"/machines\",\n    \"summary\": \"Create a machine\",\n    \"tags\": [\n      \"Machines\"\n    ],\n    \"has_body\": true\n  },\n  \"get_machines_by_id\": {\n    \"method\": \"GET\",\n    \"path\": \"/machines/{id}\",\n    \"summary\": \"Get a single machine\",\n    \"tags\": [\n      \"Machines\"\n    ],\n    \"has_body\": false\n  },\n  \"patch_machines_by_id\": {\n    \"method\": \"PATCH\",\n    \"path\": \"/machines/{id}\",\n    \"summary\": \"Resize a machine in place\",\n    \"tags\": [\n      \"Machines\"\n    ],\n    \"has_body\": true\n  },\n  \"delete_machines_by_id\": {\n    \"method\": \"DELETE\",\n    \"path\": \"/machines/{id}\",\n    \"summary\": \"Delete a machine\",\n    \"tags\": [\n      \"Machines\"\n    ],\n    \"has_body\": false\n  },\n  \"post_machines_by_id_daemon_ensure\": {\n    \"method\": \"POST\",\n    \"path\": \"/machines/{id}/daemon/ensure\",\n    \"summary\": \"Install or repair the managed guest daemon\",\n    \"tags\": [\n      \"Sandbox\"\n    ],\n    \"has_body\": true\n  },\n  \"get_proxy_tokens\": {\n    \"method\": \"GET\",\n    \"path\": \"/proxy-tokens\",\n    \"summary\": \"List active proxy tokens\",\n    \"tags\": [\n      \"Proxy Tokens\"\n    ],\n    \"has_body\": false\n  },\n  \"post_proxy_tokens\": {\n    \"method\": \"POST\",\n    \"path\": \"/proxy-tokens\",\n    \"summary\": \"Create a proxy token\",\n    \"tags\": [\n      \"Proxy Tokens\"\n    ],\n    \"has_body\": true\n  },\n  \"delete_proxy_tokens_by_id\": {\n    \"method\": \"DELETE\",\n    \"path\": \"/proxy-tokens/{id}\",\n    \"summary\": \"Revoke a proxy token\",\n    \"tags\": [\n      \"Proxy Tokens\"\n    ],\n    \"has_body\": false\n  },\n  \"get_ssh_tokens\": {\n    \"method\": \"GET\",\n    \"path\": \"/ssh-tokens\",\n    \"summary\": \"List active SSH gateway tokens\",\n    \"tags\": [\n      \"SSH\"\n    ],\n    \"has_body\": false\n  },\n  \"post_ssh_tokens\": {\n    \"method\": \"POST\",\n    \"path\": \"/ssh-tokens\",\n    \"summary\": \"Create an SSH gateway token\",\n    \"tags\": [\n      \"SSH\"\n    ],\n    \"has_body\": true\n  },\n  \"get_internal_ssh_validate\": {\n    \"method\": \"GET\",\n    \"path\": \"/internal/ssh/validate\",\n    \"summary\": \"Validate SSH gateway token\",\n    \"tags\": [\n      \"SSH\"\n    ],\n    \"has_body\": false\n  },\n  \"post_machines_by_id_start\": {\n    \"method\": \"POST\",\n    \"path\": \"/machines/{id}/start\",\n    \"summary\": \"Start a machine\",\n    \"tags\": [\n      \"Machines\"\n    ],\n    \"has_body\": true\n  },\n  \"post_machines_by_id_stop\": {\n    \"method\": \"POST\",\n    \"path\": \"/machines/{id}/stop\",\n    \"summary\": \"Stop a machine\",\n    \"tags\": [\n      \"Machines\"\n    ],\n    \"has_body\": true\n  },\n  \"post_machines_by_id_reboot\": {\n    \"method\": \"POST\",\n    \"path\": \"/machines/{id}/reboot\",\n    \"summary\": \"Reboot a machine\",\n    \"tags\": [\n      \"Machines\"\n    ],\n    \"has_body\": true\n  },\n  \"get_machines_by_id_snapshots\": {\n    \"method\": \"GET\",\n    \"path\": \"/machines/{id}/snapshots\",\n    \"summary\": \"List snapshots\",\n    \"tags\": [\n      \"Snapshots\"\n    ],\n    \"has_body\": false\n  },\n  \"post_machines_by_id_snapshots\": {\n    \"method\": \"POST\",\n    \"path\": \"/machines/{id}/snapshots\",\n    \"summary\": \"Create a snapshot\",\n    \"tags\": [\n      \"Snapshots\"\n    ],\n    \"has_body\": true\n  },\n  \"post_machines_by_id_snapshots_by_name_restore\": {\n    \"method\": \"POST\",\n    \"path\": \"/machines/{id}/snapshots/{name}/restore\",\n    \"summary\": \"Restore a snapshot in place\",\n    \"tags\": [\n      \"Snapshots\"\n    ],\n    \"has_body\": true\n  },\n  \"delete_machines_by_id_snapshots_by_name\": {\n    \"method\": \"DELETE\",\n    \"path\": \"/machines/{id}/snapshots/{name}\",\n    \"summary\": \"Delete a snapshot\",\n    \"tags\": [\n      \"Snapshots\"\n    ],\n    \"has_body\": false\n  },\n  \"post_images_by_id_prewarm\": {\n    \"method\": \"POST\",\n    \"path\": \"/images/{id}/prewarm\",\n    \"summary\": \"Pre-warm the unpacked image cache\",\n    \"tags\": [\n      \"Images\"\n    ],\n    \"has_body\": true\n  },\n  \"delete_images_by_id\": {\n    \"method\": \"DELETE\",\n    \"path\": \"/images/{id}\",\n    \"summary\": \"Delete an image\",\n    \"tags\": [\n      \"Images\"\n    ],\n    \"has_body\": false\n  },\n  \"get_templates\": {\n    \"method\": \"GET\",\n    \"path\": \"/templates\",\n    \"summary\": \"List the curated image catalog\",\n    \"tags\": [\n      \"Templates\"\n    ],\n    \"has_body\": false\n  },\n  \"delete_templates_cache_extras\": {\n    \"method\": \"DELETE\",\n    \"path\": \"/templates/cache/extras\",\n    \"summary\": \"Purge non-template images from every cluster cache\",\n    \"tags\": [\n      \"Templates\"\n    ],\n    \"has_body\": false\n  },\n  \"get_machines_by_id_backups\": {\n    \"method\": \"GET\",\n    \"path\": \"/machines/{id}/backups\",\n    \"summary\": \"List backups\",\n    \"tags\": [\n      \"Backups\"\n    ],\n    \"has_body\": false\n  },\n  \"post_machines_by_id_backups\": {\n    \"method\": \"POST\",\n    \"path\": \"/machines/{id}/backups\",\n    \"summary\": \"Create a backup\",\n    \"tags\": [\n      \"Backups\"\n    ],\n    \"has_body\": true\n  },\n  \"post_machines_by_id_backups_by_name_restore\": {\n    \"method\": \"POST\",\n    \"path\": \"/machines/{id}/backups/{name}/restore\",\n    \"summary\": \"Restore a backup in place\",\n    \"tags\": [\n      \"Backups\"\n    ],\n    \"has_body\": true\n  },\n  \"delete_machines_by_id_backups_by_name\": {\n    \"method\": \"DELETE\",\n    \"path\": \"/machines/{id}/backups/{name}\",\n    \"summary\": \"Delete a backup\",\n    \"tags\": [\n      \"Backups\"\n    ],\n    \"has_body\": false\n  },\n  \"post_machines_by_id_exec\": {\n    \"method\": \"POST\",\n    \"path\": \"/machines/{id}/exec\",\n    \"summary\": \"Execute a command inside a sandbox\",\n    \"tags\": [\n      \"Sandbox\"\n    ],\n    \"has_body\": true\n  },\n  \"put_machines_by_id_files\": {\n    \"method\": \"PUT\",\n    \"path\": \"/machines/{id}/files\",\n    \"summary\": \"Write a file inside the sandbox\",\n    \"tags\": [\n      \"Sandbox\"\n    ],\n    \"has_body\": true\n  },\n  \"get_machines_by_id_files\": {\n    \"method\": \"GET\",\n    \"path\": \"/machines/{id}/files\",\n    \"summary\": \"Read a file or list a directory\",\n    \"tags\": [\n      \"Sandbox\"\n    ],\n    \"has_body\": false\n  },\n  \"delete_machines_by_id_files\": {\n    \"method\": \"DELETE\",\n    \"path\": \"/machines/{id}/files\",\n    \"summary\": \"Delete a file or directory inside the sandbox\",\n    \"tags\": [\n      \"Sandbox\"\n    ],\n    \"has_body\": false\n  }\n}")


class JustAVPSV2Error(Exception):
    def __init__(self, message: str, status: Optional[int] = None, body: Any = None) -> None:
        super().__init__(message)
        self.status = status
        self.body = body


class JustAVPSV2:
    def __init__(self, base_url: str = "http://localhost:4200", token: Optional[str] = None, timeout: int = 60) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout

    def request(self, method: str, path: str, *, query: Optional[Mapping[str, Any]] = None, body: Any = None) -> Any:
        url = self.base_url + path
        if query:
            compact = {k: v for k, v in query.items() if v is not None}
            if compact:
                url += "?" + urlencode(compact, doseq=True)
        payload = None if body is None else json.dumps(body).encode("utf-8")
        headers = {"Accept": "application/json"}
        if payload is not None:
            headers["Content-Type"] = "application/json"
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        req = Request(url, data=payload, headers=headers, method=method.upper())
        try:
            with urlopen(req, timeout=self.timeout) as response:
                data = response.read()
                if not data:
                    return None
                return json.loads(data.decode("utf-8"))
        except HTTPError as error:
            raw = error.read().decode("utf-8", errors="replace")
            try:
                body_obj = json.loads(raw) if raw else None
            except Exception:
                body_obj = raw
            raise JustAVPSV2Error(f"{error.code} {error.reason}", error.code, body_obj) from None

    def call(self, operation: str, *, path_params: Optional[Mapping[str, Any]] = None, query: Optional[Mapping[str, Any]] = None, body: Any = None) -> Any:
        op = OPERATIONS.get(operation)
        if not op:
            raise KeyError(f"Unknown operation: {operation}")
        path = op["path"]
        for key, value in (path_params or {}).items():
            path = path.replace("{" + key + "}", quote(str(value), safe=""))
        return self.request(op["method"], path, query=query, body=body if op.get("has_body") else None)

    def get_health(self, query: Optional[Mapping[str, Any]] = None) -> Any:
        """Liveness + configuration probe"""
        return self.request("GET", "/health", query=query)

    def get_regions(self, query: Optional[Mapping[str, Any]] = None) -> Any:
        """List available regions"""
        return self.request("GET", "/regions", query=query)

    def get_images(self, query: Optional[Mapping[str, Any]] = None) -> Any:
        """List image catalog"""
        return self.request("GET", "/images", query=query)

    def post_images(self, body: Optional[Mapping[str, Any]] = None, query: Optional[Mapping[str, Any]] = None) -> Any:
        """Create / pull an image"""
        return self.request("POST", "/images", query=query, body=body)

    def get_machines(self, query: Optional[Mapping[str, Any]] = None) -> Any:
        """List machines"""
        return self.request("GET", "/machines", query=query)

    def post_machines(self, body: Optional[Mapping[str, Any]] = None, query: Optional[Mapping[str, Any]] = None) -> Any:
        """Create a machine"""
        return self.request("POST", "/machines", query=query, body=body)

    def get_machines_by_id(self, id: str, query: Optional[Mapping[str, Any]] = None) -> Any:
        """Get a single machine"""
        return self.request("GET", f"/machines/{quote(str(id), safe='')}", query=query)

    def patch_machines_by_id(self, id: str, body: Optional[Mapping[str, Any]] = None, query: Optional[Mapping[str, Any]] = None) -> Any:
        """Resize a machine in place"""
        return self.request("PATCH", f"/machines/{quote(str(id), safe='')}", query=query, body=body)

    def delete_machines_by_id(self, id: str, query: Optional[Mapping[str, Any]] = None) -> Any:
        """Delete a machine"""
        return self.request("DELETE", f"/machines/{quote(str(id), safe='')}", query=query)

    def post_machines_by_id_daemon_ensure(self, id: str, body: Optional[Mapping[str, Any]] = None, query: Optional[Mapping[str, Any]] = None) -> Any:
        """Install or repair the managed guest daemon"""
        return self.request("POST", f"/machines/{quote(str(id), safe='')}/daemon/ensure", query=query, body=body)

    def get_proxy_tokens(self, query: Optional[Mapping[str, Any]] = None) -> Any:
        """List active proxy tokens"""
        return self.request("GET", "/proxy-tokens", query=query)

    def post_proxy_tokens(self, body: Optional[Mapping[str, Any]] = None, query: Optional[Mapping[str, Any]] = None) -> Any:
        """Create a proxy token"""
        return self.request("POST", "/proxy-tokens", query=query, body=body)

    def delete_proxy_tokens_by_id(self, id: str, query: Optional[Mapping[str, Any]] = None) -> Any:
        """Revoke a proxy token"""
        return self.request("DELETE", f"/proxy-tokens/{quote(str(id), safe='')}", query=query)

    def get_ssh_tokens(self, query: Optional[Mapping[str, Any]] = None) -> Any:
        """List active SSH gateway tokens"""
        return self.request("GET", "/ssh-tokens", query=query)

    def post_ssh_tokens(self, body: Optional[Mapping[str, Any]] = None, query: Optional[Mapping[str, Any]] = None) -> Any:
        """Create an SSH gateway token"""
        return self.request("POST", "/ssh-tokens", query=query, body=body)

    def get_internal_ssh_validate(self, query: Optional[Mapping[str, Any]] = None) -> Any:
        """Validate SSH gateway token"""
        return self.request("GET", "/internal/ssh/validate", query=query)

    def post_machines_by_id_start(self, id: str, body: Optional[Mapping[str, Any]] = None, query: Optional[Mapping[str, Any]] = None) -> Any:
        """Start a machine"""
        return self.request("POST", f"/machines/{quote(str(id), safe='')}/start", query=query, body=body)

    def post_machines_by_id_stop(self, id: str, body: Optional[Mapping[str, Any]] = None, query: Optional[Mapping[str, Any]] = None) -> Any:
        """Stop a machine"""
        return self.request("POST", f"/machines/{quote(str(id), safe='')}/stop", query=query, body=body)

    def post_machines_by_id_reboot(self, id: str, body: Optional[Mapping[str, Any]] = None, query: Optional[Mapping[str, Any]] = None) -> Any:
        """Reboot a machine"""
        return self.request("POST", f"/machines/{quote(str(id), safe='')}/reboot", query=query, body=body)

    def get_machines_by_id_snapshots(self, id: str, query: Optional[Mapping[str, Any]] = None) -> Any:
        """List snapshots"""
        return self.request("GET", f"/machines/{quote(str(id), safe='')}/snapshots", query=query)

    def post_machines_by_id_snapshots(self, id: str, body: Optional[Mapping[str, Any]] = None, query: Optional[Mapping[str, Any]] = None) -> Any:
        """Create a snapshot"""
        return self.request("POST", f"/machines/{quote(str(id), safe='')}/snapshots", query=query, body=body)

    def post_machines_by_id_snapshots_by_name_restore(self, id: str, name: str, body: Optional[Mapping[str, Any]] = None, query: Optional[Mapping[str, Any]] = None) -> Any:
        """Restore a snapshot in place"""
        return self.request("POST", f"/machines/{quote(str(id), safe='')}/snapshots/{quote(str(name), safe='')}/restore", query=query, body=body)

    def delete_machines_by_id_snapshots_by_name(self, id: str, name: str, query: Optional[Mapping[str, Any]] = None) -> Any:
        """Delete a snapshot"""
        return self.request("DELETE", f"/machines/{quote(str(id), safe='')}/snapshots/{quote(str(name), safe='')}", query=query)

    def post_images_by_id_prewarm(self, id: str, body: Optional[Mapping[str, Any]] = None, query: Optional[Mapping[str, Any]] = None) -> Any:
        """Pre-warm the unpacked image cache"""
        return self.request("POST", f"/images/{quote(str(id), safe='')}/prewarm", query=query, body=body)

    def delete_images_by_id(self, id: str, query: Optional[Mapping[str, Any]] = None) -> Any:
        """Delete an image"""
        return self.request("DELETE", f"/images/{quote(str(id), safe='')}", query=query)

    def get_templates(self, query: Optional[Mapping[str, Any]] = None) -> Any:
        """List the curated image catalog"""
        return self.request("GET", "/templates", query=query)

    def delete_templates_cache_extras(self, query: Optional[Mapping[str, Any]] = None) -> Any:
        """Purge non-template images from every cluster cache"""
        return self.request("DELETE", "/templates/cache/extras", query=query)

    def get_machines_by_id_backups(self, id: str, query: Optional[Mapping[str, Any]] = None) -> Any:
        """List backups"""
        return self.request("GET", f"/machines/{quote(str(id), safe='')}/backups", query=query)

    def post_machines_by_id_backups(self, id: str, body: Optional[Mapping[str, Any]] = None, query: Optional[Mapping[str, Any]] = None) -> Any:
        """Create a backup"""
        return self.request("POST", f"/machines/{quote(str(id), safe='')}/backups", query=query, body=body)

    def post_machines_by_id_backups_by_name_restore(self, id: str, name: str, body: Optional[Mapping[str, Any]] = None, query: Optional[Mapping[str, Any]] = None) -> Any:
        """Restore a backup in place"""
        return self.request("POST", f"/machines/{quote(str(id), safe='')}/backups/{quote(str(name), safe='')}/restore", query=query, body=body)

    def delete_machines_by_id_backups_by_name(self, id: str, name: str, query: Optional[Mapping[str, Any]] = None) -> Any:
        """Delete a backup"""
        return self.request("DELETE", f"/machines/{quote(str(id), safe='')}/backups/{quote(str(name), safe='')}", query=query)

    def post_machines_by_id_exec(self, id: str, body: Optional[Mapping[str, Any]] = None, query: Optional[Mapping[str, Any]] = None) -> Any:
        """Execute a command inside a sandbox"""
        return self.request("POST", f"/machines/{quote(str(id), safe='')}/exec", query=query, body=body)

    def put_machines_by_id_files(self, id: str, body: Optional[Mapping[str, Any]] = None, query: Optional[Mapping[str, Any]] = None) -> Any:
        """Write a file inside the sandbox"""
        return self.request("PUT", f"/machines/{quote(str(id), safe='')}/files", query=query, body=body)

    def get_machines_by_id_files(self, id: str, query: Optional[Mapping[str, Any]] = None) -> Any:
        """Read a file or list a directory"""
        return self.request("GET", f"/machines/{quote(str(id), safe='')}/files", query=query)

    def delete_machines_by_id_files(self, id: str, query: Optional[Mapping[str, Any]] = None) -> Any:
        """Delete a file or directory inside the sandbox"""
        return self.request("DELETE", f"/machines/{quote(str(id), safe='')}/files", query=query)

