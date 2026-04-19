#!/usr/bin/env npx tsx
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-expressions */
/**
 * JustAVPS TypeScript SDK — Comprehensive E2E Test
 *
 * Tests every single method on the ergonomic SDK wrapper against a live VPS.
 *
 * Usage:
 *   API_KEY=sk_live_xxx MACHINE_ID=xxx npx tsx src/sdk/ts/e2e.test.ts
 *   API_KEY=sk_live_xxx MACHINE_ID=xxx BASE_URL=http://localhost:4100/api/v1 npx tsx src/sdk/ts/e2e.test.ts
 */

import { JustAVPS, JustAVPSError } from './client';

const API_KEY = process.env.API_KEY;
const MACHINE_ID = process.env.MACHINE_ID;
const BASE_URL = process.env.BASE_URL || 'http://localhost:4100/api/v1';

if (!API_KEY || !MACHINE_ID) {
  console.error('Usage: API_KEY=sk_live_xxx MACHINE_ID=xxx npx tsx src/sdk/ts/e2e.test.ts');
  process.exit(1);
}

const client = new JustAVPS({ apiKey: API_KEY, baseUrl: BASE_URL });
const TEST_DIR = '/tmp/ts-sdk-e2e-' + Date.now();

let pass = 0, fail = 0;
function ok(name: string) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
function no(name: string, detail?: string) { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` (${detail})` : ''}`); }

function assert(cond: boolean, name: string, detail?: string) {
  cond ? ok(name) : no(name, detail);
}

async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); } catch (e: any) { no(name, e.message); }
}

// ═══════════════════════════════════════════════════════════════════════

async function main() {
  console.log('\n\x1b[36m═══════════════════════════════════════════════════════════\x1b[0m');
  console.log('\x1b[36m  TypeScript SDK — E2E Test\x1b[0m');
  console.log(`\x1b[36m  Base: \x1b[1m${BASE_URL}\x1b[0m`);
  console.log(`\x1b[36m  Machine: \x1b[1m${MACHINE_ID}\x1b[0m`);
  console.log('\x1b[36m═══════════════════════════════════════════════════════════\x1b[0m\n');

  // ── client.machines ──────────────────────────────────────────────────
  console.log('\x1b[36m[SDK]\x1b[0m \x1b[1mMachines\x1b[0m');

  await test('machines.list()', async () => {
    const { machines } = await client.machines.list();
    assert(Array.isArray(machines), 'machines.list() returns array');
    assert(machines.length >= 1, `machines.list() has ${machines.length} machines`);
    const m = machines[0];
    assert(typeof m.id === 'string', 'machine has id');
    assert(typeof m.slug === 'string', 'machine has slug');
    assert(typeof m.status === 'string', 'machine has status');
  });

  await test('machines.get()', async () => {
    const m = await client.machines.get(MACHINE_ID!);
    assert(m.id === MACHINE_ID, `machines.get() returns correct id`);
    assert(typeof m.ip === 'string' && m.ip.length > 0, `machine has ip: ${m.ip}`);
    assert(m.status === 'ready', `machine status is ready`);
  });

  // ── client.serverTypes ───────────────────────────────────────────────
  console.log('\n\x1b[36m[SDK]\x1b[0m \x1b[1mServer Types\x1b[0m');

  await test('serverTypes.providers()', async () => {
    const { providers } = await client.serverTypes.providers();
    assert(Array.isArray(providers), 'providers is array');
    assert(providers.length >= 1, `has ${providers.length} providers`);
  });

  await test('serverTypes.regions()', async () => {
    const { regions } = await client.serverTypes.regions();
    assert(Array.isArray(regions), 'regions is array');
    assert(regions.length >= 1, `has ${regions.length} regions`);
  });

  await test('serverTypes.list()', async () => {
    const result = await client.serverTypes.list('hel1');
    assert(Array.isArray(result.server_types), 'server_types is array');
    assert(result.server_types.length >= 1, `has ${result.server_types.length} server types`);
  });

  // ── client.images ────────────────────────────────────────────────────
  console.log('\n\x1b[36m[SDK]\x1b[0m \x1b[1mImages\x1b[0m');

  await test('images.list()', async () => {
    const { images } = await client.images.list();
    assert(Array.isArray(images), 'images.list() returns array');
  });

  // ── Toolbox: Filesystem ──────────────────────────────────────────────
  console.log('\n\x1b[36m[SDK]\x1b[0m \x1b[1mToolbox: Filesystem\x1b[0m');
  const tb = client.toolbox(MACHINE_ID!);

  // mkdir
  await test('files.mkdir()', async () => {
    const r = await tb.files.mkdir(TEST_DIR);
    assert(r.created === true, 'mkdir created=true');
  });

  await test('files.mkdir() nested', async () => {
    const r = await tb.files.mkdir(`${TEST_DIR}/a/b/c`, '700');
    assert(r.created === true, 'nested mkdir');
  });

  await test('files.mkdir() already exists', async () => {
    const r = await tb.files.mkdir(TEST_DIR);
    assert(r.created === false, 'already exists → created=false');
  });

  // upload
  await test('files.upload() text', async () => {
    const r = await tb.files.upload(`${TEST_DIR}/hello.txt`, 'Hello SDK!');
    assert(r.size === 10, `upload size=${r.size}`);
    assert(r.name === 'hello.txt', `upload name=${r.name}`);
  });

  await test('files.upload() with mode', async () => {
    const r = await tb.files.upload(`${TEST_DIR}/exec.sh`, '#!/bin/bash\necho hi', { mode: '755' });
    assert(r.size > 0, `upload with mode size=${r.size}`);
  });

  await test('files.upload() overwrite=false', async () => {
    try {
      await tb.files.upload(`${TEST_DIR}/hello.txt`, 'nope', { overwrite: false });
      no('upload overwrite=false', 'should have thrown');
    } catch (e: any) {
      assert(e.status === 409, 'overwrite=false → 409');
    }
  });

  await test('files.upload() auto-create parents', async () => {
    const r = await tb.files.upload(`${TEST_DIR}/deep/nested/file.txt`, 'deep');
    assert(r.size === 4, 'auto-create parents');
  });

  // download
  await test('files.download() text', async () => {
    const content = await tb.files.download(`${TEST_DIR}/hello.txt`);
    assert(content === 'Hello SDK!', `download content=${JSON.stringify(content)}`);
  });

  await test('files.downloadBytes() binary', async () => {
    // Upload binary content
    const binary = new Uint8Array([0, 1, 2, 255, 254, 253]);
    await tb.files.upload(`${TEST_DIR}/binary.bin`, binary.buffer as ArrayBuffer);
    const buf = await tb.files.downloadBytes(`${TEST_DIR}/binary.bin`);
    const arr = new Uint8Array(buf);
    assert(arr.length === 6, `binary download length=${arr.length}`);
    assert(arr[0] === 0 && arr[3] === 255, 'binary content matches');
  });

  await test('files.download() not found', async () => {
    try {
      await tb.files.download(`${TEST_DIR}/nonexistent`);
      no('download not found', 'should have thrown');
    } catch (e: any) {
      assert(e.status === 404, 'download not found → 404');
    }
  });

  // exists
  await test('files.exists() true', async () => {
    const r = await tb.files.exists(`${TEST_DIR}/hello.txt`);
    assert(r.exists === true, 'exists=true');
    assert(r.type === 'file', 'type=file');
  });

  await test('files.exists() dir', async () => {
    const r = await tb.files.exists(TEST_DIR);
    assert(r.exists === true, 'dir exists=true');
    assert(r.type === 'dir', 'type=dir');
  });

  await test('files.exists() false', async () => {
    const r = await tb.files.exists(`${TEST_DIR}/nope`);
    assert(r.exists === false, 'exists=false');
  });

  // info
  await test('files.info()', async () => {
    const info = await tb.files.info(`${TEST_DIR}/hello.txt`);
    assert(info.name === 'hello.txt', `name=${info.name}`);
    assert(info.type === 'file', `type=${info.type}`);
    assert(info.size === 10, `size=${info.size}`);
    assert(info.owner === 'root', `owner=${info.owner}`);
    assert(typeof info.mode_bits === 'string', 'has mode_bits');
    assert(typeof info.mod_time === 'string', 'has mod_time');
  });

  await test('files.info() mode persisted', async () => {
    const info = await tb.files.info(`${TEST_DIR}/exec.sh`);
    assert(info.mode_bits === '755', `mode=${info.mode_bits}`);
  });

  // list
  await test('files.list()', async () => {
    const { entries } = await tb.files.list(TEST_DIR);
    assert(Array.isArray(entries), 'entries is array');
    assert(entries.length >= 4, `${entries.length} entries`);
    const hello = entries.find(e => e.name === 'hello.txt');
    assert(hello !== undefined, 'found hello.txt');
    assert(hello!.type === 'file', 'hello.txt type=file');
  });

  await test('files.list() depth', async () => {
    const { entries } = await tb.files.list(TEST_DIR, 3);
    assert(entries.length >= 6, `depth=3 → ${entries.length} entries`);
  });

  // find
  await test('files.find()', async () => {
    // Upload searchable content
    await tb.files.upload(`${TEST_DIR}/search.txt`, 'hello world\ngoodbye world\nhello again');
    const r = await tb.files.find(TEST_DIR, 'hello');
    assert(r.total >= 2, `find total=${r.total}`);
    assert(r.matches.length >= 2, `find matches=${r.matches.length}`);
    assert(typeof r.matches[0].file === 'string', 'match has file');
    assert(typeof r.matches[0].line === 'number', 'match has line');
  });

  await test('files.find() with include filter', async () => {
    const r = await tb.files.find(TEST_DIR, 'hello', { include: '*.sh' });
    assert(r.total === 0, `include=*.sh filters to 0 (no hello in .sh)`);
  });

  await test('files.find() maxResults', async () => {
    const r = await tb.files.find(TEST_DIR, 'hello', { maxResults: 1 });
    assert(r.total === 1, 'maxResults=1');
    assert(r.truncated === true, 'truncated=true');
  });

  // replace
  await test('files.replace()', async () => {
    const r = await tb.files.replace([`${TEST_DIR}/search.txt`], 'hello', 'hi');
    assert(r.results.length === 1, 'replace 1 file');
    assert(r.results[0].replacements >= 2, `replacements=${r.results[0].replacements}`);
    const content = await tb.files.download(`${TEST_DIR}/search.txt`);
    assert(content.includes('hi world'), 'replaced content verified');
    assert(content.includes('goodbye'), 'unreplaced content preserved');
  });

  // chmod
  await test('files.chmod()', async () => {
    const r = await tb.files.chmod(`${TEST_DIR}/hello.txt`, '600');
    assert(r.mode === '600', `chmod mode=${r.mode}`);
    const info = await tb.files.info(`${TEST_DIR}/hello.txt`);
    assert(info.mode_bits === '600', 'chmod persisted');
  });

  // move
  await test('files.move()', async () => {
    const r = await tb.files.move(`${TEST_DIR}/hello.txt`, `${TEST_DIR}/moved.txt`);
    assert(r.destination === `${TEST_DIR}/moved.txt`, 'move destination');
    const gone = await tb.files.exists(`${TEST_DIR}/hello.txt`);
    assert(gone.exists === false, 'old path gone');
    const there = await tb.files.exists(`${TEST_DIR}/moved.txt`);
    assert(there.exists === true, 'new path exists');
  });

  // remove
  await test('files.remove() file', async () => {
    const r = await tb.files.remove(`${TEST_DIR}/exec.sh`);
    assert(r.deleted === true, 'deleted=true');
    const gone = await tb.files.exists(`${TEST_DIR}/exec.sh`);
    assert(gone.exists === false, 'file gone');
  });

  await test('files.remove() non-empty dir without recursive', async () => {
    try {
      await tb.files.remove(TEST_DIR);
      no('remove non-empty', 'should have thrown');
    } catch (e: any) {
      assert(e.status === 400, 'non-empty dir → 400');
    }
  });

  await test('files.remove() protected path', async () => {
    try {
      await tb.files.remove('/root', true);
      no('remove /root', 'should have thrown');
    } catch (e: any) {
      assert(e.status === 403, 'protected → 403');
    }
  });

  // ── Toolbox: Process ─────────────────────────────────────────────────
  console.log('\n\x1b[36m[SDK]\x1b[0m \x1b[1mToolbox: Process\x1b[0m');

  await test('process.exec() basic', async () => {
    const r = await tb.process.exec('echo sdk_test');
    assert(r.exit_code === 0, `exit_code=${r.exit_code}`);
    assert(r.stdout.trim() === 'sdk_test', `stdout=${JSON.stringify(r.stdout.trim())}`);
    assert(typeof r.duration_ms === 'number', 'has duration_ms');
  });

  await test('process.exec() stderr', async () => {
    const r = await tb.process.exec('echo err >&2');
    assert(r.stderr.trim() === 'err', `stderr=${JSON.stringify(r.stderr.trim())}`);
  });

  await test('process.exec() exit code', async () => {
    const r = await tb.process.exec('exit 42');
    assert(r.exit_code === 42, `exit_code=${r.exit_code}`);
  });

  await test('process.exec() with cwd', async () => {
    const r = await tb.process.exec('pwd', { cwd: '/tmp' });
    assert(r.stdout.trim() === '/tmp', `cwd stdout=${r.stdout.trim()}`);
  });

  await test('process.exec() with env', async () => {
    const r = await tb.process.exec('echo $SDK_VAR', { env: { SDK_VAR: 'test_123' } });
    assert(r.stdout.trim() === 'test_123', `env stdout=${r.stdout.trim()}`);
  });

  await test('process.exec() pipe', async () => {
    const r = await tb.process.exec('echo "a b c" | wc -w');
    assert(r.stdout.trim() === '3', `pipe stdout=${r.stdout.trim()}`);
  });

  await test('process.exec() multi-line', async () => {
    const r = await tb.process.exec('echo l1 && echo l2 && echo l3');
    const lines = r.stdout.trim().split('\n');
    assert(lines.length === 3, `multi-line: ${lines.length} lines`);
  });

  // codeRun
  await test('process.codeRun() bash', async () => {
    const r = await tb.process.codeRun('echo bash_ok', 'bash');
    assert(r.stdout.trim() === 'bash_ok', 'bash code run');
    assert(r.exit_code === 0, 'bash exit=0');
  });

  await test('process.codeRun() python', async () => {
    const r = await tb.process.codeRun('print(6 * 7)', 'python');
    assert(r.stdout.trim() === '42', 'python 6*7=42');
  });

  await test('process.codeRun() node', async () => {
    const r = await tb.process.codeRun('console.log(JSON.stringify({ok:true}))', 'node');
    assert(r.stdout.trim() === '{"ok":true}', 'node json');
  });

  await test('process.codeRun() auto-detect', async () => {
    const r = await tb.process.codeRun('print("auto")');
    assert(r.stdout.trim() === 'auto', 'auto-detect python');
  });

  await test('process.codeRun() with env', async () => {
    const r = await tb.process.codeRun('echo $CR_ENV', 'bash', { env: { CR_ENV: 'cr_ok' } });
    assert(r.stdout.trim() === 'cr_ok', 'code run env');
  });

  // stream
  await test('process.stream()', async () => {
    const events: Array<{ type: string; data: any }> = [];
    for await (const e of tb.process.stream('echo stream_test')) {
      events.push(e);
    }
    const hasStdout = events.some(e => e.type === 'stdout');
    const hasExit = events.some(e => e.type === 'exit');
    const hasData = events.some(e => e.type === 'stdout' && e.data?.data?.includes('stream_test'));
    assert(hasStdout, 'stream has stdout events');
    assert(hasExit, 'stream has exit event');
    assert(hasData, 'stream has output data');
  });

  // list
  await test('process.list()', async () => {
    const { processes } = await tb.process.list();
    assert(Array.isArray(processes), 'processes is array');
    assert(processes.length >= 5, `${processes.length} processes`);
    assert(typeof processes[0].pid === 'number', 'process has pid');
    assert(typeof processes[0].command === 'string', 'process has command');
    const daemon = processes.find(p => p.command.includes('justavps-daemon'));
    assert(daemon !== undefined, 'daemon in process list');
  });

  // kill
  await test('process.kill() protected PID', async () => {
    try {
      await tb.process.kill(1);
      no('kill PID 1', 'should have thrown');
    } catch (e: any) {
      assert(e.status === 403, 'kill PID 1 → 403');
    }
  });

  // ── Integration ──────────────────────────────────────────────────────
  console.log('\n\x1b[36m[SDK]\x1b[0m \x1b[1mIntegration\x1b[0m');

  await test('exec → files roundtrip', async () => {
    await tb.process.exec(`echo exec_content > ${TEST_DIR}/from-exec.txt`);
    const content = await tb.files.download(`${TEST_DIR}/from-exec.txt`);
    assert(content.trim() === 'exec_content', 'exec → file → download');
  });

  await test('files → exec roundtrip', async () => {
    await tb.files.upload(`${TEST_DIR}/from-sdk.txt`, 'sdk_content');
    const r = await tb.process.exec(`cat ${TEST_DIR}/from-sdk.txt`);
    assert(r.stdout.trim() === 'sdk_content', 'upload → exec cat');
  });

  await test('error handling: JustAVPSError', async () => {
    try {
      await tb.files.info('/nonexistent/path/xyz');
      no('error handling', 'should have thrown');
    } catch (e: any) {
      assert(e instanceof JustAVPSError, 'throws JustAVPSError');
      assert(e.status === 404, `error status=${e.status}`);
      assert(typeof e.message === 'string', 'error has message');
    }
  });

  // ── Cleanup ──────────────────────────────────────────────────────────
  console.log('\n\x1b[36m[SDK]\x1b[0m Cleanup');
  await test('cleanup', async () => {
    const r = await tb.files.remove(TEST_DIR, true);
    assert(r.deleted === true, 'cleanup done');
  });

  // ── Results ──────────────────────────────────────────────────────────
  console.log('\n\x1b[36m═══════════════════════════════════════════════════════════\x1b[0m');
  if (fail === 0) {
    console.log(`  \x1b[32m\x1b[1mALL ${pass} TESTS PASSED\x1b[0m (${pass + fail} total)`);
  } else {
    console.log(`  \x1b[31m\x1b[1m${fail} FAILED\x1b[0m, \x1b[32m${pass} passed\x1b[0m (${pass + fail} total)`);
  }
  console.log('\x1b[36m═══════════════════════════════════════════════════════════\x1b[0m\n');
  process.exit(fail > 0 ? 1 : 0);
}

main();
