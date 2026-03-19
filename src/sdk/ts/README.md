# @kortix/justavps

Official TypeScript SDK for the [JustAVPS API](https://justavps.com/api/docs).

```bash
npm install @kortix/justavps
```

## Quick Start

```typescript
import { JustAVPS } from '@kortix/justavps';

const client = new JustAVPS({ apiKey: 'sk_live_...' });
```

## Machines

```typescript
// List machines
const { machines } = await client.machines.list();

// Create a machine
const machine = await client.machines.create({
  provider: 'cloud',
  server_type: 'cpx32',
  region: 'hel1',
  name: 'my-dev-box',
});

// Wait for it to be ready
const ready = await client.machines.waitForReady(machine.id);
console.log(`IP: ${ready.ip}`);

// Reboot / Resize / Delete
await client.machines.reboot(machine.id);
await client.machines.resize(machine.id, { server_type: 'cpx42' });
await client.machines.delete(machine.id);
```

## Toolbox: Filesystem

Read, write, search, and manage files on a running machine.

```typescript
const tb = client.toolbox(machine.id);

// List files
const { entries } = await tb.files.list('/root');
entries.forEach(e => console.log(`${e.type} ${e.mode_bits} ${e.name}`));

// Upload a file (auto-creates parent dirs)
await tb.files.upload('/root/app.py', 'print("hello")', { mode: '755' });

// Download a file
const content = await tb.files.download('/root/app.py');

// Check existence
const { exists, type } = await tb.files.exists('/root/app.py');

// File metadata
const info = await tb.files.info('/root/app.py');
console.log(`Size: ${info.size}, Owner: ${info.owner}`);

// Create directory (mkdir -p)
await tb.files.mkdir('/root/project/src');

// Search text in files (grep)
const { matches } = await tb.files.find('/root/project', 'TODO|FIXME', { include: '*.py' });
matches.forEach(m => console.log(`${m.file}:${m.line}: ${m.content}`));

// Find and replace
await tb.files.replace(['/root/app.py'], 'hello', 'goodbye');

// Move / rename
await tb.files.move('/root/app.py', '/root/main.py');

// Set permissions
await tb.files.chmod('/root/main.py', '755');

// Delete
await tb.files.remove('/root/main.py');

// Delete directory recursively
await tb.files.remove('/root/project', true);
```

## Toolbox: Process

Execute commands, run code, and manage processes on a running machine.

```typescript
const tb = client.toolbox(machine.id);

// Execute a shell command
const result = await tb.process.exec('ls -la /root');
console.log(`Exit: ${result.exit_code}`);
console.log(result.stdout);

// Execute with cwd, timeout, env vars
const build = await tb.process.exec('npm install && npm run build', {
  cwd: '/root/project',
  timeout: 120,
  env: { NODE_ENV: 'production' },
});

// Run a code snippet (auto-detects language)
const py = await tb.process.codeRun('print(2 + 2)', 'python');
console.log(py.stdout); // "4\n"

const js = await tb.process.codeRun('console.log(JSON.stringify({ok: true}))', 'node');

// List running processes
const { processes } = await tb.process.list();
processes.forEach(p => console.log(`PID ${p.pid}: ${p.command}`));

// Kill a process
await tb.process.kill(1234, 'SIGTERM');
```

## Images

```typescript
// Create an image from a running machine
const image = await client.machines.createImage(machine.id, { name: 'my-snapshot' });

// List / delete images
const { images } = await client.images.list();
await client.images.delete(image.id);
```

## SSH Keys, API Keys, Webhooks

```typescript
// SSH Keys
const { ssh_keys } = await client.sshKeys.list();
const key = await client.sshKeys.create({ name: 'laptop', public_key: 'ssh-ed25519 ...' });
await client.sshKeys.delete(key.id);

// API Keys
const { api_keys } = await client.apiKeys.list();
const apiKey = await client.apiKeys.create({ name: 'ci-deploy' });
await client.apiKeys.delete(apiKey.id);

// Webhooks
const webhook = await client.webhooks.create({
  url: 'https://example.com/hook',
  events: ['machine.ready', 'machine.deleted'],
});
await client.webhooks.delete(webhook.id);
```

## Server Types

```typescript
const { providers } = await client.serverTypes.providers();
const { regions } = await client.serverTypes.regions('cloud');
const { server_types } = await client.serverTypes.list('hel1');
server_types.forEach(t =>
  console.log(`${t.name}: ${t.cores} vCPU, ${t.memory}GB, $${t.price_monthly}/mo`)
);
```

## SSE Streaming

```typescript
// Stream machine status updates
for await (const event of client.machines.stream(machine.id)) {
  console.log(`${event.type}: ${JSON.stringify(event.data)}`);
  if (event.type === 'done') break;
}

// Stream command output
for await (const event of client.toolbox(machine.id).process.stream('npm run build')) {
  if (event.type === 'stdout') process.stdout.write(event.data.data);
  if (event.type === 'stderr') process.stderr.write(event.data.data);
}
```

## Auto-Generated Client

The ergonomic wrapper above delegates to an auto-generated client. You can use it directly for full type safety:

```typescript
import {
  getApiV1Machines,
  postApiV1MachinesByMachineIdToolboxProcessExecute,
} from '@kortix/justavps/generated';
```

## API Reference

Full interactive docs: **[justavps.com/api/docs](https://justavps.com/api/docs)**
