"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRegions, useServerTypes, pickDefaultRegion } from "@/hooks/v2/use-server-types-v2";
import { useCreateMachine } from "@/hooks/v2/use-machines-v2";
import { useAccountLimits } from "@/hooks/use-account";
import { useSSHKeys } from "@/hooks/use-ssh-keys";
import { useImages } from "@/hooks/v2/use-images-v2";
import { isUnlimitedLimit } from "@/lib/account-limits";
import { toast } from "sonner";
import {
  X,
  Loader2,
  ArrowRight,
  Check,
  Monitor,
  HardDrive,
  ChevronDown,
  AlertTriangle,
  KeyRound,
  Shield,
  SlidersHorizontal,
  Info,
} from "lucide-react";
import {
  effectiveMonthlyPrice,
  type BillingInterval,
} from "@/components/plan-picker";
import { PlanList } from "@/components/plan-list";
import { BACKUP_SURCHARGE_PERCENT, backupSurcharge } from "@/lib/plan-catalog";
import type { Image } from "@/lib/types";
import { cn, regionDisplay } from "@/lib/utils";

const RECOMMENDED_IDX = 1;
const DEFAULT_TEMPLATE_NAME = "justavps standard";

/* ═══ Sub-components ═══ */

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

/* ═══ CheckoutModal ═══ */

interface CheckoutModalProps {
  open: boolean;
  onClose: () => void;
}

