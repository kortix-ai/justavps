"use client";

import { useState, useEffect } from "react";
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
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { toast } from "sonner";

interface Snapshot {
  id: string;
  name: string;
  docker_image: string;
  status: string;
  architecture: string | null;
  providers: Record<string, { snapshotId: string; diskSize: number; architecture: string }>;
  created_at: string;
  updated_at: string;
}

interface Provider {
  name: string;
  displayName: string;
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; color: string }> = {
  building: { label: "Building", variant: "secondary", color: "bg-yellow-500" },
  ready: { label: "Ready", variant: "default", color: "bg-green-500" },
  failed: { label: "Failed", variant: "destructive", color: "bg-red-500" },
};

export default function SnapshotsPage() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const fetchSnapshots = () => {
    apiGet<{ snapshots: Snapshot[] }>("/snapshots")
      .then((data) => setSnapshots(data.snapshots || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchSnapshots();
    apiGet<{ providers: Provider[] }>("/server-types/providers")
      .then((data) => setProviders(data.providers || []))
      .catch(() => {});
  }, []);

  // Poll building snapshots
  useEffect(() => {
    const hasBuilding = snapshots.some((s) => s.status === "building");
    if (!hasBuilding) return;

    const interval = setInterval(fetchSnapshots, 5000);
    return () => clearInterval(interval);
  }, [snapshots]);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete snapshot "${name}"? This will remove all provider snapshots.`)) return;
    try {
      await apiDelete(`/snapshots/${id}`);
      setSnapshots((prev) => prev.filter((s) => s.id !== id));
      toast.success("Snapshot deleted");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Snapshots</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger className={cn(buttonVariants())}>
            New Snapshot
          </DialogTrigger>
          <CreateSnapshotDialog
            providers={providers}
            onCreated={(snapshot) => {
              setSnapshots((prev) => [snapshot, ...prev]);
              setDialogOpen(false);
              toast.success("Snapshot build started");
            }}
          />
        </Dialog>
      </div>

      {error && (
        <div className="text-center py-12">
          <p className="text-destructive">Error: {error}</p>
          <Button variant="outline" onClick={() => window.location.reload()} className="mt-4">
            Retry
          </Button>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="p-6 border rounded-lg space-y-4">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ))}
        </div>
      ) : !error && snapshots.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-6xl mb-4">📦</div>
          <h2 className="text-2xl font-semibold mb-2">No snapshots yet</h2>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            Create a snapshot from a Docker image to start spinning up machines.
          </p>
          <Button size="lg" onClick={() => setDialogOpen(true)}>
            Create Your First Snapshot
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {snapshots.map((snapshot) => (
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
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">{snapshot.name}</CardTitle>
            <div className="flex items-center space-x-2 mt-1">
              <Badge variant={status.variant}>{status.label}</Badge>
              <div className={`w-2 h-2 rounded-full ${status.color} ${snapshot.status === "building" ? "animate-pulse" : ""}`} />
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Docker Image:</span>
            <span className="font-mono text-xs truncate ml-2 max-w-[180px]" title={snapshot.docker_image}>
              {snapshot.docker_image}
            </span>
          </div>

          <div className="flex justify-between">
            <span className="text-muted-foreground">Architecture:</span>
            <span className="font-medium">{snapshot.architecture || "x86"}</span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Providers:</span>
            <div className="flex gap-1">
              {providerNames.length > 0 ? (
                providerNames.map((p) => (
                  <Badge key={p} variant="outline" className="text-xs">
                    {p}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">
                  {snapshot.status === "building" ? "Building..." : "None"}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Created {new Date(snapshot.created_at).toLocaleDateString()}
          </div>
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onDelete}>
            Delete
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
  providers: Provider[];
  onCreated: (snapshot: Snapshot) => void;
}) {
  const [name, setName] = useState("");
  const [dockerImage, setDockerImage] = useState("");
  const [provider, setProvider] = useState(providers[0]?.name || "hetzner");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !dockerImage || !provider) return;

    setSubmitting(true);
    try {
      const snapshot = await apiPost<Snapshot>("/snapshots", {
        name,
        docker_image: dockerImage,
        provider,
      });
      onCreated(snapshot);
      setName("");
      setDockerImage("");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Create Snapshot</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            placeholder="my-dev-env"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="docker_image">Docker Image</Label>
          <Input
            id="docker_image"
            placeholder="kortix/computer:0.8.6"
            value={dockerImage}
            onChange={(e) => setDockerImage(e.target.value)}
            required
          />
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
                <SelectItem key={p.name} value={p.name}>
                  {p.displayName}
                </SelectItem>
              ))}
              {providers.length === 0 && (
                <SelectItem value="hetzner">Hetzner Cloud</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="submit" disabled={submitting || !name || !dockerImage}>
            {submitting ? "Creating..." : "Build Snapshot"}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Building takes ~10-15 minutes. You can close this dialog — the build continues in the background.
        </p>
      </form>
    </DialogContent>
  );
}
