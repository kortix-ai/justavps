"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCw, ShieldCheck, Trash2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/hooks/api-client";
import { useAccount } from "@/hooks/use-account";

type MachineScan = {
  id: string;
  slug: string;
  status: string;
  owner_id: string;
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

function shortId(value: string) {
  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function driftTone(drift: string) {
  if (drift.includes("missing") || drift.includes("deleted_machine")) return "destructive" as const;
  return "secondary" as const;
}

export default function AdminRoutingPage() {
  const qc = useQueryClient();
  const { data: account, isLoading: accountLoading } = useAccount();
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const scan = useQuery({
    queryKey: scanKey,
    queryFn: () => api.get<ScanResponse>("/admin/routing/scan"),
    enabled: account?.is_admin === true,
  });

  const action = useMutation({
    mutationFn: async ({ path, body }: { path: string; body?: unknown }) => api.post(path, body),
    onSuccess: (data, vars) => {
      const count = typeof data === "object" && data && "count" in data ? Number((data as { count?: unknown }).count ?? 0) : null;
      const remaining = typeof data === "object" && data && "remaining" in data ? Number((data as { remaining?: unknown }).remaining ?? 0) : null;
      const suffix = count === null ? "" : ` (${count} processed${remaining ? `, ${remaining} remaining` : ""})`;
      setMessage(`Completed ${vars.path}${suffix}`);
      qc.invalidateQueries({ queryKey: scanKey });
    },
    onError: (error) => {
      const next = error instanceof ApiError ? error.message : "Action failed";
      setMessage(next);
    },
  });

  const filteredMachines = useMemo(() => {
    const rows = scan.data?.machines ?? [];
    if (!search) return rows;
    const query = search.toLowerCase();
    return rows.filter((machine) =>
      machine.slug.toLowerCase().includes(query) ||
      machine.status.toLowerCase().includes(query) ||
      machine.owner_id.toLowerCase().includes(query) ||
      (machine.ip ?? "").toLowerCase().includes(query) ||
      machine.drift.some((entry) => entry.toLowerCase().includes(query)),
    );
  }, [scan.data?.machines, search]);

  if (accountLoading) {
    return <Skeleton className="h-40 w-full rounded-2xl" />;
  }

  if (!account?.is_admin) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border p-8 text-center">
        <ShieldCheck className="mx-auto mb-4 size-10 text-muted-foreground" />
        <h1 className="font-heading text-3xl tracking-tight">Routing Admin</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page is restricted to admin accounts.
        </p>
      </div>
    );
  }

  const summary = scan.data?.summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-heading text-3xl tracking-tight">Routing Admin</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Scan Worker routing state, broker bootstrap status, machine KV drift, and leftover per-machine DNS.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => scan.refetch()} disabled={scan.isFetching || action.isPending}>
            {scan.isFetching ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Refresh Scan
          </Button>
          <Button
            variant="outline"
            disabled={action.isPending}
            onClick={() => {
              if (!window.confirm("Backfill origin DNS and KV for all active machines?")) return;
              action.mutate({ path: "/admin/routing/backfill", body: { limit: 10 } });
            }}
          >
            <Wrench className="size-4" />
            Backfill Active
          </Button>
          <Button
            variant="outline"
            disabled={action.isPending}
            onClick={() => {
              if (!window.confirm("Remove legacy public DNS records for all active machines?")) return;
              action.mutate({ path: "/admin/routing/cleanup-legacy-dns", body: { limit: 25 } });
            }}
          >
            <Trash2 className="size-4" />
            Clean Legacy DNS
          </Button>
          <Button
            variant="outline"
            disabled={action.isPending}
            onClick={() => {
              if (!window.confirm("Delete stale machine:* KV keys for deleted or missing machines?")) return;
              action.mutate({ path: "/admin/routing/prune-stale-kv", body: { limit: 100 } });
            }}
          >
            <Trash2 className="size-4" />
            Prune Stale KV
          </Button>
          <Button
            variant="outline"
            disabled={action.isPending}
            onClick={() => {
              if (!window.confirm("Delete stray public DNS records for slugs that no longer exist in the database?")) return;
              action.mutate({ path: "/admin/routing/cleanup-stale-public-dns", body: { limit: 25 } });
            }}
          >
            <Trash2 className="size-4" />
            Clean Stale DNS
          </Button>
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
          {message}
        </div>
      )}

      {scan.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : scan.error ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-5 text-sm text-destructive">
          Failed to load routing state: {scan.error instanceof Error ? scan.error.message : "Unknown error"}
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Machines", value: `${summary?.active ?? 0} active / ${summary?.total ?? 0} total` },
              { label: "Drifted", value: String(summary?.drifted ?? 0) },
              { label: "Missing KV", value: String(summary?.missing_kv ?? 0) },
              { label: "Legacy Machine DNS", value: String(summary?.legacy_machine_dns ?? 0) },
              { label: "Stale KV Keys", value: String(summary?.stale_kv_keys ?? 0) },
              { label: "Stale Public DNS", value: String(summary?.stale_public_dns ?? 0) },
              { label: "Broker DNS", value: summary?.broker_dns_present ? "present" : "missing" },
              { label: "Broker Bypass", value: summary?.broker_bypass_route_present ? "active" : "missing" },
              { label: "Deleted Machines", value: String(summary?.deleted ?? 0) },
              { label: "Filtered Rows", value: String(filteredMachines.length) },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border p-5">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{item.label}</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight">{item.value}</p>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border p-4">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter by slug, status, owner, IP, or drift"
            />
          </div>

          {scan.data?.broker.host && (
            <div className="rounded-2xl border p-5 text-sm">
              <div className="mb-3 flex items-center gap-2">
                <ShieldCheck className="size-4 text-emerald-500" />
                <h2 className="font-medium">Broker</h2>
              </div>
              <div className="space-y-1 text-muted-foreground">
                <div>host {scan.data.broker.host}</div>
                <div>DNS {scan.data.broker.dns_present ? "present" : "missing"}</div>
                <div>Worker bypass {scan.data.broker.bypass_route_present ? scan.data.broker.bypass_pattern : "missing"}</div>
              </div>
            </div>
          )}

          {scan.data && scan.data.stale_kv.length > 0 && (
            <div className="rounded-2xl border p-5">
              <div className="mb-4 flex items-center gap-2">
                <AlertTriangle className="size-4 text-brand" />
                <h2 className="font-medium">Stale KV Keys</h2>
              </div>
              <div className="space-y-2">
                {scan.data.stale_kv.map((entry) => (
                  <div key={entry.key} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-sm">
                    <div>
                      <div className="font-medium">{entry.key}</div>
                      <div className="text-muted-foreground">{entry.reason}</div>
                    </div>
                    <Badge variant="secondary">{entry.slug}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {scan.data && scan.data.stale_public_dns.length > 0 && (
            <div className="rounded-2xl border p-5">
              <div className="mb-4 flex items-center gap-2">
                <AlertTriangle className="size-4 text-brand" />
                <h2 className="font-medium">Stale Public DNS</h2>
              </div>
              <div className="space-y-2">
                {scan.data.stale_public_dns.map((entry) => (
                  <div key={entry.slug} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-sm">
                    <div>
                      <div className="font-medium">{entry.slug}</div>
                      <div className="text-muted-foreground">{entry.reason}</div>
                    </div>
                    <Badge variant="secondary">stray DNS</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            {filteredMachines.map((machine) => (
              <div key={machine.id} className="rounded-2xl border p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-heading text-xl tracking-tight">{machine.slug}</h2>
                      <Badge variant={machine.status === "deleted" ? "destructive" : "secondary"}>{machine.status}</Badge>
                      {!machine.kv_present && <Badge variant="destructive">missing KV</Badge>}
                      {machine.machine_dns_count > 0 && <Badge variant="secondary">legacy machine DNS</Badge>}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      owner {shortId(machine.owner_id)} · {machine.ip ?? "no public IP"}
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {machine.drift.length === 0 ? (
                        <Badge variant="secondary">in sync</Badge>
                      ) : (
                        machine.drift.map((entry) => (
                          <Badge key={entry} variant={driftTone(entry)}>{entry}</Badge>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <Button
                      variant="outline"
                      disabled={action.isPending}
                      onClick={() => {
                        if (!window.confirm(`Repair routing for ${machine.slug}?`)) return;
                        action.mutate({ path: "/admin/routing/repair-machine", body: { slug: machine.slug } });
                      }}
                    >
                      <Wrench className="size-4" />
                      Repair
                    </Button>
                    <Button
                      variant="outline"
                      disabled={action.isPending}
                      onClick={() => {
                        if (!window.confirm(`Remove legacy public DNS for ${machine.slug}?`)) return;
                        action.mutate({ path: "/admin/routing/remove-machine-legacy-dns", body: { slug: machine.slug } });
                      }}
                    >
                      <Trash2 className="size-4" />
                      Remove Legacy DNS
                    </Button>
                  </div>
                </div>

                {(machine.public_record_names.length > 0 || machine.wildcard_record_names.length > 0 || machine.origin_record_names.length > 0 || machine.legacy_origin_record_names.length > 0) && (
                  <div className="mt-4 rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
                    {[
                      ...machine.public_record_names,
                      ...machine.wildcard_record_names,
                      ...machine.origin_record_names,
                      ...machine.legacy_origin_record_names,
                    ].join(" , ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
