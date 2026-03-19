"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { useProviders, useRegions, useServerTypes } from "@/hooks/use-server-types";
import { useCreateMachine } from "@/hooks/use-machines";
import { toast } from "sonner";
import { X, Loader2, ArrowRight, Shield, Clock, Zap, Lock } from "lucide-react";
import { PlanPicker } from "@/components/plan-picker";

/* ═══ Component ═══ */
interface CheckoutModalProps { open: boolean; onClose: () => void }

export function CheckoutModal({ open, onClose }: CheckoutModalProps) {
  const { data: session } = useSession();
  const isLoggedIn = !!session?.user;

  const { data: allProviders } = useProviders();
  const providers = allProviders ?? [];
  const selectedProvider = providers[0]?.name || "";
  const { data: regions } = useRegions(selectedProvider || undefined);
  const [regionOverride, setRegionOverride] = useState("");
  const selectedRegion = regionOverride || regions?.[0]?.id || "";
  const { data: serverTypes } = useServerTypes(selectedProvider || undefined, selectedRegion || undefined);
  const [serverTypeOverride, setServerTypeOverride] = useState("");
  const selectedServerType = serverTypeOverride || serverTypes?.[Math.min(1, (serverTypes?.length ?? 1) - 1)]?.name || "";
  const createMachine = useCreateMachine();

  // Lock body scroll when open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => { window.removeEventListener("keydown", handleKey); };
  }, [open, onClose]);

  const selectedST = serverTypes?.find((s) => s.name === selectedServerType);

  // Calculate competitor price for savings display
  const competitorMultiplier = selectedST ? Math.round((selectedST.vcpu * 0.0504 + selectedST.ram_gb * 0.0162) * 730 / selectedST.price_monthly) : 0;

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
        <div className="w-full max-w-[560px] bg-background rounded-2xl border border-border overflow-hidden flex flex-col max-h-[92vh]">

          {/* ── Header — value-first framing ── */}
          <div className="px-6 pt-6 pb-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-medium tracking-tight">Get your machine</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Pick a plan. Running in under 60 seconds.</p>
              </div>
              <button onClick={onClose} className="size-8 rounded-lg flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>

            {/* Trust bar — reduce anxiety */}
            <div className="mt-3 flex items-center gap-4 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><Clock className="size-3 text-foreground" /> 60s deploy</span>
              <span className="flex items-center gap-1"><Shield className="size-3 text-green-600 dark:text-green-400" /> Daily backups</span>
              <span className="flex items-center gap-1"><Lock className="size-3 text-foreground" /> Cancel anytime</span>
              <span className="flex items-center gap-1"><Zap className="size-3 text-foreground" /> No setup fees</span>
            </div>
          </div>

          {/* ── Body ── */}
          <div className="flex-1 overflow-y-auto px-6 pb-4">
            <PlanPicker
              regions={regions ?? undefined}
              serverTypes={serverTypes ?? undefined}
              selectedRegion={selectedRegion}
              selectedServerType={selectedServerType}
              onRegionChange={(r) => { setRegionOverride(r); setServerTypeOverride(""); }}
              onServerTypeChange={setServerTypeOverride}
            />
          </div>

          {/* ── Footer CTA — urgency + value stack ── */}
          <div className="border-t border-border px-6 py-4 bg-background">
            {/* Savings callout */}
            {selectedST && competitorMultiplier > 1 && (
              <div className="mb-3 flex items-center justify-center gap-2 text-xs">
                <span className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 font-medium">
                  {competitorMultiplier}x cheaper than per-second billing
                </span>
              </div>
            )}

            <Button
              className="w-full h-12 text-sm font-medium rounded-xl"
              onClick={handleDeploy}
              disabled={createMachine.isPending || !selectedServerType}
            >
              {createMachine.isPending ? (
                <><Loader2 className="size-4 animate-spin mr-2" />Setting up your machine...</>
              ) : !isLoggedIn ? (
                <>
                  Create account & deploy
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

            {/* Micro-commitment reassurance */}
            <p className="text-center text-[10px] text-muted-foreground mt-2">
              {!isLoggedIn
                ? "Free account · No credit card required to sign up"
                : "Billed monthly · Downgrade or cancel in one click"
              }
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
