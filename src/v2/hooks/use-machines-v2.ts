import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, apiV2, ApiError } from "@/shared/hooks/api-client";
import type { Machine, CheckoutRequired, MachineMode } from "@/shared/lib/types";

type V2Machine = {
  id: string;
  slug: string;
  name: string;
  status: Machine["status"];
  provisioning_stage: string | null;
  provisioning_stage_updated_at: string | null;
  api_version: 'v2';
  machine_mode: MachineMode;
  requested_image_kind: 'golden' | 'catalog' | 'docker' | null;
  requested_image_ref: string | null;
  region: string;
  resources: { vcpu: number; ram_gb: number; disk_gb: number };
  billing: { mode: string; price_monthly: number | null };
  image: { id: string } | null;
  connectivity: {
    access: {
      mode: 'rest_exec';
      exec_endpoint: string;
    };
    urls: { proxy: string; terminal: string; port_template: string };
  };
  health: Machine["health"];
  capabilities?: NonNullable<Machine["capabilities"]>;
  provider_progress: number | null;
  provider_status: string | null;
  callback_expected: boolean | null;
  callback_url: string | null;
  created_at: string;
  ready_at: string | null;
};

function mapV2Machine(machine: V2Machine): Machine {
  const c = machine.connectivity;
  return {
    id: machine.id,
    slug: machine.slug,
    name: machine.name,
    status: machine.status,
    provisioning_stage: machine.provisioning_stage,
    provisioning_stage_updated_at: machine.provisioning_stage_updated_at,
    provider: "managed",
    api_version: machine.api_version,
    machine_mode: machine.machine_mode,
    requested_image_kind: machine.requested_image_kind,
    requested_image_ref: machine.requested_image_ref,
    image_id: machine.image?.id ?? null,
    server_type: `${machine.resources.vcpu}v-${machine.resources.ram_gb}g-${machine.resources.disk_gb}d`,
    region: machine.region,
    ip: null, // Never expose host IP via legacy field
    vcpu: machine.resources.vcpu,
    ram_gb: machine.resources.ram_gb,
    disk_gb: machine.resources.disk_gb,
    provider_progress: machine.provider_progress,
    provider_status: machine.provider_status,
    callback_expected: machine.callback_expected,
    callback_url: machine.callback_url,
    price_monthly: machine.billing.price_monthly,
    backups_enabled: false,
    created_at: machine.created_at,
    ready_at: machine.ready_at,
    daemon_version: null,
    urls: c.urls,
    access: {
      mode: c.access.mode,
      exec_endpoint: c.access.exec_endpoint,
      terminal_url: c.urls.terminal,
    },
    source: 'user',
    kortix_sandbox_id: null,
    subscription: null,
    health: machine.health,
    capabilities: machine.capabilities,
  };
}

const machineKeys = {
  all: ["v2", "machines"] as const,
  detail: (id: string) => ["v2", "machines", id] as const,
};

export function useMachines(options?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: machineKeys.all,
    queryFn: () => apiV2.get<{ machines: V2Machine[] }>("/machines").then((d) => d.machines.map(mapV2Machine)),
    refetchInterval: (query) => {
      // Explicit override from caller (e.g. post-checkout waiting)
      if (options?.refetchInterval !== undefined) return options.refetchInterval;
      // Auto-poll when any machine is provisioning so the list updates live
      const machines = query.state.data;
      if (machines?.some((m) => m.status === "provisioning")) return 500;
      return false;
    },
  });
}

export function useMachine(id: string) {
  return useQuery({
    queryKey: machineKeys.detail(id),
    queryFn: () => apiV2.get<V2Machine>(`/machines/${id}`).then(mapV2Machine),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "provisioning") return 250;
      if (status === "ready") return 10_000;
      return false;
    },
  });
}

interface CreateMachineInput {
  image_id?: string | null;
  docker_image?: string | null;
  server_type?: string;
  plan?: string;
  region: string;
  name?: string;
  billing_interval?: "monthly" | "yearly" | "2year";
  enable_backups?: boolean;
  /** V2 custom resource sizing */
  host_id?: string;
  machine_mode?: MachineMode;
  vcpu?: number;
  ram_gb?: number;
  disk_gb?: number;
}

/** Result of createMachine — either a Machine (provisioned) or a checkout redirect (needs payment) */
type CreateMachineResult =
  | { kind: "machine"; machine: Machine }
  | { kind: "checkout"; checkout: CheckoutRequired };

