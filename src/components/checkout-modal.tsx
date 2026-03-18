"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useProviders, useRegions, useServerTypes } from "@/hooks/use-server-types";
import { useCreateMachine } from "@/hooks/use-machines";
import { toast } from "sonner";
import { X, Check, Loader2, Cpu, MemoryStick, HardDrive, Zap, Star, Rocket, ArrowRight } from "lucide-react";

/* ═══ Config ═══ */
const FEATURED_BY_REGION: Record<string, string[]> = {
  hel1: ["cpx22", "cpx32", "cpx42"],
  hil: ["cpx11", "cpx21", "cpx31"],
};
const PLAN_LABELS = ["Starter", "Pro", "Power"] as const;
const PLAN_ICONS = [Zap, Star, Rocket] as const;
const PLAN_TAGLINES = ["Light workloads", "Most workloads", "Heavy & parallel"] as const;

const REGION_MAP: Record<string, { flag: string; label: string }> = {
  hel1: { flag: "🇪🇺", label: "Europe" },
  fsn1: { flag: "🇪🇺", label: "Europe" },
  nbg1: { flag: "🇪🇺", label: "Europe" },
  hil: { flag: "🇺🇸", label: "USA" },
  ash: { flag: "🇺🇸", label: "USA" },
};

const INCLUDED = [
  "SSH access", "Browser IDE", "Web terminal", "Auth proxy",
  "Daily backups", "Docker", "Claude Code / OpenCode", "sandbox-agent SDK",
];

/* ═══ Component ═══ */
interface CheckoutModalProps { open: boolean; onClose: () => void }

