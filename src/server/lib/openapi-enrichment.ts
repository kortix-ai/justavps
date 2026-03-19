/**
 * OpenAPI spec enrichment — adds x-codeSamples (SDK examples),
 * x-scalar-sdk-installation, x-tagGroups, and x-scalar-ignore
 * to the generated OpenAPI spec for Scalar rendering.
 *
 * This runs as a post-processing step on the spec JSON.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

type CodeSample = { lang: string; label: string; source: string };

// ─── SDK code samples per operation (operationId → samples) ─────────────────

// Helper to generate operation key from method + path
function opKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

const SDK_SAMPLES: Record<string, CodeSample[]> = {
  // ── Machines ──────────────────────────────────────────────────────
  'GET /api/v1/machines': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `import { JustAVPS } from "@kortix/justavps";

const client = new JustAVPS({ apiKey: "sk_live_..." });
const { machines } = await client.machines.list();
console.log(machines);` },
    { lang: 'Python', label: 'Python SDK', source: `from justavps import JustAVPS

client = JustAVPS("sk_live_...")
machines = client.machines.list()
print(machines)` },
  ],

  'POST /api/v1/machines': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `const machine = await client.machines.create({
  server_type: "cpx32",
  region: "hel1",
  name: "my-dev-box",
});
console.log(machine.id, machine.slug);` },
    { lang: 'Python', label: 'Python SDK', source: `machine = client.machines.create(
    server_type="cpx32",
    region="hel1",
    name="my-dev-box",
)
print(machine["id"], machine["slug"])` },
  ],

  'GET /api/v1/machines/{id}': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `const machine = await client.machines.get("machine-id");
console.log(machine.status, machine.ip);` },
    { lang: 'Python', label: 'Python SDK', source: `machine = client.machines.get("machine-id")
print(machine["status"], machine["ip"])` },
  ],

  'DELETE /api/v1/machines/{id}': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `await client.machines.delete("machine-id");` },
    { lang: 'Python', label: 'Python SDK', source: `client.machines.delete("machine-id")` },
  ],

  'POST /api/v1/machines/{id}/reboot': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `await client.machines.reboot("machine-id");` },
    { lang: 'Python', label: 'Python SDK', source: `client.machines.reboot("machine-id")` },
  ],

  'POST /api/v1/machines/{id}/resize': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `await client.machines.resize("machine-id", { server_type: "cpx42" });` },
    { lang: 'Python', label: 'Python SDK', source: `client.machines.resize("machine-id", server_type="cpx42")` },
  ],

  'POST /api/v1/machines/{id}/image': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `const image = await client.machines.createImage("machine-id", { name: "my-snapshot" });
console.log(image.id);` },
    { lang: 'Python', label: 'Python SDK', source: `image = client.machines.create_image("machine-id", name="my-snapshot")
print(image["id"])` },
  ],

  'GET /api/v1/machines/{id}/status/stream': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `for await (const event of client.machines.stream("machine-id")) {
  console.log(event.type, event.data);
  if (event.type === "done") break;
}` },
  ],

  // ── Images ────────────────────────────────────────────────────────
  'GET /api/v1/images': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `const { images } = await client.images.list();` },
    { lang: 'Python', label: 'Python SDK', source: `images = client.images.list()` },
  ],

  'GET /api/v1/images/{id}': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `const image = await client.images.get("image-id");` },
    { lang: 'Python', label: 'Python SDK', source: `image = client.images.get("image-id")` },
  ],

  'DELETE /api/v1/images/{id}': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `await client.images.delete("image-id");` },
    { lang: 'Python', label: 'Python SDK', source: `client.images.delete("image-id")` },
  ],

  // ── SSH Keys ──────────────────────────────────────────────────────
  'GET /api/v1/ssh-keys': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `const { ssh_keys } = await client.sshKeys.list();` },
    { lang: 'Python', label: 'Python SDK', source: `keys = client.ssh_keys.list()` },
  ],

  'POST /api/v1/ssh-keys': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `const key = await client.sshKeys.create({
  name: "my-laptop",
  public_key: "ssh-ed25519 AAAA...",
});` },
    { lang: 'Python', label: 'Python SDK', source: `key = client.ssh_keys.create("my-laptop", "ssh-ed25519 AAAA...")` },
  ],

  'DELETE /api/v1/ssh-keys/{id}': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `await client.sshKeys.delete("key-id");` },
    { lang: 'Python', label: 'Python SDK', source: `client.ssh_keys.delete("key-id")` },
  ],

  // ── API Keys ──────────────────────────────────────────────────────
  'GET /api/v1/api-keys': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `const { api_keys } = await client.apiKeys.list();` },
    { lang: 'Python', label: 'Python SDK', source: `keys = client.api_keys.list()` },
  ],

  'POST /api/v1/api-keys': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `const key = await client.apiKeys.create({ name: "ci-deploy" });
console.log(key.key); // Only shown once!` },
    { lang: 'Python', label: 'Python SDK', source: `key = client.api_keys.create("ci-deploy")
print(key["key"])  # Only shown once!` },
  ],

  'DELETE /api/v1/api-keys/{id}': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `await client.apiKeys.delete("key-id");` },
    { lang: 'Python', label: 'Python SDK', source: `client.api_keys.delete("key-id")` },
  ],

  // ── Webhooks ──────────────────────────────────────────────────────
  'GET /api/v1/webhooks': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `const { webhooks } = await client.webhooks.list();` },
    { lang: 'Python', label: 'Python SDK', source: `hooks = client.webhooks.list()` },
  ],

  'POST /api/v1/webhooks': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `const webhook = await client.webhooks.create({
  url: "https://example.com/hook",
  events: ["machine.ready", "machine.deleted"],
});` },
    { lang: 'Python', label: 'Python SDK', source: `hook = client.webhooks.create(
    "https://example.com/hook",
    ["machine.ready", "machine.deleted"],
)` },
  ],

  'DELETE /api/v1/webhooks/{id}': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `await client.webhooks.delete("webhook-id");` },
    { lang: 'Python', label: 'Python SDK', source: `client.webhooks.delete("webhook-id")` },
  ],

  // ── Server Types ──────────────────────────────────────────────────
  'GET /api/v1/server-types': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `const { server_types } = await client.serverTypes.list("hel1");` },
    { lang: 'Python', label: 'Python SDK', source: `types = client.server_types.list("hel1")` },
  ],

  'GET /api/v1/server-types/providers': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `const { providers } = await client.serverTypes.providers();` },
    { lang: 'Python', label: 'Python SDK', source: `providers = client.server_types.providers()` },
  ],

  'GET /api/v1/server-types/regions': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `const { regions } = await client.serverTypes.regions();` },
    { lang: 'Python', label: 'Python SDK', source: `regions = client.server_types.regions()` },
  ],

  // ── Account ───────────────────────────────────────────────────────
  'GET /api/v1/account': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `const account = await client.account.get();` },
  ],

  'GET /api/v1/account/usage': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `const usage = await client.account.usage();` },
  ],

  'GET /api/v1/account/billing': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `const billing = await client.account.billing();` },
  ],

  // ── Toolbox: Filesystem ───────────────────────────────────────────
  'GET /api/v1/machines/{machineId}/toolbox/files': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `const tb = client.toolbox("machine-id");
const { entries } = await tb.files.list("/root");
entries.forEach(e => console.log(e.type, e.name, e.size));` },
    { lang: 'Python', label: 'Python SDK', source: `tb = client.toolbox("machine-id")
entries = tb.files.list("/root")
for e in entries:
    print(e["type"], e["name"], e["size"])` },
  ],

  'GET /api/v1/machines/{machineId}/toolbox/files/info': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `const info = await tb.files.info("/root/app.py");
console.log(info.size, info.owner, info.mode_bits);` },
    { lang: 'Python', label: 'Python SDK', source: `info = tb.files.info("/root/app.py")
print(info["size"], info["owner"], info["mode_bits"])` },
  ],

  'GET /api/v1/machines/{machineId}/toolbox/files/exists': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `const { exists, type } = await tb.files.exists("/root/app.py");` },
    { lang: 'Python', label: 'Python SDK', source: `result = tb.files.exists("/root/app.py")
print(result["exists"], result["type"])` },
  ],

  'GET /api/v1/machines/{machineId}/toolbox/files/download': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `// Text file
const content = await tb.files.download("/root/app.py");

// Binary file
const bytes = await tb.files.downloadBytes("/root/image.png");` },
    { lang: 'Python', label: 'Python SDK', source: `# Text file
content = tb.files.download("/root/app.py")

# Binary file
data = tb.files.download_bytes("/root/image.png")` },
  ],

  'POST /api/v1/machines/{machineId}/toolbox/files/upload': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `await tb.files.upload("/root/app.py", 'print("hello")', { mode: "755" });` },
    { lang: 'Python', label: 'Python SDK', source: `tb.files.upload("/root/app.py", 'print("hello")', mode="755")` },
  ],

  'POST /api/v1/machines/{machineId}/toolbox/files/folder': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `await tb.files.mkdir("/root/project/src");` },
    { lang: 'Python', label: 'Python SDK', source: `tb.files.mkdir("/root/project/src")` },
  ],

  'DELETE /api/v1/machines/{machineId}/toolbox/files': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `// Delete file
await tb.files.remove("/root/old.txt");

// Delete directory recursively
await tb.files.remove("/root/project", true);` },
    { lang: 'Python', label: 'Python SDK', source: `# Delete file
tb.files.remove("/root/old.txt")

# Delete directory recursively
tb.files.remove("/root/project", recursive=True)` },
  ],

  'POST /api/v1/machines/{machineId}/toolbox/files/move': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `await tb.files.move("/root/old.py", "/root/new.py");` },
    { lang: 'Python', label: 'Python SDK', source: `tb.files.move("/root/old.py", "/root/new.py")` },
  ],

  'GET /api/v1/machines/{machineId}/toolbox/files/find': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `const { matches } = await tb.files.find("/root/project", "TODO|FIXME", {
  include: "*.py",
  maxResults: 50,
});
matches.forEach(m => console.log(\`\${m.file}:\${m.line}: \${m.content}\`));` },
    { lang: 'Python', label: 'Python SDK', source: `result = tb.files.find("/root/project", r"TODO|FIXME", include="*.py")
for m in result["matches"]:
    print(f"{m['file']}:{m['line']}: {m['content']}")` },
  ],

  'POST /api/v1/machines/{machineId}/toolbox/files/replace': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `const result = await tb.files.replace(
  ["/root/app.py", "/root/utils.py"],
  "old_function",
  "new_function",
);
console.log(result.results); // [{ file, replacements }]` },
    { lang: 'Python', label: 'Python SDK', source: `result = tb.files.replace(
    ["/root/app.py", "/root/utils.py"],
    "old_function",
    "new_function",
)
print(result["results"])` },
  ],

  'POST /api/v1/machines/{machineId}/toolbox/files/permissions': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `await tb.files.chmod("/root/script.sh", "755");` },
    { lang: 'Python', label: 'Python SDK', source: `tb.files.chmod("/root/script.sh", "755")` },
  ],

  'POST /api/v1/machines/{machineId}/toolbox/files/bulk-download': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `// Returns a zip archive — use the REST API directly
const res = await fetch(\`\${baseUrl}/machines/\${id}/toolbox/files/bulk-download\`, {
  method: "POST",
  headers: { Authorization: "Bearer sk_live_...", "Content-Type": "application/json" },
  body: JSON.stringify({ paths: ["/root/a.txt", "/root/b.txt"] }),
});
const zip = await res.arrayBuffer();` },
  ],

  // ── Toolbox: Process ──────────────────────────────────────────────
  'POST /api/v1/machines/{machineId}/toolbox/process/execute': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `const result = await tb.process.exec("ls -la /root", {
  cwd: "/root/project",
  timeout: 30,
  env: { NODE_ENV: "production" },
});
console.log(result.exit_code, result.stdout);` },
    { lang: 'Python', label: 'Python SDK', source: `result = tb.process.exec("ls -la /root",
    cwd="/root/project",
    timeout=30,
    env={"NODE_ENV": "production"},
)
print(result["exit_code"], result["stdout"])` },
  ],

  'POST /api/v1/machines/{machineId}/toolbox/process/execute/stream': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `for await (const event of tb.process.stream("npm run build")) {
  if (event.type === "stdout") process.stdout.write(event.data.data);
  if (event.type === "stderr") process.stderr.write(event.data.data);
  if (event.type === "exit") console.log("Exit:", event.data.exit_code);
}` },
  ],

  'POST /api/v1/machines/{machineId}/toolbox/process/code-run': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `// Python
const py = await tb.process.codeRun("print(6 * 7)", "python");
console.log(py.stdout); // "42\\n"

// Node.js
const js = await tb.process.codeRun("console.log({ok: true})", "node");

// Auto-detect language
const auto = await tb.process.codeRun("print('hello')");` },
    { lang: 'Python', label: 'Python SDK', source: `# Python
result = tb.process.code_run("print(6 * 7)", language="python")
print(result["stdout"])  # "42\\n"

# Node.js
result = tb.process.code_run("console.log({ok: true})", language="node")

# Auto-detect language
result = tb.process.code_run("print('hello')")` },
  ],

  'GET /api/v1/machines/{machineId}/toolbox/process/list': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `const { processes } = await tb.process.list();
processes.forEach(p => console.log(\`PID \${p.pid}: \${p.command}\`));` },
    { lang: 'Python', label: 'Python SDK', source: `processes = tb.process.list()
for p in processes:
    print(f"PID {p['pid']}: {p['command']}")` },
  ],

  'POST /api/v1/machines/{machineId}/toolbox/process/kill': [
    { lang: 'JavaScript', label: 'TypeScript SDK', source: `await tb.process.kill(1234, "SIGTERM");` },
    { lang: 'Python', label: 'Python SDK', source: `tb.process.kill(1234, signal="SIGTERM")` },
  ],
};

/**
 * Enriches the OpenAPI spec with SDK code samples, installation instructions,
 * tag groups, and hides internal endpoints.
 */
