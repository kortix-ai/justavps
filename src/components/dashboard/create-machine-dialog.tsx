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
import { useImages } from "@/hooks/use-images";
import { ChevronRight, Loader2, KeyRound, Check, Monitor, Container, HardDrive, Box } from "lucide-react";
import { cn, planName } from "@/lib/utils";
import type { Image } from "@/lib/types";

// Template selection mode
type TemplateMode = "default" | "template" | "snapshot" | "docker";

interface CreateMachineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateMachineDialog({ open, onOpenChange }: CreateMachineDialogProps) {
  const router = useRouter();

  // Data
  const { data: allProviders } = useProviders();
  const providers = allProviders ?? [];
  const { data: allImages } = useImages();

  // Split images into public templates and user snapshots
  const publicTemplates = allImages?.filter((img) => img.is_public && img.status === "ready") ?? [];
  const userSnapshots = allImages?.filter((img) => !img.is_public && img.status === "ready") ?? [];

  // Selections
  const [templateMode, setTemplateMode] = useState<TemplateMode>("default");
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
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
      setTemplateMode("default");
      setSelectedImageId(null);
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

    // Resolve image_id based on template mode
    let imageId: string | undefined;
    if (templateMode === "template" || templateMode === "snapshot") {
      imageId = selectedImageId ?? undefined;
    }

    createMachine.mutate(
      {
        provider: selectedProvider,
        server_type: selectedServerType,
        region: selectedRegion,
        name: machineName || undefined,
        image_id: imageId,
        docker_image: (templateMode === "docker" && dockerImage) ? dockerImage : undefined,
        entrypoint: (templateMode === "docker" && entrypoint) ? entrypoint : undefined,
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
          <DialogDescription>Pick a template, size, and region to spin up a new machine.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Step 1: Template */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Template</Label>
            <div className="grid grid-cols-2 gap-1.5">
              <TemplateOption
                selected={templateMode === "default"}
                onClick={() => { setTemplateMode("default"); setSelectedImageId(null); }}
                icon={<Monitor className="size-4" />}
                label="Default"
                description="Ubuntu 24.04 + dev platform"
              />
              {publicTemplates.length > 0 && (
                <TemplateOption
                  selected={templateMode === "template"}
                  onClick={() => setTemplateMode("template")}
                  icon={<Box className="size-4" />}
                  label="Templates"
                  description={`${publicTemplates.length} available`}
                />
              )}
              {userSnapshots.length > 0 && (
                <TemplateOption
                  selected={templateMode === "snapshot"}
                  onClick={() => setTemplateMode("snapshot")}
                  icon={<HardDrive className="size-4" />}
                  label="My Snapshots"
                  description={`${userSnapshots.length} saved`}
                />
              )}
              <TemplateOption
                selected={templateMode === "docker"}
                onClick={() => setTemplateMode("docker")}
                icon={<Container className="size-4" />}
                label="Docker Image"
                description="Run a container on boot"
              />
            </div>
          </div>

          {/* Template: public images picker */}
          {templateMode === "template" && publicTemplates.length > 0 && (
            <div className="space-y-1.5">
              {publicTemplates.map((img) => (
                <ImageRow
                  key={img.id}
                  image={img}
                  selected={selectedImageId === img.id}
                  onClick={() => setSelectedImageId(img.id)}
                />
              ))}
            </div>
          )}

          {/* Snapshot: user images picker */}
          {templateMode === "snapshot" && userSnapshots.length > 0 && (
            <div className="space-y-1.5">
              {userSnapshots.map((img) => (
                <ImageRow
                  key={img.id}
                  image={img}
                  selected={selectedImageId === img.id}
                  onClick={() => setSelectedImageId(img.id)}
                />
              ))}
            </div>
          )}

          {/* Docker: image input */}
          {templateMode === "docker" && (
            <div className="space-y-3">
              <div className="space-y-2">
                <Input
                  placeholder="nginx:latest"
                  value={dockerImage}
                  onChange={(e) => setDockerImage(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Public Docker Hub image to auto-start. Base OS is Ubuntu 24.04 (amd64).
                </p>
              </div>
              {dockerImage && (
                <div className="space-y-2">
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

          {/* Step 2: Provider */}
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
                      <span className="text-sm font-medium w-14">{planName(s.name)}</span>
                      <span className="text-sm text-muted-foreground">
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

// --- Template option card ---

function TemplateOption({
  selected,
  onClick,
  icon,
  label,
  description,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  description: string;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "cursor-pointer flex items-start gap-3 p-3 rounded-lg border transition-colors",
        selected
          ? "border-primary bg-primary/5"
          : "hover:bg-muted/30"
      )}
    >
      <div className={cn(
        "mt-0.5 text-muted-foreground",
        selected && "text-primary"
      )}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
    </div>
  );
}

// --- Image selection row ---

function ImageRow({
  image,
  selected,
  onClick,
}: {
  image: Image;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <OptionRow selected={selected} onClick={onClick}>
      <div className="flex items-center gap-3">
        <HardDrive className="size-3.5 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <div className="text-sm">{image.name}</div>
          <div className="text-xs text-muted-foreground">
            {image.architecture || "x86"}
            {image.disk_size_gb && <> &middot; {image.disk_size_gb} GB</>}
          </div>
        </div>
      </div>
    </OptionRow>
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