export function CheckoutModal({ open, onClose }: CheckoutModalProps) {
  const { data: session } = useSession();
  const isLoggedIn = !!session?.user;

  const { data: allProviders } = useProviders();
  const providers = allProviders ?? [];
  const [selectedProvider, setSelectedProvider] = useState("");
  const { data: regions } = useRegions(selectedProvider || undefined);
  const [selectedRegion, setSelectedRegion] = useState("");
  const { data: serverTypes } = useServerTypes(selectedProvider || undefined, selectedRegion || undefined);
  const [selectedServerType, setSelectedServerType] = useState("");
  const createMachine = useCreateMachine();

  useEffect(() => { if (providers.length >= 1 && !selectedProvider) setSelectedProvider(providers[0].name); }, [providers, selectedProvider]);
  useEffect(() => { if (regions?.length && !selectedRegion) setSelectedRegion(regions[0].id); }, [regions, selectedRegion]);
  useEffect(() => {
    if (serverTypes?.length && !selectedServerType) {
      const names = FEATURED_BY_REGION[selectedRegion] ?? FEATURED_BY_REGION.hel1;
      const mid = names[1];
      const match = mid ? serverTypes.find((s) => s.name === mid) : null;
      setSelectedServerType(match ? match.name : serverTypes[0].name);
    }
  }, [serverTypes, selectedRegion, selectedServerType]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => { window.removeEventListener("keydown", handleKey); };
  }, [open, onClose]);

  const selectedST = serverTypes?.find((s) => s.name === selectedServerType);
  const featuredNames = FEATURED_BY_REGION[selectedRegion] ?? FEATURED_BY_REGION.hel1;
  const featured = useMemo(
    () => featuredNames.map((name) => serverTypes?.find((s) => s.name === name)).filter(Boolean),
    [serverTypes, selectedRegion, featuredNames]
  );

  const handleDeploy = () => {
    if (!isLoggedIn) { window.location.href = `/login?next=${encodeURIComponent("/machines/new")}`; return; }
    if (!selectedProvider || !selectedRegion || !selectedServerType) return;
    createMachine.mutate(
      { provider: selectedProvider, server_type: selectedServerType, region: selectedRegion },
      {
        onSuccess: (result) => {
          if (result.kind === "checkout") { window.location.href = result.checkout.checkout_url; return; }
          toast.success("Machine created!");
          window.location.href = `/machines/${result.machine.id}`;
        },
        onError: (err) => toast.error(err.message),
      }
    );
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative h-full flex items-center justify-center p-4">
        <div className="w-full max-w-[480px] bg-background rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">

          {/* ── Header ── */}
          <div className="flex items-center justify-between px-6 pt-6 pb-4">
            <div>
              <h2 className="text-xl font-medium tracking-tight">Deploy a machine</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Ready in 60 seconds · Cancel anytime</p>
            </div>
            <button onClick={onClose} className="size-8 rounded-lg flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>

          {/* ── Body ── */}
          <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-6">

            {/* Region */}
            {regions && regions.length > 1 && (
              <div className="flex gap-2">
                {regions.map((r) => {
                  const active = selectedRegion === r.id;
                  const rm = REGION_MAP[r.id];
                  return (
                    <button
                      key={r.id}
                      onClick={() => { setSelectedRegion(r.id); setSelectedServerType(""); }}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium transition-all",
                        active ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
                      )}
                    >
                      <span>{rm?.flag ?? "🌍"}</span>
                      {rm?.label ?? r.city}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Plans */}
            <div className="space-y-2">
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
                    onClick={() => setSelectedServerType(s.name)}
                    className={cn(
                      "w-full relative flex items-center gap-4 p-4 rounded-xl border text-left transition-all",
                      active ? "border-foreground bg-card" : "border-border hover:border-foreground/50"
                    )}
                  >
                    {/* Icon */}
                    <div className={cn("size-10 rounded-xl flex items-center justify-center shrink-0", active ? "bg-foreground text-background" : "bg-muted text-muted-foreground")}>
                      <Icon className="size-4" />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{label}</span>
                        {isMid && <span className="px-1.5 py-0.5 rounded bg-foreground text-background text-[9px] font-medium leading-none">POPULAR</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Cpu className="size-3" />{s.vcpu} vCPU</span>
                        <span className="flex items-center gap-1"><MemoryStick className="size-3" />{s.ram_gb} GB</span>
                        <span className="flex items-center gap-1"><HardDrive className="size-3" />{s.disk_gb} GB</span>
                        <span className="text-muted-foreground">· {tagline}</span>
                      </div>
                    </div>

                    {/* Price + check */}
                    <div className="text-right shrink-0">
                      <div className="text-lg font-medium">${s.price_monthly}</div>
                      <div className="text-[10px] text-muted-foreground">/mo</div>
                    </div>

                    {active && (
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 size-5 rounded-full bg-foreground flex items-center justify-center">
                        <Check className="size-3 text-background" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Included */}
            <div className="flex flex-wrap gap-1.5">
              {INCLUDED.map((item) => (
                <span key={item} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-muted text-xs text-muted-foreground">
                  <Check className="size-3 text-green-600 dark:text-green-400" />
                  {item}
                </span>
              ))}
            </div>
          </div>

          {/* ── Footer CTA ── */}
          <div className="border-t border-border px-6 py-4 bg-background">
            <Button
              className="w-full h-12 text-sm font-medium rounded-xl"
              onClick={handleDeploy}
              disabled={createMachine.isPending || !selectedServerType}
            >
              {createMachine.isPending ? (
                <><Loader2 className="size-4 animate-spin mr-2" />Deploying...</>
              ) : !isLoggedIn ? (
                <>
                  Sign up & deploy
                  {selectedST && <span className="ml-2 opacity-70">· ${selectedST.price_monthly}/mo</span>}
                  <ArrowRight className="size-4 ml-2" />
                </>
              ) : (
                <>
                  Deploy now
                  {selectedST && <span className="ml-2 opacity-70">· ${selectedST.price_monthly}/mo</span>}
                  <ArrowRight className="size-4 ml-2" />
                </>
              )}
            </Button>
            <p className="text-[10px] text-muted-foreground text-center mt-2">
              Billed monthly · Cancel anytime · No setup fees
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
