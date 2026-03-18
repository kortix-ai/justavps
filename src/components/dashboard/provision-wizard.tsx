"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useProviders, useRegions, useServerTypes } from "@/hooks/use-server-types";
import { useCreateMachine } from "@/hooks/use-machines";
import { cn } from "@/lib/utils";
import { ArrowLeft, Check, Loader2, Cpu, MemoryStick, HardDrive, ChevronDown, Zap, Star, Rocket } from "lucide-react";
import Link from "next/link";

const REGION_MAP: Record<string, { flag: string; label: string }> = {
  hel1: { flag: "🇪🇺", label: "Europe" },
  fsn1: { flag: "🇪🇺", label: "Europe" },
  nbg1: { flag: "🇪🇺", label: "Europe" },
  hil:  { flag: "🇺🇸", label: "USA" },
  ash:  { flag: "🇺🇸", label: "USA" },
};

/* ─── Featured plans per region — 3 curated picks from the allowed list ─── */
const FEATURED_BY_REGION: Record<string, string[]> = {
  hel1: ["cpx22", "cpx32", "cpx42"],
  hil:  ["cpx11", "cpx21", "cpx31"],
};
const PLAN_LABELS = ["Starter", "Pro", "Power"] as const;
const PLAN_ICONS = [Zap, Star, Rocket] as const;
const PLAN_TAGLINES = ["Single agent, light workloads", "Best value for most workloads", "Heavy agents & parallel tasks"];

