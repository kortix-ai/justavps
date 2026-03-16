"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useSnapshots } from "@/hooks/use-snapshots";
import { useProviders, useRegions, useServerTypes } from "@/hooks/use-server-types";
import { useCreateMachine } from "@/hooks/use-machines";
import { ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Snapshot } from "@/lib/types";

interface CreateMachineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateMachineDialog({ open, onOpenChange }: CreateMachineDialogProps) {
  const router = useRouter();

  // Data
  const { data: allSnapshots } = useSnapshots();
  const snapshots = allSnapshots?.filter((s) => s.status === "ready") ?? [];
  const { data: allProviders } = useProviders();
  const providers = allProviders ?? [];

  // Selections
  const [selectedSnapshot, setSelectedSnapshot] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedRegion, setSelectedRegion] = useState("");
  const [selectedServerType, setSelectedServerType] = useState("");
  const [machineName, setMachineName] = useState("");
  const [showMore, setShowMore] = useState(false);

  // Dependent queries
  const { data: regions } = useRegions(selectedProvider || undefined);
  const { data: serverTypes } = useServerTypes(
    selectedProvider || undefined,
    selectedRegion || undefined,
  );

  const createMachine = useCreateMachine();

  // Reset when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedSnapshot("");
      setSelectedProvider("");
      setSelectedRegion("");
      setSelectedServerType("");
      setMachineName("");
      setShowMore(false);
    }
  }, [open]);

  // Auto-select single options
  useEffect(() => {
    if (snapshots.length === 1 && !selectedSnapshot) setSelectedSnapshot(snapshots[0].id);
  }, [allSnapshots, open]);

  useEffect(() => {
    if (providers.length === 1 && !selectedProvider) setSelectedProvider(providers[0].name);
  }, [allProviders, open]);

  // Filter providers to ones this snapshot is built on
  const snapshot = snapshots.find((s) => s.id === selectedSnapshot);
  const availableProviders = providers.filter((p) => snapshot?.providers?.[p.name]);

  // Auto-select provider when snapshot changes
  useEffect(() => {
    if (!snapshot) return;
    const available = providers.filter((p) => snapshot.providers?.[p.name]);
    if (available.length === 1) {
      setSelectedProvider(available[0].name);
    } else if (selectedProvider && !snapshot.providers?.[selectedProvider]) {
      setSelectedProvider("");
    }
  }, [selectedSnapshot, allProviders]);

  // Auto-select first region/server type
  useEffect(() => {
    if (regions?.length && !selectedRegion) setSelectedRegion(regions[0].id);
  }, [regions]);

  useEffect(() => {
    if (serverTypes?.length && !selectedServerType) setSelectedServerType(serverTypes[0].name);
  }, [serverTypes]);

  const selectedST = serverTypes?.find((s) => s.name === selectedServerType);
  const displayed = showMore ? serverTypes : serverTypes?.slice(0, 3);
  const canCreate = selectedSnapshot && selectedProvider && selectedRegion && selectedServerType;

  const handleCreate = () => {
    if (!canCreate) return;

    createMachine.mutate(
      {
        snapshot_id: selectedSnapshot,
        provider: selectedProvider,
        server_type: selectedServerType,
        region: selectedRegion,
        name: machineName || undefined,
      },
      {
        onSuccess: (machine) => {
          toast.success("Machine created!");
          onOpenChange(false);
          router.push(`/machines/${machine.id}`);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Machine</DialogTitle>
          <DialogDescription>Pick a snapshot, provider, region, and size.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Step 1: Snapshot */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Snapshot</Label>
            {snapshots.length === 0 ? (
              <div className="text-sm text-muted-foreground p-4 border border-dashed rounded-lg text-center">
                No snapshots available.{" "}
                <a href="/snapshots" className="text-primary hover:underline" onClick={() => onOpenChange(false)}>
                  Create one first
                </a>
              </div>
            ) : (
              <div className="space-y-1.5">
                {snapshots.map((s) => (
                  <OptionRow
                    key={s.id}
                    selected={selectedSnapshot === s.id}
                    onClick={() => setSelectedSnapshot(s.id)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-sm truncate">{s.name}</span>
                      <span className="font-mono text-xs text-muted-foreground truncate">{s.docker_image}</span>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {Object.keys(s.providers).map((p) => (
                        <Badge key={p} variant="outline" className="text-[10px]">{p}</Badge>
                      ))}
                    </div>
                  </OptionRow>
                ))}
              </div>
            )}
          </div>

          {/* Step 2: Provider */}
          {selectedSnapshot && (
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Provider</Label>
              <div className="flex gap-2">
                {availableProviders.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => setSelectedProvider(p.name)}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-sm border transition-colors",
                      selectedProvider === p.name
                        ? "border-primary bg-primary/10 font-medium"
                        : "text-muted-foreground hover:bg-muted/50"
                    )}
                  >
                    {p.displayName}
                  </button>
                ))}
                {availableProviders.length === 0 && (
                  <p className="text-sm text-muted-foreground">Not built on any provider yet.</p>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Region */}
          {selectedProvider && regions && (
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Region</Label>
              <div className="flex flex-wrap gap-1.5">
                {regions.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setSelectedRegion(r.id)}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-sm border transition-colors",
                      selectedRegion === r.id
                        ? "border-primary bg-primary/10"
                        : "text-muted-foreground hover:bg-muted/50"
                    )}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 4: Size */}
          {selectedRegion && displayed && displayed.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Size</Label>
              <div className="space-y-1.5">
                {displayed.map((s) => (
                  <OptionRow
                    key={s.name}
                    selected={selectedServerType === s.name}
                    onClick={() => setSelectedServerType(s.name)}
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm text-muted-foreground w-12">{s.name}</span>
                      <span className="text-sm">
                        {s.vcpu} vCPU <span className="text-muted-foreground">&middot;</span> {s.ram_gb} GB <span className="text-muted-foreground">&middot;</span> {s.disk_gb} GB
                      </span>
                    </div>
                    <span className="font-medium text-sm">${s.price_monthly}/mo</span>
                  </OptionRow>
                ))}
              </div>
              {!showMore && serverTypes && serverTypes.length > 3 && (
                <button
                  onClick={() => setShowMore(true)}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                >
                  <ChevronRight className="size-3" />
                  Show {serverTypes.length - 3} more
                </button>
              )}
            </div>
          )}

          {/* Name (optional) */}
          {canCreate && (
            <div className="space-y-2">
              <Label htmlFor="machine-name" className="text-xs uppercase tracking-wider text-muted-foreground">
                Name <span className="normal-case">(optional)</span>
              </Label>
              <Input
                id="machine-name"
                placeholder="my-machine"
                value={machineName}
                onChange={(e) => setMachineName(e.target.value)}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        {canCreate && (
          <DialogFooter>
            <div className="flex items-center justify-between w-full">
              <div className="text-sm text-muted-foreground">
                {selectedST && (
                  <span>
                    <span className="font-mono">{selectedST.name}</span>
                    {" "}&middot; {selectedST.vcpu} vCPU / {selectedST.ram_gb}GB / {selectedST.disk_gb}GB
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <span className="text-lg font-semibold">${selectedST?.price_monthly ?? "—"}</span>
                  <span className="text-xs text-muted-foreground">/mo</span>
                </div>
                <Button onClick={handleCreate} disabled={createMachine.isPending}>
                  {createMachine.isPending ? (
                    <>
                      <Loader2 className="size-4 animate-spin mr-2" />
                      Creating...
                    </>
                  ) : (
                    "Create Machine"
                  )}
                </Button>
              </div>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Reusable selection row ──────────────────────────────────────────────────

function OptionRow({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "cursor-pointer flex items-center justify-between p-3 rounded-lg border transition-colors",
        selected
          ? "border-primary bg-primary/5"
          : "hover:bg-muted/30"
      )}
    >
      {children}
    </div>
  );
}
