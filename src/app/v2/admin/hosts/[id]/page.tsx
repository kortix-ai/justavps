"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Copy,
  Cpu,
  Database,
  ExternalLink,
  HardDrive,
  Loader2,
  MemoryStick,
  RefreshCw,
  Server,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";
import { cn } from "@/shared/lib/utils";
import {
  AdminEmptyState,
  AdminKpiCard,
  AdminKpiGrid,
  AdminMetric,
  AdminPageHeader,
  AdminSectionCard,
  AdminStatusPill,
  AdminUsageBar,
  relativeShort,
} from "@/v2/components/admin/primitives";
import {
  driftStatusTone,
  hostStatusTone,
  incusUiTone,
  machineStatusTone,
  maintenanceStateTone,
  validationStatusTone,
  type Tone,
} from "@/v2/components/admin/tones";
import { HostActionBar } from "@/v2/components/admin/host-action-bar";
import {
  useAdminHostDetail,
  useCleanupFleetHostOrphans,
  useUpdateFleetHostMaintenanceState,
  useUpdateFleetHostOperatorSettings,
  useUpdateFleetHostSchedulerState,
  type AdminHostDetailImageCached,
  type FleetHost,
  type FleetHostMaintenanceState,
} from "@/shared/hooks/use-fleet";

function reservationStateTone(state: string): Tone {
  switch (state) {
    case "committed":
      return "success";
    case "reserved":
      return "info";
    case "released":
      return "neutral";
    case "expired":
      return "warning";
    default:
      return "neutral";
  }
}

function imageAvailabilityTone(state: string): Tone {
  switch (state) {
    case "local":
      return "success";
    case "warming":
      return "warning";
    case "remote":
      return "info";
    case "error":
      return "danger";
    default:
      return "neutral";
  }
}

function backupStatusTone(status: string): Tone {
  switch (status) {
    case "ready":
      return "success";
    case "creating":
      return "warning";
    case "failed":
      return "danger";
    case "deleted":
      return "neutral";
    default:
      return "neutral";
  }
}

function formatSize(bytes: number | null | undefined) {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function AdminHostDetailPage() {
  const params = useParams();
  const rawId = params?.id;
  const id = Array.isArray(rawId) ? rawId[0] : typeof rawId === "string" ? rawId : undefined;
  const detailQuery = useAdminHostDetail(id);
  const data = detailQuery.data;
  const host = data?.host;

  const updateMaintenance = useUpdateFleetHostMaintenanceState();
  const cleanupOrphans = useCleanupFleetHostOrphans();
  const updateScheduler = useUpdateFleetHostSchedulerState();
  const updateOperator = useUpdateFleetHostOperatorSettings();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/v2/admin/hosts"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          All hosts
        </Link>
      </div>

      {detailQuery.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      ) : detailQuery.isError || !host || !data ? (
        <AdminEmptyState
          icon={Server}
          title="Could not load host"
          description={
            detailQuery.error instanceof Error
              ? detailQuery.error.message
              : "The host could not be loaded. It may have been deleted."
          }
          action={
            <Button size="sm" variant="outline" onClick={() => detailQuery.refetch()}>
              <RefreshCw className="mr-1.5 size-3.5" /> Retry
            </Button>
          }
        />
      ) : (
        <HostDetailContent
          host={host}
          data={data}
          isFetching={detailQuery.isFetching}
          onRefresh={() => detailQuery.refetch()}
          maintenancePending={updateMaintenance.isPending}
          onMaintenance={(state) =>
            updateMaintenance.mutate(
              { hostId: host.id, state },
              {
                onSuccess: () => {
                  toast.success(`${host.name} → ${state.replace(/_/g, " ")}`);
                  detailQuery.refetch();
                },
                onError: (err) => toast.error(err.message),
              },
            )
          }
          orphansPending={cleanupOrphans.isPending}
          onCleanupOrphans={() =>
            cleanupOrphans.mutate(host.id, {
              onSuccess: (d) => {
                toast.success(
                  `${host.name}: cleaned ${d.cleaned_instance_ids.length} orphan(s)`,
                );
                detailQuery.refetch();
              },
              onError: (err) => toast.error(err.message),
            })
          }
          schedulerPending={updateScheduler.isPending}
          onQuarantine={() =>
            updateScheduler.mutate(
              {
                hostId: host.id,
                schedulable: false,
                reason: "host manually quarantined by operator",
              },
              {
                onSuccess: () => {
                  toast.success(`${host.name} quarantined`);
                  detailQuery.refetch();
                },
                onError: (err) => toast.error(err.message),
              },
            )
          }
          onClearQuarantine={() =>
            updateScheduler.mutate(
              { hostId: host.id, schedulable: true },
              {
                onSuccess: () => {
                  toast.success(`${host.name} returned to scheduling`);
                  detailQuery.refetch();
                },
                onError: (err) => toast.error(err.message),
              },
            )
          }
          operatorPending={updateOperator.isPending}
          onDisableIncusUi={() =>
            updateOperator.mutate(
              { hostId: host.id, incusUiExposure: "disabled" },
              {
                onSuccess: () => {
                  toast.success(`${host.name} Incus UI disabled`);
                  detailQuery.refetch();
                },
                onError: (err) => toast.error(err.message),
              },
            )
          }
          onEnableOperatorIncusUi={() =>
            updateOperator.mutate(
              {
                hostId: host.id,
                incusUiExposure: "operator_only",
                incusUiUrl: host.public_ipv4 ? `https://${host.public_ipv4}:8443` : "",
              },
              {
                onSuccess: () => {
                  toast.success(`${host.name}: Incus UI enabled for operators`);
                  detailQuery.refetch();
                },
                onError: (err) => toast.error(err.message),
              },
            )
          }
        />
      )}
    </div>
  );
}

