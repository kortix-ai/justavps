import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

import { db } from '@/server/db';
import { accounts, baremetalHosts, hostCapacityReservations, machines, users } from '@/server/db/schema';
import { expireStaleHostCapacityReservations, leaseHostCapacity } from '@/server/lib/baremetal/reservations';
import { reconcileBaremetalFleet } from '@/server/lib/baremetal/reconcile';

const createdUserIds: string[] = [];
const createdAccountIds: string[] = [];
const createdHostIds: string[] = [];
const createdMachineIds: string[] = [];
const createdReservationIds: string[] = [];

async function cleanupRows() {
  if (createdReservationIds.length) {
    await db.delete(hostCapacityReservations).where(inArray(hostCapacityReservations.id, createdReservationIds));
    createdReservationIds.length = 0;
  }
  if (createdMachineIds.length) {
    await db.delete(machines).where(inArray(machines.id, createdMachineIds));
    createdMachineIds.length = 0;
  }
  if (createdHostIds.length) {
    await db.delete(baremetalHosts).where(inArray(baremetalHosts.id, createdHostIds));
    createdHostIds.length = 0;
  }
  if (createdAccountIds.length) {
    await db.delete(accounts).where(inArray(accounts.id, createdAccountIds));
    createdAccountIds.length = 0;
  }
  if (createdUserIds.length) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
    createdUserIds.length = 0;
  }
}

