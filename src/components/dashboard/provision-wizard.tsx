"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { apiFetch, apiGet } from "@/lib/api";

interface ServerType {
  name: string;
  vcpu: number;
  ram_gb: number;
  disk_gb: number;
  cpu_type: string;
  price_monthly: number;
}

interface Region {
  id: string;
  name: string;
  country: string;
  city: string;
}

interface Provider {
  name: string;
  displayName: string;
}

interface Snapshot {
  id: string;
  name: string;
  docker_image: string;
  status: string;
  providers: Record<string, { snapshotId: string; diskSize: number; architecture: string }>;
}

export function ProvisionWizard() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  // Step 1: Snapshot
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState("");

  // Step 2: Provider
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("");

  // Step 3: Region
  const [regions, setRegions] = useState<Region[]>([]);
  const [selectedRegion, setSelectedRegion] = useState("");

  // Step 4: Size
  const [serverTypes, setServerTypes] = useState<ServerType[]>([]);
  const [selectedServerType, setSelectedServerType] = useState("");
  const [showMore, setShowMore] = useState(false);

  // Optional
  const [machineName, setMachineName] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Load snapshots + providers on mount
  useEffect(() => {
    apiGet<{ snapshots: Snapshot[] }>("/snapshots")
      .then((d) => {
        const ready = (d.snapshots || []).filter((s) => s.status === "ready");
        setSnapshots(ready);
        if (ready.length === 1) setSelectedSnapshot(ready[0].id);
      })
      .catch(() => {});

    apiGet<{ providers: Provider[] }>("/server-types/providers")
      .then((d) => {
        setProviders(d.providers || []);
        if (d.providers?.length === 1) setSelectedProvider(d.providers[0].name);
      })
      .catch(() => {});
  }, []);

  // Filter providers to ones this snapshot is built on
  const snapshot = snapshots.find((s) => s.id === selectedSnapshot);
  const availableProviders = providers.filter(
    (p) => snapshot?.providers?.[p.name]
  );

  // Auto-select provider when snapshot changes
  useEffect(() => {
    if (!snapshot) return;
    const available = providers.filter((p) => snapshot.providers?.[p.name]);
    if (available.length === 1) {
      setSelectedProvider(available[0].name);
    } else if (selectedProvider && !snapshot.providers?.[selectedProvider]) {
      setSelectedProvider("");
    }
  }, [selectedSnapshot, providers]);

  // Load regions when provider changes
  useEffect(() => {
    if (!selectedProvider) { setRegions([]); return; }
    apiGet<{ regions: Region[] }>(`/server-types/regions?provider=${selectedProvider}`)
      .then((d) => {
        setRegions(d.regions || []);
        if (d.regions?.length && !selectedRegion) setSelectedRegion(d.regions[0].id);
      })
      .catch(() => {});
  }, [selectedProvider]);

  // Load server types when provider + region change
  useEffect(() => {
    if (!selectedProvider || !selectedRegion) { setServerTypes([]); return; }
    apiFetch(`/server-types?provider=${selectedProvider}&region=${selectedRegion}`)
      .then((r) => r.json())
      .then((d) => {
        const all = d.server_types || [];
        setServerTypes(all);
        if (!selectedServerType && all.length > 0) setSelectedServerType(all[0].name);
      })
      .catch(() => {});
  }, [selectedProvider, selectedRegion]);

  const handleCreate = async () => {
    if (!selectedSnapshot) { toast.error("Select a snapshot"); return; }
    if (!selectedProvider) { toast.error("Select a provider"); return; }
    if (!selectedServerType) { toast.error("Select a server size"); return; }
    setLoading(true);
    try {
      const res = await apiFetch("/machines", {
        method: "POST",
        body: JSON.stringify({
          snapshot_id: selectedSnapshot,
          provider: selectedProvider,
          server_type: selectedServerType,
          region: selectedRegion,
          name: machineName || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed");
      }
      const machine = await res.json();
      toast.success("Machine created!");
      router.push(`/machines/${machine.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const displayed = showMore ? serverTypes : serverTypes.slice(0, 3);
  const selectedST = serverTypes.find((s) => s.name === selectedServerType);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New Machine</h1>
        <p className="text-sm text-muted-foreground">
          Pick a snapshot, provider, region, and size.
        </p>
      </div>

      {/* Step 1: Snapshot */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Snapshot</Label>
        {snapshots.length === 0 ? (
          <div className="text-sm text-muted-foreground p-4 border border-dashed rounded-lg text-center">
            No snapshots available.{" "}
            <a href="/snapshots" className="text-primary hover:underline">
              Create one first
            </a>
          </div>
        ) : (
          <div className="space-y-2">
            {snapshots.map((s) => (
              <div
                key={s.id}
                onClick={() => setSelectedSnapshot(s.id)}
                className={`cursor-pointer flex items-center justify-between p-3 rounded-lg border transition-all
                  ${selectedSnapshot === s.id
                    ? "border-primary bg-primary/5 ring-1 ring-primary/50"
                    : "border-border/50 hover:border-border hover:bg-muted/20"
                  }`}
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium text-sm">{s.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {s.docker_image}
                  </span>
                </div>
                <div className="flex gap-1">
                  {Object.keys(s.providers).map((p) => (
                    <Badge key={p} variant="outline" className="text-xs">
                      {p}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Step 2: Provider */}
      {selectedSnapshot && (
        <div className="space-y-3">
          <Label className="text-sm font-medium">Provider</Label>
          <div className="flex gap-2">
            {availableProviders.map((p) => (
              <button
                key={p.name}
                onClick={() => setSelectedProvider(p.name)}
                className={`px-4 py-2 rounded-lg text-sm border transition-all
                  ${selectedProvider === p.name
                    ? "border-primary bg-primary/10 font-medium"
                    : "border-border/50 text-muted-foreground hover:border-border"
                  }`}
              >
                {p.displayName}
              </button>
            ))}
            {availableProviders.length === 0 && (
              <p className="text-sm text-muted-foreground">
                This snapshot hasn't been built on any provider yet.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Step 3: Region */}
      {selectedProvider && (
        <div className="space-y-3">
          <Label className="text-sm font-medium">Region</Label>
          <div className="flex flex-wrap gap-2">
            {regions.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedRegion(r.id)}
                className={`px-3 py-1.5 rounded-md text-sm border transition-all
                  ${selectedRegion === r.id
                    ? "border-primary bg-primary/10"
                    : "border-border/50 text-muted-foreground hover:border-border"
                  }`}
              >
                {r.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 4: Size */}
      {selectedRegion && serverTypes.length > 0 && (
        <div className="space-y-3">
          <Label className="text-sm font-medium">Size</Label>
          <div className="space-y-2">
            {displayed.map((s) => (
              <div
                key={s.name}
                onClick={() => setSelectedServerType(s.name)}
                className={`cursor-pointer flex items-center justify-between p-3 rounded-lg border transition-all
                  ${selectedServerType === s.name
                    ? "border-primary bg-primary/5 ring-1 ring-primary/50"
                    : "border-border/50 hover:border-border hover:bg-muted/20"
                  }`}
              >
                <div className="flex items-center gap-4">
                  <span className="font-mono text-sm text-muted-foreground w-12">
                    {s.name}
                  </span>
                  <div className="flex gap-3 text-sm">
                    <span>{s.vcpu} vCPU</span>
                    <span className="text-muted-foreground">·</span>
                    <span>{s.ram_gb} GB</span>
                    <span className="text-muted-foreground">·</span>
                    <span>{s.disk_gb} GB</span>
                  </div>
                </div>
                <span className="font-semibold text-sm">
                  ${s.price_monthly}/mo
                </span>
              </div>
            ))}
          </div>
          {!showMore && serverTypes.length > 3 && (
            <button
              onClick={() => setShowMore(true)}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Show {serverTypes.length - 3} more
            </button>
          )}
        </div>
      )}

      {/* Advanced: Name */}
      {selectedServerType && (
        <>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {showAdvanced ? "Hide" : "+"} Machine name
          </button>

          {showAdvanced && (
            <div className="pl-4 border-l-2 border-border/30">
              <Label className="text-sm">Name</Label>
              <Input
                placeholder="my-machine"
                value={machineName}
                onChange={(e) => setMachineName(e.target.value)}
                className="mt-1 max-w-xs"
              />
            </div>
          )}
        </>
      )}

      {/* Create */}
      {selectedServerType && (
        <Card className="bg-muted/20">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                {selectedST && (
                  <div className="text-sm">
                    <span className="font-mono">{selectedST.name}</span>
                    <span className="text-muted-foreground"> · </span>
                    <span className="text-xs">
                      {selectedST.vcpu} vCPU / {selectedST.ram_gb}GB /{" "}
                      {selectedST.disk_gb}GB
                    </span>
                  </div>
                )}
                <div className="text-xs text-muted-foreground">
                  {snapshot?.name} · {selectedProvider} ·{" "}
                  {regions.find((r) => r.id === selectedRegion)?.name}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-lg font-bold">
                    ${selectedST?.price_monthly ?? "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">/month</div>
                </div>
                <Button
                  onClick={handleCreate}
                  disabled={loading || !selectedServerType}
                  size="lg"
                >
                  {loading ? "Creating..." : "Create"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
