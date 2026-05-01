import { test, describe } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  parseCpuLimit,
  parseMemoryLimitGb,
  sumInstanceStorageGb,
  computeClusterEconomics,
} from './utilization.js';
import type { IncusClusterConfig } from '../config.js';
import type { IncusClusterMember, IncusInstance } from '../incus/types.js';

describe('parseCpuLimit', () => {
  test('plain integer count', () => {
    assert.equal(parseCpuLimit('4'), 4);
    assert.equal(parseCpuLimit('1'), 1);
  });
  test('comma-separated pinning list', () => {
    assert.equal(parseCpuLimit('0,1,2,3'), 4);
    assert.equal(parseCpuLimit('5,7,9'), 3);
  });
  test('range form', () => {
    assert.equal(parseCpuLimit('0-3'), 4);
    assert.equal(parseCpuLimit('5-7'), 3);
    assert.equal(parseCpuLimit('10-10'), 1);
  });
  test('mixed comma + range', () => {
    assert.equal(parseCpuLimit('0,1,4-7'), 6); // 0 + 1 + 4,5,6,7 = 6
  });
  test('empty / undefined / whitespace → null (uncapped)', () => {
    assert.equal(parseCpuLimit(''), null);
    assert.equal(parseCpuLimit(undefined), null);
    assert.equal(parseCpuLimit('   '), null);
  });
  test('malformed pieces are skipped, valid pieces still counted', () => {
    assert.equal(parseCpuLimit('0,xyz,2'), 2);
    assert.equal(parseCpuLimit('a-b'), null);
  });
});

describe('parseMemoryLimitGb', () => {
  test('SI units (decimal)', () => {
    assert.equal(parseMemoryLimitGb('8GB'), 8);
    assert.equal(parseMemoryLimitGb('512MB'), 0.512);
    assert.equal(parseMemoryLimitGb('1TB'), 1000);
  });
  test('IEC units (binary)', () => {
    // 8 GiB = 8 * 1024^3 bytes / 1e9 = 8.589934592 GB
    const v = parseMemoryLimitGb('8GiB');
    assert.ok(v !== null && Math.abs(v - 8.589934592) < 1e-6);
  });
  test('bare number treated as bytes', () => {
    // 4 * 1e9 bytes = 4 GB
    assert.equal(parseMemoryLimitGb('4000000000'), 4);
  });
  test('percentage of host RAM', () => {
    assert.equal(parseMemoryLimitGb('25%', 64), 16);
    assert.equal(parseMemoryLimitGb('50%', 100), 50);
    assert.equal(parseMemoryLimitGb('25%'), null); // no host context
  });
  test('case insensitive', () => {
    assert.equal(parseMemoryLimitGb('8gb'), 8);
    assert.equal(parseMemoryLimitGb('8Gb'), 8);
    assert.equal(parseMemoryLimitGb('8GB'), 8);
  });
  test('empty / malformed → null', () => {
    assert.equal(parseMemoryLimitGb(''), null);
    assert.equal(parseMemoryLimitGb(undefined), null);
    assert.equal(parseMemoryLimitGb('not a number'), null);
  });
});

describe('sumInstanceStorageGb', () => {
  test('returns null for missing devices', () => {
    assert.equal(sumInstanceStorageGb(undefined), null);
  });
  test('sums disk-type devices only', () => {
    const devices = {
      root: { type: 'disk', size: '20GB' },
      eth0: { type: 'nic', name: 'eth0' },        // ignored
      data: { type: 'disk', size: '100GB' },
    };
    assert.equal(sumInstanceStorageGb(devices), 120);
  });
  test('returns null when no disk devices have parseable size', () => {
    const devices = { eth0: { type: 'nic' } };
    assert.equal(sumInstanceStorageGb(devices), null);
  });
});

const ex44Cluster: IncusClusterConfig = {
  id: 'test',
  name: 'test',
  region: 'eu',
  endpoint: 'https://example:8443',
  project: 'default',
  defaultMemberSku: 'EX44',
  rejectUnauthorized: false,
};

const onlineMember = (name: string): IncusClusterMember => ({
  server_name: name,
  url: `https://${name}:8443`,
  status: 'Online',
  message: '',
  roles: ['database'],
});

const sandbox = (
  name: string,
  status: 'Running' | 'Stopped',
  cpu?: string,
  memory?: string,
  diskGb?: number,
): IncusInstance => ({
  name,
  type: 'container',
  status,
  config: {
    ...(cpu ? { 'limits.cpu': cpu } : {}),
    ...(memory ? { 'limits.memory': memory } : {}),
  },
  devices: diskGb
    ? { root: { type: 'disk', size: `${diskGb}GB` } }
    : undefined,
});

