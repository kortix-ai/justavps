"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { timeAgo, cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useAccountLimits } from "@/hooks/use-account";
import { useImages, useCreateImage, useDeleteImage } from "@/hooks/v2/use-images-v2";
import { useMachines } from "@/hooks/v2/use-machines-v2";
import { useConfirm } from "@/hooks/use-confirm";
import { formatLimit, isUnlimitedLimit } from "@/lib/account-limits";
import type { Image } from "@/lib/types";
import { HardDrive, Trash2, Container, Loader2, Plus, AlertTriangle } from "lucide-react";

const statusConfig: Record<string, { label: string; dotClass: string }> = {
  creating: { label: "Creating", dotClass: "bg-yellow-500 animate-pulse" },
  ready: { label: "Ready", dotClass: "bg-emerald-500" },
  failed: { label: "Failed", dotClass: "bg-red-500" },
};

export default function ImagesPage() {
  const { data: images, isLoading, error } = useImages();
  const { data: machines } = useMachines();
  const { data: limits } = useAccountLimits();
  const createImage = useCreateImage();
  const deleteImage = useDeleteImage();
  const [confirm, ConfirmDialog] = useConfirm();
  const [createOpen, setCreateOpen] = useState(false);
  const [imageName, setImageName] = useState("");
  const [selectedMachineId, setSelectedMachineId] = useState("");

  const readyMachines = machines?.filter((m) => m.status === "ready") ?? [];
  const imageUsage = limits?.usage.images ?? 0;
  const imageMax = limits?.limits.max_images;
  const imageUnlimited = isUnlimitedLimit(imageMax);
  const imageLimitReached = !imageUnlimited && imageMax !== undefined && imageUsage >= imageMax;
  const imageLimitNear = !imageUnlimited && imageMax !== undefined && imageMax > 0 && imageUsage / imageMax >= 0.8 && !imageLimitReached;

  const handleCreate = () => {
    if (!imageName.trim() || !selectedMachineId) return;
    createImage.mutate(
      { machine_id: selectedMachineId, name: imageName.trim() },
      {
        onSuccess: () => {
          toast.success("Image creation started");
          setCreateOpen(false);
          setImageName("");
          setSelectedMachineId("");
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: "Delete Image",
      description: `This will permanently delete "${name}" and remove the provider-side image. Machines already using this image will not be affected.`,
      confirmLabel: "Delete Image",
      variant: "destructive",
      icon: <Trash2 className="size-4 text-destructive" />,
    });
    if (!ok) return;
    deleteImage.mutate(id, {
      onSuccess: () => toast.success("Image deleted"),
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-heading text-3xl tracking-tight">Images</h1>
        <Button onClick={() => setCreateOpen(true)} disabled={readyMachines.length === 0 || imageLimitReached}>
          <Plus className="size-4" />
          Create Image
        </Button>
      </div>

      {(imageLimitReached || imageLimitNear) && (
        <div className={cn(
          "flex items-start gap-3 rounded-xl border p-4",
          imageLimitReached ? "border-destructive/20 bg-destructive/5" : "border-amber-500/20 bg-amber-500/10",
        )}>
          <AlertTriangle className={cn(
            "mt-0.5 size-4 shrink-0",
            imageLimitReached ? "text-destructive" : "text-amber-500",
          )} />
          <div className="space-y-0.5">
            <p className="text-sm font-medium">
              {imageLimitReached ? "Image limit reached" : "Approaching image limit"}
            </p>
            <p className="text-xs text-muted-foreground">
              You are using {imageUsage} of {formatLimit(imageMax)} images.
              {imageLimitReached
                ? " Delete an image to create another one."
                : " You can still capture more images, but you are close to your cap."}
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="text-center py-12">
          <p className="text-destructive text-sm">Error: {error.message}</p>
          <Button variant="outline" onClick={() => window.location.reload()} className="mt-4">
            Retry
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border p-5 space-y-4">
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      ) : !error && images?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="relative mb-6">
            <div className="rounded-2xl bg-muted p-5">
              <HardDrive className="size-10 text-muted-foreground/50" strokeWidth={1.5} />
            </div>
            <div className="absolute -bottom-1 -right-1 rounded-full bg-primary p-1.5">
              <Plus className="size-3 text-primary-foreground" />
            </div>
          </div>
          <h2 className="font-heading text-xl mb-1.5">No images yet</h2>
          <p className="text-sm text-muted-foreground mb-6 text-center max-w-xs">
            Capture an image from a running machine to save its state and spin up identical machines later.
          </p>
          {readyMachines.length > 0 && !imageLimitReached && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              Create Your First Image
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {images?.map((image) => (
            <ImageCard
              key={image.id}
              image={image}
              onDelete={() => handleDelete(image.id, image.name)}
            />
          ))}
        </div>
      )}

      {/* Create Image Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Image</DialogTitle>
            <DialogDescription>
              Capture the current state of a running machine as a reusable image.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Source Machine</Label>
              <Select value={selectedMachineId} onValueChange={(v) => setSelectedMachineId(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a running machine" />
                </SelectTrigger>
                <SelectContent>
                  {readyMachines.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name} <span className="text-muted-foreground ml-1">({m.slug})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-image-name">Image Name</Label>
              <Input
                id="new-image-name"
                placeholder="my-dev-environment"
                value={imageName}
                onChange={(e) => setImageName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createImage.isPending || !imageName.trim() || !selectedMachineId || imageLimitReached}>
              {createImage.isPending ? <><Loader2 className="size-4 animate-spin" />Creating...</> : "Create Image"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog />
    </div>
  );
}

// --- Image Card ---

function ImageCard({ image, onDelete }: { image: Image; onDelete: () => void }) {
  const status = statusConfig[image.status] || statusConfig.failed;
  const isCreating = image.status === "creating";
  const canDelete = !image.is_template;
  const kindLabel = image.kind === "template" ? "Template" : "Saved image";

  return (
    <div className="group relative p-4 rounded-xl border bg-card transition-colors hover:bg-muted/40">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-muted/60">
            {isCreating ? (
              <Loader2 className="size-4 text-muted-foreground animate-spin" />
            ) : (
              <Container className="size-4 text-muted-foreground" />
            )}
          </div>
          <div>
            <div className="font-medium text-sm">{image.name}</div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="rounded-full border border-border/70 bg-muted/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {kindLabel}
              </span>
              <div className="font-mono text-xs text-muted-foreground">{image.architecture || "x86"}</div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`size-1.5 rounded-full ${status.dotClass}`} />
          <span className="text-xs text-muted-foreground">{status.label}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
        <span>{image.architecture || "x86"}</span>
        {image.disk_size_gb && (
          <>
            <span>&middot;</span>
            <span>{image.disk_size_gb} GB</span>
          </>
        )}
        <span>&middot;</span>
        <span>Created {timeAgo(image.created_at)}</span>
      </div>

      {image.description && (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {image.description}
        </p>
      )}

      {canDelete && (
        <div className="flex items-center justify-end mt-3">
          <Button
            variant="ghost"
            size="sm"
            className="size-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
