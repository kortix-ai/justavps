// 04-snapshot-rollback.ts — proves snapshot/restore semantics.
// Take a snapshot of a clean state, mutate the sandbox, restore — the
// mutation must be gone.

import { done, log, withSandbox } from './_lib.js';

await withSandbox({}, async (id, client) => {
  log('snapshotting clean state as "base"…');
  await client.snapshots.create(id, { name: 'base' });

  log('writing a marker file the snapshot does NOT contain…');
  await client.files.write(id, { path: '/root/added-after-snap.txt', content: 'this should disappear after restore\n' });
  const before = await client.machines.exec(id, { command: 'cat /root/added-after-snap.txt' });
  if (before.exit_code !== 0) throw new Error('marker missing before restore — write failed');
  log('  marker present (good): ' + before.stdout.trim());

  log('restoring snapshot "base"…');
  await client.snapshots.restore(id, 'base');

  log('checking marker is gone…');
  const after = await client.machines.exec(id, { command: 'cat /root/added-after-snap.txt 2>&1; echo exit=$?' });
  process.stdout.write(after.stdout);
  if (!after.stdout.includes('No such file')) throw new Error('marker still present after restore — rollback BROKEN');
  log('  marker correctly absent ✓');
});

done('snapshot-rollback');