describe('computeClusterEconomics', () => {
  test('empty cluster: zero allocation, full capacity reflects 1 EX44', () => {
    const econ = computeClusterEconomics(ex44Cluster, [onlineMember('m1')], []);
    assert.equal(econ.members, 1);
    assert.equal(econ.members_online, 1);
    assert.equal(econ.member_sku, 'EX44');
    assert.equal(econ.monthly_cost_eur, 42.30);
    assert.deepEqual(econ.capacity, { vcpus: 20, ram_gb: 64, storage_gb: 500 });
    assert.equal(econ.allocated.vcpus, 0);
    assert.equal(econ.allocated.ram_gb, 0);
    assert.equal(econ.allocated.storage_gb, 0);
    assert.equal(econ.binding_constraint, null);
    assert.equal(econ.active_instances, 0);
  });

  test('two-host cluster doubles capacity', () => {
    const econ = computeClusterEconomics(
      ex44Cluster,
      [onlineMember('m1'), onlineMember('m2')],
      [],
    );
    assert.equal(econ.members, 2);
    assert.deepEqual(econ.capacity, { vcpus: 40, ram_gb: 128, storage_gb: 1000 });
    assert.equal(econ.monthly_cost_eur, 42.30 * 2);
  });

  test('one running 4-vCPU/8-GB/40-GB sandbox produces correct fill %', () => {
    const econ = computeClusterEconomics(
      ex44Cluster,
      [onlineMember('m1')],
      [sandbox('s1', 'Running', '4', '8GB', 40)],
    );
    assert.equal(econ.allocated.vcpus, 4);
    assert.equal(econ.allocated.ram_gb, 8);
    assert.equal(econ.allocated.storage_gb, 40);
    assert.ok(econ.fill_pct);
    assert.ok(Math.abs((econ.fill_pct.vcpus ?? 0) - (4 / 20) * 100) < 1e-9);
    assert.ok(Math.abs((econ.fill_pct.ram ?? 0) - (8 / 64) * 100) < 1e-9);
    assert.ok(Math.abs((econ.fill_pct.storage ?? 0) - (40 / 500) * 100) < 1e-9);
    assert.equal(econ.active_instances, 1);
  });

  test('binding constraint is the highest fill %', () => {
    const econ = computeClusterEconomics(
      ex44Cluster,
      [onlineMember('m1')],
      // 1 vCPU (5%), 32 GB RAM (50%), 10 GB storage (2%) — RAM binds.
      [sandbox('s1', 'Running', '1', '32GB', 10)],
    );
    assert.equal(econ.binding_constraint, 'ram');
  });

  test('unbounded instance (no limits) is counted in unbounded_instances', () => {
    const econ = computeClusterEconomics(
      ex44Cluster,
      [onlineMember('m1')],
      [sandbox('s1', 'Running')], // no cpu, no memory
    );
    assert.equal(econ.unbounded_instances, 1);
    assert.equal(econ.allocated.vcpus, 0);
    assert.equal(econ.allocated.ram_gb, 0);
  });

  test('stopped instances still count toward storage but are not "active"', () => {
    const econ = computeClusterEconomics(
      ex44Cluster,
      [onlineMember('m1')],
      [
        sandbox('s1', 'Stopped', '2', '4GB', 20),
        sandbox('s2', 'Running', '2', '4GB', 20),
      ],
    );
    // Both sum into allocated CPU/RAM/storage in current model. Active
    // count separates running from stopped.
    assert.equal(econ.active_instances, 1);
    assert.equal(econ.allocated.storage_gb, 40);
  });

  test('cost_per_active_instance_eur is null when no running instances', () => {
    const econ = computeClusterEconomics(ex44Cluster, [onlineMember('m1')], []);
    assert.equal(econ.cost_per_active_instance_eur, null);
  });

  test('cost_per_active_instance_eur is monthly_cost / active count', () => {
    const econ = computeClusterEconomics(
      ex44Cluster,
      [onlineMember('m1'), onlineMember('m2')],
      [
        sandbox('s1', 'Running', '1', '4GB', 20),
        sandbox('s2', 'Running', '1', '4GB', 20),
      ],
    );
    assert.equal(econ.cost_per_active_instance_eur, (42.30 * 2) / 2);
  });

  test('member SKU defaults to EX44 (DEFAULT_SKU_ID) when cluster has no override', () => {
    const cluster: IncusClusterConfig = { ...ex44Cluster, defaultMemberSku: undefined };
    const econ = computeClusterEconomics(cluster, [onlineMember('m1')], []);
    assert.equal(econ.member_sku, 'EX44');
  });

  test('unknown SKU yields null capacity / cost (graceful)', () => {
    const cluster: IncusClusterConfig = { ...ex44Cluster, defaultMemberSku: 'NOPE' };
    const econ = computeClusterEconomics(cluster, [onlineMember('m1')], []);
    assert.equal(econ.member_sku, null);
    assert.equal(econ.capacity, null);
    assert.equal(econ.monthly_cost_eur, null);
    assert.equal(econ.fill_pct, null);
  });

  test('offline members still count toward capacity (you still pay for them)', () => {
    const offlineMember: IncusClusterMember = { ...onlineMember('m1'), status: 'Offline' };
    const econ = computeClusterEconomics(ex44Cluster, [offlineMember], []);
    assert.equal(econ.members, 1);
    assert.equal(econ.members_online, 0);
    assert.equal(econ.monthly_cost_eur, 42.30);
    assert.deepEqual(econ.capacity, { vcpus: 20, ram_gb: 64, storage_gb: 500 });
  });
});