export function CheckoutModal({ open, onClose }: CheckoutModalProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const isLoggedIn = !!session?.user;

  /* ─── Data fetching ─── */
  const { data: regions } = useRegions();
  const { data: limits } = useAccountLimits(isLoggedIn);
  const { data: userSSHKeys } = useSSHKeys(isLoggedIn);
  const { data: allImages } = useImages(isLoggedIn);

  /* ─── Selection state ─── */
  const [regionOverride, setRegionOverride] = useState("");
  const selectedRegion = regionOverride || pickDefaultRegion(regions) || "";
  const { data: serverTypes } = useServerTypes(selectedRegion || undefined);
  const [serverTypeOverride, setServerTypeOverride] = useState("");
  const selectedServerType =
    serverTypeOverride ||
    serverTypes?.[Math.min(RECOMMENDED_IDX, (serverTypes?.length ?? 1) - 1)]?.name ||
    "";
  const [billingInterval] = useState<BillingInterval>("monthly");

  /* ─── Config state ─── */
  const [machineName, setMachineName] = useState("");
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [selectedSSHKeyIds, setSelectedSSHKeyIds] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [backupsEnabled, setBackupsEnabled] = useState(false);
  const [showCustomSizing, setShowCustomSizing] = useState(false);

  const [guestCheckoutPending, setGuestCheckoutPending] = useState(false);
  const createMachine = useCreateMachine();

  /* ─── Derived values ─── */
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
  const basePriceMonthly = selectedST?.price_monthly ?? 0;
  const backupCost = backupsEnabled ? backupSurcharge(basePriceMonthly) : 0;
  const footerMonthly = selectedST
    ? effectiveMonthlyPrice(basePriceMonthly + backupCost, billingInterval)
    : 0;

  const machineUsage = limits?.usage.machines ?? 0;
  const machineMax = limits?.limits.max_machines;
  const machineUnlimited = isUnlimitedLimit(machineMax);
  const machineLimitReached =
    !machineUnlimited && machineMax !== undefined && machineUsage >= machineMax;
  const hasExistingKeys = Boolean(userSSHKeys && userSSHKeys.length > 0);

  const canCreate = Boolean(
    selectedRegion && selectedServerType && !machineLimitReached,
  );

  const allPlans = serverTypes ?? [];

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
    if (!selectedRegion || !selectedServerType) return;

    if (!isLoggedIn) {
      setGuestCheckoutPending(true);
      void fetch("/api/checkout/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: selectedServerType,
          region: selectedRegion,
          server_type: selectedServerType,
          billing_interval: billingInterval,
          enable_backups: backupsEnabled,
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
        server_type: selectedServerType,
        region: selectedRegion,
        billing_interval: billingInterval,
        name: machineName || undefined,
        image_id: selectedImageId ?? undefined,
        ssh_key_ids: selectedSSHKeyIds.length > 0 ? selectedSSHKeyIds : undefined,
        enable_backups: backupsEnabled,
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

  const isPending = createMachine.isPending || guestCheckoutPending;

  return (
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative h-full flex items-center justify-center p-0 md:p-6">
        <div className="w-full max-w-[520px] bg-background flex flex-col h-full md:h-auto md:max-h-[calc(100vh-3rem)] md:rounded-2xl md:border md:border-border overflow-hidden shadow-2xl">

          {/* ─── HEADER ─── */}
          <div className="shrink-0 px-6 pt-5 pb-3 border-b border-border">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">Deploy your machine</h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {isLoggedIn
                    ? "Choose a preset or configure a custom machine — your machine deploys in about 60 seconds."
                    : "Choose a plan — we’ll use your email at checkout to set up your account."}
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

            {/* ── Region ── */}
            {regions && regions.length > 1 && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mr-2">Region</span>
                {regions.map((r) => {
                  const active = selectedRegion === r.id;
                  const rm = regionDisplay(r.id);
                  return (
                    <button
                      key={r.id}
                      onClick={() => { setRegionOverride(r.id); setServerTypeOverride(""); }}
                      className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all",
                        active
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      )}
                    >
                      <span className="text-sm leading-none">{rm.flag}</span>
                      {rm.label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* ── Plan list ── */}
            <PlanList
              plans={allPlans}
              selected={selectedServerType}
              onSelect={(name) => setServerTypeOverride(name)}
              showPopular
            />

            <div className="rounded-xl border border-dashed border-border/70 px-4 py-3 bg-muted/10">
              <button
                type="button"
                onClick={() => setShowCustomSizing((v) => !v)}
                className="flex w-full items-center justify-between gap-3 text-left"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="mt-0.5 rounded-lg bg-muted p-2">
                    <SlidersHorizontal className="size-3.5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Need a custom machine?</p>
                    <p className="text-[11px] text-muted-foreground">
                      V2 will support custom vCPU, RAM, and storage sizing with metered billing. For now, presets are the reliable launch path while the advanced path is hardened.
                    </p>
                  </div>
                </div>
                <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", showCustomSizing && "rotate-180")} />
              </button>

              {showCustomSizing && (
                <div className="mt-3 rounded-lg border bg-background px-3 py-3 text-[11px] text-muted-foreground space-y-2">
                  <div className="flex items-start gap-2">
                    <Info className="mt-0.5 size-3 shrink-0" />
                    <p>Advanced custom sizing is planned for V2 as a separate mode. It will let users choose vCPU, RAM, and storage directly while keeping presets for the fastest and safest path.</p>
                  </div>
                  <p>Preset plans stay default because they are easier to understand, easier to support, and map cleanly to capacity planning and price predictability.</p>
                </div>
              )}
            </div>

            {/* ── Backup add-on ── */}
            <button
              type="button"
              onClick={() => setBackupsEnabled((v) => !v)}
              className={cn(
                "flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-all text-left",
                backupsEnabled
                  ? "border-foreground/20 bg-foreground/[0.03]"
                  : "border-border hover:border-foreground/20"
              )}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded border-[1.5px] transition-colors",
                  backupsEnabled ? "border-foreground bg-foreground" : "border-muted-foreground/30",
                )}>
                  {backupsEnabled && <Check className="size-2.5 text-background" />}
                </div>
                <Shield className={cn("size-3.5 shrink-0", backupsEnabled ? "text-foreground" : "text-muted-foreground")} />
                <div className="min-w-0">
                  <p className="text-xs font-medium">Add managed backups</p>
                  <p className="text-[10px] text-muted-foreground">Included snapshots + daily off-host backups · +{BACKUP_SURCHARGE_PERCENT}% of plan price</p>
                </div>
              </div>
              <span className={cn(
                "text-xs font-medium shrink-0 tabular-nums",
                backupsEnabled ? "text-foreground" : "text-muted-foreground"
              )}>
                {backupsEnabled ? `+$${backupSurcharge(basePriceMonthly)}/mo` : "Off"}
              </span>
            </button>

            {/* ── Advanced config (logged-in) ── */}
            {isLoggedIn && (
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
                    {/* Machine name */}
                    <Input
                      placeholder="Machine name (auto-generated if blank)"
                      value={machineName}
                      onChange={(e) => setMachineName(e.target.value)}
                      className="h-8 text-xs"
                    />

                    {/* Image picker */}
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

                  </div>
                )}
              </div>
            )}

            {/* ── Trust signals ── */}
            <div className="flex items-center justify-center gap-3 text-[10px] text-muted-foreground/50 pt-1">
              <span>Ready in ~60s</span>
              <span>·</span>
              <span>Cancel anytime</span>
              <span>·</span>
              <span>No lock-in</span>
            </div>
          </div>

          {/* ─── STICKY FOOTER ─── */}
          <div className="shrink-0 border-t border-border px-6 py-4 bg-background">
            {isLoggedIn && machineLimitReached && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2">
                <AlertTriangle className="size-3.5 text-destructive shrink-0" />
                <p className="text-xs text-muted-foreground">Machine limit reached — delete one to continue.</p>
              </div>
            )}

            <div className="flex items-center gap-4">
              {/* Price */}
              <div className="min-w-0">
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold tabular-nums">${footerMonthly}</span>
                  <span className="text-xs text-muted-foreground">/mo</span>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Billed monthly{backupsEnabled ? " · incl. backups" : ""}
                </p>
              </div>

              {/* CTA */}
              <Button
                className="flex-1 h-12 text-sm font-semibold rounded-xl"
                onClick={handleDeploy}
                disabled={isPending || !canCreate || (isLoggedIn && machineLimitReached)}
              >
                {isPending ? (
                  <><Loader2 className="size-4 animate-spin mr-2" />Processing…</>
                ) : (
                  <>
                    {isLoggedIn ? "Deploy now" : "Continue to checkout"}
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
