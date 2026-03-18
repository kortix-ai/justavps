"use client";

import { Button } from "@/components/ui/button";
import { cn, timeAgo } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useImages, useDeleteImage } from "@/hooks/use-images";
import { useConfirm } from "@/hooks/use-confirm";
import type { Image } from "@/lib/types";
import { HardDrive, Trash2, Container, Loader2 } from "lucide-react";

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; dotClass: string }> = {
  creating: { label: "Creating", variant: "secondary", dotClass: "bg-yellow-500 animate-pulse" },
  ready: { label: "Ready", variant: "default", dotClass: "bg-green-500" },
  failed: { label: "Failed", variant: "destructive", dotClass: "bg-red-500" },
};

export default function ImagesPage() {
  const { data: images, isLoading, error } = useImages();
  const deleteImage = useDeleteImage();
  const [confirm, ConfirmDialog] = useConfirm();

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
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-3xl tracking-tight">Images</h1>
        <p className="text-sm text-muted-foreground">
          Create images from running machines via Machine &rarr; Create Image
        </p>
      </div>

      {error && (
        <div className="text-center py-12">
          <p className="text-destructive text-sm">Error: {error.message}</p>
          <Button variant="outline" onClick={() => window.location.reload()} className="mt-4">
            Retry
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="p-4 rounded-xl bg-muted/30 space-y-3">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      ) : !error && images?.length === 0 ? (
        <div className="text-center py-20">
          <HardDrive className="mx-auto size-12 text-muted-foreground/40 mb-4" strokeWidth={1} />
          <h2 className="font-heading text-2xl mb-2">No images yet</h2>
          <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
            Capture an image from a running machine to create reusable snapshots.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {images?.map((image) => (
            <ImageCard
              key={image.id}
              image={image}
              onDelete={() => handleDelete(image.id, image.name)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog />
    </div>
  );
}

// ─── Image Card ────────────────────────────────────────────────────────────

function ImageCard({ image, onDelete }: { image: Image; onDelete: () => void }) {
  const status = statusConfig[image.status] || statusConfig.failed;
  const isCreating = image.status === "creating";

  return (
    <div className="group relative p-4 rounded-xl bg-card transition-colors hover:bg-muted/40">
      {/* Header */}
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
            <div className="font-mono text-xs text-muted-foreground">{image.provider}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`size-1.5 rounded-full ${status.dotClass}`} />
          <span className="text-xs text-muted-foreground">{status.label}</span>
        </div>
      </div>

      {/* Details */}
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

      {/* Provider + Delete */}
      <div className="flex items-center justify-between mt-3">
        <Badge variant="outline" className="text-[10px]">{image.provider}</Badge>
        <Button
          variant="ghost"
          size="sm"
          className="size-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