describe.skipIf(!process.env.DATABASE_URL)('reservation + maintenance integration', () => {
  beforeEach(async () => {
    await cleanupRows();
  });

  afterEach(async () => {
    await cleanupRows();
  });

  async function seedAccountAndUser(prefix: string) {
    const suffix = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [user] = await db.insert(users).values({
      email: `${suffix}@example.com`,
      name: 'Reservations Integration',
    }).returning();
    createdUserIds.push(user.id);

    const [account] = await db.insert(accounts).values({
      name: `Reservations ${suffix}`,
      slug: `reservations-${suffix}`,
      type: 'organization',
    }).returning();
    createdAccountIds.push(account.id);

    return { user, account, suffix };
  }

  it('leases capacity onto an in-service host and skips draining hosts', async () => {
    const { user, account, suffix } = await seedAccountAndUser('lease');
    const region = `test-${suffix}`;

    const hosts = await db.insert(baremetalHosts).values([
      {
        name: `draining-${suffix}`,
        region,
        location: 'HEL1',
        hostClass: 'general-small',
        vendor: 'hetzner_robot',
        status: 'active',
        maintenanceState: 'draining',
        runnerBaseUrl: 'http://runner-draining',
        runnerToken: 'runner-token',
        publicIpv4: '1.1.1.1',
        totalVcpu: 16,
        totalMemoryGb: 64,
        totalDiskGb: 800,
        usedVcpu: 0,
        usedMemoryGb: 0,
        usedDiskGb: 0,
        metadata: {},
      },
      {
        name: `healthy-${suffix}`,
        region,
        location: 'HEL1',
        hostClass: 'general-small',
        vendor: 'hetzner_robot',
        status: 'active',
        maintenanceState: 'in_service',
        runnerBaseUrl: 'http://runner-healthy',
        runnerToken: 'runner-token',
        publicIpv4: '2.2.2.2',
        totalVcpu: 16,
        totalMemoryGb: 64,
        totalDiskGb: 800,
        usedVcpu: 0,
        usedMemoryGb: 0,
        usedDiskGb: 0,
        metadata: {},
      },
    ]).returning();
    createdHostIds.push(...hosts.map((host) => host.id));

    const [machine] = await db.insert(machines).values({
      ownerId: user.id,
      accountId: account.id,
      slug: `lease-${suffix}`,
      name: 'Lease Me',
      status: 'provisioning',
      provider: 'baremetal',
      serverType: 'custom',
      region,
      vcpu: 2,
      ramGb: 4,
      diskGb: 80,
      ip: null,
      providerServerId: null,
      providerMeta: {},
      machineToken: 'token',
      codeServerPassword: '',
      backupsEnabled: false,
      source: 'user',
      priceMonthly: 20,
    }).returning();
    createdMachineIds.push(machine.id);

    const lease = await leaseHostCapacity({
      machineId: machine.id,
      region,
      resources: { vcpu: 2, memoryGb: 4, diskGb: 80 },
    });
    createdReservationIds.push(lease.reservation.id);

    expect(lease.host.maintenanceState).toBe('in_service');
    expect(lease.decision.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ hostId: hosts[0].id, eligible: false, reasons: expect.arrayContaining(['host maintenance state is draining']) }),
    ]));
  });

  it('expires stale reservations and reconcile releases reservations stranded on deleted or errored machines', async () => {
    const { user, account, suffix } = await seedAccountAndUser('reconcile');

    const [host] = await db.insert(baremetalHosts).values({
      name: `reconcile-${suffix}`,
      region: 'hel1',
      location: 'HEL1',
      hostClass: 'general-small',
      vendor: 'hetzner_robot',
      status: 'active',
      maintenanceState: 'in_service',
      runnerBaseUrl: 'http://runner-reconcile',
      runnerToken: 'runner-token',
      publicIpv4: '3.3.3.3',
      totalVcpu: 16,
      totalMemoryGb: 64,
      totalDiskGb: 800,
      usedVcpu: 0,
      usedMemoryGb: 0,
      usedDiskGb: 0,
      metadata: {},
    }).returning();
    createdHostIds.push(host.id);

    const seededMachines = await db.insert(machines).values([
      {
        ownerId: user.id,
        accountId: account.id,
        slug: `expired-${suffix}`,
        name: 'Expired Lease',
        status: 'provisioning',
        provider: 'baremetal',
        serverType: 'custom',
        region: 'hel1',
        vcpu: 2,
        ramGb: 4,
        diskGb: 80,
        ip: null,
        providerServerId: null,
        providerMeta: { baremetal_host_id: host.id },
        machineToken: 'token',
        codeServerPassword: '',
        backupsEnabled: false,
        source: 'user',
        priceMonthly: 20,
      },
      {
        ownerId: user.id,
        accountId: account.id,
        slug: `error-${suffix}`,
        name: 'Errored Lease',
        status: 'error',
        provider: 'baremetal',
        serverType: 'custom',
        region: 'hel1',
        vcpu: 2,
        ramGb: 4,
        diskGb: 80,
        ip: null,
        providerServerId: `justavps-error-${suffix}`,
        providerMeta: { baremetal_host_id: host.id },
        machineToken: 'token',
        codeServerPassword: '',
        backupsEnabled: false,
        source: 'user',
        priceMonthly: 20,
      },
    ]).returning();
    createdMachineIds.push(...seededMachines.map((machine) => machine.id));

    const reservations = await db.insert(hostCapacityReservations).values([
      {
        hostId: host.id,
        machineId: seededMachines[0].id,
        reservationType: 'machine_create',
        state: 'reserved',
        vcpu: 2,
        memoryGb: 4,
        diskGb: 80,
        expiresAt: new Date(Date.now() - 60_000),
        metadata: {},
      },
      {
        hostId: host.id,
        machineId: seededMachines[1].id,
        reservationType: 'machine_create',
        state: 'reserved',
        vcpu: 2,
        memoryGb: 4,
        diskGb: 80,
        expiresAt: new Date(Date.now() + 60_000),
        metadata: {},
      },
    ]).returning();
    createdReservationIds.push(...reservations.map((reservation) => reservation.id));

    await expireStaleHostCapacityReservations(new Date());

    const [expiredReservation] = await db.select().from(hostCapacityReservations).where(eq(hostCapacityReservations.id, reservations[0].id));
    expect(expiredReservation.state).toBe('expired');

    const result = await reconcileBaremetalFleet({
      fetchRunnerState: async () => ({
        checkedAt: new Date().toISOString(),
        runnerd: 'ok',
        incus: { status: 'ok', serverVersion: '6.0', instanceCount: 0, imageCount: 0 },
        instances: [],
        images: [],
      }),
    });

    const [releasedReservation] = await db.select().from(hostCapacityReservations).where(eq(hostCapacityReservations.id, reservations[1].id));
    const [reconciledMachine] = await db.select().from(machines).where(eq(machines.id, seededMachines[1].id));

    expect(result.hosts[0]?.status).toBe('ok');
    expect(releasedReservation.state).toBe('released');
    expect((releasedReservation.metadata ?? {})['reconciled_release_reason']).toBe('machine_error');
    expect(reconciledMachine.status).toBe('deleted');
    expect(reconciledMachine.deletedAt).toBeTruthy();
  });
});