/**
 * Create a machine. If the user has no payment method on file, the API returns
 * 402 with a Stripe Checkout URL. The hook catches this and returns a typed
 * result so the caller can redirect — no second request needed.
 */
export function useCreateMachine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateMachineInput): Promise<CreateMachineResult> => {
        try {
          const machine = await apiV2.post<V2Machine>("/machines", {
            plan: input.plan || input.server_type || 'custom',
            region: input.region,
            name: input.name,
            image_id: input.image_id,
            docker_image: input.docker_image,
            billing_interval: input.billing_interval,
            billing_mode: 'flat_monthly',
            enable_backups: input.enable_backups,
            host_id: input.host_id,
            machine_mode: input.machine_mode,
            vcpu: input.vcpu,
            ram_gb: input.ram_gb,
            disk_gb: input.disk_gb,
          }).then(mapV2Machine);
          return { kind: "machine", machine };
        } catch (err) {
        if (err instanceof ApiError && err.status === 402 && err.data) {
          // The API returns { requires_checkout, checkout_url, message }
          return { kind: "checkout", checkout: err.data as unknown as CheckoutRequired };
        }
        throw err;
      }
    },
    onSuccess: (result) => {
      if (result.kind === "machine") {
        qc.setQueryData(machineKeys.detail(result.machine.id), result.machine);
        qc.invalidateQueries({ queryKey: machineKeys.all });
        qc.invalidateQueries({ queryKey: ["account", "limits"] });
      }
    },
  });
}

