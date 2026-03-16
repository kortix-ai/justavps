"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";

interface ServerType {
  name: string;
  vcpu: number;
  ram_gb: number;
  disk_gb: number;
  cpu_type: string;
  price_monthly: number;
}

const REGIONS = [
  { value: "nbg1", label: "Nuremberg", flag: "🇩🇪" },
  { value: "fsn1", label: "Falkenstein", flag: "🇩🇪" },
  { value: "hel1", label: "Helsinki", flag: "🇫🇮" },
];

export function ProvisionWizard() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [serverTypes, setServerTypes] = useState<ServerType[]>([]);
  const [selectedServerType, setSelectedServerType] = useState("");
  const [selectedRegion, setSelectedRegion] = useState("nbg1");
  const [machineName, setMachineName] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    apiFetch(`/server-types?region=${selectedRegion}`)
      .then(r => r.json())
      .then(d => {
        const all = d.server_types || [...(d.featured || []), ...(d.more || [])];
        setServerTypes(all);
        if (!selectedServerType && all.length > 0) setSelectedServerType(all[0].name);
      })
      .catch(() => {});
  }, [selectedRegion]);

  const handleCreate = async () => {
    if (!selectedServerType) { toast.error('Select a server size'); return; }
    setLoading(true);
    try {
      const res = await apiFetch('/machines', {
        method: 'POST',
        body: JSON.stringify({
          server_type: selectedServerType,
          region: selectedRegion,
          name: machineName || undefined,
        }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || 'Failed'); }
      const machine = await res.json();
      toast.success('Machine created!');
      router.push(`/machines/${machine.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally { setLoading(false); }
  };

  const displayed = showMore ? serverTypes : serverTypes.slice(0, 3);
  const selectedST = serverTypes.find(s => s.name === selectedServerType);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">New Machine</h1>
        <p className="text-sm text-muted-foreground">
          Pick a size. SSH key auto-generated. Ready in ~60s.
        </p>
      </div>

      {/* Server Size */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Size</Label>
        <div className="space-y-2">
          {displayed.length === 0 && (
            <div className="space-y-2">
              {[1,2,3].map(i => <div key={i} className="h-14 rounded-lg bg-muted/30 animate-pulse" />)}
            </div>
          )}
          {displayed.map((s) => (
            <div
              key={s.name}
              onClick={() => setSelectedServerType(s.name)}
              className={`cursor-pointer flex items-center justify-between p-3 rounded-lg border transition-all
                ${selectedServerType === s.name
                  ? 'border-primary bg-primary/5 ring-1 ring-primary/50'
                  : 'border-border/50 hover:border-border hover:bg-muted/20'}`}
            >
              <div className="flex items-center gap-4">
                <span className="font-mono text-sm text-muted-foreground w-12">{s.name}</span>
                <div className="flex gap-3 text-sm">
                  <span>{s.vcpu} vCPU</span>
                  <span className="text-muted-foreground">·</span>
                  <span>{s.ram_gb} GB</span>
                  <span className="text-muted-foreground">·</span>
                  <span>{s.disk_gb} GB</span>
                </div>
              </div>
              <span className="font-semibold text-sm">${s.price_monthly}/mo</span>
            </div>
          ))}
        </div>
        {!showMore && serverTypes.length > 3 && (
          <button onClick={() => setShowMore(true)} className="text-sm text-muted-foreground hover:text-foreground">
            Show {serverTypes.length - 3} more →
          </button>
        )}
      </div>

      {/* Advanced */}
      <button onClick={() => setShowAdvanced(!showAdvanced)} className="text-sm text-muted-foreground hover:text-foreground">
        {showAdvanced ? '▾ Hide' : '▸'} Region & name
      </button>

      {showAdvanced && (
        <div className="space-y-4 pl-4 border-l-2 border-border/30">
          <div>
            <Label className="text-sm">Region</Label>
            <div className="flex gap-2 mt-1">
              {REGIONS.map(r => (
                <button
                  key={r.value}
                  onClick={() => setSelectedRegion(r.value)}
                  className={`px-3 py-1.5 rounded-md text-sm border transition-all
                    ${selectedRegion === r.value
                      ? 'border-primary bg-primary/10'
                      : 'border-border/50 text-muted-foreground hover:border-border'}`}
                >
                  {r.flag} {r.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-sm">Name</Label>
            <Input placeholder="my-machine" value={machineName} onChange={e => setMachineName(e.target.value)} className="mt-1 max-w-xs" />
          </div>
        </div>
      )}

      {/* Create */}
      <Card className="bg-muted/20">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              {selectedST && (
                <div className="text-sm">
                  <span className="font-mono">{selectedST.name}</span>
                  <span className="text-muted-foreground"> · </span>
                  <span className="text-xs">{selectedST.vcpu} vCPU / {selectedST.ram_gb}GB / {selectedST.disk_gb}GB</span>
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                {REGIONS.find(r => r.value === selectedRegion)?.label} · SSH key auto-generated · code-server + claude + opencode pre-installed
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-lg font-bold">${selectedST?.price_monthly ?? '—'}</div>
                <div className="text-xs text-muted-foreground">/month</div>
              </div>
              <Button onClick={handleCreate} disabled={loading || !selectedServerType} size="lg">
                {loading ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
