import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type OpenApi = {
  info?: { title?: string; version?: string };
  paths: Record<string, Record<string, { summary?: string; description?: string; tags?: string[]; requestBody?: unknown }>>;
};

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const spec = JSON.parse(readFileSync(resolve(root, 'sdk/openapi.json'), 'utf8')) as OpenApi;
const outDir = resolve(root, 'sdk/python');
const packageDir = resolve(outDir, 'justavps_v2');

const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete']);
const reserved = new Set(['from', 'class', 'def', 'pass', 'global', 'async', 'await', 'None', 'True', 'False']);

function snake(value: string) {
  const cleaned = value
    .replace(/[{}]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  const base = cleaned || 'value';
  return reserved.has(base) ? `${base}_` : base;
}

function functionName(method: string, path: string) {
  const parts = path.split('/').filter(Boolean).map((part) => part.startsWith('{') ? `by_${snake(part)}` : snake(part));
  return snake([method, ...parts].join('_'));
}

function pathParams(path: string) {
  return [...path.matchAll(/{([^}]+)}/g)].map((m) => snake(m[1]));
}

function pythonPathExpression(path: string) {
  const rawParts = path.split(/({[^}]+})/g).filter(Boolean);
  if (!rawParts.some((p) => p.startsWith('{'))) return JSON.stringify(path);
  const body = rawParts.map((part) => {
    if (!part.startsWith('{')) return part.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const name = snake(part.slice(1, -1));
    return `{quote(str(${name}), safe='')}`;
  }).join('');
  return `f"${body}"`;
}

function pyDoc(summary?: string, description?: string) {
  const text = (summary || description || '').replace(/"""/g, '\"\"\"').trim();
  return text ? `        """${text}"""\n` : '';
}

const operations = Object.entries(spec.paths).flatMap(([path, item]) => Object.entries(item)
  .filter(([method]) => httpMethods.has(method))
  .map(([method, op]) => ({
    method: method.toUpperCase(),
    path,
    name: functionName(method, path),
    summary: op.summary,
    description: op.description,
    tags: op.tags ?? [],
    hasBody: Boolean(op.requestBody) || ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase()),
    params: pathParams(path),
  })));

const methodBlocks = operations.map((op) => {
  const params = [...op.params.map((p) => `${p}: str`), 'query: Optional[Mapping[str, Any]] = None'];
  if (op.hasBody) params.splice(op.params.length, 0, 'body: Optional[Mapping[str, Any]] = None');
  const argList = params.length ? `, ${params.join(', ')}` : '';
  const bodyArg = op.hasBody ? ', body=body' : '';
  return `    def ${op.name}(self${argList}) -> Any:\n${pyDoc(op.summary, op.description)}        return self.request("${op.method}", ${pythonPathExpression(op.path)}, query=query${bodyArg})\n`;
}).join('\n');

const operationsLiteral = JSON.stringify(Object.fromEntries(operations.map((op) => [op.name, {
  method: op.method,
  path: op.path,
  summary: op.summary ?? '',
  tags: op.tags,
  has_body: op.hasBody,
}])) , null, 2);

mkdirSync(packageDir, { recursive: true });
writeFileSync(resolve(packageDir, '__init__.py'), `from .client import JustAVPSV2, JustAVPSV2Error, OPERATIONS\n\n__all__ = ["JustAVPSV2", "JustAVPSV2Error", "OPERATIONS"]\n`);
writeFileSync(resolve(packageDir, 'client.py'), `# This file is auto-generated from sdk/openapi.json. Do not edit by hand.\nfrom __future__ import annotations\n\nimport json\nfrom typing import Any, Mapping, Optional\nfrom urllib.parse import quote, urlencode\nfrom urllib.request import Request, urlopen\nfrom urllib.error import HTTPError\n\nOPERATIONS = json.loads(${JSON.stringify(operationsLiteral)})\n\n\nclass JustAVPSV2Error(Exception):\n    def __init__(self, message: str, status: Optional[int] = None, body: Any = None) -> None:\n        super().__init__(message)\n        self.status = status\n        self.body = body\n\n\nclass JustAVPSV2:\n    def __init__(self, base_url: str = "http://localhost:4200", token: Optional[str] = None, timeout: int = 60) -> None:\n        self.base_url = base_url.rstrip("/")\n        self.token = token\n        self.timeout = timeout\n\n    def request(self, method: str, path: str, *, query: Optional[Mapping[str, Any]] = None, body: Any = None) -> Any:\n        url = self.base_url + path\n        if query:\n            compact = {k: v for k, v in query.items() if v is not None}\n            if compact:\n                url += "?" + urlencode(compact, doseq=True)\n        payload = None if body is None else json.dumps(body).encode("utf-8")\n        headers = {"Accept": "application/json"}\n        if payload is not None:\n            headers["Content-Type"] = "application/json"\n        if self.token:\n            headers["Authorization"] = f"Bearer {self.token}"\n        req = Request(url, data=payload, headers=headers, method=method.upper())\n        try:\n            with urlopen(req, timeout=self.timeout) as response:\n                data = response.read()\n                if not data:\n                    return None\n                return json.loads(data.decode("utf-8"))\n        except HTTPError as error:\n            raw = error.read().decode("utf-8", errors="replace")\n            try:\n                body_obj = json.loads(raw) if raw else None\n            except Exception:\n                body_obj = raw\n            raise JustAVPSV2Error(f"{error.code} {error.reason}", error.code, body_obj) from None\n\n    def call(self, operation: str, *, path_params: Optional[Mapping[str, Any]] = None, query: Optional[Mapping[str, Any]] = None, body: Any = None) -> Any:\n        op = OPERATIONS.get(operation)\n        if not op:\n            raise KeyError(f"Unknown operation: {operation}")\n        path = op["path"]\n        for key, value in (path_params or {}).items():\n            path = path.replace("{" + key + "}", quote(str(value), safe=""))\n        return self.request(op["method"], path, query=query, body=body if op.get("has_body") else None)\n\n${methodBlocks}\n`);
writeFileSync(resolve(outDir, 'pyproject.toml'), `[build-system]\nrequires = ["setuptools>=68", "wheel"]\nbuild-backend = "setuptools.build_meta"\n\n[project]\nname = "kortix-justavps-v2"\nversion = "0.0.0"\ndescription = "OpenAPI-generated Python SDK for the JustAVPS V2 API"\nrequires-python = ">=3.9"\nreadme = "README.md"\n\n[tool.setuptools.packages.find]\nwhere = ["."]\ninclude = ["justavps_v2*"]\n`);
writeFileSync(resolve(outDir, 'README.md'), `# kortix-justavps-v2\n\nOpenAPI-generated Python SDK for the JustAVPS V2 API.\n\n\`\`\`python\nfrom justavps_v2 import JustAVPSV2\n\nclient = JustAVPSV2(base_url="http://localhost:4200", token="...")\nprint(client.get_machines())\nprint(client.post_machines_by_id_exec("machine-id", body={"command": "uname -a"}))\n\`\`\`\n`);

console.log(`generated Python SDK with ${operations.length} operations -> ${outDir}`);
