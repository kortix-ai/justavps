/**
 * One-shot: place an AX41-NVMe order in HEL1 for end-to-end testing.
 * Mirrors the app's placeHetznerRobotOrder flow but self-contained.
 * Creates the procurement row + host row + places the Hetzner order.
 */
import { config as dc } from 'dotenv';
dc();
dc({ path: '.env.local', override: true });

async function main() {
  const { randomUUID, randomBytes } = await import('node:crypto');
  const { db } = await import('@/server/db');
  const { baremetalHosts, baremetalProcurements } = await import('@/server/db/schema');
  const { HetznerRobotClient } = await import('@/server/platform/baremetal/vendors/hetzner-robot');
  const { config } = await import('@/server/core/config');

  if (!config.BAREMETAL_BOOTSTRAP_PUBLIC_KEY) throw new Error('BAREMETAL_BOOTSTRAP_PUBLIC_KEY not set');

  const robot = new HetznerRobotClient();
  const bootstrapFingerprint = await robot.ensureKey({
    name: 'justavps-bootstrap',
    data: config.BAREMETAL_BOOTSTRAP_PUBLIC_KEY,
  });
  console.log(`[1/4] Bootstrap key trusted with Hetzner: ${bootstrapFingerprint}`);

  const hostId = randomUUID();
  const hostName = `bm-ax41-nvme-HEL1-${hostId.slice(0, 8)}`;
  const runnerToken = randomBytes(24).toString('hex');

  // Create procurement row first (matches admin /procurements flow).
  const { users } = await import('@/server/db/schema');
  const { eq: eqOp } = await import('drizzle-orm');
  const [adminUser] = await db.select({ id: users.id }).from(users).where(eqOp(users.isAdmin, true)).limit(1);
  const requestedByUserId = adminUser?.id;
  if (!requestedByUserId) throw new Error('No admin user in DB');

  const [procurement] = await db.insert(baremetalProcurements).values({
    vendor: 'hetzner_robot',
    hostClass: 'ax41-nvme',
    productId: 'AX41-NVMe',
    region: 'eu',
    location: 'HEL1',
    status: 'approved',
    requestedByUserId,
    approvedByUserId: requestedByUserId,
    approvedAt: new Date(),
    requiresApproval: false,
    metadata: { source: 'e2e-test-buy-script' },
  }).returning();
  console.log(`[2/4] Procurement row created: ${procurement.id}`);

  // Place the real Hetzner order.
  const transaction = await robot.orderServer({
    productId: 'AX41-NVMe',
    location: 'HEL1',
    distribution: 'Ubuntu 24.04 LTS base',
    authorizedKeys: [bootstrapFingerprint],
    addons: ['primary_ipv4'],
  });
  console.log(`[3/4] Hetzner order placed: ${transaction.transaction.id} (status=${transaction.transaction.status})`);

  // Insert host row with status=ordering. Auto-sync will promote it.
  await db.insert(baremetalHosts).values({
    id: hostId,
    vendor: 'hetzner_robot',
    hostClass: 'ax41-nvme',
    region: 'eu',
    location: 'HEL1',
    name: hostName,
    status: 'ordering',
    providerTransactionId: transaction.transaction.id,
    providerServerNumber: transaction.transaction.server_number ? String(transaction.transaction.server_number) : null,
    publicIpv4: transaction.transaction.server_ip,
    runnerToken,
    metadata: {
      procurement_id: procurement.id,
      product_id: 'AX41-NVMe',
      order_status: transaction.transaction.status,
      bootstrap_key_fingerprint: bootstrapFingerprint,
      source: 'e2e-test-buy-script',
    },
  });

  // Update procurement to link to the host + mark as ordering.
  const { eq } = await import('drizzle-orm');
  await db.update(baremetalProcurements).set({
    status: 'ordering',
    providerTransactionId: transaction.transaction.id,
    orderedAt: new Date(),
    hostId,
    metadata: {
      source: 'e2e-test-buy-script',
      order_status: transaction.transaction.status,
      bootstrap_key_fingerprint: bootstrapFingerprint,
    },
    updatedAt: new Date(),
  }).where(eq(baremetalProcurements.id, procurement.id));

  console.log(`[4/4] Host row created: ${hostId} (${hostName})`);
  console.log('');
  console.log('=== DONE ===');
  console.log(`  Hetzner tx:      ${transaction.transaction.id}`);
  console.log(`  Hetzner status:  ${transaction.transaction.status}`);
  console.log(`  App procurement: ${procurement.id}`);
  console.log(`  App host:        ${hostId} (${hostName})`);
  console.log(`  Monthly cost:    ~€38.40/mo (HEL1 AX41-NVMe)`);
  console.log('');
  console.log('Auto-sync will poll Hetzner every fleet-auditor pass. Watch /v2/admin/procurements');
  console.log('or /v2/admin/hosts — status will flip to bootstrapping when Hetzner allocates.');
}

main().catch((e) => { console.error('FAIL —', e.message); process.exit(1); });
