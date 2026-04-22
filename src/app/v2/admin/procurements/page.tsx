"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Loader2, Plus, RefreshCw, Search, ShoppingBag, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Skeleton } from "@/shared/ui/skeleton";
import { toast } from "sonner";
import {
  AdminEmptyState,
  AdminFilterBar,
  AdminKpiCard,
  AdminKpiGrid,
  AdminMetric,
  AdminPageHeader,
  AdminSectionCard,
  AdminStatusPill,
  TipButton,
  relativeShort,
} from "@/v2/components/admin/primitives";
import { procurementStatusTone } from "@/v2/components/admin/tones";
import {
  useApproveProcurement,
  useCreateProcurement,
  useFleetHetznerProducts,
  useFleetProcurementRecommendations,
  useFleetProcurements,
  useSyncProcurement,
  type FleetHetznerProduct,
} from "@/shared/hooks/use-fleet";
export default function AdminProcurementsPage() {
  const procurementsQuery = useFleetProcurements();
  const recommendationsQuery = useFleetProcurementRecommendations();
  const approve = useApproveProcurement();
  const sync = useSyncProcurement();
  const createProcurement = useCreateProcurement();

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const [orderOpen, setOrderOpen] = useState(false);
  const [orderProductId, setOrderProductId] = useState<string>("");
  const [orderRequiresApproval, setOrderRequiresApproval] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);

  const productsQuery = useFleetHetznerProducts(orderOpen);
  const selectedProduct = useMemo(
    () => productsQuery.data?.find((p) => p.id === orderProductId),
    [productsQuery.data, orderProductId],
  );

  const procurements = useMemo(() => procurementsQuery.data ?? [], [procurementsQuery.data]);
  const recommendations = useMemo(
    () => recommendationsQuery.data ?? [],
    [recommendationsQuery.data],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return procurements.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (!q) return true;
      return (
        p.product_id.toLowerCase().includes(q) ||
        p.location.toLowerCase().includes(q) ||
        p.host_class.toLowerCase().includes(q) ||
        (p.provider_transaction_id ?? "").toLowerCase().includes(q)
      );
    });
  }, [procurements, search, statusFilter]);

  const openCount = procurements.filter((p) => p.resolved_at === null).length;
  const awaitingApproval = procurements.filter((p) => p.status === "requested").length;

  const activeFilterCount = (search ? 1 : 0) + (statusFilter !== "all" ? 1 : 0);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={ShoppingBag}
        title="Procurements"
        description="Order new Hetzner bare-metal hosts, track orders in flight, and approve staged ones."
        actions={
          <>
            <Button
              variant="default"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setOrderOpen(true)}
            >
              <Plus className="size-3.5" />
              Order a host
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => {
                procurementsQuery.refetch();
                recommendationsQuery.refetch();
              }}
              disabled={procurementsQuery.isFetching || recommendationsQuery.isFetching}
            >
              {procurementsQuery.isFetching || recommendationsQuery.isFetching ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Refresh
            </Button>
          </>
        }
      />

      <Dialog open={orderOpen} onOpenChange={setOrderOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Order a host</DialogTitle>
            <DialogDescription>
              Places a dedicated-server order with Hetzner Robot. Hetzner allocates a physical box
              (usually minutes, sometimes hours) — our fleet-auditor polls them automatically and
              promotes the host through <code>ordering → bootstrapping → active</code> as things
              progress. You don&apos;t need to click anything after approval.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label>Hetzner product</Label>
              {productsQuery.isError || (!productsQuery.isLoading && !productsQuery.data?.length) ? (
                <>
                  <Input
                    value={orderProductId}
                    onChange={(e) => setOrderProductId(e.target.value)}
                    placeholder="e.g. AX41-NVMe"
                  />
                  <div className="text-[11px] text-muted-foreground">
                    Hetzner catalog unavailable — enter the product ID manually. (Check HETZNER_ROBOT_* env vars.)
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  disabled={productsQuery.isLoading}
                  className="flex w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-left text-sm shadow-xs transition-colors hover:bg-muted/30 disabled:opacity-50"
                >
                  {productsQuery.isLoading ? (
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" /> Loading catalog from Hetzner…
                    </span>
                  ) : selectedProduct ? (
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{selectedProduct.id}</span>
                      <span className="ml-2 text-muted-foreground">{selectedProduct.name}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Browse Hetzner catalog…</span>
                  )}
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
              )}
              {selectedProduct?.location?.length ? (
                <div className="text-[11px] text-muted-foreground">
                  Available in: {selectedProduct.location.join(", ")} · first available datacenter will be used automatically.
                </div>
              ) : null}
            </div>
            <label className="flex items-start gap-2 rounded-lg border bg-muted/20 p-2.5 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={orderRequiresApproval}
                onChange={(e) => setOrderRequiresApproval(e.target.checked)}
              />
              <span>
                <span className="font-medium">Require approval step</span>
                <br />
                <span className="text-muted-foreground">
                  When checked, the order stages in <code>requested</code> status and waits for you
                  to click <b>Approve</b> below. Uncheck for a true one-click order (spends money
                  immediately).
                </span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOrderOpen(false)} disabled={createProcurement.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                createProcurement.mutate(
                  {
                    product_id: orderProductId.trim(),
                    vendor: "hetzner_robot",
                    requires_approval: orderRequiresApproval,
                  },
                  {
                    onSuccess: (data) => {
                      toast.success(
                        orderRequiresApproval
                          ? `Order queued (${data.procurement.id.slice(0, 8)}…). Approve it below.`
                          : `Order placed with Hetzner. Track progress here.`,
                      );
                      setOrderOpen(false);
                      setOrderProductId("");
                    },
                    onError: (err) => toast.error(err.message),
                  },
                )
              }
              disabled={createProcurement.isPending || !orderProductId.trim()}
            >
              {createProcurement.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : orderRequiresApproval ? (
                "Queue order"
              ) : (
                "Place order now"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <HetznerProductPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        products={productsQuery.data ?? []}
        selectedId={orderProductId}
        onSelect={(id) => {
          setOrderProductId(id);
          setPickerOpen(false);
        }}
      />

      <AdminKpiGrid>
        <AdminKpiCard icon={ShoppingBag} label="Total procurements" value={procurements.length} />
        <AdminKpiCard label="Open" value={openCount} tone={openCount > 0 ? "info" : "neutral"} />
        <AdminKpiCard
          label="Awaiting approval"
          value={awaitingApproval}
          tone={awaitingApproval > 0 ? "warning" : "neutral"}
        />
        <AdminKpiCard label="Recommendations" value={recommendations.length} />
      </AdminKpiGrid>

      <AdminSectionCard
        title="Recommendations"
        description="Reserve-aware capacity suggestions from the planner"
      >
        {recommendationsQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
        ) : recommendations.length === 0 ? (
          <AdminEmptyState
            title="No recommendations right now"
            description="Capacity is healthy across all regions"
          />
        ) : (
          <div className="space-y-2">
            {recommendations.map((rec) => (
              <div key={rec.id} className="rounded-lg border p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">{rec.region_label}</div>
                    <div className="text-xs text-muted-foreground">{rec.region} · {rec.current_host_class}</div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <AdminStatusPill tone="neutral">{rec.current_host_class}</AdminStatusPill>
                    <AdminStatusPill tone="info">→ {rec.recommended_host_class}</AdminStatusPill>
                  </div>
                </div>
                <p className="text-sm">{rec.summary}</p>
                <div className="grid gap-3 text-xs sm:grid-cols-4">
                  <AdminMetric label="Shortfall vCPU" value={rec.reserve_shortfall_vcpu} />
                  <AdminMetric label="Shortfall memory" value={`${rec.reserve_shortfall_memory_gb} GB`} />
                  <AdminMetric label="Shortfall disk" value={`${rec.reserve_shortfall_disk_gb} GB`} />
                  <AdminMetric label="Minimum hosts" value={rec.minimum_hosts} />
                </div>
                {rec.notes.length > 0 ? (
                  <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-0.5">
                    {rec.notes.map((note) => <li key={note}>{note}</li>)}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </AdminSectionCard>

      <AdminFilterBar>
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search product, location, class"
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="requested">Requested</SelectItem>
            <SelectItem value="ordered">Ordered</SelectItem>
            <SelectItem value="provisioning">Provisioning</SelectItem>
            <SelectItem value="bootstrapping">Bootstrapping</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
        {activeFilterCount > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => {
              setSearch("");
              setStatusFilter("all");
            }}
          >
            <X className="size-3" /> Clear ({activeFilterCount})
          </Button>
        ) : null}
      </AdminFilterBar>

      <AdminSectionCard title="History" description="All Hetzner procurement requests">
        {procurementsQuery.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <AdminEmptyState title="No procurements match these filters" />
        ) : (
          <div className="space-y-2">
            {filtered.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">{p.product_id}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {p.location} · {p.host_class} · created {relativeShort(p.created_at)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground/70 break-all">
                    {p.provider_transaction_id ?? p.id}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <AdminStatusPill tone={procurementStatusTone(p.status)}>{p.status}</AdminStatusPill>
                  <div className="flex gap-1.5">
                    {p.status === "requested" ? (
                      <TipButton
                        label="Approve"
                        variant="default"
                        explanation="Approves and places the Hetzner Robot order. This SPENDS MONEY — Hetzner will bill for a new dedicated server. Irreversible once the order is placed with the vendor."
                        pending={approve.isPending}
                        onClick={() =>
                          approve.mutate(p.id, {
                            onSuccess: () => toast.success("Procurement approved"),
                            onError: (err) => toast.error(err.message),
                          })
                        }
                      />
                    ) : null}
                    {p.provider_transaction_id && p.status !== 'active' && p.status !== 'failed' && p.status !== 'cancelled' ? (
                      <TipButton
                        label="Sync now"
                        variant="ghost"
                        icon={<RefreshCw className="size-3" />}
                        explanation="Force a fresh poll of Hetzner Robot for this order. Normally the fleet-auditor background service syncs every pass automatically — use this only if you want to check right now."
                        pending={sync.isPending}
                        onClick={() =>
                          sync.mutate(p.id, {
                            onSuccess: () => toast.success("Procurement synced"),
                            onError: (err) => toast.error(err.message),
                          })
                        }
                      />
                    ) : null}
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

function HetznerProductPicker({
  open,
  onClose,
  products,
  selectedId,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  products: FleetHetznerProduct[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [locFilter, setLocFilter] = useState<string>("all");

  const locations = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) for (const l of p.location ?? []) set.add(l);
    return Array.from(set).sort();
  }, [products]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (locFilter !== "all" && !(p.location?.includes(locFilter) ?? true)) return false;
      if (!q) return true;
      return (
        p.id.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        (p.description ?? []).some((d) => d.toLowerCase().includes(q))
      );
    });
  }, [products, locFilter, query]);

  function priceFor(p: FleetHetznerProduct) {
    const byLoc = locFilter !== "all" ? p.prices?.find((x) => x.location === locFilter) : null;
    const first = byLoc ?? p.prices?.[0];
    return first ? `€${Number(first.monthly_net).toFixed(2)}/mo` : null;
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Hetzner product catalog</DialogTitle>
          <DialogDescription>
            Live-fetched from Hetzner Robot. Pick a dedicated-server SKU for your order.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 py-1">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search id, name, specs (e.g. AX41, Ryzen, 64GB)"
              className="pl-9"
            />
          </div>
          <Select value={locFilter} onValueChange={(v) => setLocFilter(v ?? "all")}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All locations</SelectItem>
              {locations.map((l) => (
                <SelectItem key={l} value={l}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
          {filtered.length === 0 ? (
            <AdminEmptyState title="No products match these filters" />
          ) : (
            filtered.map((p) => {
              const price = priceFor(p);
              const selected = p.id === selectedId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onSelect(p.id)}
                  className={`flex w-full flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors hover:border-foreground/30 hover:bg-muted/30 ${
                    selected ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-sm font-semibold">{p.id}</span>
                      <span className="truncate text-sm text-muted-foreground">{p.name}</span>
                    </div>
                    {price ? (
                      <span className="text-sm font-medium tabular-nums">{price}</span>
                    ) : null}
                  </div>
                  {p.description && p.description.length > 0 ? (
                    <div className="text-xs text-muted-foreground">
                      {p.description.join(" · ")}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    {(p.location ?? []).map((l) => (
                      <span key={l} className="rounded border bg-background px-1.5 py-0.5 font-mono">
                        {l}
                      </span>
                    ))}
                    {p.traffic ? (
                      <span className="rounded border bg-background px-1.5 py-0.5">
                        {p.traffic}
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
