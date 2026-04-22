"use client";

import { useMemo } from "react";
import { AlertTriangle, Loader2, Plug, RefreshCw } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";
import {
  AdminEmptyState,
  AdminKpiCard,
  AdminKpiGrid,
  AdminPageHeader,
  AdminSectionCard,
  AdminStatusPill,
  relativeShort,
} from "@/v2/components/admin/primitives";
import type { Tone } from "@/v2/components/admin/tones";
import { toneClasses } from "@/v2/components/admin/tones";
import { cn } from "@/shared/lib/utils";
import {
  useAdminIntegrationHealth,
  useProbeAdminIntegration,
  type AdminIntegrationBlock,
  type IntegrationStatus,
} from "@/shared/hooks/use-admin-integrations";
import { useFleetControlPlaneServices } from "@/shared/hooks/use-fleet";

function statusTone(status: IntegrationStatus): Tone {
  switch (status) {
    case "ok":
      return "success";
    case "degraded":
      return "warning";
    case "down":
      return "danger";
    case "not_configured":
    default:
      return "neutral";
  }
}

function statusDotClass(status: IntegrationStatus): string {
  switch (status) {
    case "ok":
      return "bg-emerald-500";
    case "degraded":
      return "bg-yellow-500";
    case "down":
      return "bg-red-500";
    case "not_configured":
    default:
      return "bg-muted-foreground/40";
  }
}

function formatContextValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value || "—";
  if (typeof value === "number") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export default function AdminIntegrationsPage() {
  const healthQuery = useAdminIntegrationHealth();
  const probe = useProbeAdminIntegration();
  const services = useFleetControlPlaneServices();

  const integrations = useMemo(
    () => healthQuery.data?.integrations ?? [],
    [healthQuery.data?.integrations],
  );

  const kpis = useMemo(() => {
    const total = integrations.length;
    const ok = integrations.filter((i) => i.status === "ok").length;
    const degraded = integrations.filter((i) => i.status === "degraded").length;
    const down = integrations.filter((i) => i.status === "down").length;
    const notConfigured = integrations.filter((i) => i.status === "not_configured").length;
    return { total, ok, degraded, down, notConfigured };
  }, [integrations]);

  const staleCriticalServices = useMemo(() => {
    return (services.data ?? []).filter((s) => s.critical && s.stale);
  }, [services.data]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Plug}
        title="Integrations"
        description="Upstream service health + credential status. Live probes of Stripe, Hetzner, Cloudflare, database, SMTP."
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => healthQuery.refetch()}
            disabled={healthQuery.isFetching}
          >
            {healthQuery.isFetching ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Probe all now
          </Button>
        }
      />

      <AdminKpiGrid>
        <AdminKpiCard label="Total" value={kpis.total} />
        <AdminKpiCard
          label="OK"
          value={kpis.ok}
          tone={kpis.ok > 0 ? "success" : "neutral"}
        />
        <AdminKpiCard
          label="Degraded"
          value={kpis.degraded}
          tone={kpis.degraded > 0 ? "warning" : "success"}
        />
        <AdminKpiCard
          label="Down"
          value={kpis.down}
          tone={kpis.down > 0 ? "danger" : "success"}
        />
        <AdminKpiCard
          label="Not configured"
          value={kpis.notConfigured}
          tone="neutral"
        />
      </AdminKpiGrid>

      {healthQuery.isLoading ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-2xl" />
          ))}
        </div>
      ) : integrations.length === 0 ? (
        <AdminEmptyState icon={Plug} title="No integrations probed" />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {integrations.map((block) => (
            <IntegrationCard
              key={block.id}
              block={block}
              isProbing={probe.isPending && probe.variables === block.id}
              onProbe={() => probe.mutate(block.id)}
            />
          ))}
        </div>
      )}

      <AdminSectionCard
        title="Recent control plane activity"
        description="Critical reconciler services that haven't completed recently — often the first signal that an upstream is flapping."
      >
        {services.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-xl" />
            ))}
          </div>
        ) : staleCriticalServices.length === 0 ? (
          <div className="rounded-lg border bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-400">
            All critical services are fresh.
          </div>
        ) : (
          <div className="divide-y">
            {staleCriticalServices.map((s) => (
              <div
                key={s.id}
                className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">{s.service}</div>
                  <div className="text-xs text-muted-foreground">
                    scope: {s.scope} · {s.mode}
                  </div>
                  {s.description ? (
                    <div className="mt-0.5 text-[11px] text-muted-foreground/70">
                      {s.description}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <AdminStatusPill tone="warning">stale</AdminStatusPill>
                  <div className="text-[11px] text-muted-foreground">
                    last run {relativeShort(s.last_completed_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </AdminSectionCard>
    </div>
  );
}

function IntegrationCard({
  block,
  isProbing,
  onProbe,
}: {
  block: AdminIntegrationBlock;
  isProbing: boolean;
  onProbe: () => void;
}) {
  const tone = statusTone(block.status);
  const contextEntries = Object.entries(block.context);
  return (
    <section className="rounded-2xl border bg-card">
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "mt-1.5 inline-block size-2.5 shrink-0 rounded-full",
              statusDotClass(block.status),
            )}
            aria-hidden
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium">{block.label}</h3>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {block.id}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <AdminStatusPill tone={tone}>{block.status.replace("_", " ")}</AdminStatusPill>
              {block.probe_ms !== null ? <span>{block.probe_ms} ms</span> : null}
              <span>checked {relativeShort(block.checked_at)}</span>
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 gap-1.5 px-2.5 text-xs"
          onClick={onProbe}
          disabled={isProbing}
        >
          {isProbing ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RefreshCw className="size-3" />
          )}
          Re-probe
        </Button>
      </header>
      <div className="space-y-3 p-4">
        {contextEntries.length > 0 ? (
          <dl className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
            {contextEntries.map(([key, value]) => (
              <div key={key} className="flex min-w-0 items-start justify-between gap-2">
                <dt className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  {key}
                </dt>
                <dd className="truncate text-right font-medium">
                  {formatContextValue(value)}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {block.error ? (
          <div
            className={cn(
              "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
              toneClasses("danger"),
            )}
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <div>
              <div className="font-medium">Probe error</div>
              <div className="mt-0.5 break-words text-[11px] opacity-90">{block.error}</div>
            </div>
          </div>
        ) : null}
        {!block.configured ? (
          <div className="rounded-lg border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            Credentials not configured. Set the appropriate env vars to enable this probe.
          </div>
        ) : null}
      </div>
    </section>
  );
}

