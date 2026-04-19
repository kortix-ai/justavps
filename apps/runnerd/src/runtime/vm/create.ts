export function buildVmCreateMetadata(input: {
  status: string | null;
  machineMode: 'vm' | 'container';
  scenario: 'cold_create' | 'user_image_cold_create';
  totalMs: number | null;
}) {
  return {
    incus_status: input.status,
    machine_mode: input.machineMode,
    benchmark: {
      scenario: input.scenario,
      total_ms: input.totalMs,
    },
  };
}

export function buildWarmPoolVmCreateMetadata(input: {
  machineMode: 'vm' | 'container';
  totalMs: number;
}) {
  return {
    incus_status: 'Running',
    warm_pool: true,
    machine_mode: input.machineMode,
    benchmark: {
      scenario: 'warm_pool_start',
      total_ms: input.totalMs,
    },
  };
}

export function buildWarmPoolPrefix() {
  return 'justavps-warm-cpu';
}

export function buildWarmPoolVmName(input: {
  prefix: string;
  cpu: number;
  suffix: string;
}) {
  return `${input.prefix}${input.cpu}-${input.suffix}`;
}

export async function checkVmAgentReady(input: {
  name: string;
  runIncus: (args: string[], timeoutMs?: number) => Promise<{ stdout: string; stderr: string }>;
  incusTarget: (name?: string) => string;
  inspectInstance: (input: { instanceName: string }) => Promise<{ privateIpv4: string | null }>;
}) {
  try {
    await input.runIncus(['exec', input.incusTarget(input.name), '--', 'true'], 3000);
    const inspected = await input.inspectInstance({ instanceName: input.name });
    return { ready: true, ip: inspected.privateIpv4 };
  } catch {
    return { ready: false, ip: null };
  }
}
