// 01-hello-world.ts — the simplest possible JustAVPS recipe.
// Create a sandbox, exec a command, exit.

import { done, log, withSandbox } from './_lib.js';

await withSandbox({}, async (id, client) => {
  const result = await client.machines.exec(id, { command: 'echo hello from $(hostname) && uname -a && id' });
  log('exit_code=' + result.exit_code);
  process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.exit_code !== 0) process.exit(1);
});

done('hello-world');
