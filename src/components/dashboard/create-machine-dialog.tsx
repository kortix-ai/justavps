"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useProviders, useRegions, useServerTypes } from "@/hooks/use-server-types";
import { useCreateMachine } from "@/hooks/use-machines";
import { useSSHKeys } from "@/hooks/use-ssh-keys";
import { ChevronRight, Loader2, KeyRound, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface CreateMachineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateMachineDialog({ open, onOpenChange }: CreateMachineDialogProps) {
  const router = useRouter();

  // Data
  const { data: allProviders } = useProviders();
  const providers = allProviders ?? [];

  // Selections
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedRegion, setSelectedRegion] = useState("");
  const [selectedServerType, setSelectedServerType] = useState("");
  const [machineName, setMachineName] = useState("");
  const [dockerImage, setDockerImage] = useState("");
  const [entrypoint, setEntrypoint] = useState("");
  const [selectedSSHKeyIds, setSelectedSSHKeyIds] = useState<string[]>([]);
  const [showMore, setShowMore] = useState(false);

  // Dependent queries
  const { data: regions } = useRegions(selectedProvider || undefined);
  const { data: serverTypes } = useServerTypes(
    selectedProvider || undefined,
    selectedRegion || undefined,
  );
  const { data: userSSHKeys } = useSSHKeys();

  const createMachine = useCreateMachine();

  // Reset when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedProvider("");
      setSelectedRegion("");
      setSelectedServerType("");
      setMachineName("");
      setDockerImage("");
      setEntrypoint("");
      setSelectedSSHKeyIds([]);
      setShowMore(false);
    }
  }, [open]);

  // Auto-select single provider
  useEffect(() => {
    if (providers.length === 1 && !selectedProvider) setSelectedProvider(providers[0].name);
  }, [allProviders, open]);

  // Auto-select first region/server type
  useEffect(() => {
    if (regions?.length && !selectedRegion) setSelectedRegion(regions[0].id);
  }, [regions]);

  useEffect(() => {
    if (serverTypes?.length && !selectedServerType) setSelectedServerType(serverTypes[0].name);
  }, [serverTypes]);

  const selectedST = serverTypes?.find((s) => s.name === selectedServerType);
  const displayed = showMore ? serverTypes : serverTypes?.slice(0, 3);
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
          onOpenChange(false);
          router.push(`/machines/${result.machine.id}`);
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
          <DialogDescription>Pick a provider, region, and size. Boots Ubuntu 24.04 with the full dev platform.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Step 1: Provider */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Provider</Label>
            <div className="flex gap-2">
              {providers.map((p) => (
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
            </div>
          </div>

          {/* Step 2: Region */}
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

          {/* Step 3: Size */}
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

          {/* Docker Image (optional) */}
          {canCreate && (
            <div className="space-y-2">
              <Label htmlFor="docker-image" className="text-xs uppercase tracking-wider text-muted-foreground">
                Docker Image <span className="normal-case">(optional)</span>
              </Label>
              <Input
                id="docker-image"
                placeholder="nginx:latest"
                value={dockerImage}
                onChange={(e) => setDockerImage(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Public Docker Hub image to auto-start on the machine. Base image runs Ubuntu 24.04 (amd64) &mdash; your Docker image must be compatible.
              </p>
              {dockerImage && (
                <div className="space-y-2 pt-1">
                  <Label htmlFor="docker-entrypoint" className="text-xs uppercase tracking-wider text-muted-foreground">
                    Entrypoint <span className="normal-case">(optional)</span>
                  </Label>
                  <Input
                    id="docker-entrypoint"
                    placeholder="/bin/sh -c 'my-command'"
                    value={entrypoint}
                    onChange={(e) => setEntrypoint(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          {/* SSH Keys */}
          {canCreate && (
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

// --- Reusable selection row ---

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