export function enrichOpenAPISpec(spec: any): any {
  // 1. Add SDK installation instructions
  spec.info['x-scalar-sdk-installation'] = [
    {
      lang: 'Node',
      description: 'Install the official **TypeScript SDK**:',
      source: 'npm install @kortix/justavps',
    },
    {
      lang: 'Python',
      description: 'Install the official **Python SDK**:',
      source: 'pip install kortix-justavps',
    },
  ];

  // 2. Group tags
  spec['x-tagGroups'] = [
    { name: 'Machines & Infrastructure', tags: ['Machines', 'Images', 'Server Types'] },
    { name: 'Toolbox', tags: ['Toolbox: Filesystem', 'Toolbox: Process'] },
    { name: 'Authentication & Access', tags: ['API Keys', 'SSH Keys'] },
    { name: 'Integrations', tags: ['Webhooks'] },
    { name: 'Account', tags: ['Account'] },
    { name: 'Internal', tags: ['Internal'] },
  ];

  // 3. Hide Internal tag
  if (spec.tags) {
    for (const tag of spec.tags) {
      if (tag.name === 'Internal') {
        tag['x-scalar-ignore'] = true;
      }
    }
  }

  // 4. Add x-codeSamples to every operation
  for (const [path, methods] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(methods as any)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;

      const key = opKey(method, path);
      const samples = SDK_SAMPLES[key];
      if (samples) {
        (operation as any)['x-codeSamples'] = samples;
      }
    }
  }

  return spec;
}
