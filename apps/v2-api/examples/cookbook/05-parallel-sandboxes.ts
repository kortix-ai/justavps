// 05-parallel-sandboxes.ts — fan out N sandboxes in parallel, run a workload
// on each, collect the results, tear them all down. Demonstrates the kind of
// pool-style usage E2B/Daytona target for AI evals + map-reduce workloads.

import { makeClient, log } from './_lib.js';

const N = Number(process.env.JUSTAVPS_FANOUT || 5);
const client = makeClient();

const created: string[] = [];
const results: Array<{ id: string; out: string; ms: number }> = [];

async function spawnAndWork(idx: number) {
  const start = Date.now();
  const m = await client.machines.create({
    region: 'eu',
    type: 'container',
    name: `bench-pool-${idx}-${Math.random().toString(36).slice(2, 6)}`,
    resources: { vcpu: 1, memory_gb: 1, disk_gb: 10 },
    source: { type: 'image', image_id: 'justavps-ubuntu-24.04-template' },
  });
  const id = m.machine.id;
  created.push(id);
  await client.machines.start(id);
  const result = await client.machines.exec(id, {
    command: `echo worker=${idx} host=$(hostname) random=$RANDOM date=$(date +%s%3N)`,
  });
  results.push({ id, out: result.stdout.trim(), ms: Date.now() - start });
}

try {
  log(`spawning ${N} sandboxes in parallel…`);
  await Promise.all(Array.from({ length: N }, (_, i) => spawnAndWork(i)));
  for (const r of results) log(`  ${r.id} (${r.ms}ms): ${r.out}`);
  log(`✓ ${N} sandboxes completed`);
} finally {
  log('cleaning up…');
  await Promise.all(created.map((id) => client.machines.delete(id).catch(() => undefined)));
  log(`deleted ${created.length} sandboxes`);
}
