// Tiny shared bootstrap for cookbook recipes. Avoids each script repeating the
// "read env, build a client, set a try/finally cleanup" boilerplate.

import { JustAVPSV2, JustAVPSV2Error } from '../../sdk/index.js';

export function makeClient(): JustAVPSV2 {
  const baseUrl = process.env.JUSTAVPS_API_URL?.trim() || 'http://localhost:4200';
  const token = process.env.JUSTAVPS_TOKEN?.trim();
  if (!token) {
    process.stderr.write('Set JUSTAVPS_TOKEN (or run `pnpm justavps login`).\n');
    process.exit(1);
  }
  return new JustAVPSV2({ baseUrl, token });
}

export async function withSandbox<T>(opts: { image?: string; type?: 'container' | 'vm' }, fn: (id: string, client: JustAVPSV2) => Promise<T>): Promise<T> {
  const client = makeClient();
  const image = opts.image ?? 'justavps-ubuntu-24.04-template';
  const created = await client.machines.create({
    region: 'eu',
    type: opts.type ?? 'container',
    resources: { vcpu: 1, memory_gb: 1, disk_gb: 10 },
    source: { type: 'image', image_id: image },
  });
  const id = created.machine?.id;
  if (!id) throw new Error('create did not return a machine id');
  log(`sandbox ${id} created (image=${image})`);
  await client.machines.start(id);
  log(`sandbox ${id} started — running recipe…`);
  try {
    return await fn(id, client);
  } finally {
    await client.machines.delete(id).catch((error: unknown) => {
      log(`cleanup warning: ${error instanceof JustAVPSV2Error ? error.message : String(error)}`);
    });
    log(`sandbox ${id} deleted`);
  }
}

export function log(message: string) {
  const ts = new Date().toISOString().slice(11, 19);
  process.stdout.write(`[${ts}] ${message}\n`);
}

export function done(label: string) {
  log(`✓ ${label} done`);
}
