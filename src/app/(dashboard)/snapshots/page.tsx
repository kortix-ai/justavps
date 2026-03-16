"use client";

import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import type { Snapshot } from "@/lib/types";
import { HardDrive, Plus, Trash2 } from "lucide-react";

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; dotClass: string }> = {
  building: { label: "Building", variant: "secondary", dotClass: "bg-yellow-500 animate-pulse" },
  ready: { label: "Ready", variant: "default", dotClass: "bg-green-500" },
  failed: { label: "Failed", variant: "destructive", dotClass: "bg-red-500" },
};

export default function SnapshotsPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: snapshots, isLoading, error } = useSnapshots();
  const { data: providers } = useProviders();
  const deleteSnapshot = useDeleteSnapshot();

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Delete snapshot "${name}"? This will remove all provider snapshots.`)) return;
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
          <DialogTrigger className={cn(buttonVariants({ size: "sm" }))}>
            <Plus className="mr-2 size-4" />
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
          <Button variant="outline" size="sm" onClick={() => window.location.reload()} className="mt-4">
            Retry
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="p-5 border rounded-lg space-y-3">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ))}
        </div>
      ) : !error && snapshots?.length === 0 ? (
        <div className="text-center py-20">
          <HardDrive className="mx-auto size-10 text-muted-foreground/50 mb-4" />
          <h2 className="font-heading text-xl mb-1">No snapshots yet</h2>
          <p className="text-muted-foreground text-sm mb-6 max-w-md mx-auto">
            Create a snapshot from a Docker image to start spinning up machines.
          </p>
          <Button onClick={() => setDialogOpen(true)}>
            Create Your First Snapshot
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {snapshots?.map((snapshot) => (
            <SnapshotCard
              key={snapshot.id}
              snapshot={snapshot}
              onDelete={() => handleDelete(snapshot.id, snapshot.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Snapshot Card ──────────────────────────────────────────────────────────

function SnapshotCard({ snapshot, onDelete }: { snapshot: Snapshot; onDelete: () => void }) {
  const status = statusConfig[snapshot.status] || statusConfig.failed;
  const providerNames = Object.keys(snapshot.providers);

  return (
    <Card className="shadow-none">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-sm font-medium">{snapshot.name}</CardTitle>
            <div className="flex items-center gap-2 mt-1.5">
              <div className={`size-1.5 rounded-full ${status.dotClass}`} />
              <Badge variant={status.variant} className="text-[10px] px-1.5 py-0">{status.label}</Badge>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-1.5 text-xs text-muted-foreground">
          <div className="flex justify-between">
            <span>Image</span>
            <span className="font-mono text-foreground truncate ml-2 max-w-[180px]" title={snapshot.docker_image}>
              {snapshot.docker_image}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Architecture</span>
            <span className="text-foreground">{snapshot.architecture || "x86"}</span>
          </div>
          <div className="flex justify-between items-center">
            <span>Providers</span>
            <div className="flex gap-1">
              {providerNames.length > 0 ? (
                providerNames.map((p) => (
                  <Badge key={p} variant="outline" className="text-[10px] px-1.5 py-0">{p}</Badge>
                ))
              ) : (
                <span className="text-[10px]">{snapshot.status === "building" ? "Building..." : "None"}</span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            Created {new Date(snapshot.created_at).toLocaleDateString()}
          </span>
          <Button variant="ghost" size="sm" className="h-7 text-destructive hover:text-destructive" onClick={onDelete}>
            <Trash2 className="size-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
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
          <p className="text-[11px] text-muted-foreground">
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
          <Button type="submit" size="sm" disabled={createSnapshot.isPending || !name || !dockerImage}>
            {createSnapshot.isPending ? "Creating..." : "Build Snapshot"}
          </Button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Building takes ~10-15 minutes. You can close this dialog &mdash; the build continues in the background.
        </p>
      </form>
    </DialogContent>
  );
}
