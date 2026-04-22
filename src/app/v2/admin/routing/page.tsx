"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Loader2,
  Network,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Wrench,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Skeleton } from "@/shared/ui/skeleton";
import { api, ApiError } from "@/shared/hooks/api-client";
import {
  AdminEmptyState,
  AdminFilterBar,
  AdminKpiCard,
  AdminKpiGrid,
  AdminPageHeader,
  AdminSectionCard,
  AdminStatusPill,
} from "@/v2/components/admin/primitives";

type MachineScan = {
  id: string;
  slug: string;
  status: string;
  owner_id: string | null;
  ip: string | null;
  kv_present: boolean;
  machine_dns_count: number;
  public_record_names: string[];
  wildcard_record_names: string[];
  origin_record_names: string[];
  legacy_origin_record_names: string[];
  drift: string[];
};

type ScanResponse = {
  summary: {
    total: number;
    active: number;
    deleted: number;
    drifted: number;
    missing_kv: number;
    legacy_machine_dns: number;
    stale_kv_keys: number;
    stale_public_dns: number;
    broker_dns_present: boolean;
    broker_bypass_route_present: boolean;
  };
  machines: MachineScan[];
  stale_kv: Array<{ key: string; slug: string; reason: string }>;
  stale_public_dns: Array<{ slug: string; reason: string }>;
  broker: {
    host: string;
    dns_present: boolean;
    bypass_route_present: boolean;
    bypass_pattern: string;
  };
};

const scanKey = ["admin", "routing", "scan"] as const;

