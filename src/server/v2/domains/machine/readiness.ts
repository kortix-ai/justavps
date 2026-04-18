import { deriveMachineRuntimeKind } from "@/server/v2/domains/machine/types";

export type MachineReadinessStrategy = 'daemon_heartbeat' | 'http_probe';

export function deriveMachineReadinessStrategy(input: {
  runtimeKind: ReturnType<typeof deriveMachineRuntimeKind>;
}): MachineReadinessStrategy {
  return input.runtimeKind === 'container_app_docker' ? 'http_probe' : 'daemon_heartbeat';
}

export function shouldMarkReadyFromHttpProbe(input: {
  runtimeKind: ReturnType<typeof deriveMachineRuntimeKind>;
  host: string | null | undefined;
  port: number | null | undefined;
}) {
  return deriveMachineReadinessStrategy({ runtimeKind: input.runtimeKind }) === 'http_probe'
    && Boolean(input.host)
    && Boolean(input.port);
}
