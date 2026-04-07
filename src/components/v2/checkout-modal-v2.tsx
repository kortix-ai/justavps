"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { useAvailableHosts, type HostCapacity } from "@/hooks/v2/use-hosts-v2";
import { useCreateMachine } from "@/hooks/v2/use-machines-v2";
import { useAccountLimits } from "@/hooks/use-account";
import { computePriceBreakdown } from "@/lib/v2-pricing";
import { toast } from "sonner";
import {
  X,
  Loader2,
  ArrowRight,
  Check,
  Server,
  Cpu,
  MemoryStick,
  HardDrive,
  ChevronDown,
  AlertTriangle,
  Globe,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isUnlimitedLimit } from "@/lib/account-limits";

/* ═══ Resource constraints ═══ */

const MIN_VCPU = 1;
const MIN_RAM_GB = 1;
const MIN_DISK_GB = 10;
const VCPU_STEP = 1;
const RAM_STEP = 1;
const DISK_STEP = 10;

/* ═══ Capacity bar ═══ */

function CapacityBar({ used, total, unit, label }: { used: number; total: number; unit: string; label: string }) {
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums font-medium">{used}/{total} {unit} ({pct}%)</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            pct > 85 ? "bg-red-500" : pct > 60 ? "bg-amber-500" : "bg-emerald-500",
          )}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

/* ═══ Host card ═══ */

function HostCard({ host, selected, onClick }: { host: HostCapacity; selected: boolean; onClick: () => void }) {
  const c = host.capacity;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-xl border p-3.5 transition-all",
        selected
          ? "border-foreground/30 bg-foreground/[0.03] ring-1 ring-foreground/10"
          : "border-border hover:border-foreground/20 hover:bg-muted/20",
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={cn(
            "flex size-8 items-center justify-center rounded-lg",
            selected ? "bg-foreground text-background" : "bg-muted text-muted-foreground",
          )}>
            <Server className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{host.name}</p>
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Globe className="size-2.5" />
              {host.location_label}
              {host.public_ipv4 && <span className="text-muted-foreground/60">· {host.public_ipv4}</span>}
            </p>
          </div>
        </div>
        <div className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors mt-0.5",
          selected ? "border-foreground bg-foreground" : "border-muted-foreground/30",
        )}>
          {selected && <Check className="size-2.5 text-background" />}
        </div>
      </div>

      <div className="space-y-1.5">
        <CapacityBar used={c.used_vcpu} total={c.total_vcpu} unit="vCPU" label="CPU" />
        <CapacityBar used={c.used_memory_gb} total={c.total_memory_gb} unit="GB" label="RAM" />
        <CapacityBar used={c.used_disk_gb} total={c.total_disk_gb} unit="GB" label="Disk" />
      </div>
    </button>
  );
}

/* ═══ Resource slider ═══ */

function ResourceSlider({
  icon: Icon,
  label,
  unit,
  value,
  min,
  max,
  step,
  onChange,
}: {
  icon: React.ElementType;
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <Icon className="size-3.5 text-muted-foreground" />
          <span className="font-medium">{label}</span>
        </div>
        <span className="text-sm font-semibold tabular-nums">
          {value} {unit}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(val) => onChange(Array.isArray(val) ? val[0] : val)}
        className="w-full"
      />
      <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>{min} {unit}</span>
        <span>{max} {unit}</span>
      </div>
    </div>
  );
}

/* ═══ CheckoutModal ═══ */

interface CheckoutModalProps {
  open: boolean;
  onClose: () => void;
}