function shortId(value: string | null | undefined) {
  if (!value) return "—";
  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function driftTone(drift: string): "danger" | "warning" | "neutral" {
  if (drift.includes("missing") || drift.includes("deleted_machine")) return "danger";
  return "warning";
}

export default function AdminRoutingPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const scan = useQuery({
    queryKey: scanKey,
    queryFn: () => api.get<ScanResponse>("/admin/routing/scan"),
  });

  const action = useMutation({
    mutationFn: async ({ path, body }: { path: string; body?: unknown }) => api.post(path, body),
    onSuccess: (data, vars) => {
      const count =
        typeof data === "object" && data && "count" in data
          ? Number((data as { count?: unknown }).count ?? 0)
          : null;
      const remaining =
        typeof data === "object" && data && "remaining" in data
          ? Number((data as { remaining?: unknown }).remaining ?? 0)
          : null;
      const suffix =
        count === null ? "" : ` (${count} processed${remaining ? `, ${remaining} remaining` : ""})`;
      setMessage(`Completed ${vars.path}${suffix}`);
      qc.invalidateQueries({ queryKey: scanKey });
    },
    onError: (error) => {
      setMessage(error instanceof ApiError ? error.message : "Action failed");
    },
  });

  const filteredMachines = useMemo(() => {
    const rows = scan.data?.machines ?? [];
    if (!search) return rows;
    const query = search.toLowerCase();
    return rows.filter((machine) =>
      machine.slug.toLowerCase().includes(query) ||
      machine.status.toLowerCase().includes(query) ||
      (machine.owner_id ?? "").toLowerCase().includes(query) ||
      (machine.ip ?? "").toLowerCase().includes(query) ||
      machine.drift.some((entry) => entry.toLowerCase().includes(query)),
    );
  }, [scan.data?.machines, search]);

  const summary = scan.data?.summary;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Network}
        title="Routing"
        description="Scan Worker routing state, broker bootstrap, machine KV drift, and leftover per-machine DNS."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => scan.refetch()}
              disabled={scan.isFetching || action.isPending}
            >
              {scan.isFetching ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              disabled={action.isPending}
              onClick={() => {
                if (!window.confirm("Backfill origin DNS and KV for all active machines?")) return;
                action.mutate({ path: "/admin/routing/backfill", body: { limit: 10 } });
              }}
            >
              <Wrench className="size-3.5" /> Backfill
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              disabled={action.isPending}
              onClick={() => {
                if (!window.confirm("Remove legacy public DNS records for all active machines?")) return;
                action.mutate({ path: "/admin/routing/cleanup-legacy-dns", body: { limit: 25 } });
              }}
            >
              <Trash2 className="size-3.5" /> Legacy DNS
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              disabled={action.isPending}
              onClick={() => {
                if (!window.confirm("Delete stale machine:* KV keys?")) return;
                action.mutate({ path: "/admin/routing/prune-stale-kv", body: { limit: 100 } });
              }}
            >
              <Trash2 className="size-3.5" /> Stale KV
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              disabled={action.isPending}
              onClick={() => {
                if (!window.confirm("Delete stray public DNS records for non-existent slugs?")) return;
                action.mutate({ path: "/admin/routing/cleanup-stale-public-dns", body: { limit: 25 } });
              }}
            >
              <Trash2 className="size-3.5" /> Stale DNS
            </Button>
          </>
        }
      />

      {message ? (
        <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
          {message}
        </div>
      ) : null}

      {scan.isLoading ? (
        <div className="space-y-4">
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
        </div>
      ) : scan.error ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-5 text-sm text-destructive">
          Failed to load routing state: {scan.error instanceof Error ? scan.error.message : "Unknown error"}
        </div>
      ) : (
        <>
          <AdminKpiGrid>
            <AdminKpiCard
              label="Machines"
              value={`${summary?.active ?? 0} / ${summary?.total ?? 0}`}
              hint="active / total"
            />
            <AdminKpiCard
              label="Drifted"
              value={summary?.drifted ?? 0}
              tone={(summary?.drifted ?? 0) > 0 ? "warning" : "success"}
            />
            <AdminKpiCard
              label="Missing KV"
              value={summary?.missing_kv ?? 0}
              tone={(summary?.missing_kv ?? 0) > 0 ? "danger" : "success"}
            />
            <AdminKpiCard
              label="Legacy machine DNS"
              value={summary?.legacy_machine_dns ?? 0}
              tone={(summary?.legacy_machine_dns ?? 0) > 0 ? "warning" : "success"}
            />
            <AdminKpiCard
              label="Stale KV keys"
              value={summary?.stale_kv_keys ?? 0}
              tone={(summary?.stale_kv_keys ?? 0) > 0 ? "warning" : "success"}
            />
            <AdminKpiCard
              label="Stale public DNS"
              value={summary?.stale_public_dns ?? 0}
              tone={(summary?.stale_public_dns ?? 0) > 0 ? "warning" : "success"}
            />
            <AdminKpiCard
              label="Broker DNS"
              value={summary?.broker_dns_present ? "present" : "missing"}
              tone={summary?.broker_dns_present ? "success" : "danger"}
            />
            <AdminKpiCard
              label="Broker bypass"
              value={summary?.broker_bypass_route_present ? "active" : "missing"}
              tone={summary?.broker_bypass_route_present ? "success" : "danger"}
            />
          </AdminKpiGrid>

          {scan.data?.broker.host ? (
            <AdminSectionCard
              title="Broker"
              actions={
                <AdminStatusPill tone={scan.data.broker.dns_present ? "success" : "danger"}>
                  DNS {scan.data.broker.dns_present ? "present" : "missing"}
                </AdminStatusPill>
              }
            >
              <div className="space-y-1 text-sm text-muted-foreground">
                <div>Host: <span className="font-mono">{scan.data.broker.host}</span></div>
                <div>
                  Worker bypass:{" "}
                  {scan.data.broker.bypass_route_present ? (
                    <span className="font-mono">{scan.data.broker.bypass_pattern}</span>
                  ) : (
                    <span className="text-red-600 dark:text-red-400">missing</span>
                  )}
                </div>
              </div>
            </AdminSectionCard>
          ) : null}

          <AdminFilterBar>
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by slug, status, owner, IP, or drift"
                className="pl-9"
              />
            </div>
          </AdminFilterBar>

          {scan.data && scan.data.stale_kv.length > 0 ? (
            <AdminSectionCard
              title="Stale KV keys"
              actions={
                <AdminStatusPill tone="warning">
                  <AlertTriangle className="mr-1 size-3" /> {scan.data.stale_kv.length}
                </AdminStatusPill>
              }
            >
              <div className="space-y-2">
                {scan.data.stale_kv.map((entry) => (
                  <div
                    key={entry.key}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="font-medium">{entry.key}</div>
                      <div className="text-muted-foreground">{entry.reason}</div>
                    </div>
                    <AdminStatusPill tone="neutral">{entry.slug}</AdminStatusPill>
                  </div>
                ))}
              </div>
            </AdminSectionCard>
          ) : null}

          {scan.data && scan.data.stale_public_dns.length > 0 ? (
            <AdminSectionCard
              title="Stale public DNS"
              actions={
                <AdminStatusPill tone="warning">
                  <AlertTriangle className="mr-1 size-3" /> {scan.data.stale_public_dns.length}
                </AdminStatusPill>
              }
            >
              <div className="space-y-2">
                {scan.data.stale_public_dns.map((entry) => (
                  <div
                    key={entry.slug}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="font-medium">{entry.slug}</div>
                      <div className="text-muted-foreground">{entry.reason}</div>
                    </div>
                    <AdminStatusPill tone="neutral">stray DNS</AdminStatusPill>
                  </div>
                ))}
              </div>
            </AdminSectionCard>
          ) : null}

          {filteredMachines.length === 0 ? (
            <AdminEmptyState
              icon={ShieldCheck}
              title="No matching machines"
              description="All routing state looks clean or no rows match your filter"
            />
          ) : (
            <div className="space-y-3">
              {filteredMachines.map((machine) => (
                <AdminSectionCard key={machine.id} padding="tight">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-heading text-lg tracking-tight">{machine.slug}</h3>
                        <AdminStatusPill tone={machine.status === "deleted" ? "danger" : "neutral"}>
                          {machine.status}
                        </AdminStatusPill>
                        {!machine.kv_present ? (
                          <AdminStatusPill tone="danger">missing KV</AdminStatusPill>
                        ) : null}
                        {machine.machine_dns_count > 0 ? (
                          <AdminStatusPill tone="warning">legacy machine DNS</AdminStatusPill>
                        ) : null}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        owner {shortId(machine.owner_id)} · {machine.ip ?? "no public IP"}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {machine.drift.length === 0 ? (
                          <AdminStatusPill tone="success">in sync</AdminStatusPill>
                        ) : (
                          machine.drift.map((entry) => (
                            <AdminStatusPill key={entry} tone={driftTone(entry)}>{entry}</AdminStatusPill>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        disabled={action.isPending}
                        onClick={() => {
                          if (!window.confirm(`Repair routing for ${machine.slug}?`)) return;
                          action.mutate({
                            path: "/admin/routing/repair-machine",
                            body: { slug: machine.slug },
                          });
                        }}
                      >
                        <Wrench className="size-3" /> Repair
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        disabled={action.isPending}
                        onClick={() => {
                          if (!window.confirm(`Remove legacy public DNS for ${machine.slug}?`)) return;
                          action.mutate({
                            path: "/admin/routing/remove-machine-legacy-dns",
                            body: { slug: machine.slug },
                          });
                        }}
                      >
                        <Trash2 className="size-3" /> Remove legacy DNS
                      </Button>
                    </div>
                  </div>

                  {(machine.public_record_names.length > 0 ||
                    machine.wildcard_record_names.length > 0 ||
                    machine.origin_record_names.length > 0 ||
                    machine.legacy_origin_record_names.length > 0) ? (
                    <div className="mt-3 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                      {[
                        ...machine.public_record_names,
                        ...machine.wildcard_record_names,
                        ...machine.origin_record_names,
                        ...machine.legacy_origin_record_names,
                      ].join(" , ")}
                    </div>
                  ) : null}
                </AdminSectionCard>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
