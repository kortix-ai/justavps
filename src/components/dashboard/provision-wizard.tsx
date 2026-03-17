"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useSnapshots } from "@/hooks/use-snapshots";
import { useProviders, useRegions, useServerTypes } from "@/hooks/use-server-types";
import { useCreateMachine } from "@/hooks/use-machines";
import { cn } from "@/lib/utils";
import { ArrowLeft, Check, Loader2, Cpu, MemoryStick, HardDrive } from "lucide-react";
import Link from "next/link";

export function ProvisionWizard() {
  const router = useRouter();

  const { data: allSnapshots } = useSnapshots();
  const snapshots = allSnapshots?.filter((s) => s.status === "ready") ?? [];
  const [selectedSnapshot, setSelectedSnapshot] = useState("");

  const { data: allProviders } = useProviders();
  const providers = allProviders ?? [];
  const [selectedProvider, setSelectedProvider] = useState("");

  const { data: regions } = useRegions(selectedProvider || undefined);
  const [selectedRegion, setSelectedRegion] = useState("");

  const { data: serverTypes } = useServerTypes(selectedProvider || undefined, selectedRegion || undefined);
  const [selectedServerType, setSelectedServerType] = useState("");
  const [showAllSizes, setShowAllSizes] = useState(false);
  const [machineName, setMachineName] = useState("");

  const createMachine = useCreateMachine();

  // Auto-selects
  useEffect(() => { if (snapshots.length === 1 && !selectedSnapshot) setSelectedSnapshot(snapshots[0].id); }, [allSnapshots]);
  useEffect(() => { if (providers.length === 1 && !selectedProvider) setSelectedProvider(providers[0].name); }, [allProviders]);

  const snapshot = snapshots.find((s) => s.id === selectedSnapshot);
  const availableProviders = providers.filter((p) => snapshot?.providers?.[p.name]);

  useEffect(() => {
    if (!snapshot) return;
    const available = providers.filter((p) => snapshot.providers?.[p.name]);
    if (available.length === 1) setSelectedProvider(available[0].name);
    else if (selectedProvider && !snapshot.providers?.[selectedProvider]) setSelectedProvider("");
  }, [selectedSnapshot, allProviders]);

  useEffect(() => { if (regions?.length && !selectedRegion) setSelectedRegion(regions[0].id); }, [regions]);
  useEffect(() => { if (serverTypes?.length && !selectedServerType) setSelectedServerType(serverTypes[0].name); }, [serverTypes]);

  const selectedST = serverTypes?.find((s) => s.name === selectedServerType);
  const displayed = showAllSizes ? serverTypes : serverTypes?.slice(0, 6);
  const canCreate = selectedSnapshot && selectedProvider && selectedRegion && selectedServerType;

  const handleCreate = () => {
    if (!canCreate) return;
    createMachine.mutate(
      { snapshot_id: selectedSnapshot, provider: selectedProvider, server_type: selectedServerType, region: selectedRegion, name: machineName || undefined },
      {
        onSuccess: (machine) => { toast.success("Machine created!"); router.push(`/machines/${machine.id}`); },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <div className="max-w-xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Link href="/machines" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="font-heading text-2xl tracking-tight">New Machine</h1>
      </div>

      <div className="space-y-6">
        {/* Snapshot */}
        <Field label="Snapshot">
          {snapshots.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 border border-dashed rounded-lg text-center">
              No snapshots available.{" "}
              <Link href="/snapshots" className="text-primary hover:underline">Create one</Link>
            </div>
          ) : (
            <div className="space-y-1.5">
              {snapshots.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedSnapshot(s.id)}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors",
                    selectedSnapshot === s.id ? "border-primary/50 bg-primary/5" : "hover:bg-muted/40"
                  )}
                >
                  <Radio checked={selectedSnapshot === s.id} />
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium">{s.name}</span>
                    <span className="text-xs text-muted-foreground font-mono ml-2">{s.docker_image}</span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {Object.keys(s.providers).map((p) => (
                      <Badge key={p} variant="outline" className="text-[10px]">{p}</Badge>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          )}
        </Field>

        {/* Provider + Region inline */}
        {selectedSnapshot && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Provider">
              <div className="flex flex-wrap gap-1.5">
                {availableProviders.map((p) => (
                  <Chip key={p.name} selected={selectedProvider === p.name} onClick={() => setSelectedProvider(p.name)}>
                    {p.displayName}
                  </Chip>
                ))}
                {availableProviders.length === 0 && (
                  <span className="text-sm text-muted-foreground">Not available</span>
                )}
              </div>
            </Field>

            {selectedProvider && regions && (
              <Field label="Region">
                <div className="flex flex-wrap gap-1.5">
                  {regions.map((r) => (
                    <Chip key={r.id} selected={selectedRegion === r.id} onClick={() => setSelectedRegion(r.id)}>
                      {r.city}
                    </Chip>
                  ))}
                </div>
              </Field>
            )}
          </div>
        )}

        {/* Size */}
        {selectedRegion && displayed && displayed.length > 0 && (
          <Field label="Size">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {displayed.map((s) => {
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
                      <span className={cn("font-mono text-sm", active && "text-primary font-medium")}>{s.name}</span>
                      <span className="text-sm font-semibold">${s.price_monthly}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Cpu className="size-3" />{s.vcpu}</span>
                      <span className="flex items-center gap-1"><MemoryStick className="size-3" />{s.ram_gb}G</span>
                      <span className="flex items-center gap-1"><HardDrive className="size-3" />{s.disk_gb}G</span>
                    </div>
                  </button>
                );
              })}
            </div>
            {!showAllSizes && serverTypes && serverTypes.length > 6 && (
              <button onClick={() => setShowAllSizes(true)} className="text-xs text-muted-foreground hover:text-foreground transition-colors mt-1">
                Show all {serverTypes.length} sizes
              </button>
            )}
          </Field>
        )}

        {/* Name + Deploy */}
        {canCreate && (
          <div className="rounded-lg border p-4 space-y-4">
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
          </div>
        )}
      </div>
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

function Radio({ checked }: { checked: boolean }) {
  return (
    <div className={cn("size-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors", checked ? "border-primary bg-primary" : "border-muted-foreground/30")}>
      {checked && <Check className="size-2.5 text-primary-foreground" />}
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
