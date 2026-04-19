import { describe, expect, it } from 'vitest';

import { backfillMachinePortAllocationsFromMachine, pruneDeletedMachinePortAllocations, releaseMachinePortAllocations, reserveMachinePortAllocations } from "@/server/platform/baremetal/port-allocations";

type PortAllocationTestExecutor = NonNullable<Parameters<typeof reserveMachinePortAllocations>[0]['executor']>;

describe('baremetal port allocations', () => {
  it('allocates explicit per-host ssh/http ports and reuses them for the same machine', async () => {
    const rows: Array<{ machineId: string; hostId: string; protocol: 'ssh' | 'http'; publicPort: number; targetPort: number }> = [];
    let selectCount = 0;

    const executor = {
      select: () => ({
        from: () => ({
          where: async () => {
            selectCount += 1;
            if (selectCount === 1) return [];
            if (selectCount === 2) return [];
            return rows;
          },
        }),
      }),
      insert: () => ({
        values: async (values: typeof rows) => {
          rows.push(...values);
        },
      }),
      delete: () => ({
        where: async () => {
          rows.splice(0, rows.length);
        },
      }),
      execute: async () => {},
    } as unknown as PortAllocationTestExecutor;

    const first = await reserveMachinePortAllocations({ machineId: 'machine-1', hostId: 'host-1', executor });
    expect(first.sshPort).toBe(22000);
    expect(first.httpPort).toBe(42000);

    selectCount = 0;
    const reuseExecutor = {
      ...executor,
      select: () => ({
        from: () => ({
          where: async () => rows,
        }),
      }),
    } as unknown as PortAllocationTestExecutor;
    const second = await reserveMachinePortAllocations({ machineId: 'machine-1', hostId: 'host-1', executor: reuseExecutor });
    expect(second.sshPort).toBe(22000);
    expect(second.httpPort).toBe(42000);

    await releaseMachinePortAllocations('machine-1', executor);
    expect(rows).toHaveLength(0);
  });

  it('skips legacy providerMeta ports already in use on the same host', async () => {
    const rows: Array<{ machineId: string; hostId: string; protocol: 'ssh' | 'http'; publicPort: number; targetPort: number }> = [];
    const legacyMachines = [
      {
        id: 'machine-legacy',
        provider: 'baremetal',
        deletedAt: null,
        providerMeta: {
          baremetal_host_id: 'host-1',
          ssh_port: 22000,
          http_port: 42000,
        },
      },
    ];
    let selectCount = 0;

    const executor = {
      select: () => ({
        from: () => ({
          where: async () => {
            selectCount += 1;
            if (selectCount === 1) return [];
            if (selectCount === 2) return [];
            if (selectCount === 3) return legacyMachines;
            return rows;
          },
        }),
      }),
      insert: () => ({
        values: async (values: typeof rows) => {
          rows.push(...values);
        },
      }),
      delete: () => ({ where: async () => {} }),
      execute: async () => {},
    } as unknown as PortAllocationTestExecutor;

    const allocated = await reserveMachinePortAllocations({ machineId: 'machine-new', hostId: 'host-1', executor });
    expect(allocated.sshPort).toBe(22001);
    expect(allocated.httpPort).toBe(42001);
  });

  it('backfills missing explicit allocations from legacy provider metadata', async () => {
    const rows: Array<{ machineId: string; hostId: string; protocol: 'ssh' | 'http'; publicPort: number; targetPort: number; metadata: Record<string, unknown> }> = [];
    let selectCount = 0;
    const executor = {
      select: () => ({
        from: () => ({
          where: async () => {
            selectCount += 1;
            return selectCount === 1 ? [] : rows;
          },
        }),
      }),
      insert: () => ({
        values: async (values: typeof rows) => {
          rows.push(...values);
        },
      }),
      delete: () => ({ where: async () => {} }),
      execute: async () => {},
    } as unknown as PortAllocationTestExecutor;

    const result = await backfillMachinePortAllocationsFromMachine({
      id: 'machine-legacy',
      provider: 'baremetal',
      deletedAt: null,
      providerMeta: {
        baremetal_host_id: 'host-1',
        ssh_port: 22316,
        http_port: 8948,
      },
    } as never, executor);

    expect(result?.ssh?.publicPort).toBe(22316);
    expect(result?.http?.publicPort).toBe(8948);
    expect(rows).toHaveLength(2);
  });

  it('prunes explicit port allocations for deleted machines', async () => {
    const executor = {
      select: () => ({ from: async () => [] }),
      delete: () => ({ where: async () => {} }),
      execute: async () => ({ rows: [{ id: 'alloc-1' }, { id: 'alloc-2' }] }),
      insert: () => ({ values: async () => {} }),
    } as unknown as PortAllocationTestExecutor;

    const deleted = await pruneDeletedMachinePortAllocations(executor);
    expect(deleted).toBe(2);
  });
});
