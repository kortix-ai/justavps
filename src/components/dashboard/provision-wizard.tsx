"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useProviders, useRegions, useServerTypes } from "@/hooks/use-server-types";
import { useCreateMachine } from "@/hooks/use-machines";
import { ArrowLeft, Loader2, Shield } from "lucide-react";
import Link from "next/link";
import { PlanPicker } from "@/components/plan-picker";

export function ProvisionWizard() {
  const router = useRouter();

  const { data: allProviders } = useProviders();
  const providers = allProviders ?? [];
  const selectedProvider = providers[0]?.name || "";

  const { data: regions } = useRegions(selectedProvider || undefined);
  const [regionOverride, setRegionOverride] = useState("");
  const selectedRegion = regionOverride || regions?.[0]?.id || "";

  const { data: serverTypes } = useServerTypes(selectedProvider || undefined, selectedRegion || undefined);
  const [serverTypeOverride, setServerTypeOverride] = useState("");
  const selectedServerType = serverTypeOverride || serverTypes?.[Math.min(1, (serverTypes?.length ?? 1) - 1)]?.name || "";
  const [machineName, setMachineName] = useState("");

  const createMachine = useCreateMachine();

  const selectedST = serverTypes?.find((s) => s.name === selectedServerType);
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

      {/* Plan picker — shared component */}
      <div className="mb-6">
        <PlanPicker
          regions={regions ?? undefined}
          serverTypes={serverTypes ?? undefined}
          selectedRegion={selectedRegion}
          selectedServerType={selectedServerType}
          onRegionChange={(r) => { setRegionOverride(r); setServerTypeOverride(""); }}
          onServerTypeChange={setServerTypeOverride}
          showIncluded={false}
        />
      </div>

      {/* Deploy section */}
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
                {selectedST?.vcpu} vCPU &middot; {selectedST?.ram_gb} GB RAM &middot; {regions?.find((r) => r.id === selectedRegion)?.city}
              </div>
            </div>
            <Button size="lg" onClick={handleCreate} disabled={createMachine.isPending}>
              {createMachine.isPending ? <><Loader2 className="size-4 animate-spin" />Deploying...</> : "Deploy Machine"}
            </Button>
          </div>
          <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground/70">
            <Shield className="size-3 text-green-600 dark:text-green-400" />
            <span>Daily backups included &middot; Running in 60s &middot; Cancel anytime</span>
          </div>
        </div>
      )}
    </div>
  );
}
