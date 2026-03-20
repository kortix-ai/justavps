"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProviders, useRegions, useServerTypes, pickDefaultRegion } from "@/hooks/use-server-types";
import { useCreateMachine } from "@/hooks/use-machines";
import { useAccountLimits } from "@/hooks/use-account";
import { useSSHKeys } from "@/hooks/use-ssh-keys";
import { useImages } from "@/hooks/use-images";
import { toast } from "sonner";
import {
  X,
  Loader2,
  ArrowRight,
  Check,
  Monitor,
  Container,
  HardDrive,
  ChevronDown,
  AlertTriangle,
  KeyRound,
} from "lucide-react";
import {
  BillingToggle,
  effectiveMonthlyPrice,
  totalPrice,
  type BillingInterval,
} from "@/components/plan-picker";
import type { Image } from "@/lib/types";
import { cn, regionDisplay } from "@/lib/utils";

/* ═══ Plan meta ═══ */
const PLAN_META: Record<number, { label: string; tag?: string }> = {
  0: { label: "Starter" },
  1: { label: "Pro", tag: "Popular" },
  2: { label: "Power" },
  3: { label: "Ultra" },
};

const DEFAULT_TEMPLATE_NAME = "justavps standard";

/* ═══ Helpers ═══ */

function ImageChoiceRow({
  image,
  selected,
  onClick,
}: {
  image: Image;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors",
        selected ? "border-primary/30 bg-primary/5" : "hover:bg-muted/30",
      )}
    >
      <div
        className={cn(
          "flex size-3.5 shrink-0 items-center justify-center rounded border-[1.5px] transition-colors",
          selected ? "border-primary bg-primary" : "border-muted-foreground/30",
        )}
      >
        {selected && <Check className="size-2 text-primary-foreground" />}
      </div>
      <HardDrive className="size-3 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-xs leading-tight">{image.name}</p>
          <p className="text-[10px] text-muted-foreground truncate">
            {image.kind === "template" ? "Template" : "Saved image"}
            {image.disk_size_gb ? ` · ${image.disk_size_gb} GB` : ""}
          </p>
        {image.description ? (
          <p className="text-[10px] text-muted-foreground/80 line-clamp-2 mt-0.5">{image.description}</p>
        ) : null}
      </div>
    </div>
  );
}

/* ═══ Component ═══ */
interface CheckoutModalProps {
  open: boolean;
  onClose: () => void;
}

