"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useProviders, useRegions, useServerTypes } from "@/hooks/use-server-types";
import { useCreateMachine } from "@/hooks/use-machines";
import { useSSHKeys } from "@/hooks/use-ssh-keys";
import { ArrowLeft, Loader2, Shield, KeyRound, Check } from "lucide-react";
import Link from "next/link";
import { PlanPicker } from "@/components/plan-picker";
import { cn } from "@/lib/utils";

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
  const [dockerImage, setDockerImage] = useState("");
  const [entrypoint, setEntrypoint] = useState("");
  const [selectedSSHKeyIds, setSelectedSSHKeyIds] = useState<string[]>([]);

  const createMachine = useCreateMachine();
  const { data: userSSHKeys } = useSSHKeys();

  const selectedST = serverTypes?.find((s) => s.name === selectedServerType);
  const canCreate = selectedProvider && selectedRegion && selectedServerType;

  const handleCreate = () => {
    if (!canCreate) return;
    createMachine.mutate(
      {
        provider: selectedProvider,
        server_type: selectedServerType,
        region: selectedRegion,
        name: machineName || undefined,
        docker_image: dockerImage || undefined,
        entrypoint: entrypoint || undefined,
        ssh_key_ids: selectedSSHKeyIds.length > 0 ? selectedSSHKeyIds : undefined,
      },
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

          {/* Docker Image (optional) */}
          <div className="space-y-2">
            <Label htmlFor="prov-docker-image" className="text-xs uppercase tracking-wider text-muted-foreground">
              Docker Image <span className="normal-case">(optional)</span>
            </Label>
            <Input
              id="prov-docker-image"
              placeholder="nginx:latest"
              value={dockerImage}
              onChange={(e) => setDockerImage(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Public Docker Hub image to auto-start on the machine. Base image runs Ubuntu 24.04 (amd64) &mdash; your Docker image must be compatible.
            </p>
            {dockerImage && (
              <div className="space-y-2 pt-1">
                <Label htmlFor="prov-docker-entrypoint" className="text-xs uppercase tracking-wider text-muted-foreground">
                  Entrypoint <span className="normal-case">(optional)</span>
                </Label>
                <Input
                  id="prov-docker-entrypoint"
                  placeholder="/bin/sh -c 'my-command'"
                  value={entrypoint}
                  onChange={(e) => setEntrypoint(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* SSH Keys */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              SSH Keys
            </Label>
            <p className="text-xs text-muted-foreground">
              A new key is auto-generated and saved to your account. Optionally add your own keys too.
            </p>
            {userSSHKeys && userSSHKeys.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {userSSHKeys.map((key) => {
                  const isSelected = selectedSSHKeyIds.includes(key.id);
                  return (
                    <div
                      key={key.id}
                      onClick={() =>
                        setSelectedSSHKeyIds((prev) =>
                          isSelected ? prev.filter((id) => id !== key.id) : [...prev, key.id]
                        )
                      }
                      className={cn(
                        "cursor-pointer flex items-center gap-3 p-2.5 rounded-lg border transition-colors",
                        isSelected ? "border-primary bg-primary/5" : "hover:bg-muted/30"
                      )}
                    >
                      <div className={cn(
                        "size-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                        isSelected ? "bg-primary border-primary" : "border-muted-foreground/30"
                      )}>
                        {isSelected && <Check className="size-3 text-primary-foreground" />}
                      </div>
                      <KeyRound className="size-3.5 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm">{key.name}</div>
                        <div className="text-[11px] text-muted-foreground font-mono truncate">{key.fingerprint}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

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
