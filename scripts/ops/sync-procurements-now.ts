/**
 * Force an immediate sync of all pending procurements with Hetzner Robot.
 * Mirrors what the fleet-auditor does every pass, but runs it right now.
 */
import { config as dc } from 'dotenv';
dc();
dc({ path: '.env.local', override: true });

async function main() {
  const { syncPendingProcurements } = await import('@/server/platform/baremetal/procurement-sync');
  const result = await syncPendingProcurements();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => { console.error('FAIL —', e.message); process.exit(1); });