export function CheckoutModal({ open, onClose }: CheckoutModalProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const isLoggedIn = !!session?.user;

  const { data: hosts, isLoading: hostsLoading } = useAvailableHosts(open && isLoggedIn);
  const { data: limits } = useAccountLimits(isLoggedIn);
  const createMachine = useCreateMachine();

  /* ─── Selection state ─── */
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [vcpu, setVcpu] = useState(2);
  const [ramGb, setRamGb] = useState(4);
  const [diskGb, setDiskGb] = useState(80);
  const [machineName, setMachineName] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  /* ─── Derived ─── */
  const effectiveHostId = selectedHostId ?? (hosts && hosts.length > 0 ? hosts[0].id : null);

  const selectedHost = useMemo(
    () => hosts?.find((h) => h.id === effectiveHostId) ?? null,
    [hosts, effectiveHostId],
  );

  const maxVcpu = selectedHost ? selectedHost.capacity.free_vcpu : 0;
  const maxRam = selectedHost ? selectedHost.capacity.free_memory_gb : 0;
  const maxDisk = selectedHost ? Math.floor(selectedHost.capacity.free_disk_gb / DISK_STEP) * DISK_STEP : 0;

  const clampedVcpu = Math.min(Math.max(vcpu, MIN_VCPU), maxVcpu || MIN_VCPU);
  const clampedRam = Math.min(Math.max(ramGb, MIN_RAM_GB), maxRam || MIN_RAM_GB);
  const clampedDisk = Math.min(Math.max(diskGb, MIN_DISK_GB), maxDisk || MIN_DISK_GB);

  const machineUsage = limits?.usage.machines ?? 0;
  const machineMax = limits?.limits.max_machines;
  const machineUnlimited = isUnlimitedLimit(machineMax);
  const machineLimitReached =
    !machineUnlimited && machineMax !== undefined && machineUsage >= machineMax;

  const canCreate = Boolean(
    effectiveHostId && clampedVcpu >= MIN_VCPU && clampedRam >= MIN_RAM_GB && clampedDisk >= MIN_DISK_GB && !machineLimitReached,
  );

  /* ─── Live price breakdown ─── */
  const price = useMemo(
    () => computePriceBreakdown(clampedVcpu, clampedRam, clampedDisk),
    [clampedVcpu, clampedRam, clampedDisk],
  );

  /* ─── Effects ─── */
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  /* ─── Deploy handler ─── */
  const handleDeploy = () => {
    if (!effectiveHostId || !selectedHost) return;

    createMachine.mutate(
      {
        plan: "custom",
        region: selectedHost.region,
        name: machineName || undefined,
        host_id: effectiveHostId,
        vcpu: clampedVcpu,
        ram_gb: clampedRam,
        disk_gb: clampedDisk,
      },
      {
        onSuccess: (result) => {
          if (result.kind === "checkout") {
            window.location.href = result.checkout.checkout_url;
            return;
          }
          toast.success("Machine created!");
          onClose();
          router.push(`/v2/machines/${result.machine.id}`);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  if (!open) return null;

  const isPending = createMachine.isPending;

  return (
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative h-full flex items-center justify-center p-0 md:p-6">
        <div className="w-full max-w-[520px] bg-background flex flex-col h-full md:h-auto md:max-h-[calc(100vh-3rem)] md:rounded-2xl md:border md:border-border overflow-hidden shadow-2xl">

          {/* ─── HEADER ─── */}
          <div className="shrink-0 px-6 pt-5 pb-3 border-b border-border">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Deploy a machine</h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Select a host and configure the resources you need.
                </p>
              </div>
              <button
                onClick={onClose}
                className="size-7 rounded-lg flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0 ml-4"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* ─── SCROLLABLE BODY ─── */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

            {/* ── Login prompt ── */}
            {!isLoggedIn && (
              <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                <div>
                  <p className="text-sm font-medium">Sign in required</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    V2 machines require an authenticated account. Sign in to continue.
                  </p>
                </div>
              </div>
            )}

            {/* ── Host selection ── */}
            {isLoggedIn && (
              <>
                <div>
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Select host
                  </span>
                </div>

                {hostsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : !hosts || hosts.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-6 text-center">
                    <Server className="mx-auto size-8 text-muted-foreground/30 mb-2" />
                    <p className="text-sm text-muted-foreground">No hosts available</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">
                      All hosts are offline or at capacity.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {hosts.map((host) => (
                      <HostCard
                        key={host.id}
                        host={host}
                        selected={effectiveHostId === host.id}
                        onClick={() => setSelectedHostId(host.id)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ── Resource configuration ── */}
            {isLoggedIn && selectedHost && (
              <>
                <div>
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Configure resources
                  </span>
                </div>

                <div className="space-y-4 rounded-xl border p-4">
                  <ResourceSlider
                    icon={Cpu}
                    label="vCPU"
                    unit="cores"
                    value={clampedVcpu}
                    min={MIN_VCPU}
                    max={Math.max(maxVcpu, MIN_VCPU)}
                    step={VCPU_STEP}
                    onChange={setVcpu}
                  />
                  <ResourceSlider
                    icon={MemoryStick}
                    label="RAM"
                    unit="GB"
                    value={clampedRam}
                    min={MIN_RAM_GB}
                    max={Math.max(maxRam, MIN_RAM_GB)}
                    step={RAM_STEP}
                    onChange={setRamGb}
                  />
                  <ResourceSlider
                    icon={HardDrive}
                    label="Storage"
                    unit="GB"
                    value={clampedDisk}
                    min={MIN_DISK_GB}
                    max={Math.max(maxDisk, MIN_DISK_GB)}
                    step={DISK_STEP}
                    onChange={setDiskGb}
                  />
                </div>
              </>
            )}

            {/* ── Advanced config ── */}
            {isLoggedIn && selectedHost && (
              <div className="space-y-3">
                <button
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors"
                >
                  <ChevronDown className={cn("size-3 transition-transform", showAdvanced && "rotate-180")} />
                  Advanced options
                </button>

                {showAdvanced && (
                  <div className="space-y-3 rounded-xl border border-border/50 bg-muted/5 p-3">
                    <Input
                      placeholder="Machine name (auto-generated if blank)"
                      value={machineName}
                      onChange={(e) => setMachineName(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ─── FOOTER ─── */}
          <div className="shrink-0 border-t border-border px-6 py-4 space-y-3">
            {/* Live price breakdown */}
            {selectedHost && (
              <div className="rounded-xl border bg-muted/20 px-4 py-3 space-y-2">
                <div className="flex items-baseline justify-between">
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Price
                  </div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">
                    {clampedVcpu} vCPU · {clampedRam} GB RAM · {clampedDisk} GB SSD
                  </div>
                </div>
                <div className="flex items-baseline justify-between">
                  <div className="flex items-baseline gap-1">
                    <span className="font-mono text-2xl font-semibold tabular-nums">
                      ${price.monthly}
                    </span>
                    <span className="text-xs text-muted-foreground">/mo</span>
                  </div>
                  <div className="flex flex-col items-end text-[10px] text-muted-foreground tabular-nums leading-tight">
                    <span>${price.hourly.toFixed(4)}/hr</span>
                    <span>${price.per_minute.toFixed(6)}/min</span>
                    <span>${price.per_second.toFixed(8)}/sec</span>
                  </div>
                </div>
              </div>
            )}
            <Button
              className="w-full h-10"
              disabled={!canCreate || isPending || !isLoggedIn}
              onClick={handleDeploy}
            >
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Deploying…
                </>
              ) : (
                <>
                  Deploy Machine
                  <ArrowRight className="size-4" />
                </>
              )}
            </Button>
            <p className="text-[10px] text-center text-muted-foreground">Cancel anytime. Billed per-second of uptime.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
