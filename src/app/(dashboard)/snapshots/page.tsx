"use client";

import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useSnapshots, useCreateSnapshot, useDeleteSnapshot } from "@/hooks/use-snapshots";
import { useProviders } from "@/hooks/use-server-types";
import { useConfirm } from "@/hooks/use-confirm";
import type { Snapshot } from "@/lib/types";
import { HardDrive, Plus, Trash2, Container, Loader2 } from "lucide-react";

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; dotClass: string }> = {
  building: { label: "Building", variant: "secondary", dotClass: "bg-yellow-500 animate-pulse" },
  ready: { label: "Ready", variant: "default", dotClass: "bg-green-500" },
  failed: { label: "Failed", variant: "destructive", dotClass: "bg-red-500" },
};

function timeAgo(date: string) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

export default function SnapshotsPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: snapshots, isLoading, error } = useSnapshots();
  const { data: providers } = useProviders();
  const deleteSnapshot = useDeleteSnapshot();
  const [confirm, ConfirmDialog] = useConfirm();

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: "Delete Snapshot",
      description: `This will permanently delete "${name}" and remove all provider-side snapshots. Machines already using this snapshot will not be affected.`,
      confirmLabel: "Delete Snapshot",
      variant: "destructive",
      icon: <Trash2 className="size-4 text-destructive" />,
    });
    if (!ok) return;

    deleteSnapshot.mutate(id, {
      onSuccess: () => toast.success("Snapshot deleted"),
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-3xl tracking-tight">Snapshots</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger className={cn(buttonVariants())}>
            <Plus className="size-4" />
            New Snapshot
          </DialogTrigger>
          <CreateSnapshotDialog
            providers={providers ?? []}
            onCreated={() => {
              setDialogOpen(false);
              toast.success("Snapshot build started");
            }}
          />
        </Dialog>
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
      ) : !error && snapshots?.length === 0 ? (
        <div className="text-center py-20">
          <HardDrive className="mx-auto size-12 text-muted-foreground/40 mb-4" strokeWidth={1} />
          <h2 className="font-heading text-2xl mb-2">No snapshots yet</h2>
          <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
            Create a snapshot from a Docker image to start spinning up machines.
          </p>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 size-4" />
            Create Your First Snapshot
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {snapshots?.map((snapshot) => (
            <SnapshotCard
              key={snapshot.id}
              snapshot={snapshot}
              onDelete={() => handleDelete(snapshot.id, snapshot.name)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog />
    </div>
  );
}

// ─── Snapshot Card ──────────────────────────────────────────────────────────

function SnapshotCard({ snapshot, onDelete }: { snapshot: Snapshot; onDelete: () => void }) {
  const status = statusConfig[snapshot.status] || statusConfig.failed;
  const providerNames = Object.keys(snapshot.providers);
  const isBuilding = snapshot.status === "building";

  return (
    <div className="group relative p-4 rounded-xl bg-card transition-colors hover:bg-muted/40">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-muted/60">
            {isBuilding ? (
              <Loader2 className="size-4 text-muted-foreground animate-spin" />
            ) : (
              <Container className="size-4 text-muted-foreground" />
            )}
          </div>
          <div>
            <div className="font-medium text-sm">{snapshot.name}</div>
            <div className="font-mono text-xs text-muted-foreground">{snapshot.docker_image}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`size-1.5 rounded-full ${status.dotClass}`} />
          <span className="text-xs text-muted-foreground">{status.label}</span>
        </div>
      </div>

      {/* Details */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
        <span>{snapshot.architecture || "x86"}</span>
        <span>&middot;</span>
        <span>Created {timeAgo(snapshot.created_at)}</span>
        {snapshot.last_used_at && (
          <>
            <span>&middot;</span>
            <span>Used {timeAgo(snapshot.last_used_at)}</span>
          </>
        )}
      </div>

      {/* Providers + Delete */}
      <div className="flex items-center justify-between mt-3">
        <div className="flex gap-1">
          {providerNames.length > 0 ? (
            providerNames.map((p) => (
              <Badge key={p} variant="outline" className="text-[10px]">{p}</Badge>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">{isBuilding ? "Building..." : "No providers"}</span>
          )}
        </div>
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

// ─── Create Snapshot Dialog ─────────────────────────────────────────────────

function CreateSnapshotDialog({
  providers,
  onCreated,
}: {
  providers: { name: string; displayName: string }[];
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [dockerImage, setDockerImage] = useState("");
  const [provider, setProvider] = useState(providers[0]?.name || "hetzner");
  const createSnapshot = useCreateSnapshot();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !dockerImage || !provider) return;

    createSnapshot.mutate(
      { name, docker_image: dockerImage, provider },
      {
        onSuccess: () => { setName(""); setDockerImage(""); onCreated(); },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Create Snapshot</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" placeholder="my-dev-env" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>

        <div className="space-y-2">
          <Label htmlFor="docker_image">Docker Image</Label>
          <Input id="docker_image" placeholder="kortix/computer:0.8.6" value={dockerImage} onChange={(e) => setDockerImage(e.target.value)} required />
          <p className="text-xs text-muted-foreground">
            Public Docker Hub image. We'll pull it and create a bootable snapshot.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="provider">Provider</Label>
          <Select value={provider} onValueChange={(val) => { if (val) setProvider(val); }}>
            <SelectTrigger>
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              {providers.map((p) => (
                <SelectItem key={p.name} value={p.name}>{p.displayName}</SelectItem>
              ))}
              {providers.length === 0 && (
                <SelectItem value="hetzner">Hetzner Cloud</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="submit" disabled={createSnapshot.isPending || !name || !dockerImage}>
            {createSnapshot.isPending ? (
              <><Loader2 className="size-4 animate-spin mr-2" />Building...</>
            ) : (
              "Build Snapshot"
            )}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Building takes ~10-15 minutes. You can close this dialog &mdash; the build continues in the background.
        </p>
      </form>
    </DialogContent>
  );
}
