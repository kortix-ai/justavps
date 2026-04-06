import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { machines } from '../../db/schema';
import { plansForRegion, resolvePlanForDisplay } from '@/lib/plan-catalog';

const E2B_RATES = { vcpuPerHour: 0.0504, ramPerGiBHour: 0.0162, storagePerGiBHour: 0.000108, freeStorageGiB: 5 };
const DAYTONA_RATES = { vcpuPerHour: 0.0504, ramPerGiBHour: 0.0162, storagePerGiBHour: 0.000108, freeStorageGiB: 0 };

function monthlyEquivalent(planId: string, hoursPerDay: number, rates: typeof E2B_RATES) {
  const plan = resolvePlanForDisplay(planId);
  if (!plan) throw new Error(`Unknown plan ${planId}`);
  const activeHoursPerMonth = hoursPerDay * 30;
  const billableStorage = Math.max(plan.disk - rates.freeStorageGiB, 0);
  const hourly = (plan.vcpu * rates.vcpuPerHour) + (plan.memory * rates.ramPerGiBHour) + (billableStorage * rates.storagePerGiBHour);
  return Number((hourly * activeHoursPerMonth).toFixed(2));
}

export async function getBillingOverviewV2(input: { accountId: string; region?: string }) {
  const rows = await db.select().from(machines).where(eq(machines.accountId, input.accountId));
  const active = rows.filter((row) => row.status !== 'deleted');
  const estimatedCost = active.reduce((sum, row) => sum + (row.priceMonthly ?? 0), 0);
  return {
    modes: [
      { id: 'flat_monthly', available: true, default: true, description: 'Predictable persistent monthly pricing.' },
      { id: 'metered', available: false, default: false, description: 'Future mode: storage always billed, compute billed while running, capped at monthly.' },
    ],
    current_period: {
      machines: active.length,
      estimated_cost: estimatedCost,
    },
    usage: {
      compute_seconds: 0,
      storage_gb_seconds: 0,
    },
    plans: plansForRegion(input.region ?? 'hel1').map((plan) => ({
      id: plan.id,
      price_monthly: plan.priceMonthly,
    })),
  };
}

export async function getBillingComparisonV2(input: { plan: string; hoursPerDay: number }) {
  const plan = resolvePlanForDisplay(input.plan);
  if (!plan) throw new Error('Unknown plan');
  return {
    plan: plan.id,
    monthly_price: plan.priceMonthly,
    hours_per_day: input.hoursPerDay,
    competitors: {
      e2b_monthly_equivalent: monthlyEquivalent(plan.id, input.hoursPerDay, E2B_RATES),
      daytona_monthly_equivalent: monthlyEquivalent(plan.id, input.hoursPerDay, DAYTONA_RATES),
    },
  };
}