export function CheckoutModal({ open, onClose }: CheckoutModalProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const isLoggedIn = !!session?.user;

  const { data: allProviders } = useProviders();
  const providers = allProviders ?? [];
  const selectedProvider = providers[0]?.name || "";
  const { data: regions } = useRegions(selectedProvider || undefined);
  const { data: limits } = useAccountLimits();
  const { data: userSSHKeys } = useSSHKeys();
  const { data: allImages } = useImages();

  const [regionOverride, setRegionOverride] = useState("");
  const selectedRegion = regionOverride || pickDefaultRegion(regions) || "";
  const { data: serverTypes } = useServerTypes(
    selectedProvider || undefined,
    selectedRegion || undefined,
  );
  const [serverTypeOverride, setServerTypeOverride] = useState("");
  const selectedServerType =
    serverTypeOverride ||
    serverTypes?.[Math.min(1, (serverTypes?.length ?? 1) - 1)]?.name ||
    "";
  const [billingInterval, setBillingInterval] =
    useState<BillingInterval>("monthly");

  const [machineName, setMachineName] = useState("");
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [dockerImage, setDockerImage] = useState("");
  const [entrypoint, setEntrypoint] = useState("");
  const [command, setCommand] = useState("");
  const [showDockerConfig, setShowDockerConfig] = useState(false);
  const [selectedSSHKeyIds, setSelectedSSHKeyIds] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [guestCheckoutPending, setGuestCheckoutPending] = useState(false);
  const createMachine = useCreateMachine();

  const publicTemplates =
    allImages?.filter(
      (img) => img.status === "ready" && img.kind === "template" && img.name !== DEFAULT_TEMPLATE_NAME,
    ) ?? [];
  const userImages =
    allImages?.filter(
      (img) => img.status === "ready" && img.kind === "snapshot",
    ) ?? [];
  const otherImages = [...publicTemplates, ...userImages];
  const selectedImage = otherImages.find((img) => img.id === selectedImageId) ?? null;

  const selectedST = serverTypes?.find((s) => s.name === selectedServerType);
  const displayMonthly = selectedST
    ? effectiveMonthlyPrice(selectedST.price_monthly, billingInterval)
    : 0;
  const total = selectedST
    ? totalPrice(selectedST.price_monthly, billingInterval)
    : 0;
  const isDiscounted = billingInterval !== "monthly";

  const machineUsage = limits?.usage.machines ?? 0;
  const machineMax = limits?.limits.max_machines;
  const machineLimitReached =
    machineMax !== undefined && machineUsage >= machineMax;
  const hasExistingKeys = Boolean(userSSHKeys && userSSHKeys.length > 0);

  const selectionReady = !showDockerConfig || Boolean(dockerImage.trim());
  const canCreate = Boolean(
    selectedProvider &&
      selectedRegion &&
      selectedServerType &&
      selectionReady &&
      !machineLimitReached,
  );

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

  const handleDeploy = () => {
    if (!selectedProvider || !selectedRegion || !selectedServerType) return;

    const imageId =
      selectedImageId ?? undefined;

    if (!isLoggedIn) {
      setGuestCheckoutPending(true);
      void fetch("/api/checkout/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedProvider,
          region: selectedRegion,
          server_type: selectedServerType,
          billing_interval: billingInterval,
        }),
      })
        .then(async (res) => {
          const data = await res
            .json()
            .catch(() => ({ message: "Failed to start checkout." }));
          if (!res.ok) throw new Error(data.message || "Failed to start checkout.");
          window.location.href = data.checkout_url;
        })
        .catch((err: Error) => toast.error(err.message))
        .finally(() => setGuestCheckoutPending(false));
      return;
    }

    createMachine.mutate(
      {
        provider: selectedProvider,
        server_type: selectedServerType,
        region: selectedRegion,
        billing_interval: billingInterval,
        name: machineName || undefined,
        image_id: imageId,
        docker_image: showDockerConfig ? dockerImage || undefined : undefined,
        entrypoint: showDockerConfig ? entrypoint || undefined : undefined,
        command: showDockerConfig ? command || undefined : undefined,
        ssh_key_ids: selectedSSHKeyIds.length > 0 ? selectedSSHKeyIds : undefined,
      },
      {
        onSuccess: (result) => {
          if (result.kind === "checkout") {
            window.location.href = result.checkout.checkout_url;
            return;
          }
          toast.success("Machine created!");
          onClose();
          router.push(`/machines/${result.machine.id}`);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  if (!open) return null;

  const regionCity = regions?.find((r) => r.id === selectedRegion)?.city;
  const isPending = createMachine.isPending || guestCheckoutPending;

  return (
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative h-full flex items-center justify-center p-0 md:p-6">
        <div className="w-full max-w-[640px] bg-background flex flex-col h-full md:h-auto md:max-h-[calc(100vh-3rem)] md:rounded-2xl md:border md:border-border overflow-hidden shadow-2xl">

          {/* ─── HEADER ─── */}
          <div className="shrink-0 px-6 pt-5 pb-4 flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Deploy a machine</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-3">
                <span>Dedicated VPS</span>
                <span className="text-border">·</span>
                <span>Daily backups</span>
                <span className="text-border">·</span>
                <span>60s deploy</span>
                <span className="text-border">·</span>
                <span>Cancel anytime</span>
              </p>
            </div>
            <button
              onClick={onClose}
              className="size-7 rounded-lg flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground hover:text-foreground -mt-0.5"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* ─── BODY ─── */}
          <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-5">

            {/* Billing + Region row */}
            <div className="flex items-center justify-between gap-3">
              <BillingToggle interval={billingInterval} onChange={setBillingInterval} />
              {regions && regions.length > 1 && (
                <div className="flex items-center gap-1">
                  {regions.map((r) => {
                    const active = selectedRegion === r.id;
                    const rm = regionDisplay(r.id);
                    return (
                      <button
                        key={r.id}
                        onClick={() => { setRegionOverride(r.id); setServerTypeOverride(""); }}
                        className={cn(
                          "px-2.5 py-1 rounded-lg text-xs font-medium transition-all",
                          active
                            ? "bg-foreground text-background"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        )}
                      >
                        {rm.flag}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ─── Plan selector — compact horizontal cards ─── */}
            <div className="grid grid-cols-4 gap-2">
              {(serverTypes ?? []).map((s, idx) => {
                const meta = PLAN_META[idx] ?? { label: s.name };
                const active = selectedServerType === s.name;
                const monthlyPrice = effectiveMonthlyPrice(s.price_monthly, billingInterval);

                return (
                  <button
                    key={s.name}
                    onClick={() => setServerTypeOverride(s.name)}
                    className={cn(
                      "relative flex flex-col items-center gap-1 rounded-xl border p-3 transition-all text-center",
                      active
                        ? "border-foreground bg-foreground/[0.03] ring-1 ring-foreground"
                        : "border-border hover:border-foreground/40",
                    )}
                  >
                    {meta.tag && (
                      <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 px-1.5 py-px rounded-full bg-primary text-primary-foreground text-[8px] font-semibold leading-tight whitespace-nowrap">
                        {meta.tag}
                      </span>
                    )}
                    <span className="text-[11px] font-medium">{meta.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {s.vcpu}C / {s.ram_gb}G
                    </span>
                    <div className="flex items-baseline gap-px mt-0.5">
                      {isDiscounted && (
                        <span className="text-[9px] text-muted-foreground/40 line-through mr-0.5">${s.price_monthly}</span>
                      )}
                      <span className="text-base font-semibold tabular-nums">${monthlyPrice}</span>
                      <span className="text-[9px] text-muted-foreground">/mo</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* ─── Selected plan detail strip ─── */}
            {selectedST && (
              <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3.5 py-2">
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {PLAN_META[serverTypes?.indexOf(selectedST) ?? 0]?.label ?? selectedST.name}
                  </span>
                  <span>{selectedST.vcpu} vCPU</span>
                  <span className="text-border">·</span>
                  <span>{selectedST.ram_gb} GB RAM</span>
                  <span className="text-border">·</span>
                  <span>{selectedST.disk_gb} GB SSD</span>
                  {regionCity && (
                    <>
                      <span className="text-border">·</span>
                      <span>{regionDisplay(selectedRegion).flag} {regionCity}</span>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ─── Config (logged-in) ─── */}
            {isLoggedIn && (
              <div className="space-y-3">
                {/* Advanced */}
                <button
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors"
                >
                  <ChevronDown className={cn("size-3 transition-transform", showAdvanced && "rotate-180")} />
                  Advanced
                </button>

                {showAdvanced && (
                  <div className="space-y-3 rounded-lg border border-border/50 bg-muted/5 p-3">
                    {/* Machine name */}
                    <Input
                      placeholder="Machine name (auto-generated if blank)"
                      value={machineName}
                      onChange={(e) => setMachineName(e.target.value)}
                      className="h-8 text-xs"
                    />

                    {/* Image picker — unified dropdown, "justavps standard" selected by default */}
                    <div className="space-y-1.5">
                      <button
                        type="button"
                        onClick={() => setShowImagePicker((v) => !v)}
                        className="flex w-full items-center justify-between gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted/30"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <HardDrive className="size-3 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs leading-tight">Choose image</p>
                            <p className="mt-0.5 text-[10px] text-muted-foreground truncate">
                              {selectedImage
                                ? `${selectedImage.name} · ${selectedImage.kind === "template" ? "Template" : "Saved image"}${selectedImage.disk_size_gb ? ` · ${selectedImage.disk_size_gb} GB` : ""}`
                                : "justavps standard · Default Ubuntu 24.04 + justavps stack"}
                            </p>
                          </div>
                        </div>
                        <ChevronDown className={cn("size-3 shrink-0 text-muted-foreground transition-transform", showImagePicker && "rotate-180")} />
                      </button>

                      {showImagePicker && (
                        <div className="space-y-1 pl-1">
                          {/* Default image option */}
                          <div
                            onClick={() => { setSelectedImageId(null); setShowImagePicker(false); }}
                            className={cn(
                              "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors",
                              selectedImageId === null ? "border-foreground/20 bg-foreground/[0.03]" : "hover:bg-muted/30",
                            )}
                          >
                            <div className={cn(
                              "flex size-3.5 shrink-0 items-center justify-center rounded border-[1.5px] transition-colors",
                              selectedImageId === null ? "border-foreground bg-foreground" : "border-muted-foreground/30",
                            )}>
                              {selectedImageId === null && <Check className="size-2 text-background" />}
                            </div>
                            <Monitor className="size-3 shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                              <p className="text-xs leading-tight">justavps standard</p>
                              <p className="text-[10px] text-muted-foreground">Default · Ubuntu 24.04 + justavps stack</p>
                            </div>
                          </div>
                          {/* Other images */}
                          {otherImages.map((image) => (
                            <ImageChoiceRow
                              key={image.id}
                              image={image}
                              selected={selectedImageId === image.id}
                              onClick={() => { setSelectedImageId(image.id); setShowImagePicker(false); }}
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    {/* SSH keys */}
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <KeyRound className="size-3 shrink-0" />
                        <span>New SSH key auto-generated</span>
                      </div>
                      {hasExistingKeys && (
                        <div className="space-y-1.5">
                          <p className="text-[10px] text-muted-foreground/70">Add existing keys too</p>
                          <div className="flex flex-wrap gap-1.5">
                          {userSSHKeys?.map((key) => {
                            const isSelected = selectedSSHKeyIds.includes(key.id);
                            return (
                              <button
                                key={key.id}
                                onClick={() =>
                                  setSelectedSSHKeyIds((prev) =>
                                    isSelected
                                      ? prev.filter((id) => id !== key.id)
                                      : [...prev, key.id],
                                  )
                                }
                                className={cn(
                                  "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] transition-colors",
                                  isSelected
                                    ? "border-foreground/30 bg-foreground/5 text-foreground"
                                    : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                                )}
                              >
                                <div className={cn(
                                  "flex size-2.5 shrink-0 items-center justify-center rounded-sm border transition-colors",
                                  isSelected ? "border-foreground bg-foreground" : "border-muted-foreground/30",
                                )}>
                                  {isSelected && <Check className="size-1.5 text-background" />}
                                </div>
                                {key.name}
                              </button>
                            );
                          })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Docker auto-run */}
                    <div className="space-y-1.5">
                      <button
                        type="button"
                        onClick={() => setShowDockerConfig((current) => !current)}
                        className="flex w-full items-center justify-between gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted/30"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Container className="size-3 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs leading-tight">Docker auto-run</p>
                            <p className="mt-0.5 text-[10px] text-muted-foreground truncate">
                              {showDockerConfig && dockerImage ? dockerImage : "Optional — runs after boot"}
                            </p>
                          </div>
                        </div>
                        <ChevronDown className={cn("size-3 shrink-0 text-muted-foreground transition-transform", showDockerConfig && "rotate-180")} />
                      </button>

                      {showDockerConfig && (
                        <div className="space-y-2 pl-1">
                          <Input id="co-docker-image" placeholder="python:3.12-alpine" value={dockerImage} onChange={(e) => setDockerImage(e.target.value)} className="h-8 text-xs font-mono" />
                          <Input id="co-docker-entry" placeholder="Entrypoint override, e.g. /bin/sh" value={entrypoint} onChange={(e) => setEntrypoint(e.target.value)} className="h-8 text-xs font-mono" />
                          <Input id="co-docker-command" placeholder="Command, e.g. -m http.server 8000" value={command} onChange={(e) => setCommand(e.target.value)} className="h-8 text-xs font-mono" />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Guest card */}
            {!isLoggedIn && (
              <div className="rounded-lg border bg-muted/20 px-3.5 py-2.5">
                <p className="text-xs text-muted-foreground">
                  No account needed — Stripe collects your email at checkout. Machine unlocks immediately.
                </p>
              </div>
            )}
          </div>

          {/* ─── FOOTER CTA ─── */}
          <div className="shrink-0 border-t border-border px-6 py-4 bg-background">
            {isLoggedIn && machineLimitReached && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2">
                <AlertTriangle className="size-3.5 text-destructive shrink-0" />
                <p className="text-xs text-muted-foreground">Machine limit reached — delete one to continue.</p>
              </div>
            )}

            <div className="flex items-center gap-4">
              {/* Price summary */}
              <div className="min-w-0">
                <div className="flex items-baseline gap-1">
                  {isDiscounted && selectedST && (
                    <span className="text-xs text-muted-foreground/40 line-through">${selectedST.price_monthly}</span>
                  )}
                  <span className="text-xl font-semibold tabular-nums">${displayMonthly}</span>
                  <span className="text-xs text-muted-foreground">/mo</span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {isDiscounted
                    ? `$${total} billed ${billingInterval === "yearly" ? "annually" : "every 2 yrs"}`
                    : "Billed monthly · cancel anytime"}
                </p>
              </div>

              {/* Deploy button */}
              <Button
                className="flex-1 h-11 text-sm font-medium rounded-xl"
                onClick={handleDeploy}
                disabled={isPending || !canCreate || (isLoggedIn && machineLimitReached)}
              >
                {isPending ? (
                  <><Loader2 className="size-4 animate-spin mr-2" />Deploying…</>
                ) : (
                  <>
                    {isLoggedIn ? "Deploy machine" : "Continue to checkout"}
                    <ArrowRight className="size-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
