import { spawn } from 'node:child_process';

import dotenv from 'dotenv';

dotenv.config({ path: '../../.env', quiet: true });
dotenv.config({ path: '../../.env.local', override: true, quiet: true });

if (process.env.V2_DATABASE_URL && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.V2_DATABASE_URL;
}

const args = process.argv.slice(2);
const prismaBin = process.platform === 'win32' ? '.\\node_modules\\.bin\\prisma.cmd' : './node_modules/.bin/prisma';

const child = spawn(prismaBin, args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 1));