function HostDetailContent({
  host,
  data,
  isFetching,
  onRefresh,
  maintenancePending,
  onMaintenance,
  orphansPending,
  onCleanupOrphans,
  schedulerPending,
  onQuarantine,
  onClearQuarantine,
  operatorPending,
  onDisableIncusUi,
  onEnableOperatorIncusUi,
}: {
  host: FleetHost;
  data: NonNullable<ReturnType<typeof useAdminHostDetail>["data"]>;
  isFetching: boolean;
  onRefresh: () => void;
  maintenancePending: boolean;
  onMaintenance: (state: FleetHostMaintenanceState) => void;
  orphansPending: boolean;
  onCleanupOrphans: () => void;
  schedulerPending: boolean;
  onQuarantine: () => void;
  onClearQuarantine: () => void;
  operatorPending: boolean;
  onDisableIncusUi: () => void;
  onEnableOperatorIncusUi: () => void;
}) {
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [showOnlyCachedImages, setShowOnlyCachedImages] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(false);

  const vcpuPct =
    !host.total_vcpu || host.total_vcpu <= 0
      ? 0
      : Math.round((host.used_vcpu / host.total_vcpu) * 100);
  const memPct =
    !host.total_memory_gb || host.total_memory_gb <= 0
      ? 0
      : Math.round((host.used_memory_gb / host.total_memory_gb) * 100);
  const diskPct =
    !host.total_disk_gb || host.total_disk_gb <= 0
      ? 0
      : Math.round((host.used_disk_gb / host.total_disk_gb) * 100);

  const incusUiUrl =
    host.incus_ui.url ?? (host.public_ipv4 ? `https://${host.public_ipv4}:8443` : null);
  const hasIncusUi = host.incus_ui.exposure !== "disabled" && Boolean(incusUiUrl);

  const visibleImages = useMemo<AdminHostDetailImageCached[]>(() => {
    if (!showOnlyCachedImages) return data.images_cached;
    return data.images_cached.filter((img) => img.availability_state === "local");
  }, [data.images_cached, showOnlyCachedImages]);

  const visibleEvents = useMemo(
    () => (showAllEvents ? data.events : data.events.slice(0, 20)),
    [data.events, showAllEvents],
  );

  const probe = data.runner_probe;

  return (
    <>
      {/* Header card */}
      <AdminPageHeader
        icon={Server}
        title={host.name}
        description={`${host.vendor} · ${host.host_class} · ${host.region} · ${host.location}`}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => {
                navigator.clipboard.writeText(host.id).catch(() => {});
                toast.success("Host ID copied");
              }}
            >
              <Copy className="size-3.5" />
              Copy ID
            </Button>
            {hasIncusUi && incusUiUrl ? (
              <Link
                href={incusUiUrl}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  buttonVariants({ variant: "default", size: "sm" }),
                  "h-8 gap-1.5 text-xs",
                )}
              >
                <ExternalLink className="size-3.5" />
                Open Incus UI
              </Link>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={onRefresh}
              disabled={isFetching}
            >
              {isFetching ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Refresh
            </Button>
          </>
        }
      />

      <AdminSectionCard padding="tight">
        <div className="flex flex-wrap items-center gap-2">
          <AdminStatusPill tone={hostStatusTone(host.status)}>{host.status}</AdminStatusPill>
          <AdminStatusPill tone={maintenanceStateTone(host.maintenance_state)}>
            {host.maintenance_state.replace(/_/g, " ")}
          </AdminStatusPill>
          <AdminStatusPill tone={driftStatusTone(host.drift_status)}>
            drift {host.drift_status?.replace(/_/g, " ") ?? "unknown"}
          </AdminStatusPill>
          <AdminStatusPill tone={incusUiTone(host.incus_ui.exposure)}>
            incus ui {host.incus_ui.exposure?.replace(/_/g, " ") ?? "unset"}
          </AdminStatusPill>
          {host.scheduler.schedulable === false ? (
            <AdminStatusPill tone="danger">
              <ShieldCheck className="mr-1 size-3" /> quarantined
            </AdminStatusPill>
          ) : null}
        </div>

        <div className="mt-3">
          <HostActionBar
            host={host}
            maintenancePending={maintenancePending}
            onMaintenance={onMaintenance}
            orphansPending={orphansPending}
            onCleanupOrphans={onCleanupOrphans}
            schedulerPending={schedulerPending}
            onQuarantine={onQuarantine}
            onClearQuarantine={onClearQuarantine}
            operatorPending={operatorPending}
            onDisableIncusUi={onDisableIncusUi}
            onEnableOperatorIncusUi={onEnableOperatorIncusUi}
          />
        </div>
      </AdminSectionCard>

      {/* KPI row */}
      <AdminKpiGrid>
        <AdminKpiCard label="Region" value={host.region} hint={host.location} />
        <AdminKpiCard label="Location / DC" value={host.location} hint={host.host_class} />
        <AdminKpiCard icon={Cpu} label="Total vCPU" value={host.total_vcpu ?? 0} />
        <AdminKpiCard
          icon={MemoryStick}
          label="Total RAM"
          value={`${host.total_memory_gb ?? 0} GB`}
        />
      </AdminKpiGrid>

      {/* Runner probe card */}
      <AdminSectionCard
        title="Runner probe"
        description="Live check against the host's runnerd/Incus endpoint"
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={onRefresh}
            disabled={isFetching}
          >
            {isFetching ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Re-probe now
          </Button>
        }
      >
        {probe === null ? (
          <div className="text-sm text-muted-foreground">
            Runner is not registered for this host yet.
          </div>
        ) : probe.reachable ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <AdminStatusPill tone="success">
                <CheckCircle2 className="mr-1 size-3" /> reachable
              </AdminStatusPill>
              <span className="text-xs text-muted-foreground">
                checked {relativeShort(probe.checked_at)}
              </span>
            </div>
            <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <AdminMetric
                label="Incus status"
                value={probe.incus?.status ?? "unknown"}
              />
              <AdminMetric
                label="Server version"
                value={probe.incus?.server_version ?? "—"}
              />
              <AdminMetric label="Instances" value={probe.incus?.instance_count ?? 0} />
              <AdminMetric label="Images" value={probe.incus?.image_count ?? 0} />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <AdminStatusPill tone="danger">
                <XCircle className="mr-1 size-3" /> unreachable
              </AdminStatusPill>
              <span className="text-xs text-muted-foreground">
                checked {relativeShort(probe.checked_at)}
              </span>
            </div>
            {probe.error ? (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-700 dark:text-red-300">
                {probe.error}
              </div>
            ) : null}
          </div>
        )}
      </AdminSectionCard>

      {/* Usage grid */}
      <div className="grid gap-3 sm:grid-cols-3">
        <UsageBlock
          label="vCPU"
          icon={Cpu}
          used={host.used_vcpu}
          total={host.total_vcpu}
          pct={vcpuPct}
        />
        <UsageBlock
          label="Memory"
          icon={MemoryStick}
          used={host.used_memory_gb}
          total={host.total_memory_gb}
          pct={memPct}
          unit="GB"
        />
        <UsageBlock
          label="Disk"
          icon={HardDrive}
          used={host.used_disk_gb}
          total={host.total_disk_gb}
          pct={diskPct}
          unit="GB"
        />
      </div>

      {/* Drain report metrics */}
      <AdminSectionCard title="Drain report" description="Blockers that would prevent this host from being safely drained">
        <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-5">
          <AdminMetric label="Active machines" value={host.drain_report.active_machines} />
          <AdminMetric
            label="Stopped (disk retained)"
            value={host.drain_report.stopped_machines_retaining_disk}
          />
          <AdminMetric label="Active reservations" value={host.drain_report.active_reservations} />
          <AdminMetric
            label="Pending backup artifacts"
            value={host.drain_report.pending_backup_artifacts}
          />
          <AdminMetric label="Blockers total" value={host.drain_report.blockers_total} />
        </div>
      </AdminSectionCard>

      {/* Bootstrap validation */}
      <AdminSectionCard
        title="Bootstrap validation"
        description="Latest validation artifact recorded by the bootstrap process"
        actions={
          <Link
            href="#"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "h-7 gap-1.5 text-xs",
            )}
            aria-disabled
            onClick={(e) => {
              e.preventDefault();
              toast.info("Use the operator flow to record a new validation artifact");
            }}
          >
            Record validation artifact
          </Link>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <AdminStatusPill tone={validationStatusTone(host.bootstrap_validation.status)}>
              {host.bootstrap_validation.status ?? "pending"}
            </AdminStatusPill>
            <AdminStatusPill tone={validationStatusTone(host.bootstrap_validation.smoke_test_result)}>
              smoke {host.bootstrap_validation.smoke_test_result ?? "—"}
            </AdminStatusPill>
            <AdminStatusPill tone={validationStatusTone(host.bootstrap_validation.warm_pool_result)}>
              warm pool {host.bootstrap_validation.warm_pool_result ?? "—"}
            </AdminStatusPill>
          </div>
          <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <AdminMetric
              label="runnerd"
              value={host.bootstrap_validation.runnerd_version ?? "—"}
            />
            <AdminMetric
              label="Incus"
              value={host.bootstrap_validation.incus_version ?? "—"}
            />
            <AdminMetric
              label="Storage driver"
              value={host.bootstrap_validation.storage_driver ?? "—"}
            />
            <AdminMetric
              label="Storage pool"
              value={host.bootstrap_validation.storage_pool ?? "—"}
            />
          </div>
          {host.bootstrap_validation.notes.length > 0 ? (
            <div className="space-y-1 rounded-lg border bg-muted/20 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Notes
              </div>
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                {host.bootstrap_validation.notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </AdminSectionCard>

      {/* Machines on this host */}
      <AdminSectionCard
        title="Machines on this host"
        description={`${data.machines.length} active machine(s)`}
      >
        {data.machines.length === 0 ? (
          <AdminEmptyState icon={Server} title="No machines assigned" />
        ) : (
          <div className="space-y-1.5">
            {data.machines.map((machine) => (
              <Link
                key={machine.id}
                href={`/v2/admin/machines?highlight=${machine.id}`}
                className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/10 p-2.5 text-xs transition-colors hover:bg-muted/30"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{machine.slug}</span>
                    <AdminStatusPill tone={machineStatusTone(machine.status)}>
                      {machine.status}
                    </AdminStatusPill>
                  </div>
                  <div className="mt-0.5 truncate text-muted-foreground">
                    {machine.owner_email ?? machine.owner_user_id ?? "—"}
                  </div>
                </div>
                <div className="text-muted-foreground">
                  {machine.vcpu ?? 0} vCPU · {machine.memory_gb ?? 0} GB · {machine.disk_gb ?? 0} GB
                </div>
                <div className="text-muted-foreground">{machine.ip ?? "no ip"}</div>
                <div className="text-muted-foreground">
                  heartbeat {relativeShort(machine.last_heartbeat_at)}
                </div>
              </Link>
            ))}
          </div>
        )}
      </AdminSectionCard>

      {/* Recent events timeline */}
      <AdminSectionCard
        title="Recent events"
        description={`${data.events.length} most recent machine lifecycle events on this host`}
        actions={
          data.events.length > 20 ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              onClick={() => setShowAllEvents((s) => !s)}
            >
              {showAllEvents ? (
                <>
                  <ChevronDown className="size-3.5" /> Show less
                </>
              ) : (
                <>
                  <ChevronRight className="size-3.5" /> Show all ({data.events.length})
                </>
              )}
            </Button>
          ) : null
        }
      >
        {data.events.length === 0 ? (
          <AdminEmptyState icon={ChevronsUpDown} title="No events yet" />
        ) : (
          <ol className="space-y-1.5">
            {visibleEvents.map((evt) => (
              <li
                key={evt.id}
                className="flex flex-wrap items-start gap-2 rounded-lg border bg-muted/10 p-2 text-xs"
              >
                <span className="min-w-[70px] text-muted-foreground">
                  {relativeShort(evt.created_at)}
                </span>
                <AdminStatusPill tone="neutral">{evt.event}</AdminStatusPill>
                {evt.machine_slug ? (
                  <span className="font-medium">{evt.machine_slug}</span>
                ) : null}
                {evt.stage ? (
                  <span className="text-muted-foreground">stage: {evt.stage}</span>
                ) : null}
                {evt.message ? (
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {evt.message}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </AdminSectionCard>

      {/* Recent reservations */}
      <AdminSectionCard
        title="Recent reservations"
        description="Host capacity reservations scoped to this host"
      >
        {data.reservations.length === 0 ? (
          <AdminEmptyState icon={Database} title="No reservations recorded" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="p-2">Reservation</th>
                  <th className="p-2">Machine</th>
                  <th className="p-2">State</th>
                  <th className="p-2">Size</th>
                  <th className="p-2">Created</th>
                  <th className="p-2">Expires</th>
                  <th className="p-2">Committed</th>
                  <th className="p-2">Released</th>
                </tr>
              </thead>
              <tbody>
                {data.reservations.slice(0, 50).map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2 font-mono text-[11px]">{r.id.slice(0, 8)}</td>
                    <td className="p-2">{r.machine_slug ?? r.machine_id.slice(0, 8)}</td>
                    <td className="p-2">
                      <AdminStatusPill tone={reservationStateTone(r.state)}>
                        {r.state}
                      </AdminStatusPill>
                    </td>
                    <td className="p-2 text-muted-foreground">
                      {r.vcpu} vCPU · {r.memory_gb} GB · {r.disk_gb} GB
                    </td>
                    <td className="p-2 text-muted-foreground">{relativeShort(r.created_at)}</td>
                    <td className="p-2 text-muted-foreground">{relativeShort(r.expires_at)}</td>
                    <td className="p-2 text-muted-foreground">{relativeShort(r.committed_at)}</td>
                    <td className="p-2 text-muted-foreground">{relativeShort(r.released_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminSectionCard>

      {/* Backup artifacts */}
      <AdminSectionCard
        title="Backup artifacts from this host"
        description="Artifacts where source_host_id points to this host"
      >
        {data.backup_artifacts.length === 0 ? (
          <AdminEmptyState icon={Database} title="No backup artifacts from this host" />
        ) : (
          <div className="space-y-1.5">
            {data.backup_artifacts.map((artifact) => (
              <div
                key={artifact.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/10 p-2.5 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">
                      {artifact.display_name ?? artifact.source_machine_slug ?? artifact.id.slice(0, 8)}
                    </span>
                    <AdminStatusPill tone={backupStatusTone(artifact.status)}>
                      {artifact.status}
                    </AdminStatusPill>
                  </div>
                  <div className="mt-0.5 truncate text-muted-foreground">
                    {artifact.artifact_type}
                  </div>
                </div>
                <div className="text-muted-foreground">{formatSize(artifact.size_bytes)}</div>
                <div className="text-muted-foreground">
                  {relativeShort(artifact.created_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </AdminSectionCard>

      {/* Images cached on this host */}
      <AdminSectionCard
        title="Images cached on this host"
        description="Per-host image cache rows (baremetal_host_images)"
        actions={
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              className="size-3.5"
              checked={showOnlyCachedImages}
              onChange={(e) => setShowOnlyCachedImages(e.target.checked)}
            />
            Show only cached (local) images
          </label>
        }
      >
        {visibleImages.length === 0 ? (
          <AdminEmptyState
            icon={Database}
            title={showOnlyCachedImages ? "No local images" : "No image cache rows"}
          />
        ) : (
          <div className="space-y-1.5">
            {visibleImages.map((img) => (
              <div
                key={img.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/10 p-2.5 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">
                      {img.image_name ?? img.image_alias ?? img.image_ref}
                    </span>
                    <AdminStatusPill tone={imageAvailabilityTone(img.availability_state)}>
                      {img.availability_state}
                    </AdminStatusPill>
                  </div>
                  <div className="mt-0.5 truncate text-muted-foreground">{img.image_ref}</div>
                </div>
                <div className="text-muted-foreground">source: {img.source}</div>
                <div className="text-muted-foreground">
                  last seen {relativeShort(img.last_seen_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </AdminSectionCard>

      {/* Metadata dump */}
      <AdminSectionCard
        title="Metadata"
        description="Raw host.metadata for debugging"
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setMetadataOpen((o) => !o)}
          >
            {metadataOpen ? (
              <>
                <ChevronDown className="size-3.5" /> Hide
              </>
            ) : (
              <>
                <ChevronRight className="size-3.5" /> Show
              </>
            )}
          </Button>
        }
      >
        {metadataOpen ? (
          <pre className="max-h-[400px] overflow-auto rounded-lg border bg-muted/20 p-3 text-[11px] leading-snug">
            {JSON.stringify(host.metadata, null, 2)}
          </pre>
        ) : (
          <div className="text-xs text-muted-foreground">Click Show to expand.</div>
        )}
      </AdminSectionCard>
    </>
  );
}

function UsageBlock({
  label,
  icon: Icon,
  used,
  total,
  pct,
  unit,
}: {
  label: string;
  icon: typeof Cpu;
  used: number;
  total: number | null | undefined;
  pct: number;
  unit?: string;
}) {
  return (
    <div className="space-y-1.5 rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon className="size-3" />
          {label}
        </span>
        <span className="text-xs font-medium tabular-nums">{pct}%</span>
      </div>
      <div className="text-sm font-medium">
        {used}
        {unit ? ` ${unit}` : ""} / {total ?? 0}
        {unit ? ` ${unit}` : ""}
      </div>
      <AdminUsageBar used={used} total={total} />
    </div>
  );
}