export function ProvisionWizard() {
  const router = useRouter();

  const { data: allProviders } = useProviders();
  const providers = allProviders ?? [];
  const [selectedProvider, setSelectedProvider] = useState("");

  const { data: regions } = useRegions(selectedProvider || undefined);
  const [selectedRegion, setSelectedRegion] = useState("");

  const { data: serverTypes } = useServerTypes(selectedProvider || undefined, selectedRegion || undefined);
  const [selectedServerType, setSelectedServerType] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [machineName, setMachineName] = useState("");

  const createMachine = useCreateMachine();

  // ── Auto-selects: provider → region → default plan ──
  useEffect(() => { if (providers.length >= 1 && !selectedProvider) setSelectedProvider(providers[0].name); }, [allProviders]);

  useEffect(() => { if (regions?.length && !selectedRegion) setSelectedRegion(regions[0].id); }, [regions]);

  // Default to Pro (middle featured plan)
  useEffect(() => {
    if (serverTypes?.length && !selectedServerType) {
      const names = FEATURED_BY_REGION[selectedRegion] ?? [];
      const mid = names[1];
      const match = mid ? serverTypes.find((s) => s.name === mid) : null;
      setSelectedServerType(match ? match.name : serverTypes[0].name);
    }
  }, [serverTypes]);

  const selectedST = serverTypes?.find((s) => s.name === selectedServerType);

  // Split featured vs custom
  const featuredNames = FEATURED_BY_REGION[selectedRegion] ?? FEATURED_BY_REGION.hel1;
  const featured = useMemo(
    () => featuredNames.map((name: string) => serverTypes?.find((s) => s.name === name)).filter(Boolean),
    [serverTypes, selectedRegion]
  );
  const customTypes = useMemo(
    () => serverTypes?.filter((s) => !featuredNames.includes(s.name)) ?? [],
    [serverTypes, selectedRegion]
  );

  const canCreate = selectedProvider && selectedRegion && selectedServerType;

  const handleCreate = () => {
    if (!canCreate) return;
    createMachine.mutate(
      { provider: selectedProvider, server_type: selectedServerType, region: selectedRegion, name: machineName || undefined },
      {
        onSuccess: (result) => {
          if (result.kind === "checkout") {
            toast.info("Redirecting to payment...");
            window.location.href = result.checkout.checkout_url;
            return;
          }
          toast.success("Machine created!");
          router.push(`/machines/${result.machine.id}`);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Link href="/machines" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="font-heading text-2xl tracking-tight">New Machine</h1>
      </div>

      {/* ═══ FEATURED PLANS — the star of the show ═══ */}
      {featured.length > 0 && (
        <div className="mb-6">
          <Field label="Choose your plan">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {featured.map((s, idx) => {
                if (!s) return null;
                const label = PLAN_LABELS[idx] || s.name;
                const Icon = PLAN_ICONS[idx] || Zap;
                const tagline = PLAN_TAGLINES[idx];
                const isMid = idx === 1;
                const active = selectedServerType === s.name;

                return (
                  <button
                    key={s.name}
                    onClick={() => { setSelectedServerType(s.name); setShowCustom(false); }}
                    className={cn(
                      "relative p-5 rounded-xl border text-left transition-all",
                      active
                        ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
                        : "hover:border-border hover:bg-muted/30"
                    )}
                  >
                    {isMid && (
                      <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-medium whitespace-nowrap">
                        Most Popular
                      </div>
                    )}

                    <div className="flex items-center gap-2 mb-3">
                      <div className={cn("p-1.5 rounded-lg", active ? "bg-primary/10" : "bg-muted/60")}>
                        <Icon className={cn("size-4", active ? "text-primary" : "text-muted-foreground")} />
                      </div>
                      <span className="font-medium text-sm">{label}</span>
                    </div>

                    <div className="mb-3">
                      <span className="text-3xl font-semibold tracking-tight">${s.price_monthly}</span>
                      <span className="text-sm text-muted-foreground">/mo</span>
                    </div>

                    <div className="space-y-1.5 text-xs text-muted-foreground">
                      <div className="flex items-center gap-2"><Cpu className="size-3" />{s.vcpu} vCPU</div>
                      <div className="flex items-center gap-2"><MemoryStick className="size-3" />{s.ram_gb} GB RAM</div>
                      <div className="flex items-center gap-2"><HardDrive className="size-3" />{s.disk_gb} GB SSD</div>
                    </div>

                    <p className="mt-3 text-[11px] text-muted-foreground/60">{tagline}</p>

                    {active && (
                      <div className="absolute top-3 right-3">
                        <div className="size-5 rounded-full bg-primary flex items-center justify-center">
                          <Check className="size-3 text-primary-foreground" />
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
      )}

      {/* ═══ CUSTOM SIZE — expandable ═══ */}
      {customTypes.length > 0 && (
        <div className="mb-6">
          <button
            onClick={() => setShowCustom(!showCustom)}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown className={cn("size-3.5 transition-transform", showCustom && "rotate-180")} />
            {showCustom ? "Hide custom sizes" : `Custom size (${customTypes.length} more options)`}
          </button>

          {showCustom && (
            <div className="space-y-4 mt-3">
            {/* Region picker inside custom */}
            {regions && regions.length > 1 && (
              <Field label="Region">
                <div className="flex flex-wrap gap-1.5">
                  {regions.map((r) => (
                    <Chip key={r.id} selected={selectedRegion === r.id} onClick={() => setSelectedRegion(r.id)}>
                      <span className="mr-1">{REGION_MAP[r.id]?.flag ?? "🌍"}</span>{REGION_MAP[r.id]?.label ?? r.city}
                    </Chip>
                  ))}
                </div>
              </Field>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {customTypes.map((s) => {
                const active = selectedServerType === s.name;
                return (
                  <button
                    key={s.name}
                    onClick={() => setSelectedServerType(s.name)}
                    className={cn(
                      "relative p-3 rounded-lg border text-left transition-colors",
                      active ? "border-primary/50 bg-primary/5" : "hover:bg-muted/40"
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={cn("font-mono text-xs", active && "text-primary font-medium")}>{s.name}</span>
                      <span className="text-sm font-semibold">${s.price_monthly}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1"><Cpu className="size-3" />{s.vcpu}</span>
                      <span className="flex items-center gap-1"><MemoryStick className="size-3" />{s.ram_gb}G</span>
                      <span className="flex items-center gap-1"><HardDrive className="size-3" />{s.disk_gb}G</span>
                    </div>
                  </button>
                );
              })}
            </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ DEPLOY ═══ */}
      {canCreate && (
        <div className="rounded-xl border p-5 space-y-4 bg-card">
          <Input
            placeholder="Machine name (optional)"
            value={machineName}
            onChange={(e) => setMachineName(e.target.value)}
          />
          <div className="flex items-center justify-between">
            <div>
              <span className="text-2xl font-semibold tracking-tight">${selectedST?.price_monthly}</span>
              <span className="text-sm text-muted-foreground">/mo</span>
              <div className="text-xs text-muted-foreground mt-0.5">
                {selectedST?.name} &middot; {selectedST?.vcpu} vCPU &middot; {selectedST?.ram_gb} GB &middot; {regions?.find((r) => r.id === selectedRegion)?.city}
              </div>
            </div>
            <Button size="lg" onClick={handleCreate} disabled={createMachine.isPending}>
              {createMachine.isPending ? <><Loader2 className="size-4 animate-spin" />Deploying...</> : "Deploy Machine"}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground/50 text-center">
            Running in 60 seconds. Daily backups included. Cancel anytime.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Primitives ──────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-md text-sm border transition-colors",
        selected ? "border-primary/50 bg-primary/5 font-medium" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
