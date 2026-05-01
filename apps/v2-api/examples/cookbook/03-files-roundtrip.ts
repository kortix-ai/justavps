// 03-files-roundtrip.ts — upload, mutate, download. Proves the file API
// handles both UTF-8 and binary content correctly.

import { randomBytes } from 'node:crypto';
import { done, log, withSandbox } from './_lib.js';

await withSandbox({}, async (id, client) => {
  log('writing /root/notes.md (utf-8)…');
  await client.files.write(id, {
    path: '/root/notes.md',
    content: '# JustAVPS roundtrip\n\nThis file came from the host via PUT /files.\n',
  });

  log('writing /root/payload.bin (1 KiB random binary)…');
  const blob = randomBytes(1024);
  await client.files.write(id, {
    path: '/root/payload.bin',
    content: blob.toString('base64'),
    encoding: 'base64',
  });

  log('mutating /root/notes.md from inside the sandbox…');
  const append = await client.machines.exec(id, {
    command: "echo '\\n## Mutated in-sandbox' >> /root/notes.md && wc -c /root/notes.md /root/payload.bin",
  });
  process.stdout.write(append.stdout);
  if (append.exit_code !== 0) throw new Error(`mutation failed (exit ${append.exit_code})`);

  log('reading both files back to the host…');
  const md = await client.files.read(id, '/root/notes.md') as { content: string };
  const bin = await client.files.read(id, '/root/payload.bin') as { content: string; encoding: string };
  log(`notes.md (${md.content.length} chars): ${md.content.slice(0, 80).replace(/\n/g, ' ')}…`);
  const bytes = Buffer.from(bin.content, bin.encoding === 'base64' ? 'base64' : 'utf8');
  if (!bytes.equals(blob)) throw new Error('binary roundtrip MISMATCH');
  log(`payload.bin survived the roundtrip (${bytes.length} bytes, byte-identical)`);
});

done('files-roundtrip');