export function useDeleteMachine() {
  const qc = useQueryClient();
  return useMutation({
      mutationFn: (id: string) => apiV2.delete(`/machines/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: machineKeys.all });
      const previous = qc.getQueryData<Machine[]>(machineKeys.all);
      qc.setQueryData<Machine[]>(machineKeys.all, (old) =>
        old?.filter((m) => m.id !== id),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) qc.setQueryData(machineKeys.all, context.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: machineKeys.all });
      qc.invalidateQueries({ queryKey: ["account", "limits"] });
    },
  });
}

export function useRebootMachine() {
  return useMutation({
    mutationFn: (id: string) => apiV2.post(`/machines/${id}/reboot`),
  });
}

export function useStopMachine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiV2.post(`/machines/${id}/stop`),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: machineKeys.detail(id) });
      qc.invalidateQueries({ queryKey: machineKeys.all });
    },
  });
}

export function useStartMachine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiV2.post(`/machines/${id}/start`),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: machineKeys.detail(id) });
      qc.invalidateQueries({ queryKey: machineKeys.all });
    },
  });
}

interface ExecMachineInput {
  id: string;
  command: string;
  args?: string[];
  cwd?: string;
  env_vars?: Record<string, string>;
  user?: string;
  group?: string;
  timeout_ms?: number;
}

export function useExecMachine() {
  return useMutation({
    mutationFn: ({ id, ...body }: ExecMachineInput) => apiV2.post(`/machines/${id}/exec`, body),
  });
}

/** Cancel a machine subscription at the end of the current billing period */
export function useCancelMachine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiV2.post(`/machines/${id}/cancel`),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: machineKeys.detail(id) });
      qc.invalidateQueries({ queryKey: machineKeys.all });
    },
  });
}

/** Reactivate a machine subscription (reverse scheduled cancellation) */
export function useReactivateMachine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiV2.post(`/machines/${id}/reactivate`),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: machineKeys.detail(id) });
      qc.invalidateQueries({ queryKey: machineKeys.all });
    },
  });
}

interface ResizeInput {
  id: string;
  server_type: string;
}

interface ResizeResponse {
  action: 'resize';
  old_type: string;
  new_type: string;
  status: string;
}

function useResizeMachine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, server_type }: ResizeInput) =>
      api.post<ResizeResponse>(`/machines/${id}/resize`, { server_type }),
    onSuccess: (_data, { id }) => {
      // Optimistically mark the machine as provisioning/resizing so the UI
      // immediately shows the "Scaling in progress" banner without waiting for refetch.
      qc.setQueryData<Machine>(machineKeys.detail(id), (old) =>
        old
          ? {
              ...old,
              status: "provisioning",
              provisioning_stage: "resizing",
              provisioning_stage_updated_at: new Date().toISOString(),
            }
          : old,
      );
      qc.setQueryData<Machine[]>(machineKeys.all, (old) =>
        old?.map((m) =>
          m.id === id
            ? { ...m, status: "provisioning", provisioning_stage: "resizing" }
            : m,
        ),
      );
      // Then invalidate so both caches refresh from the server
      qc.invalidateQueries({ queryKey: machineKeys.detail(id) });
      qc.invalidateQueries({ queryKey: machineKeys.all });
    },
  });
}

// ─── Backups ────────────────────────────────────────────────────────────────

interface Backup {
  id: string;
  description: string;
  created: string;
  size: number;
  status: string;
  artifact_id?: string | null;
  artifact_status?: string | null;
  inventory_source?: 'provider' | 'database' | 'merged';
  storage_scope?: string | null;
  storage_url?: string | null;
  restore_count?: number;
  last_restore_at?: string | null;
  latest_restore?: BackupRestoreExecution | null;
}

interface BackupRestoreExecution {
  id: string;
  artifact_id: string;
  snapshot_id: string | null;
  snapshot_name: string | null;
  status: string;
  trigger_source: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  error: string | null;
  requested_by_user_id: string | null;
  source_host_id: string | null;
  target_host_id: string | null;
}

type V2Snapshot = {
  id: string;
  name: string;
  created_at: string;
  status: string;
  artifact_id?: string | null;
  artifact_status?: string | null;
  inventory_source?: 'provider' | 'database' | 'merged';
  storage_scope?: string | null;
  storage_url?: string | null;
  restore_count?: number;
  last_restore_at?: string | null;
  latest_restore?: BackupRestoreExecution | null;
};

type V2SnapshotInventoryResponse = {
  snapshots: V2Snapshot[];
  restore_executions: BackupRestoreExecution[];
  summary: {
    total_snapshots: number;
    ready_snapshots: number;
    deleted_snapshots: number;
    snapshots_with_restore_history: number;
    total_restores: number;
    failed_restores: number;
    last_restore_at: string | null;
  };
};

function mapV2Snapshot(snapshot: V2Snapshot): Backup {
  return {
    id: snapshot.id,
    description: snapshot.name,
    created: snapshot.created_at,
    size: 0,
    status: snapshot.status,
    artifact_id: snapshot.artifact_id ?? null,
    artifact_status: snapshot.artifact_status ?? null,
    inventory_source: snapshot.inventory_source,
    storage_scope: snapshot.storage_scope ?? null,
    storage_url: snapshot.storage_url ?? null,
    restore_count: snapshot.restore_count ?? 0,
    last_restore_at: snapshot.last_restore_at ?? null,
    latest_restore: snapshot.latest_restore ?? null,
  };
}

export function useBackups(machineId: string) {
  return useQuery({
    queryKey: ["backups", machineId] as const,
    queryFn: () => apiV2.get<V2SnapshotInventoryResponse>(`/snapshots/${machineId}`).then((d) => ({
      backups: d.snapshots.map(mapV2Snapshot),
      restore_executions: d.restore_executions,
      summary: d.summary,
      backups_enabled: true,
    })),
    refetchInterval: (query) => {
      const backups = query.state.data?.backups;
      const restoreExecutions = query.state.data?.restore_executions;
      if (backups?.some((b) => b.status === "creating") || restoreExecutions?.some((execution) => execution.status === 'running')) return 5_000;
      return 30_000;
    },
  });
}

export function useCreateBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ machineId, description }: { machineId: string; description?: string }) =>
      apiV2.post<V2Snapshot>(`/snapshots/${machineId}`, description ? { name: description } : {}).then((snapshot) => ({ backup_id: snapshot.id, status: snapshot.status })),
    onSuccess: (_data, { machineId }) => {
      qc.invalidateQueries({ queryKey: ["backups", machineId] });
    },
  });
}

function useToggleBackups() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ machineId, enable }: { machineId: string; enable: boolean }) => Promise.resolve({ machineId, enable }),
    onSuccess: (_data, { machineId }) => {
      qc.invalidateQueries({ queryKey: ["backups", machineId] });
      qc.invalidateQueries({ queryKey: machineKeys.detail(machineId) });
    },
  });
}

export function useRestoreBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ machineId, backupId }: { machineId: string; backupId: string }) =>
      apiV2.post<{ ok: true }>(`/snapshots/${machineId}/${backupId}/restore`),
    onSuccess: (_data, { machineId }) => {
      qc.invalidateQueries({ queryKey: machineKeys.detail(machineId) });
      qc.invalidateQueries({ queryKey: machineKeys.all });
    },
  });
}

export function useDeleteBackup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ machineId, backupId }: { machineId: string; backupId: string }) =>
      apiV2.delete(`/snapshots/${machineId}/${backupId}`),
    onSuccess: (_data, { machineId }) => {
      qc.invalidateQueries({ queryKey: ["backups", machineId] });
    },
  });
}
