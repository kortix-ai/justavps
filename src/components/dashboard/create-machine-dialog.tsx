"use client";

import { useState } from "react";
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
import { ChevronRight, Loader2, KeyRound, Check, Monitor, HardDrive, Container, ChevronDown } from "lucide-react";
import { cn, planName } from "@/lib/utils";
import type { Image } from "@/lib/types";

const DEFAULT_TEMPLATE_NAME = "justavps standard";

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

  // All non-standard images (templates + saved images, ready only)
  const otherImages = allImages?.filter((img) => img.status === "ready" && img.name !== DEFAULT_TEMPLATE_NAME) ?? [];

  // Selections
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null); // null = standard
  const [showImagePicker, setShowImagePicker] = useState(false);

  // Docker config — optional addon, layered on top of image selection
  const [dockerImage, setDockerImage] = useState("");
  const [entrypoint, setEntrypoint] = useState("");
  const [command, setCommand] = useState("");
  const [showDockerConfig, setShowDockerConfig] = useState(false);

  const [selectedProviderOverride, setSelectedProviderOverride] = useState<string | null>(null);
  const [selectedRegionOverride, setSelectedRegionOverride] = useState<string | null>(null);
  const [selectedServerTypeOverride, setSelectedServerTypeOverride] = useState<string | null>(null);
  const [machineName, setMachineName] = useState("");
  const [selectedSSHKeyIds, setSelectedSSHKeyIds] = useState<string[]>([]);
  const [showMore, setShowMore] = useState(false);

  // Dependent queries
  const selectedProvider = selectedProviderOverride ?? providers[0]?.name ?? "";
  const { data: regions } = useRegions(selectedProvider || undefined);
  const selectedRegion = selectedRegionOverride ?? regions?.[0]?.id ?? "";
  const { data: serverTypes } = useServerTypes(
    selectedProvider || undefined,
    selectedRegion || undefined,
  );
  const selectedServerType = selectedServerTypeOverride ?? serverTypes?.[0]?.name ?? "";
  const { data: userSSHKeys } = useSSHKeys();

  const createMachine = useCreateMachine();

  const selectedST = serverTypes?.find((s) => s.name === selectedServerType);
  const displayed = showMore ? serverTypes : serverTypes?.slice(0, 3);
  const canCreate = selectedProvider && selectedRegion && selectedServerType;

  const selectedImage = otherImages.find((img) => img.id === selectedImageId);
  const isStandard = selectedImageId === null;

  const handleCreate = () => {
    if (!canCreate) return;

    createMachine.mutate(
      {
        provider: selectedProvider,
        server_type: selectedServerType,
        region: selectedRegion,
        name: machineName || undefined,
        image_id: selectedImageId ?? undefined,
        docker_image: (showDockerConfig && dockerImage) ? dockerImage : undefined,
        entrypoint: (showDockerConfig && entrypoint) ? entrypoint : undefined,
        command: (showDockerConfig && command) ? command : undefined,
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

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setSelectedImageId(null);
      setShowImagePicker(false);
      setDockerImage("");
      setEntrypoint("");
      setCommand("");
      setShowDockerConfig(false);
      setSelectedProviderOverride(null);
      setSelectedRegionOverride(null);
      setSelectedServerTypeOverride(null);
      setMachineName("");
      setSelectedSSHKeyIds([]);
      setShowMore(false);
    }

    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Machine</DialogTitle>
          <DialogDescription>Pick an image, size, and region to spin up a new machine.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">

          {/* Step 1: Image */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Image</Label>

            {/* Standard — default, always shown */}
            <div
              onClick={() => { setSelectedImageId(null); setShowImagePicker(false); }}
              className={cn(
                "cursor-pointer flex items-center gap-3 p-3 rounded-lg border transition-colors",
                isStandard ? "border-primary bg-primary/5" : "hover:bg-muted/30"
              )}
            >
              <Monitor className={cn("size-4 shrink-0", isStandard ? "text-primary" : "text-muted-foreground")} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">justavps standard</div>
                <div className="text-xs text-muted-foreground">Default base image · Ubuntu 24.04 (amd64)</div>
              </div>
              {isStandard && <Check className="size-4 text-primary shrink-0" />}
            </div>

            {/* Other images — collapsible picker */}
            {otherImages.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const next = !showImagePicker;
                    setShowImagePicker(next);
                    if (!next) setSelectedImageId(null);
                  }}
                  className={cn(
                    "w-full flex items-center justify-between gap-3 p-3 rounded-lg border transition-colors text-left",
                    showImagePicker ? "border-primary bg-primary/5" : "hover:bg-muted/30"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <HardDrive className={cn("size-4 shrink-0", showImagePicker ? "text-primary" : "text-muted-foreground")} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium">
                        {selectedImage ? selectedImage.name : "Choose another image"}
                      </div>
                      {selectedImage ? (
                        <div className="text-xs text-muted-foreground">
                          {selectedImage.kind === "template" ? "Template" : "Saved image"} · {selectedImage.architecture || "x86"}
                          {selectedImage.disk_size_gb ? ` · ${selectedImage.disk_size_gb} GB` : ""}
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">{otherImages.length} available</div>
                      )}
                    </div>
                  </div>
                  <ChevronDown className={cn("size-4 shrink-0 transition-transform text-muted-foreground", showImagePicker && "rotate-180")} />
                </button>

                {showImagePicker && (
                  <div className="space-y-1.5 pl-1">
                    {otherImages.map((img) => (
                      <ImageRow
                        key={img.id}
                        image={img}
                        selected={selectedImageId === img.id}
                        onClick={() => setSelectedImageId(img.id)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Docker — optional collapsible addon */}
            <button
              type="button"
              onClick={() => setShowDockerConfig((prev) => !prev)}
              className={cn(
                "w-full flex items-center justify-between gap-3 p-3 rounded-lg border transition-colors text-left",
                showDockerConfig ? "border-primary bg-primary/5" : "hover:bg-muted/30"
              )}
            >
              <div className="flex items-center gap-3">
                <Container className={cn("size-4 shrink-0", showDockerConfig ? "text-primary" : "text-muted-foreground")} />
                <div className="min-w-0">
                  <div className="text-sm font-medium">Docker</div>
                  <div className="text-xs text-muted-foreground">
                    {showDockerConfig && dockerImage ? dockerImage : "Auto-run a container on boot (optional)"}
                  </div>
                </div>
              </div>
              <ChevronDown className={cn("size-4 shrink-0 transition-transform text-muted-foreground", showDockerConfig && "rotate-180")} />
            </button>

            {showDockerConfig && (
              <div className="space-y-3 pl-1">
                <div className="space-y-2">
                  <Input
                    placeholder="nginx:latest"
                    value={dockerImage}
                    onChange={(e) => setDockerImage(e.target.value)}
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground">
                    Public Docker Hub image to auto-start on the selected base OS.
                  </p>
                  <p className="text-xs text-muted-foreground/80">
                    Exposed container port `80` is remapped to host `8080`, `443` to `8443`, and SSH stays on the base machine.
                  </p>
                </div>
                {dockerImage && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="docker-entrypoint" className="text-xs uppercase tracking-wider text-muted-foreground">
                        Entrypoint <span className="normal-case">(optional)</span>
                      </Label>
                      <Input
                        id="docker-entrypoint"
                        placeholder="/bin/sh"
                        value={entrypoint}
                        onChange={(e) => setEntrypoint(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Real Docker `--entrypoint` override. Leave blank to use the image default.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="docker-command" className="text-xs uppercase tracking-wider text-muted-foreground">
                        Command <span className="normal-case">(optional)</span>
                      </Label>
                      <Input
                        id="docker-command"
                        placeholder="-lc 'python -m http.server 80'"
                        value={command}
                        onChange={(e) => setCommand(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Command and args passed after the image name. Example: `sleep infinity`.
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Step 2: Provider */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Provider</Label>
            <div className="flex gap-2">
              {providers.map((p) => (
                <button
                  key={p.name}
                    onClick={() => {
                      setSelectedProviderOverride(p.name);
                      setSelectedRegionOverride(null);
                      setSelectedServerTypeOverride(null);
                    }}
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
                    onClick={() => {
                      setSelectedRegionOverride(r.id);
                      setSelectedServerTypeOverride(null);
                    }}
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
                    onClick={() => setSelectedServerTypeOverride(s.name)}
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
                placeholder="auto-generated if blank"
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
            {image.kind === "template" ? "Template" : "Saved image"} · {image.architecture || "x86"}
            {image.disk_size_gb && <> &middot; {image.disk_size_gb} GB</>}
          </div>
          {image.description ? (
            <div className="text-[11px] text-muted-foreground/80 mt-0.5">{image.description}</div>
          ) : null}
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
