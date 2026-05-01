// 02-python-data-analysis.ts — run a real Python data-analysis workload.
// Mirrors E2B's "code interpreter" / Daytona's "data analysis with AI" recipe:
// install pandas + numpy, generate a synthetic dataset, compute a summary,
// write the resulting CSV inside the sandbox, and pull it back to the host.

import { writeFileSync } from 'node:fs';
import { done, log, withSandbox } from './_lib.js';

await withSandbox({}, async (id, client) => {
  log('installing python + pandas + numpy (one-shot)…');
  const install = await client.machines.exec(id, {
    command: 'apt-get update -qq && apt-get install -y -qq python3-pip python3-venv >/dev/null && python3 -m venv /opt/venv && /opt/venv/bin/pip install -q pandas numpy',
    timeout_ms: 5 * 60 * 1000,
  });
  if (install.exit_code !== 0) {
    process.stderr.write(install.stderr);
    throw new Error(`install failed (exit ${install.exit_code})`);
  }

  // Write the analysis script into the sandbox via the file API — simpler
  // than escaping multi-line shell.
  const script = `
import pandas as pd, numpy as np
rng = np.random.default_rng(42)
df = pd.DataFrame({
    'group': rng.choice(['a','b','c','d'], size=10_000),
    'value': rng.normal(loc=100, scale=15, size=10_000),
})
summary = df.groupby('group')['value'].agg(['count','mean','std','min','max']).round(2)
summary.to_csv('/root/summary.csv')
print(summary.to_string())
`;
  await client.files.write(id, { path: '/root/analysis.py', content: script });

  log('running analysis…');
  const run = await client.machines.exec(id, { command: '/opt/venv/bin/python /root/analysis.py' });
  process.stdout.write(run.stdout);
  if (run.exit_code !== 0) {
    process.stderr.write(run.stderr);
    throw new Error(`analysis failed (exit ${run.exit_code})`);
  }

  log('pulling /root/summary.csv back to the host…');
  const file = await client.files.read(id, '/root/summary.csv');
  if ('content' in file && typeof file.content === 'string') {
    writeFileSync('/tmp/justavps-summary.csv', file.content);
    log('wrote /tmp/justavps-summary.csv');
  }
});

done('python-data-analysis');
