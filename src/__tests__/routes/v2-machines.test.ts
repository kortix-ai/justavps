/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listMachinesMock = vi.fn();
const getMachineMock = vi.fn();
const createMachineMock = vi.fn();
const startMachineMock = vi.fn();
const stopMachineMock = vi.fn();
const rebootMachineMock = vi.fn();
const deleteMachineMock = vi.fn();

vi.mock('@/server/auth/api-guard', () => ({
  apiGuard: async (c: any, next: any) => {
    c.set('userId', '11111111-1111-1111-1111-111111111111');
    c.set('accountId', '22222222-2222-2222-2222-222222222222');
    c.set('isAdmin', false);
    c.set('accountRole', 'owner');
    return next();
  },
}));

vi.mock('@/server/v2/services/machines', () => ({
  listMachinesV2: listMachinesMock,
  getMachineV2: getMachineMock,
  createMachineV2: createMachineMock,
  startMachineV2: startMachineMock,
  stopMachineV2: stopMachineMock,
  rebootMachineV2: rebootMachineMock,
  deleteMachineV2: deleteMachineMock,
}));

describe('v2 machines API', () => {
  const machineId = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('lists machines without exposing provider selection', async () => {
    listMachinesMock.mockResolvedValueOnce([
      {
        id: machineId,
        slug: 'abc123',
        name: 'Agent Box',
        status: 'ready',
        machine_mode: 'vm',
        requested_image_kind: 'golden',
        requested_image_ref: null,
        region: 'hel1',
        plan: { id: 'starter', label: 'Starter', vcpu: 2, ram_gb: 4, disk_gb: 80, price_monthly: 12 },
        billing: { mode: 'flat_monthly', price_monthly: 12, compute_seconds: null, storage_gb: 80 },
        image: null,
        connectivity: { public_ip: '1.2.3.4', private_ipv4: '10.0.0.2', ssh_command: 'ssh root@1.2.3.4', ssh_port: 22222, urls: null },
        capabilities: { can_start: false, can_stop: true, can_reboot: true, can_resize: true, can_snapshot: true, can_create_image: true },
        health: null,
        created_at: new Date().toISOString(),
        ready_at: new Date().toISOString(),
      },
    ]);

    const { machinesV2App } = await import("@/server/v2/routes/public/machines");
    const res = await machinesV2App.request(new Request('http://localhost/'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.machines)).toBe(true);
    expect(data.machines[0].provider).toBeUndefined();
    expect(listMachinesMock).toHaveBeenCalledWith(expect.objectContaining({ accountId: '22222222-2222-2222-2222-222222222222' }));
  });

  it('creates a machine from plan + region without provider input', async () => {
    createMachineMock.mockResolvedValueOnce({
      id: machineId,
      slug: 'abc123',
      name: 'Agent Box',
      status: 'provisioning',
      machine_mode: 'vm',
      requested_image_kind: 'golden',
      requested_image_ref: null,
      region: 'hel1',
      resources: { vcpu: 2, ram_gb: 4, disk_gb: 80 },
      billing: { mode: 'flat_monthly', price_monthly: 12, current_period_end: null },
      image: null,
      connectivity: { public_ip: null, private_ipv4: null, ssh_command: null, ssh_port: null, urls: null },
      capabilities: { can_start: false, can_stop: false, can_reboot: false, can_resize: true, can_snapshot: true, can_create_image: true },
      health: null,
      created_at: new Date().toISOString(),
      ready_at: null,
    });

    const { machinesV2App } = await import("@/server/v2/routes/public/machines");
    const res = await machinesV2App.request(new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        vcpu: 2,
        ram_gb: 4,
        disk_gb: 80,
        machine_mode: 'vm',
        region: 'hel1',
        name: 'Agent Box',
        image_id: null,
      }),
    }));

    expect(res.status).toBe(202);
    expect(createMachineMock).toHaveBeenCalledWith(expect.objectContaining({
      accountId: '22222222-2222-2222-2222-222222222222',
      userId: '11111111-1111-1111-1111-111111111111',
      input: expect.objectContaining({ vcpu: 2, ram_gb: 4, disk_gb: 80, machine_mode: 'vm', region: 'hel1' }),
    }));
  });

  it('accepts docker images for container machines', async () => {
    createMachineMock.mockResolvedValueOnce({
      id: machineId,
      slug: 'docker-box',
      name: 'Docker Box',
      status: 'provisioning',
      machine_mode: 'container',
      requested_image_kind: 'docker',
      requested_image_ref: 'docker:nginx:latest',
      region: 'hel1',
      resources: { vcpu: 2, ram_gb: 4, disk_gb: 20 },
      billing: { mode: 'flat_monthly', price_monthly: 12, current_period_end: null },
      image: null,
      connectivity: { public_ip: null, private_ipv4: null, ssh_command: null, ssh_port: null, urls: null },
      capabilities: { can_start: false, can_stop: false, can_reboot: false, can_resize: true, can_snapshot: true, can_create_image: true },
      health: null,
      created_at: new Date().toISOString(),
      ready_at: null,
    });

    const { machinesV2App } = await import("@/server/v2/routes/public/machines");
    const res = await machinesV2App.request(new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        vcpu: 2,
        ram_gb: 4,
        disk_gb: 20,
        machine_mode: 'container',
        region: 'hel1',
        docker_image: 'nginx:latest',
      }),
    }));

    expect(res.status).toBe(202);
    expect(createMachineMock).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        machine_mode: 'container',
        docker_image: 'nginx:latest',
      }),
    }));
  });

  it('supports lifecycle actions through substrate-agnostic routes', async () => {
    startMachineMock.mockResolvedValueOnce({ ok: true });
    stopMachineMock.mockResolvedValueOnce({ ok: true });
    rebootMachineMock.mockResolvedValueOnce({ ok: true });
    deleteMachineMock.mockResolvedValueOnce({ ok: true });

    const { machinesV2App } = await import("@/server/v2/routes/public/machines");

    const startRes = await machinesV2App.request(new Request(`http://localhost/${machineId}/start`, { method: 'POST' }));
    expect(startRes.status).toBe(200);
    expect(startMachineMock).toHaveBeenCalledWith(expect.objectContaining({ machineId }));

    const stopRes = await machinesV2App.request(new Request(`http://localhost/${machineId}/stop`, { method: 'POST' }));
    expect(stopRes.status).toBe(200);
    expect(stopMachineMock).toHaveBeenCalledWith(expect.objectContaining({ machineId }));

    const rebootRes = await machinesV2App.request(new Request(`http://localhost/${machineId}/reboot`, { method: 'POST' }));
    expect(rebootRes.status).toBe(200);
    expect(rebootMachineMock).toHaveBeenCalledWith(expect.objectContaining({ machineId }));

    const deleteRes = await machinesV2App.request(new Request(`http://localhost/${machineId}`, { method: 'DELETE' }));
    expect(deleteRes.status).toBe(200);
    expect(deleteMachineMock).toHaveBeenCalledWith(expect.objectContaining({ machineId }));
  });
});
