import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import { snapshotClusterTick, type SnapshotWrite } from './snapshotWorker.js';
import type { IncusClusterConfig } from '../config.js';
import type { IncusClusterMember, IncusInstance } from '../incus/types.js';

const cluster: IncusClusterConfig = {
  id: 'hel2', name: 'hel2', region: 'eu',
  endpoint: 'https://x:8443', project: 'default',
  defaultMemberSku: 'EX44', rejectUnauthorized: false,
};

const member = (name: string): IncusClusterMember => ({
  server_name: name, url: `https://${name}:8443`, status: 'Online', message: '', roles: [],
});

const instance = (name: string, location: string, status: 'Running' | 'Stopped', cpu = '1', mem = '1GB', diskGb = 5): IncusInstance => ({
  name, type: 'container', status, location,
  config: { 'limits.cpu': cpu, 'limits.memory': mem },
  devices: { root: { type: 'disk', size: `${diskGb}GB` } },
});

describe('snapshotClusterTick', () => {
  test('writes one sample per host with usage summed across instances on that host', async () => {
    const writes: SnapshotWrite[] = [];
    await snapshotClusterTick({
      cluster,
      members: [member('m1'), member('m2')],
      instances: [
        instance('a', 'm1', 'Running', '2', '4GB', 10),
        instance('b', 'm1', 'Running', '1', '2GB', 5),
        instance('c', 'm2', 'Running', '4', '8GB', 20),
        instance('d', 'm2', 'Stopped', '1', '1GB', 5),  // stopped: storage but no compute
      ],
      now: new Date('2026-04-27T12:00:00Z'),
      write: (w) => { writes.push(w); return Promise.resolve(); },
    });
    assert.equal(writes.length, 2);
    const m1 = writes.find((w) => w.hostName === 'm1');
    const m2 = writes.find((w) => w.hostName === 'm2');
    assert.equal(m1?.vcpuUsed, 3);
    assert.equal(m1?.ramGbUsed, 6);
    assert.equal(m1?.storageGbUsed, 15);
    assert.equal(m1?.instancesRunning, 2);
    assert.equal(m1?.instancesTotal, 2);
    // m2: running 'c' contributes 4 vCPU + 8 GB; stopped 'd' contributes 0 vCPU + 0 GB but adds 5 GB storage.
    assert.equal(m2?.vcpuUsed, 4);
    assert.equal(m2?.ramGbUsed, 8);
    assert.equal(m2?.storageGbUsed, 25);
    assert.equal(m2?.instancesRunning, 1);
    assert.equal(m2?.instancesTotal, 2);
  });

  test('hosts with no instances still get a zero-valued sample', async () => {
    const writes: SnapshotWrite[] = [];
    await snapshotClusterTick({
      cluster,
      members: [member('m1')],
      instances: [],
      now: new Date(),
      write: (w) => { writes.push(w); return Promise.resolve(); },
    });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].vcpuUsed, 0);
    assert.equal(writes[0].instancesRunning, 0);
    assert.equal(writes[0].instancesTotal, 0);
  });

  test('instances on unknown hosts are dropped (not double-counted)', async () => {
    const writes: SnapshotWrite[] = [];
    await snapshotClusterTick({
      cluster,
      members: [member('m1')],
      instances: [
        instance('a', 'm1', 'Running', '1'),
        instance('b', 'unknown-host', 'Running', '1'),  // location not in member list
      ],
      now: new Date(),
      write: (w) => { writes.push(w); return Promise.resolve(); },
    });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].instancesTotal, 1);  // only instance 'a'
  });
});
